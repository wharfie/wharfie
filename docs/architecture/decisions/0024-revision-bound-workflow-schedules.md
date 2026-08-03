# 0024 — Revision-bound workflow schedules

**Status:** Accepted · **Date:** 2026-07-27

## Context

ADR 0019 makes a persisted workflow run the durable execution unit and gives
the resident one verified path for starting and continuing that run. It
deliberately leaves scheduled starts prospective. The strict version 2
manifest still rejects schedule declarations.

Wharfie needs a small bridge between an authored CLI and work that remains
active after the authoring session ends. A resident cron trigger is part of
that bridge, but it must not become a second execution engine. It also cannot
derive authority by scanning run history, workflow timers, or the ready-work
index: those records describe work that has already been admitted, not which
wall-clock occurrences a schedule has considered.

The first slice needs deterministic occurrence identity, bounded catch-up, and
response-loss recovery. It does not need the full policy surface of a hosted
scheduler.

## Decision

### A schedule starts one named workflow with static JSON input

The first schedule kind targets exactly one workflow in the same immutable
application revision. Its input is one bounded plain JSON value sealed with
that revision. It has no callback, expression evaluator, environment lookup,
clock-dependent input builder, or activity target.

The schedule definition has a revision-bound identity derived from the
application ID, revision ID, schedule ID, referenced workflow and plan, the
canonical cron expression, and the canonical static input. A pending
occurrence always retains that exact definition identity. Deploying another
revision never reinterprets an already pending or started occurrence with a
new workflow plan or input.

### Cron V1 is a small canonical UTC language

The initial expression is exactly five fields separated by one ASCII space,
with no leading or trailing whitespace:

```text
minute hour day-of-month month day-of-week
```

Fields have these inclusive numeric domains:

- minute: `0` through `59`;
- hour: `0` through `23`;
- day of month: `1` through `31`;
- month: `1` through `12`; and
- day of week: `0` through `6`, with Sunday represented only by `0`.

Each field is either `*` or a comma-separated, strictly ascending list of
canonical base-10 decimals. Lists cannot contain duplicates. A decimal has no
leading zero unless it is exactly `0`. A list covering the field's complete
domain is rejected in favor of `*`. Tabs, repeated spaces, and every other
whitespace spelling are invalid.

Cron V1 has no names, aliases, macros, ranges, steps, seconds, timezone
qualifier, alternative Sunday value, or implementation-specific extension.
The manifest compiler rejects a noncanonical expression instead of silently
normalizing it. It also rejects each selected day-of-month token that cannot
occur in any selected month. February 29 remains valid because it occurs in
leap years.

Expressions are evaluated against Gregorian calendar minutes in UTC. An
occurrence's `scheduledAt` is the exact matching UTC minute as a nonnegative
safe Unix timestamp in milliseconds divisible by 60,000. When both
day-of-month and day-of-week are restricted, a date matches when either field
matches. When only one is restricted, that field controls; when both are `*`,
every otherwise valid date matches. Within an otherwise valid expression, a
selected day that does not exist in one particular selected month simply
produces no occurrence in that month.

Wall-clock observation establishes only that an occurrence is eligible. It is
not the occurrence's identity and does not promise that work begins at the
scheduled minute.

### Occurrence identity names logical time, not an execution attempt

The occurrence ID is deterministically derived from exactly the application
ID, schedule ID, and canonical `scheduledAt` value under a versioned
domain-separation tag. It does not include the revision ID, definition digest,
resident observation time, coordinator or owner identity, retry count, or
physical workflow attempt.

Omitting the revision is deliberate: one logical application schedule at one
logical minute has one occurrence identity across response loss and revision
handoff. If two revision-bound definitions contend for that same identity,
their differing workflow-start request cannot both be accepted; the conflict
fails closed instead of creating two logical runs or silently changing the
first one's definition.

Distinct scheduled minutes have distinct occurrence IDs. Their workflow runs
may overlap. Acceptance of one start does not wait for that workflow to reach
a terminal state, and the first slice has no singleton, skip-while-running, or
maximum-concurrency policy.

### One durable schedule cursor bounds missed work

Every revision-bound schedule definition has a separate durable schedule
cursor. The cursor records its definition identity, activation boundary,
wall-clock horizon already considered, at most one pending occurrence, and
the retained workflow-start decision needed to resume after failure. Cursor
updates use the resident's current ownership authority and fail closed on a
stale definition or owner.

The schedule cursor is not a workflow cursor, workflow timer, ready-work row,
run-history entry, or scan over any of those structures. Those existing
records cannot substitute for it. A workflow timer advances an already
admitted run; a schedule cursor decides which external wall-clock occurrence
may request a new run.

For each observation, the resident considers matching UTC minutes after the
cursor's prior horizon and no later than the observed minute. If multiple
unhandled occurrences are due, it durably selects only the latest one and
advances the horizon across the older occurrences. The older occurrences are
missed and will not later be backfilled. The bounded evaluator reports the
selected newest due minute, `scannedMinuteCount`, and skip metadata containing
`count`, `firstScheduledAtMs`, and `lastScheduledAtMs`. It fails instead of
returning partial skip metadata if its declared evaluation bound cannot prove
the whole window. At most one selected occurrence is pending at a time.

An unresolved pending occurrence is retried before another is selected; it is
never replaced merely because a later minute becomes due. Once that start
decision is resolved, the next observation again collapses any newly missed
window to its latest matching occurrence. This bounds backlog without using
workflow completion as a scheduling lock.

The cursor's durable activation boundary prevents a newly introduced schedule
from enumerating time before that exact definition became active. Restart
uses the retained boundary and horizon rather than treating process start time
as new schedule authority.

### Scheduled starts reuse the workflow-start transaction

Only the resident that owns the exact application revision may observe and
advance that revision's schedule cursor. It validates the schedule and
workflow against its sealed manifest identity before requesting a start.
Loading another revision's source or accepting an ambient caller-selected
workflow is not allowed.

After durably selecting an occurrence, the resident calls the existing
workflow-start path with the occurrence ID as the stable idempotency key, the
sealed static input, and the exact referenced workflow plan. A lost response
leaves the occurrence pending. Restart repeats the same workflow-start request
and receives the retained decision; it does not create a new run ID or
increment a schedule retry identity. The pending occurrence is cleared only
after the cursor retains the matching start receipt.

The execution-ledger run remains `trigger.kind: "workflow"` so scheduling does
not fork workflow continuation, recovery, cancellation, signal, inspection,
or activity-dispatch semantics. Its workflow trigger gains a nested,
authoritative schedule cause containing the schedule ID, occurrence ID,
canonical `scheduledAt`, and revision-bound definition identity. This cause is
part of the verified start request and event, not optional caller metadata.
A manually started workflow has no such cause.

The schedule cursor authorizes occurrence selection. The execution ledger
authorizes the workflow run and all later execution transitions. Neither
authority is reconstructed from the other's inspection projections.

### The public manifest changes only with an executable vertical

Schedules require a strict application manifest schema version 3. They are not
added as an optional version 2 field, and version 2 continues to reject them.
The repository must not accept or package a version 3 schedule declaration
until the compiler, immutable revision identity, durable cursor, resident
ownership, workflow-start replay, trigger cause, source path, packaged path,
and restart tests form one executable vertical.

Once that vertical replaces the current public contract, the loader accepts
the one exact version 3 shape. There is no compatibility alias, inert schedule
configuration, dual-write path, or best-effort downgrade to an unscheduled
version 2 application.

### The first execution slice is intentionally narrow

The first slice adds no public command to fire, backfill, skip, edit, pause, or
resume an occurrence. It adds no per-schedule timezone, daylight-saving-time
policy, direct activity schedule, dynamic input, calendar exception, jitter,
overlap suppression, catch-up-all mode, hosted scheduler API, or trustless
clock claim.

It also makes no exactly-once claim for application work or external effects.
The ledger can retain one authoritative logical workflow-start decision for an
occurrence and replay it after response loss. Activities and managed effects
still obey their existing fenced evidence, uncertainty, reconciliation, and
idempotency contracts; a process can fail after performing external work and
before reporting its evidence.

## Consequences

- A schedule produces an ordinary durable workflow run, so manual and
  scheduled workflows share continuation, worker, recovery, and operator
  behavior.
- Stable logical occurrence IDs make a lost start response retryable without
  tying identity to one process, observation, or revision.
- Latest-only catch-up bounds restart work while allowing independently
  scheduled logical runs to overlap.
- A separate cursor makes missed-occurrence policy explicit instead of hiding
  it in run-history scans or workflow timers.
- UTC-only canonical cron avoids timezone and daylight-saving ambiguity in the
  first portable execution slice.
- Manifest version 3 cannot become a partially working authoring promise; its
  schedule surface remains rejected until it can actually execute and recover.

## Rejected alternatives

### Put the revision ID in the occurrence ID

Rejected because deploying a new revision could give the same application
schedule and UTC minute a second logical identity. The selected start is bound
to an exact revision definition separately and conflicts on incompatible
replay.

### Scan workflow runs to discover whether a minute fired

Rejected because run history is an inspection locator, cannot record a missed
window or pending response-loss retry safely, and would make liveness depend
on an unbounded secondary scan.

### Reuse workflow timers or the ready-work index

Rejected because both describe work already admitted to an execution. A cron
occurrence needs durable authority before a workflow run or ready activation
exists.

### Backfill every missed occurrence

Rejected because downtime could create an unbounded burst of stale work. The
first policy retains at most one pending occurrence and selects the latest
match in each newly observed window.

### Skip a start while its prior workflow is running

Rejected because overlap suppression needs another durable concurrency policy
and makes a previous run's terminal state part of schedule admission. Initial
occurrences are independent.

### Expose a manual fire command first

Rejected because an operator bypass would create occurrence identity and
authorization semantics before the resident cursor and replay path exist.

### Accept schedules in manifest version 2 before execution exists

Rejected because an inert or partially honored declaration would make the
portable manifest claim behavior that source and packaged residents cannot
yet provide.
