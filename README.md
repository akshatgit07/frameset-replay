# frameset-replay

A Terminal-Bench task. An agent repairs a deterministic browser-replay runtime so
that it extracts an account balance from a hostile legacy frameset console, never
reports a business outcome the page gave it no evidence for, and reconciles the
console against the member's written case file to produce a credit memo.

> **The current task produced two genuine frontier-model failures in the completed
> three-trial `gpt-5.6-sol` batch.** Both were substantive case-file
> precedence/identity errors in the intended credit-memo difficulty layer; they
> were not infrastructure failures or contract-ambiguity failures. Earlier Claude
> results came from prior task versions and must not be used to erase the signal
> introduced by the later hardening. The full required acceptance matrix is still
> incomplete: the Codex batch yielded two failures rather than the required three,
> and the current Claude batch was blocked before valid verifier results were
> produced. The full evidence, including every void run and the reasoning, is in
> [`ANALYSIS.md`](ANALYSIS.md). Read that before deciding what to do with this task.

## What it measures

Not browser automation. The environment **underdetermines the solution**: a
locator strategy that satisfies every publicly visible member number still fails
on hidden page variants, and it fails by returning a *plausible wrong value*
rather than by raising.

Two properties, in two modes.

**Balance mode** asks whether a model distinguishes *"the expected content is
absent"* from *"the expected content was never observed."* Those look identical
from inside the runtime and lead to opposite correct actions: a grid that renders
with no active `SAVINGS` row means the member genuinely has no savings product;
a grid that never renders means nothing is known, and claiming
`no_savings_product` there is a confident wrong answer about a real account.

**Credit-memo mode** (`--credit-memo`) moves the difficulty off the page. The
amount available for withdrawal cannot be read from any cell: it depends on which written record
governs. `/app/casefile/` holds a funds-availability policy, a deposit log, a
written hold notice and an email thread. Answering requires deciding that a local
check inside the availability window is not yet collected, that a hold whose
expiry has passed no longer binds, that a later email releasing a hold displaces
the notice that placed it, and that an email about a different member displaces
nothing. The documents state their facts without stating their precedence.

Verification is seeded: member numbers, balances, hold and deposit amounts are
generated at verification time from `TB_SEED`, which the container never sees and
which is stripped from the runtime's environment, so no expected value exists on
the agent's disk. The console and artifact are checksummed at build time and
re-verified before grading, so the task cannot be passed by de-hostiling the app.

## Reproducing the gates

Run from this directory. Requires `harbor` and a configured `modal` environment.

```bash
# Broken runtime must score 0 — and must fail for real reasons.
harbor run -p frameset-replay --agent nop --env modal --yes

# Reference solution must score 1.0 with every test passing.
harbor run -p frameset-replay --agent oracle --env modal --yes

# Determinism: 10 concurrent oracle trials, all 1.0.
harbor run -p frameset-replay --agent oracle --env modal --yes -k 10 --n-concurrent 10
```

Each writes to `jobs/<timestamp>/`. The numbers that matter are in
`jobs/<timestamp>/frameset-replay*/verifier/pytest.log`, `.../verifier/reward.txt`
and `.../verifier/ctrf.json`.

**Reward 0 is not by itself evidence of anything.** It is equally consistent with
"the verifier never ran," and that has happened repeatedly here — an API quota
exhaustion and an overnight host sleep both produced reward 0 from trials where
the agent never executed. Three checks separate a real result from a void one,
and each has caught a real incident:

- The `pytest.log` must contain real assertion failures. Empty, truncated, or
  error-only means a broken harness, not a failing agent.
- The **test count** must match the oracle run taken immediately before. A
  differing count means the task changed underneath the trial.
- The agent log must be substantial. A void run leaves kilobytes where a real one
  leaves megabytes.

A trial graded against a directory someone else is editing is void. Run from an
isolated clone.

## Where the evidence lives

| File | What it holds |
|---|---|
| [`ANALYSIS.md`](ANALYSIS.md) | Every trial, valid and void; the difficulty finding; the Terminal-Bench rule audit and what was fixed |
| [`RESULTS.md`](RESULTS.md) | Gate results and the determinism sweep, with per-trial detail |
| `jobs/` | Raw harbor artifacts behind both |

## Layout

```
frameset-replay/
├── instruction.md          agent-facing contract
├── task.toml               harbor task config
├── environment/
│   ├── Dockerfile          playwright base; console + broken runtime
│   └── app/
│       ├── target/         the hostile console (checksummed, do not modify)
│       ├── casefile/       per-fixture written records (read-only)
│       ├── src/replay.js   the broken runtime the agent repairs
│       ├── bin/replay      CLI: replay <member> [--credit-memo]
│       └── artifacts/      the workflow contract from an earlier discovery run
├── solution/               reference fix + oracle solve script
└── tests/                  seeded verifier
```

`RESULTS.md` and `ANALYSIS.md` are kept at this level rather than inside
`frameset-replay/` so the packaged task carries no solution commentary.
