# Wharfie checkpoint — public workflow operator surface

- **Date:** 2026-07-19
- **Status:** **COMPLETE — implementation and exact post-change validation are
  recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `df8a4d148409ed524a11846c53cf744b90a70557`
- **Implementation receipt:** `139bad6a7545fa8bec926ee30396220dddb7dd3b`
- **Parent checkpoint:** [resident workflow activity
  dispatch](2026-07-19-v9-resident-workflow-activities.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md),
  and [ADR
  0019](../../docs/architecture/decisions/0019-persisted-linear-workflow-continuations.md)

This checkpoint exposes the first honest public workflow vertical. Source and
packaged applications can start exact revision-bound activity-only workflows,
inspect their redacted cursor, explicitly recover stopped attempts, and
reconcile retained uncertainty from verified terminal evidence.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v10-public-workflow-operator-surface.md`. Work on
> branch `agent/strict-manifest` at or after implementation receipt `139bad6`.
> Read `PROJECT.md`, `ROADMAP.md`, ADR 0011, ADR 0019, and this checkpoint before
> editing. Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0.
> Work locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Preserve the V10 append-only event authority, exact run-head and
> cursor CAS, immutable payload rehashing, receipt-event-anchored replay,
> generation/fence guards, exact manifest/revision binding, transactionally
> maintained ready-work V2 rows, and the rule that uncertain physical work is
> never silently redispatched or rewritten. The next tranche is a real
> process-kill proof of public workflow start, resident execution, restart
> recovery, and evidence reconciliation through source and a relocated SEA with
> Node absent from `PATH`. After that, implement cursor-aware workflow
> cancellation before timers and signals. Keep general cloud IaC, trustless
> mesh semantics, arbitrary workflow-code replay, and backward compatibility
> outside scope.

## Product direction retained

Wharfie remains a local-first framework for turning a normal TypeScript CLI
with named activities into a self-contained executable that can remain
resident as a durable service and later coordinate work across trusted
machines. One recoverable coordinator is sufficient initially. Node/TypeScript
is the primary boundary; native bindings, subprocess protocols, and WASM remain
available for measured hot paths. Exactly-once language applies only to
evidence-backed logical decisions and destination protocols, never to
arbitrary physical user-code execution.

## Shared public workflow start

The source CLI mounts:

```sh
wharfie ops start --dir ./app --workflow <workflow-id> \
  --idempotency-key <stable-key> --input '<json>'
```

The packaged executable mounts the same command without source selection:

```sh
<app> wharfie start --workflow <workflow-id> \
  --idempotency-key <stable-key> --input '<json>'
```

Both wrappers use one shared command implementation. They load an immutable
source or embedded revision, derive the stable workflow run ID, use the same
revision-stable `workflow-operator` actor, and emit only the accepted run,
revision, workflow, cursor position, invocation state, and replay marker.
Inputs, caller metadata, payload references, evidence, and fences are never
printed.

The host re-derives the exact plan from the sealed manifest and verifies
prepared source before mutation. Public start currently rejects the complete
plan before ledger access unless every step is an ordinary authored activity.
Timer, signal, and framework-owned managed-effect successor steps therefore
cannot create a run that the resident cannot finish.

## Resident and offline ingress

Workflow start uses the same app-scoped ownership boundary as durable manual
submission. If an exact resident owns the application, the request is sent to
its authenticated local command endpoint and wakes dispatch. Otherwise a
short-lived local owner persists the run and leaves it runnable for a later
matching worker.

The request is cloned before asynchronous ownership routing. A lost socket
response is never treated as proof of non-application: the stable run ID is
retried only after the ownership fence permits it. Exact retries return the
retained run; a changed workflow, input, metadata, actor, or immutable revision
conflicts without duplicating an event or ready-work row.

## Workflow-aware operator boundary

The redacted execution-ledger operator view is now schema version 6. Every run
exposes only its safe trigger identity. A workflow additionally exposes its
workflow and plan IDs, current continuation/invocation/step identities,
disposition, output step positions, versions, sequences, and timestamps. Plan,
start, request, and output references and all values remain private.

Generic confirmed recovery now recognizes workflow runs. It releases only an
exact unstarted claim; a started attempt becomes or remains visible uncertainty
and is never silently redispatched.

Generic evidence reconciliation now resolves an exact retained uncertain
workflow activity through the existing cursor/fence-guarded compound ledger
transition. A verified completion advances to one successor or terminal
completion; verified failure or protocol failure terminalizes without a
successor. The abandoned physical attempt remains byte-identical.

Response-loss replay follows the retained `reconcile:<id>` event back to its
original uncertainty event. It reconstructs the historical cursor, invocation,
attempt, fence, and expected version instead of trusting the possibly advanced
current cursor. Exact replay returns `changed: false`; different evidence,
reason, actor, or authority conflicts and leaves state unchanged.

Generic cancellation rejects workflow runs before current-owner routing.
Run-level workflow cancellation needs its own cursor-aware durable decision and
is deliberately not approximated with the manual-run command.

## End-to-end regressions

The canonical hello-world example now declares a two-activity `echo-twice`
workflow. A real source CLI test proves start, schema-v6 inspection, redaction,
exact retry, one event, one ready row, conflicting retry without mutation, and
unknown-workflow rejection before the control root is created.

A real-ledger operator test proves uncertain first-step reconciliation,
single-successor advancement, immutable abandoned-attempt history, exact replay
after cursor advancement, conflicting same-ID rejection, and generic recovery
of an unstarted workflow claim. Resident tests cover authenticated start,
app/revision and field rejection before mutation, wakeup, and graceful drain of
an admitted start.

The installed/relocated SEA verifier now requires packaged `start` help and its
exact no-`--dir` option surface. Its existing manual/effect crash matrices were
updated for schema v6 and still pass. It does **not** yet execute the new public
workflow through process-kill boundaries; that is the next tranche.

## Exact post-change validation

Implementation receipt `139bad6` was validated under Node 24.13.1/npm 11.12.0:

- repository-wide ESLint and JavaScript/JSON Prettier checks passed;
- all four TypeScript lanes passed: source, app implementation, tests, and SEA
  verifier;
- nine focused workflow/operator/CLI suites passed 123 tests;
- the full Jest coverage run passed 95 suites and 1,487 tests with one
  intentional suite/test skip;
- package-content verification accepted 132 files;
- the native external integration test passed;
- the production dependency audit found zero vulnerabilities;
- the installed and relocated SEA proof passed with Node absent from `PATH`;
  the executable was 143,321,424 bytes; and
- staged and unstaged `git diff --check` checks were clean.

Native LMDB locking, Unix sockets, process signals, the npm advisory endpoint,
and the SEA crash matrix required their normal execution outside the restricted
filesystem/network sandbox. The approval was environmental, not a code safety
failure.

## Explicitly unsupported

The following remain intentionally unimplemented:

- real source/relocated-SEA process-kill coverage for the public workflow path;
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

1. Prove public source and relocated-SEA workflow start plus real process-kill
   recovery at claim, start, terminal, recovery-response, and reconciliation
   response boundaries.
2. Add run-level cursor-aware workflow cancellation and its races with success
   and uncertainty before accepting cancelled or deadline terminals.
3. Add persisted timers and current-wait signals on the existing cursor/run-head
   boundary.
4. Install the SEA as an OS-managed service before beginning the smallest
   provider-backed single-node fulfillment path.

## Restart commands

```sh
git status --short --branch
git log -5 --oneline --decorate
. $HOME/.nvm/nvm.sh && nvm use 24.13.1
npm run lint
npm run typecheck
TZ=UTC node ./test/run-jest.js --silent --runInBand \
  test/cli/cmds/ops-workflow-start-command.test.js \
  test/runtime/durable-workflow-start-command.test.js \
  test/runtime/execution-ledger-workflow-operator.test.js \
  test/runtime/services/resident-activity-worker.test.js
```

The full suite's Unix-socket/LMDB and child-process cases, the native external
test, registry audit, and SEA verifier may need to run outside a restricted
filesystem or network sandbox.
