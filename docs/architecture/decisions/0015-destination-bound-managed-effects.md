# 0015 — Destination-bound managed effects and finite host catalogs

**Status:** Accepted · **Date:** 2026-07-18

## Context

[0014](0014-verifier-backed-managed-effects.md) introduced persisted managed
effects. Its V5 contract retained an exact adapter version, verifier version,
logical request, and outcome evidence, but it did not retain the exact physical
destination selected by the trusted host. The same adapter version and logical
binding name could therefore resolve to a different table, store, namespace, or
account after configuration changed. Retrying that history could silently
retarget work while still satisfying the V5 adapter and verifier descriptors.

Persisting credentials would make the selection reproducible, but would put
rotating secrets into immutable history and portable application state. Keeping
only an ambient environment-variable name would avoid the secret while leaving
the destination ambiguous. Neither is an acceptable durable boundary.

## Decision

### V6 is a fresh semantic namespace

Destination-bound effects use execution-ledger schema V6 under `ledger/v6/`, a
V4 run-directory partition, and the default table
`wharfie-execution-ledger-v6`. V1 through V5 histories and V1 through V3
directory rows remain inert even in a deliberately shared physical table. V5
rows are not migrated or reinterpreted because they do not contain enough
information to prove the selected destination.

### Every effect retains its exact non-secret destination contract

The trusted host selects and persists this strict descriptor before an adapter
may begin:

```json
{
  "kind": "application-state",
  "version": 1,
  "bindingId": "primary",
  "configuration": {
    "namespace": "example-app",
    "tableName": "records"
  }
}
```

`kind` and `version` select the destination contract. `bindingId` identifies
the application-visible binding. `configuration` is the complete bounded JSON
snapshot needed to locate the selected destination without credentials. A
finite catalog owns the stricter, kind-specific configuration schema; the
generic ledger only enforces the common exact shape and JSON bounds.

The generic codec cannot determine whether arbitrary JSON is credential
material, and key-name blacklists would create false confidence. Public
dispatch therefore remains unavailable until the finite catalog validates and
constructs this descriptor from its kind-specific non-secret schema. A
component-supplied destination object must never pass directly to the ledger.

The descriptor participates in the immutable effect projection, request
transition digest, receipt replay comparison, every later effect transition,
the referenced outcome, terminal redelivery validation, and the verifier
input. The runtime snapshots it before its first asynchronous read and passes a
deeply frozen copy to the selected adapter. A retry presenting any different
destination conflicts before physical dispatch.

Credentials and executable code remain outside durable JSON. At dispatch, the
trusted host resolves current credentials for the already-persisted
destination; credentials may rotate, but they may not change what resource the
descriptor names. An unavailable or unauthorized credential fails closed
rather than selecting another destination.

### A finite host catalog is the authorization boundary

Application code requests a named capability and operation through the
Activity Protocol. It does not provide an import path, arbitrary adapter code,
verifier code, raw credential, or physical resource selector. The host catalog
maps an allowed capability/operation and destination kind to one exact:

- adapter descriptor and implementation;
- destination descriptor validator and credential resolver;
- evidence-verifier descriptor and deterministic implementation; and
- set of replay properties that the combination can actually substantiate.

The catalog is finite and installed by the source/SEA host. Opening a ledger
for read, recovery, or execution must install every built-in verifier required
to rebuild its supported histories. A missing registration makes that history
unavailable for authorization; it is never treated as evidence-free state.

### Exactly-once remains a destination-specific claim

The global destination effect ID remains stable across response loss and
recovery. That identity alone does not make an operation exactly once. An
adapter may substantiate transactional or exactly-once effect behavior only
when its destination atomically stores the business mutation and a permanent
receipt keyed by that ID, and its verifier proves the exact request,
destination binding, outcome, and receipt relationship. Other adapters must
advertise only the weaker replay properties they can establish.

## Consequences

- Configuration changes cannot silently redirect a retained V6 effect.
- Credential rotation remains possible without rewriting immutable history or
  embedding secrets in a portable SEA's control state.
- Destination configuration schemas become explicit versioned product
  contracts rather than ambient adapter behavior.
- The internal V6 codec is not a secret scanner; the catalog is a required
  pre-public boundary, not optional validation layered on later.
- V5 histories are deliberately invisible through V6 defaults; this is a
  breaking reset boundary, not compatibility behavior.
- The first production vertical can stay small: one authenticated effect
  transport, one finite catalog entry, and one destination whose atomic receipt
  contract can be exercised identically from source and a relocated SEA.
- Effect-specific recovery and compensation are still required before a
  retained `STARTED` effect can become live automatically.

## Rejected alternatives

### Persist only the adapter version

Rejected because adapter identity does not identify the table, store,
namespace, account, or other destination instance selected for one effect.

### Resolve destinations entirely from current environment variables

Rejected because changing deployment configuration could retarget retained
work without changing its durable contract.

### Persist credentials with the destination

Rejected because immutable ledger and payload history is the wrong lifecycle
and exposure boundary for rotating secrets.

### Let application code register arbitrary adapters

Rejected for the first framework boundary because arbitrary code and resource
selection would bypass the trusted host's capability authorization, replay
properties, verifier registry, and portable SEA closure.
