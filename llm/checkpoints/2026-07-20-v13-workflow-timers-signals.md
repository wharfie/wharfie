# Wharfie checkpoint — durable workflow timers and signals

- **Date:** 2026-07-20
- **Status:** **COMPLETE — implementation and exact post-change validation are
  recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `e5c1d7457319727a881f98130d6abb4fdecdc766`
- **Implementation receipt:** `99cfc3eca7005272c359242875e50ae21884f39c`
- **Parent checkpoint:** [durable workflow
  cancellation](2026-07-19-v12-workflow-cancellation.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md),
  and [ADR
  0019](../../docs/architecture/decisions/0019-persisted-linear-workflow-continuations.md)

This checkpoint completes the bounded linear workflow promised by ADR 0019:
activities can now continue through persisted timers and current-wait signals
using the same exact run-head and cursor transaction boundary. Timers are
framework work, signals are stable operator decisions, and both preserve the
ledger's evidence-first crash and replay rules across the source runtime and a
relocated SEA.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v13-workflow-timers-signals.md`. Work on branch
> `agent/strict-manifest` at or after implementation receipt `99cfc3e`. Read
> `PROJECT.md`, `ROADMAP.md`, ADR 0011, ADR 0019, and this checkpoint before
> editing. Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0.
> Work locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Preserve the V10 append-only event authority, exact run-head and
> cursor CAS, immutable payload rehashing, event-anchored historical replay,
> generation/fence guards, exact manifest/revision binding, transactionally
> maintained ready-work V2 rows, current-wait-only signal policy, and the rule
> that uncertain physical work is never silently relabelled, redispatched, or
> rewritten. The next tranche is installing and operating the SEA as an
> OS-managed single-node service with boot, restart, status, update, rollback,
> and reboot recovery proof. Then build the smallest provider-backed
> single-node fulfillment path before multi-node coordination. Keep general
> cloud IaC, trustless mesh semantics, arbitrary workflow-code replay, and
> backward compatibility outside scope.

## Product direction retained

Wharfie remains a local-first framework for turning a normal TypeScript CLI
with named activities into a portable executable that can remain resident,
carry intent beyond an interactive coding session, and later coordinate work
across trusted machines. One recoverable coordinator is sufficient initially.
Node/TypeScript remains the public boundary while native bindings,
subprocesses, and WASM stay available for measured hot paths. Exactly-once
language applies only to evidence-backed logical decisions and destination
protocols, never arbitrary physical user-code execution.

## Durable activation model

The workflow cursor now carries an exact activation union: `ACTIVITY`, `TIMER`,
or `SIGNAL`. Terminal cursors retain the final activation identity so
inspection and replay do not infer a different historical step shape. Activity
settlement, timer firing, signal consumption, and cancellation all compete on
the same exact run head and cursor.

Timers persist `scheduledAt`, `dueAt`, and `firedAt`. A runnable timer has one
transactionally maintained `TIMER` ready-work row. Only the resident runtime
may fire it, and only at or after its persisted deadline; timer firing does not
enter the authored Activity Protocol or expose a public fire command. Firing
atomically appends `workflow-timer-fired`, settles the wait, advances the
cursor, and materializes the next activation.

Signal waits persist `WAITING`, `CONSUMED`, or `CANCELLED`. Signal deliveries
persist `ACCEPTED` or `REJECTED`. A delivery ID is stable across the whole
application, and exact retries return the event-anchored historical result.
Reusing an identity with different run, signal, or payload arguments conflicts.
Only the current declared wait can accept a signal. Early, unexpected, and
late requests append `workflow-signal-rejected` with a safe reason and no
inbox, payload publication, cursor mutation, or activation-identity change.
Accepted requests append `workflow-signal-accepted`, consume the wait, advance
the cursor, and materialize the successor in one transaction.

Rejected signal decisions intentionally advance the run head for audit
ordering but not the workflow cursor. Exact ready-work rows are refreshed
against that new head, and bounded claim/start rebasing prevents audit churn
from starving otherwise-ready activity dispatch. Historical start, activity,
timer, signal, and cancellation responses are reconstructed from retained
events and receipts rather than current aggregate projections. Invocation,
cursor, attempt, terminal classification, and rejection reason are therefore
stable after later progress.

The execution-ledger namespace remains V10. The additive history includes
`workflow-timer-fired`, `workflow-signal-accepted`, and
`workflow-signal-rejected`; generic inspection is schema v7. Timer, wait, and
delivery projections redact payloads and internal references. Safe signal
history retains the stable actor `{ kind: "workflow-signal-operator", id:
appId }`.

## Runtime and operator surface

The workflow runner supports activity-to-timer, timer-to-signal, and
signal-to-activity continuations and cancels an outstanding timer or signal
wait when run-level cancellation wins. The resident treats due timers as
framework-owned work and continues exact manifest-bound activities through the
existing owner, generation, fence, and recovery machinery.

Source operators can deliver a signal with:

```sh
wharfie ops signal \
  --run-id <run-id> \
  --signal <name> \
  --delivery-id <stable-id> \
  --payload '<json>' \
  --json
```

The packaged equivalent is `<app> wharfie signal ...`. Both use the shared
operator implementation. Unknown runs and malformed payloads fail without
publishing or echoing supplied payload material. Public responses expose only
stable identities, accepted/rejected disposition, safe rejection reason, and
activation-aware run state.

## Executable proof

The adapter matrix covers timer scheduling/firing, early and due races,
current-wait signal acceptance, durable rejection, identity replay/conflict,
cursor-neutral audit events, cancellation, projection rebuild, event-anchored
historical responses, and successor materialization across DynamoDB, vanilla,
and native LMDB.

Runtime and operator tests cover timer deadlines, resident-only firing,
activity/timer/signal continuations, exact ready-row maintenance, bounded
head-churn rebasing, source and packaged command parity, payload redaction,
unknown-run behavior, malformed input, and response-loss replay.

The source real-process matrix proves persisted timer firing and current-wait
signal consumption across resident `SIGKILL` and generation takeover. The
relocated SEA verifier repeats that proof with Node absent from `PATH`, in
addition to the prior six-boundary workflow successor crash matrix.

## Exact post-change validation

Implementation receipt `99cfc3e` was validated under Node 24.13.1/npm 11.12.0:

- repository-wide ESLint and JavaScript/JSON Prettier checks passed;
- all four TypeScript lanes passed: source, application implementation, tests,
  and SEA verifier;
- the focused real-LMDB runtime/operator matrix passed 11 suites and 245 tests;
- the final core resilience/lifecycle/contract matrix passed 3 suites and 146
  tests across DynamoDB fake, vanilla, and native LMDB;
- the source real-process matrix passed 2 suites and 11 tests;
- the full stable-tree Jest coverage run passed 99 suites and 1,568 tests with
  one intentional suite/test skip; coverage was 79.26% statements, 75.11%
  branches, 84.19% functions, and 80.23% lines;
- the separately enabled native external integration test passed;
- package-content verification accepted 136 files;
- the production dependency audit found zero vulnerabilities;
- documentation command-surface checks passed 8 tests;
- the installed and relocated SEA proof passed with Node absent from `PATH`;
  the executable was 146,111,952 bytes with SHA-256
  `15c11f0151867f3c835543ae804a0d69198076815dd5ffbf3e1dce67bb9c957a`;
  and
- staged and unstaged `git diff --check` checks were clean.

Native LMDB opens, Unix sockets, process signals, and the SEA crash matrix need
their normal execution outside the restricted filesystem sandbox. The LMDB
native binding aborts under that sandbox but the same binary passes outside
it; this is an execution-environment constraint, not a repository safety
failure.

## Explicitly unsupported

The following remain intentionally unimplemented:

- reconciliation of `deadline-exceeded` workflow activity evidence;
- workflow activity steps using the framework-owned managed-effect successor;
- retry/backoff policy, schedules, branches, loops, parallel steps, child
  workflows, or workflow migration;
- an early-signal inbox or arbitrary signal-to-noncurrent-step delivery;
- garbage collection for unreachable content-addressed payloads, including a
  payload published by a final-CAS loser;
- OS service installation and provider-backed node fulfillment;
- multi-node leases, heartbeats, placement, and coordinator failover; and
- any claim that arbitrary user code physically executes exactly once.

Normal write APIs enforce monotonic history timestamps. Independently
rejecting a coherently forged imported history with timestamp regression is a
future hardening option, not part of this tranche.

## Ordered next tranche

1. Install the SEA as an OS-managed service and prove install, boot, graceful
   restart, status, update, rollback, and durable recovery across a real host
   reboot.
2. Add the smallest provider-backed path that can create, inspect, update, and
   remove one durable node through the operator credential chain.
3. Add provider-backed control-state fencing and recoverable single-coordinator
   placement only after the single-node service lifecycle is proven outside a
   developer session.

## Restart commands

```sh
git status --short --branch
git log -5 --oneline --decorate
. $HOME/.nvm/nvm.sh && nvm use 24.13.1
npm run lint
npm run typecheck
TZ=UTC node ./test/run-jest.js --silent --runInBand \
  test/runtime/execution-ledger-workflow-lifecycle.test.js \
  test/runtime/execution-ledger-workflow-activity-resilience.test.js \
  test/runtime/durable-workflow-signal-command.test.js \
  test/runtime/workflow-ledger-continuation.test.js \
  test/runtime/services/resident-activity-worker.test.js \
  test/cli/cmds/ops-workflow-sigkill.test.js
npm run verify:package:sea
```

The full suite's Unix-socket/LMDB and child-process cases, the native external
test, registry audit, and SEA verifier may need to run outside a restricted
filesystem or network sandbox.
