# 0042 — Successor-authority partial-hydration repair

**Status:** Accepted; internal stale-receipt repair implemented · **Date:** 2026-09-02

## Context

[ADR 0041](0041-sealed-lmdb-application-state-snapshot-transport.md)
retains an immutable `washr1` receipt before it retires an empty partial LMDB
hydration target and its exact claim. The receipt deliberately binds the exact
coordinator authority and durable `CLOSED` barrier that authorized that recovery.
If either control scope changes while the receipt is incomplete, the old actor is
correctly fenced, but the new actor cannot reinterpret the old receipt as its own.
The global registry therefore remains blocked even after the original hydrator
and recovery process have stopped and been reaped.

Silently deleting the receipt, rewriting its authority, filling its missing
retirement paths, or ignoring it during a later hydration would destroy the
evidence that makes the existing fail-closed behavior safe. Binding a second
repair receipt permanently to one successor would only move the same liveness
failure: another takeover during repair would strand that receipt in turn.

This decision adds one bounded internal repair for that exact state. It does not
activate the public DynamoDB resident, authorize a node or revision, prove
machine-loss recovery, or make filesystem mutation atomic with the control
store.

## Decision

### Repair only one exact stale incomplete receipt

Repair begins with a read-only inspection and a separate explicitly confirmed
mutation. The caller must first stop and reap the original hydrator and every
actor that could still continue the stale recovery. The implementation cannot
infer process death from a timestamp or claim file.

Inspection is eligible only when all of the following remain exact:

- the supplied coordinator authority is current and owns the supplied durable
  `CLOSED` barrier;
- central publication contains the supplied snapshot transport and no physical
  replica activation exists;
- the application, store root, physical replica, transport, publication, and
  stale `washr1` receipt are identical;
- the old receipt is the registry's single logical blocker and is physically in
  `RECOVERY_RECORDED` or `TARGET_REMOVED`; and
- the current scope is causally newer: its `CLOSED` barrier version is strictly
  higher, and its authority epoch is either higher or belongs to the same exact
  authority.

A current-scope ordinary recovery, an absent or completed un-repaired receipt,
an `OPEN` barrier, a lower or divergent authority, a substituted path, malformed
registry evidence, or an activated transport is not repairable.

### Separate the stable repair from current authorization

The repair has two durable layers.

The `washrr1` repair receipt is authority-neutral after creation. It binds the
full stale `washr1`, exact central publication identity, starting physical
state, and stable device/inode/size identity of the old receipt file. Its
content-derived identity never changes when coordinator authority changes.
There is at most one repair receipt for an old recovery identity.

Before any canonical rename, the current successor appends a `washrra1`
authorization receipt. It binds the stable repair identity to that exact current
coordinator authority and exact durable `CLOSED` barrier. Authorizations are
immutable historical provenance, not leases and not authority after their scope
becomes stale. While the repair remains incomplete, a fresh successor appends
its own authorization for the same `washrr1` and continues the same operation.
Once the repair is physically `REPAIRED`, a later scope performs exact read-only
verification and does not add authorization evidence for a rename that can no
longer occur.

The read-only `washrri1` inspection binds the repair, the current authorization,
and the observed repair state. It therefore becomes invalid when authority,
barrier, registry, or filesystem evidence moves. Mutation requires that exact
inspection and literal `confirmStaleHydrationRecoveryRepair: true`.

This split avoids recursive repair-of-repair. A stranded stable receipt is
inert without a current authorization. A stale authorization remains useful
audit evidence but cannot authorize another rename. Later authority does not
rewrite or adopt either artifact; it proves current scope, appends a distinct
authorization, and resumes the stable operation.

Each authorization occupies one canonical three-digit slot from `000` through
`127`; its `washrra1` identity is validated from the file content rather than
encoded in the retained filename. Persistence hard-links a synchronized private
candidate into the first vacant fixed slot, validates an `EEXIST` winner, and
rechecks current control scope before trying another slot. Registry reads require
contiguous slots and reject aliases, gaps, duplicate identities, or duplicate
scopes. The fixed namespace makes the bound atomic even when a stale actor
crosses the admitted control-check/filesystem-link interval.

### Retain repair-specific physical evidence

Repair never fills the old recovery receipt's missing paths. It uses paths keyed
only by `repairId`, keeping names below filesystem component limits:

- one successor-repair receipt;
- one or more successor-repair authorization receipts;
- one successor-repair retired target when the old target was still active; and
- one successor-repair retired claim.

If the old state is `RECOVERY_RECORDED`, repair atomically renames the exact
active empty `lmdb` directory into the repair-retired target path. If the old
state is already `TARGET_REMOVED`, it verifies and retains the old receipt's
retired target without moving it again. Repair then atomically renames the exact
active claim into the repair-retired claim path. Every source/destination pair
allows only source-exact/destination-absent or source-absent/destination-exact
replay. Both present, both absent, nonempty, symbolic, foreign, or identity-
substituted paths fail closed.

The operation synchronizes and exactly rereads each durable artifact before its
phase callback. It reasserts current authority, the exact barrier, publication,
and absent activation immediately before every rename and before returning.
The callbacks are:

1. `hydration-recovery-successor-repair-recorded`;
2. `hydration-recovery-successor-repair-authorized`;
3. `hydration-recovery-successor-repair-target-retired`; and
4. `hydration-recovery-successor-repair-claim-retired`.

A takeover may race the non-atomic interval after a control check and before one
exact filesystem rename. The stale caller can perform at most that already-
authorized idempotent rename; its next control check and final return fail.
Fresh inspection under the new scope resumes from the retained physical state.

### Overlay logical completion without erasing raw history

The registry continues to report whether the original `washr1` is physically
complete. A verified completed successor repair overlays that raw incomplete
entry as logically resolved. New hydration remains blocked while either an
unrepaired old receipt or an incomplete successor repair exists, then may proceed
after exact repair completion.

This overlay is necessary because the original receipt remains physically
incomplete forever. Without it, a later legitimate partial hydration would look
like a second incomplete recovery and make the retained registry invalid.
Completed old receipts and repairs remain readable and exact beside later work.

The existing limit of 128 ordinary recovery receipts is unchanged. Repairs are
bounded to one per ordinary receipt, and authorization receipts are separately
bounded by their 128 fixed slots. Existing exact authorization replay remains
readable at capacity; a new authorization fails closed without creating a 129th
artifact. No receipt, authorization, or retired object is silently compacted or
collected.

## Crash and failure behavior

| Interruption or fault                                                                           | Required result                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before repair receipt durability                                                                | No canonical target or claim path moves.                                                                                                                   |
| After repair receipt but before authorization                                                   | The stable receipt is inert; the same or later current scope can authorize it.                                                                             |
| After authorization but before target retirement                                                | Exact replay reuses both receipts and the same repair identity.                                                                                            |
| After target retirement                                                                         | Replay verifies the retained target evidence and retires only the exact claim.                                                                             |
| After claim retirement or before acknowledgement                                                | Full exact replay returns the same repair without another rename.                                                                                          |
| Authority or barrier changes while repair remains incomplete                                    | The old call fails its next fence; a later successor appends authorization for the same repair and resumes.                                                |
| Authority or barrier changes after repair is physically complete                                | Current-scope inspection and exact durable verification acknowledge the same repair without another rename or authorization receipt.                       |
| Repair, authorization, registry, publication, target, claim, replica, or store identity differs | Repair fails closed without deleting, overwriting, activating, or reopening admission.                                                                     |
| Repair completes                                                                                | The old receipt stays raw-incomplete but is logically resolved; a later exact hydration claim may begin subject to the independent registry-capacity rule. |

## Consequences

This closes the known stale-receipt liveness boundary without weakening the
original authority fence or pretending the filesystem shares a transaction with
the coordinator store. The price is additional retained evidence and registry
logic that distinguishes physical completion from logical resolution.

Public automatic replacement remains **NO-GO**. Trusted-node enrollment,
per-revision authorization, finite capability placement, fenced node leases,
and bounded two-node machine-loss proof remain prerequisites.
