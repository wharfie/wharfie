# 0033 — Explicit coordinator epoch authority

**Status:** Accepted · **Date:** 2026-07-28

## Context

[ADR 0002](0002-one-recoverable-active-coordinator.md) chooses one
authoritative coordinator at a time and automatic replacement through a
linearizable, store-expired lease. The execution ledger already carries
coordinator epochs in parts of its attempt fencing, but it does not yet have
one durable authority record whose stable active-authority tuple can gate
coordinator mutations in the same transaction.

The generic database contract can atomically compare and replace records in
one table. It cannot ask the store for authoritative time or condition a write
on a store-evaluated expiry predicate. A lease based on a coordinator's
`Date.now()` value would make clock skew, pauses, and delayed requests part of
the safety boundary. As [ADR 0011](0011-persisted-state-machine-execution-ledger.md)
already records, generic transactions plus caller-generated timestamps are
insufficient for safe automatic coordinator replacement.

Waiting for the final lease primitive would also defer a useful safety
boundary. Wharfie can establish explicit epoch authority and fence stale
coordinators now, while keeping automatic failure detection out of the claim.

## Decision

### One durable authority record per application

Each application has one current coordinator-authority record. The record is
stored in a separate typed namespace of the same physical table as that
application's execution ledger. Co-location is part of the correctness
boundary: the current database transaction contract is single-table, so an
authority record in a separate deployment-control table could not atomically
fence a ledger mutation.

The authority record's stable tuple contains its schema and kind, application,
coordinator, unique authority ID, monotonic epoch, and active or released
status. The full snapshot also contains a record version, diagnostic
timestamps, and request metadata. Authority state transitions compare the exact
full predecessor snapshot. Ledger mutation fences compare only the stable
active tuple, deliberately excluding heartbeat metadata so a heartbeat does
not invalidate an already issued token. Time and heartbeat fields do not grant
authority or establish that an owner is dead.

There is one active authority at the durable-store boundary, not necessarily
one process that believes it is active. A paused or partitioned predecessor may
continue computing and sending messages.

### Authority changes are explicit conditional transitions

The first coordinator acquires authority only by conditionally creating an
absent record. The current session may heartbeat or release only by comparing
the exact full active snapshot it observed.

An acquisition or takeover request identity also names the new coordinator
session. It must be generated freshly for that process session and retained
only for exact request retry. Reusing the same coordinator and request
identities in another live process deliberately reuses the same authority
capability and therefore cannot fence those processes from one another.

A successor does not infer takeover permission from heartbeat age, a local
clock, process reachability, or message silence. The caller must explicitly
affirm replacement after inspecting the current record and operational
evidence; the future production operator path will own that decision and record
its own audit context. The successor then conditionally replaces that exact
full predecessor snapshot and increments the epoch by one. Concurrent
successors that observed the same predecessor race on one compare-and-set; at
most one can win. Epoch exhaustion fails closed.

An ambiguous acquire, release, heartbeat, or takeover result is resolved by a
retained stable-request receipt and strong readback of the intended successor.
A timeout is not treated as proof that the conditional write failed.

Heartbeats are diagnostic only. They help an operator decide whether to
investigate or confirm takeover, but they are neither renewable leases nor an
automatic failure detector.

### Every authoritative mutation must be epoch-fenced

A coordinator acts with a token containing one stable active-authority tuple.
Every coordinator-issued assignment, scheduling decision, and authoritative
commit must conditionally compare the tuple's schema, kind, application,
coordinator, authority ID, epoch, and active status in the same durable
transaction as the mutation. New physical assignments also carry the epoch.
Heartbeat metadata is not part of the fence.

Once a confirmed successor commits a higher epoch, a predecessor may still
perform physical work, but it cannot commit coordinator-authoritative ledger
state. Ambiguous external work remains subject to Wharfie's existing durable
uncertainty and reconciliation rules; epoch fencing does not make an
unmanaged external mutation exactly once.

Mutation paths that cannot atomically validate the current authority in their
destination do not inherit this guarantee merely because they carry an epoch.
They need a destination-local fence or a future provider transaction boundary
that can include both records.

### Automatic replacement remains deferred

This decision is a bounded precursor to ADR 0002, not a replacement for its
automatic-recovery goal. Automatic takeover requires a provider-certified
semantic lease primitive that supplies:

- linearizable acquire and renewal;
- expiry evaluated from store-authoritative time;
- an atomic expiry predicate and monotonic epoch transition;
- exact fencing conditions for authoritative writes; and
- strong readback after ambiguous outcomes.

The generic database API is not that primitive. Wharfie will not claim
automatic coordinator failover until a provider-backed implementation and
crash-boundary proof establish those semantics.

## Consequences

- The authority state machine and an authority-bound execution ledger can
  safely replace a coordinator after deliberate confirmation without
  depending on stopping the old process.
- A coordinator crash does not currently trigger automatic recovery. The
  application remains unavailable for new authoritative commits until a caller
  explicitly confirms takeover; a production operator path remains future
  work.
- Heartbeat freshness is useful evidence but never authority.
- The execution-ledger transaction budget includes one additional authority
  condition, and every direct mutation path must be audited rather than only
  the common transition helper.
- The first implementation is an opt-in kernel. Production coordinator
  assembly must acquire a fresh session and require its token for authoritative
  writers. Schedule-control and application-state mutations remain outside the
  implemented fence until separately adopted.
- Same-volume local stores can exercise the state machine and fencing model,
  but they do not establish recovery after loss of the host or volume.
- Runtime adoption and same-table scheduling coverage come next. Automatic
  coordinator recovery then requires the provider-certified lease primitive,
  followed by reconstruction and a two-node trusted recovery proof.

## Rejected alternatives

### Treat a caller timestamp as lease expiry

Rejected because the generic database cannot establish the clock or evaluate
expiry against store-authoritative time. This would trade an explicit
availability limitation for a hidden split-authority risk.

### Put authority only in the deployment-control table

Rejected for the execution path because the current transaction contract
cannot atomically condition a ledger-table mutation on a record in another
table.

### Let heartbeat loss trigger takeover

Rejected because message and process liveness do not prove durable authority
has ended. Heartbeats remain diagnostic until a semantic lease makes expiry a
store decision.
