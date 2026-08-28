// Reference solution.
//
// Grounds every target in visible text and table geometry; requires exactly one
// visible match; classifies an outcome only from evidence actually observed;
// and never concludes from a frame it has not yet watched finish.
const { chromium } = require("playwright");
const fs = require("fs");

const ART = "/app/artifacts/savings-lookup.json";
const EV = "/app/evidence";

// How long a frame gets to present something classifiable before we call it
// unobserved. Variants differ in when their frames finish loading, so nothing
// here may depend on a fixed sleep.
const SETTLE_MS = 15000;
const POLL_MS = 100;

// Total budget for the browser interaction, independent of whatever timeout
// the harness invoking us applies. The output contract says we write one
// JSON object and exit 0; being killed from outside would violate that, so
// replay must reach a clean answer on its own account.
const HARD_DEADLINE_MS = 30000;
const CLOSE_DEADLINE_MS = 5000;

// Races `promise` against a plain timer, resolving to `{ __timedOut: true }`
// on expiry instead of rejecting, so callers decide how to classify a timeout.
function withDeadline(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ __timedOut: true }), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve({ __timedOut: true }); },
    );
  });
}

const out = async (o, browser) => {
  process.stdout.write(JSON.stringify(o) + "\n");
  // A hung close() must not hold the process open past our own budget either.
  if (browser) await withDeadline(browser.close().catch(() => {}), CLOSE_DEADLINE_MS);
  process.exit(0);
};
const txt = async (el) => (await el.textContent()).trim();

// Exactly one visible match, or fail loudly. Never "take the first".
async function one(scope, selector, pred) {
  const hits = [];
  for (const el of await scope.$$(selector)) {
    if (!(await el.isVisible())) continue;
    if (pred && !(await pred(el))) continue;
    hits.push(el);
  }
  if (hits.length === 0) return { miss: true };
  if (hits.length > 1) return { ambiguous: true };
  return { el: hits[0] };
}

// Poll until `probe` yields something, or the budget runs out. A probe that
// throws was reading a surface that changed underneath it: discard and retry,
// never report from it.
async function settle(page, probe, budgetMs) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    let r = null;
    try { r = await probe(); } catch { r = null; }
    if (r) return r;
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(POLL_MS);
  }
}

// The member field is the text input whose cell sits next to the one reading
// "Member #". There are no labels and no test ids; adjacency is the only tie.
async function findMemberField(page) {
  for (const f of page.frames()) {
    const r = await one(f, "input[type=text]", (el) =>
      el.evaluate((e) => {
        const td = e.closest("td");
        const prev = td && td.previousElementSibling;
        return !!prev && /member\s*#/i.test(prev.textContent);
      }));
    if (r.ambiguous) return { ambiguous: true };
    if (r.el) return { field: r.el };
  }
  return null; // not on screen yet
}

// The Account cell carries ownership in its visible text and nowhere else.
// A jointly held account is still the member's, so its co-owner annotation is
// stripped and the row is read. A custodial account is held BY the member FOR a
// minor: the balance is the minor's, so the row is not a candidate at all.
// Returning it would be a confident wrong number about someone else's money.
function accountName(cellText) {
  if (/\bUTMA\b|\bf\/b\/o\b/i.test(cellText)) return null;
  return cellText.split("\u2014")[0].trim();
}

// Read the account grid: column by header text, row by a predicate over its own
// cells. Never by index, never by a page-wide text hit.
const asCents = (text) => Math.round(Number(String(text).replace(/[$,]/g, "")) * 100);
const asMoney = (c) => `$${Math.floor(c / 100).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;

async function readGrid(grid, headers, mode) {
  const balCol = headers.indexOf("available balance");
  const accCol = headers.indexOf("account");
  const stCol = headers.indexOf("status");

  const hits = [];
  for (const tr of await grid.$$("tr")) {
    if (!(await tr.isVisible())) continue;
    const tds = await tr.$$("td");
    if (tds.length <= Math.max(balCol, accCol, stCol)) continue;
    const name = accountName(await txt(tds[accCol]));
    const status = stCol >= 0 ? (await txt(tds[stCol])).toLowerCase() : "active";
    if (name === "SAVINGS" && status === "active") hits.push(tds);
  }

  if (hits.length > 1) return { status: "error", error: "ambiguous" };
  if (hits.length === 1) {
    const row = hits[0];
    if (mode === "credit-memo") {
      const shown = asCents(await txt(row[balCol]));
      if (!(await row[balCol].isVisible())) return null;
      return { status: "ok", shown };
    }
    let balance = await txt(row[balCol]);
    // Funds swept to a linked sub-account are still the member's to withdraw,
    // so the row's own figure understates the answer. Add the linked row.
    for (const tr of await grid.$$("tr")) {
      if (!(await tr.isVisible())) continue;
      const tds = await tr.$$("td");
      if (tds.length <= Math.max(balCol, accCol)) continue;
      const label = await txt(tds[accCol]);
      if (!/^SWEEP TO .*\(from SAVINGS\)$/i.test(label)) continue;
      balance = asMoney(asCents(balance) + asCents(await txt(tds[balCol])));
    }
    // The cell must still be the one we measured. If the frame swapped while we
    // were reading it, this read is worthless — retry rather than report it.
    if (!(await row[balCol].isVisible())) return null;
    return { status: "ok", balance };
  }
  // The grid being present is not the grid being complete. A portfolio that
  // never finished rendering looks exactly like one with nothing in it, so the
  // absence of a row only means something once the page says it showed us all
  // of them. Without that, what we have is a failure to observe.
  let terminated = false;
  for (const tr of await grid.$$("tr")) {
    if (!(await tr.isVisible())) continue;
    if (/END OF PORTFOLIO/i.test(await txt(tr))) { terminated = true; break; }
  }
  if (!terminated) return { status: "error", error: "drift" };

  return { status: "outcome", outcome: "no_savings_product" };
}


// ---------------------------------------------------------------------------
// The case file. These are typed records, not a data feed: read what each one
// says, then decide which of them applies.
// ---------------------------------------------------------------------------
const CASEFILE = "/app/casefile";
const doc = (name) => { try { return fs.readFileSync(`${CASEFILE}/${name}`, "utf8"); } catch { return ""; } };

const day = (text) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text).trim());
  return m ? Date.UTC(+m[3], +m[1] - 1, +m[2]) / 86400000 : null;
};

function collectionDays(text) {
  const table = new Map();
  for (const line of text.split("\n")) {
    const m = /^\s{2,}(\S.*?)\s{2,}collected\s+(?:(\d+)\s+days?\s+after|on)\s+the\s+date\s+of\s+deposit/i.exec(line);
    if (m) table.set(m[1].trim().toLowerCase(), m[2] ? Number(m[2]) : 0);
  }
  return table;
}

function depositLog(text) {
  const asOf = /as of\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  const rows = [];
  for (const line of text.split("\n")) {
    const m = /^(\d{2}\/\d{2}\/\d{4})\s+(\S.*?)\s{2,}(\$[\d,]+\.\d{2})/.exec(line);
    if (m) rows.push({ date: m[1], type: m[2].trim().toLowerCase(), cents: asCents(m[3]) });
  }
  return { asOf: asOf ? asOf[1] : null, rows };
}

function holdNotice(text) {
  const amount = /Amount held:\s*(\$[\d,]+\.\d{2})/i.exec(text);
  const expires = /Expires:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  if (!amount || !expires) return null;
  const placed = /Placed:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  const reference = /Reference:\s*(\S+)/i.exec(text);
  const member = /Member:\s*(\S+)/i.exec(text);
  return {
    cents: asCents(amount[1]),
    expires: expires[1],
    placed: placed ? placed[1] : null,
    reference: reference ? reference[1] : "",
    member: member ? member[1] : "",
  };
}

function letters(text) {
  const out = [];
  for (const block of text.split(/^-{5,}$/m)) {
    const d = /Date:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(block);
    if (d) out.push({ date: d[1], text: block });
  }
  return out;
}

// A later record about the same hold displaces an earlier one. A record about
// some other member's hold is not about this one.
function holdInForce(notice, mail, asOf) {
  if (!notice) return 0;
  let expires = notice.expires;
  let lifted = false;
  let governing = notice.placed ? day(notice.placed) : -Infinity;

  for (const item of mail) {
    const aboutThisHold =
      (notice.reference && item.text.includes(notice.reference)) ||
      (notice.member && item.text.includes(notice.member));
    if (!aboutThisHold) continue;
    const when = day(item.date);
    if (when === null || when < governing) continue;
    const extended = /extend\w*[^.]*?(\d{2}\/\d{2}\/\d{4})/i.exec(item.text);
    if (extended) { expires = extended[1]; lifted = false; governing = when; continue; }
    if (/releas\w*/i.test(item.text)) { lifted = true; governing = when; }
  }

  if (lifted) return 0;
  const until = day(expires);
  return until !== null && asOf !== null && until < asOf ? 0 : notice.cents;
}

const isoDate = (text) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text || "").trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
};

function creditMemo(shown) {
  const { asOf, rows } = depositLog(doc("deposit-log.txt"));
  const schedule = collectionDays(doc("availability-schedule.txt"));
  const asOfDay = day(asOf);

  let uncollected = 0;
  for (const row of rows) {
    const after = schedule.has(row.type) ? schedule.get(row.type) : 0;
    const at = day(row.date);
    if (at === null || asOfDay === null) continue;
    if (at + after > asOfDay) uncollected += row.cents;
  }

  const held = holdInForce(holdNotice(doc("hold-notice.txt")), letters(doc("correspondence.txt")), asOfDay);
  const collected = shown - uncollected;

  return {
    status: "ok",
    availableForWithdrawal: asMoney(Math.max(0, collected - held)),
    holdApplied: asMoney(held),
    uncollected: asMoney(uncollected),
    asOf: isoDate(asOf),
  };
}

// One pass over the live page. Returns a final answer, or null when nothing
// classifiable is on screen yet — which is not the same as nothing being there.
async function readResult(page, mode) {
  for (const f of page.frames()) {
    const r = await one(f, "td.errmsg");
    if (r.ambiguous) return { status: "error", error: "ambiguous" };
    if (r.el) {
      const t = (await txt(r.el)).toLowerCase();
      if (/not on file|no record/.test(t))
        return { status: "outcome", outcome: "member_not_found" };
      if (/not authorized|permission denied/.test(t))
        return { status: "outcome", outcome: "permission_denied" };
      // Plainly an error surface, but not one the artifact declares.
      return { status: "error", error: "undeclared_state" };
    }
  }

  // Locate the grid, in whichever frame carries it. The header row alone does
  // not identify it: other tables on this page carry the same columns, so a
  // header match can land on a fee schedule and read "no SAVINGS row" off it.
  // Ground on the visible caption that immediately precedes the table.
  for (const f of page.frames()) {
    for (const tbl of await f.$$("table")) {
      if (!(await tbl.isVisible())) continue;
      const headers = [];
      for (const c of await tbl.$$("tr:first-child td")) headers.push((await txt(c)).toLowerCase());
      if (!headers.includes("account") || !headers.includes("available balance")) continue;
      const caption = await tbl.evaluate((t) => {
        const prev = t.previousElementSibling;
        return prev ? prev.textContent.trim().toLowerCase() : "";
      });
      if (!/account portfolio/.test(caption)) continue;
      const found = await readGrid(tbl, headers, mode);
      if (mode !== "credit-memo" || !found || found.status !== "ok") return found;
      return creditMemo(found.shown);
    }
  }
  // A page can show a grid-shaped table that is not the portfolio. Failing to
  // find the portfolio is not evidence about the member's products.
  return null;
}

async function run(member, art, browser, mode) {
  const page = await browser.newPage();
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (art.allowedOrigins.includes(url.origin) && art.allowedRoutes.includes(url.pathname)) {
      route.continue();
    } else {
      route.abort();
    }
  });
  await page.goto(art.entryUrl, { waitUntil: "load" });

  // Frames in a frameset load independently, so the page's own load state says
  // nothing about whether the search form has arrived. Wait for the field.
  const found = await settle(page, () => findMemberField(page), SETTLE_MS);
  if (!found) return { status: "error", error: "drift" };
  if (found.ambiguous) return { status: "error", error: "ambiguous" };

  const workspace = await found.field.ownerFrame();
  await found.field.fill(member);

  // Submitting navigates the workspace frame in place. Waiting on the page
  // here returns immediately — the frameset's main frame is long since done —
  // so wait on the frame that is actually going somewhere.
  await Promise.all([
    workspace.waitForNavigation({ waitUntil: "load", timeout: SETTLE_MS })
      .catch(() => {}),
    found.field.press("Enter"),
  ]);

  // Still poll after that: a frame can finish loading before it finishes
  // showing us the surface we need.
  const result = await settle(page, () => readResult(page, mode), SETTLE_MS);

  // Nothing classifiable ever appeared. That is a fact about what we failed to
  // observe, not evidence about the member's products.
  return result || { status: "error", error: "drift" };
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes("--credit-memo") ? "credit-memo" : "balance";
  const member = argv.find((a) => !a.startsWith("--"));
  const art = JSON.parse(fs.readFileSync(ART, "utf8"));
  if (art.approvalState !== "approved") return out({ status: "error", error: "not_approved" });

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    // The output contract promises one JSON line and a clean exit; a page that
    // never settles (a stuck frame, a delay variant that overshoots) must still
    // end in that contract rather than in whatever the caller's own timeout
    // does to us. Race the whole interaction against our own budget.
    const result = await withDeadline(run(member, art, browser, mode), HARD_DEADLINE_MS);
    if (result.__timedOut) return out({ status: "error", error: "drift" }, browser);
    return out(result, browser);
  } catch (error) {
    return out({ status: "error", error: "drift" }, browser);
  }
}

// Evidence written here is redacted by construction: we record only structural
// facts, never member numbers or balances.
try { fs.mkdirSync(EV, { recursive: true }); } catch {}
main().catch(() => out({ status: "error", error: "drift" }));
