# 0019 — Persisted linear workflow continuations

**Status:** Accepted · **Date:** 2026-07-19

**Implementation status (2026-07-19):** the V10 ledger implements
activity-headed materialization, cursor-guarded activity claim/start, compound
verified terminal settlement, conservative recovery, and run-level
cancellation. It releases an unstarted `CLAIMED` generation back to
`ACTIVITY_RUNNABLE`, blocks a lost `STARTED` generation at
`ACTIVITY_UNCERTAIN`, accepts exact completed evidence to atomically continue
or complete the workflow, and terminalizes direct or reconciled failures
without an output or successor. Runnable and claimed cancellation removes
ready authority without authored dispatch; started cancellation persists
before exact-owner delivery; uncertain cancellation prevents continuation
without claiming a physical outcome. Matching verified `cancelled` evidence is
accepted only under the exact prior cancellation authority. Reconciliation
never rewrites the retained `ABANDONED` attempt. Ready-work V2 changes in the
same transactions.
Adapter matrices cover replay, races, injected payload and transaction
failures, projection and payload tampering, and native LMDB close/reopen.
The resident now consumes exact manifest-bound workflow `ACTIVITY` and
`RECOVERY` rows, persists the cursor-guarded start before physical dispatch,
continues ordinary activity chains serially, releases only unstarted claims,
and turns lost started work into non-runnable uncertainty. Shared source and
packaged `start` commands now persist plans composed entirely of ordinary
activity steps, and generic exact-run inspection, confirmed recovery, and
evidence reconciliation understand the workflow trigger and cursor. Generic
source and packaged `cancel` commands now share the same cursor-aware workflow
decision. Timers, signals, managed-effect successor steps, managed effects in
workflow attempts, and reconciliation of `deadline-exceeded` evidence remain
prospective.

## Context

[0011](0011-persisted-state-machine-execution-ledger.md) chooses explicit
persisted state machines and continuations instead of deterministic replay of
arbitrary application code. The resident activity worker now proves durable
submission, exact-revision serial dispatch for manual and ordinary workflow
activities, conservative `CLAIMED` and `STARTED` recovery, managed-effect
settlement for manual attempts, authenticated local commands, and graceful
shutdown. A manual invocation's terminal transition still terminalizes its
run; a workflow activity terminal instead atomically advances its persisted
cursor or terminalizes the workflow.

That shape cannot represent a durable workflow safely. A workflow needs to
retain which declared step is current, the exact output and input selected for
the next activity, why it is waiting, and whether a timer, signal, cancellation,
or activity terminal won a race. Appending a continuation after independently
committing an activity terminal would create a crash gap. Scanning run history
for every scheduling turn would also turn a history projection into an
unbounded pseudo-queue and would not give timers or restart recovery an honest
work-index contract.

The first workflow vertical should exercise the complete durable shape without
prematurely designing a general workflow language. There are no downstream
users or compatibility requirements, so a fresh execution-ledger namespace is
preferable to layering workflow semantics onto V9 records that explicitly
describe one manual invocation or one managed-effect successor.

## Decision

### V10 is one execution ledger, not a second workflow store

Persisted workflows use execution-ledger schema V10 in a fresh `ledger/v10/`
record namespace and a fresh, separately versioned work-index namespace. V9
records remain inert. There is no compatibility reader, migration,
reinterpretation, or dual-write path.

One workflow execution is one run with one append-only, totally ordered event
stream. Its workflow cursor, activity invocations, attempts, effects, timers,
signals, outputs, transition receipts, and current projections are all folded
from that stream. Normal workflow steps are not child runs, and workflow state
is not written to another database or mutable document.

V10 carries forward the existing attempt, fencing, managed-effect,
uncertainty, reconciliation, and immutable-payload rules. Advancing the control
ledger does not by itself rotate a managed effect's independently versioned
destination identity or reinterpret retained application-state evidence.

### A revision contains a finite static linear plan

The strict version 2 application manifest may declare named workflows as plain
data. The manifest contract and V10 plan-payload schema version that data; the
complete workflow map is bounded to 1 MiB of exact UTF-8 JSON and each workflow
is a finite, nonempty ordered list of at most 64 uniquely identified steps. The
initial step kinds are exactly:

- `activity` — invoke one named activity from the same application revision;
- `timer` — wait for one statically declared positive delay; and
- `signal` — wait for the logical signal named by that step's ID.

The plan is linear. Every nonfinal step has exactly one statically known
successor, and at most one continuation is active for a run. The manifest
compiler validates every step ID, activity reference, signal name, delay,
selector, ordering rule, and bound before sealing the revision. Getters,
functions, runtime imports, executable deciders, and dynamically computed
successors are not workflow definitions.

Starting a workflow persists an immutable, content-addressed snapshot of the
exact validated plan and binds its digest, workflow ID, app ID, and revision ID
to the run. A worker must cross-check that snapshot against the exact embedded
or prepared revision before it can dispatch an activity. Recovery never loads
another revision's plan and never reruns authoring-time code to reconstruct the
plan.

### Activity inputs use an explicit finite selector

Each activity step declares exactly one input selector from the initial finite
set:

- `workflow-input` — the workflow start input;
- `step-output` — the persisted output of one explicitly named earlier step;
  or
- `literal` — a revision-bound JSON value stored in the immutable plan.

The selected value becomes the activity's entire JSON input. An activity
step's output is its verified result. A signal step's output is the exact
accepted payload. A timer step's output is the canonical object
`{scheduledAt, dueAt, firedAt}` established by its schedule and firing events.
The compiler permits `step-output` only for an earlier step in the same linear
plan, so the selected value is already durable when the activity becomes
runnable. There is no expression evaluator, JSONPath dialect, templating
callback, or implicit object merge in V10.

At continuation time the engine reads and rehashes the selected immutable
value, materializes the exact next invocation request, and persists its
content-addressed reference. Resume consumes that request; it does not
recompute an input by executing workflow code.

### The persisted cursor is the orchestration position

A workflow run has one versioned cursor projection naming at least its plan,
step ID and ordinal, continuation identity, disposition, and the immutable
per-step output references available to later selectors. Activity, timer, and
signal identities derive from the run and the exact step activation. They are
stable across response loss and distinct from physical attempt identities.

The cursor disposition distinguishes an activity that is runnable
(`ACTIVITY_RUNNABLE`), running (`ACTIVITY_RUNNING`), or blocked on uncertain
delivery (`ACTIVITY_UNCERTAIN`), a timer that is waiting, a signal that is
waiting, and a terminal workflow. Every cursor change is represented by an
event snapshot and committed with the run head and all affected projections. A
projection that cannot be reproduced from the event stream fails closed.

### Successful activity output and its continuation commit atomically

Every step output is stored as a bounded, immutable, content-addressed workflow
output. Activity Protocol evidence remains separate physical-attempt evidence;
the workflow output is the logical value available to later selectors and
inspection.

Publishing output or next-input bytes is not scheduling authority. The
authoritative activity-terminal transition atomically:

1. validates the exact run head, revision, cursor, invocation, attempt,
   generation, fence, complete Activity Protocol evidence, managed effects,
   and cancellation state;
2. terminalizes the attempt and logical activity invocation;
3. for completion only, binds the verified workflow-output reference;
4. consumes the current continuation and advances the persisted cursor;
5. creates the exact next activity request, timer, or signal wait, or
   terminalizes the workflow run; and
6. replaces or removes the corresponding work-index row.

A crash after payload publication but before this transaction can leave an
unreachable content-addressed object. The attempt remains `STARTED` and no
successor exists; after its reporter is confirmed stopped, the conservative
uncertainty transition moves the cursor to `ACTIVITY_UNCERTAIN`. A crash after
the transaction sees the prior invocation terminal, its output reachable, and
exactly one retained successor. Replaying the transition returns its receipt
and cannot create another continuation.

An Activity Protocol `failed` or `protocol-failed` terminal changes the attempt,
invocation, and run to `FAILED`, leaves the cursor on the failed activation with
the matching `FAILED` or `PROTOCOL_FAILED` disposition, retains the exact prior
output prefix, and creates no output, successor, or ready row. A cancelled
activity follows the durable cancellation policy below. An uncertain activity
blocks the workflow and has no ready successor; it is never silently
redispatched.

### Recovery distinguishes an unstarted claim from begun work

Recovery conditions on the exact run head, cursor version and continuation,
invocation generation, attempt identity, and fence. A `CLAIMED` attempt may be
released only while the ledger proves that it never crossed the durable
`STARTED` boundary. One transaction retains that physical generation as
`ABANDONED`, returns the same logical invocation and cursor to runnable state,
and replaces its `RECOVERY` row with an `ACTIVITY` row. It does not erase the
old generation or create another activation.

A `STARTED` attempt whose trusted reporter has stopped is not safe to release.
One uncertainty event changes its attempt to `ABANDONED`, its invocation to
`UNCERTAIN`, its run to `BLOCKED`, and its cursor to `ACTIVITY_UNCERTAIN`, while
removing the `RECOVERY` row. No ready row, retry, or successor remains
authoritative. If no trustworthy terminal evidence is ever recovered, this is
an honest stopping condition for automation: a crash after `STARTED` but before
terminal delivery may leave the run `BLOCKED` until a future explicit policy or
operator decision exists.

Reconciliation accepts a complete verified Activity Protocol transcript ending
in `completed`, `failed`, `protocol-failed`, or an authorized `cancelled` for
that exact abandoned attempt and anchored to the exact uncertainty event. It
leaves the physical attempt byte-identical. Completed evidence persists the
logical output and atomically installs the next activity and `ACTIVITY` row or
completes the workflow unless a prior cancellation request already forbids a
successor. Failure evidence changes the logical invocation and run to `FAILED`,
advances the cursor to the matching failure disposition, retains the prior
output prefix, and creates no output, successor, or ready row. Cancelled
evidence is valid only when that abandoned attempt itself retained the prior
cancellation request and its transcript carries the exact host cancel reason.
A request recorded after the attempt became uncertain may fence future
continuation, but it cannot retroactively authorize a past cancel transcript.
`deadline-exceeded` reconciliation remains deliberately unsupported.

Response-loss replay is decision-oriented. It verifies the request against the
original receipt event and returns the current run and invocation authority
together with the event-anchored cursor, optional output and successor, and
affected attempt. Exact cursor and run-head guards prevent callers from
combining those historical decision fields into current execution authority.
Content-addressed payload publication may leave unreachable objects when the
ledger transaction loses; garbage collection for those payloads is deferred.

### The transactional work index is a locator, including restart work

V10 introduces a transactionally maintained work index before mounting
workflow dispatch. Each row identifies the exact app, revision, run, cursor,
invocation or timer, run version and sequence, work kind, and eligibility time
that produced it. Immediately runnable activities sort as eligible now; timer
rows sort by their persisted fire time.

The row is written, replaced, or removed in the same database transaction as
the event, run head, cursor, invocation, attempt, timer, and other projections
that change its meaning. A current activity row remains discoverable as it
moves from `RUNNABLE` through `CLAIMED` and `STARTED`; deleting it at claim time
would make a killed worker's stale attempt undiscoverable. The row disappears
only when the work becomes a signal-only wait, `ACTIVITY_UNCERTAIN`, or
terminal, or it is atomically replaced by a successor row. Releasing an
unstarted claim replaces `RECOVERY` with `ACTIVITY`; marking a started attempt
uncertain removes `RECOVERY`; completed-evidence reconciliation creates exactly
one successor `ACTIVITY` row or no row for terminal completion; direct and
reconciled failures leave no row.

The initial work-index row kinds are runnable activity, activity recovery, and
timer; the resident currently dispatches only the first two. A schema-level
continuation row is reserved for fail-closed,
framework-owned cursor advancement or repair when an immediate successor
cannot be materialized in its normal compound transition. It never represents
a signal wait and never authorizes user-code dispatch. Normal activity, timer,
and signal transitions should not need it.

The index never grants execution authority. The resident queries only its
exact app and revision, rebuilds the named run from its event stream, verifies
the row against the exact cursor and projection versions, and then relies on
the ordinary fenced transition to claim, recover, fire, or advance work. A
stale or extra row is ignored and cannot dispatch. A missing or corrupt row is
a liveness failure repaired from the authoritative event stream, not permission
to scan a projection and guess at work.

The existing run-history directory remains an inspection locator. It is not a
scheduler fallback once V10 workflow dispatch is mounted.

### Timers persist one decision and fire once

Entering a timer step computes its requested fire time once from the authored
delay and the transition's observed wall-clock time. The timer identity,
`scheduledAt`, `dueAt`, target continuation, carried context, and work-index
row commit together. Restart never recomputes `now + delay`.

Observing that the earliest timer is due is read-only. One conditional
`timer-fired` transition consumes the exact waiting timer, persists its
canonical `{scheduledAt, dueAt, firedAt}` output, and atomically enters its
statically declared successor, including the successor work row when needed.
Repeated due observations, concurrent cancellation, response loss, and process
restart return or observe the one retained decision rather than creating
another firing.

This local single-node timer uses wall-clock time only to establish
eligibility. It does not claim exact firing time or solve clock trust across
machines. Store-authoritative time, leases, and coordinator epochs remain part
of the later multi-host control-store contract.

### Signals consume only the current expected wait in V10

A signal submission carries a required stable delivery ID and one bounded,
content-addressed JSON payload. The initial V10 policy accepts a signal only
when the exact run cursor is currently waiting for that declared signal. An
unknown run is refused without mutation. For an existing run, an early,
wrong-step, or late delivery appends a durable rejection against the observed
run head and consumes that delivery identity without advancing the workflow
cursor or making the payload a step output. An exact retry returns the retained
rejection; reusing the delivery ID with different target, signal, payload, or
actor conflicts. This is an audit/replay decision, not a durable early-signal
inbox; buffering for later consumption is explicitly deferred.

Signal acceptance and consumption are one run-head transaction. It appends the
accepted delivery, binds its payload as that step's output, consumes the exact
signal wait, advances the cursor, and creates the successor request and work
row or terminal outcome. An exact retry of the delivery ID, signal, payload,
actor, and target returns the retained receipt after response loss. Reusing the
delivery ID with different contents conflicts. Another delivery cannot consume
the already consumed wait.

Local source and packaged signal commands use the same app-scoped ownership
boundary as submission. They route to the authenticated resident when it owns
the control volume or acquire short-lived local ownership only after proving
that no resident is active. Socket delivery is not durable signal authority.

### Cancellation is a run decision and cannot race past a continuation

Workflow cancellation has a stable request identity, actor, reason, and
observed time. For a runnable activity, timer wait, or signal wait, one
transaction records cancellation, consumes the cursor, cancels unstarted work,
removes its work-index row, and terminalizes the workflow without executing
user code.

For a `STARTED` activity, durable cancellation intent commits before the exact
active owner sends the Activity Protocol cancellation frame. A cancellation
request does not erase begun work or prove a physical outcome. A matching
verified `cancelled` terminal may then close the run; ambiguous termination
becomes `UNCERTAIN`. Verified failure remains failure. Verified final success
may complete the run, but a non-final success observed after cancellation does
not create a later workflow continuation.

For an already uncertain activity, cancellation records a durable
no-continuation decision while retaining `BLOCKED`, `UNCERTAIN`, `ABANDONED`,
and `ACTIVITY_UNCERTAIN`. It does not rewrite the abandoned attempt or claim
that the old physical execution stopped. A later reconciliation must still
provide exact terminal evidence under the rules above.

Timer firing, signal consumption, activity terminal, and cancellation all
condition on the same run head and exact cursor. If they race, one transaction
wins and every loser rereads the resulting authoritative state. There is no
process-local "cancellation won" or "timer won" flag that can supersede event
order.

The authenticated resident command endpoint must therefore support run-level
workflow cancellation even while no physical activity is active. The existing
manual active-attempt cancellation port remains only the physical delivery
capability for an exact `STARTED` attempt.

### Resume is pinned to the original revision

The run, plan snapshot, cursor, every activity invocation, and every work-index
row bind one immutable revision. A resident may dispatch only rows matching its
exact prepared or embedded revision and must cross-check the retained plan and
activity binding before user code can start.

Installing or starting a newer revision does not reinterpret or advance an old
workflow. If the pinned artifact is unavailable, the run remains durably
waiting or blocked until that exact revision is restored or a future explicit
migration protocol is used. V10 defines no workflow migration and no mutable
`latest` alias.

### The first public vertical is deliberately narrow

The first V10 proof is one manually started, single-active-continuation workflow
that can follow a linear path such as:

```text
activity -> timer -> signal -> activity -> terminal
```

Source and packaged commands share workflow start, expected-signal delivery,
cancellation, inspection, and the resident worker implementation. The moved
SEA must run the same path from locked LMDB with Node unavailable on `PATH`.

Branches, loops, parallel steps, child workflows, retry/backoff policy, cron or
other scheduled starts, a durable early-signal inbox, dynamic expressions,
workflow migration, multi-revision coexecution, OS service installation,
multi-host leases, placement, and coordinator failover are not part of V10.
Manual activity and scheduled starts are not silently rewritten into workflows
in this decision.

## Required proof

The implementation is incomplete until tests establish at least:

- manifest and plan canonicalization, selector availability, stable identities,
  payload bounds, exact replay, conflicting reuse, event folding, and
  projection-corruption failure;
- atomic creation, replacement, and removal of work-index rows across runnable,
  `CLAIMED`, `STARTED`, timer, signal-wait, blocked, and terminal states,
  including pagination and stale-row rejection;
- activity-terminal/output/continuation atomicity, with a crash before the
  transaction leaving no successor and a crash after it exposing exactly one;
- one persisted timer fire time, read-only due observation, one conditional
  firing, and restart before and after the firing transaction;
- signal payload publication, atomic expected-signal consumption, duplicate
  response-loss replay, conflicting delivery rejection, and refusal of
  unknown, early, and late deliveries;
- cancellation races against activity terminal, timer fire, and signal
  consumption, with no continuation after retained cancellation;
- exact-revision filtering, stale `CLAIMED` release, conservative `STARTED`
  uncertainty, supported-terminal reconciliation that preserves the abandoned
  attempt, output-free direct and reconciled failure, managed-effect blocking,
  and no workflow advance while an invocation is uncertain;
- true LMDB close/reopen and real process `SIGKILL` recovery with locking
  enabled; and
- one source end-to-end path plus one installed, relocated SEA path through
  activity, timer, signal, persisted output, and terminal completion with Node
  absent from `PATH`.

Existing managed-effect destination and response-loss matrices remain
authoritative for the activity's internal effect boundary. Workflow proof must
show that a terminal effect/attempt creates at most one continuation and that
an uncertain effect/attempt creates none; it need not duplicate every existing
destination crash case under a second wrapper.

## Consequences

- Wharfie gains a useful workflow without replaying arbitrary workflow code or
  introducing a second programming model at recovery time.
- A completed activity and the authority for its successor can never be split
  by a process crash.
- Timers and signals are durable ledger decisions rather than process-local
  callbacks or socket messages.
- The ready/recovery index improves scheduling liveness while remaining a
  rebuildable, nonauthoritative projection.
- Persisted outputs and exact next inputs make later inspection and agent
  operation possible without parsing logs or rerunning a decider.
- Linear, single-active execution keeps each transition within the portable
  transaction bound and leaves graph scheduling and fan-out for a later
  reviewed schema.
- Exact revision pinning may leave old workflows waiting when their artifact is
  unavailable. That visible lack of capacity is safer than executing them under
  new code.

## Rejected alternatives

### Replay a TypeScript workflow function

Rejected because ordinary Node code can read time, randomness, process state,
native modules, files, and networks. Re-executing it would either repeat
unmanaged effects or impose a second constrained programming model.

### Commit an activity terminal and append its continuation later

Rejected because a crash between those writes loses forward progress, while a
retry without one atomic receipt can create duplicate successors.

### Use the run-history directory as the workflow queue

Rejected because a history locator has no due-time ordering, current-work
lifecycle, or bounded scheduler contract. Full-history scans get slower as
terminal history grows.

### Remove a ready row as soon as an attempt is claimed

Rejected because a process crash would leave the stale `CLAIMED` or `STARTED`
attempt outside the only scheduler locator. Recoverable current work must
remain indexed until it becomes waiting, blocked, or terminal.

### Recompute timers, inputs, or successors after restart

Rejected because recovery must consume the decision that became authoritative,
not make a new decision from a later clock, mutable code, or reconstructed
process state.

### Run each workflow step as an independent child run

Rejected because it creates a cross-aggregate causality protocol before the
single-run state machine is proven. Normal step history belongs to one run and
one ordered event stream.

### Resume old work under the newest artifact

Rejected because a new revision may change activity code, plan structure, input
meaning, and effect behavior. Revision migration requires a separate explicit
and reversible protocol.
