# 0007 — Atomic, fenced operation snapshots

**Status:** Superseded by [0011](0011-persisted-state-machine-execution-ledger.md) · **Date:** 2026-07-16 · **Implementation retired:** 2026-07-17

This record preserves the reasoning for an interim snapshot store. The
`Operation`/`Action` implementation was deleted after the append-only V3 ledger
became the only supported durable activity path. No snapshot data is migrated;
there are no downstream compatibility requirements.

## Context

Wharfie had two persisted activity-run paths and a graph store whose generic
upserts wrote an operation and its actions independently. A crash or competing
writer could expose a partial graph, replacement could leave stale actions,
delimiter-based record keys allowed distinct operation/action identities to
collide, and cancellation deleted history. Those behaviors cannot be a
foundation for durable work.

The final execution model will need a run → invocation → attempt → effect
ledger, leases, recovery, and explicit handling for uncertain external effects.
That model is not designed yet. The current named-activity path still needs an
honest atomic boundary that can be built on without pretending to provide the
later guarantees.

## Decision

Manual and queue-triggered named activities use one persisted-run constructor
and the shared graph runner. The removed alternative path will not be kept for
compatibility.

An operation snapshot consists of one operation metadata record and its current
action records. The store exposes intent-specific transitions rather than
generic record upserts or hard deletion:

- `createOperation` conditionally creates the complete snapshot and never
  overwrites an existing operation;
- `replaceOperation` compares the current version, writes the new complete
  snapshot, and removes stale actions in the same transaction;
- `retryOperation` is the explicit transition from failed or blocked work to a
  new pending graph generation; and
- `cancelOperation` retains the operation and actions, records cancellation
  metadata, and marks nonterminal actions cancelled.

The shared database contract provides one conditional transaction primitive.
All conditions observe the transaction's pre-state, and one logical item cannot
be targeted more than once in a transaction. LMDB implements the local durable
transaction, and DynamoDB uses `TransactWriteItems`. The vanilla adapter remains
available for isolated tests and explicit diagnostics, but is not a
crash-durable control store. Zero-configuration non-test operation state uses a
dedicated local LMDB store rather than inheriting an application's database
configuration.

Operation IDs and action IDs are opaque, nonempty, well-formed Unicode strings
of at most 256 UTF-8 bytes. Storage keys use base64url-encoded, typed path
segments, so no valid operation ID can alias metadata or an action belonging to
another operation.

Each operation metadata transition compares and increments an optimistic
`version`. Each graph replacement increments a `generation`; action claims and
result commits require that generation and a running owning operation. Every
action mutation also compares and increments a monotonic per-action `version`,
so an action that cycles through the same status within one generation cannot
satisfy a stale replacement or cancellation preimage. A stale worker can finish
physically, but its action result cannot become the current Wharfie result after
retry, replacement, or cancellation.

An exact graph load reads metadata, queries the operation namespace, then reads
metadata again. The metadata version/generation must remain stable, and the
serialized DAG's action IDs, types, edges, and acyclicity must exactly match the
current-generation action records. Incomplete or mixed reads retry and then
fail closed. A replacement also conditions each affected action on its observed
generation, status, and action version. Cancellation carries the action
preimage from its first validated read into replacement, so a result committed
on either side of the replacement read is preserved on the next cancellation
attempt.

The persisted named-activity wrapper treats a stable operation ID as an
idempotency identity. Reusing it is accepted only when the persisted app,
activity, trigger, input, and action definition match the requested work. A
matching completed operation deduplicates without execution. A matching failed
or blocked operation enters the explicit retry transition. A conflicting
definition, cancelled operation, or already-running operation fails visibly.
Queue operation IDs are a domain-separated SHA-256 digest of the unambiguous
queue URL and provider message-ID pair; receipt handles remain attempt context.

One transaction can contain at most 100 DynamoDB items. Until the ledger model
replaces graph snapshots, Wharfie limits an operation to 49 actions so the
worst-case replacement can delete 49 stale actions and write 49 new actions
plus metadata atomically.

## Consequences

- Writers commit either the old graph or the full replacement; create races
  have one winner. Reads are not transactional snapshots across records, so
  fenced commits must prevent a concurrent or mixed read from authorizing a
  stale write.
- Replacement, retry, and cancellation fence stale logical action commits.
  Cancellation preserves the current operation/action records instead of hard
  deleting them, but this snapshot store is not an append-only transition
  history and does not retain prior generations.
- Cancellation is authoritative only for later Wharfie control-state commits;
  it is not process interruption. It does not terminate arbitrary JavaScript,
  undo an external side effect, or establish whether an interrupted unsafe
  effect happened.
- The current retry transition is control-state mechanics, not evidence that
  arbitrary in-process JavaScript is safe to replay.
- This decision does not claim exactly-once physical execution, automatic
  recovery of stuck running work, durable attempt leases, heartbeats,
  coordinator epochs, or effect reconciliation. Those belong to the ledger
  and recovery work required by [0004](0004-logical-outcomes-and-effects.md).
- DynamoDB's per-item and per-transaction byte limits still apply. Large inputs
  and outputs have not yet been externalized into the future ledger/artifact
  model, so an oversized snapshot fails visibly rather than degrading
  atomically.
- Schedules and workflows remain outside the public model until they can enter
  the same ledger with stable identities and recovery semantics.
