# Partial-hydration recovery and reconstructed-work crossing checkpoint

- **Date:** 2026-09-01
- **Status:** **INTERNAL RECOVERY AND COMPLETE WRAPPER PROOFS COMPLETE; PRODUCT GATES CLOSED**
- **Source base:** `0072542`
- **Decision:** [ADR 0041](../../docs/architecture/decisions/0041-sealed-lmdb-application-state-snapshot-transport.md)

## Restart summary

The previously retained pre-evidence hydration state now has one narrow,
explicit recovery seam. Ordinary snapshot transport still fails closed when a
process dies after creating the exact hydration claim and empty `lmdb` target
but before linking data or snapshot evidence. A separate read-only inspection
can identify only that exact partial state, and a separate mutation requires
the returned integrity-bound inspection plus literal confirmation.

Recovery durably records one immutable attempt-scoped receipt before changing
either canonical path. Its filename includes both `snapshotId` and
`recoveryId`, and the receipt binds the complete transport, claim, physical
replica, replacement authority, exact `CLOSED` barrier, and filesystem
identities for the store root, claim file, and empty target. The mutation then
atomically renames the still-identical empty target and claim into distinct
receipt-scoped retirement paths, verifies and synchronizes each durable
boundary, and retains all three objects as exact replay evidence. It never
deletes them.

The week also closes the complete internal reconstructed-resident work
crossing. The proof composes the real provisioned replacement receipt,
replicated payload input, authority takeover, inherited barrier adoption,
two-pass execution reconstruction, LMDB application-state transport,
application-state readiness, barrier reopen, and resident worker dispatch. A
retained `CLAIMED` attempt executes exactly once only in the fresh generation;
a retained `STARTED` attempt remains outcome-unknown and never silently
re-enters authored code.

No public DynamoDB resident gate, provider release, deployment, publication, or
promotion changed.

## Exact recovery contract

`inspectApplicationStateSnapshotHydrationRecovery` is read-only. It succeeds
only with all of the following exact evidence:

- the supplied coordinator authority is current;
- the supplied replacement barrier is the exact durable `CLOSED` barrier and
  belongs to that authority;
- central control state retains the exact supplied publication and no physical
  replica activation;
- the configured store and its `wasr1` replica identity are valid;
- the canonical retained claim names the exact snapshot;
- the target is one stable, empty, non-symbolic-link directory; and
- the bounded recovery registry is canonical and internally consistent, with at
  most one incomplete receipt whose exact active attempt is selected.

The immutable `washri1` inspection contains one proposed `washr1` recovery
record. Filesystem integers are captured with BigInt `lstat` and retained as
canonical decimal strings: device and inode for the store root and target,
plus device, inode, and size for the claim. Same-content substitutions do not
inherit the inspection's authority. Recovery uses these exact retained paths:

- `.wharfie-application-state-snapshot-hydration-recovery-receipt-<snapshotId>-<recoveryId>`;
- `.wharfie-application-state-snapshot-hydration-recovery-retired-target-<snapshotId>-<recoveryId>`;
  and
- `.wharfie-application-state-snapshot-hydration-recovery-retired-claim-<snapshotId>-<recoveryId>`.

The exact registry is bounded at 128 receipts. Malformed names or bodies,
orphan retired objects, multiple incomplete attempts, and attempts to exceed
the bound fail closed, with no silent garbage collection. At 128 complete
receipts, a completed receipt whose bound authority and barrier remain current
stays available for read-only inspection and replay, but no new
recovery-capable hydration attempt may begin. Superseded receipts still consume
capacity. Ordinary hydration validates the registry immediately before and
immediately after exclusive claim creation.

`recoverApplicationStateSnapshotHydration` accepts only that exact inspection
and `confirmPartialHydrationRecovery: true`. Each retirement accepts only
source exact plus destination absent, or source absent plus destination exact
for replay. Both paths present, neither present, or any mismatch fails closed;
preexisting retirement artifacts are never overwritten. After each atomic
rename, recovery synchronizes the store root and re-verifies the exact retired
object before emitting the existing durability callback. It never recursively
removes or deletes the canonical target, claim, receipt, or either retired
object and does not turn general target corruption into automatic cleanup.

The caller must stop and reap the original hydrator before inspection and
recovery. A live owner may already have crossed its second registry check and
can still link data or evidence on the canonical paths; the recovery registry
does not atomically elect between that live owner and the recovery operation.
Invoking recovery against such a live hydrator is unsupported.

## Durable replay matrix

| Durable observation                 | Retained state                                                                                     | Exact replay                                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hydration-recovery-recorded`       | The immutable receipt, original empty target, and original claim remain.                           | Replay the receipt, retire and verify the exact target, then retire and verify the exact claim.                                                               |
| `hydration-recovery-target-removed` | The receipt and exact retired target remain; the original claim remains at its canonical path.     | Verify the retired target, retain the receipt, and retire and verify only the receipt-bound claim.                                                            |
| `hydration-recovery-claim-released` | The receipt and both exact receipt-scoped retired objects remain; both canonical paths are absent. | Treat both retired objects as completion proof and return the same receipt after asserting that its receipt-bound authority and exact barrier remain current. |

Fresh inspection reports exactly one of `PARTIAL_TARGET`,
`RECOVERY_RECORDED`, `TARGET_REMOVED`, or `RECOVERED`; `TARGET_REMOVED` and the
existing callback names remain compatibility vocabulary for atomic retirement,
not deletion. Fresh inspection prefers an active or incomplete attempt and
otherwise deterministically selects a completed receipt. A retained earlier
inspection can drive an exact retry after any durable phase. Requested replay
of an older completed receipt is strictly read-only and direct, even if a newer
attempt is active, while still asserting that its receipt-bound authority and
exact barrier remain current. Once claim retirement is durable, a waiting
authorized hydrator may proceed.

## Failure and substitution behavior

Deterministic tests preserve every retained byte when inspection or recovery
encounters:

- stale authority or a changed durable barrier;
- missing, foreign, corrupt, or substituted claims;
- a substituted store root or empty target;
- a nonempty or evidence-bearing target;
- a corrupt or scope-mismatched receipt, orphan retirement object, competing
  incomplete attempt, or exhausted registry;
- a tampered inspection document; or
- any existing physical-replica activation.

Identity substitution is tested both before the first write and after durable
recovery phases. A substitution in the final source-rename window is moved into
the private retirement path, not deleted; post-rename identity verification
then rejects it, leaves the receipt incomplete, and gates new hydration claims.
The implementation reasserts authority and the barrier after final claim
retirement. These control checks authorize no deletion or activation and the
final check detects stale scope; they do not claim atomic fencing against a
filesystem rename. Adversarial creation of the retirement destination in the
last interval after its absence check, and uncooperative out-of-band filesystem
renames, are explicitly outside the supported threat model.

## Real-process proof

A pinned-Node child begins from the real retained partial hydration produced by
killing the existing transport child at `hydration-target-created`. The parent
then starts a separate recovery child, waits for one exact durable recovery
callback, sends `SIGKILL`, reaps the child, and independently reopens the
control and application-state stores.

The process matrix kills after all three recovery boundaries and proves the
same receipt and exact completion from both retired objects on replay. It also
proves stale authority refusal before each mutating phase, zero-write refusal
for nonempty, evidence-bearing, and post-inspection substituted targets,
retention of the exact `CLOSED` barrier and source state, successful activation
of the intended replica after recovery, and rejection of an alternate physical
replica. Deterministic rename-interception tests separately prove last-window
substitution quarantine. A completed attempt A remains unchanged and replayable
when a later hydration attempt B crashes and is recovered independently.

The three recovery-phase cases use 30-second cleanup-owned Jest budgets because
each now reaps three independent crash children before final activation.

This is process-loss evidence on one host. It is not power-loss, volume-loss,
machine-loss, or two-node evidence.

An authority or barrier change while a receipt is incomplete is deliberately
not auto-recovered. The old scope is stale, the new scope cannot mutate the
receipt-bound attempt, and the global registry blocks new claims. Compaction or
takeover requires a future explicit repair workflow.

## Reconstructed-wrapper crossing

The complete internal composition proves this order:

1. consume the provisioned v2 replacement receipt and hydrate its replicated
   payload from an empty local replacement cache;
2. validate topology, take replacement authority, and adopt the inherited
   exact `CLOSED` barrier;
3. reconstruct the durable execution ledger in two passes and inventory exact
   application-state history;
4. transport the LMDB snapshot and establish exact application-state
   readiness while the barrier remains closed;
5. reopen the barrier only after reconstruction and readiness; and
6. start the resident worker and dispatch only eligible fresh-generation work.

For a retained generation-one `CLAIMED` attempt, reconstruction abandons the
old attempt, a generation-two claim and complete start frame are created, the
activity port executes once, and exactly one terminal outcome is retained.
Stale predecessor start and terminal writes are rejected after takeover. For a
retained generation-one `STARTED` attempt, reconstruction records
started-outcome-unknown, the recovery path runs without the activity port, and
authored work is never silently repeated.

Independent review tightened this proof with an 18-second cleanup-owned
authority and worker abort, explicit 25-second Jest budgets, an assertion over
the complete generation-two start frame, and contract-shaped command-server,
schedule-observer, and activity mocks. A focused `--detectOpenHandles` run
passed.

## Validation

Observed on Node `24.13.1` and npm `11.12.0`:

- current retained-registry tree: the deterministic LMDB suite passed 65 tests
  and the real-SIGKILL recovery suite passed 9 tests, for 2 suites and 74 tests
  in 18.857 seconds with no failures or skips;
- current retained-registry tree: source and test typechecks, targeted ESLint,
  Prettier, and diff hygiene passed;
- current retained-registry tree: `npm run test:replacement-input` passed 16
  suites and 341 tests in 33.106 seconds;
- current retained-registry tree: `npm run test:ci` passed 357 suites and 8,126
  tests, with 1 suite and 5 tests deliberately skipped;
- that current broad run passed every configured global coverage threshold and
  all source, app, test, and SEA-verifier typechecks;
- that current broad run's package verification checked all 382 files, the
  provider boundary remained within its 170-package and 89,128,960-byte budgets
  with zero provider SDK graph inputs, and the production dependency audit
  found zero vulnerabilities.

Native LMDB tests on this macOS host abort inside the filesystem sandbox; the
identical pinned-runtime commands pass outside it. No dependency or release
configuration was changed to obtain the result.

## Honest boundary and next handoff

- Recovery applies only to one explicitly inspected, pre-evidence empty target.
  It does not repair arbitrary corruption or recover lost snapshot bytes.
- The immutable receipt is exact to one inspected attempt. Replaying any
  completed receipt is read-only, but still requires its receipt-bound
  authority and exact closed barrier to remain current; the receipt itself is
  not authorization for a new authority.
- The bounded registry retains receipts and retired objects permanently within
  this slice. It performs no silent garbage collection and fails closed to new
  attempts at 128 receipts.
- The application-state store and execution ledger remain separate transaction
  domains and depend on deliberate quiescence plus exact settled history.
- The complete wrapper proof is internal composition evidence, not a public
  production call site or activation decision.
- Trusted-node placement, revision authorization, machine-loss/two-node proof,
  public DynamoDB resident activation, releases, and deployments remain open
  or explicitly deferred.

The next product slice should finish the remaining authored-work process-death
boundaries at the future production/provider seam, then decide the explicit
public activation gate. A bounded two-node machine-loss proof belongs only
after trusted-node and placement prerequisites exist.
