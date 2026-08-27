# 0033 — Explicit coordinator epoch authority

**Status:** Accepted, amended 2026-08-27 · **Date:** 2026-07-28

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
evidence; the production operator path owns that decision through an exact
inspection document and confirmed takeover request. The successor then
conditionally replaces that exact full predecessor snapshot and increments the
epoch by one. The bounded operator flow uses a temporary successor and an exact
stable release so a normal fresh resident can acquire afterward. Concurrent
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

### Application state has a separate destination barrier

Application state intentionally lives outside the control-store transaction
boundary. Its table now retains a high-water record per application namespace,
pinned to that destination's verified store identity and the complete stable
coordinator token. Writable runtime catalogs explicitly adopt that token. An
identical adoption is read-only; a strictly higher epoch can advance the exact
retained predecessor. Lower epochs and different same-epoch tokens fail closed.

Bound fresh-store bootstrap atomically creates the identity and initial
barrier. Every new business-value/receipt pair, already-present receipt, and
permanent negative resolution compares the exact local barrier in the same
transaction. Unbound writers in this implementation require the barrier to be
absent in their write transaction. Existing v2 logical effects and permanent
dispositions do not acquire physical coordinator fields: exact committed
results remain readable after a later adoption, without another write.

The production host obtains the token from its bound ledger and probes current
control authority before catalog construction. That read only rejects known
staleness; it cannot close the race across two stores. The destination barrier
has no ACTIVE/RELEASED mirror, lease, or per-catalog release. Control takeover
and graceful release do not themselves revoke an already-held destination
catalog. A predecessor can still commit before the successor's destination
adoption, and a write accepted before that boundary remains valid. The ordered
readiness protocol below completes adoption before resident READY; it does not
make the two stores one atomic transaction.

This ordering assumes trusted callers from one retained control-authority
lineage. Tokens contain no control-store lineage identity, so an arbitrary
foreign higher token cannot be distinguished by its epoch. Store reset,
rollback, deletion of barriers, and automatic lineage migration are unsupported.
Older binaries do not honor these new rows and must be stopped at upgrade
cutover. These limits are not provider-certified failover semantics.

### Resident readiness requires an exact adopted primary destination

The bounded resident supports one configured LMDB `application-state` v2 /
`primary` destination per application. Before constructing its worker, it
inventories all verified run-directory pages and rebuilt histories across
revisions and statuses. Every retained effect destination and every
authorization-only effect-successor trigger contract participates. A retained
control pin also participates. Multiple store identities, unsupported
destinations, corrupt history, or application/provider/table mismatches fail
closed; the ready-work index is not a completeness source.

The control table retains one strict, immutable-identity readiness record in
the `application-state-readiness/v1/primary` namespace. Its exact destination,
captured coordinator token, status, and expected destination-barrier digest are
integrity-bound. PREPARING pins the physical destination identity only for
genuine first use or recovery of retained pre-adoption progress; ADOPTED records
an exact readback of a token's local barrier. A higher token may resume a
PREPARING record for the same destination, but `prepare` refuses to replace an
existing ADOPTED record with unconfirmed intent.

An existing ADOPTED record is a verified destination-authority floor. Read-only
preflight and adoption accept either its exact barrier or a structurally valid
strictly higher current barrier; absence, a lower epoch, or a different token at
the same epoch fails closed. The resident adopts its current token against the
exact observed destination predecessor before it advances the exact retained
control record directly from ADOPTED to ADOPTED. It never exposes an
intermediate PREPARING record for that replacement. Same-token ADOPTED replay is
read-only. Every control transition compares the active coordinator tuple and
full predecessor in the same transaction. Readiness never changes the physical
pin or resets an epoch, is not a permanent effect receipt, and resolves
ambiguous writes by exact readback without automatic CAS rebasing.

A known destination must pass read-only identity preflight before writable
opening. Once history or a pin names a store, neither a missing root nor a
missing identity may be bootstrapped, including after interrupted PREPARING.
For retained ADOPTED state, that preflight also verifies the destination-
authority floor before writable opening; adoption repeats the check and CASes
the exact observed barrier because the destination may change after preflight.
Genuine first use with neither retained destination nor pin may initialize
identity and its initial barrier atomically before creating the control pin;
there is no dispatch yet. This deliberately avoids minting an identity in
control and then recreating a possibly lost volume from that intent.

After adoption and its control acknowledgement, the resident may start its
schedule observer and command endpoint. Its READY lifecycle transaction checks
the exact ADOPTED record and active coordinator tuple alongside the existing
lifecycle predecessor fence. The lifecycle session must equal that token's
coordinator ID. A control takeover racing READY therefore rejects the old
publication. STARTING, STOPPING, and STOPPED remain independent of this guard so
lost-authority sessions can close their own resources. READY is evidence at
publication, not a perpetual liveness or authority capability.

An interrupted first-use or pre-adoption handoff leaves its PREPARING pin and
any committed destination barrier in place. An existing ADOPTED record instead
remains the last confirmed floor until destination adoption succeeds and the
exact ADOPTED-to-ADOPTED control transition commits. Graceful failure releases
only its exact current control authority; an ungraceful exit requires the
existing inspected takeover-and-release flow. The next fresh session repeats
inventory, identity verification, and adoption at a higher epoch. No cleanup
lowers or removes a destination barrier.

Foreground and operator writable catalogs honor this pin as well. Their write
binding rejects PREPARING because it proves no committed destination barrier.
An ADOPTED binding carries the reconstructed floor through read-only identity
and barrier preflight and through catalog adoption. Foreground dispatch performs
that preflight before writable opening and STARTED, then rechecks the binding
and adopts its captured token after dispatch authorization.

Inventory assumes intact atomic run-directory/history writes and stopped
legacy writers; it cannot discover deleted or unindexed history. It scans all
history on each startup, so startup cost grows with retained history. Calls
before a resident establishes a pin retain their earlier explicit effect-store
checks; they do not independently create a registry through a full inventory.
This is recoverable same-volume ordering for one primary destination, not
host/volume-loss recovery, arbitrary-destination discovery, automatic takeover,
or a provider-certified semantic lease.

The [August 26 single-host proof](../../../llm/checkpoints/2026-08-26-coordinator-readiness-systemd-proof.md)
exercises this ordering with actual process kills and a forced disposable-VM
reboot. A pre-login read-only observer records automatic startup refusing the
retained ACTIVE coordinator, unchanged pin, and waiting durable timer; explicit
inspected takeover-and-release then permits a fresh adopted READY session.
Two additional source-bound kills of the selected packaged service runtime
cover the first-use PREPARING path before destination adoption and destination
commit before its first ADOPTED acknowledgement, with the fixed systemd unit
stopped. Those are distinct from the managed MainPID kill and host cycle.
Separate native subprocess cases retain
typed managed-effect receipts and business values; the Linux service gate
retains its timer/signal workflow, history, and output through activation and
uninstall. Neither evidence scope establishes automatic or volume-loss recovery.

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
  explicitly confirms takeover through the operator path.
- Heartbeat freshness is useful evidence but never authority.
- The execution-ledger transaction budget includes one additional authority
  condition, and every direct mutation path must be audited rather than only
  the common transition helper.
- The kernel remains opt-in at each ledger construction site. The local
  resident, direct durable-submission fallback, foreground activity paths, and
  standalone mutating execution-ledger operators now acquire a fresh session
  and require its token. Read-only commands and live-owner command routing do
  not acquire competing authority.
- Resident schedule-control takes the exact token from its bound ledger.
  Activation and cursor-only writes add the authority condition alongside the
  local-owner and application-admission fences. Prepared occurrence admission
  requires the same token in the consuming ledger, which adds the single
  authority condition to the combined transaction; it must not add a second
  operation on that authority item. Exact retained replays are read-only and
  do not claim that their historical token is still current.
- [ADR 0036](0036-durable-coordinator-admission-provenance.md) now retains that
  stable token as bounded historical provenance on new manual, workflow,
  scheduled-workflow, and managed-effect-successor admissions. Existing
  version 10 admission fences remain at epoch zero. Legacy and unbound history
  stays unattributed, and public operator history stays redacted.
- Application-state mutations are locally fenced after destination adoption,
  separately from control-store takeover. Recovery-only catalogs remain
  mutation-free; writable reconciliation and successor-retry catalogs pin the
  retained destination identity before adoption. A caller-supplied unbound
  ledger or schedule-control store does not acquire authority implicitly.
- Same-volume local stores can exercise the state machine and fencing model,
  but they do not establish recovery after loss of the host or volume.
- Cross-store adoption/readiness is ordered and recoverable for the single
  configured application-state destination, not atomic. Automatic coordinator
  recovery still requires the provider-certified lease primitive, followed by
  reconstruction and a two-node trusted recovery proof.

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
