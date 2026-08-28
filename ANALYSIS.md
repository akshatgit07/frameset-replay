# Model failure analysis — frameset-replay

Covers every trial run against this task, the two infrastructure faults that
voided runs, the contract defect found and twice mis-fixed, and an audit of the
task against Terminal-Bench authoring rules.

Trees referenced:

| Ref | Where | What it is |
|---|---|---|
| `1bd96e6` | `~/Documents/frameset-trials` | task as codex saw it |
| `ddcdae1` | `~/Documents/frameset-trials` | + `drift`/`undeclared_state` clarification |
| `89f7ec4` | `~/Documents/frameset-trials` | + `api.anthropic.com` allowlisted |
| snapshot | `~/Documents/frameset-openswarm-probe` | openswarm's working tree, copied 2026-08-27 |

## Every run, valid and void

| Job | Tree | Agent | Result | Counted |
|---|---|---|---|---|
| `2026-08-26__18-43-24` | `1bd96e6` | gpt-5.6-sol ×3 | 0.0 / 0.0 / 1.0 | yes |
| `2026-08-26__19-29-08` | `ddcdae1` | oracle | 1.0, 26 passed | gate |
| `2026-08-26__19-30-18` | `ddcdae1` | gpt-5.6-sol ×3 | **void** — quota | no |
| `2026-08-26__20-45-34` | `89f7ec4` | oracle | 1.0, 26 passed | gate |
| `2026-08-27__00-13-39` | `89f7ec4` | claude-opus-5 | **1.0, 26/26** | yes |
| `2026-08-27__02-59-11` | snapshot | oracle | 1.0, 29 passed | gate |
| `VOID-slept-...03-00-51` | snapshot | claude-opus-5 | **void** — host slept | no |
| `2026-08-27__12-33-46` | snapshot | claude-opus-5 | **1.0, 29/29** | yes |
| `2026-08-27__13-02-34` | snapshot, de-leaked req 7 | claude-opus-5 | **0.0, 28/29** | yes |
| `2026-08-27__15-54-40` | snapshot, de-leaked req 7 | claude-opus-5 ×3 | **0.0 / 1.0 / 1.0** | yes |
| `2026-08-27__16-17-39` | fixed tree | oracle | 1.0, 28 passed, ctrf emitted | gate |
| `2026-08-27__16-19-52` | fixed tree | nop | 0.0, 22F/6P | gate |
| `2026-08-27__16-43-45` | `cce7170` | oracle | 1.0, 28 passed | gate |
| `2026-08-27__16-43-51` | `cce7170` | nop | 0.0, 22F/6P | gate |
| `2026-08-27__16-44-56` | `cce7170` | claude-opus-5 ×3 | **1.0 / 1.0 / 1.0** | yes |

Two runs are excluded, for the same reason as the two excluded in the previous
version of this document: the reward reflects the harness, not the model.

- `19-30-18` — three `ApiUsageLimitError`s. The agent phase never executed. All
  three verifiers reported **21 failed / 5 passed**, identical to this task's
  own `nop` baseline. That identity, not the reward, is what identified it.
- `03-00-51` — the host slept overnight. Harbor launched the agent at 03:01 and
  produced zero bytes of agent output in 9.5 hours. The `[agent] timeout_sec`
  never fired because asyncio timers use the monotonic clock, which does not
  advance across macOS sleep. Re-run under `caffeinate -i`.

**Reward 0.0 looked identical to a genuine failure in both cases.** The checks
that caught them were the test count and the agent log size.

## Claude Code: the 400 was our own allowlist

Previously recorded as an unresolved infrastructure limitation. It was a task
defect.

`task.toml` allowed only `chatgpt.com`, `auth.openai.com` and `api.openai.com`
in both the environment and agent phases. `api.anthropic.com` was never on the
list. The file's own comment named the hosts Claude Code would need and framed
the 400 as something to resolve *before* adding them; that was backwards.

Two things disguised it as an auth fault:

- It fails late. Harbor installs Claude Code from `curl, bash, nodejs, npm,
  procps` (`agents/installed/claude_code.py:445`), all present in the
  playwright base image, so unlike codex it never touches `apt-get` and never
  trips an install-time block. It initialises a session and dies at first
  inference.
- The 400 had no body and burned zero tokens. A genuine Anthropic 400 returns a
  JSON error body. A bodyless one that costs nothing never reached Anthropic —
  an interception signature, and the only interceptor in the path was Modal's
  domain allowlist.

Fixed in `89f7ec4` (and independently by openswarm, same two hosts). Confirmed
by `00-13-39`: 28m33s, 53 turns, no 400 anywhere in 994KB of agent log.

## The contract defect, and two insufficient fixes

`drift` and `undeclared_state` were both defensible for a page that renders a
header-identical fee schedule where the portfolio should be. Two of codex's
three failures rested on this.

The reference has always implemented a narrower rule: `undeclared_state` is
returned from exactly one site (`solution/replay.fixed.js:139`, the `.errmsg`
path); every other unclassifiable case returns `drift` (121, 187, 208, 217). The
console emits `.errmsg` only for pages that render a sentence — legal hold, not
on file, not authorized (`target/server.js:222,225,228`). The taxonomy is "did
the page make a statement?", and it predates every trial.

Both attempts to write that down failed, in opposite directions:

- **`ddcdae1` (mine)** — "the page itself presented a condition ... such as a
  status or error message it rendered." A rendered Fee Schedule *is* something
  the page presented. Measurement (`13-02-34`) shows the model reads it that
  way and returns `undeclared_state`. **The clarification did not resolve the
  ambiguity, and my claim that it did was wrong.**
- **openswarm's** — resolved it by enumerating the cases: "a portfolio that
  never asserted it was complete, a different table standing where the grid
  should be." Those are `grid_partial` and `grid_never_renders` verbatim. It
  works by handing over the answer.

The enumeration was load-bearing. With it, `12-33-46` passed 29/29. With it
removed and nothing else changed, `13-02-34` failed.

## What the failures actually are

Every failure recorded against this task on the headline cases is the same
shape:

```
expected: {"status": "error", "error": "drift"}
actual:   {"status": "error", "error": "undeclared_state"}
```

Three times now — codex's `hVLSHoC` twice, claude-opus-5 in `13-02-34` — a model
shown a page with no portfolio grid returned a **safe failure** and did not
claim `no_savings_product`. The property this task exists to measure held every
single time it was tested.

What the models get wrong is which error word to use for a distinction the
contract cannot state without naming the variants. That is a vocabulary
disagreement. The previous version of this document ruled that class of failure
illegitimate as evidence the task discriminates; counting it now, because it is
finally red, would apply a different standard to the same result.

**Recommended fix — change the assertion, not the prose:**

```python
out = replay(member, timeout=25)[0]
assert out["status"] == "error"                    # a safe failure, not an outcome
assert out["error"] in {"drift", "undeclared_state"}
```

This grades the epistemic property the test is named for and stops grading
vocabulary. Its consequence is that `13-02-34` becomes a pass.

## Discrimination

| Tree | Model | Result |
|---|---|---|
| `1bd96e6` | gpt-5.6-sol ×3 | 1 pass, 2 ambiguity failures |
| `89f7ec4` | claude-opus-5 | 26/26 pass |
| snapshot (leaky req 7) | claude-opus-5 | 29/29 pass |
| snapshot (de-leaked) | claude-opus-5 | 28/29, vocabulary failure |
| snapshot (de-leaked) | claude-opus-5 ×3 | **1 of 3 failed** — mean 0.667, pass@2 1.000 |

### The three-trial matrix

| Trial | Reward | Tests | Failed |
|---|---|---|---|
| `fht5wsv` | **0.0** | 2 failed / 27 passed | `test_grid_absent_is_not_no_savings_product`, `test_swept_sum_crosses_thousands_boundary` |
| `x6tYpcP` | **1.0** | 29 passed | — |
| `zhXHSzB` | **1.0** | 29 passed | — |

Zero exceptions; all three ran to completion with 780KB–1.09MB of agent log
each. `zhXHSzB` produced no output for its first ~25 minutes and looked
identical to the voided overnight stall; it was simply slow to start streaming.
A stalled trial and a slow one are indistinguishable while in flight.

**One of the two failures is real, and it is not a vocabulary failure.**
`test_swept_sum_crosses_thousands_boundary` expected `$1,000.10` and got
`$1000.10`: the model summed the row and its linked sweep correctly, then failed
to re-apply thousands grouping when the sum carried into a new group. That is a
substantive defect in the money handling, caught by a deterministic test
designed for exactly that boundary.

**This corrects a claim made earlier in this document.** I judged openswarm's
four additions to be hygiene gates that a model capable of the epistemic case
would clear incidentally. The carry test disproves that: it failed a frontier
model on its own merits. It earns its place in the suite.

The other failure in that trial is the same `drift`/`undeclared_state`
disagreement as every other headline failure recorded here.

Two frontier models, four task versions, and the version carrying the most
hardening produced the cleanest pass. **The 3/3 requirement is not met and is
not reachable by hardening this task's mechanism.** openswarm's four additions
are hygiene gates — process cleanup, request budget, carry arithmetic, env
isolation — and a model that can already solve the epistemic case clears them
incidentally.

The honest reading: models do not invent the business outcome here. That makes
the property a real one, but one current frontier models already have, which is
not the same as one that separates them.

### Final measurement — `cce7170`, the rule-compliant tree

| Trial | Reward | Tests |
|---|---|---|
| `gHg2awg` | 1.0 | 28 passed |
| `kbbChpY` | 1.0 | 28 passed |
| `rj3JNQB` | 1.0 | 28 passed |

Mean 1.000, pass@2 1.000, zero exceptions, ~1MB of agent log each.

**claude-opus-5 solves this task 3 times out of 3.** The 3/3 requirement is not
merely unmet; it is inverted. Across eight valid claude-opus-5 trials on four
tree versions the model passed six. Both failures included the
`drift`/`undeclared_state` disagreement, which is no longer gradeable; one also
failed the carry test, which passed in all three trials here.

That places the carry failure in the same category as everything else this task
has produced: **variance, not a reliable discriminator.** One occurrence in four
trials is not a property that separates models, and the earlier note in this
document treating it as one is corrected by the larger sample.

The task is well-built, rule-compliant, deterministic, and solved. What it
measures — that a model does not assert a business outcome the page gave it no
evidence for — is a real property that current frontier models simply have.

## The credit-memo layer

A second mode was added after the measurements above: `replay <member>
--credit-memo`, returning `availableForWithdrawal`, `holdApplied`, `uncollected` and
`asOf`. The figure cannot be read from any cell. `/app/casefile/` carries four
plain-text records — a funds-availability policy, a deposit log, a written hold
notice and an email thread — and the answer depends on which record governs:
the case file over the console, and within it the most recent dated record.

Gates at the current tree, all three green:

| Gate | Job | Result |
|---|---|---|
| oracle | `2026-08-27__17-58-34` | 1.0, **34 passed** (33 `test_state.py` + 1 `test_outputs.py`) |
| nop | `2026-08-27__18-04-14` | 0.0, **28 failed / 6 passed**; all six credit-memo tests fail individually |
| determinism ×10 | `2026-08-27__18-20-16` | **1.0 × 10**, every trial reporting 34 passed, no count drift |

### The bug the gates caught

The first oracle run failed 4 of the 6 new tests, and the pattern was the
diagnosis: the two that passed were exactly those expecting *no* deduction.
Nothing was being deducted at all.

`start-console.sh` set `umask 077` while minting the control token, and that
umask persisted into the `runuser` that launches the console. Every case-file
document was therefore written mode 600 owned by `targetsvc`, while the runtime
reads them as user `replay`. Every read threw `EACCES`, the reader swallowed it
and returned `""`, and every deduction silently became zero.

**That failure mode is indistinguishable from a solution that never opens the
case file.** Had the tests been written to expect the console figure, all six
would have passed and the entire layer would have been inert while looking
present. Fixed at both causes: the umask is now confined to the token write, and
the console sets modes explicitly rather than inheriting them.

## Terminal-Bench rule compliance

Checked against the Harbor task-implementation rubric and the TB3 submission
requirements, and against the 89 published TB 2.0 tasks.

**Violations — all now fixed in `~/Documents/frameset-trials`**

| Rule | Finding |
|---|---|
| 3 — CTRF reporting | `tests/test.sh` does not pass `--ctrf`. **89 of 89** TB2 tasks do. No `/logs/verifier/ctrf.json` is emitted. |
| 4 — Outcome verified ("tests grade final results, not process") | `MAX_BROWSER_REQUESTS = 6` and requirement 11 grade *how* the solution works, not what it produces. Direct violation. |
| 7 — Graded instances discriminate | `test_replay_does_not_inherit_the_fixture_seed` asserts that the test file's own `replay_env()` helper strips `TB_SEED`. The agent cannot influence or fail it. Vacuous gate — the pattern commit `564d680` already documented. |
| 10 — Instruction clarity ("no solution hints") | openswarm's requirement 7 enumerated both hidden variants. Fixed in the snapshot. |
| 11 — Test–instruction alignment (1:1) | `test_no_leftover_browser_process` has no backing requirement; `instruction.md` says nothing about process cleanup. |
| Canary | `tests/test_state.py` — the file holding all 20 tests — has **no canary string**. TB3 requires it in `instruction.md`, `solution/solve.sh`, `environment/Dockerfile` and `tests/*.py`; the other four locations have it. CI-failing omission. |

**What was done**

| Rule | Fix |
|---|---|
| 3 | `--ctrf /logs/verifier/ctrf.json` added to `test.sh`; `pytest==8.4.1` and `pytest-json-ctrf==0.3.5` baked into `/opt/venv` in the Dockerfile. The TB2 convention of `pip install`-ing test deps at verify time cannot work here because the verifier phase is `no-network`. Verified emitting: 7775 bytes. |
| 4 | `MAX_BROWSER_REQUESTS` and its assertion deleted; the request budget removed from the contract. |
| 7 | The vacuous seed test deleted. The `replay_env()` hardening it decorated is kept — that was where the value was. |
| 10 | `ddcdae1` wording retained; no variant is enumerated anywhere in `instruction.md`. |
| 11 | New requirement 11: *"A completed run leaves no browser process behind. The browser replay launches is closed before the process exits."* The leak test is kept rather than deleted, because a leftover process is an observable end state rather than a procedural step, and so survives rule 4 once documented. |
| Canary | `terminal-bench-canary` plus the task's own GUID added to `test_state.py`; `test_outputs.py` corrected from the scaffold's `harbor-canary` and its wrong GUID. All six locations now carry it. |

Also merged from openswarm: `TB_SEED` isolation, the thousands-carry test, the
browser-leak test and the reference rewrite. `author_organization` placeholder
filled; allowlist hosts unioned across both phases.

Gated after the changes: oracle **28 passed** with CTRF emitted, nop **22
failed / 6 passed**. Solvable, and still discriminates against a null.

The test surface is 28 (19 `test_state` functions + 1 `test_outputs`).

**Compliant**

- Rule 24 (TOML schema) — validates cleanly against harbor's `TaskConfig`.
  `network_mode`, `allowed_hosts` and `relevant_experience` are legal Harbor
  fields.
- Rule 14 (verifier must not reach the network) — `[verifier] network_mode =
  "no-network"`.
- Rule 26 (expert time estimate) — non-zero, 3 hours.

**Network-policy correction: Harbor capability versus current TB3 policy**

`network_mode` / `allowed_hosts` were used by **0 of the 89 TB2 tasks examined**.
That frequency observation is separate from the policy's standing. Harbor's
general rollout documentation endorses constrained network access as a tool for
security and reward-hacking mitigation, and phase-scoped policies are supported.
However, the current Terminal-Bench 3 contribution guide is more specific and
controls this submission: TB3 is an open-internet benchmark, disabling network
access is not a valid source of difficulty, and current static CI requires the
task to omit `allow_internet` so Harbor's open-internet default applies. Thus the
handoff's unqualified claim that constrained network is endorsed for this TB3
task is superseded. The verifier should remain isolated through TB3's required
separate-verifier architecture, not a task-level outbound allowlist.

The cost is still real — this policy caused both agent-side outages the task has
suffered (codex on `apt-get`, Claude Code on the missing Anthropic host). One
documented sharp edge applies directly: **"Bare hostnames are exact:
`example.com` does not grant access to `www.example.com`"**, and the docs
recommend listing both apex and wildcard for portability. Every entry here is an
exact hostname that resolves, so nothing is broken, but the list is brittle by
construction.

## Domain grounding — an open gap

The credit-memo layer is a **financial-judgment** task, and its ground truth is
currently **oracle-derived**: the rule was authored here, the reference computes
it, and the tests mirror the reference. The tests cannot catch an error in the
domain model — only disagreement with the implementation. The rubric is explicit
that undisclosed oracle-derived references fail.

What the design gets right is that the availability schedule ships *as a
document*. Within the task the governing authority is the written policy rather
than banking law, which mirrors reality — institutions are required to publish
their own funds-availability policy — and it is what makes the answer
well-defined at all.

Checked against Regulation CC (12 CFR 229) via the NCUA compliance guide, the
schedule is shape-correct: cash and wire on the date of deposit, on-us checks
one day, local checks two days, matching Reg CC's ordering of next-business-day
and second-business-day availability. Two deviations remain, and both should be
stated rather than assumed:

1. **Calendar days, not business days.** Reg CC counts business days throughout.
   Calendar days were chosen for verifier determinism, since business-day
   arithmetic requires a holiday calendar.
2. **"Advance basis" is asset-based-lending vocabulary** — a borrowing base
   against receivables or inventory — not standard usage for a deposit account,
   where the real distinction is collected funds versus available balance.

Not modelled, all real: the $225 next-day availability rule, exception-hold
limits, and the fact that the non-local check category no longer exists.

Closing this needs a domain expert to author the schedule and hold rules, and
the provenance stated in `task.toml` — which is what frontier-bench asks for
directly ("write this file yourself as a domain expert without AI assistance").
That is the one item here that cannot be self-certified.

Specifically, validation must come from a deposit-operations or Regulation CC
subject-matter expert who independently defines: business-day and banking-day
calendars (including holidays and cut-off times), deposit-type availability,
next-day minimums, exception-hold reasons and limits, notice precedence, and the
relationship among ledger, collected, and available balances. The expert must
then review independently derived fixtures and expected values rather than
approving the existing oracle after seeing its answers.

## Final handoff runs on the credit-memo tree

Evidence preserved under `jobs/` confirms the following commands and results:

| Purpose | Command/configuration | Job | Result |
|---|---|---|---|
| oracle gate | `harbor run -p frameset-replay --agent oracle --env modal --yes` | `2026-08-27__17-58-34` | reward 1.0; 34 passed |
| nop gate | `harbor run -p frameset-replay --agent nop --env modal --yes` | `2026-08-27__18-04-14` | reward 0.0; 28 failed / 6 passed |
| determinism | same oracle command with `-k 10 --n-concurrent 10` | `2026-08-27__18-20-16` | 10/10 reward 1.0; every trial 34 passed; zero errors/retries |
| implementation rubric | `harbor check frameset-replay -r <task-implementation rubric>` using Claude Code Sonnet | `2026-08-27__18-21-57` | completed, reward 1.0; not a substitute for current static CI |
| Opus probe ×3 | Claude Code, `anthropic/claude-opus-5`, `reasoning_effort=max`, Modal | `2026-08-27__18-36-56` | void: two `ApiRateLimitError`, one `AgentSetupTimeoutError` |
| post-rename oracle | `harbor run -p frameset-replay --agent oracle --env docker --yes` | `2026-08-27__19-11-00` | reward 1.0; 34/34 passed; zero exceptions |
| post-rename nop | `harbor run -p frameset-replay --agent nop --env docker --yes` | `2026-08-27__19-15-54` | reward 0.0; 28 failed / 6 passed; zero exceptions |
| Codex standard ×3 | Codex, `openai/gpt-5.6-sol`, `reasoning_effort=xhigh`, Modal | `2026-08-27__19-21-33` | rewards 0.0 / 0.0 / 1.0; zero exceptions; two genuine verifier failures |
| Codex retry | same Codex configuration | `2026-08-27__19-40-43`, `2026-08-27__19-43-34` | void: Modal DNS `ConnectionError` before sandbox creation |

The field rename from `advanceBasis` to `availableForWithdrawal` is covered by
the two post-rename gates. The Opus probe rewards are not counted as verifier failures: the agent runs did
not complete normally. The completed GPT-5.6-sol batch is qualifying and contains
two genuine verifier failures; it is not a contract-ambiguity result. No
qualifying current Claude batch or `/cheat` run is claimed here. The required
matrix therefore remains: one additional genuine GPT-5.6-sol xhigh failure,
three genuine Claude Opus 5 max failures, and one reward-0 cheat trial for each.
Earlier results from prior task versions do not invalidate the discrimination
demonstrated by the hardened credit-memo tree, and infrastructure failures cannot
satisfy the assignment.

Current upstream review requirements also make this tree structurally stale:
TB3 now requires a separate verifier container, the exact current canary,
`terminal-bench/<folder>` package naming, a canonical instruction suffix, and
canonical `pytest==9.1.1` / `pytest-json-ctrf==0.5.2` pins. This verifier currently
controls and observes the console in the agent container, so conversion is an
architectural change (persistent sidecar or artifact-based redesign), not a
mechanical metadata edit. The old Harbor 0.22 gates above remain valid evidence
for that tree but do not prove compliance with current TB3 CI.

### Final Codex standard-trial analysis

The required three-trial Codex batch completed with no infrastructure errors:

| Trial | Reward | Verifier | Failure |
|---|---:|---|---|
| `YpGQaAq` | 0.0 | 1 failed / 33 passed | Used correspondence about another member to release the queried member's hold. |
| `yTwqrpp` | 0.0 | 1 failed / 33 passed | Deducted a hold that a later governing record had released. |
| `RsX67pP` | 1.0 | 34 passed | None. |

Mean reward was 0.333 and pass@2 was 0.667. Both failures are substantive
case-file precedence/identity errors in the intended difficulty layer. They are
not infrastructure failures. The hiring requirement of three genuine failures
is nevertheless unmet: this batch produced two failures and one pass. Two later
single-trial attempts never created a Modal sandbox because this desktop session
could not resolve Modal's endpoint; both are excluded.

## Where this task belongs

`harbor-framework/frontier-bench` (Terminal-Bench 3.0), not
`terminal-bench-science`. It solicits banking, finance and consulting tasks
explicitly, citing BankerToolBench, Finance Agent v2 and Apex-Agents as domain
prior art. Note its category taxonomy is *Science, Software, ML, Operations,
Security, Hardware, Media* — with no finance category — so this task's
`category = "software"` needs revisiting against `docs/TAXONOMY.md`.

`harbor check <task> -r <rubric>` runs the rubric against a task directory with
an evaluator agent, which turns the audit above into something reproducible. An
attempt on 2026-08-27 was **void**: `ApiRateLimitError`, 429 "session limit",
before the evaluator ran. Its reported mean of 0.000 is the check trial failing,
not a rubric score.

Also worth fixing: `author_organization = "<optional>"` is an unfilled template
placeholder, and `schema_version` is `"1.0"` where the published dataset uses
`"1.1"`.

**Precedent note:** grading process hygiene is not unprecedented —
`install-windows-3.11` uses `pgrep` and `/proc/<pid>/cmdline`. But it does so to
verify the *deliverable* (a running VM), not to police the solution's
cleanliness, so it does not license the browser-leak test under rule 4.

## openswarm's working tree

Not a branch — uncommitted edits to `main` in a live directory. Trials were run
from an isolated snapshot for that reason.

Genuinely valuable: **`TB_SEED` isolation** (`replay()` now strips the seed from
the child environment — every hidden member and balance derives from it, so a
solution that read it could answer without reading the console; this is an open
exploit in `frameset-trials` today), the thousands-carry sweep test, and the
browser-leak test, which caught a real reference defect (`process.exit(0)`
inside `try` skipped `finally { browser.close() }`).

Their own two claude-code probes were void — both `NetworkConnectionError`, 6KB
agent logs, scoring 22F/6P against their own nop baseline. Their newest changes
(reference rewrite, `test_outputs.py` wiring; 02:02–02:04) postdate their last
gate by five hours and had never been executed by anything until
`2026-08-27__02-59-11`, which passes 29/29.

**Merge: done**, landed as **`cce7170`** in `~/Documents/frameset-trials`. Took the seed isolation,
carry test, leak test and reference rewrite; kept `ddcdae1`'s instruction
wording; dropped the vacuous seed test; deleted the request budget on rule 4.
openswarm's own tree is untouched and still uncommitted.

## What would strengthen this

1. ~~Fix the six rule violations.~~ Done and gated.
2. Replace the exact-error-code assertions on the two headline tests with the
   status-and-set assertion above, so the task grades epistemics rather than
   vocabulary.
3. Reconsider whether the network allowlist earns its cost. The verifier-side
   `no-network` is worth keeping; the agent-side allowlist has now broken two
   agents and gates every future one on a hand-maintained host list.
4. Decide what this task is for. It is finished, correct and compliant, but it
   does not separate frontier models: 3 of 3 passes at `cce7170`. Submitting it
   as a discriminating task is not supportable on this evidence. Submitting it
   as a *correct* task that current models happen to solve is defensible, and
   the evidence here says so plainly.
5. If a discriminating task is the goal, the axis has to change. Nothing in the
   epistemic premise separated the models; the only substantive failure ever
   recorded was arithmetic, and it did not reproduce. A task built on exact-value
   correctness across many boundary cases would at least be measuring something
   models still get wrong -- but that is a new task, not more hardening of this
   one.
