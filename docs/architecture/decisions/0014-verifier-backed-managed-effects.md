# 0014 — Verifier-backed persisted managed effects

**Status:** Accepted · **Date:** 2026-07-18

## Context

[0004](0004-logical-outcomes-and-effects.md) distinguishes one logical
invocation outcome from its physical attempts and external effects. The V4
ledger implemented durable cancellation and evidence-backed attempt
reconciliation, but it did not persist effect truth. An Activity Protocol
transcript could correlate effect frames inside one physical attempt, yet it
could not establish that an adapter had not acted before a crash or that a
destination had accepted an operation.

That omission cannot be repaired by treating transcript frames as effect
records. A process can commit an effect request, begin an external operation,
and lose its response before the destination result reaches the ledger. It can
also commit a destination result and lose only the ledger response. Those two
cases need different recovery behavior, and neither can be inferred from an
attempt terminal alone.

## Decision

### V5 is a fresh semantic namespace

Persisted managed effects are introduced in execution-ledger schema V5 under
`ledger/v5/`, with a V3 run-directory partition and a new default table name.
V1 through V4 histories and V1 through V2 directory rows remain inert even if
an operator deliberately points V5 at the same physical table. There is no
migration or dual-write path in this reset-era repository.

V5 retains the append-only run → invocation → attempt model and adds one effect
projection keyed by invocation and logical effect ID. Each effect records:

- the immutable application, revision, activity, run, invocation, and effect
  identities;
- the requesting physical attempt, protocol sequence, generation,
  coordinator epoch, and fencing token;
- a globally scoped destination effect ID derived from application, run,
  invocation, and effect identity;
- an immutable referenced logical request;
- exact versioned adapter and evidence-verifier descriptors;
- requested and adapter-substantiated replay properties as separate values;
  and
- an immutable referenced outcome only after a registered verifier accepts
  its destination evidence.

The initial lifecycle is `PENDING` → `STARTED` → `COMPLETED` or `FAILED`, with
`STARTED` → `UNCERTAIN` as the conservative ambiguity path. A substantiated
destination failure is an effect result, not an uncertain invocation outcome.

### Durable ordering controls adapter authority

The logical request commits before the adapter may begin. The exact current
attempt fence and a second atomic transition then establish `STARTED`
immediately before one caller may invoke the adapter. A missing versioned
verifier, stale attempt, changed adapter contract, reused effect identity, or
lost authorization stops before physical dispatch.

The driver captures immutable copies of adapter metadata and actor identity,
plus the exact executable function and optional cancellation signal, before its
first asynchronous read. Mutable caller objects therefore cannot select one
durable adapter version and replace the code that runs after the start commit.
An idempotent receipt is returned only from a verified fold that contains its
exact event; if the receipt appears after the first state read, the ledger
refreshes before reporting the authoritative aggregate.

Response-loss handling is phase-specific:

- a retained `PENDING` request can resume toward its one start transition;
- a retained `STARTED` effect is never dispatched again by a retry, including
  when the caller may merely have lost the start-transition response;
- a retained terminal effect is re-read, re-hashed, re-verified, and safely
  redelivered without invoking the adapter; and
- if a destination outcome committed but its response was lost, that retained
  terminal outcome is authoritative.

V5 does not yet recover the liveness of a `STARTED` effect whose adapter never
actually ran. Refusing an automatic second dispatch is the safe result until a
destination-specific recovery contract exists.

### Destination evidence, not an adapter assertion, proves outcomes

Before a request can start, the ledger requires an exact `{kind, version}`
verifier registration selected with an exact `{id, version}` adapter. Verifier
implementations are required to be deterministic and synchronous so replay
never depends on current network state or credentials; the versioned registry
is trusted for determinism. A verifier receives independent deeply frozen
copies of the effect contract, re-hashed request, and re-hashed outcome, so it
cannot mutate ledger state. A missing, throwing, asynchronous, or rejecting
verifier fails closed.

The verifier is trusted to define what its versioned evidence proves. The
ledger independently proves that the destination effect ID, adapter,
verifier, outcome shape, and substantiated replay properties match the
persisted request contract. Both request and outcome references are re-hashed
on rebuild and redelivery; a terminal projection alone is never outcome
authority.

The first implementation has only test adapters and verifiers. It therefore
makes no production exactly-once claim. An adapter may claim exactly-once
effect behavior only when its destination verifier proves that the stable
destination effect ID is enforced atomically with the business mutation. A
provider idempotency token with a limited or unverified retention window is
not enough.

### Attempt terminals must agree with effect truth

An attempt transcript remains correlation evidence, never an alternate effect
store. Before an ordinary terminal or evidence-backed uncertain-attempt
reconciliation can establish a logical outcome, every transcript effect
request and result must match independently persisted effect request and
outcome state. Every persisted effect from that physical attempt must appear
exactly once with its matching request and verifier-backed result. An
unpersisted, mismatched, duplicated, omitted, or unresolved effect rejects the
terminal.

If an adapter may have begun but no verifier-backed outcome can be committed,
one atomic `effect-became-uncertain` transition makes the effect `UNCERTAIN`,
retains the physical attempt as `ABANDONED`, makes the invocation `UNCERTAIN`,
and blocks the run. Ordinary attempt reconciliation cannot bypass that
unresolved effect. Effect-specific destination reconciliation, compensation,
and retry policy are later contracts.

### The initial API remains internal

The implementation exposes an internal managed-effect driver and ledger APIs
but does not connect them to the public source or SEA activity transport.
Existing public Function/worker paths continue to reject effect requests.
There is no production adapter catalog, authenticated cross-process effect
transport, effect operator command, automatic retry, compensation, or effect
reconciliation in this slice.

## Consequences

- A run can no longer terminalize while ignoring a persisted effect from its
  attempt.
- Lost request, start, and outcome responses have explicit, different
  behavior; no generic retry loop is allowed to dispatch a begun operation.
- Restarting without the exact verifier needed by pending or terminal state
  fails before another external action.
- Effect input, result, error, and evidence remain immutable referenced
  payloads and are not added to redacted operator output.
- V4 histories are deliberately not visible through V5 defaults; this is a
  breaking reset boundary, not compatibility behavior.
- The next useful vertical is an authenticated source/SEA effect transport
  with one finite real adapter and destination verifier, followed by explicit
  effect reconciliation and crash testing at each transition boundary.

## Rejected alternatives

### Infer durable effects from the final attempt transcript

Rejected because the host transcript cannot prove what a destination accepted
or distinguish a lost destination response from a lost ledger response.

### Retry every retained `STARTED` effect

Rejected because `STARTED` means the adapter may already have acted. A second
dispatch would turn response loss into an unbounded duplicate-effect risk.

### Trust an adapter-returned success flag without destination evidence

Rejected because adapter code is not the destination and cannot establish the
atomicity, deduplication scope, or retained outcome needed for a replay claim.

### Add effect fields to V4 records

Rejected because a V4 reader could accept an attempt terminal while ignoring
new effect records. A fresh namespace keeps that semantic incompatibility
honest.
