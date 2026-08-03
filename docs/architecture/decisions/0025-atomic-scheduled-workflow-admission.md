# 0025 — Atomic scheduled-workflow admission

**Status:** Accepted · **Date:** 2026-07-27

## Context

ADR 0024 defines revision-bound workflow schedules, deterministic logical
occurrences, latest-only catch-up, and authoritative schedule causes. Its
first cursor design described selecting a pending occurrence durably before
starting the ordinary workflow in a second transaction.

That split is not safe across application activation cutover:

1. the old resident can persist a revision-bound pending occurrence;
2. activation can move from `ACTIVE` to `QUIESCING`;
3. ordinary run admission for the old revision then closes;
4. quiescence sees no workflow run;
5. ownership can transfer to the new revision; and
6. neither dropping nor retaining the old revision's pending request has a
   correct normal outcome.

Dropping it loses admitted logical work. Retaining it strands a request whose
sealed workflow plan is no longer authorized. Preventing cutover indefinitely
would turn ordinary schedule response loss into an application availability
failure.

The cursor and the workflow run therefore need one linearization point.

## Decision

### There is no durable pending-selection state

One schedule cursor records:

- application and schedule identity;
- exact revision and definition identity;
- the definition's activation boundary;
- the inclusive wall-clock horizon already considered;
- a positive compare-and-swap version; and
- the observation time of that durable cursor state.

It contains no selected occurrence, pending workflow request, retry lease, or
workflow-start receipt. An observation has only two durable outcomes:

- a no-due transaction advances the cursor horizon; or
- a due transaction advances the cursor and admits the complete ordinary
  workflow run atomically.

The activation boundary and horizon are canonical UTC minute values. Cursor
observation time cannot precede either the prior observation or the new
horizon. Evaluation and retained occurrence windows use the same hard
527,040-minute bound as ADR 0024's pure evaluator.

Reactivating the exact revision and definition preserves the existing
activation boundary, horizon, and version across process or owner replacement.
Changing either revision or definition starts a new boundary at the floored
current observation and increments the cursor version. The exact selected
application revision and current resident owner fence both operations.

### A due occurrence and its workflow run share one transaction

Before admission, the resident computes the exact workflow plan and may place
its content-addressed plan, start, and activity-request payload blobs. Those
blobs have no authority until referenced by committed ledger rows; response
loss may leave unreferenced blobs for later garbage collection.

The authoritative due transaction contains:

1. the exact local application run-creation fence;
2. the exact current resident owner fence;
3. one cursor `Put` carrying the prior full-record compare-and-swap
   conditions;
4. one immutable occurrence `Put` requiring absence; and
5. the ordinary workflow creation event, run, workflow cursor, transition
   receipt, run-directory row, initial activity/timer/signal projection, and
   ready-work row when applicable.

The cursor's compare-and-swap conditions remain on its `Put`; they are not a
separate condition check against the same physical item. Every transaction
target is therefore unique under the portable DB contract.

The occurrence record retains the exact app, revision, schedule, definition,
workflow, plan, run, logical occurrence, selected minute, evaluated window,
scanned-minute count, bounded skip evidence, cause, and creation time. The
workflow run retains the same cause through the ordinary trigger and event.
Neither side is an eventually consistent projection of the other.

The captured activity-headed scheduled start occupies 12 transaction items,
including two condition checks and ten puts, with referenced payloads keeping
the envelope far below the portable 100-item and DynamoDB byte ceilings. The
other supported workflow heads have the same finite bounded projection set.

### The local activation fence serializes source and managed operation

When a managed activation row exists, the run-creation condition requires its
exact `ACTIVE` record and selected revision. If activation reaches
`QUIESCING` first, the entire scheduled transaction fails: no occurrence, run,
or cursor advancement is committed.

When no managed activation row exists, trusted source execution uses the
existing absence fence. Creating the first managed activation races against
that same `NOT_EXISTS` condition. If source admission wins, its workflow is
already durable before activation appears. If managed activation creation
wins, the source schedule transaction changes nothing.

If scheduled admission commits first during an update race, normal quiescence
sees its nonterminal workflow run. Activation can proceed only according to
the existing durable-run policy. There is no interval in which the cursor says
work was selected but quiescence cannot see that work.

### Schedule transaction material is private and store-bound

The schedule-control module prepares one process-local opaque admission token.
Its transaction material is held in module-private weak metadata, deeply
frozen, and bound to:

- the exact expected app/revision/schedule/definition/workflow/plan/run/cause;
- the exact DB client object; and
- the exact normalized table name.

The execution ledger is the only mutation path that consumes this material.
It must present its own DB client and table when resolving or reconciling the
token. A token from another process, client wrapper, database, or table is
rejected before any transaction material is exposed or any ledger write is
attempted.

This token is not durable authority and is never serialized. After restart,
the resident prepares a fresh token from the retained cursor or occurrence.
An exact existing occurrence produces a write-free replay token; the ledger
then requires the matching workflow run.

### Ambiguous responses reconcile both atomic projections

After an ambiguous scheduled transaction error, the ledger strongly reads the
workflow run and occurrence:

- two exact matching sides replay with `applied: false`;
- two absent sides after a generic transport error preserve the original
  ambiguity;
- two absent sides after a definite conditional failure are reclassified
  through the current activation fence;
- a conflicting identity fails as a run conflict; and
- a persistent one-sided state fails as projection corruption.

The reads are ordered run then occurrence. If the first run read is absent but
the occurrence read is exact, the ledger rereads the run once. The exact
occurrence is a strong-read witness that the atomic commit already occurred,
so the later run read must observe its matching side. The symmetric missing
side may also be reread before declaring corruption.

No polling loop can prove that an unknown remote transaction will never
commit. Generic both-absent responses therefore remain retryable ambiguity
rather than a false non-application claim.

### Public schedule authoring remains gated

This decision implements the internal atomic admission kernel. It does not
open manifest schema V3, observe cron inside the resident, or claim source and
packaged restart parity. Strict manifest V2 continues to reject schedule
fields until exact revision binding, resident observation, wake-up and
shutdown behavior, and source/packaged recovery form one executable vertical.

This ADR supersedes only ADR 0024's durable pending-selection and
select-then-start mechanics. ADR 0024's schedule language, occurrence and
definition identities, catch-up and overlap policies, workflow-only target,
provenance, public-version gate, and no exactly-once external-effect claim
remain accepted.

## Consequences

- Activation cutover and scheduled admission have one deterministic winner.
- No pending old-revision request can cross owner or revision transfer.
- Cursor progress is durable only when the corresponding due workflow is
  already visible to quiescence.
- Exact occurrence identity still converges concurrent residents and
  response-loss retries on one ordinary workflow run.
- The specialized ledger integration stays narrow; arbitrary callers cannot
  append raw transaction extensions.
- Content-addressed payload preparation may leave harmless unreferenced data
  after failed admission.
- Resident cron observation and public manifest V3 remain the next vertical,
  not implied behavior of this kernel.

## Rejected alternatives

### Persist selection and start the workflow later

Rejected because it recreates the cutover hole that motivated this decision.

### Clear a pending occurrence when old-revision admission closes

Rejected because it converts a normal activation race into silent work loss.

### Carry a pending old-revision request into the new resident

Rejected because the new resident does not have authority to execute the old
revision's sealed workflow plan and input.

### Put the cursor CAS in a separate condition check

Rejected because the portable transaction contract forbids targeting the same
physical item both as a condition check and as a put.

### Accept a generic caller-supplied transaction extension

Rejected because it would let the workflow-start API mutate unrelated control
rows and bypass ledger invariants. Only the private identity- and store-bound
schedule token is accepted.

### Report both-absent ambiguity as not applied

Rejected because a transport failure can precede a later successful commit.
Absence at one observation does not prove a still-unknown transaction's final
outcome.
