# Wharfie checkpoint — workflow crash recovery

- **Date:** 2026-07-19
- **Status:** **COMPLETE — implementation and exact post-change validation are
  recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `d3618879bd9a8d9e981b76fde2add7ff91b3a03c`
- **Implementation receipt:** `6213bbc1f090abda327f8f690c451adba78dcc14`
- **Parent checkpoint:** [public workflow operator
  surface](2026-07-19-v10-public-workflow-operator-surface.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md),
  and [ADR
  0019](../../docs/architecture/decisions/0019-persisted-linear-workflow-continuations.md)

This checkpoint closes the executable proof gap left by V10. Public
activity-only workflows now survive adversarial process death through both the
source runtime and a relocated self-contained executable. The proof preserves
the distinction between a durable logical decision and arbitrary physical user
code: only the logical activation recovered from a prior attempt that stopped
at `CLAIMED` may be dispatched as a fresh attempt and generation. Any attempt
that crossed `STARTED` remains visibly uncertain until independently
trustworthy terminal evidence is reconciled.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v11-workflow-crash-recovery.md`. Work on branch
> `agent/strict-manifest` at or after implementation receipt `6213bbc`. Read
> `PROJECT.md`, `ROADMAP.md`, ADR 0011, ADR 0019, and this checkpoint before
> editing. Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0.
> Work locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Preserve the V10 append-only event authority, exact run-head and
> cursor CAS, immutable payload rehashing, receipt-event-anchored replay,
> generation/fence guards, exact manifest/revision binding, transactionally
> maintained ready-work V2 rows, and the rule that uncertain physical work is
> never silently redispatched or rewritten. The next tranche is cursor-aware
> run-level workflow cancellation and its races with success, uncertainty, and
> evidence reconciliation. After that, implement persisted timers and current
> signal waits before OS service installation and provider-backed single-node
> fulfillment. Keep general cloud IaC, trustless mesh semantics, arbitrary
> workflow-code replay, and backward compatibility outside scope.

## Product direction retained

Wharfie remains a local-first framework for turning a normal TypeScript CLI
with named activities into a portable executable that can remain resident,
carry intent beyond an interactive coding session, and later coordinate work
across trusted machines. One recoverable coordinator is sufficient initially.
Node/TypeScript remains the public boundary while native bindings,
subprocesses, and WASM stay available for measured hot paths. Exactly-once
language applies only to evidence-backed logical decisions and destination
protocols, never arbitrary physical user-code execution.

## Source real-process proof

The new `workflow-crash-source` fixture declares a two-activity linear
workflow. Each physical entry appends and fsyncs a marker before returning the
exact input for the successor; the first file creation also fsyncs its parent
directory. Duplicate first-step dispatch is therefore observable across a
process death.

Five tests deliver real OS `SIGKILL` while deterministic production seams hold
the process at exact persistence or command-output boundaries:

1. Offline public start commits one run and loses its response. The actual
   source CLI retry returns `reused: true` without changing the event, cursor,
   ready row, rebuilt run, or ownership.
2. A resident dies after the workflow claim transaction. Recovery abandons the
   `CLAIMED` generation, restores one runnable locator, and a real public worker
   dispatches only a fresh generation.
3. A resident dies after `STARTED` but before the authored function entry. The
   exact attempt becomes `ABANDONED`, the cursor becomes
   `ACTIVITY_UNCERTAIN`, the run blocks, ready work disappears, and no marker
   is written.
4. A resident dies after the first activity terminal transaction and verified
   readback. The transaction has already retained one output and one second-step
   ready row; restart runs only that successor.
5. A physically completed first step dies before its terminal commit. Generic
   recovery blocks it, exact captured host evidence reconciles it, the
   reconciliation response is lost, and an actual source CLI replay returns
   `changed: false` before a public worker runs only the successor.

The precision children use the real resident worker and shared command
implementations with injected ledger/output observation seams. The OS process
death is real, while output delivery is deterministically suppressed rather
than inferred from a partial pipe write. Actual `bin/wharfie` commands perform
the starts, retries, recovery/reconciliation replays, and final worker
completion.

## Relocated SEA proof

The package verifier's generated application now includes a `workflow-step`
activity and the two-step `portable-linear` workflow. Durable per-step `wx`
markers bind the ordinal, private result, and `process.execPath` to the moved
artifact.

The verifier first creates the workflow through the installed source CLI,
replays the same immutable revision through the relocated packaged command,
and completes it with `<app> wharfie worker`. It then runs isolated public
packaged claim, start, terminal, recovery-response, and
reconciliation-response crash cases. Source-mapped debugger guards forbid
manual activity, developer CLI, and managed-effect dispatch wherever those
paths are not authorized.

Every restart proves a fresh resident lifecycle generation and session. The
claim case retains its abandoned generation byte-for-byte before completing in
generation two. The start case stays blocked through a fresh resident without
executing authored code. The terminal case preserves the first marker and
dispatches only the second step. Recovery and reconciliation are killed after
their mutation ownership has been released but before stdout, and exact public
retries perform no new mutation or dispatch.

All SEA commands run from an environment whose `PATH` contains no Node binary;
the verifier separately confirms that invoking `node` fails with `ENOENT`.

## Trustworthy reconciliation evidence

The SEA verifier does not infer completion from `STARTED` or a missing process.
For the one fixture attempt that durably wrote its complete physical-result
marker, the installed read-only ledger replays the exact
`workflow-activity-started` transition receipt. That replay returns the
ledger-generated original start frame with `applied: false` and
`dispatchAuthorized: false` and is asserted not to change the run, ready work,
or physical rows.

The installed Activity Protocol validator combines that exact start frame with
the independently fsynced result to form the completed transcript supplied to
public reconciliation. The abandoned physical attempt remains byte-identical;
the reconciliation event owns the logical terminal and creates exactly one
successor.

## Exact post-change validation

Implementation receipt `6213bbc` was validated under Node 24.13.1/npm 11.12.0:

- repository-wide ESLint and JavaScript/JSON Prettier checks passed;
- all four TypeScript lanes passed: source, app implementation, tests, and SEA
  verifier;
- the focused source crash suite passed five real-process tests;
- the full Jest coverage run passed 96 suites and 1,492 tests with one
  intentional suite/test skip;
- package-content verification accepted 132 files;
- the native external integration test passed;
- the production dependency audit found zero vulnerabilities;
- the installed and relocated SEA proof passed with Node absent from `PATH`;
  the executable was 145,567,056 bytes; and
- staged and unstaged `git diff --check` checks were clean.

Native LMDB locking, Unix sockets, process signals, the npm advisory endpoint,
and the SEA crash matrix required their normal execution outside the restricted
filesystem/network sandbox. Those approvals were environmental, not code
safety failures.

## Explicitly unsupported

The following remain intentionally unimplemented:

- run-level cursor-aware workflow cancellation and reconciled `cancelled` or
  `deadline-exceeded` workflow activity outcomes;
- timer and signal cursor decisions, ready rows, delivery, and firing;
- workflow activity steps using the framework-owned managed-effect successor;
- retry/backoff policy, schedules, branches, loops, parallel steps, child
  workflows, or workflow migration;
- garbage collection for unreachable content-addressed payloads;
- OS service installation and provider-backed node fulfillment;
- multi-node leases, heartbeats, placement, and coordinator failover; and
- any claim that arbitrary user code physically executes exactly once.

## Ordered next tranche

1. Add cursor-aware run-level workflow cancellation and prove its races with a
   runnable activity, a committed success, and retained uncertainty before
   accepting any cancelled or deadline terminal.
2. Add persisted timers and current-wait signals on the existing cursor and
   run-head transaction boundary.
3. Install the SEA as an OS-managed service and prove boot/restart/status on one
   clean host.
4. Begin the smallest provider-backed single-node fulfillment path before
   multi-node coordination.

## Restart commands

```sh
git status --short --branch
git log -5 --oneline --decorate
. $HOME/.nvm/nvm.sh && nvm use 24.13.1
npm run lint
npm run typecheck
TZ=UTC node ./test/run-jest.js --silent --runInBand \
  test/cli/cmds/ops-workflow-sigkill.test.js \
  test/runtime/execution-ledger-workflow-operator.test.js \
  test/runtime/services/resident-activity-worker.test.js
npm run verify:package:sea
```

The full suite's Unix-socket/LMDB and child-process cases, the native external
test, registry audit, and SEA verifier may need to run outside a restricted
filesystem or network sandbox.
