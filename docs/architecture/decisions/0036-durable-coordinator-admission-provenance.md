# 0036 — Durable coordinator admission provenance

**Status:** Accepted · **Date:** 2026-08-27

## Context

[ADR 0033](0033-explicit-coordinator-epoch-authority.md) makes an active
coordinator token part of the same-table transaction fence for authoritative
ledger and schedule mutations. That proves which coordinator could commit at
the linearization point, but the admitted history previously retained only the
version 10 admission fence value `coordinatorEpoch: 0`. After a later explicit
takeover, the durable run could not say which authority admitted it.

Historical attribution is needed for the bounded run-creation boundaries that
already share the authority transaction: manual runs, workflow runs, scheduled
workflow occurrence/run pairs, and the two records of an atomic managed-effect
successor handoff. This must not turn the event fence into an attempt fence,
invent authorship for older rows, or couple exact retry to whichever
coordinator happens to be current during readback.

## Decision

### Retain the stable authority token at admission

A newly authority-bound admission retains the complete stable coordinator
token: `schemaVersion`, `appId`, `coordinatorId`, `authorityId`, and `epoch`.
The token is an optional `coordinatorAuthority` member of the existing version
10 creation-event payload for:

- `manual-run-created`;
- `workflow-run-created`;
- `effect-successor-authorized`; and
- its atomically paired `effect-successor-run-created` event.

The event fence remains `coordinatorEpoch: 0`. Admission provenance identifies
the authority that admitted logical work; it is not a physical attempt epoch,
does not authorize later mutation, and does not create a global version 11
ledger namespace.

The authority token remains outside the semantic transition-request digest.
An exact retry after takeover therefore resolves to the already committed
admission and returns its retained original token. It does not conflict merely
because the reader now holds a higher authority. A new admission still checks
the caller's current token in the same transaction.

### Scheduled occurrence and workflow history agree exactly

An authority-bound schedule occurrence uses strict occurrence schema version
2 and stores the same token as `coordinator_authority`. The workflow creation
event and occurrence are written in their existing atomic admission
transaction and must retain byte-equivalent tokens. A mismatch, a token on
only one side, a malformed version 2 row, or an application-mismatched token is
corrupt state and fails closed.

Occurrence schema version 1 remains the exact legacy/unbound shape and cannot
carry the new field. An unbound preparation consumed by a same-application
bound ledger is upgraded in its still-uncommitted transaction material to a
version 2 occurrence. A fresh higher-authority schedule control may re-prepare
an already committed logical occurrence; replay retains the occurrence's
original token rather than replacing it.

### Absence means unknown, and public history remains redacted

Older and deliberately unbound admissions omit the token. Absence means
legacy, unbound, or unknown provenance. Wharfie does not infer the current
authority, infer epoch zero, backfill retained history, or migrate rows as part
of a read.

Low-level internal ledger folds and admission results retain the token so
recovery code can reason about the durable admission. The public operator view
continues to project its established redacted history shape: it adds no
coordinator-authority field and does not disclose authority or coordinator
identifiers.

## Consequences

- The admitted logical work can be attributed to the exact stable authority
  that won its transaction, even after explicit takeover.
- Both records of a managed-effect successor handoff have one provenance
  identity; disagreement makes either side unreadable as valid linked state.
- Version 1 schedule occurrences and existing version 10 events remain
  readable without synthetic provenance.
- Semantic idempotency remains stable across takeover because historical
  authorship is readback data rather than request identity.
- This decision adds no lease, automatic takeover, cursor audit field,
  backfill, public-history field, reconstruction policy, or multi-node proof.

## Rejected alternatives

### Put the authority epoch in the existing event fence

Rejected because that fence is part of the version 10 logical-admission
contract and physical attempt fencing has different semantics. Changing it
would conflate authorship with dispatch authority and create a wider namespace
migration.

### Attribute old admissions to the current coordinator

Rejected because a read after takeover cannot prove who committed older work.
Synthetic attribution would turn an availability-friendly compatibility path
into false history.

### Include provenance in the request digest

Rejected because an exact retry under a replacement coordinator would conflict
with unchanged logical work instead of returning the retained winner.

### Expose the token in public operator history now

Rejected because this slice needs internal recovery evidence, not a new public
inspection contract. A future disclosure decision can define an intentionally
redacted or privileged surface separately.
