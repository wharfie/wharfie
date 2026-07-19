# 0018 — Causally linked managed-effect successor work

**Status:** Proposed · **Date:** 2026-07-19

## Context

[0017](0017-destination-finalized-effect-reconciliation.md) can establish a
terminal destination disposition for one retained uncertain managed effect. A
verified positive receipt makes the effect `COMPLETED` or `FAILED`; a permanent
destination-side negative closure makes it `NOT_APPLIED`. Those transitions do
not establish what arbitrary activity code did before or after the effect. The
original physical attempt therefore remains `ABANDONED`, its invocation
remains `UNCERTAIN`, and its run remains `BLOCKED`.

That boundary records truth but does not carry intent forward. An operator may
need to retry an effect that is now proven not to have applied. That retry must
not reopen the abandoned attempt, rerun the authored activity handler, reuse
the old destination authority, or imply that the original invocation was
resolved.

The existing replay-property vocabulary is not sufficient authorization by
itself. `idempotent` may be scoped to one stable destination identity, while
`transactional` establishes an atomic boundary rather than repeatability or
rollback. The first executable successor policy must therefore be finite,
destination-specific, and based on an exact verified disposition and contract.

## Decision

### V9 and run-directory V7 are fresh; application-state V2 remains current

Managed-effect successor work uses execution-ledger schema V9 under
`ledger/v9/`, a V7 run-directory partition, and the default
`wharfie-execution-ledger-v9` table. Earlier ledger and directory records remain
inert. There is no migration, reinterpretation, compatibility reader, or
dual-write path.

V9 carries the V8 uncertainty, stopped-attempt settlement, and
destination-finalized reconciliation semantics forward and adds explicit
successor authorization and target-run creation.

The built-in application-state destination remains one complete V2 semantic
namespace. Its business table, adapter, destination, transaction, positive
receipt, permanent negative closure, and verifiers do not change merely because
the control ledger advances. A control-ledger upgrade must not hide an
application's retained business state or rotate external idempotency authority.

Destination-effect identity is therefore independently versioned by
`MANAGED_EFFECT_DESTINATION_IDENTITY_VERSION`, which remains 8, rather than
derived from `EXECUTION_LEDGER_SCHEMA_VERSION`. V9 preserves the V8 destination
identity domain and deterministic vector for the same logical application,
run, invocation, and effect tuple. A fresh successor tuple still receives a
fresh destination effect ID, while reconstructing an existing tuple under a
later ledger schema cannot bypass its retained V2 receipt or permanent negative
closure.

### The first executable policy is one exact retry

The initial policy accepts only an application-state V2 `put-if-absent` effect
whose retained reconciliation is verified `NOT_APPLIED`. The source effect
must retain the exact registered V2 adapter, destination, positive verifier,
negative verifier, and substantiated `idempotent, transactional` replay
properties. Requested replay labels do not create authority and cannot replace
those checks.

The successor copies the complete immutable logical request. It receives a
fresh run ID, invocation ID, effect ID, and destination effect ID and, when it
executes, a fresh attempt identity and fence. The old destination effect remains
permanently closed; the fresh destination effect competes under its own
application-state transaction and produces its own receipt or negative closure.

`NOT_APPLIED` proves only that the exact source destination effect did not apply
and can never apply. It does not prove that a different managed effect or an
unmanaged caller did not write the same business key. A successor may therefore
validly receive an `already-present` result without contradicting the source
reconciliation.

### A successor is a separate framework-owned effect-only run

The target is a fresh run containing one Wharfie-owned invocation that issues
exactly the retained managed-effect request through the finite built-in
catalog. It does not load or execute the source application activity, resume
the abandoned process, synthesize a user continuation, or claim anything about
unmanaged work in the source handler.

The target has a dedicated V9 lifecycle, rather than the generic manual-run
lifecycle. A newly authorized target is `RUNNING`, its framework-owned
invocation is `RUNNABLE`, and it has no physical attempt or effect. It has no
generic lifecycle claim to acquire or release. One atomic
`effect-successor-started` transition creates its sole `STARTED` attempt and
sole `STARTED` effect together, then authorizes exactly one adapter entry. A
dedicated terminal transition closes that same attempt, effect, invocation,
and run. Generic claim, attempt-start, managed-effect, terminal, and manual
cancellation transitions reject successor targets at both mutation and fold
boundaries.

Its framework handler is fixed and effect-only, but the target remains an
independently inspectable run with its own lifecycle and terminal result. A
target completion does not add `COMPENSATED`, change the source effect result,
or terminalize the source invocation.

This first vertical may authorize and execute the target through an internal
operator seam. It does not turn the run directory into a ready-work queue,
mount a public successor command before its final surface review, or claim a
persistent resident scheduler. Later background execution requires a dedicated
ready index, durable claims or leases, and recovery rules.

The shared recovery command understands the fresh successor invocation ID but
never dispatches its adapter. A target that has crossed its atomic start boundary
is transitioned through the dedicated interruption path to visible uncertainty;
destination reconciliation is a separate operator action. There is no generic
claim to release. Manual cancellation is not successor authority in this
initial one-slot policy and is rejected before any manual-owner routing as well
as at the write and replay/fold boundaries. A later cancellation or post-start
resume contract must define how replacement authority is obtained without
inventing a second sibling target.

### Authorization and target creation are one transaction

One cross-partition transaction:

1. verifies the exact source run, invocation, abandoned attempt, reconciled
   effect, uncertainty event, reconciliation event, immutable request, evidence,
   and finite retry policy;
2. reserves one deterministic causal retry slot for that source reconciliation;
3. appends one `effect-successor-authorized` event to the source aggregate;
4. creates the target run and its framework-owned invocation with one
   `effect-successor-run-created` event;
5. creates the target run-directory row; and
6. reserves the caller's stable application-scoped successor ID.

The immutable target request payload may be published before this transaction.
An orphan payload is inert and content-addressed; it grants no execution
authority. Once the transaction commits, source authorization, target work,
the causal slot, the caller-supplied identity, projections, receipts, and directory row
either all exist or none do.

Authorization advances only the source run and invocation versions, sequences,
and update time because it appends an event to that aggregate. The source run
stays `BLOCKED`, the invocation stays `UNCERTAIN`, and the source attempt and
effect remain byte-identical.

### Stable caller-supplied identity and a causal slot make creation first-wins

The caller supplies one stable successor ID and must reuse it after an uncertain
response. The ID is scoped to the application rather than one run. Exact replay
of the same successor ID, source, policy, actor, and reason returns the retained
authorization and target without creating another run.

Reusing that stable ID for different work conflicts. The source reconciliation
also owns one deterministic retry slot, so changing only the public successor
ID cannot authorize an equivalent sibling. A race between competing IDs has
one retained winner.

Successor creation is authorization and durable target creation; it is not
adapter execution. Adapter authority comes only from the target's dedicated
atomic start transition and its resulting `dispatchAuthorized` result.

### The exact public surface is proposed and gated

If accepted, source and packaged CLIs mount the same operation:

```text
wharfie ops retry-effect \
  --run-id <source-run-id> \
  --effect-id <source-effect-id> \
  --successor-id <stable-id> \
  --confirm-runner-stopped \
  [--reason <private-bounded-text>] [--json]

<app> wharfie retry-effect <same options>
```

There is no caller-supplied reconciliation ID, lifecycle status, destination,
adapter, evidence, import path, or application handler. Eligibility comes from
the exact retained source effect and its verified `NOT_APPLIED`
reconciliation. The packaged form binds the source run to its embedded
application identity. Both forms require the held app-scoped LMDB local-owner
protocol and recheck the source under that fence.

The successor ID is application-scoped. A response-loss retry must reuse the
same ID, source run, effect, actor, and reason. Exact replay returns or advances
the one retained target; changing only the stable successor ID cannot bypass the causal
slot. An exact replay may perform the target's one first start only while the
target is still `RUNNING` / `RUNNABLE` with no attempt or effect. After the
dedicated atomic start commits, neither command replay nor recovery may enter
the adapter again. Confirmed recovery can only apply the dedicated interruption
transition, after which target `reconcile-effect` consults destination evidence
as a separate action.

Human and JSON responses expose only redacted causal identities and
source/target lifecycle state. They omit requests and values, destination/store
identity, receipts and evidence, actor and private reason, paths, credentials,
and fences. Defining this syntax does not accept the ADR, assert that both
parents are mounted, or establish a production support claim. Acceptance still
requires the source/packaged mounts and public command parity. The dedicated
lifecycle passes an internal source and Node-absent relocated-SEA crash/recovery
matrix through a hidden test fixture. That is implementation proof, not public
support; public mounts and public command parity remain pending.

### Forward compensation remains explicit future work

There is no executable generic compensation policy in V9. Wharfie does not
infer an inverse from `pure`, `idempotent`, or `transactional`, does not turn
`put-if-absent` into a delete, and does not accept a desired lifecycle label as
compensation evidence. Transactionality does not imply rollback, and deleting
or restoring a key could destroy state written by another effect.

A future compensation must be explicit, versioned forward work with its own
finite capability, request, preconditions, ownership rules, destination
transaction, verifier, replay properties, causal slot, and fresh target
identities. This ADR does not choose whether that plan must be declared in an
application revision before execution or may be submitted after an incident by
a trusted operator/LLM through a strict finite schema. That authority and
authoring decision must be made before any compensation command is exposed.

### Coordinator and recovery boundaries do not change

This decision does not add coordinator election, resident scheduling,
multi-host placement, or provider-backed failover. One authoritative
coordinator remains sufficient initially only under
[0002](0002-one-recoverable-active-coordinator.md): coordination truth must
survive the process, every accepted mutation must be fenced, and a replacement
must be able to rebuild from durable state. This V9 slice proves a local
append-only successor boundary, not that full coordinator-recovery contract.

## Consequences

- If accepted after its public-surface review, a permanently not-applied application-state
  effect can create useful new work without weakening or reopening source
  history.
- The implementation must prove that response loss cannot leave a committed
  source authorization without its target, or a target without its source
  authorization and application-scoped identity.
- The source remains visibly blocked after a successor finishes. Operators can
  inspect remediation without confusing it with reconciliation.
- Every physical successor action uses fresh logical and destination authority.
- Exactly-once claims remain destination-specific: application-state V2 can claim
  first-wins enforcement only because its business mutation and stable effect
  receipt are one transaction.
- Generic handler retry, workflow continuation, persistent scheduling,
  compensation, and coordinator replacement remain separate work.
- Required proof includes exact-replay and competing-ID races, source
  attempt/effect immutability, orphan payloads, transaction response loss,
  catalog mismatch, application/store isolation, redaction, generic-lifecycle
  rejection, process crashes, and source/relocated-SEA parity. The hidden-
  fixture internal Node-absent relocated-SEA successor matrix passes as an
  implementation proof; public mounts and public command parity remain exit
  criteria.

## Rejected alternatives

### Reopen the source invocation or rerun its authored handler

Rejected because a terminal managed-effect disposition does not establish what
arbitrary handler code did. Redispatch would erase the crash boundary and may
repeat unmanaged work.

### Reuse the source effect or destination identity

Rejected because the permanent negative closure intentionally bars that exact
destination identity. A successor is new work and needs new authority.

### Let replay properties authorize arbitrary successors

Rejected because their scopes differ and none implies permission to execute a
fresh logical effect. Exact disposition and a finite registered policy are
required.

### Create authorization and target work in separate transactions

Rejected because a crash between writes would leave either inert
authorization or uncaused runnable work and require another ambiguous repair
protocol.

### Infer application-state compensation

Rejected because `put-if-absent` has no context-free inverse. Compensation must
be separately authorized explicit forward work.

### Treat the run directory as a worker queue

Rejected for this slice because a history index has no ready-work lease,
ordering, fairness, or ownership contract. Persistent execution needs a
purpose-built scheduling boundary.
