# Wharfie checkpoint — workflow activity recovery and completed reconciliation

- **Date:** 2026-07-19
- **Status:** **COMPLETE — implementation and exact post-change validation are
  recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `c63918655cc58f5deb6149c48ca82d7ddb661ddf`
- **Implementation receipt:** `c982e044abc80e762f2b9279548d0e4b72e2a1fb`
- **Parent checkpoint:** [verified workflow activity
  continuations](2026-07-19-v6-workflow-activity-continuations.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md),
  and [ADR
  0019](../../docs/architecture/decisions/0019-persisted-linear-workflow-continuations.md)

This checkpoint records the first honest restart boundary for cursor-bound
workflow activities. An unstarted claim can be released and reclaimed, a lost
started attempt becomes visibly blocked rather than being redispatched, and an
exact completed transcript can reconcile that uncertainty without rewriting
the abandoned physical attempt.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v7-workflow-activity-recovery.md`. Work on branch
> `agent/strict-manifest` at or after implementation receipt `c982e04`. Read
> `PROJECT.md`, `ROADMAP.md`, ADR 0011, ADR 0019, and this checkpoint before
> editing. Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0.
> Work locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Preserve the V10 append-only event authority, exact run-head and
> cursor CAS, immutable payload rehashing, receipt-event-anchored replay,
> generation/fence guards, transactionally maintained ready-work V2 rows, and
> the rule that an uncertain physical attempt is never silently redispatched or
> rewritten. The next tranche is direct and reconciled `failed` and
> `protocol-failed` workflow outcomes with an honest terminal cursor, no output,
> and no successor. Prove those outcomes before mounting resident workflow
> dispatch. Keep cancellation, deadlines, timers, signals, general cloud IaC,
> trustless mesh semantics, arbitrary workflow-code replay, and backward
> compatibility outside that tranche.

## Product direction retained

Wharfie remains a local-first framework for turning a normal TypeScript CLI
with named activities into a self-contained executable that can remain
resident as a durable service and later coordinate work across trusted
machines. One recoverable coordinator is sufficient initially. Node/TypeScript
remains the primary boundary, while native bindings, subprocess protocols, and
WASM remain available for measured hot paths. Exactly-once language applies
only to evidence-backed logical decisions and destination protocols, never
arbitrary physical user-code execution.

## Recovery contract now implemented

The workflow contract adds `ACTIVITY_UNCERTAIN` and three pure materializers:

- `materializeWorkflowActivityClaimRelease` restores the exact current
  activation to `ACTIVITY_RUNNABLE` after proving its claim never started;
- `materializeWorkflowActivityUncertainty` moves the exact activation to
  `ACTIVITY_UNCERTAIN` after a started reporter is known to be gone; and
- `materializeUncertainWorkflowActivitySuccess` derives the same logical
  successor or terminal cursor that ordinary verified success would have
  produced, starting from the blocked cursor.

The supported activity path is now:

```text
ACTIVITY_RUNNABLE
  -> ACTIVITY_RUNNING / CLAIMED
     -> ACTIVITY_RUNNABLE / ABANDONED       (unstarted release)
     -> ACTIVITY_RUNNING / STARTED
        -> ACTIVITY_UNCERTAIN / ABANDONED   (lost reporter)
           -> ACTIVITY_RUNNABLE | COMPLETED (exact completed reconciliation)
        -> ACTIVITY_RUNNABLE | COMPLETED    (ordinary verified success)
```

An uncertain cursor can be normalized, rehashed, and rebuilt from history but
cannot authorize dispatch. Cursor output bindings remain a canonical,
contiguous prefix. `ACTIVITY_UNCERTAIN` retains only outputs from earlier
completed steps; a reconciliation appends the uncertain step output exactly
once.

## Ledger APIs and event authority

The execution ledger exports these recovery APIs:

```text
abandonUnstartedWorkflowActivityAttempt(...)
markWorkflowActivityAttemptUncertain(...)
reconcileUncertainWorkflowActivityAttempt(...)
```

They append, respectively:

- `workflow-activity-abandoned-before-start`;
- `workflow-activity-became-uncertain`; and
- `workflow-activity-uncertainty-reconciled`.

Every call requires the exact revision-bound run, run head, cursor version and
continuation tuple, logical invocation, physical attempt, generation, fence,
and transition identity. Every fold rederives those bindings from immutable
plan, start, request, cursor, evidence, output, and successor payloads.

Generic manual recovery APIs remain unable to mutate workflow runs. Workflow
recovery also requires zero managed effects; effectful workflow attempts remain
unsupported until their own cursor-aware authority exists.

## Unstarted claim release

Release applies only to a workflow invocation whose retained attempt is still
`CLAIMED`. One transaction:

- retains that physical attempt as `ABANDONED`;
- restores the logical invocation to `RUNNABLE`;
- restores the cursor to `ACTIVITY_RUNNABLE`;
- keeps the workflow run `RUNNING`;
- replaces the exact `RECOVERY` ready row with `ACTIVITY`; and
- lets the next successful claim use the next generation and a new attempt.

It does not erase the old generation or invent a new logical activation.
Replay of the original release remains idempotent even after a later generation
has reclaimed the invocation.

## Lost started attempt

The uncertainty transition applies only after the exact workflow attempt
crossed `STARTED` and its trusted reporter is known to have stopped. One
transaction:

- retains the attempt as `ABANDONED`;
- changes the logical invocation to `UNCERTAIN`;
- changes the cursor to `ACTIVITY_UNCERTAIN`;
- changes the run to `BLOCKED`; and
- removes the `RECOVERY` ready row without installing a retry or successor.

This is intentionally conservative. A crash after the durable `STARTED`
decision but before physical delivery can produce no terminal transcript. In
that case the run remains honestly blocked; the ledger does not infer that the
activity was safe to execute again.

## Completed-evidence reconciliation

Reconciliation accepts only a complete Activity Protocol transcript for the
exact abandoned attempt, ending in `completed` and linked to the exact
uncertainty event and sequence. The transcript's terminal result is the only
logical output source.

The compound transaction leaves the physical attempt byte-identical as
`ABANDONED`, persists the verified evidence and workflow output, completes the
logical invocation, and atomically either:

- creates the exact next generation-0 activity invocation, advances the cursor
  to `ACTIVITY_RUNNABLE`, returns the run to `RUNNING`, and installs one
  `ACTIVITY` ready row; or
- advances the cursor and run to `COMPLETED` with no ready row.

The reconciliation event deliberately omits an attempt mutation. A forged or
altered uncertainty link, cursor, fence, evidence transcript, output,
successor, projection, or payload fails closed.

Workflow activity transcripts containing an unauthorized host `cancel` frame
are rejected during first write, replay, and rebuild. Cancellation cannot be
smuggled into completed evidence before a cursor-aware durable workflow
cancellation decision exists.

## Replay and transaction behavior

Response-loss replay is decision-oriented. It returns current run and
invocation authority together with the receipt event's cursor, output,
successor, and affected attempt. This mixed view is intentional and safe only
because every subsequent mutation still requires current run-head, cursor,
generation, and fence CAS. Tests pin release replay after reclaim and
uncertainty replay after reconciliation.

Content-addressed evidence, output, and successor payloads may be published
before a losing transaction. They grant no ledger authority and retries reuse
their digest, but unreachable payload garbage collection remains future work.

## Exact post-change validation

The implementation receipt was validated under Node 24.13.1/npm 11.12.0:

- ESLint and repository-wide JavaScript/JSON Prettier checks passed;
- all four TypeScript lanes passed: source, app implementation, tests, and SEA
  verifier;
- the workflow contract, lifecycle, and three-adapter recovery matrix passed
  3 suites and 138 tests;
- the dedicated native LMDB close/reopen recovery suite passed 2 tests; and
- staged and unstaged `git diff --check` checks were clean.

The adapter matrix covers DynamoDB mock, vanilla, and LMDB behavior for exact
replay, stale authority, generation reclaim, conflicting races, injected
payload and transaction failures, ready-row corruption, projection and payload
tampering, unauthorized cancel evidence, successor creation, and terminal
completion.

During this tranche, before the final replay/cancel-hardening additions, the
broader gates also passed 89 Jest suites with 1,338 tests and one intentional
skip, package-content verification for 127 files, a zero-vulnerability
production audit, the native external integration, and the relocated SEA proof
with Node absent from `PATH`. The final focused rerun above covers every later
production and test change. The relocated executable was 143,073,744 bytes.

## Explicitly unsupported

The following remain intentionally unimplemented:

- direct or reconciled `failed`, `protocol-failed`, `cancelled`, or
  `deadline-exceeded` workflow activity outcomes;
- automatic resolution when a lost started attempt has no trustworthy terminal
  transcript;
- resident workflow dispatch and public source/package/SEA workflow commands;
- run-level cursor-aware workflow cancellation;
- managed-effect mutation from workflow activity attempts;
- timer and signal cursor decisions and ready rows;
- garbage collection for unreachable content-addressed payloads;
- retry/backoff policy, schedules, branches, loops, parallel steps, child
  workflows, or workflow migration;
- multi-node leases, heartbeats, placement, and coordinator failover; and
- any claim that arbitrary user code physically executes exactly once.

## Ordered next tranche

1. Add direct `failed` and `protocol-failed` workflow terminals with an honest
   terminal cursor, no logical output, no successor, and no ready row.
2. Reconcile the same two outcomes from exact evidence linked to an exact
   uncertainty event, still without rewriting the abandoned attempt.
3. Prove replay, conflicting races, payload and transaction failure,
   corruption, and native LMDB close/reopen for both paths.
4. Route workflow `ACTIVITY` and `RECOVERY` rows through the resident worker,
   releasing only unstarted claims and blocking lost started attempts.
5. Mount shared source/packaged workflow start, inspect, and reconciliation
   commands, then prove real-process kill recovery through the relocated SEA.
6. Add cursor-aware cancellation before timers, signals, provider nodes, or
   multi-node coordination.

## Restart commands

```sh
git status --short --branch
git log -5 --oneline --decorate
. $HOME/.nvm/nvm.sh && nvm use 24.13.1
npm run lint
npm run typecheck
TZ=UTC node ./test/run-jest.js --silent --runInBand \
  test/runtime/workflow-execution-contract.test.js \
  test/runtime/execution-ledger-workflow-lifecycle.test.js \
  test/runtime/execution-ledger-workflow-activity-resilience.test.js
TZ=UTC node ./test/run-jest.js --silent --runInBand \
  test/runtime/execution-ledger-workflow-activity-lmdb.test.js
```

Native LMDB tests may need to run outside a restricted filesystem sandbox.
