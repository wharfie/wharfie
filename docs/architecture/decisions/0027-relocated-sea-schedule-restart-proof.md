# 0027 — Relocated SEA schedule/restart proof

**Status:** Accepted · **Date:** 2026-07-27

## Context

ADR 0026 makes revision-bound workflow schedules executable inside the held
resident. Vanilla tests prove schedule admission, cursor recovery, source and
embedded composition, cutover, readiness, and shutdown, but they do not prove
that a relocated Linux SEA can observe a due wall-clock occurrence, execute
the workflow, survive process death, and retain one decision without Node on
`PATH`.

The existing package verifier embeds an intentionally inert leap-day schedule.
Making that artifact frequent would be misleading: the same executable remains
resident throughout a long crash/recovery matrix, so later scheduled
occurrences would be legitimate and would contaminate unrelated exact-run
assertions.

The proof also constructs large native artifacts and may download a target
Node binary. Its temporary ownership and cleanup are part of the verification
contract, not an afterthought.

## Decision

### Build a dedicated scheduled revision

The ordinary package proof keeps an inert leap-day definition with valid
static workflow input. On Linux only, the verifier builds a second revision
whose canonical schedule is due every two minutes and targets a dedicated
one-activity workflow.

The second artifact is copied to a separate location and its original build
publication is removed before execution. The copied executable runs from a
clean environment whose `PATH` contains no Node executable.

The normal long-lived verification artifact never receives the frequent
definition.

### Separate orchestration from native ports

One standalone proof driver owns the required order and assertions through
seven narrow ports:

- start a resident;
- await exact `READY`;
- await the due completed snapshot;
- signal the resident;
- perform one post-restart observation;
- clean the owned root; and
- prove that root is absent.

The driver derives the occurrence and workflow-run identities independently,
requires a real `SIGKILL` exit, requires the replacement to use the next
generation and another session, requires an exact graceful exit, and does not
return evidence until cleanup and absence verification finish.

Tests use hermetic fake ports. The production adapter uses the existing
relocated-process, lifecycle, execution-ledger, payload, and read-only
schedule-control observers.

### Snapshot logical, durable, and physical evidence

Before killing the first resident, the proof requires:

- the exact revision/definition-bound cursor at the due minute;
- the exact occurrence, cause, workflow plan, and deterministic run identity;
- one completed ordinary workflow run and its physical ledger rows;
- exactly one completed run-directory item;
- no remaining ready work or orphan payload reference;
- one byte-exact write-once result marker; and
- one byte-exact physical user-code entry record.

The generated proof activity appends and fsyncs its entry record before doing
user work. This proof-only log makes a second physical entry observable even
if a duplicate invocation later loses the exclusive marker write.

After real process death, the same relocated executable and durable paths must
reach the next resident generation. One observer poll must leave the complete
snapshot unchanged, including the physical entry count. The replacement then
stops gracefully and releases ownership.

This proves one physical entry for this bounded occurrence. It does not turn
arbitrary application code or external effects into generally exactly-once
execution.

### Use real UTC time and fail closed near boundaries

The verifier selects the next even UTC minute only after the second artifact
exists. It reserves enough time for initial readiness and requires completion,
replacement readiness, and the post-restart poll to remain in the occurrence
minute. A slow or boundary-crossing run fails rather than weakening the
snapshot comparison.

The production proof remains Linux-only. Static and hermetic validation on
another host prepares the proof but is not evidence that the native Linux run
passed.

### Contain all verifier storage under one root

The package verifier allocates one owned root before creating the tarball,
install, application, artifacts, runtime state, or caches. `HOME`, `TMPDIR`,
XDG cache/config/data, and npm cache all point beneath that root, containing
downloaded Node binaries and native build data.

Nested proof roots are removed as soon as they are no longer needed. The outer
finalizer attempts every cleanup even after failure, preserves primary and
cleanup errors together, and requires the complete root to be absent.

## Consequences

- The exact native command remains `npm run verify:package:sea` on Linux.
- A passing Linux run can honestly claim a due relocated-SEA occurrence,
  process replacement, recovered cursor, and one observed physical dispatch
  with Node absent from `PATH`.
- Hermetic tests can cover ordering, identity, replay, duplicate evidence,
  cleanup, and failure aggregation without constructing a native SEA.
- Running the proof may wait for the next selected UTC minute, but it cannot
  silently accept another cursor minute.
- V93 implementation and local validation do not themselves claim that the
  native Linux proof has run.
- Schedule `list`, `inspect`, `pause`, and `resume` remain the next public
  surface only after the external proof evidence is obtained.

## Rejected alternatives

### Make the main verifier schedule frequent

Rejected because unrelated long-lived residents would admit legitimate later
occurrences and invalidate exact-run isolation.

### Treat one successful exclusive marker as a physical dispatch count

Rejected because another physical entry could lose the exclusive write.
The proof records and fsyncs every user-code entry before the marker.

### Infer restart safety only from vanilla stores

Rejected because it would not exercise embedded manifest binding, relocated
SEA execution, native LMDB, real signals, or the Node-absent runtime.

### Run the native proof automatically on every development host

Rejected because native SEA construction and LMDB execution are
platform-specific, large, and intentionally outside the unapproved macOS test
boundary.
