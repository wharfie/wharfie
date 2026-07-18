# 0013 — Durable cancellation and evidence-backed reconciliation

**Status:** Accepted · **Date:** 2026-07-17

## Context

[0011](0011-persisted-state-machine-execution-ledger.md) establishes that
cancellation is durable intent, that begun unsafe work can become
`UNCERTAIN`, and that reconciliation requires evidence. The initial V3 manual
ledger deliberately stops short of those transitions. It accepts
`completed`, `failed`, and `protocol-failed` attempt terminals, but rejects a
physically valid `cancelled` or `deadline-exceeded` transcript because no
durable cancellation or deadline decision precedes it.

The activity protocol already has a narrower physical contract. A host can
send one cancellation frame, expose interruption to the handler, bound the
cooperative grace period, and terminate a one-shot worker. That transcript is
evidence about one physical attempt. It is not by itself authority to cancel a
durable invocation, proof that an unmanaged external effect did not occur, or
permission to rewrite a terminal outcome that already won the ledger race.

The V4 manual-ledger slice therefore defines an exact ordering between durable
intent and physical delivery. Retained evidence must also be able to resolve
genuinely uncertain work later without allowing an operator to select a
convenient outcome or silently retry code. An external command must route only
to the live owner that can perform that delivery; a generic store mutation would
otherwise race the owner or record intent that it cannot honestly deliver.

## Decision

The cancellation-capable manual ledger is a **V4 schema boundary**. V3 history
does not acquire cancellation semantics retroactively, and the implementation
must not dual-write a cancellation into V3 and V4 as if they were one event
stream.

### Durable intent precedes physical delivery

A cancellation request has a stable identity, actor, reason, observed time,
target invocation, and the current run version and applicable attempt fence.
The ledger validates those values, appends the immutable request event, and
updates its projections in one transaction. Repeating the same request
identity and contents returns its receipt; reusing the identity for different
contents is a conflict.

Only the active owner of an attempt may turn that accepted request into a
physical cancellation signal. It must first receive or reread the committed
request, then send the Activity Protocol cancellation frame whose attempt and
canonical reason match the persisted request. Failure, conflict, or ambiguity
while appending the request must not be followed by a best-effort signal. This
ordering prevents a physical `cancelled` transcript from appearing without the
durable decision needed to authorize its logical meaning.

The implemented V4 slice exposes this through core cancellation APIs, delivery
by the active foreground `ops run` owner, and a narrow authenticated external
owner command. The first `SIGINT` or `SIGTERM` becomes a request that is
committed before the owner signals the physical attempt. Source `wharfie ops
cancel` and packaged `<app> wharfie cancel` use the same durable-before-signal
ordering, but only when they reach that exact live owner.

### Manual cancellation state transitions

The V4 single-invocation manual aggregate uses these rules:

- If the invocation is `RUNNABLE` and has no physical attempt, cancellation
  atomically makes the invocation and run `CANCELLED`. No attempt is invented.
- If the current attempt is `CLAIMED`, the cancellation transition validates
  its fence and atomically makes that attempt, its invocation, and its run
  `CANCELLED`. The attempt never crossed the durable handler-start boundary.
- If the current attempt is `STARTED`, the accepted cancellation request does
  not terminalize any entity. The attempt remains `STARTED`, the invocation
  remains `RUNNING`, and the run remains `RUNNING` while the active owner
  delivers cancellation and gathers evidence.
- A complete, revalidated Activity Protocol transcript ending in `cancelled`
  may commit the invocation's authoritative `CANCELLED` outcome only when the
  same run history already contains a matching cancellation request for that
  exact attempt. The transcript must include the matching host cancellation
  frame and its terminal; a bare terminal or request is insufficient.
- A later complete, revalidated `completed` or `failed` transcript may remain
  authoritative even after the request was persisted, including after a host
  cancellation frame when the Activity Protocol permits that transcript. The
  request does not prove when the physical attempt observed its signal, so the
  verified physical terminal race decides the invocation outcome. A verified
  `protocol-failed` transcript can likewise be authoritative when it
  establishes the physical attempt's outcome.
- A host cancellation frame followed by `protocol-failed` because termination
  was unavailable, failed, or could not be confirmed does not establish that
  outcome. The attempt becomes `ABANDONED`, the invocation becomes
  `UNCERTAIN`, and the run becomes `BLOCKED`; Wharfie does not relabel this
  delivery ambiguity as a logical application failure.
- A terminal that wins before the request append remains authoritative, and
  the losing cancellation caller observes it without rewriting it.
- If a begun attempt is lost, cannot be terminated, or cannot deliver or
  durably commit trustworthy terminal evidence, its physical attempt becomes
  `ABANDONED`, its invocation becomes `UNCERTAIN`, and its run becomes
  `BLOCKED`. A cancellation request alone never shortens this path to
  `CANCELLED`.
- Cancelling an already `UNCERTAIN` invocation cannot resolve it. Cancelling a
  terminal invocation cannot replace its outcome. The initial V4 API may
  reject both requests with the verified current state rather than add a
  general operator-note event family.

The request and terminal transitions race through the run's existing
optimistic version and current attempt fence. There is no process-local
"cancellation won" flag that can supersede the accepted ledger order.

### Meaning of `CANCELLED`

`CANCELLED` means that cancellation became the one authoritative logical
outcome under the rules above. It does not mean rollback, physical
exactly-once execution, or proof that no externally visible action occurred.
A handler may have acted before observing the signal, an in-flight managed
effect may finish while cancellation is being delivered, and trusted Node code
may have made an unmanaged SDK call.

The ledger therefore retains the cancellation request, complete attempt
evidence, and any effect evidence independently. A host-generated `cancelled`
terminal after confirmed one-shot-worker termination can establish the
physical attempt outcome, but it cannot erase or reinterpret effects that may
have preceded termination.

### Evidence-backed reconciliation

Reconciliation is a subsequent API over this V4 event model, not a prerequisite
for shipping the first active-owner cancellation slice. Until that API exists,
`UNCERTAIN` remains durably blocked.

A reconciliation request must have a stable identity, actor, reason, expected
run version, applicable fence, the exact uncertainty event it addresses, an
immutable evidence reference, and the verifier that substantiates the
evidence. The first supported evidence class should be a complete host-owned
Activity Protocol transcript revalidated against the persisted revision,
invocation, attempt, start frame, and fence. A reconciled `cancelled` outcome
additionally requires the matching earlier cancellation request.

Reconciliation may move the invocation and aggregate run from `UNCERTAIN` and
`BLOCKED` to the terminal outcome established by that evidence. It does not
change the original attempt from `ABANDONED` to another terminal state. The new
reconciliation event links that attempt, its uncertainty event, the evidence,
and the resulting invocation outcome. Repeating the same reconciliation is
idempotent; conflicting evidence or an already committed terminal outcome
fails closed.

An operator-selected status, prose assertion, retry count, absence of an
observed error, or incomplete transcript is not outcome evidence. Such
material may remain attached as diagnostic evidence in a future operator-note
facility, but it cannot resolve uncertainty. Adapter-specific destination
evidence can be added later only with a verifier that defines what it proves.

### Deferred boundaries

This decision does not add managed-effect persistence. Protocol effect IDs are
currently correlated inside one physical attempt, while [0004](0004-logical-outcomes-and-effects.md)
and [0011](0011-persisted-state-machine-execution-ledger.md) require a stable
logical effect identity across attempts plus adapter- and destination-backed
evidence. A future effect slice must persist effect request/start/outcome
transitions before invoking the adapter; it must not infer durable effect state
only from a final attempt transcript.

Compensation is also deferred. It will create distinct causally linked work
and will leave the original invocation, attempt, effects, and evidence intact.
V4 does not add a `COMPENSATED` status or reopen a terminal invocation.

Deadlines remain separate durable timer or scheduling decisions. Activity
Protocol deadline handling does not make `deadline-exceeded` a supported V4
ledger terminal until the ledger records the corresponding deadline decision.

### External cancellation requires an owner command path

The implemented local external surface is source `wharfie ops cancel` and the
flat packaged `<app> wharfie cancel`. Both require `--run-id` and an explicit
stable `--request-id`; a caller retries a lost response with the same request
ID. They share one exact-run client that first opens the ledger read-only,
rejects a cross-app packaged request, reads the current LMDB manual-owner
record, and routes the request only to a distinct per-session endpoint owned by
the same local principal and scope. The endpoint uses canonical JSON and an
HMAC keyed by the 256-bit session ID, verifies the exact durable owner
generation before invoking the active-attempt port, and bounds request,
response, and handler time.

The port accepts only an exact run ID and request ID. Its actor and cancellation
reason are fixed by the owner rather than supplied by the peer; it rereads and
persists durable intent before it signals the exact active `STARTED` attempt.
The external command cannot directly cancel `RUNNABLE`, `CLAIMED`, unstarted,
or merely resident-service work. A stale, unavailable, unauthenticated,
malformed, or timed-out route reports no confirmed delivery and never falls
back to a direct ledger mutation. A terminal or already uncertain run instead
reports its authoritative state with no delivery required. The current transport
is deliberately disabled on Windows until same-principal named-pipe ACL
semantics are established.

## Consequences

- A physical cancellation cannot outrun or invent its durable authorization.
- The owner-controlled V4 pre-start path can cancel work without introducing
  uncertainty; the external command deliberately cannot target that path.
- Begun work remains visibly nonterminal until evidence establishes an outcome.
- Cancellation races are resolved by the same append-only order, optimistic
  version, and fencing rules as every other durable transition.
- `CANCELLED`, `UNCERTAIN`, effect outcome, and compensation remain distinct
  concepts that inspection can explain.
- The implemented slice stays narrow: core V4 transitions, foreground and
  exact-current-owner delivery, rebuild validation, and crash/race tests.
  Evidence-backed reconciliation can follow without changing event meaning.
- Tests cover request idempotency and conflict handling, `RUNNABLE` and
  `CLAIMED` cancellation, durable-before-signal ordering, both request/terminal
  race orders, rejection of unmatched cancelled evidence, loss to `UNCERTAIN`,
  projection rebuild, and failure before signal when persistence fails.

## Rejected alternatives

### Send cancellation first and record it afterward

Rejected because a crash or conditional-write loss could leave a physical
`cancelled` transcript with no authoritative request, or could let a terminal
outcome win while a stale process still believes cancellation owns the run.

### Treat a cancellation request as a terminal outcome for begun work

Rejected because requesting cancellation neither proves that the attempt
stopped nor establishes what unmanaged or in-flight effects occurred.

### Let an operator choose the outcome of uncertain work

Rejected because a trusted operator is authorized to act, not to convert an
unsupported assertion into execution evidence. Reconciliation must record and
verify the basis for the outcome it establishes.

### Expose `ops cancel` before the active owner can receive it

Rejected because a direct store mutation cannot honestly claim delivery to a
live attempt, while bypassing local ownership would create two control-plane
writers.
