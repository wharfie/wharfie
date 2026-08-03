# Wharfie checkpoint — execution ledger hardening

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Foundation commit:** `48b3146` (`Add append-only execution ledger foundation`)
- **Scope:** follow-up hardening to the first isolated manual-activity ledger;
  it still does not route `ops run` or the resident worker through that ledger.

This is a historical handoff. Preserve prior checkpoints; update the roadmap or
write a new dated checkpoint for later work.

## What this follow-up adds

- `cloneBoundedJsonValue` and `cloneBoundedJsonObject` enforce an exact UTF-8
  JSON cap while cloning. They account for strings without first allocating a
  fully escaped copy, so a rejected oversized terminal cannot first create a
  full duplicate in memory.
- Ledger transition options, persisted event/projection snapshots, and attempt
  evidence use bounded JSON intake. Evidence is capped at 64 KiB and at 512
  frames; an obvious oversized frame list is rejected before deep cloning or
  transcript replay.
- Rebuild now enforces exact snapshot and event-payload shapes, lifecycle field
  presence by status, valid predecessor/next-status pairs, stable invocation
  generations, and equal uncertainty/abandonment reasons.
- Rebuild recomputes each transition request digest from its prior folded state
  and event snapshots. A receipt matching a rehashed but semantically detached
  digest is rejected rather than altering idempotency behavior.
- Manual creation rejects a nonzero `coordinatorEpoch` until durable
  coordinator ownership exists. Previously it could write a run that the fold
  correctly—but only after the write—refused to verify.

## Trust boundary

The ledger assumes trusted writers to its backing table/control store. Its
content IDs and recomputed digests make partial corruption and inconsistent
records fail closed; they are not tamper authentication against an actor able
to replace a whole semantically valid event history and its projections. If
untrusted storage writers become in scope, add a signed or MACed chain rooted
outside that writer before claiming tamper resistance.

## Verification at this handoff

- `npm run typecheck`
- `npm run lint`
- `node test/run-jest.js --runInBand --runTestsByPath test/runtime/services/activity-json-values.test.js test/runtime/execution-ledger-record-key.test.js`
- Ledger contract tests passed against the in-memory DynamoDB contract double
  and vanilla adapter.

The LMDB contract process aborts with status 134 in this sandbox on both Node
23.11.1 and Node 24.13.1, before Jest can report a test result. Treat that as
an environment/native-addon verification limitation, not a passing LMDB run.
The repository's full suite also remains unsuitable here because gRPC cannot
bind `127.0.0.1`; do not change dependency manifests to chase the separate
clean-install parser issue without the user's explicit approval.

## Next work

1. Review and commit this hardening follow-up to draft PR #125.
2. Add a local ledger store/path and route exactly one manual activity through
   `CLAIMED → STARTED → terminal/UNCERTAIN`, calling `markAttemptStarted`
   immediately before handing the protocol start to the framed runtime.
3. Design content-addressed immutable payload references before broader durable
   activity inputs/results or high-volume logs.
