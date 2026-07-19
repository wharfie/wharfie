# 0018 — Causally linked managed-effect successor work

**Status:** Proposed · **Date:** 2026-07-19

## Context

[0017](0017-destination-finalized-effect-reconciliation.md) can establish a
terminal destination disposition for one retained uncertain managed effect. A
verified positive receipt makes the effect `COMPLETED` or `FAILED`; a permanent
destination-side negative closure makes it `NOT_APPLIED`. None of those
transitions establishes what arbitrary activity code did before or after the
effect. The original physical attempt therefore remains `ABANDONED`, its
invocation remains `UNCERTAIN`, and its run remains `BLOCKED`.

That boundary records truth but does not carry intent forward. An operator may
need to retry an effect that is now proven not to have applied, or an
application may define explicit forward work in response to an effect that is
proven to have applied. Neither action may reopen the abandoned attempt,
redispatch the authored handler, reuse the old destination authority, or imply
that the original invocation is resolved.

The distinction is especially important for the existing replay-property
vocabulary. `pure`, `idempotent`, and `transactional` describe substantiated
parts of an effect contract, but they are not interchangeable permissions to
execute a new logical effect. In particular, idempotency may be scoped to the
old stable destination identity, and transactionality establishes an atomic
boundary rather than rollback or repeatability. `unsafe` remains the default
for begun in-process application handlers.

Wharfie therefore needs one narrow successor-work boundary before general
workflow continuations and scheduling. It must preserve the source history,
make authorization and target creation crash-atomic, and prove one useful
executable policy without pretending to have designed generic compensation.

## Decision

### V9 and run-directory V7 are fresh; application-state V2 remains current

Managed-effect successor work uses execution-ledger schema V9 under
`ledger/v9/`, a V7 run-directory partition, and the default table
`wharfie-execution-ledger-v9`. V1 through V8 ledger histories and V1 through V6
directory rows remain inert. There is no migration, reinterpretation, or
dual-write path.

V9 carries the V8 uncertainty, stopped-attempt settlement, and
destination-finalized reconciliation semantics forward, then adds successor
authorization, a successor-run trigger, a host-managed successor invocation
kind, and causal successor projections. A V8 reader cannot fold those records
or distinguish their work from a manual authored activity. V9 therefore uses
fresh event, transition, attempt, effect-key, manual-run, successor, and
run-directory identity domains.

The built-in application-state destination remains one complete V2 semantic
namespace. Its transaction, positive receipt, permanent negative closure,
verifiers, store identity, and business-key meaning do not change in this
decision. A control-ledger upgrade must not hide the same application's
business state in a new physical table or force an unrelated destination
contract version.

Destination-effect identity becomes independently versioned rather than
embedding `EXECUTION_LEDGER_SCHEMA_VERSION`. V9 uses that stable identity
contract for every ordinary and successor effect. Fresh successor run,
invocation, and effect IDs naturally produce fresh destination IDs, while a
future ledger schema bump alone will not change destination authority. The V2
application-state verifier continues to bind the exact supplied destination
ID, logical effect identity, request, destination, receipt or closure, and
effect-contract digest. Application-state versions advance only when those
destination enforcement or evidence semantics change.

This transition preserves the V8 destination-identity domain and vector under
a new dedicated identity-version constant. That is deliberate: recreating the
same logical `(app, run, invocation, effect)` tuple after a control-ledger
upgrade must not bypass a retained positive receipt or permanent negative
closure. Fresh successor tuples still receive fresh identities.

### A successor is a separate effect-only run

Each successor is a new run containing one host-managed effect-only invocation.
It is not:

- another physical attempt of the source invocation;
- another authored activity invocation inside the blocked source run;
- an execution of the source activity handler; or
- evidence that the source invocation acquired a terminal outcome.

The successor run has a discriminated `effect-successor` trigger, and its
invocation has a distinct managed-effect-successor kind. The runtime does not
disguise that invocation as a user activity or load application source to
execute it. A trusted host uses the finite, versioned managed-effect catalog to
perform exactly the target effect contract retained by the successor run.

A separate run gives the successor an independent lifecycle and terminal
outcome while the source aggregate remains honestly blocked. It also defers
multi-invocation run aggregation, workflow dependency semantics, and resident
scheduling to the workflow-continuation contract rather than defining them
accidentally in an operator recovery feature.

Every successor receives fresh run, invocation, effect, and destination effect
identities. Its authorization retains the sole planned effect before any
physical attempt exists. A claim creates a fresh physical attempt identity and
fence, but only the successor-specific atomic start transition grants adapter
authority. No successor identity is reused as the source effect ID or source
destination effect ID.

### Authorization and target creation are one append-only transaction

Creating a successor atomically:

1. validates a currently retained terminal effect whose disposition came from
   the exact cited `uncertain-effect-reconciled` event;
2. validates the cited original uncertainty event, reconciliation event,
   immutable evidence, source effect contract, policy, and target contract;
3. claims one deterministic first-wins causal-slot row;
4. appends one `effect-successor-authorized` event to the source run;
5. creates the target run with one `effect-successor-run-created` event, its
   initial runnable host-managed invocation, and the content-addressed plan for
   its sole effect; and
6. adds the target's `kind=effect-successor` V7 directory row.

The slot, source authorization, target creation, projections, transition
receipts, and directory row share one provider transaction. A crash or lost
response therefore cannot leave an authorization without its target run or a
runnable target without its source authorization. The deterministic slot key,
not an event scan, rejects a second public successor ID for equivalent work.

The source authorization records bounded immutable links to:

- the source run, invocation, abandoned attempt, and reconciled effect;
- the original uncertainty event ID and sequence;
- the reconciliation event ID and sequence plus reconciliation ID;
- the verified source disposition and evidence reference;
- the successor intent and versioned policy or application-plan descriptor;
  and
- the target run, invocation, effect, destination effect, revision, request,
  and contract identities.

Authorization performs the complete bounded source verification once. The
target retains one immediate parent authorization event ID and content digest
and revalidates that direct edge by exact key and digest. It never recursively
folds the ancestor chain. Same-application scope, an earlier parent event,
source-target inequality, strict payload limits, and cycle rejection are
mandatory. A later retry descends from its immediate reconciled successor, so
chains are serial (`O -> S1 -> S2`) rather than multiple siblings occupying the
same slot.

Authorization is append-only. It advances the source run and invocation
versions, last sequences, and update times because the event belongs to that
aggregate. The source run stays `BLOCKED`, the invocation stays `UNCERTAIN`,
the source attempt remains byte-identical `ABANDONED`, and the reconciled
source effect remains byte-identical in its terminal disposition. A successor
completion never adds `COMPENSATED`, changes the source effect result, or
terminalizes the source invocation.

### Stable successor identity and causal slots make creation first-wins

A caller supplies one stable successor ID and reuses it after an uncertain
response. The runtime derives the fresh target identities from the application,
source reconciliation, successor intent, and successor ID. The complete
authorization request is content-bound.

Repeating the same successor ID and byte-identical source, intent, slot,
policy, target contract, actor, and reason returns the retained authorization
and target run without another dispatch. Reusing that successor ID with any
different content conflicts.

The source also owns a causal policy slot so changing only the public retry ID
cannot accidentally authorize equivalent work twice. The initial executable
retry slot is exactly one `retry/1` slot for one source reconciliation. A
future forward-compensation slot is scoped by an exact versioned application
plan, for example `forward-compensation/<plan-id>@<version>/1`. Different plan
identities represent deliberately different application work rather than
deduplication aliases.

Successor creation is only authorization and durable work creation. It never
invokes the adapter. Exact replay returns the same target and may hand a still
`RUNNABLE` target to the independent idempotent executor; replay of a terminal
target never invokes the adapter.

### Successor execution is a dedicated atomic effect state machine

A host-managed successor is not executed through the ordinary authored
activity start/effect-request sequence. That sequence has an unsafe gap: a
process can durably mark an attempt `STARTED` and die before requesting its
effect, leaving no evidence that distinguishes an unstarted effect-only plan
from begun arbitrary code.

The successor-only executor instead uses these transitions:

1. The target begins `RUNNABLE` with a retained sole-effect plan and no effect
   projection or adapter authority. A durable claim creates a `CLAIMED`
   physical attempt. Loss before successor start is safely recoverable to a
   fresh generation without dispatch.
2. The request payload may be published before start. One
   `effect-successor-started` transaction moves the claimed attempt directly to
   `STARTED` and materializes the authorized effect directly as `STARTED`.
   Only a caller receiving `applied: true` from that exact transition may enter
   the finite adapter. An orphan payload is rehashed and reused; it is not
   evidence of dispatch.
3. After the adapter returns, one `effect-successor-terminal` transition
   validates the retained outcome/evidence and atomically settles the effect,
   physical attempt, logical invocation, and run as `COMPLETED` or `FAILED`.
4. If the executor is confirmed stopped after the atomic start, recovery never
   redispatches it. One successor-specific interruption transition preserves
   the physical attempt as `ABANDONED`, the effect as `UNCERTAIN`, and the
   logical child as blocked. Destination finalization then races the exact
   positive receipt and permanent negative closure. One
   `effect-successor-reconciled` transition atomically settles the sole effect
   and logical child: positive success completes it, positive failure fails it,
   and `NOT_APPLIED` fails it with that explicit cause. The physical attempt
   remains byte-identical `ABANDONED`.

Because this invocation contains no authored code before or after its sole
effect, exact destination evidence is sufficient to terminalize its logical
aggregate. The same evidence remains insufficient to terminalize the original
authored source invocation. A successor reconciled `NOT_APPLIED` may authorize
one new child from its own reconciliation slot; earlier runs and effects remain
unchanged.

Cancellation of successor runs is rejected in this first vertical.
Cancellation after authorization but before start would otherwise consume the
only source slot without performing or conclusively reconciling the planned
effect.

### Created successors are discoverable and restartable

The atomic creation transaction publishes the target run in the private V7
directory with `kind=effect-successor` and an actionable status. The public
authorization result always identifies that target. Both the foreground
operator command and a future resident scheduler call the same source-free,
idempotent `executeManagedEffectSuccessorRun(runId)` host seam; neither loads
application source.

The retry command is create-or-resume. For the same successor ID it executes a
`RUNNABLE` child, returns a retained terminal child without dispatch, or enters
confirmed-stopped recovery for a `STARTED` child. A separately restarted host
can find orphan `RUNNABLE` children through bounded private directory paging.
This does not introduce a public run list or claim automatic resident
scheduling before that scheduler exists.

### The first executable policy retries only an exact NOT_APPLIED effect

The first policy is intentionally destination-specific. It accepts only a V9
application-state V2 `put-if-absent` effect whose exact reconciliation is
verified `NOT_APPLIED` and whose retained adapter substantiates the canonical
`idempotent, transactional` properties.

The successor copies the complete immutable logical request and exact V2
destination binding, adapter, verifier, and replay-property contract. It gives
that request a fresh successor run, invocation, effect, and destination effect
identity. The old destination effect remains permanently barred, while the new
identity receives its own first-wins application-state transaction and receipt
or negative closure.

`NOT_APPLIED` proves only that the exact source destination effect did not
apply and can never apply. It does not prove that another managed effect or an
unmanaged caller did not write the same application key. The successor may
therefore receive a valid `already-present` result. That result belongs to the
new successor effect and does not contradict the source reconciliation.

No generic property-only policy is introduced. Requested replay properties are
never authority; only substantiated properties and the exact registered policy
contract are considered. The initial policy rejects `COMPLETED`, `FAILED`,
unreconciled, mismatched, or `unsafe` source effects. It also rejects arbitrary
handler retry even when one managed effect inside that handler is safely
reconciled.

### Forward compensation is new work, not an inferred inverse

Forward compensation is distinct successor work. Its authorization must
identify the source contracts and verified dispositions it accepts and define
its own target capability, request, preconditions, ownership rules,
destination transaction, evidence verifier, and replay properties. The
complete plan, authorizing revision or policy, and target revision are
immutable content-bound parts of authorization.

The runtime does not infer a plan from `pure`, `idempotent`, or `transactional`,
does not turn `put-if-absent` into a delete, and does not accept an operator's
desired lifecycle label as compensation evidence. Transactionality alone does
not imply rollback. Idempotency under the source destination ID does not imply
that a fresh destination ID can safely repeat an applied operation.

One product choice remains open before this ADR can be accepted:

- **Incident-authored manual plan (recommended):** a trusted operator or LLM
  may provide a strict bounded logical effect request after the incident. The
  request contains only a finite-catalog capability, operation, input, and
  requested properties; the host supplies and substantiates the app scope,
  destination, adapter, verifier, transaction, and replay properties. The
  request becomes a versioned, immutable one-off forward plan before
  authorization. Any future _automatic_ compensation still requires a
  predeclared immutable application plan.
- **Predeclared-only plan:** every compensation must already exist in the
  immutable source revision. No compensation command is exposed until the
  application manifest has a versioned plan schema and resolver.

Both choices require a fresh causal slot and target identities and forbid
credentials, adapter callbacks, destination paths, raw evidence, or arbitrary
code in operator input. The initial application-state `put-if-absent` contract
has no generic inverse. An executable plan may create a distinct forward
marker or other finite-catalog effect, but it may never infer delete, restore,
rollback, or a `COMPENSATED` source label.

### The operator boundary is app-scoped, stopped, and redacted

The initial retry surface has source and packaged parity:

```text
wharfie ops retry-effect \
  --run-id <source-run> \
  --effect-id <source-effect> \
  --from-reconciliation-id <reconciliation> \
  --successor-id <stable-id> \
  --confirm-runner-stopped \
  [--reason <private-bounded-text>] [--json]

<app> wharfie retry-effect <same options>
```

The packaged command is bound to its embedded app ID. The source command
derives the retained app scope before opening destination state. Both require
exclusive app/store mutation ownership, reject a live source or target runner,
and recheck stopped state under that ownership. Actor is host-derived and is
not a caller option. Retry pins the source revision and exact retained effect
contract; it never silently retargets to current source.

Preflight validates app ownership and the cited retained reconciliation before
reading any future forward-plan file or opening destination state. The command
accepts no raw evidence, desired lifecycle status, destination selector,
credential, adapter callback, import path, application CLI, or activity
handler. Missing, replaced, corrupt, or unsupported destination state fails
closed rather than initializing a new store.

Human and JSON responses expose only the action, replay flag, source causal
IDs, target run/effect IDs, and redacted lifecycle statuses. They never expose
request inputs or values, destination/store configuration, evidence or
receipts, actor or reason, fences, local paths, credentials, or private adapter
errors. Failures after private preflight use the same generic redaction in
source and relocated SEAs.

### Authored handlers remain outside the successor boundary

The operator and host can recover the retained managed-effect request and use
the finite catalog. They cannot load or rerun the source activity, resume the
abandoned process, synthesize the user's continuation, or assume the handler
performed no unmanaged work. A begun in-process handler remains `unsafe` by
default even when all of its visible managed effects now have terminal
dispositions.

General handler retry requires a separately substantiated handler-level replay
contract plus durable workflow continuation and scheduling decisions. Those
semantics are not inferred from this effect-only vertical.

## Consequences

- A permanently not-applied application-state effect can produce useful new
  work without weakening or reopening its source history.
- Source authorization and target creation survive response loss as one
  first-wins decision.
- The source remains visibly blocked after a successor succeeds; operators can
  inspect the causal link without mistaking remediation for reconciliation.
- Every target adapter action has new logical and destination authority and is
  fenced by the target run's own attempt lifecycle.
- V8 ledger records remain inert. Application-state V2 remains the current
  destination contract, so control-ledger upgrades neither hide business state
  nor rotate external idempotency authority.
- `idempotent` and `transactional` remain evidence inputs, not generic retry or
  rollback switches.
- Forward compensation remains explicit new work under the selected authority
  model; neither choice introduces a generic inverse.
- Admission tests must cover orphan request publication; the all-or-nothing
  source event, slot, target event/projections, public identity, receipt, and
  directory transaction; response loss; competing successor IDs, actors, and
  reasons; altered evidence; slot/public-ID conflicts; one-hop causal rebuild;
  and byte-identical source attempts and effects.
- Execution tests must cover initial `RUNNABLE`, claim loss before start,
  request-payload orphan reuse, atomic start before adapter entry, adapter entry
  before destination commit, destination receipt, outcome publication, atomic
  terminal append, terminal response loss, stopped positive/negative
  reconciliation, `O -> S1 -> S2` chaining, directory discovery/resume, and
  terminal replay with zero dispatch.
- Ownership, app/store isolation, corrupt or replaced destinations, private
  error redaction, rejection of every authored CLI/activity dispatch path, and
  source/relocated-SEA parity are required proof obligations.

## Rejected alternatives

### Reopen the original invocation or retry its abandoned attempt

Rejected because a terminal effect disposition does not establish what
arbitrary handler code did. Reopening the invocation would erase the crash
boundary and silently redispatch potentially unsafe authored work.

### Put the successor invocation inside the blocked source run

Rejected for this vertical because it would require general multi-invocation
run aggregation, runnable work inside a blocked aggregate, dependency
semantics, and scheduling policy. A separate target run preserves the causal
relationship without preempting the workflow-continuation design.

### Let replay properties alone authorize a fresh effect

Rejected because property scopes differ. A destination may deduplicate only
the original stable identity, and a transaction may atomically commit a
non-repeatable mutation. Exact disposition and versioned destination policy
must authorize the successor.

### Create the source authorization and target run in separate transactions

Rejected because a crash between them would leave either inert authorization
or uncaused runnable work. Repairing that split state would require another
ambiguous recovery protocol.

### Use the ordinary activity start and effect-request lifecycle

Rejected because a crash after an ordinary attempt becomes `STARTED` but
before it requests the planned effect cannot establish whether any arbitrary
work began. A successor is trusted effect-only work, so its attempt start and
sole effect start must be one atomic authority boundary.

### Recursively fold the complete causal ancestry

Rejected because a long successor chain would make local rebuild cost
unbounded and turn one corrupt or unavailable distant ancestor into a read
amplifier. Authorization fully verifies the source once; the child validates
one bounded content-bound parent edge.

### Execute a generic application-state compensation now

Rejected because `put-if-absent` has no context-free inverse. Deleting or
restoring a key can destroy another effect's state and cannot retract prior
observations. Compensation must be explicit application-defined forward work.
