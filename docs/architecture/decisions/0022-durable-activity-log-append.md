# 0022 — Durable activity-log append before acknowledgement

**Status:** Accepted · **Date:** 2026-07-27

## Context

Activity Protocol v1 gives every component frame an attempt identity and a
positive sequence. The source-side transport already sends component frames
one at a time and waits for a host acknowledgement, but the host currently
acknowledges log frames after only accepting them in process memory. A crash
can therefore erase output that the activity was told had been accepted. The
terminal evidence retained by the execution ledger cannot repair that gap:
logs emitted before an uncertain or interrupted attempt may never reach a
terminal transcript.

Wharfie's purpose is to carry a user's work beyond one local process or chat
session. A durable service cannot treat acknowledged diagnostic output as
ephemeral process output. It also must not overstate what retaining a log
proves about activity execution or external effects.

## Decision

### Acknowledgement follows the selected host sink

The activity host exposes one optional ordered component-frame sink. With no
sink, the existing in-memory transport behavior remains available for
non-durable callers. When a durable runner installs a sink, the host sends a
positive component acknowledgement only after that sink resolves. A rejected
sink produces a negative acknowledgement and fails the physical attempt.

The host permits only one component delivery to await settlement. It does not
begin a managed effect until the corresponding effect-request frame has been
accepted by the sink. A terminal is likewise acknowledged only after sink
acceptance and after all previously dispatched host effects have settled.
Late sink settlement after worker exit, replacement, cancellation, or failure
is inert.

The durable runners initially select a sink only for `log` frames. Other
component frames keep their existing ledger-specific authority and are
accepted as ordering barriers without being duplicated into the log store.

### Each log belongs to one exact physical attempt

The execution ledger exposes a bounded append operation containing the exact:

- application and revision;
- run, invocation, activity, and physical-attempt identities;
- attempt generation, coordinator epoch, and fencing token; and
- validated Activity Protocol v1 log frame.

The store derives a domain-separated, fixed-length partition identity from
that complete scope. Log records use an auxiliary partition in the same
transactional table as the authoritative attempt projection. They are not
inserted into the run's event partition and do not advance its head, version,
sequence, projections, ready-work locator, or logical outcome.

The auxiliary partition has one head and immutable sequence-keyed entries.
The head retains the exact non-secret scope and fence coordinates, last
accepted log sequence, entry count, cumulative canonical payload bytes, and
its own version. Each entry retains those coordinates, Activity Protocol
sequence and level, immutable payload reference, and host acceptance time.
The partition identity binds the raw fencing token through a domain-separated
digest, but auxiliary rows do not duplicate that token; the ordinary private
attempt projection remains its retained authority. The logical run identity
is stored separately from the physical table's partition-key field so the
auxiliary scope cannot be mistaken for a run partition.

Log order is attempt-local. Activity Protocol sequences may be sparse because
effect and terminal frames share the same sequence space. A fresh append must
have a sequence greater than the last accepted log sequence. Wharfie makes no
cross-attempt order claim, and acceptance timestamps are observations rather
than execution authority.

### Append is fenced, atomic, and replay safe

Before an append can authorize a positive acknowledgement, the store validates
the log frame and immutable scope, publishes the canonical frame through the
content-addressed payload store, then reads and re-hashes those bytes. One
transaction:

1. condition-checks the exact ordinary attempt projection as `STARTED`,
   including its schema, revision, invocation, attempt, generation,
   coordinator epoch, fencing token, and version;
2. creates the immutable sequence entry; and
3. creates or exactly advances the auxiliary log head.

The payload may have been published when that transaction loses its race or
the process crashes. Such an unreferenced content-addressed object grants no
log authority and produces no acknowledgement.

An exact retry of an already retained sequence reads, re-hashes, and compares
the existing entry and payload before returning idempotent success, including
after the attempt has become terminal. Reusing the sequence for different
content, encountering a corrupt or incomplete retained partition, submitting
an out-of-order new sequence, or losing the exact attempt fence fails closed.
A transaction response may be lost after commit; rereading an exact retained
entry turns that retry into idempotent success without a second entry.

This is an append-once evidence contract, not exactly-once activity execution.
It does not prove that an activity emitted a message only once, that an
operator displayed it once, or that a related external effect occurred.

### Retention and disclosure are deliberately bounded

One physical attempt accepts at most 256 log entries and at most 8 MiB of
canonical log-frame payload bytes. A frame is also subject to the Activity
Protocol's existing 1 MiB encoded-frame limit. Crossing either cumulative
limit rejects the append and therefore prevents a positive acknowledgement.
There is no silent truncation, eviction, sampling, or time-based cleanup.
Initial retention follows the retained run; garbage collection is a later
explicit lifecycle contract.

Log messages and fields are arbitrary application-controlled sensitive data.
This slice provides no reader, tail, search, render, CLI, web UI, export,
redaction promise, field filtering, or new encryption contract. Existing
provider-level storage protections may still apply, but are not reinterpreted
as application-level disclosure safety. A later reader must define
authorization, disclosure, corruption handling, pagination, and rendering
before these payloads are exposed.

## Consequences

- A durable runner cannot positively acknowledge a log that exists only in
  process memory.
- Crash recovery can distinguish an exact committed append from an
  uncommitted or conflicting retry.
- Stale coordinators and stale physical attempts cannot append through a
  changed attempt projection.
- Logs from interrupted and uncertain attempts survive independently of a
  terminal transcript.
- The normal append-only execution history remains unchanged and remains the
  sole authority for lifecycle and logical outcomes.
- A sink outage or exhausted log budget fails the physical attempt instead of
  silently discarding acknowledged output.
- Operators cannot read retained logs until a separate disclosure contract is
  implemented.

## Rejected alternatives

### Persist only the final transcript

Rejected because a crash or uncertainty boundary can prevent any terminal
transcript from being committed after earlier logs were acknowledged.

### Acknowledge before starting asynchronous persistence

Rejected because process or machine failure would make acknowledged output
disappear.

### Add logs as normal execution-ledger events

Rejected because chatty application output would advance lifecycle versions,
contend with authoritative transitions, and conflate diagnostic retention with
execution truth.

### Expose a reader in the same slice

Rejected because raw messages and fields need an explicit authorization and
disclosure model. Durable storage is useful recovery groundwork without
prematurely creating a public sensitive-data surface.

### Claim exactly-once logging

Rejected because append idempotency establishes one retained entry per exact
attempt sequence. It does not prove unique emission, display, delivery to
another sink, or activity execution.
