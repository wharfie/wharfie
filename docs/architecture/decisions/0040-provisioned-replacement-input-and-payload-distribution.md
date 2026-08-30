# 0040 — Provisioned replacement input and replicated execution payloads

**Status:** Accepted; internal input/distribution slice implemented · **Date:** 2026-08-30

## Context

[ADR 0037](0037-single-region-dynamodb-rvn-coordinator-replacement.md)
requires every independently starting replacement to carry the same
provisioning-retained DynamoDB `tableResourceId`. Rediscovering a table by
Region and name is not enough: a same-named replacement table is a different
transaction domain even when its schema is compatible.

[ADR 0038](0038-authority-bound-replacement-reconstruction.md) reconstructs
complete execution history, and
[ADR 0039](0039-retained-coordinator-quiescence-barrier.md) supplies its
durable same-table cutover. The retained ledger records content-addressed
execution-payload references, however, while their bytes previously existed
only in one local filesystem store. A replacement with an empty local volume
could therefore prove the control table but could not rebuild its history.

Application state remains a third concern. It has a destination-local
authority barrier in a separate transactional domain. Replacement startup
must pin the exact expected destination and prove that the current replacement
authority adopted it before reopening admissions, without pretending that this
control-plane slice moves the application-state bytes between machines.

## Decision

### Provision one strict, content-addressed receipt

Trusted provisioning produces one bounded canonical JSON receipt with an
identity derived from all of its fields. Version 1 contains exactly:

- the application ID and current immutable revision ID;
- the accepted DynamoDB RVN authority profile, the expected `dynamodb`
  adapter, Region, table name, and opaque `tableResourceId`;
- the local content-addressed execution-payload storage kind and store ID;
- the provider-neutral execution-payload distribution kind, distribution ID,
  and matching store ID; and
- the exact normalized application-state destination. Its namespace must
  equal the application ID.

Unknown, missing, malformed, oversized, or substituted fields fail strict
validation. The `wrri1` receipt ID is a domain-separated SHA-256 identity over
the complete normalized payload. It detects accidental or adversarial field
substitution after trusted provisioning; it is not a signature and does not
authenticate the node or distribution channel.

The receipt is credential-free. It retains the expected adapter, Region, and
table name as comparison fields, but not a control-store path, endpoint,
account, full ARN, credential, secret, timestamp, observation time, node ID,
renewal interval, or observation window. Runtime paths, credentials, timers,
and actual provider connections remain independently configured. They must
resolve to the exact scope pinned by the receipt before topology validation or
authority acquisition begins.

### Retain the receipt as an immutable handoff artifact

The first handoff store writes canonical receipt bytes to a deterministic
receipt-ID path. Publication is create-if-absent, file data and directory
metadata are synchronized before success, including every newly created path
component and its parent. An existing artifact is accepted only after its exact
bytes and content identity validate. Reads hold and recheck the same regular
file so path replacement or concurrent mutation cannot be mistaken for a valid
artifact.

`readBytes` and `putBytes` form the provider-neutral copy boundary for moving
one exact receipt into a fresh durable local root. This local implementation
does not itself select a remote provider, authenticate a receiving node, or
authorize a revision.

### Make payload publication complete before ledger reference publication

Execution-payload references and their local storage identity remain
unchanged. Every replacement replica uses the same store ID and one strict
distribution identity. Provider-specific routing stays behind an injected
port with only two relevant operations: immutable publication and byte read.

The replicated store is local-first but does not trust either copy for
integrity:

1. A writer creates the canonical payload in its local store and verifies the
   local bytes against the resulting reference.
2. It publishes those exact bytes to the immutable distribution.
3. It immediately reads the distributed object back and verifies its size,
   digest, schema, and canonical JSON against the same reference.
4. Only after that readback succeeds may the reference return to ledger code.

The same rule applies when importing already-referenced bytes. Publication is
idempotent and must never replace different bytes at an existing immutable
identity.

A reader verifies the local object first. Only the typed local not-found error
for the exact requested payload ID permits a distributed read. Distributed
bytes are verified against the complete retained reference before they are
imported through the local store's immutable hydration boundary. Hydration
synchronizes every newly created directory component and its parent, then the
replicated store reads and verifies the local object again before returning its
bytes. A local integrity or corruption error never falls back to the
distribution, because doing so would hide evidence that the node's retained
state is inconsistent. Once hydration completes, later reads can use the local
replica without the distribution.

### Validate the complete replacement scope before authority

The internal reconstructed-resident wrapper snapshots caller-controlled ports
and validates the receipt before it invokes topology or authority code. The
receipt must exactly match the requested application and revision, the
independently resolved authority profile and DynamoDB route, the expected
`tableResourceId`, the configured payload store, and the payload distribution
identity. The ledger must also have been constructed with that exact payload-
store object; validating one store while reconstruction closes over another
fails before topology proof. Replacement-capable construction additionally
requires the out-of-band factory brand installed only by the replicated-store
factory. Decorating a plain local store with distribution-shaped metadata
cannot claim replicated publication or pass replacement startup.

The ordered internal startup is now:

```text
receipt/config/ledger-payload scope → topology proof → authority supervisor →
close/adopt barrier → two-pass reconstruction through the replicated store →
application-state preparation → exact ADOPTED destination/authority check →
strong authority check → exact reopen → strong authority check → dispatcher
```

Reconstruction may hydrate an empty local payload replica through verified
read-through. Any receipt, configuration, payload, or application-state
mismatch leaves startup closed.

### Fix the application-state handoff contract, not its transport

The receipt pins one exact normalized application-state destination. The
application-state callback must return a strictly validated readiness record
whose status is `ADOPTED` and whose destination is canonically identical to
that receipt field. The record's complete coordinator-authority token must also
equal the exact current replacement authority. Missing readiness, `PREPARING`,
a stale or different authority, or a different provider, store ID, table, or
namespace fails before the admission barrier reopens.

This check establishes what a later cross-node handoff must prove. It does not
copy an LMDB or Vanilla application-state store, choose a retained volume,
make the execution ledger and application-state store atomic, or recover after
loss of the application-state volume.

### Keep the slice internal

The reconstructed wrapper still has no production resident call site. This
decision does not lift the LMDB-only public resident and submission gates,
activate the DynamoDB profile, enroll or place trusted nodes, authorize a
revision on another node, run a two-node recovery proof, or publish a release.

## Consequences

- The provisioned `tableResourceId`, payload-distribution identity, and exact
  application-state destination now have one durable, substitution-detecting
  internal handoff artifact.
- An empty replacement payload replica can rebuild retained execution history
  when an injected distribution adapter supplies the exact immutable bytes.
- A successful payload write now includes remote publication and verified
  readback. Distribution unavailability therefore fails the write before a
  ledger reference can escape.
- A corrupt local replica fails closed even when a healthy distributed copy
  exists. Repair must be explicit rather than silently masking local damage.
- Existing plain local payload stores are not retroactively distributed.
  Replacement-capable construction must use the exact replicated store and a
  certified provider adapter.
- The receipt-copy boundary and provider-neutral payload port are mechanisms,
  not node trust or placement policy. Trusted provisioning and enrollment
  remain prerequisites.
- Cross-node application-state transport, the crash matrix, product activation,
  and multi-node proof remain open.

## Rejected alternatives

### Rediscover the control table from Region and name

Rejected because a recreated same-named table is a different transaction
domain. The replacement must carry the provisioning-retained opaque resource
identity and compare it to topology discovered through the exact client.

### Put credentials or provider connection details in the receipt

Rejected because the artifact is retained and copied. Normal credential
chains and independently configured provider adapters preserve refresh and
avoid turning the receipt into a secret-bearing routing document.

### Store payload bodies in execution-ledger records

Rejected because it couples immutable application bytes to the coordinator
transaction model and its item and transaction limits. The existing
content-addressed reference remains the stable ledger contract; distribution
is a separate capability.

### Return a payload reference after publish without readback

Rejected because a successful provider call does not prove that the exact
object can be retrieved. Immediate verification prevents an unreadable or
substituted distributed object from becoming durable ledger truth.

### Fall back to the distribution after any local read error

Rejected because an integrity failure is not absence. Treating corruption as
a cache miss would hide evidence and make local retained state silently
self-rewriting.

### Treat the receipt as node authorization

Rejected because knowledge of content identities is not proof that a machine
is enrolled or permitted to run a revision. Trusted-node authorization and
placement remain separate work.
