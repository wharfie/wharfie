# 0026 — Resident revision-bound workflow schedules

**Status:** Accepted, amended 2026-08-27 · **Date:** 2026-07-27

## Context

ADR 0024 defines canonical UTC workflow schedules and ADR 0025 gives a due
occurrence one atomic admission transaction with its ordinary workflow run.
Both decisions deliberately kept public authoring on strict manifest version 2
until schedule compilation, resident observation, source and packaged
execution, restart recovery, and shutdown behavior formed one coherent
vertical.

Wharfie's product path also starts with a normal local CLI. Requiring every
application to invent a workflow or schedule would make the first step less
approachable, while accepting schedule configuration that a resident does not
execute would make the manifest dishonest.

## Decision

### Manifest version 3 is the only accepted application contract

The source compiler, runtime validator, revision compiler, embedded manifest,
packager, examples, and public TypeScript declarations accept only
`schemaVersion: 3`. Version 2 is rejected without a compatibility alias,
downgrade, or dual-read path.

`workflows` and `schedules` remain optional so an application can progress from
a developer-owned CLI to named activities, durable workflows, and unattended
recurrence without inert scaffolding. Each map must be nonempty when declared.
A schedule targets one workflow declared by the same manifest; the public type
surface and runtime validator reject an unknown target.

The schedule definition, canonical UTC cron language, static JSON input,
latest-only catch-up, overlap-allowing runs, bounds, identities, and
no-exactly-once-external-effect limit remain those of ADR 0024 as amended by
ADR 0025.

### Schedules bind to one sealed execution

The resident derives schedule bindings only from a fully validated
source-prepared or embedded execution. Each binding contains the exact
application revision, schedule definition ID, target workflow ID, normalized
workflow plan ID, and sealed workflow plan payload.

A source resident re-verifies its prepared source before initial activation
and before advancing into a later observed minute. An embedded resident uses
the same manifest-to-binding path. No schedule accepts an ambient workflow
definition, caller-selected revision, or mutable source object.

Every cursor returned by activation, no-due advancement, or post-admission
reread must still match the observer's application, schedule, revision, and
definition. A same-owner observer for another revision may replace durable
cursor state, but the displaced observer fails rather than caching or
advancing the foreign cursor.

### Observation is concurrent; physical work remains serial

One schedule observer runs beside the existing resident ready-work loop under
the same held resident ownership. It evaluates every manifest schedule against
an injected UTC wall-clock horizon, activates or resumes its exact cursor, and
uses ADR 0025's transaction to admit at most the selected latest due occurrence
as an ordinary workflow run.

The committed ready-work row is durable authority. A local wake notification
only shortens dispatch latency. Schedule observation does not create a second
workflow engine and does not make physical activities concurrent: the existing
worker still dispatches at most one physical activity attempt at a time.
Consequently, a long activity cannot suppress logical schedule observation,
while scheduled work waits in the ordinary durable ready-work path for serial
execution.

### Initial catch-up gates readiness

The service does not mark itself `READY` or accept owner commands until the
observer has successfully probed the exact ownership and selected-revision
fences, activated every schedule definition, and observed the initial minute.
An application with no schedules completes the same authority probe and may
then become ready without inventing durable schedule state.

Restart preserves an exact definition's activation boundary, horizon, and
cursor version. A changed revision or definition starts at the later of the
current wall-clock observation and the prior cursor's durable `updatedAt`
floor. Backward wall-clock correction therefore cannot move schedule authority
or a replacement definition behind durable progress.

An occurrence and workflow run already committed before activation cutover
remain an exact replay after the revision enters `QUIESCING`; they were admitted
at the earlier atomic linearization point. An uncommitted admission loses the
activation fence and creates neither projection nor cursor progress.

As amended by
[ADR 0036](0036-durable-coordinator-admission-provenance.md), an
authority-bound occurrence uses strict occurrence schema version 2 and retains
the same stable coordinator token as its atomically created workflow event.
Fresh-coordinator replay preserves that original token. Schema version 1 is
the exact legacy/unbound shape; absence is not attributed to a later
coordinator. A missing, malformed, application-mismatched, or cross-record
disagreeing token fails closed.

### Observer failure is resident failure

Ownership loss, activation closure, source drift, cursor replacement, invalid
time, or another observer failure aborts worker admission, closes commands, and
requests the durable service's `STOPPING` transition exactly once. The active
physical attempt receives the existing bounded drain treatment. Schedule
observer shutdown is also bounded, and observer, worker, stopping-transition,
and cleanup failures remain visible rather than becoming unhandled promises.

External shutdown and internal observer failure use the same idempotent
lifecycle path. The worker never remains durably `READY` while its scheduling
authority is dead and it is only waiting for an activity drain.

## Consequences

- A small CLI-only version 3 application remains valid and can adopt durable
  behavior incrementally.
- Source and packaged revisions serialize the same schedule definitions and
  resolve them through the same resident binding and workflow execution path.
- Revision cutover, response loss, owner replacement, restart, and backward
  wall-clock correction retain explicit durable behavior.
- Logical schedule admission can continue during long activity execution
  without changing the single-activity physical concurrency model.
- Manifest version 2 is fully abandoned; old applications must be rewritten.
- The actual relocated Linux SEA due-occurrence and cursor-recovery proof is
  still required. Current evidence covers package serialization, embedded
  execution composition, source verification, and vanilla control-store
  recovery, not a new native SEA or LMDB run on the development Mac.
- There is still no schedule list, inspect, pause, resume, manual-fire,
  timezone, dynamic-input, direct-activity, catch-up-all, singleton, or hosted
  scheduling surface.
- Wharfie retains one authoritative logical run decision per occurrence. It
  does not claim exactly-once application code or external side effects.

## Rejected alternatives

### Require workflows and schedules in every version 3 manifest

Rejected because it would force ordinary CLI applications to invent inert
durable behavior and work against the local-first progression.

### Keep version 2 for unscheduled applications

Rejected because dual public schemas and downgrade behavior add compatibility
work with no downstream-user requirement. One strict version 3 contract is
faster to evolve and easier to reason about.

### Observe schedules inside the serial activity loop

Rejected because one long activity would delay logical time observation and
turn physical execution duration into undocumented catch-up behavior.

### Start scheduled work through a separate execution engine

Rejected because ordinary workflow creation, recovery, cancellation,
inspection, timers, signals, and ready-work dispatch already provide the
required durable semantics.

### Treat a local wake notification as schedule authority

Rejected because process death can lose notifications. The atomic cursor,
occurrence, workflow run, and ready-work records remain the recoverable truth.
