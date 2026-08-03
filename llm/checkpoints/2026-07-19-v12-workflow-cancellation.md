# Wharfie checkpoint — durable workflow cancellation

- **Date:** 2026-07-19
- **Status:** **COMPLETE — implementation and exact post-change validation are
  recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `dca6977d5fa5c61fe92a500669e74885ed4adb1c`
- **Implementation receipt:** `7096b7c4d084fe2c135aa994dc609af25e66653b`
- **Parent checkpoint:** [workflow crash
  recovery](2026-07-19-v11-workflow-crash-recovery.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md),
  and [ADR
  0019](../../docs/architecture/decisions/0019-persisted-linear-workflow-continuations.md)

This checkpoint adds cursor-aware run-level workflow cancellation without
pretending that a cancellation request proves a begun physical activity
stopped. Unstarted work can terminate immediately. Begun work first persists
intent and only then receives an exact-owner protocol cancel frame. Uncertain
work gains a durable no-continuation fence while retaining its honest physical
uncertainty. Stable request identities make response loss replayable without a
second transition or physical signal.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v12-workflow-cancellation.md`. Work on branch
> `agent/strict-manifest` at or after implementation receipt `7096b7c`. Read
> `PROJECT.md`, `ROADMAP.md`, ADR 0011, ADR 0019, and this checkpoint before
> editing. Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0.
> Work locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Preserve the V10 append-only event authority, exact run-head and
> cursor CAS, immutable payload rehashing, receipt-event-anchored replay,
> generation/fence guards, exact manifest/revision binding, transactionally
> maintained ready-work V2 rows, persist-before-physical-cancel ordering, and
> the rule that uncertain physical work is never silently relabelled,
> redispatched, or rewritten. The next tranche is persisted timers and
> current-wait signals on the same cursor boundary. After that, install the SEA
> as an OS-managed service and build the smallest provider-backed single-node
> fulfillment path before multi-node coordination. Keep general cloud IaC,
> trustless mesh semantics, arbitrary workflow-code replay, and backward
> compatibility outside scope.

## Product direction retained

Wharfie remains a local-first framework for turning a normal TypeScript CLI
with named activities into a portable executable that can remain resident,
carry intent beyond an interactive coding session, and later coordinate work
across trusted machines. One recoverable coordinator is sufficient initially.
Node/TypeScript remains the public boundary while native bindings,
subprocesses, and WASM stay available for measured hot paths. Exactly-once
language applies only to evidence-backed logical decisions and destination
protocols, never arbitrary physical user-code execution.

## Durable decision model

V10 gains two additive event types without a namespace change:
`workflow-cancellation-requested` and `workflow-activity-cancelled`. The
workflow cursor now has a terminal `CANCELLED` disposition. One ledger API
conditions cancellation on the exact run head, cursor, invocation generation,
attempt identity, fencing token, and coordinator epoch.

The state-specific policy is:

1. `ACTIVITY_RUNNABLE` terminalizes the run, invocation, and cursor and removes
   ready work without creating an attempt.
2. A `CLAIMED` attempt is retained as cancelled physical history while the run,
   invocation, and cursor terminalize and its recovery row disappears.
3. A `STARTED` attempt retains `RUNNING`/`STARTED` state plus the cancellation
   request. `cancellationDeliveryRequired` is true only for that newly applied
   transition. The exact active owner then sends the retained reason to the
   physical attempt.
4. `ACTIVITY_UNCERTAIN` retains `BLOCKED`, `UNCERTAIN`, `ABANDONED`, and the
   uncertain cursor while recording the request on the run and invocation. It
   prevents continuation but does not retroactively add authority to the
   abandoned attempt.
5. A terminal result that already won remains authoritative. Final completed
   evidence may complete the workflow; failed evidence remains failed. A
   non-final completed activity observed after cancellation keeps its proven
   invocation and attempt result but terminalizes the aggregate run/cursor as
   cancelled and creates no output, successor, or ready row.

Direct or reconciled `cancelled` evidence is accepted only when the exact
attempt already retained the matching request and the transcript contains its
exact host cancel reason. A request recorded after uncertainty cannot authorize
a historical cancelled transcript. `protocol-failed` after a cancel frame is
not proof that the activity stopped and therefore becomes uncertainty.
`deadline-exceeded` remains unsupported until deadline authority is persisted.

An independent integration review found that a very large internal
cancellation reason could otherwise consume the record space needed for later
uncertainty after owner loss. Started cancellation now reserves the complete
future workflow uncertainty event during both admission and fold. Workflow
uncertainty reasons have a matching 32 KiB encoded ceiling, large enough for
the runner's bounded diagnostic, and adapter tests prove that an oversized
request leaves the run byte-identical.

## Runtime and operator surface

The workflow runner registers one versioned process-local port containing the
exact run, invocation, cursor activation, attempt, fence, generation, and
coordinator epoch. The port accepts only a stable request ID; actor and reason
are fixed when the runner registers it. It persists before aborting the attempt,
memoizes retained request identities, rebases terminal CAS after the
cancellation event advances the run and cursor, and unregisters before leaving
the physical-attempt scope. Generic resident shutdown remains a separate
physical drain signal and creates no run-level workflow cancellation authority.

The shared source and packaged `cancel` commands now accept workflow runs.
When no resident exists, a short-lived owner can cancel runnable, claimed, or
uncertain work without loading authored source. A live resident can cancel an
idle workflow or a workflow other than the currently executing run. Only the
exact active workflow port can accept a fresh started request and begin
physical delivery. Manual cancellation deliberately retains its previous
active-attempt-only behavior, and managed-effect successor cancellation remains
unsupported.

Public responses expose only the stable run/request identity, durable outcome,
delivery class, and safe run/invocation statuses. `delivery: "started"` means
the durable request was retained before the active handoff began;
`delivery: "not-required"` covers terminalized unstarted work, uncertain
no-continuation authority, and replay after terminal settlement.

## Executable proof

The adapter matrix covers runnable, claimed, started, and uncertain requests;
first-wins replay and conflict behavior; cancelled direct and reconciled
evidence; success/failure races; no-successor enforcement; projection rebuild;
and the crash-closure size reserve across DynamoDB, vanilla, and LMDB.

The workflow runner suite covers exact active-port matching, persist-before-
abort delivery, response-loss replay without a second signal, terminal CAS
rebasing, completed and failed races, ambiguous cancellation becoming
uncertainty, cancellation-port cleanup, and unsupported deadline evidence. The
resident/operator suites cover offline short ownership, idle and different-run
routing, live authenticated owner delivery, redaction, manual isolation, and
physical-only workflow shutdown.

The source real-process matrix now has seven `SIGKILL` cases. Its two new cases
kill a public cancellation command after its response boundary: one proves an
active resident persisted before delivery and settles exactly one cancelled
terminal; the other proves offline runnable cancellation committed before the
lost response. Stable retries create no event, signal, ready row, attempt, or
authored marker.

The relocated SEA verifier adds offline public workflow cancellation from a
moved executable with Node absent from `PATH`. It proves one retained request,
terminal cursor/run/invocation state, no attempt or ready work, no authored
dispatch, no payload orphan, no leaked private value, no lingering owner, and
byte-identical response-loss replay.

## Exact post-change validation

Implementation receipt `7096b7c` was validated under Node 24.13.1/npm 11.12.0:

- repository-wide ESLint and JavaScript/JSON Prettier checks passed;
- all four TypeScript lanes passed: source, app implementation, tests, and SEA
  verifier;
- the focused combined cancellation/runtime/operator matrix passed 250 tests;
- the source workflow crash suite passed seven real-process tests;
- the final cancellation adapter matrix passed 27 tests, including LMDB and
  the crash-closure reserve;
- the full Jest coverage run passed 97 suites and 1,537 tests with one
  intentional suite/test skip;
- package-content verification accepted 132 files;
- the native external integration test passed;
- the production dependency audit found zero vulnerabilities;
- the installed and relocated SEA proof passed with Node absent from `PATH`;
  the executable was 145,732,176 bytes; and
- staged and unstaged `git diff --check` checks were clean.

Native LMDB locking, Unix sockets, process signals, the npm advisory endpoint,
and the SEA crash matrix required their normal execution outside the restricted
filesystem/network sandbox. Those approvals were environmental, not code
safety failures.

## Explicitly unsupported

The following remain intentionally unimplemented:

- timer and signal cursor decisions, ready rows, delivery, and firing;
- reconciliation of `deadline-exceeded` workflow activity evidence;
- workflow activity steps using the framework-owned managed-effect successor;
- retry/backoff policy, schedules, branches, loops, parallel steps, child
  workflows, or workflow migration;
- garbage collection for unreachable content-addressed payloads;
- OS service installation and provider-backed node fulfillment;
- multi-node leases, heartbeats, placement, and coordinator failover; and
- any claim that arbitrary user code physically executes exactly once.

## Ordered next tranche

1. Add persisted timers and current-wait signals on the existing cursor and
   run-head transaction boundary, followed by their shared source and packaged
   commands.
2. Install the SEA as an OS-managed service and prove boot, restart, status,
   update, and rollback on one clean host.
3. Add the smallest provider-backed path that can create, inspect, update, and
   remove one durable node through the operator credential chain.
4. Begin recoverable coordinator placement only after the single-node service
   lifecycle and control-store fencing are proven outside a developer session.

## Restart commands

```sh
git status --short --branch
git log -5 --oneline --decorate
. $HOME/.nvm/nvm.sh && nvm use 24.13.1
npm run lint
npm run typecheck
TZ=UTC node ./test/run-jest.js --silent --runInBand \
  test/runtime/execution-ledger-workflow-cancellation.test.js \
  test/runtime/workflow-ledger-run.test.js \
  test/runtime/execution-ledger-operator.test.js \
  test/runtime/services/resident-activity-worker.test.js \
  test/cli/cmds/ops-workflow-sigkill.test.js
npm run verify:package:sea
```

The full suite's Unix-socket/LMDB and child-process cases, the native external
test, registry audit, and SEA verifier may need to run outside a restricted
filesystem or network sandbox.
