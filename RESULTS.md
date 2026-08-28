# frameset-replay — validation results

Task: `frameset-replay/` (Terminal-Bench 3, harbor 0.22.0, `--env modal`).

## Runs

| # | Command | Trials | Reward | Job |
|---|---------|--------|--------|-----|
| 1 | `harbor run -p frameset-replay --agent nop --env modal --yes` | 1 | **0.0** *(pre-fix; console dead, 13F/4P)* | `jobs/2026-08-26__02-20-57` |
| 2 | `harbor run -p frameset-replay --agent oracle --env modal --yes` | 1 | **0.0** *(pre-fix; console dead, 13F/4P)* | `jobs/2026-08-26__02-22-36` |
| 3 | `harbor run -p frameset-replay --agent oracle --env modal --yes` *(diagnostic)* | 1 | — *(cancelled; confirmed `ERR_CONNECTION_REFUSED`)* | `jobs/2026-08-26__02-24-02` |
| 4 | `harbor run -p frameset-replay --agent oracle --env modal --yes` | 1 | **1.0** — 17 passed | `jobs/2026-08-26__02-37-30` |
| 5 | `harbor run -p frameset-replay --agent nop --env modal --yes` | 1 | **0.0** — 7 failed / 10 passed | `jobs/2026-08-26__02-39-49` |
| 6 | `harbor run -p frameset-replay --agent oracle --env modal --yes -k 10 --n-concurrent 10` | 10 | **1.0 × 10** (mean 1.000, pass@10 1.000) | `jobs/2026-08-26__02-40-32` |

Runs 4–6 are the authoritative gates; runs 1–3 are the pre-fix baseline retained
for the record.

### Determinism sweep (run 6)

All 10 concurrent trials reported `17 passed`:

| Trial | Reward | Tests |
|-------|--------|-------|
| `frameset-replay__3PoMGHP` | 1 | 17 passed |
| `frameset-replay__5K7BWV2` | 1 | 17 passed |
| `frameset-replay__6RCZD76` | 1 | 17 passed |
| `frameset-replay__CTaGKBv` | 1 | 17 passed |
| `frameset-replay__DpbaGzi` | 1 | 17 passed |
| `frameset-replay__iXKsaBV` | 1 | 17 passed |
| `frameset-replay__JKxeQnn` | 1 | 17 passed |
| `frameset-replay__NXQ5jaT` | 1 | 17 passed |
| `frameset-replay__r4GPGXT` | 1 | 17 passed |
| `frameset-replay__u2HQgDC` | 1 | 17 passed |

No nondeterminism observed; no retries were needed.

## Verifier discrimination

The verifier separates the broken runtime from the repaired one cleanly:

| Runtime | Result | Split |
|---------|--------|-------|
| Broken (`environment/app/src/replay.js`, nop agent) | reward 0.0 | **7 failed / 10 passed** |
| Repaired (`solution/replay.fixed.js`, oracle agent) | reward 1.0 | **17 passed** |

The 7 tests that fail only against the broken runtime:

| Test | What it pins down |
|------|-------------------|
| `test_balance_under_variant[column_shifted]` | balance column resolved by header text, not index |
| `test_balance_under_variant[hidden_dupes]` | non-visible rows must not be read |
| `test_savings_plus_does_not_match` | `SAVINGS PLUS` is not `SAVINGS` — exact cell match, not substring |
| `test_closed_savings_does_not_match` | row selected by its own status cell, not by position |
| `test_two_active_savings_is_ambiguous` | a must-be-one target resolving twice fails as `ambiguous` |
| `test_grid_absent_is_not_no_savings_product` | unobserved ≠ absent; no declared outcome without evidence |
| `test_undeclared_state_not_claimed_as_outcome` | `legal_hold` reported as `undeclared_state`, never as a declared outcome |

The 10 tests the broken runtime already passes are the integrity, gating,
privacy, and easy-variant cases (`test_console_unmodified`,
`test_draft_artifact_refused`, `test_no_sensitive_values_in_evidence`,
`test_genuine_no_savings_product`, and the `plain` / `reordered` /
`rows_inserted` / `ids_regenerated` / `dup_balance_text` /
`decoy_outside_grid` variants) — they do not discriminate on their own,
which is what makes the 7 above the real signal.

## Fixes applied during validation

Two rounds. Round 1 was done in an earlier session where Docker's daemon was
hung locally, so its fixes were validated against `tests/test_state.py` running
against a local `server.js` mirror but **never built as an image**. Round 2 is
this session, running real `harbor` gates on modal.

Round 1 details are reconstructed from that session's transcript and
cross-checked against the job artifacts in `jobs/`; each claim below notes what
corroborates it. Where nothing corroborates a claim, it is marked as such.

### Round 1 — task defects (earlier session, no image build)

1. **The artifact shipped as `draft`.**
   `environment/app/artifacts/savings-lookup.json` had
   `"approvalState": "draft"`. Both runtimes check approval *before* launching a
   browser, so the oracle aborted in ~9s without ever opening one.
   *Corroborated:* `jobs/2026-08-26__00-50-48/frameset-replay__dPotYVh/agent/oracle.txt`
   contains exactly `{"status":"error","error":"not_approved"}`.
   `test_draft_artifact_refused` sets `draft` itself and restores the original in
   a `finally`, so the shipped value must be `approved`. Now `approved`.

2. **`tests/test.sh` bootstrapped its toolchain over the network — under
   `network_mode = "no-network"`.** It curled `astral.sh` for `uv`, which cannot
   resolve, so `pytest` was never installed and **not a single test ran** in
   either gate.
   *Corroborated:* `verifier/pytest.log` in both `jobs/2026-08-26__00-39-11`
   (nop) and `jobs/2026-08-26__00-50-48` (oracle) is 51 bytes, containing only
   `/tests/test.sh: line 20: pytest: command not found`. Both scored reward 0.
   The nop gate therefore *appeared* to pass while proving nothing — see the
   pattern note below.
   Round 1 fixed this from the Dockerfile (baking `uv` in and priming its cache
   offline) because `tests/` was off limits at the time. That machinery was never
   built successfully — see round 2, item 1.

3. **A real race in the reference solution.** `replay.fixed.js` did
   `field.press("Enter")` then `page.waitForLoadState("networkidle")`, which
   waits on the **frameset's main frame** — long since loaded. The read could
   land while the workspace frame still showed the search form: no errmsg, no
   grid, `drift`. It surfaced as an intermittent
   `test_balance_under_variant[plain]` failure and was reproduced deterministically
   by serving `/lookup` with a 1.2s delay (3/3 `drift`). This mattered beyond
   flakiness: `instruction.md` promises hidden variants that vary "the timing with
   which its frames finish loading," so the reference would have failed the hidden
   set outright.
   The read phase now waits on the frame that is actually navigating
   (`field.ownerFrame().waitForNavigation()`) and then polls for a *classifiable
   surface* rather than a load event, discarding and retrying reads that throw on
   a swapped frame — which is also what requirement 8 asks for.
   *Corroborated:* `solution/replay.fixed.js:145-159` implements exactly this;
   no `networkidle` remains in the file.

   Minor, same round: `solve.sh`'s smoke check was `node -e "require(...)"`, which
   silently executed a full replay run with `member === undefined` — now
   `node --check` (*corroborated:* current `solve.sh`). `task.toml` described the
   solution as "~300 lines of TypeScript" when it is ~170 lines of JavaScript
   (*corroborated:* current `task.toml`). Stray `.DS_Store` files and a
   brace-expansion artifact directory were removed (*not independently
   verifiable now*).

### Round 2 — harness defects (this session, real gates on modal)

1. **Stale `uv` bootstrap comment block in `environment/Dockerfile`.** The
   round-1 uv machinery was gone but its explanatory comment remained, describing
   a mechanism no longer present. The verifier toolchain is now the baked-in venv
   (`/opt/venv`) with `pytest`; `tests/test.sh` calls `/opt/venv/bin/pytest`
   directly and exports `TB_SEED`. Comment removed.
   *Note:* `jobs/2026-08-26__01-57-44` and `jobs/2026-08-26__02-04-20` are both
   **image build failures** (`Image build for im-… failed`), consistent with the
   uv approach failing to build — but modal no longer retains those build logs,
   so the causal link is inference, not evidence.

2. **Console startup — the bug that made the gates meaningless.** The console was
   started by `CMD ["/usr/local/bin/start-console.sh"]`. Harbor replaces the
   image's `ENTRYPOINT`/`CMD` with its own keepalive (`sleep infinity`) — see
   `harbor/environments/modal.py:285-296`, a convention shared with the docker,
   apple_container and islo environments — so the console never started.
   Every replay hit `ERR_CONNECTION_REFUSED` and fell into the `main().catch()`
   handler, returning `{"status":"error","error":"drift"}` for every member.
   *Corroborated:* a diagnostic run (`jobs/2026-08-26__02-24-02`) showed no node
   process, `curl` to port 8080 refused, and
   `page.goto: net::ERR_CONNECTION_REFUSED`.
   That made the oracle indistinguishable from nop — **both 13 failed / 4
   passed** — masking the verifier's real 7/10 discrimination.

   `environment/app/start-console.sh` is now an idempotent launcher: it returns
   immediately if port 8080 is listening, otherwise takes a `flock`, starts
   `node /app/target/server.js`, and polls the port until it binds (no fixed
   sleep). `environment/app/bin/replay` invokes it before exec'ing the runtime,
   so the console is guaranteed up for both the agent and the verifier
   regardless of how the harness starts the container. `bin/replay`'s CLI
   interface — `replay <member-number>` → one JSON line on stdout — is
   unchanged. The image `CMD` is retained for standalone `docker run`.

### Pattern: gates that pass for the wrong reason

Two of these four defects — round 1 item 2 and round 2 item 2 — share a shape
worth naming, because both produced **plausible-looking gate results that were
entirely uninformative**:

| | Round 1: network bootstrap | Round 2: CMD override |
|---|---|---|
| What the gate showed | nop reward **0** ✓ | nop reward **0** ✓ |
| Why it was actually 0 | `pytest` never installed; no test ran | console never started; every member returned `drift` |
| What it proved about the task | nothing | nothing |
| How it was caught | `pytest.log` was 51 bytes | oracle produced the *same* log as nop |

In both cases the headline number was exactly what a healthy task produces. A
nop gate is a one-sided test: reward 0 is consistent with "the verifier
discriminates" *and* with "the verifier never ran." Neither is distinguishable
from the reward alone.

The two checks that actually caught them generalise:

- **Read the verifier log, not just the reward.** A nop run must fail with real
  assertion failures. An empty, truncated, or error-only `pytest.log` under
  reward 0 is a broken harness, not a passing gate.
- **Require the oracle and nop logs to differ.** Identical failure sets across
  two runtimes that should behave oppositely means the environment is broken
  upstream of both. This is what exposed the CMD override: 13F/4P from the
  reference solution is not a solution failure, it is an environment failure.

A third, weaker signal: wall-clock. The oracle failing in 22s when the runtime's
own settle budget is 15s per call meant it was aborting early, not searching and
failing.

No changes were made to `tests/test_state.py`, `instruction.md`, or
`environment/app/src/replay.js` in either round.
