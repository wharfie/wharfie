# Wharfie checkpoint — workflow activity failure terminals

- **Date:** 2026-07-19
- **Status:** **COMPLETE — implementation and exact post-change validation are
  recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `b866ccc26c79d50a34fb71011b89129b4db60a33`
- **Implementation receipt:** `f1134fe4577e53f5d3a21d03c5c577f18066e272`
- **Parent checkpoint:** [workflow activity recovery and completed
  reconciliation](2026-07-19-v7-workflow-activity-recovery.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md),
  and [ADR
  0019](../../docs/architecture/decisions/0019-persisted-linear-workflow-continuations.md)

This checkpoint records honest terminal failure for cursor-bound workflow
activities. Exact direct or uncertainty-reconciled Activity Protocol evidence
ending in `failed` or `protocol-failed` now fails the logical workflow without
inventing an output, successor, retry, or ready-work row.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v8-workflow-activity-failures.md`. Work on branch
> `agent/strict-manifest` at or after implementation receipt `f1134fe`. Read
> `PROJECT.md`, `ROADMAP.md`, ADR 0011, ADR 0019, and this checkpoint before
> editing. Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0.
> Work locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Preserve the V10 append-only event authority, exact run-head and
> cursor CAS, immutable payload rehashing, receipt-event-anchored replay,
> generation/fence guards, transactionally maintained ready-work V2 rows, and
> the rule that an uncertain physical attempt is never silently redispatched or
> rewritten. The next tranche is resident dispatch for workflow `ACTIVITY` and
> `RECOVERY` rows: dispatch only exact runnable cursors, release only unstarted
> claims, commit supported terminals through the generic terminal API, and
> block lost started attempts. Then mount shared source/packaged workflow
> start, inspect, and reconciliation commands and prove process-kill recovery
> through the relocated SEA. Keep cancellation, deadlines, timers, signals,
> general cloud IaC, trustless mesh semantics, arbitrary workflow-code replay,
> and backward compatibility outside that tranche.

## Product direction retained

Wharfie remains a local-first framework for turning a normal TypeScript CLI
with named activities into a self-contained executable that can remain
resident as a durable service and later coordinate work across trusted
machines. One recoverable coordinator is sufficient initially. Node/TypeScript
remains the primary boundary, while native bindings, subprocess protocols, and
WASM remain available for measured hot paths. Exactly-once language applies
only to evidence-backed logical decisions and destination protocols, never
arbitrary physical user-code execution.

## Failure contract now implemented

The workflow cursor adds terminal dispositions `FAILED` and
`PROTOCOL_FAILED`. Both retain the exact contiguous output prefix produced by
earlier completed steps, leave the cursor on the failing activation, advance
its version and event sequence, and cannot authorize dispatch.

Two pure materializers cover the two legal origins:

- `materializeWorkflowActivityFailure` consumes an `ACTIVITY_RUNNING` cursor;
- `materializeUncertainWorkflowActivityFailure` consumes an
  `ACTIVITY_UNCERTAIN` cursor.

Each accepts only an exact `failed` or `protocol-failed` outcome. Neither
accepts an output or constructs a successor.

The supported terminal state mapping is:

| Evidence terminal | Run | Logical invocation | Direct attempt | Cursor |
| --- | --- | --- | --- | --- |
| `completed` | `RUNNING` or `COMPLETED` | `COMPLETED` | `COMPLETED` | next `ACTIVITY_RUNNABLE` or `COMPLETED` |
| `failed` | `FAILED` | `FAILED` | `FAILED` | `FAILED` |
| `protocol-failed` | `FAILED` | `FAILED` | `FAILED` | `PROTOCOL_FAILED` |

For uncertainty reconciliation, the physical attempt remains byte-identical
`ABANDONED` for all three supported terminals. The reconciliation record, not
the abandoned attempt, owns the recovered evidence and terminal decision.

## Generic terminal API and event authority

The former success-only public store method was intentionally replaced by:

```text
commitVerifiedWorkflowActivityTerminal(...)
```

This is a breaking internal API change with no compatibility shim. The method
accepts only `completed`, `failed`, or `protocol-failed` evidence for the exact
persisted attempt. `completed` retains the existing
`workflow-activity-succeeded` event. Direct failure appends the new
`workflow-activity-failed` event. Uncertain attempts continue through
`reconcileUncertainWorkflowActivityAttempt(...)` and
`workflow-activity-uncertainty-reconciled`.

All direct and reconciled terminal writes require zero managed effects. Any
host `cancel` frame, `cancelled` terminal, or `deadline-exceeded` terminal is
rejected on first write, response-loss replay, and rebuild until a durable
cursor-aware workflow cancellation decision exists.

## Direct failure transaction

For an exact `ACTIVITY_RUNNING` activation, one transaction:

- changes the run and logical invocation to `FAILED`;
- changes the physical attempt to `FAILED` and binds its evidence and terminal
  summary;
- installs the exact `FAILED` or `PROTOCOL_FAILED` cursor;
- preserves only outputs from prior completed steps;
- removes the current `RECOVERY` ready row; and
- creates no workflow output, next invocation, successor request, retry, or
  ready row.

The append event carries exact run, invocation, cursor, and attempt snapshots.
Fold and replay independently reconstruct the transition request digest,
evidence binding, terminal subtype, zero-effect requirement, and failure
cursor.

## Reconciled failure transaction

For an exact `ACTIVITY_UNCERTAIN` activation, reconciliation proves the
terminal transcript against the abandoned attempt and the exact uncertainty
event. One transaction:

- changes the run and logical invocation from `BLOCKED`/`UNCERTAIN` to
  `FAILED`;
- leaves the retained physical attempt byte-identical `ABANDONED`;
- installs the exact `FAILED` or `PROTOCOL_FAILED` cursor;
- preserves the prior output prefix without adding an output;
- records the evidence, terminal, and uncertainty link on the reconciliation;
  and
- creates no output, successor, invocation, retry, or ready row.

The request digest uses `outputRef: null` and `successor: null` for failure.
This is important for later-step failures: an earlier step's output cannot leak
into the failing step's receipt merely because it is the last item in the
cursor's output prefix.

## Replay, races, and corruption behavior

Exact response-loss replay returns the original decision without appending
another event. A changed evidence transcript or terminal subtype conflicts.
Direct failure racing uncertainty permits exactly one winner; direct or
reconciled completion racing failure also permits exactly one terminal winner.
Ready-row corruption makes the transaction fail atomically and permits retry
after repair.

Adapter tests also prove fail-closed behavior for evidence payload tampering,
cursor projection tampering, terminal event tampering, injected payload
publication failure, and injected ledger transaction failure. Content-addressed
payload publication can still leave unreachable objects after a losing
transaction; those objects grant no authority and garbage collection remains
future work.

## Exact post-change validation

Implementation receipt `f1134fe` was validated under Node 24.13.1/npm 11.12.0:

- ESLint and repository-wide JavaScript/JSON Prettier checks passed;
- all four TypeScript lanes passed: source, app implementation, tests, and SEA
  verifier;
- the full Jest run passed 90 suites and 1,414 tests with one intentional skip;
- the dedicated failure matrix passed 63 tests across DynamoDB mock, vanilla,
  and LMDB adapters;
- native LMDB close/reopen coverage passed all 4 workflow activity tests,
  including second-step direct `failed` and reconciled `protocol-failed`;
- package-content verification accepted 127 files;
- the native external integration passed after fetching its lockfile-pinned
  tarball;
- the production dependency audit found zero vulnerabilities;
- the installed and relocated SEA crash/recovery proof passed with Node absent
  from `PATH`; the executable was 143,106,768 bytes; and
- staged and unstaged `git diff --check` checks were clean.

The full test run covers the new contract, lifecycle, resilience, three-adapter
failure, and native LMDB suites on the exact implementation tree.

## Explicitly unsupported

The following remain intentionally unimplemented:

- direct or reconciled `cancelled` or `deadline-exceeded` workflow activity
  outcomes;
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

1. Route exact workflow `ACTIVITY` rows through the resident worker using the
   existing claim/start guards and generic terminal commit API.
2. Route workflow `RECOVERY` rows so unstarted `CLAIMED` attempts are released
   and lost `STARTED` attempts become blocked `ACTIVITY_UNCERTAIN` work without
   redispatch.
3. Prove resident drain, response-loss replay, stale cursor/revision rejection,
   and restart behavior without weakening the existing manual activity path.
4. Mount shared source and packaged workflow start, inspect, and evidence
   reconciliation commands.
5. Add source and relocated-SEA real-process kill proofs for workflow recovery.
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
  test/runtime/execution-ledger-workflow-activity-resilience.test.js \
  test/runtime/execution-ledger-workflow-activity-failure.test.js
TZ=UTC node ./test/run-jest.js --silent --runInBand \
  test/runtime/execution-ledger-workflow-activity-lmdb.test.js
```

Native LMDB tests may need to run outside a restricted filesystem sandbox.
