# V91 atomic schedule-admission checkpoint

- **Date:** 2026-07-27
- **Status:** **COMMITTED, PUSHED, AND LOCALLY VERIFIED; MANIFEST V3 AND
  RESIDENT OBSERVATION REMAIN GATED**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `f66eece64bd93e6fdf4d460700d7c913e7e399c3`
- **Atomic admission implementation commit:**
  `7a90750fb2ab976dcbb73236a52896cdd324078b`
- **Remote implementation tip before this checkpoint:**
  `7a90750fb2ab976dcbb73236a52896cdd324078b`
- **Parent checkpoint:** [V90 workflow-schedule contract](./2026-07-27-v90-workflow-schedule-contract.md)

## Restart summary

Wharfie's target remains a normal TypeScript/Node CLI that can become one
approachable portable executable, run locally, remain resident as a durable
service, and coordinate work across trusted machines without requiring Node,
containers, Kubernetes, or a hosted orchestration service on those machines.

V91 closes the internal atomic admission boundary for one due workflow
schedule. A cursor can no longer select work in one transaction and attempt to
start it in another. Cursor progress, immutable occurrence evidence, and every
ordinary workflow-start projection now share one portable transaction fenced
by the exact application activation and resident owner.

The public authoring path remains strict manifest schema V2 and still rejects
`schedules`. No resident currently observes cron definitions, and this
checkpoint makes no source, packaged SEA, or restart-execution claim for
schedules.

Breaking changes remain acceptable. Work locally with Git CLI, exact Node
24.13.1 and npm 11.12.0, focused disposable tests, and immediate temp cleanup.
Do not run native LMDB, native SEA construction on this Mac, block-device
tools, Docker, or live cloud/resource mutation without the required explicit
authority.

## What V91 closes

### One cursor with no pending state

`createScheduleControl` now owns a strict cursor containing:

- app and schedule ID;
- exact revision and definition ID;
- activation boundary and inclusive evaluated horizon;
- positive CAS version; and
- monotonic observation time.

An exact definition restart preserves its boundary, horizon, and version even
after resident owner/session replacement. A changed revision or definition
resets the boundary to the floored observation and increments the version.
No-due advancement is one transaction fenced by:

1. the exact ACTIVE selected revision, or the existing activation-absence
   fence in trusted source mode;
2. the exact current resident owner; and
3. the exact full prior cursor on the cursor `Put`.

The module enforces monotonic time, minute alignment, the 527,040-minute scan
ceiling, exact record shapes, 32 KiB record reads, and plausible bounded skip
evidence. It reconciles a committed no-due advancement whose response is
lost.

There is no durable pending occurrence. The two-transaction selection design
recorded and rejected in V90 is superseded by ADR 0025.

### Due admission is one ordinary workflow transaction

For a due occurrence, schedule control prepares:

- one resident-owner condition check;
- one cursor CAS `Put` advancing the full evaluated window; and
- one immutable occurrence `Put` requiring absence.

The execution ledger combines that material with its existing activation
condition and complete workflow creation: event, run, transition receipt,
run-directory row, workflow cursor, first activity/timer/signal projection,
and ready-work locator when applicable.

The cursor CAS stays on its own `Put`, so no transaction targets one physical
item twice. The captured activity-headed transaction has exactly 12 unique
items: two condition checks and ten puts. Every serialized item is below
400 KiB and the measured aggregate is 16,749 bytes, far below 4 MiB and the
portable 100-item limit.

Content-addressed workflow payloads may be written first. If admission loses,
those unreferenced blobs carry no execution authority and can be collected
later.

### Opaque admission cannot cross a store

Prepared transaction material is held behind module-private weak metadata and
is deeply frozen. It is bound to:

- exact app/revision/schedule/definition/workflow/plan/run/cause identity;
- the exact DB client object; and
- the exact normalized table name.

Both resolution and reconciliation require the execution ledger to present
that same store context. A token prepared against another DB object or table
is rejected before transaction rows are exposed, reconciliation reads occur,
or the target ledger performs a write.

The token is intentionally process-local. Restart creates a fresh token from
the retained occurrence/cursor. An exact occurrence returns a write-free
replay token and still requires the matching workflow run.

### Response loss retains both sides or neither

A scheduled workflow transaction error reconciles the exact run and exact
occurrence:

- matching run and occurrence replay with `applied: false`;
- an identity mismatch conflicts;
- persistent one-sided state is projection corruption;
- both absent after a generic transport error preserve the original
  ambiguity; and
- both absent after a conditional failure are reclassified through current
  activation state.

The delayed-visibility proof withholds the actual combined transaction, lets
the first strong run read observe absence, commits, lets the occurrence read
observe the exact side, and verifies the bounded run reread returns the exact
replay from the same call.

A fresh preparation after commit proves the process-restart-shaped replay
path. Reusing an in-memory token is not the restart proof.

### Activation cutover has one winner

The focused cutover suite proves both orderings:

- if `ACTIVE` to `QUIESCING` wins, the old scheduled transaction creates no
  run or occurrence and does not advance the cursor;
- if scheduled admission wins, beginning the activation change afterward
  leaves a nonterminal ordinary workflow run visible to the existing
  quiescence scan; and
- if first managed activation creation wins against trusted source-mode
  admission, its `NOT_EXISTS` fence rejects the entire scheduled transaction
  without cursor progress.

The same suite proves a replacement resident preserves exact-definition
cursor progress while the stale owner loses its fence, and two same-occurrence
competitors converge on one event, occurrence, cursor advancement, and
workflow run.

## What remains deliberately closed

- Manifest schema V2 continues to reject schedule declarations.
- No resident loop observes schedule definitions or wall clock.
- No source or packaged command executes schedules.
- No schedule list, inspect, pause, resume, or manual-fire surface exists.
- No timezone, DST, catch-up-all, overlap suppression, direct activity target,
  or dynamic-input policy exists.
- No exactly-once application work or external-effect claim is made.
- Native LMDB and packaged SEA schedule paths were not run in V91.

## Exact next implementation

Build the schedule observer as a concurrent part of the held resident session,
not as another execution engine:

1. compile strict manifest V3 schedules against the exact sealed revision and
   referenced workflow plans;
2. construct schedule control and execution ledger over the exact same DB
   client object and table;
3. activate each definition only while the resident holds the matching app
   owner and selected revision;
4. independently observe bounded UTC windows while activity execution is in
   progress, so one long activity cannot suppress logical schedule admission;
5. admit only ordinary workflow runs through the V91 atomic path and wake the
   existing ready-work loop;
6. coordinate abort, owner loss, activation cutover, and observer failure with
   resident shutdown; and
7. prove exact cursor recovery plus source and packaged restart parity before
   replacing public manifest V2 with V3.

Before or alongside that vertical, add the remaining inexpensive hardening
proofs: generic failure before commit leaves both projections absent and
preserves ambiguity; deliberately seeded one-sided state fails closed; and
timer/signal-headed envelopes retain unique targets and comfortable byte
margins. The DynamoDB adapter still lacks its own explicit 400 KiB item/4 MiB
transaction preflight and client request token.

## Verification completed

All checks used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
Node 24.13.1
npm 11.12.0
```

Completed:

- all four TypeScript projects with `--noEmit`;
- scoped ESLint with zero warnings;
- scoped Prettier and `git diff --check`;
- 8 focused vanilla schedule-control tests;
- 5 focused vanilla owner/competitor/source/cutover/quiescence tests;
- the scheduled workflow admission, store binding, response-loss,
  delayed-visibility, restart-replay, transaction-shape, and envelope test on
  vanilla; and
- that same focused scheduled-workflow test on the in-memory mocked DynamoDB
  adapter; and
- 10 documentation command-surface tests.

Every root-owned Jest invocation used an exact owned
`/private/tmp/wharfie-v91-*` root, was measured, and was deleted immediately.
The largest root was 7.1 MiB. No root-owned V91 temp directory remains.

This is not a full-suite, native-adapter, native SEA, Docker, or live-cloud
claim.
