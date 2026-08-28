# 0037 — Single-region DynamoDB RVN-observed coordinator replacement

**Status:** Accepted; single-Region provider primitive certified · **Date:** 2026-08-27

## Context

[ADR 0002](0002-one-recoverable-active-coordinator.md) originally required
automatic coordinator replacement to be authorized by expiry evaluated from a
store-authoritative clock. [ADR 0011](0011-persisted-state-machine-execution-ledger.md)
and [ADR 0033](0033-explicit-coordinator-epoch-authority.md) carried that
requirement forward because the generic database contract exposes neither a
trusted store clock nor a store-evaluated expiry predicate.

DynamoDB does not make a caller-supplied timestamp safe merely by persisting
it, and its time-to-live facility is asynchronous cleanup rather than a
transactional lease-expiry predicate. Those facts rule out a conventional
wall-clock lease built on the generic database API. They do not rule out safe
replacement when failure detection is separated from write authority.

Wharfie's execution-ledger mutations already compare the stable active
coordinator tuple in the same transaction as each authoritative write. That
condition, rather than the accuracy of a timeout, can be the safety boundary.
A timeout may suspect a live coordinator and cause unnecessary replacement,
but an exact epoch takeover can still prevent the replaced coordinator from
committing stale DynamoDB state.

This decision amends the store-authoritative-expiry requirement in ADRs 0002,
0011, and 0033 for the certified provider profile below. It does not weaken the
requirement for other stores or topologies.

## Decision

### The certification scope is deliberately narrow

The first automatic-replacement primitive targets one ordinary DynamoDB table
in one AWS Region with no Global Tables replicas. The authority record and
every DynamoDB ledger record protected by it must participate in the same
`TransactWriteItems` transaction domain. Authority observations use strongly
consistent reads.

The protocol makes no claim for eventually consistent reads, DynamoDB Global
Tables, cross-Region replication, a generic `DBClient`, a different ledger
store, or an application-state destination outside that transaction.
The primitive verifies the DynamoDB adapter identity, but that brand cannot
prove table topology or bind every consumer to the same table. Provisioning
and future resident wiring must establish those deployment preconditions.

The authority record's Wharfie-owned `recordVersion` is the record version
number (RVN). It is protocol data, not hidden DynamoDB metadata. The stable
active-authority tuple remains the schema, kind, application, coordinator,
authority ID, epoch, and ACTIVE status. The RVN and diagnostic timestamp or
request fields are intentionally outside that stable tuple.

### The current owner renews by exact receiptless CAS

A current coordinator renews from the exact full ACTIVE snapshot it holds. A
renewal preserves the stable tuple, advances the RVN by exactly one, and may
advance diagnostic metadata. It conditionally replaces that exact full
snapshot. RVN exhaustion fails closed.

Renewal is receiptless: it does not create a separate durable request-receipt
item. That keeps renewal from consuming another transaction item while still
allowing exact outcome resolution. After an ambiguous response, the caller
performs a strongly consistent read:

- the exact intended successor proves that renewal committed;
- the exact predecessor permits an exact retry; and
- any other snapshot means authority changed or the result cannot be proven,
  so the caller fails closed.

A renewal is not a ledger fence change. Existing work carrying the same stable
tuple remains valid while only the RVN and diagnostic fields advance.

The existing request-receipted heartbeat transition also advances the RVN, so
one that commits during an observation window is legitimate current-owner
activity and forces the contender to restart. Its timestamp age still grants
nothing. The receiptless operation is the continuous-renewal path because it
does not accumulate a permanent item for every renewal.

### A contender observes one unchanged RVN across a monotonic window

A contender strongly reads one exact ACTIVE authority snapshot, starts a local
monotonic observation window after that read completes, and does not attempt
replacement until the full configured interval has elapsed. It then performs
another strongly consistent read. Any change, including an RVN change,
restarts observation from the new exact snapshot. Only an unchanged exact
snapshot with the same RVN across the whole window is eligible as a takeover
predecessor.

The monotonic interval is failure-detector policy, not durable proof of death.
A fast monotonic clock, a long process pause, delayed scheduling, or an
unusually short configured interval can suspect and replace a live owner.
That can cause premature eviction, duplicate physical work, or repeated
authority churn and therefore harm availability. It cannot by itself authorize
a stale DynamoDB commit.

Wall-clock fields such as `heartbeatAt`, `updatedAt`, or a contender's current
time remain diagnostic. Their age is not a takeover condition. DynamoDB TTL is
not used to grant or revoke authority.

### Takeover is an exact epoch CAS

After the observation window, the contender conditionally replaces the exact
full predecessor snapshot with a fresh ACTIVE authority whose epoch is exactly
one greater and whose coordinator, authority, acquisition, and request
identities name the new session. Concurrent contenders for the same observed
snapshot race on one exact compare-and-set; at most one succeeds. Epoch
exhaustion and an unprovable ambiguous outcome fail closed.

Retained request identity and strong readback resolve exact takeover replay in
the existing authority state machine. Neither the observation window nor a
successful read grants a capability independently of the committed epoch
transition.

### The transaction fence is the sole safety boundary

Every coordinator-authoritative DynamoDB mutation compares the complete stable
ACTIVE tuple in the same `TransactWriteItems` operation as the ledger mutation.
Renewal leaves that tuple unchanged. Takeover changes it and advances the
epoch.

Therefore, a predecessor transaction has only two safe serializations around a
successful takeover:

1. it commits before and is validly serialized ahead of the exact takeover
   transition; or
2. it is evaluated after the takeover and its stale tuple condition fails.

A paused or partitioned predecessor may continue computing, issuing messages,
or performing unmanaged physical work. It cannot commit coordinator-
authoritative DynamoDB ledger state after its tuple has been replaced. The
failure detector can be arbitrarily inaccurate without changing this fencing
argument.

This safety claim ends at the transaction boundary. An application-state
write in another table or store, an external effect, or any mutation that only
carries an epoch without atomically comparing the authority tuple does not
inherit it.

### The certified primitive remains bounded

The primitive includes receiptless exact renewal, strongly consistent
observation, exact-CAS epoch takeover, and the existing same-transaction
stable-tuple fence. Deterministic race coverage and a live disposable-table
proof passed. The live proof verified a single-Region, non-global table,
exercised renewal and observation, paused a predecessor across takeover,
rejected its delayed fenced transaction, admitted the successor transaction,
and confirmed cleanup. The exact validation results are retained in the
[DynamoDB RVN checkpoint](../../../llm/checkpoints/2026-08-27-dynamodb-rvn-coordinator-replacement.md).

This slice does not automatically wire renewal or takeover into the resident,
reconstruct ledger work after replacement, recover a service on another node,
make control and application-state writes atomic, or establish multi-Region
behavior. Those are separate implementation and proof obligations.

## Consequences

- DynamoDB can support safe automatic epoch replacement without a
  store-authoritative expiry clock in the certified narrow single-Region
  profile.
- Failure-detector accuracy affects availability and physical work, not the
  authority of fenced DynamoDB commits.
- The owner must keep advancing the RVN, and contenders must use strongly
  consistent reads and restart their full monotonic window after any change.
- Every protected mutation must retain the same-transaction stable-tuple
  condition. Removing or moving that condition would invalidate the proof.
- The provider-specific primitive is not evidence of automatic resident or
  multi-node recovery. Reconstruction and service integration remain open.
- Other stores still need their own provider certification. ADR 0002's
  store-authoritative-expiry rule remains the default where no equivalent
  fenced protocol has been proved.

## Rejected alternatives

### Use caller wall time or DynamoDB TTL as lease expiry

Rejected because neither supplies a transactional, store-authoritative expiry
decision. Local wall time remains diagnostic and TTL remains cleanup.

### Treat an unchanged heartbeat timestamp as authority

Rejected because timestamps and message silence are not durable fencing. The
accepted detector observes the exact RVN, but even that observation only
permits an exact takeover attempt; it never authorizes a ledger write.

### Include RVN in every ledger mutation fence

Rejected because each receiptless renewal would invalidate already-issued work
even though the coordinator identity and epoch did not change. The stable tuple
is the work capability; RVN is renewal evidence for contenders.

### Generalize immediately to Global Tables or cross-store writes

Rejected because asynchronous multi-Region replication and separate
transaction domains require different safety arguments. A successful
single-Region proof cannot be extrapolated to either case.
