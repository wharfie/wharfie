# Wharfie checkpoint — ledger-backed `ops run`

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Base:** `80fb4d6` (`Harden execution ledger replay validation`)
- **Scope:** first end-to-end durable manual activity path. This supersedes the
  earlier isolated-ledger-only handoff for `ops run`; it does not yet provide a
  resident service, leases, general history, cancellation, effects, schedules,
  or multi-node coordination.

This is a historical handoff. Preserve earlier checkpoints and append a later
one rather than rewriting this record.

## What now works

- `wharfie ops run` no longer creates a mutable Operation/Action graph. It
  writes a separate `WHARFIE_EXECUTION_LEDGER_TABLE` (default
  `wharfie-execution-ledger`) in the existing durable control-store path.
  DynamoDB must use a distinct physical table because the ledger key is
  `run_id`/`sort_key`; local stores can share a path under a different table.
- A user-visible `--operation-id` deterministically derives a ledger run ID
  scoped by application ID. Reusing it with identical revision, activity,
  input, and caller metadata returns the retained terminal. Reusing it for
  changed work raises a visible ledger run conflict.
- `markAttemptStarted` now returns the exact immutable Protocol-v1 start frame
  only after the durable `STARTED` transition is readable. The CLI dispatches
  that frame through `invokeManifestActivityAttemptWithStart`, which validates
  it against the sealed revision and activity without generating local IDs.
  A replayed start receipt has `dispatchAuthorized: false`: it proves a start
  was recorded but not whether another process already delivered it, so the
  runner blocks it as uncertain instead of dispatching twice. The same flag is
  false if a newer recovery or terminal transition wins between the durable
  start write and its readback, preventing dispatch from a stale projection.
- The path is:

  `create → claim → STARTED → framed activity attempt → verified terminal`

  The terminal event atomically records validated evidence, logical outcome,
  and projections. Verified `failed`/`protocol-failed` terminals become
  terminal failures; runtime, transport, malformed-evidence, unsupported
  cancellation/deadline, or terminal-commit uncertainty after `STARTED`
  become `BLOCKED`/`UNCERTAIN` rather than a replay.
- A normal repeated command never takes a `RUNNING` claim because there is no
  durable coordinator lease yet. `ops run --recover` is an explicit operator
  assertion that the prior local runner is dead: it can abandon a `CLAIMED`
  attempt that never began, while a `STARTED` attempt is marked uncertain and
  is never redispatched. Recovery requires `--operation-id`, refuses a missing
  run rather than creating work, and reads durable state before parsing current
  input or compiling current activity source. It can therefore mark a started
  run uncertain after source drift or a broken current activity build.
  Replayed/ambiguous claim receipts and stale attempt-cleanup paths also never
  start or mutate a newer attempt generation.

## Important current limitations

- The legacy mutable `ops list`, `ops cancel`, OperationsStore, and related
  graph path still exist for old commands. They do **not** observe ledger-backed
  `ops run`; quickstart documentation no longer advertises them. Replace or
  delete that surface only alongside an honest ledger inspection/cancellation
  design.
- There is no resident process manager, live coordinator/lease, heartbeat,
  automatic recovery, payload reference store, retry policy, cancellation
  decision, or durable effect/outbox contract. Do not infer exactly-once
  execution from this local single-activity slice: only destination-side
  atomic boundaries can earn that claim.
- Source verification is preflighted before a claim and rechecked by the
  runtime. Bundle preparation can still fail after `STARTED`; that is
  intentionally conservative and produces `UNCERTAIN` rather than claiming no
  code could have run.
- `ops run --recover` still loads the current manifest to derive its
  app-scoped run ID. A future source-independent operator command must recover
  by persisted `runId` even if the manifest or app ID no longer exists.
- The control-store trust boundary from the preceding hardening checkpoint is
  unchanged: record IDs/digests detect inconsistent history but do not
  authenticate against a writer that can replace a whole valid history.

## Verification at this handoff

- `npm run lint`
- `npm run typecheck`
- Focused source/CLI/config suite:

  ```text
  node test/run-jest.js --runInBand --runTestsByPath \
    test/runtime/manual-ledger-run.test.js \
    test/runtime/services/activity-json-values.test.js \
    test/runtime/unify-db-config.test.js \
    test/cli/cmds/ops-run-command.test.js \
    test/cli/cmds/operations-command-errors.test.js \
    test/cli/docs-command-surface.test.js
  ```

- Ledger contract suite passed for the DynamoDB contract double and vanilla
  adapter. LMDB is intentionally skipped in that targeted invocation because
  the sandbox-native addon abort remains an environment limitation documented
  by the earlier handoff.

## Suggested next work

1. Decide and implement a durable local resident-service lifecycle with a
   single ownership rule before allowing unattended automatic recovery.
2. Move inputs/results/logs to immutable content-addressed payload references
   before increasing payload sizes or adding schedules, queues, effects, or
   workflows.
3. Design ledger run inspection and cancellation together, then retire the
   mutable OperationsStore command surface rather than dual-writing it.
4. Add a source-independent `runId` recovery/inspection entry point before
   treating operator recovery as complete.
