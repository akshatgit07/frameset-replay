// Deterministic replay runtime.
//
// BROKEN. Passes the public members; fails on pages built differently.
const { chromium } = require("playwright");
const fs = require("fs");

const ART = "/app/artifacts/savings-lookup.json";
const out = (o) => { process.stdout.write(JSON.stringify(o) + "\n"); process.exit(0); };

async function main() {
  const member = process.argv[2];
  const art = JSON.parse(fs.readFileSync(ART, "utf8"));

  if (art.approvalState !== "approved") out({ status: "error", error: "not_approved" });

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();

    // Route guard: nothing outside the artifact's allowlist.
    await page.route("**/*", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (art.allowedRoutes.some((a) => p === a || p.startsWith(a + "?"))) route.continue();
      else route.abort();
    });

    await page.goto(art.entryUrl);

    // --- find the member field ---------------------------------------------
    // BROKEN: grabs the first text input anywhere in any frame.
    let field = null;
    for (const f of page.frames()) {
      const c = await f.$("input[type=text]");
      if (c) { field = c; break; }
    }
    if (!field) out({ status: "error", error: "drift" });
    await field.fill(member);
    await field.press("Enter");
    await page.waitForTimeout(500);

    // --- read the result ----------------------------------------------------
    for (const f of page.frames()) {
      const err = await f.$(".errmsg");
      if (err) {
        const t = (await err.textContent()).toLowerCase();
        // BROKEN: substring guesses, and no notion of an undeclared state.
        if (t.includes("not on file")) out({ status: "outcome", outcome: "member_not_found" });
        if (t.includes("not authorized")) out({ status: "outcome", outcome: "permission_denied" });
        out({ status: "outcome", outcome: "member_not_found" });
      }
    }

    for (const f of page.frames()) {
      // BROKEN: page-wide text match, first hit wins, no visibility check,
      // no check that this row is the ACTIVE account actually named SAVINGS.
      const cells = await f.$$("td");
      for (const c of cells) {
        const t = (await c.textContent()).trim();
        if (t.includes("SAVINGS")) {
          const row = await c.evaluateHandle((e) => e.parentElement);
          const tds = await row.$$("td");
          // BROKEN: hardcoded column index.
          if (tds[2]) out({ status: "ok", balance: (await tds[2].textContent()).trim() });
        }
      }
    }

    // BROKEN: absence of a row is treated as proof the product does not exist.
    // Nothing here confirms the account grid was ever rendered.
    out({ status: "outcome", outcome: "no_savings_product" });
  } finally {
    await browser.close();
  }
}

main().catch(() => out({ status: "error", error: "drift" }));
