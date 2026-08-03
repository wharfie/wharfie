# Wharfie checkpoint — verified workflow activity continuations

- **Date:** 2026-07-19
- **Status:** **COMPLETE — implementation and full source/native/package/SEA
  validation are recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `6815e87b7bdf3147c2562f1f20f0eb76a48d78f2`
- **Implementation receipt:** `ca5bd2431fae00a9eaa15a1e9923ad547fa19c66`
- **Full validation receipt:** all `npm run test:full` component gates exited 0
  on 2026-07-19
- **Parent checkpoint:** [activity-headed workflow
  start](2026-07-19-v5-activity-headed-workflow-start.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md),
  and [ADR
  0019](../../docs/architecture/decisions/0019-persisted-linear-workflow-continuations.md)

This checkpoint records the first complete durable activity-to-activity
workflow turn. The V10 ledger can claim and start one exact cursor-bound
activity, accept only a fully verified `completed` Activity Protocol
transcript, persist its logical output, and atomically create the next ordinary
activity or terminal workflow state.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v6-workflow-activity-continuations.md`. Work on
> branch `agent/strict-manifest` at or after implementation receipt `ca5bd24`.
> Read `PROJECT.md`, `ROADMAP.md`, ADR 0011, ADR 0019, and this checkpoint before
> editing. Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0.
> Work locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Preserve the V10 append-only event authority, exact cursor CAS,
> immutable plan/start/request/output/evidence rehashing, receipt-event-anchored
> replay, compound successor transaction, ready-work V2 replacement, and
> manual/workflow trigger separation described below. The next tranche should
> make workflow activity recovery honest: cursor-guarded release of a `CLAIMED`
> attempt that never started, conservative blocking of a lost `STARTED`
> attempt, and an evidence-backed way to resolve that blocked workflow without
> inventing a continuation. Do not mount resident workflow dispatch until that
> recovery path is proven. Keep timers, signals, general cloud IaC, trustless
> mesh semantics, arbitrary workflow-code replay, and backward compatibility
> outside that tranche.

## Product direction retained

Wharfie remains a local-first framework for turning a normal TypeScript CLI
with named activities into a self-contained executable that can persist as a
durable service and later coordinate work across trusted machines. One
recoverable coordinator is sufficient initially. Node/TypeScript remains the
primary boundary, while native bindings, subprocess protocols, and WASM remain
available for measured hot paths. Exactly-once language applies only to
evidence-backed logical decisions and destination protocols, never arbitrary
physical user-code execution.

## Workflow contract now implemented

`src/core/lib/ledger/workflow-execution-contract.js` now supports three cursor
dispositions:

```text
ACTIVITY_RUNNABLE -> ACTIVITY_RUNNING ->
  ACTIVITY_RUNNABLE (successor) | COMPLETED
```

Cursor outputs are a canonical, contiguous, append-only prefix:

```text
{ stepId, stepIndex, outputRef }
```

Every binding names `wharfie.execution.workflow-output.v1`. Active activity
cursors retain exactly one output per earlier step; a completed cursor also
retains the final step output. Step IDs and ordinals must match the immutable
plan, and each referenced output is rehashed before it can authorize selection
or advancement.

The pure contract exports:

- `normalizeWorkflowOutputBinding` for the strict cursor binding;
- `materializeWorkflowCursorActivity` for rederiving the exact current request
  from plan, start, cursor, and any selected prior output; and
- `materializeWorkflowActivitySuccess` for appending one verified output and
  deriving either the next activity request/identities/cursor or the terminal
  cursor.

Selectors now work for workflow input, plan literals, the just-completed
activity output, or one exact older step output. Timer and signal successors
remain rejected by the success materializer.

## Cursor-guarded physical lifecycle

The execution ledger exports three workflow-only APIs:

```text
claimWorkflowActivity({
  runId, invocationId,
  cursor: { version, continuationId, stepId, stepIndex },
  fencingToken, expectedGeneration, expectedVersion,
  transitionId, actor?, coordinatorEpoch?, observedAt?
})

markWorkflowActivityStarted({
  runId, invocationId, cursor,
  attemptId, fencingToken, generation, expectedVersion,
  transitionId, actor?, coordinatorEpoch?, observedAt?
})

commitVerifiedWorkflowActivitySuccess({
  runId, invocationId, cursor,
  attemptId, fencingToken, generation, expectedVersion,
  transitionId, evidence, actor?, coordinatorEpoch?, observedAt?
})
```

Claim and start require the exact run head, active cursor tuple, invocation
binding, physical generation, and fence. Claim changes
`ACTIVITY_RUNNABLE` to `ACTIVITY_RUNNING` and creates a deterministic `CLAIMED`
attempt. Start advances the cursor CAS while retaining
`ACTIVITY_RUNNING`, marks that attempt `STARTED`, and authorizes physical
dispatch only for the call that actually commits the start. Receipt replay
returns `dispatchAuthorized: false`.

Before claim, the ledger refuses to dispatch an activity if its current or
immediate successor activity is the reserved managed-effect successor, or if
its immediate continuation is a timer or signal whose durable transition is
not implemented. The same restriction is enforced while folding retained
history, so an unsafe claim cannot be forged into an otherwise valid event
stream.

Generic manual claim, cancellation, effect, recovery, and terminal APIs remain
manual-only. The workflow APIs cannot mutate manual or framework-owned
managed-effect successor runs.

## One compound verified-success transition

`commitVerifiedWorkflowActivitySuccess` accepts no caller-supplied logical
result. It reconstructs the exact persisted start frame, validates the complete
Activity Protocol transcript, requires its terminal to be `completed` for the
exact attempt, and uses only `terminal.result` as the workflow output.

Payload publication may leave unreachable content-addressed evidence, output,
or successor-request bytes if a later transaction loses. It creates no ledger
authority. The successful `workflow-activity-succeeded` transaction writes or
replaces all of the following together:

- run head, event, and transition receipt;
- run and run-directory projections;
- completed current invocation and attempt with evidence reference;
- advanced output-bearing workflow cursor;
- optional fresh generation-0 `RUNNABLE` successor invocation;
- cursor projection; and
- exact ready-work replacement from current `RECOVERY` to successor `ACTIVITY`,
  or deletion when the workflow completes.

The current invocation remains addressable after a successor exists. Public
results select the affected invocation from the receipt rather than assuming a
run has one invocation. Success responses also expose the receipt-event cursor,
output reference, and optional successor invocation.

## Fold, replay, and corruption rules

The three new event types are:

- `workflow-activity-claimed`;
- `workflow-activity-started`; and
- `workflow-activity-succeeded`.

Every fold rehashes the immutable plan, start, all retained outputs, current
activity request, complete success evidence, and any successor request. It
rederives current and successor identities and requests, checks contiguous
cursor/output evolution, and validates the exact run/invocation/attempt/cursor
advance. A success event may add exactly one previously absent invocation.

Replay checks immutable receipt/event snapshots rather than the current cursor.
This matters after the successor has already been claimed: replay still returns
the cursor, output, and successor committed by the earlier success event while
the run view may reflect the newer durable head. Reusing a transition identity
with different cursor, fence, evidence, output, or successor conflicts.

The ledger rehashes every retained workflow output on every later fold. Missing
or altered output bytes therefore block rebuild, success replay, and successor
claim rather than silently changing selected input.

## Proven behavior

The adapter matrix covers DynamoDB, vanilla, and LMDB for:

- strict cursor/output normalization and stable activity successor identities;
- workflow-input, literal, current-output, and older-output selection;
- claim/start acceptance, exact replay, and one-shot dispatch authorization;
- stale head, cursor, generation, fence, and transition-reuse rejection;
- refusal to dispatch before timer, signal, or reserved-activity successors;
- first success with exact output/request/IDs and `RECOVERY -> ACTIVITY` ready
  replacement;
- late success replay after the successor is already claimed;
- final success with a `COMPLETED` cursor and no ready row;
- payload-publication and transaction failure retaining exact `STARTED`
  authority, followed by successful retry;
- corrupt ready-row rejection for both claim and success;
- exact and conflicting conditional success races; and
- output-byte tampering that blocks rebuild, replay, and successor claim.

A separate real-LMDB test closes and reopens after the first activity becomes
`STARTED`, commits its verified success after reopen, closes and reopens again,
verifies the successor/output/ready row, and then claims the successor.

The final gate used Node 24.13.1/npm 11.12.0 and exited 0:

- ESLint, Prettier, and all four TypeScript checking lanes passed;
- Jest passed 89 suites and 1,272 tests, with one suite/test intentionally
  skipped;
- coverage was 78.96% statements, 74.23% branches, 83.99% functions, and
  79.93% lines;
- the package-content gate accepted 127 files and the production dependency
  audit reported zero vulnerabilities;
- the native external/LMDB suite passed its one test; and
- the clean installed-package/relocated-SEA proof passed with a 142,925,136
  byte executable and Node unavailable on `PATH`.

## Explicitly unsupported

The following remain intentionally unimplemented:

- workflow recovery after a retained `CLAIMED` or `STARTED` attempt;
- workflow failure, cancellation, uncertainty, or reconciliation transitions;
- managed-effect mutation from a workflow activity attempt;
- timer and signal cursor states, decisions, and ready rows;
- resident workflow dispatch and source/package/SEA workflow commands;
- retry/backoff policy, schedules, branches, loops, parallel steps, child
  workflows, or workflow migration;
- multi-node leases, heartbeats, placement, and coordinator failover; and
- any claim that arbitrary user code physically executes exactly once.

## Ordered next tranche

Implement the minimum recovery state machine before mounting dispatch:

1. add a cursor-guarded transition that abandons an unstarted `CLAIMED`
   workflow attempt and restores the same activity to `ACTIVITY_RUNNABLE` with
   an exact `RECOVERY -> ACTIVITY` ready-row replacement;
2. add a cursor disposition and compound transition that turns a lost
   `STARTED` attempt into visible blocked uncertainty with no runnable row or
   successor;
3. define one evidence-backed resolution path that can terminalize or continue
   that blocked workflow without rewriting the abandoned physical attempt;
4. prove response loss, race ordering, transaction failure, corruption, LMDB
   reopen, and stopped-runner evidence; and
5. only then let the resident worker consume workflow `ACTIVITY` or `RECOVERY`
   locators.

Workflow cancellation and managed effects should follow the same cursor-aware
authority before timers, signals, or public workflow commands are mounted.
