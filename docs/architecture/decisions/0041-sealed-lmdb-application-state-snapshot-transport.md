# 0041 — Sealed LMDB application-state snapshot transport

**Status:** Accepted; internal cold-checkpoint slice implemented · **Date:** 2026-08-31

## Context

[ADR 0040](0040-provisioned-replacement-input-and-payload-distribution.md)
made execution payloads available to an empty replacement volume and pinned the
exact application-state destination that replacement must adopt. It deliberately
did not move that destination's bytes. A replacement on another physical volume
could therefore reconstruct control history but could not resume an application
whose retained LMDB state existed only on the predecessor.

Application state and execution history remain separate transaction domains.
Wharfie cannot atomically commit an execution-ledger cut and an LMDB checkpoint,
and copying files from a live LMDB environment would not create such a cut. The
replacement path must expose that boundary, require a deliberately quiesced and
settled checkpoint, and fail closed on every mismatch.

This decision covers one bounded internal mechanism: a cold, immutable snapshot
of the physical LMDB store backing one exact application-state destination. It
does not define arbitrary crash-time recovery, continuous replication, node
placement, or a public automatic-replacement product.

## Decision

### Restrict the artifact to one bounded LMDB checkpoint

The snapshot format is `lmdb-data-mdb-v1`. Publication distributes only one
nonempty regular `data.mdb` file from the durably sealed source. It never copies
`lock.mdb`, a live environment directory, a symbolic link, or an unbounded tree.
The complete artifact is content-addressed by SHA-256 and limited to 512 MiB.
The current implementation reads those bounded bytes into memory; chunked or
streaming checkpoints are outside this slice.

The destination must be the exact receipt-pinned LMDB provider, store ID, table,
and application namespace. Because `data.mdb` is the complete physical store,
the seal fences every namespace that shares it and the artifact carries their
bytes too; it is not a namespace-only file export. Deployments should dedicate
one application-state LMDB root to one application. Control and
application-state storage must remain isolated. Another provider or a merely
schema-compatible store cannot claim this format.

### Establish and retain the source seal before reading bytes

Publication requires all of the following before snapshot bytes may be read:

1. the complete current coordinator-authority token is still current in the
   control transaction domain;
2. the retained admission barrier is durably reread as `CLOSED`, belongs to the
   same application, and is owned by that exact authority;
3. a complete application-state history inventory is settled; and
4. the exact application-state store identity is present and its destination
   authority is adopted by the same coordinator authority.

The history checkpoint hashes the canonical, complete projections of every
built-in application-state effect and every application-state effect-successor
authorization. `PENDING`, `STARTED`, and `UNCERTAIN` application-state effects
make the checkpoint unsettled and reject publication. Unrelated effects do not
enter this digest, while a partial or noncanonical application-state claim fails
validation.

Under the adopted destination-authority fence, the publisher writes one
create-if-absent marker into the source. That marker binds the transfer ID,
application and physical store, exact history digest, closed-barrier version and
authority, and source destination-authority digest. An existing marker is
accepted only when every canonical field matches.

The publisher then durably changes the source to `SEALED` for the exact source-
seal document before it opens `data.mdb`. The retirement key is derived from the
physical store ID, not the application namespace. Every ordinary
application-state mutation transaction in every namespace sharing that store
rejects the seal, including a stale writer that still holds a previously adopted
token. The seal binds the originating namespace, distribution, destination,
transfer, history, closed barrier, and source destination authority; it
intentionally cannot contain a digest of bytes that have not yet been read. The
physical source remains sealed after publication unless and until it is itself
the centrally selected retained replica. That exact activation removes the seal
in the same local transaction that adopts replacement authority and retains
local activation evidence. If another physical replica is selected, the source
remains sealed. A different namespace or transfer cannot replace or reinterpret
the physical seal.

After reading the sealed file, the publisher inventories complete
application-state history again and durably rereads the exact barrier and current
authority. Any movement or mismatch rejects the checkpoint. This exposes the
non-atomic boundary: the barrier stops fresh admissions, settled exact history
excludes in-flight application-state effects, the physical seal blocks later
source mutation, and the repeated observations prove that the bytes came from
that cut. It is not a claim that the two stores share a transaction or that an
arbitrary externally initiated LMDB write can be reconstructed from control
history.

### Publish, read back, and retain final evidence centrally

The provider-neutral snapshot distribution exposes immutable publication and
byte read. Its certified runtime capability must exactly match the distribution
identity and destination store ID in the transport. Public identity-shaped data
alone cannot claim that capability.

The snapshot reference binds the format, destination, transfer, full checkpoint,
byte size, and digest into one content identity. The publication call's return
is not trusted as evidence and need not echo the reference. Publication is
successful only after that call completes and an immediate independent readback
verifies the complete reference. If a provider stores the bytes but loses the
response, the operation succeeds only when the retained object reads back
exactly. A missing, substituted, oversized, truncated, or corrupt object fails
closed.

After verified readback, the publisher writes final publication evidence into
the central control transaction domain, fenced by the same exact current
authority and durable closed barrier. That immutable evidence binds the source
seal to the complete snapshot transport. A retry can return only the exact
already-published transport after verifying the provider object again; an
incomplete source seal is not a published checkpoint, and a different final
transport loses.

### Allow only one physical replica activation

Every retained or hydrated target has a durable physical replica ID outside the
LMDB image. Before application-state authority adoption, replacement makes one
central, one-shot activation claim for the exact application, snapshot, transfer,
domain-separated `wasr1` replica ID, `RETAINED` or `HYDRATED` transport status,
complete replacement authority, and exact current `CLOSED` replacement barrier.
Creation and exact replay are allowed; a second physical replica or substituted
activation cannot win for that snapshot. The control-store transaction fences
both the current coordinator authority and that exact barrier, so a reopen or
barrier change racing the claim loses and copying immutable bytes does not grant
authority to activate them.

The selected replica also retains local activation evidence bound to the same
snapshot, distribution, transfer, replica ID, status, and authority. A retained
source must still match the exact source seal. Destination-authority adoption and
local activation evidence are committed together, preventing a gap in which the
sealed predecessor can resume writes. The central claim is never inferred from a
local file or provider response.

This is a one-shot physical activation claim, not general node enrollment or
placement. Trusted provisioning still decides which node receives the receipt,
and revision authorization remains separate.

### Pin every handoff fact in receipt version 2

The resident replacement-input receipt advances to schema version 2 and the
`wrri2` identity domain. In addition to ADR 0040's control and payload scope, it
contains the complete application-state snapshot transport. The transport pins
the distribution identity and snapshot reference, and the snapshot destination
must be canonically identical to the receipt's application-state destination.

Replacement verifies five linked facts before admitting work:

- the receipt pins the exact transport, destination, transfer, checkpoint,
  distribution, and bytes;
- the snapshot marker inside the LMDB image pins the exact source cut;
- the retained source seal proves mutation stopped before bytes were read;
- central publication and one-shot activation records pin the exact published
  transport and selected physical replica; and
- transport readiness pins `RETAINED` or `HYDRATED`, the exact destination and
  transport, the complete current replacement authority, and its derived
  destination-authority digest.

Field substitution at any layer fails. These content identities detect
substitution but are not signatures, node enrollment, or transport credentials.

### Hydrate only true absence and commit through durable evidence

The target is hydratable only when its exact `<storePath>/lmdb` root does not
exist. An existing empty directory, missing or empty `data.mdb`, non-regular
file, symbolic link, wrong store identity, wrong marker, or other malformed
state is corruption, not a cache miss. Corruption never falls back to the
distribution and is never silently repaired.

For a truly absent target, replacement reads and verifies the receipt-pinned
bytes, writes and synchronizes private staged `data.mdb` and snapshot-scoped
hydration-evidence files, then durably claims the store root for that exact
snapshot. The claim is create-if-absent through a hard link and synchronized in
the parent directory. An exact contender waits for the same claim; a claim for
another snapshot fails closed. If the evidence link is already visible, an exact
contender completes the target and parent directory synchronizations before it
releases that verified claim and proceeds.

The claim owner creates `lmdb` with exclusive `mkdir`, so an empty, malformed,
or concurrently installed target is never replaced. It hard-links the staged
`data.mdb` into that owned directory and synchronizes it, then hard-links and
synchronizes the snapshot-scoped evidence. The evidence link is the logical
hydration commit: transport readers do not accept the data link alone while the
root claim is retained. After synchronizing the committed directory and parent,
the owner releases the claim. A caught pre-commit failure best-effort removes
only its claimed incomplete root; a stale pre-commit claim or incomplete root
after process loss fails closed for explicit recovery rather than being
reinterpreted as a cache miss. A retry after the evidence commit revalidates the
exact snapshot and retains its `HYDRATED` status even if acknowledgement or
claim release was lost. Evidence for an older snapshot cannot classify a later
snapshot as hydrated.

### Recover only an explicitly inspected pre-evidence partial target

A process kill can retain the durable hydration claim and its exclusively
created empty `lmdb` directory before either snapshot-scoped evidence or
`data.mdb` is linked. Ordinary transport continues to treat that state as
corruption. It never silently deletes or reinterprets the directory as true
absence. The implementation instead exposes one narrow internal recovery
operation with a separate read-only inspection and an explicit confirmed
mutation: `inspectApplicationStateSnapshotHydrationRecovery` and
`recoverApplicationStateSnapshotHydration`.

The caller must first establish that the hydrator which owned the retained
claim has stopped and been reaped. Recovery against a live hydrator is outside
the contract: that owner can have crossed its second registry gate and can
still link data or evidence while recovery is classifying or retiring the
empty target. The registry fences subsequent cooperative hydration attempts;
it is not an atomic election against an already-running owner on different
filesystem paths.

Inspection succeeds only when all of the following are simultaneously true:

- the supplied replacement authority is still the exact current authority and
  the supplied replacement barrier is still the exact durably retained
  `CLOSED` barrier;
- central publication retains the exact supplied snapshot transport and no
  physical-replica activation exists for its transfer;
- the configured store root and physical `wasr1` replica identity are valid;
- the retained hydration claim is canonical and names that exact snapshot;
  and
- `lmdb` is one stable, empty, non-symbolic-link directory. Any `data.mdb`,
  snapshot-scoped hydration evidence, or other directory entry makes the state
  ineligible.

The returned immutable inspection document contains a content-derived
`washri1` identity and the proposed `washr1` recovery record. Its `recoveryId`
is derived from the complete current claim, filesystem identities, and control
scope. The record binds the complete transport, exact claim and replica ID,
replacement authority and barrier, and filesystem identities observed with
BigInt `lstat`: device and inode for the store root and target directory, plus
device, inode, and size for the claim file. Canonical decimal strings preserve
those full integers in JSON without numeric truncation. Even a same-byte or
same-shape replacement therefore does not inherit authority from the inspected
object.

Recovery artifacts are attempt-scoped and retained under exact names:

- `.wharfie-application-state-snapshot-hydration-recovery-receipt-<snapshotId>-<recoveryId>`;
- `.wharfie-application-state-snapshot-hydration-recovery-retired-target-<snapshotId>-<recoveryId>`;
  and
- `.wharfie-application-state-snapshot-hydration-recovery-retired-claim-<snapshotId>-<recoveryId>`.

The store-root registry admits at most 128 exact receipts. Every receipt and
retirement filename and every receipt body must be canonical and mutually
consistent. Orphan retirement objects, malformed or scope-mismatched records,
more than one incomplete attempt, and an attempt to exceed the bound all fail
closed. Exactly 128 complete receipts exhaust capacity for a new attempt but do
not prevent read-only inspection or replay of an existing completed receipt
whose bound authority and barrier remain current. Superseded receipts still
consume capacity. There is no silent garbage collection. Ordinary true-absence
hydration validates this registry immediately before and immediately after
exclusive claim creation, so an incomplete, corrupt, or exhausted recovery
registry cannot be crossed by a new hydration.

Mutation requires that exact inspection document and literal
`confirmPartialHydrationRecovery: true`. Before its first write it freshly
reasserts the complete inspection scope. It then proceeds in three durable
phases:

1. create or exactly replay the immutable attempt-scoped receipt and
   synchronize the store root;
2. atomically rename the exact still-empty target to its receipt-scoped retired
   target path, synchronize the store root, and verify the retired directory is
   still exact; and
3. atomically rename the exact claim to its receipt-scoped retired claim path,
   synchronize the store root, and verify the retired claim is still exact.

Each retirement follows one exact state machine: source exact plus destination
absent permits the rename; source absent plus destination exact is an
idempotent replay; both paths present, neither path present, or any identity or
content mismatch fails closed. A preexisting retirement artifact is never
overwritten. The implementation never unlinks or removes the target, claim, or
retired objects.

The callbacks `hydration-recovery-recorded`,
`hydration-recovery-target-removed`, and
`hydration-recovery-claim-released` retain their established names, but the
latter two now mean verified retirement, not deletion. They occur only after
the rename, store-root synchronization, and exact destination verification for
their corresponding durability boundary. Current authority and the exact
barrier are asserted once more before a successful return. That final assertion
does not authorize deletion or activation; it only detects stale control scope.
After claim retirement, an independently authorized waiting hydrator may
legitimately begin normal hydration.

The immutable recovery record remains as the stable receipt. Its four observable
states remain `PARTIAL_TARGET`, `RECOVERY_RECORDED`, `TARGET_REMOVED`, and
`RECOVERED`; `TARGET_REMOVED` is the compatibility name for the target-retired
phase. Completion means that both receipt-scoped retired objects exist and
exactly match the receipt. Exact retries resume from any retained phase and
return the same `washr1` receipt. A fresh inspection prefers a current active or
incomplete attempt; when none exists, it deterministically returns one completed
receipt. Replay of a specifically supplied older completed receipt is strictly
read-only and direct, even when a newer attempt is active, but still asserts the
receipt-bound authority and exact barrier remain current before returning it.
Stale authority or barrier, foreign publication or claim, activation, corrupt records,
evidence-bearing or nonempty targets, and filesystem-identity substitution fail
closed. Recovery never recursively removes or deletes the canonical target,
claim, receipt, or either retired object.

The supported concurrency model assumes cooperative writers honor this exact
registry and naming protocol. Adversarial creation of a retirement destination
in the final interval between its absence check and `rename`, and uncooperative
out-of-band filesystem renames, are explicitly outside the threat model. Within
the supported model, a source substituted immediately before `rename` is moved
into the private retirement path rather than deleted, and the mandatory
post-rename identity check leaves the receipt incomplete and blocks new claims.

An authority or barrier change while a receipt is incomplete is an intentional
liveness boundary. The old scope is stale and cannot continue mutation; the new
scope does not match the integrity-bound receipt and cannot adopt it; and the
global incomplete registry entry blocks new hydration claims. There is no
automatic compaction or takeover. Resolution requires a future explicit repair
workflow and is unsupported by this decision.

After either retained selection or empty-volume hydration, replacement opens the
exact store, verifies its identity and marker, wins or exactly replays the
central physical-replica activation, and adopts the current replacement
authority with exact local activation evidence. Authority and the durable closed
barrier are checked again before transport readiness returns.

Activation necessarily changes `data.mdb`, so a later retry cannot compare the
active file byte-for-byte with the immutable source artifact. It first requires
the exact synchronized local activation intent and snapshot-scoped hydration
status, then performs native LMDB verification in a bounded child process.
Malformed LMDB can terminate its native process instead of raising a JavaScript
exception; an abnormal probe exit is therefore returned to the caller as typed
target corruption without terminating the coordinator process.

### Put transport before readiness and admission

The internal reconstructed-resident startup order becomes:

```text
receipt/config/payload/transport scope → topology proof → authority supervisor →
close or adopt retained admission barrier → verified history reconstruction →
settled application-state history inventory → retained selection or hydration →
exact transport readiness → application-state readiness preparation →
exact ADOPTED destination/authority check → strong authority check →
exact barrier reopen → strong authority check → dispatcher
```

The wrapper validates `RETAINED` or `HYDRATED` transport against the receipt,
current history, current authority, and a closed barrier whose version covers
the source checkpoint. Application-state preparation still has to return exact
`ADOPTED` readiness afterward. Any failure before the retained reopen leaves
fresh admissions closed and does not invoke the handler.

## Crash and failure behavior

| Interruption or fault                                                                                             | Required result                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before source sealing                                                                                             | No snapshot bytes may be read or transport claimed; retry must reprove authority, barrier, and settled history.                                                                                                                                   |
| After source sealing but before or during byte read                                                               | The source stays sealed and unwritable; exact publication recovery may retry from the same seal.                                                                                                                                                  |
| History, barrier, or authority moves across the read                                                              | Publication fails before final control evidence can be committed.                                                                                                                                                                                 |
| Provider rejects, loses, truncates, or substitutes bytes                                                          | Readback or integrity verification fails; no final publication evidence is written.                                                                                                                                                               |
| Provider stores exact bytes but loses its response                                                                | Exact retained readback makes publication idempotent; different bytes fail.                                                                                                                                                                       |
| After verified provider publication but before central evidence                                                   | Retry verifies the same immutable object and conditionally writes the exact final evidence.                                                                                                                                                       |
| After central publication commit but before acknowledgement                                                       | Exact control evidence and provider readback recover the same transport.                                                                                                                                                                          |
| Before the durable hydration claim                                                                                | Private staging is unreachable as the target and is best-effort removed; retry starts from true absence.                                                                                                                                          |
| After the claim or exclusive target creation but before the evidence commit                                       | No transport reader accepts the partial root; caught failures clean owned state, while a process-lost empty target remains fail-closed until exact read-only inspection and explicit confirmed recovery.                                          |
| After the explicit recovery receipt is durable but before target retirement                                       | Exact retry replays the receipt and atomically renames only the same receipt-bound empty directory into its retained target path.                                                                                                                 |
| After recovered-target retirement but before exact claim retirement                                               | Exact retry verifies the retained target, retains the receipt, and atomically renames only the receipt-bound claim into its retained claim path.                                                                                                  |
| After recovered-claim retirement but before acknowledgement                                                       | Both exact retired objects prove completion; while its receipt-bound scope remains current, the receipt returns idempotently and normal authorized hydration may proceed.                                                                         |
| A recovery receipt or retirement is malformed, orphaned, duplicated-incomplete, or over the 128-receipt bound     | All recovery inspection, replay, and new hydration claims fail closed, and nothing is silently collected.                                                                                                                                         |
| The registry has exactly 128 canonical completed receipts                                                         | A completed receipt whose bound authority and barrier remain current is read-only replayable, but no new recovery-capable hydration claim may begin; every receipt still consumes capacity.                                                       |
| One canonical incomplete attempt exists beside older completed receipts                                           | Fresh inspection selects the incomplete attempt; an explicitly requested older receipt is read-only replayable only after the whole active view is canonical and the requested receipt scope is current.                                          |
| Authority or barrier changes during an incomplete recovery                                                        | Neither the stale nor successor scope may mutate the receipt-bound attempt, its global registry entry blocks new claims, and a future explicit repair workflow is required.                                                                       |
| Authority or barrier changes during a mutating recovery call                                                      | Recovery deletes no canonical or retained evidence object and performs no activation; entry checks fence each requested phase and the final assertion detects stale control scope, without claiming atomic fencing against the filesystem rename. |
| After the evidence link but before directory synchronization or claim release                                     | An exact retry synchronizes the target and parent, releases the verified claim, and resumes as `HYDRATED`.                                                                                                                                        |
| After the snapshot-scoped evidence commit but before acknowledgement                                              | Retry validates the exact data and evidence as `HYDRATED`; it does not overwrite the target.                                                                                                                                                      |
| Existing target is incomplete, corrupt, substituted, or has the wrong identity                                    | Fail closed without provider fallback or automatic repair.                                                                                                                                                                                        |
| Two physical replicas race activation                                                                             | The exact central one-shot claim selects one replica; the loser cannot adopt application-state authority or reopen admission.                                                                                                                     |
| Receipt, history, distribution, marker, seal, publication, activation, barrier, destination, or authority differs | Fail closed before readiness and leave admission closed.                                                                                                                                                                                          |
| Snapshot and every valid physical copy are unavailable                                                            | Fail closed; this slice cannot manufacture recovery evidence.                                                                                                                                                                                     |

These deterministic interruption semantics are necessary but do not by
themselves constitute a process-kill, machine-loss, or two-node provider proof.
The subsequent
[real-process-kill checkpoint](../../../llm/checkpoints/2026-08-31-application-state-snapshot-process-kill.md)
adds independent `SIGKILL`, durable reopen, and retry evidence for all eleven
publication, hydration, and activation callbacks. The current regression matrix
also kills an independent recovery process after each of the three explicit
recovery durability callbacks and proves exact reopen/replay, stale-scope
zero-write behavior, and foreign empty-target refusal. The exact results are
recorded in the
[partial-hydration recovery and reconstructed-work checkpoint](../../../llm/checkpoints/2026-09-01-partial-hydration-recovery-and-work-crossing.md).
It is still not machine-loss or two-node provider evidence.

## Consequences

- A replacement with a truly empty LMDB volume can restore the exact sealed
  application-state checkpoint pinned by its provisioned receipt.
- Snapshot bytes are never read before the source becomes durably unwritable,
  and publication does not succeed until exact distributed readback and central
  final evidence both exist.
- Because the artifact is the complete `data.mdb`, publication seals ordinary
  writes across the whole physical store, not only the receipt namespace.
- A copied snapshot cannot become writable unless its physical replica wins or
  exactly replays the central one-shot activation under current authority.
- Missing evidence and corruption are distinguishable. Only exact absence is a
  hydration condition; every ambiguous or contradictory state fails closed.
- A retained pre-evidence empty hydration target has an explicit, inspect-then-
  confirm recovery path. Its immutable receipt and filesystem identities make
  replay safe without turning general target corruption into automatic cleanup.
- The recovery receipt authorizes only attempt-scoped atomic retirement of one
  exact empty directory and its exact claim. Receipt and retired objects remain
  immutable completion evidence; recovery deletes none of those objects.
- The bounded exact recovery registry fails closed on malformed, orphaned,
  multiply incomplete, or exhausted state and performs no silent garbage
  collection. New hydration validates it on both sides of claim creation.
- The application-state store and execution ledger remain separate transaction
  domains. Safety depends on deliberate quiescence, settled exact history,
  source seal, repeated durable checks, and central publication/activation
  records.
- The mechanism provides no arbitrary crash-time consistency, continuous or
  synchronous per-effect replication, multi-writer application state, or
  recovery from loss of every sealed copy.
- The wrapper and transport remain internal. This decision does not add a
  production resident call site, activate the DynamoDB replacement profile,
  enroll or place nodes, authorize revisions, run a two-node proof, publish a
  release, deploy anything, or lift existing public gates.

## Rejected alternatives

### Copy a live LMDB environment

Rejected because a writer could change application state while bytes are read,
and `lock.mdb` is not a portable application checkpoint. The physical source
must be sealed before the bounded `data.mdb` artifact is opened.

### Snapshot while application-state history is unsettled

Rejected because an in-flight application-state effect can place LMDB bytes on
one side of its durable ledger transition. This slice requires an explicit
quiesced and settled cut rather than guessing which side should win.

### Treat provider publication as final control truth

Rejected because a provider object does not linearize the handoff with the
coordinator authority or retained admission barrier. Final publication evidence
belongs in the fenced central control transaction domain.

### Let every exact copy activate

Rejected because immutable equality does not make two physical replicas one
writable destination. One central create-or-exact-replay claim selects the
physical replica before application-state authority adoption.

### Treat any target-open failure as absence

Rejected because fallback would hide retained corruption and silently replace
local evidence. Only absence of the exact LMDB root permits hydration.

### Rename a staged directory over the target

Rejected because ordinary POSIX directory rename may replace an empty target
that appears after the absence check, and Node has no portable no-replace
directory rename. The durable root claim, exclusive `mkdir`, and ordered
hard-link commit preserve the no-overwrite boundary instead.

### Claim cross-store atomicity from matching digests

Rejected because repeated inventories detect movement but do not create a
transaction across the control store and LMDB. The supported result is a
deliberately closed cold checkpoint, not general crash-consistent replication.

### Use the content receipt as node authorization or placement

Rejected because possession of bytes and hashes does not establish that a node
is trusted or authorized for the revision. Those controls remain prerequisites
for public activation.
