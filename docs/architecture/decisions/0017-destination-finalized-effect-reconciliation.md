# 0017 — Destination-finalized uncertain-effect reconciliation

**Status:** Accepted · **Date:** 2026-07-18

## Context

[0016](0016-atomic-stopped-attempt-effect-settlement.md) closes a confirmed
stopped physical attempt in one transaction. A retained `PENDING` effect becomes
`CANCELLED`, a `STARTED` effect with a permanent destination receipt becomes
`COMPLETED` or `FAILED`, and a `STARTED` effect for which the recovery probe
finds no receipt becomes `UNCERTAIN`. In every case, the arbitrary physical
attempt remains `ABANDONED`, its invocation remains `UNCERTAIN`, and the run
remains `BLOCKED` because managed-effect evidence cannot establish what other
trusted activity code did.

Receipt absence is intentionally weaker than a negative outcome. It is one
read-time observation and does not prevent a stale delivery, delayed write, or
future redispatch from applying the same destination effect afterward. Relabeling
that observation `CANCELLED` or `NOT_APPLIED` would create a false terminal
claim. Leaving every such effect permanently `UNCERTAIN`, however, prevents an
operator from safely closing work when a destination can atomically and
permanently reject the exact stable effect identity.

The built-in `application-state` / `put-if-absent` capability can provide that
stronger contract. It already atomically stores a business mutation and a
permanent positive receipt keyed by the destination effect ID. Its next
semantic version can make a permanent negative closure compete with that same
transaction, so exactly one positive receipt or negative closure can win.

## Decision

### V8 and application-state V2 are fresh semantic namespaces

Typed uncertain-effect reconciliation uses execution-ledger schema V8 under
`ledger/v8/`, a V6 run-directory partition, and the default table
`wharfie-execution-ledger-v8`. V1 through V7 ledger histories and V1 through V5
directory rows remain inert. There is no migration, reinterpretation, or
dual-write path.

V7 cannot share this namespace. Its exact event and effect-projection schemas
do not recognize `uncertain-effect-reconciled`, `NOT_APPLIED`, or referenced
negative evidence. Writing those meanings under `ledger/v7/` would let V7 and
V8 folds disagree about the same event stream and mutable projection, breaking
the rule that every projection is reproducible from its retained history. V8
therefore also uses fresh event, transition, attempt, effect-key, destination-
effect, manual-run, and run-directory identity domains.

The built-in application-state destination also advances as one complete V2
semantic namespace. The default table is
`wharfie-application-state-v2`; record keys use
`application-state/v2/`, `identity/v2`, `value/v2`, `receipt/v2`, and
`resolution/v2`; every retained record has schema version 2; and every
content-addressed hash uses a V2 domain. The destination and adapter versions
are 2, the positive verifier is
`application-state-put-if-absent-receipt` version 2, and the negative verifier
is `application-state-put-if-absent-not-applied` version 2.

Application-state V1 state is not accepted as V2 evidence and is not mutated
by the V2 adapter. This boundary is required because a V1 `put-if-absent`
transaction does not check for a negative closure and could therefore act
after another process claimed the effect was permanently not applied.

### A permanent destination closure races the positive receipt

Application-state V2 adds a strict finalization operation for one exact
destination effect contract. Its durable result is one of:

- the existing positive receipt, revalidated against the retained effect,
  destination, request, business record, and contract digest; or
- a newly or previously committed `not-applied` closure bound to those same
  immutable values.

The destination transaction implements a first-wins race:

```text
no decision ── put-if-absent transaction ──> business mutation + positive receipt
           └─ finalization transaction ────> permanent not-applied closure
```

The normal V2 adapter requires the closure to be absent in the same atomic
transaction that writes or substantiates the business mutation and positive
receipt. The finalizer requires the positive receipt to be absent in the same
atomic transaction that writes the closure. If a valid receipt already won,
finalization returns that receipt instead of writing contradictory evidence.
If the closure already won, later execution of that destination effect ID
fails closed and cannot create a receipt or mutate business state.

Both paths validate the exact store identity, application namespace, key,
logical request, destination effect ID, and contract digest. A missing or
replacement store, unsupported contract version, mismatched record, impossible
same-effect business state without its receipt, or corrupt evidence aborts
without manufacturing a decision. The closure says only that this exact
destination effect did not apply and is permanently barred from applying; it
does not prove that no other effect or unmanaged caller changed the same key.

### Negative evidence has a typed pure verifier

The closure produces bounded immutable evidence with an exact versioned
descriptor. A registered synchronous verifier receives frozen copies of the
retained effect contract and referenced evidence. It recomputes and validates
the contract and closure digests and returns only whether that evidence proves
`not-applied` for the exact effect.

The initial exact evidence object contains only its kind and version, the
destination effect ID, effect-contract digest, resolution-record digest, the
resolution's bounded business-row observation (`absent` or the digest and
different effect identity that already owns the row), and the fixed disposition
`not-applied`. It does not contain the application value, credentials, a
mutable read-time observation, or an operator-selected outcome. The observation
is immutable input to the destination resolution record and its digest; it is
not independently trusted by the ledger.

As with positive managed-effect evidence, the verifier is pure: ledger fold,
inspection, and rebuild never contact the current destination, read ambient
credentials, or trust an operator assertion. Physical destination access
belongs only to the finite host catalog that obtains the evidence. Missing,
throwing, asynchronous, mismatched, or rejecting verifier registrations fail
closed.

### Reconciliation advances only the uncertain effect

V8 adds the terminal managed-effect status `NOT_APPLIED` and permits exactly
these evidenced transitions from an uncertain effect:

```text
UNCERTAIN + verified positive outcome  → COMPLETED | FAILED
UNCERTAIN + verified negative closure  → NOT_APPLIED
```

`NOT_APPLIED` is not `CANCELLED`. `CANCELLED` means the durable effect start
authorization never committed; `NOT_APPLIED` means the adapter may have begun,
but a destination-specific finalizer subsequently made non-application
permanent and produced evidence for that claim.

Each transition is one append-only `uncertain-effect-reconciled` event. It
retains a stable reconciliation ID, actor and reason, the exact run,
invocation, physical attempt and effect identities, the exact prior uncertainty
event and attempt fence, an immutable evidence reference and verifier
descriptor, and the resulting effect status. The event is accepted only while
the current effect is the cited `UNCERTAIN` projection and its enclosing
aggregate still matches the cited stopped-attempt history. Every fold rereads,
rehashes, and verifies its referenced evidence.

The effect becomes terminal, but the event does not reinterpret the enclosing
arbitrary code execution. The run remains `BLOCKED`, the invocation remains
`UNCERTAIN`, and their versions and last sequences advance because the event is
part of their aggregate. The physical attempt remains byte-identical
`ABANDONED` with its original uncertainty evidence, version, and last sequence.
Thus only the effect projection changes lifecycle state. Repeating the exact
reconciliation identity and contents returns its receipt; reusing the identity
for different evidence, target, reason, or result conflicts.

### Operator reconciliation requires stopped-runner exclusion

Effect reconciliation is a mutation by the one authoritative coordinator or,
for the initial local source/SEA boundary, by the ordinary exclusive local
mutation owner. An external operator must explicitly provide
`--confirm-runner-stopped`; the command confirms the exact run and application
scope before destination access and repeats that check while holding mutation
ownership. A live resident service or current runner must be excluded rather
than raced.

The operator path uses only the reconciliation-only finite catalog. It can
read or finalize the exact destination contract and append the resulting
ledger event; it cannot load application source, resolve an executable adapter,
dispatch activity code, redispatch the uncertain effect, choose a desired
status, or accept raw evidence supplied as an outcome assertion. Human and
JSON results expose only redacted lifecycle state, action, effect identity, and
stable reconciliation identity, never request values, receipts, closures,
destination paths, store identities, or fencing material.

### Retry and compensation are distinct successor work

Reconciliation records what happened to the original effect. It does not
itself retry, compensate, resume the abandoned attempt, or make the enclosing
invocation safe. Any later retry or compensation is distinct successor work
with immutable causal links to the original run, invocation, effect, original
uncertainty event, and `uncertain-effect-reconciled` event. Its eventual run and
invocation shape belongs to the workflow-continuation contract and is not fixed
by this decision. It must receive a new effect ID and destination effect ID;
it never reuses the original destination authority or masquerades as another
attempt of the abandoned invocation. Policy must authorize that successor work
from the verified disposition and the relevant substantiated replay properties.

There is no generic inverse for application-state `put-if-absent`. Deleting or
restoring a key could erase pre-existing state, another effect's later update,
or state already observed by other work. The initial V2 finalizer therefore
only closes an uncertain effect as positively applied or permanently not
applied; it does not automatically delete anything. A future compensation is
an explicit forward managed effect selected from a finite capability contract,
not an inverse inferred by the runtime. It must define its own stable identity,
preconditions, ownership semantics, destination transaction, and verifier, and
cannot add a `COMPENSATED` label to or rewrite the original effect.

## Consequences

- A read-time absence remains conservative uncertainty; only a permanent typed
  destination decision can establish `NOT_APPLIED`.
- Once the application-state V2 closure wins, the same destination effect ID
  cannot later produce the business mutation that reconciliation said did not
  happen.
- A late positive receipt can still resolve an uncertain effect without
  changing the original abandoned attempt or uncertain invocation.
- Rebuild and inspection validate both positive and negative evidence without
  destination access or credentials.
- Application-state V1 and ledger V7 histories remain inert rather than
  acquiring stronger semantics retroactively.
- This boundary supports a destination-specific effect claim only. It does not
  make arbitrary activity execution exactly once, resolve unmanaged effects,
  or unblock the enclosing invocation.
- Safe retries and forward compensations remain distinct, causally linked
  successor work with fresh destination identities. They require
  successor scheduling and continuation support rather than an operator
  shortcut.
- Crash and race tests must cover receipt-before-finalization,
  finalization-before-adapter, concurrent first-wins decisions, response loss
  after destination finalization, ledger append loss, idempotent reconciliation,
  rebuild verification, stale ownership, and source/relocated-SEA parity.

## Rejected alternatives

### Treat a second receipt-absence read as proof of non-application

Rejected because repeated observations still do not fence a stale or future
writer. Evidence for `NOT_APPLIED` must make later application impossible.

### Let the ledger alone declare an effect not applied

Rejected because a control-store event cannot atomically exclude a write in a
different destination. The negative decision must be enforced where the
business mutation and positive receipt commit.

### Reopen the V7 uncertain effect or abandoned attempt

Rejected because doing so would erase the crash boundary and allow new
physical work to masquerade as continuation of an old attempt. Resolution is
append-only, and later work receives new identities.

### Reuse the application-state V1 destination with a new verifier

Rejected because existing V1 writers do not check the negative closure. A
verifier alone cannot turn an unenforced assertion into permanent destination
truth.

### Automatically delete a value to compensate put-if-absent

Rejected because insertion has no context-free inverse. A delete can destroy
state not exclusively owned by the original effect and cannot retract prior
observation of that state.
