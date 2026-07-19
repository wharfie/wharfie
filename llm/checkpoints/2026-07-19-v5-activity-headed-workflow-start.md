# Wharfie checkpoint — activity-headed workflow start

- **Date:** 2026-07-19
- **Status:** **COMPLETE — implementation and full source/native/package/SEA
  validation are recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `f6418bee4dfe25746e3b04d6b07c3d4011f24c31`
- **Implementation receipt:** `7666fe3eea35301f016db4ddb5bf9cce3a143294`
- **Full validation receipt:** `npm run test:full` — exit 0 on 2026-07-19
- **Parent checkpoint:** [V10 ready-work and workflow authoring
  foundation](2026-07-19-v4-v10-ready-work.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md),
  and [ADR
  0019](../../docs/architecture/decisions/0019-persisted-linear-workflow-continuations.md)

This checkpoint records the first durable workflow-run boundary. The internal
V10 ledger can atomically start a static workflow whose first step is an
activity, persist one rebuildable orchestration cursor, and publish one
cursor-bound ready-work V2 locator. It cannot claim, execute, or advance that
workflow activity yet.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v5-activity-headed-workflow-start.md`. Work on
> branch `agent/strict-manifest` at or after implementation receipt `7666fe3`.
> Read `PROJECT.md`, `ROADMAP.md`, ADR 0011, ADR 0019, and this checkpoint before
> editing. Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0.
> Work locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Preserve the V10 append-only event authority, ready-work V2,
> immutable payload verification, cursor rederivation, exact replay/conflict
> behavior, and manual/workflow lifecycle separation below. The next tranche
> is cursor-guarded workflow activity claim/start plus one compound success
> transition that persists verified output and atomically creates the next
> activity or terminal workflow state. Prove it under replay, transaction
> failure, projection corruption, and LMDB close/reopen before adding resident
> dispatch. Do not add timers, signals, a second workflow store, arbitrary
> workflow-code replay, general cloud IaC, trustless mesh semantics, or backward
> compatibility in that tranche.

## Product direction retained

The north star remains:

> Wharfie turns a normal TypeScript CLI with named activities into a
> self-contained executable that can run locally, remain resident as a durable
> worker, and coordinate work across a trusted set of machines—without
> requiring Node, containers, Kubernetes, or a hosted orchestration service.

The product exists to let intent expressed in a local CLI or coding-agent
session continue as an inspectable, evolvable durable service after the session
ends. Nodes are trusted. One coordinator is sufficient initially if durable
truth permits robust replacement. Node/TypeScript is the primary authoring and
runtime boundary, with native bindings, subprocess protocols, or WASM reserved
for measured hot paths. Exactly-once language remains limited to
evidence-backed logical decisions and managed destination protocols; Wharfie
does not claim arbitrary user code physically executes exactly once.

## Workflow execution contract added

`src/core/lib/ledger/workflow-execution-contract.js` defines strict, canonical
payloads and stable identities independently of database operations.

The payload schemas are:

- `wharfie.execution.workflow-plan.v1` for the immutable app/revision/workflow
  definition snapshot;
- `wharfie.execution.workflow-start-request.v1` for input and inert caller
  metadata;
- `wharfie.execution.workflow-output.v1` for future logical step outputs; and
- `wharfie.execution.activity-request.v1` for both manual and workflow-selected
  activity requests.

The plan envelope is bounded to the 1 MiB workflow-definition ceiling plus
1,024 bytes. Start, output, and selected activity-request documents are each
bounded to 983,040 bytes, leaving 64 KiB beneath the 1 MiB Activity Protocol
frame ceiling for durable execution identities and framing.

Changing the manual request schema name from
`wharfie.execution.manual-request.v1` to
`wharfie.execution.activity-request.v1` is intentional and breaking. There is
no compatibility reader or migration for experimental earlier V10 records.

Stable domain-separated identities now include:

- `wfr`: an app-scoped run derived only from `appId` and the caller's stable
  idempotency key; revision, workflow, plan, input, metadata, and actor remain
  conflict fields;
- `wfp`: the exact normalized plan payload;
- `wfc`: the run, plan, step ID, and step ordinal activation;
- `wfi`: the run, continuation, step, ordinal, and activity binding; and
- `wft` and `wfs`: reserved timer and signal-wait identities. Their strict
  constructors and validators exist, but no timer or signal state is persisted.

`materializeFirstWorkflowActivity` rehashes the supplied plan and start
references, selects only a whole `workflow-input` or a plan-bound `literal`,
derives the plan/continuation/invocation identities, and returns exactly one
version-1 `ACTIVITY_RUNNABLE` cursor with no outputs.

## Atomic `createWorkflowRun`

The execution-ledger store now exports:

```text
createWorkflowRun({
  runId,
  appId,
  revisionId,
  workflowId,
  definition,
  input?,
  callerMetadata?,
  transitionId,
  actor?,
  observedAt?,
})
```

It validates and preflights the complete first activity request before
publishing payloads. It rejects a timer- or signal-headed definition, a first
step that selects a prior output, and the framework-reserved managed-effect
successor activity before creating ledger authority.

One successful `workflow-run-created` transaction writes:

- the sequence-1 event and transition receipt;
- run head and `RUNNING` workflow run projection;
- version-1 `ACTIVITY_RUNNABLE` workflow cursor projection;
- generation-0 `RUNNABLE` activity invocation with an immutable workflow
  binding;
- app-scoped run-directory entry; and
- ready-work V2 `ACTIVITY` row containing the exact cursor coordinates.

Payload publication can precede the transaction and may leave unreachable
content-addressed bytes after a forced failure. No event, head, projection,
directory row, or ready-work row becomes authoritative unless the single
transaction commits.

An exact retry returns the retained creation. Reusing a run identity with a
different plan, input, caller metadata, revision, workflow, or actor conflicts.
Changing only `observedAt` or using a fresh transition identity deduplicates to
the immutable creation and does not invent a receipt. Conditional create races
return the exact winner or reject a conflicting winner.

Creation replay is anchored to the immutable sequence-1 run, invocation, and
cursor snapshots. It deliberately does not use the current cursor invocation,
so the original start request is designed to remain replayable once workflow
advancement is implemented.

## Fold, projection, and lifecycle invariants

Every workflow rebuild:

- verifies and rehashes the plan, start, and selected activity-request payload
  references;
- re-normalizes the plan and request;
- rederives the plan, continuation, and invocation IDs and the complete initial
  cursor;
- compares those values with the exact event snapshots and all authoritative
  in-run projections; and
- fails closed if the cursor is missing, corrupt, or cannot be reproduced.

The workflow binding on an invocation is exact and immutable. A rehashed event
cannot add, remove, or change it during an invocation transition.

This tranche rejects every post-creation workflow event during fold. Generic
manual claim, attempt, effect, terminal, recovery, reconciliation, and
cancellation mutations require a manual run. Specialized managed-effect
successor transitions remain trigger-scoped and cannot accept workflow runs.
Those guards are a temporary fail-closed boundary, not workflow execution
support.

`rebuildRun` returns the optional workflow cursor. Ready-work repair selects the
invocation named by the current cursor rather than assuming a workflow will
retain exactly one invocation. Cursor replacement uses cursor-specific
conditions over schema, disposition, version, sequence, and revision instead
of a run-status-shaped compare-and-swap.

## Ready-work V2

The ready-work record schema, partition domain, and sort-key prefix are now
version 2. V1 rows are inert and are neither read nor rewritten.

Manual `ACTIVITY` and `RECOVERY` locators retain their existing strict shape.
Workflow variants require the complete all-or-none tuple:

```text
cursorVersion, continuationId, stepId, stepIndex
```

`CONTINUATION` and `TIMER` rows also require `cursorVersion`; timers additionally
require `timerId`. Pagination returns the cursor coordinates so a future
resident can verify the exact orchestration position. The workflow cursor uses
the fixed projection key `ledger/v10/projection/workflow-cursor`.

`repairReadyWork` rebuilds the authoritative run, finds the workflow
invocation named by the cursor, and recreates the exact row under the unchanged
run head. It never treats the row itself as authority.

## Proven behavior

Focused contract and adapter-matrix tests cover:

- workflow-input and literal first-activity materialization;
- exact plan/start/activity payload bytes and stable identities;
- event, cursor, run, invocation, directory, and ready-row contents;
- exact retry, changed-envelope retry, conflicting reuse, and exact/conflicting
  conditional create races;
- rejection of timer, signal, prior-output, and reserved-activity starts;
- transaction failure with no ledger authority;
- workflow rejection by generic manual claim and cancellation boundaries;
- missing ready-row repair and cursor corruption; and
- native LMDB close/reopen retention.

The final full gate used Node 24.13.1/npm 11.12.0 and exited 0:

- ESLint, Prettier, and all four TypeScript checking lanes passed;
- Jest passed 86 suites and 1,223 tests, with one suite/test intentionally
  skipped;
- coverage was 78.76% statements, 73.87% branches, 83.72% functions, and
  79.73% lines;
- the package-content gate accepted 127 files and the production dependency
  audit reported zero vulnerabilities;
- the native external/LMDB suite passed its one test; and
- the clean installed-package/relocated-SEA proof passed with a 142,743,504
  byte executable and Node unavailable on `PATH`.

The relocated executable still proves the existing durable manual activity,
managed-effect, recovery/reconciliation, successor, cancellation, resident,
and service crash boundaries. The schema rename was included in that packaged
verification.

## Explicitly unsupported

This is a durable workflow start, not a workflow engine. The following remain
unimplemented:

- timer- or signal-headed starts;
- `step-output` selection at the first step;
- workflow activity claim, start, effect handling, terminal execution, and
  recovery;
- persisted workflow outputs or cursor advancement;
- successor activity materialization or terminal workflow completion;
- timers, signals, workflow cancellation, schedules, resident workflow
  dispatch, and source/package/SEA workflow commands;
- multi-node scheduling, leases, heartbeats, and coordinator failover; and
- any broad physical exactly-once execution claim.

## Ordered next tranche

Implement only the singular activity continuation path next:

1. add cursor-guarded workflow activity claim and start transitions using the
   retained invocation and ordinary attempt fencing;
2. add one compound verified-success transition that persists the logical
   workflow output, terminalizes the attempt and invocation, consumes the
   current continuation, and atomically creates the next activity or terminal
   workflow state plus the exact ready-work row;
3. anchor all retry decisions to immutable event snapshots and condition every
   mutation on the exact run head and cursor;
4. prove response loss, conflicting races, payload or transaction failure,
   projection corruption, ready-row repair, and native LMDB close/reopen; and
5. only then connect this path to the resident worker.

Timers, signals, workflow cancellation, public commands, and service
installation should remain outside that tranche until the single activity
advance is demonstrably singular and rebuildable.
