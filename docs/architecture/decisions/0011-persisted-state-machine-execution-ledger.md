# 0011 — Persisted state-machine execution ledger

**Status:** Accepted · **Date:** 2026-07-17

## Context

Wharfie must carry a local TypeScript application beyond the lifetime of one
process or authoring session. Durable execution therefore has to preserve why
work exists, which immutable code owns it, what physically ran, what effects
may have happened, and which outcomes are authoritative after a crash.

The former operation store, accepted as an interim boundary in
[0007](0007-atomic-operation-snapshots.md), atomically persisted a mutable
`Operation` plus its current `Action` graph. Operation generations, record
versions, and immutable revision bindings prevented several stale writes, but a
process failure could leave an operation or action permanently `RUNNING`. Prior
generations and attempts were overwritten, external effects were not
represented, and there was no durable basis for recovery or coordinator
replacement.

Deterministic workflow replay is one possible recovery model, but it is a poor
default for Wharfie's application boundary. Initial Wharfie activities are
arbitrary trusted TypeScript/Node handlers. They can use time, randomness,
process state, Node-API modules, native libraries, filesystem state, network
clients, and SDKs whose behavior is neither deterministic nor interceptable.
They can also perform unmanaged effects without going through Wharfie. Trying
to make that code replay-compatible would either produce false guarantees or
replace the approachable Node programming model with a constrained workflow
language.

Wharfie instead needs durable orchestration whose state is explicit data. The
model must remain suitable for the later versioned activity protocol, managed
effects, resident single-node service, and one recoverable authoritative
coordinator described by [0002](0002-one-recoverable-active-coordinator.md),
[0004](0004-logical-outcomes-and-effects.md), and
[0008](0008-immutable-identity-spine.md).

## Decision

Wharfie durable execution uses **explicit persisted state machines and
continuations**, not deterministic replay of application code.

Application handlers run only as physical attempts. Wharfie persists every
orchestration decision needed to decide what may happen next: invocation
creation, dependency resolution, placement, timers, signals, attempt claims,
handler start, outcomes, cancellation, effects, retry decisions, and operator
intervention. Recovery reads this durable truth and schedules the next legal
transition. It never reconstructs state by rerunning prior user code.

### Identity hierarchy

The execution ledger has four nested public identities:

- A **run** is one requested or triggered execution of application behavior.
  `runId` is stable for the request's idempotency domain. A run immutably binds
  `appId`, `revisionId`, its trigger identity, input, and stable user context.
- An **invocation** is one logical activity call within a run. `invocationId` is
  stable across retries and names an exact activity, input, and continuation
  position. Reusing it for different work is a conflict.
- An **attempt** is one physical execution of an invocation. `attemptId` is
  globally unique, while `generation` is a monotonically increasing integer
  scoped to the invocation. An attempt also records the executing node,
  artifact, lease, and coordinator epoch.
- An **effect** is one explicit operation performed through a Wharfie-managed
  effect adapter. `effectId` is stable across attempts that are retrying the
  same logical effect. It is scoped to its invocation and cannot be reused for
  different effect input or semantics.

Every identity is an opaque canonical value with an unambiguous storage
encoding. Provider delivery identities can derive a stable `runId`, but mutable
receipts, lease observations, and transport metadata belong to attempts rather
than run identity. The activity context exposes `runId`, `invocationId`,
`attemptId`, and the attempt's fencing token.

### Authoritative event stream and rebuildable projections

Each run owns an append-only, monotonically sequenced event stream. Ordering is
total within one run; Wharfie does not invent a global order across unrelated
runs. A run head records the current sequence and optimistic version.

Each accepted transition atomically:

1. validates the expected run-head version, entity state, immutable revision,
   idempotency identity, and required fencing values;
2. appends one or more immutable events at the next sequence numbers; and
3. updates the affected current-state projections.

An event contains at least its schema version, `runId`, sequence, stable event
identity, event type, observed time, actor, relevant entity identities, fencing
values, and canonical payload or immutable payload reference. Sequence, not a
wall-clock timestamp, determines order. Event records are created only with a
nonexistence condition and are never updated by normal operation. A retry of
the same transition identity returns the already accepted result; reuse of that
identity with different contents fails visibly.

Run, invocation, attempt, and effect projections are mutable indexes for fast
inspection and scheduling. They are not independent truth. Every projection
change is committed in the same transaction as its event, and all projections
must be reproducible by folding the retained event stream. Projection schema
migrations therefore cannot reinterpret or delete historical events. Archival
or retention, when designed, must preserve the evidence required by referenced
runs, outcomes, effects, and operator decisions.

### State machines

The initial state vocabulary is deliberately explicit.

A run is one of:

- `PENDING` — accepted but no invocation has begun;
- `RUNNING` — at least one invocation is active or runnable;
- `BLOCKED` — durable work exists but cannot currently advance, including an
  uncertain invocation, missing capability, outstanding signal, or operator
  decision;
- `COMPLETED`, `FAILED`, or `CANCELLED` — terminal.

An invocation is one of:

- `PENDING` — created but its durable prerequisites are not satisfied;
- `RUNNABLE` — eligible for an attempt;
- `RUNNING` — the current fenced attempt owns execution;
- `WAITING` — waiting for a durable timer, signal, approved retry time, or
  another explicit continuation condition;
- `UNCERTAIN` — a begun unsafe attempt was interrupted and its outcome or
  effects cannot yet be established;
- `COMPLETED`, `FAILED`, or `CANCELLED` — terminal.

An attempt is one of:

- `CLAIMED` — durably assigned, but the handler-start boundary has not been
  crossed;
- `STARTED` — Wharfie durably recorded that user code may have begun;
- `COMPLETED`, `FAILED`, `CANCELLED`, or `ABANDONED` — terminal physical-attempt
  states.

An effect is one of:

- `PENDING` — a stable effect identity and request have been recorded;
- `STARTED` — the adapter may have begun the operation;
- `COMPLETED` or `FAILED` — a supported adapter produced durable outcome
  evidence; or
- `CANCELLED` — the effect was cancelled before the adapter could have begun;
  or
- `UNCERTAIN` — the destination outcome cannot be established.

Substantiated adapter semantics can allow a transition directly between some
of these states in one destination transaction. The event still records the
logical transition and its evidence.

Terminal entity states do not transition to a different terminal state. An
invocation has at most one authoritative terminal outcome; after it is
resolved, exactly one such outcome exists. Attempt outcomes are evidence for
the invocation but are not themselves competing invocation outcomes. An
`UNCERTAIN` invocation or effect is durable and blocked, not terminal and not
automatically retryable.

The allowed transition families are:

- run: `PENDING → RUNNING | BLOCKED | FAILED | CANCELLED`,
  `RUNNING → BLOCKED | COMPLETED | FAILED | CANCELLED`, and
  `BLOCKED → RUNNING | COMPLETED | FAILED | CANCELLED`;
- invocation: `PENDING → RUNNABLE | WAITING | FAILED | CANCELLED`,
  `RUNNABLE → RUNNING | WAITING | CANCELLED`,
  `RUNNING → RUNNABLE | WAITING | UNCERTAIN | COMPLETED | FAILED | CANCELLED`,
  `WAITING → RUNNABLE | FAILED | CANCELLED`, and evidenced reconciliation from
  `UNCERTAIN → COMPLETED | FAILED | CANCELLED`;
- attempt: `CLAIMED → STARTED | CANCELLED | ABANDONED` and
  `STARTED → COMPLETED | FAILED | CANCELLED | ABANDONED`; and
- effect: `PENDING → STARTED | COMPLETED | FAILED | CANCELLED`,
  `STARTED → COMPLETED | FAILED | UNCERTAIN`, and evidenced reconciliation from
  `UNCERTAIN → COMPLETED | FAILED`.

These are necessary but not sufficient conditions. Aggregate invariants also
apply: for example, a run cannot become `COMPLETED` while any invocation is
nonterminal; cancellation cannot make begun ambiguous work disappear; and a
`RUNNING → RUNNABLE | WAITING` invocation transition requires a terminal
attempt plus a substantiated retry-safe contract. Once an invocation is
terminal, an operator retry creates distinct causally linked work rather than
reopening or rewriting that invocation.

### Attempts, leases, generations, and fencing

Attempt dispatch is at-least-once. Failures near lease boundaries can produce
overlapping physical attempts, so correctness cannot depend on preventing a
stale process from continuing to run.

An attempt's fencing token composes:

- the current coordinator epoch; and
- the current monotonically increasing invocation generation.

Every attempt claim, scheduling decision, heartbeat, cancellation mutation,
managed-state write, effect transition, and outcome commit carries and validates
the applicable fence at the durable boundary. An old epoch or invocation
generation can finish physically but cannot append a current ledger event,
change a projection, or commit Wharfie-managed state. Heartbeats extend
liveness information; they do not replace fencing.

The durable `CLAIMED → STARTED` transition is written immediately before
entering user code. Losing a claim before `STARTED` is safe to abandon and
reschedule. Once `STARTED` is durable, recovery assumes user code may have run.
If the handler or its effect boundary has a substantiated replay property,
policy may schedule a later generation. Otherwise the invocation becomes
`UNCERTAIN` when its lease is conclusively lost.

### Effects and replay properties

Managed effects record their stable identity, canonical request, adapter,
declared and substantiated replay properties, attempt fence, and outcome
evidence. Supported properties remain those accepted by [0004](0004-logical-outcomes-and-effects.md):
`pure`, `idempotent`, and `transactional`; they may compose. Without a supported
property, an effect is `unsafe`.

Trusted in-process Node code can bypass the managed effect API. A handler is
therefore `unsafe` by default after `STARTED` unless its handler-level contract
has a substantiated replay-safe property. Wharfie never infers safety from a
retry count, an SDK method name, or the absence of an observed error.

An exactly-once claim is allowed only when the destination atomically enforces
the stable `effectId` with its business mutation. An outbox alone establishes
durable at-least-once intent, not exactly-once processing. Direct external calls
remain unmanaged and can force the enclosing invocation to `UNCERTAIN` after
interruption.

### Timers, signals, and scheduling decisions

Timers and signals are ledger data rather than process-local callbacks.

- Creating a timer records its stable identity, requested fire time, and target
  continuation. A coordinator later appends the fenced timer-fired decision.
  Repeated observation of the same due timer does not create a second logical
  firing.
- An incoming signal has a stable delivery identity and canonical payload.
  Acceptance is appended once, then the state machine records which
  continuation consumed it. Unknown, duplicate, early, and late signals remain
  inspectable according to an explicit policy.
- Retry eligibility, backoff, placement, and dependency resolution are explicit
  scheduling events. They are not recomputed from current code during history
  replay.

Wall-clock observations can determine when a timer becomes eligible, but event
sequence and conditional transitions determine which firing or retry decision
became authoritative.

### Cancellation, reconciliation, and compensation

Cancellation is a durable request with actor, reason, and time. It is not
process termination and does not erase prior work.

Work that has not crossed the handler-start boundary can become `CANCELLED`
without ambiguity. A running attempt receives a cancellation signal when the
activity protocol supports it, but a lost or unresponsive begun unsafe attempt
cannot be declared safely cancelled merely because the operator requested it.
It becomes `UNCERTAIN` if its outcome cannot be established. A terminal
invocation outcome that won the ledger race remains authoritative.

Reconciliation is an explicit operator or adapter action with stable identity,
actor, reason, evidence, and fencing. It may establish the single invocation or
effect outcome when evidence supports that conclusion. It may also leave the
work uncertain. It never silently retries ambiguous code, invents success, or
rewrites a committed outcome.

Compensation is new work. It creates a distinct invocation and effects with a
causal link to the work being compensated. The original attempt, effect, and
outcome remain in history; a `compensated` label cannot replace their evidence.

[0013](0013-durable-cancellation-and-evidence-reconciliation.md) specializes
these rules for the implemented cancellation-capable V4 manual ledger. The
foreground active owner and an authenticated same-principal current-owner
command both commit a request before physical delivery. The owner-controlled
V4 transition can make unstarted work `CANCELLED`; the external command itself
only targets a live `STARTED` attempt. Begun work remains nonterminal until a
matching cancellation transcript or other verified terminal evidence
establishes its outcome; ambiguous post-cancellation termination becomes
`UNCERTAIN`. Later reconciliation cannot rewrite the original abandoned
attempt.

### Revision pinning and upgrades

A run binds one exact immutable application `revisionId`. Its invocations and
attempts execute artifacts belonging to that revision. A deployment upgrade
affects new runs by default and never reinterprets an existing event, input,
continuation, effect, or outcome under new code.

An in-flight run either continues on its pinned artifact or becomes visibly
blocked when that artifact or a required capability is unavailable. A future
explicit run-migration protocol may append a migration decision only after it
defines state-schema compatibility, activity mapping, effect safety, and
rollback behavior. Updating a mutable alias such as `latest` is never a run
migration.

### Payloads and externalization

The ledger may retain small lifecycle summaries inline, but payload-bearing
records use immutable, content-addressed payload references containing at
least digest, byte size, media type, schema identity, and storage identity.
The current V4 manual vertical stores its `{input, callerMetadata}` request
envelope and complete terminal evidence behind those references; projections
retain only the request/evidence descriptors and a minimal terminal summary.

External payload bytes are made durable before the transaction that references
them. The ledger append is the authoritative point at which the payload becomes
part of execution history. The ledger consumes exact provider bytes and
rehashes them against the reference before using decoded payload data; mutable
paths or provider object names without a verified digest are not sufficient.
Normal stale, conflicting, and idempotent requests preflight their ledger state
before publishing new bytes. A crash or a concurrent append race after
publication can still leave an unreachable object. Garbage collection may
remove only payloads proven unreachable from retained ledger events and other
durable roots.

### Crash recovery

On startup or coordinator replacement, Wharfie validates or rebuilds
projections from the event stream, then reconciles every nonterminal run.

- `PENDING` and `RUNNABLE` invocations can be scheduled from their recorded
  continuation state.
- A lost `CLAIMED` attempt that never reached `STARTED` is abandoned and can be
  replaced by a higher generation.
- A lost `STARTED` attempt is retried only when its substantiated replay contract
  permits it; otherwise it transitions to `UNCERTAIN`.
- A committed terminal invocation is never executed again. Duplicate trigger
  delivery returns its existing authoritative result or conflict.
- A projection that disagrees with its events fails closed and is rebuilt or
  quarantined; it is never treated as authorization for new work.

Deterministic crash tests at event append, projection update, handler start,
effect start, effect outcome, invocation outcome, and transport acknowledgement
boundaries are part of the implementation contract.

### Local ledger and provider-backed coordinator boundary

The execution ledger and coordinator control store are distinct semantic
contracts even when one physical database implements both.

Local development and single-node restart may store the ledger in LMDB on one
durable volume and use a locally exclusive resident-service session. The first
implementation gives the hidden `ledger-service` a stable per-application
identity (shared across revisions), a separate durable ownership record, and a
fenced lifecycle record in the same table as the ledger. An owner first binds a
fresh endpoint derived from its random typed session ID, then conditionally
claims the exact previously observed owner record. The ownership record binds
the logical local scope and operating-system principal as well as the session
and generation; another scope or principal fails closed rather than deriving a
different endpoint and proceeding. A stale Unix-socket pathname is never
reused or unlinked by a successor.

After ownership is claimed, the service records `STARTING` → `READY` →
`STOPPING` → `STOPPED`. A process crash removes its live socket listener (while
the old pathname may remain), does not fabricate `STOPPED`, and lets one later
owner conditionally replace the absent session with a new endpoint and higher
generation. On the same local LMDB control volume, mutating source `wharfie ops
run`, packaged `<app> wharfie run`, recovery, and reconciliation acquire that
same ownership fence and refuse to race a resident service; read-only
inspection does not.

Foreground activity origination also shares one core host. The installed
source command supplies one sealed prepared revision; the packaged command
supplies only its validated embedded manifest and revision/runtime pair. Both
derive the V7 manual run from app identity plus the caller's idempotency key and
use the same claim, `STARTED`, managed-effect, framed-attempt, terminal,
cancellation, and cleanup path. Unlike source-free operator transitions,
packaged execution authority is exact-revision scoped: an artifact cannot
override its app, revision, source directory, run ID, attempt, or fence.

Exact-run inspection, confirmed recovery, evidence-backed reconciliation, and
current-owner cancellation share one core implementation between the installed
CLI and packaged artifacts. The installed form is `wharfie ops
inspect|recover|reconcile|cancel`; the packaged form is `<app> wharfie
inspect|recover|reconcile|cancel`. A packaged operator derives its authority
only from the validated embedded revision/runtime pair and rejects a run whose
app identity differs before output or mutation. Authority is app-scoped across
successor revisions because these transitions never execute app code; the run's
pinned revision remains unchanged. Inspection opens existing local control
state read-only and never creates a missing volume or table. Recovery and
reconciliation are explicitly confirmed mutations after every runner has
stopped; reconciliation additionally accepts only a bounded transcript file,
uses a stable caller reconciliation ID, and lets the ledger verify the exact
prior uncertainty event rather than accept an operator-selected outcome.
Packaged recovery and reconciliation require the local LMDB protocol, while
source forms retain their documented configured-adapter behavior. External
cancellation requires LMDB: it reads the current owner read-only, then uses an
authenticated per-session command endpoint only for that exact live
same-principal foreground `STARTED` attempt. It requires a stable request ID
for retries and never falls back to a direct mutation or treats a resident
lifecycle owner as a worker.

This is deliberately not a lease, heartbeat, scheduler, work claim, or
distributed coordinator protocol. It can recover after process restart on one
local volume, host/network namespace, and operating-system principal, but it
cannot claim automatic recovery after host or volume loss. The hidden resident
runtime rejects vanilla and distributed control adapters: their semantics
cannot substantiate this single-host ownership protocol. The current
source-level runtime also uses LMDB while the SEA build externalizes that native
dependency; portable clean-machine service startup remains an explicit
packaging/verification task, not a property of this lifecycle record.

Automatic coordinator replacement requires a provider-backed **ControlStore**
with semantic operations for lease acquisition, renewal, epoch increment, and
fenced transactions. Lease expiry is evaluated against store-authoritative
time, and every mutation validates current lease authority. The existing
generic `DBClient.transactionWrite` interface and caller-generated timestamps
do not by themselves meet that contract.

Ledger transition APIs accept fencing values from their first implementation so
provider-backed coordination can replace local coordination without changing
run semantics. Provider selection, enrollment, transport authentication, and
automatic two-node failover remain later milestones; this decision does not
pretend that an LMDB ledger provides them.

### Retired operation snapshot store

The `Operation`/`Action` snapshot store, graph runner, and operation table were
deleted on 2026-07-17 after manual execution, exact-run inspection, explicit
recovery, immutable payload references, resident-service ownership, and the run
directory all moved to this ledger. Its development-only records are not
migrated or read. Keeping a second writable run system would make recovery and
operator semantics ambiguous.

Queue and schedule triggers remain future work and must create runs through
this ledger rather than reintroducing mutable snapshots. If a pure DAG
representation is useful for workflow planning, it may produce typed
invocation-creation decisions; it is not durable execution truth.

## Consequences

- Application authors keep ordinary TypeScript/Node semantics; they do not have
  to write replay-deterministic workflow code.
- Durable truth is inspectable as stable identities, immutable events, current
  projections, effect evidence, and operator decisions rather than inferred
  from logs.
- Recovery can distinguish work that is safe to resume from work that is
  genuinely ambiguous.
- At-least-once physical dispatch and one authoritative logical outcome are
  explicit, compatible claims.
- Projections make normal queries practical, but every transition is more
  expensive because it atomically updates projections and appends history.
- Event and payload retention, projection migrations, and crash testing become
  first-class engineering obligations.
- Unsafe in-process code can block in `UNCERTAIN` and require human or adapter
  reconciliation. This friction is intentional and preferable to duplicate
  unmanaged effects.
- Provider-backed coordinator recovery cannot be claimed until a ControlStore
  satisfies authoritative lease and fencing semantics independently of the
  local ledger implementation.

## Rejected alternatives

### Deterministic replay of arbitrary application handlers

Rejected because ordinary Node code, native dependencies, and unmanaged effects
are not reliably replay-deterministic. Constraining them would undermine
Wharfie's local-CLI programming model, while pretending otherwise would create
incorrect recovery guarantees.

### Continue extending mutable operation/action snapshots

Rejected because overwriting current status cannot retain attempts, effects,
operator actions, or ambiguity evidence and cannot reconstruct durable truth
after coordinator replacement.

### Append events without transactional projections

Rejected because schedulers and operators need efficient current-state queries,
while independently written projections can authorize work that has no matching
history. Event append and projection mutation must share one atomic boundary.

### Treat process logs or queue visibility as execution truth

Rejected because logs are observational, queue leases are delivery mechanisms,
and neither can establish one fenced invocation outcome or whether an external
effect happened.
