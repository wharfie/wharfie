# 0039 — Retained coordinator quiescence barrier

**Status:** Accepted; internal barrier slice implemented · **Date:** 2026-08-30

## Context

[ADR 0038](0038-authority-bound-replacement-reconstruction.md) requires a
replacement coordinator to validate the complete execution history twice before
it admits work. An authority epoch fences stale commits, but does not prevent a
current coordinator path from creating a new run or changing a schedule while
those passes are in progress. A changed-history fingerprint detects that race
only after the new mutation exists; it is not a durable cutover boundary.

The replacement therefore needs one retained application-scoped generation
that every fresh admission and schedule mutation compares in the same
execution-ledger transaction. Exact committed replays must remain available
while the generation is closed: replay reads already accepted truth and must
not create a new decision.

## Decision

### Retain one monotonic barrier in the ledger table

Each application has one permanent barrier row in the same execution-ledger
table as coordinator authority, run admission, and schedule state. The row is
strictly validated and records `OPEN` or `CLOSED`, a monotonically increasing
version, the authority that advanced it, and the last transition identity.
Transitions never delete or reset the row.

Absence is the compatibility `OPEN` state. A fresh writer that strongly
observes absence carries an exact `NOT_EXISTS` condition, so a concurrent first
close wins atomically. A writer that observes `OPEN` carries the exact retained
record, including its version and authority. Closing and reopening advances the
version; a delayed pre-close fence therefore cannot become valid again after a
later reopen.

The close transaction, not authority takeover, is the cutover linearization
point. An `OPEN` row may still name a predecessor authority; its authority field
governs barrier transition ownership, not admission ownership. A fresh mutation
that commits before the successor closes is valid and will appear in the later
reconstruction. A mutation carrying that old generation after close loses, and
the monotonic version keeps it stale after reopen.

Fresh manual and workflow creation, managed-effect successor authorization,
schedule activation, cursor-only advancement, and scheduled occurrence/run
admission all carry this condition beside their existing owner, activation,
and coordinator-authority fences. Existing immutable run or occurrence
winners are resolved before the barrier read and remain available as exact
read-only replays while the barrier is `CLOSED`.

### Carry the prepared scheduled generation through commit

Scheduled workflow admission spans preparation in schedule control and a later
combined schedule/ledger transaction. A create-mode prepared admission token
therefore retains the exact barrier condition observed during preparation, and
the ledger consumes that condition without replacing it with a fresh read.
Closing and reopening between those phases makes the original token lose its
atomic comparison, preventing a generation ABA. Replay-mode prepared tokens do
not carry a fresh-admission fence.

### Fence every state transition with current authority

`close`, `adopt`, and `reopen` compare the exact predecessor and the current
coordinator authority in the same transaction. A close accepts absent or
`OPEN`; adoption requires a `CLOSED` predecessor and a strictly newer authority
epoch; reopening requires the exact `CLOSED` predecessor and the exact
authority that owns it.

Every transition also writes a permanent request receipt in that transaction.
Repeating the same stable request returns the frozen accepted successor even if
the current barrier has since advanced. Reusing a request identity for different
intent fails closed. After an ambiguous write result, a strong receipt readback
may prove that exact result; otherwise the outcome remains unknown or the
current authority/conflict error is preserved.

### Close before reconstruction and reopen only on successful handoff

The internal reconstructed-resident wrapper strongly reads the predecessor,
then closes an `OPEN` generation or adopts a predecessor's `CLOSED` generation
under the replacement authority. A repeated startup under the exact authority
reuses its already-closed generation. Only then may the wrapper run the two-pass
history reconstruction and the separate application-state preparation.

After both phases, the wrapper strongly reasserts coordinator authority,
reopens the exact closed predecessor, and strongly reasserts authority again
before entering the resident handler. Reopen is not cleanup: reconstruction,
application-state, or pre-reopen authority failure leaves the barrier closed
for explicit recovery. If authority changes after reopen commits, the final
strong assertion still blocks the stale handler; reopening is a retained
transition and is not rolled back.

The internal order is therefore:

```text
topology proof → authority supervisor → close/adopt barrier →
two-pass reconstruction → application-state preparation →
strong authority check → exact reopen → strong authority check → dispatcher
```

## Consequences

- Replacement reconstruction now has a durable same-table admission and
  schedule-mutation cutover instead of relying only on fingerprint drift.
- A close racing an absent-state or `OPEN` writer has one transactional winner;
  closing and reopening cannot revive an older prepared mutation.
- Exact already-committed admissions remain inspectable and replayable while
  new decisions are stopped.
- Permanent request receipts make transition retries deterministic, at the cost
  of retained receipt growth.
- Remaining closed after a failure intentionally reduces availability until a
  current authority explicitly adopts or completes that generation.
- This is an internal composition seam with no production call site. Current
  public resident, submission, workflow, recovery, schedule, and
  application-state DynamoDB gates remain closed.
- The barrier does not distribute the provisioned `tableResourceId` or payload
  bytes, implement the separate application-state handoff, authorize revisions
  on another node, provide node placement/leases, or complete the required
  process-boundary and two-node recovery proof.

## Rejected alternatives

### Use the coordinator epoch alone

Rejected because a current authority can legitimately admit work during
reconstruction. Epoch fencing prevents stale-authority commits, not current-
authority mutations inside a startup cutover.

### Re-read `OPEN` when a prepared schedule token is consumed

Rejected because a close/reopen cycle could make a delayed pre-close mutation
appear current. The prepared token must carry its original generation through
the combined transaction.

### Delete the barrier when reopening

Rejected because absence is the compatibility generation. Deletion would erase
monotonic history and could make an old `NOT_EXISTS` fence valid again.

### Reopen from a `finally` block

Rejected because a failed reconstruction or application-state handoff has not
earned dispatcher admission. Failure must leave fresh work closed.
