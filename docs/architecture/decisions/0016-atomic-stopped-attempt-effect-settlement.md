# 0016 — Atomic stopped-attempt managed-effect settlement

**Status:** Accepted · **Date:** 2026-07-18

## Context

[0014](0014-verifier-backed-managed-effects.md) established the durable
managed-effect start boundary, and
[0015](0015-destination-bound-managed-effects.md) bound each effect to its
exact non-secret destination. The first V6 operator recovery then closed one
narrow crash window: after the operator excluded the old runner, one retained
`STARTED` application-state effect could be settled from its permanent receipt
or made `UNCERTAIN` after an exact receipt-absence probe.

That recovery could not safely handle a retained `PENDING` request or more than
one active effect. `PENDING` already means that the component's logical request
is durable, but the ledger has not authorized adapter dispatch. It therefore
needs an explicit pre-dispatch terminal rather than another execution. The
Activity Protocol also permits concurrent requests and out-of-order results,
so one stopped attempt can retain several `PENDING` and `STARTED` siblings.

The V6 singular transitions cannot settle that set sequentially. In
particular, `effect-became-uncertain` immediately abandons the attempt and
blocks the aggregate. Applying it to one sibling would make the remaining
siblings impossible to change through their original attempt fence. Conversely,
settling only the easy siblings before discovering an invalid receipt or
unavailable destination would leave a recovery operation partially applied.

The recovery boundary must therefore make one bounded, append-only decision
over the exact active effect set. It must preserve the distinction between a
request that never received dispatch authority, a begun operation with a
verified outcome, and a begun operation whose destination outcome remains
unknown.

## Decision

### V7 is a fresh semantic namespace

Atomic stopped-attempt effect settlement uses execution-ledger schema V7 under
`ledger/v7/`, a V5 run-directory partition, and the default table
`wharfie-execution-ledger-v7`. V1 through V6 histories and V1 through V4
directory rows remain inert. There is no migration or dual-write path.

V7 retains the V6 destination-bound effect contract. The new namespace is
required because it adds a `CANCELLED` effect lifecycle, a compound event that
changes several effect projections, plural operator results, and new fold
invariants that a V6 reader does not understand.

### A retained PENDING effect is cancelled without a destination probe

V7 adds this terminal transition:

```text
PENDING → CANCELLED
```

A verified `PENDING` projection proves that the request event committed but
the atomic `effect-started` authorization did not. Once the operator has
confirmed that the prior runner stopped and holds the applicable mutation
owner, no managed adapter can still acquire authority from that request.
Recovery therefore cancels it without opening or probing the destination and
never dispatches it after its component has gone away.

The terminal retains a bounded cancellation reason identifying the
`before-durable-effect-start` phase. It has no `startedBy`, outcome, outcome
reference, or uncertainty. `CANCELLED` never reopens. A future retry or
compensation policy creates distinct causally linked work rather than changing
this history.

Recovery and a concurrent `PENDING → STARTED` transition compete through the
same run head, effect version, attempt fence, and transaction. If start wins,
the recovery must reclassify the effect as `STARTED`; if recovery wins, the
adapter can no longer obtain dispatch authorization.

### Every STARTED sibling is probed before any ledger mutation

The operator collects the exact active set belonging to the current `STARTED`
attempt. An active effect is `PENDING` or `STARTED`; already terminal effects
remain unchanged. The set is sorted by effect ID and must fit the ledger's
explicit count and encoded-event budgets.

`PENDING` entries are classified locally as `cancelled-before-start`. For each
`STARTED` entry, the operator reconstructs the immutable original request and
uses only the matching destination's recovery-only catalog:

- a verifier-backed permanent receipt yields `COMPLETED` or `FAILED` and the
  action `outcome-recovered`;
- strict receipt absence yields `UNCERTAIN` and the action
  `outcome-uncertain`; and
- a missing or replacement store, unsupported contract, thrown probe, corrupt
  receipt or linked business record, or verifier failure aborts the entire
  operation without a ledger mutation.

Strict absence is not a `CANCELLED` result. It proves that this recovery found
no permanent verifier-backed outcome, not that the begun adapter definitely
performed no work. A future adapter may define a stronger, typed and verified
negative-outcome contract; recovery does not infer one from `null`.

All probes are read-only. No application source, catalog resolver, adapter
executable, or new physical delivery is reachable. After every probe settles,
the operator rereads the control ledger and requires the same attempt fence,
effect identities, versions, starts, destinations, requests, and verifier
contracts before it submits the decision.

### The complete effect set and aggregate settle in one transaction

V7 generalizes `attempt-became-uncertain` so every form carries a canonically
sorted `effects` array. The ordinary effect-free path carries an empty array;
`settleStoppedAttemptManagedEffects` carries the exact complete active set.
That one event atomically updates the run head, run directory, run, invocation,
physical attempt, and all affected effect projections.

The transition applies these dispositions:

```text
PENDING          → CANCELLED
STARTED+receipt  → COMPLETED | FAILED
STARTED+absence  → UNCERTAIN
```

In the same transaction, the stopped physical attempt becomes `ABANDONED`, its
invocation becomes `UNCERTAIN`, and the run becomes `BLOCKED`. This aggregate
outcome is required even when every managed effect is terminal: destination
receipts establish only those effects and cannot establish what arbitrary
activity code did before, after, or between them.

All sibling dispositions share one run sequence. Their order inside the event
is canonical rather than a claim that one recovery action happened before
another. Rebuild therefore never observes a partially settled sibling set or
an `UNCERTAIN` first effect beside a still-active sibling.

The provider-neutral transaction supports at most 100 distinct items. V7
admits at most 16 unresolved managed effects for one attempt and also retains
the existing 256 KiB encoded event budget. Request admission rejects a new
durable effect before physical dispatch when retaining it would make atomic
attempt closure impossible. An older or corrupt over-limit set is refused
unchanged.

### Recovery results are plural and redacted

The operator recovery envelope advances to schema v4. Its redacted `recovery`
member is:

```json
{
  "action": "settled-managed-effect-set",
  "changed": true,
  "managedEffects": [
    {
      "effectId": "remember-a",
      "action": "cancelled-before-start",
      "status": "CANCELLED"
    },
    {
      "effectId": "remember-b",
      "action": "outcome-recovered",
      "status": "COMPLETED"
    },
    {
      "effectId": "remember-c",
      "action": "outcome-uncertain",
      "status": "UNCERTAIN"
    }
  ]
}
```

Rows are sorted by effect ID and expose no request, value, destination,
receipt, evidence, store identity, path, or fencing material. `changed` says
whether this call appended the exact compound transition; it does not infer
ownership merely because another actor reached the same lifecycle state.

### Response loss never causes another destination mutation

The compound decision has one deterministic transition identity and immutable
request digest bound to the run, invocation, attempt, actor, active effect set,
and recovered dispositions. If a transaction response is lost, the
managed-effect helper reads the verified event stream and receipt. It
attributes `changed: true` after the thrown write only when that exact
transition is retained; a normal idempotent receipt replay reports
`changed: false`.

Competing authority is handled separately at the operator boundary. After a
non-identical transition wins, the operator performs a fresh verified read and
returns the existing generic `action: none`, `changed: false` result only when
the same invocation is durably blocked/uncertain/abandoned or terminal and no
managed effect remains active. A still-running or partially active set keeps
the original recovery failure. The operator never relabels the competing
transition as its own batch.

Recovered outcome payloads are content-addressed before the control
transaction. A crash can leave an unreachable payload for later garbage
collection, but it cannot leave one sibling projection committed without the
aggregate decision. Recovery may repeat read-only receipt probes after a
failed local read; it never invokes an adapter or turns a stale `PENDING`
snapshot into dispatch authority.

### Exactly-once language remains destination-specific

Atomic sibling settlement does not make arbitrary activity execution exactly
once. It also does not give that property to a destination merely because an
effect has a stable ID or the recovery batch is transactional.

Wharfie may claim one logical destination effect only where that destination
atomically enforces the stable destination effect ID with its business
mutation and a deterministic verifier proves the matching permanent receipt.
The built-in LMDB `application-state` / `put-if-absent` operation satisfies
that narrow boundary. `PENDING` cancellation, attempt abandonment, concurrent
recovery, unmanaged SDK calls, future adapters, and later workflow
continuations do not widen it.

## Consequences

- A stopped attempt can be closed without stranding any retained active
  sibling, including a set containing both `PENDING` and `STARTED` effects.
- A `PENDING` request is never physically executed merely to make recovery
  convenient.
- Destination or verifier errors preserve the complete pre-recovery ledger
  state, allowing an operator to repair access or evidence and retry.
- Even fully recovered managed effects leave arbitrary begun activity code
  visibly `UNCERTAIN` until complete attempt evidence supports reconciliation.
- The active-effect count and byte budgets become public durability limits,
  not incidental database failures.
- V7 does not read, reinterpret, or migrate historical V6 records.
- Deterministic subprocess and SEA crash tests at request publication, effect
  start, destination commit, outcome publication, compound ledger commit, and
  response delivery remain required before broader retry or exactly-once
  claims.

## Rejected alternatives

### Redispatch a retained PENDING effect after the runner stopped

Rejected because the component continuation that requested it no longer
exists. Dispatch would create new physical work without making the enclosing
arbitrary activity outcome known.

### Settle siblings one at a time

Rejected because the first uncertainty transition blocks the aggregate and
invalidates the original attempt fence for every remaining sibling. Even when
all effects have receipts, a crash between singular transitions would expose a
partially recovered set.

### Treat strict receipt absence as proof of cancellation

Rejected because absence is not a versioned negative-outcome verifier. It
supports the conservative `UNCERTAIN` state, while stronger terminal claims
require destination-specific evidence.

### Mark only the attempt uncertain and leave effect rows active

Rejected because active `PENDING` or `STARTED` effects would no longer have a
legal owner, and a later attempt terminal could omit or invent their outcome.

### Extend V6 records in place

Rejected because V6 folds and transition receipts assume one effect per event
and do not recognize the new terminal. A fresh namespace keeps the semantic
break explicit.
