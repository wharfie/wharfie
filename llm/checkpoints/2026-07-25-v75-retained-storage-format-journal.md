# V75 retained-storage format journal checkpoint

Date: 2026-07-25

Parent:
[V74 retained host storage boundary](./2026-07-25-v74-retained-host-storage-boundary.md)
(`fbd22e96c399534cccfa4542a727821282f6d5ac`)

Implementation:

- `f9e2f8233ab787964e0f5df9b2ef3b5e1f7dabb6` — one fixed
  two-mount runtime gate;
- `b5592f73bae14cac32aee0ddb72c19ff36ba594d` — one fixed host
  runtime account;
- `c26f651317b665a8676a9d36d4b3a9fd118f678c` — retained-storage
  format journal contract; and
- `a6c813fb644f4343c513abb658a301348ae1b4a7` — authenticated,
  host-lock-scoped journal persistence.

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be
packaged as one portable SEA, run locally, become a durable resident service,
and be projected into a trusted cloud node without requiring Node,
containers, Kubernetes, or a hosted orchestration service on that node. Its
larger purpose is to carry an author's intent beyond one interactive LLM
session while keeping the resulting service understandable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use the operator's ordinary cloud credentials to create the
specific resources they require. The public path remains Node-first; native
bindings or WASM remain available for measured hot paths. Exactly-once claims
remain abstraction-specific and require durable protocol evidence.

V74 established exact application/control storage identities, a closed
read-only Linux observer, and recoverable host deactivation authority. V75
removes ambiguity from the shared runtime projection, fixes the host account
to one numeric identity, defines the only legal blank-to-formatted history,
and persists that history under the same authenticated host lock as
activation state.

V75 still performs no formatting, mounting, unmounting, or destructive device
operation.

## Fixed two-mount runtime gate

The dedicated runtime user manager no longer receives independent
role-specific storage drop-ins that could converge sequentially. One fixed
`60-wharfie-retained-storage.conf` projection names both the application and
control mount units in both `BindsTo` and `After`.

The gate is valid only when both retained mount identities are present. The
runtime user manager must remain stopped while either retained mount is
absent, changing, or unverified. This closes the prior interval in which the
service could restart after only one role-specific dependency had converged.

## Fixed host runtime account

The privileged host boundary now uses exactly:

```text
user/group: wharfie-runtime
uid/gid:    60706
home:       /var/lib/wharfie-runtime
shell:      /usr/sbin/nologin
GECOS:      empty
```

Bootstrap and runtime observation use keyed name and numeric NSS lookups
rather than whole-database enumeration. Creation passes explicit numeric
UID/GID and an empty comment. Pre-mutation classification includes keyed
shadow and gshadow state, and post-lock comparison requires the exact shadow
projection. Retained-storage desired/evidence and deactivation authority use
the same central numeric identity.

The bootstrap contract is V3. Its generated script remains below the 16 KiB
transport ceiling: 14,651 raw bytes with digest
`ojMgit_HvWEtmgQoLbQ224MDEzCMCCLaB4z59SFZJW0`.

## Retained-storage format journal

The pure journal contract binds one stable role-specific target derived from
validated retained-storage desired state. Request churn may rebind to the same
target, but a changed provider scope, deployment, incarnation, application,
role, volume, size, filesystem profile, or derived UUID cannot. The desired
contract separately enforces the one fixed mount, runtime-directory, and
runtime-account shape; those host projections are deliberately not stable
media authority.

The journal has exactly three legal durable record shapes:

1. V1 `prepared`, created from an exact blank-media proof;
2. V2 `formatted` with `origin: 'blank-formatted'`, the sole successor of that
   exact prepared record and carrying the exact `wharfie-ext4-v1` proof; or
3. V1 `formatted` with `origin: 'adopted-profile'`, created directly from an
   already exact-profile filesystem.

Both `formatted` shapes are terminal. There is no delete, reset, downgrade,
or second-format transition. A V2 successor reconstructs and validates its
exact predecessor. Journal and proof documents are exact-keyed, canonical,
content-addressed, bounded, immutable, and secret-free. Filesystem UUIDv8
derivation is independently recomputed from stable authority. Mount
namespace, NVMe identity, by-id resolution, device major/minor, and sorted ext4
features are part of the proof boundary.

Journal IDs prove integrity and history only. Pure proof constructors do not
authenticate observation provenance and never authorize a formatter.

## Authenticated durable journal store

Each deployment's V69 activation root now contains:

```text
format-journals/<stable-filesystem-uuid>.json
```

The returned `retainedStorageFormatJournalStore` is deliberately separate from
the existing activation `store`. It exposes only:

- `readRetainedStorageFormatJournal(desired)`; and
- `compareAndSetRetainedStorageFormatJournal({ desired,
  expectedJournalId, nextJournal })`.

Both operations require a live admission from this deployment's
`withHostLock`. They share the existing non-reentrant transaction lock,
poisoning, active-operation accounting, detached-descendant revocation, close
drain, and host-lock recovery order.

Caller input is exact-validated and cloned before transaction-lock
acquisition. A caller therefore cannot change a queued read's target or a
queued CAS's desired state, expected ID, or successor after invocation.

The namespace is fail closed:

- the directory is authenticated as `0700`;
- durable files are authenticated as regular, single-link `0600` files;
- reads use no-follow, nonblocking descriptors and bounded stable-byte
  readback;
- content must be the exact canonical JSON record plus one newline;
- filename UUID, journal target UUID, and store deployment must agree;
- publication is temporary-file write, file fsync, rename, authentication,
  and directory fsync;
- rename/directory durability ambiguity poisons the shared persistence handle;
- at most 128 durable journals and 16 exactly patterned recovery temporaries
  are accepted;
- only exact private temporaries may be removed automatically; and
- durable journals are never pruned, reset, or deleted.

CAS reads the actual current journal under the same transaction, returns
`false` for a stale expectation or equal successor, validates the exact legal
successor, permits replacement at full capacity, and rejects creation of a
new target when full. A response lost after rename is recoverable by exact
readback; retrying the stale CAS does not claim to have won.

This store is persistence only. It is neither formatter wiring nor physical
mutation authority.

## Verification and disk hygiene

Validation used pinned Node **24.13.1**.

- fixed runtime-account source/test typechecks, targeted lint/format, generated
  Bash syntax, and 8 focused suites passed with **211/211** tests;
- the pure journal source/test typechecks, targeted lint/format, and focused
  contract tests passed;
- the final persistence source/test typechecks, targeted ESLint/Prettier, and
  whitespace checks passed;
- the final persistence suite passed **30/30** runnable tests with one
  Linux-only crash-release test skipped; and
- an independent semantic review found and then verified the repair of the
  queued-input mutation race. No implementation blocker remained.

The persistence regression includes the legal prepared-to-formatted and
direct-adoption histories, application/control separation, request churn,
target drift, reopen, exact stale-temp cleanup, response loss, corrupt names
and envelopes, symlinks, hard links, writable modes,
oversized/noncanonical/cross-key records, FIFO rejection in a bounded child,
and deterministic transaction contention with caller mutation.

No full-repository Jest gate, SEA/native package build, native LMDB execution,
Linux block-device operation, live AWS call, or disposable-host proof was run.
Native LMDB remains excluded on this Mac because prior execution terminated
the process with an allocator double-free.

Every dedicated `/private/tmp/wharfie-v75-*` test tree was removed immediately
after use and verified absent. No new coverage, Jest cache, tarball,
distribution, TypeScript build-info, or other generated validation artifact
remains. The repository measured about **530 MiB** after cleanup. The host had
about **4.5 GiB** free at checkpoint time, so future validation must remain
focused and clean up immediately.

## Honest boundaries

V75 now has the durable history needed to make formatting recoverable, but it
does not yet have a production formatting protocol:

- the closed observer reports blank media only as coarse `ready` and does not
  return an authenticated blank proof;
- no orchestration component combines a fresh closed blank observation with a
  durable `prepared` journal publication and exact reread;
- no future formatter may rely solely on the activation kernel's earlier
  authority check because journal and observation awaits create a new
  authorization window;
- no path-retarget-safe destructive device handle or independently proven
  equivalent exists;
- exact offline `wharfie-ext4-v1` formatter arguments and verification remain
  unproven on AL2023/e2fsprogs;
- `prepared` plus partially formatted or otherwise unknown media must remain a
  hard block;
- persistent mount-unit publication, systemd reload/readback, mounting,
  user-manager restart, and recovery remain unimplemented;
- journal-specific full-capacity, detached-descendant/shared-close, and
  directory-fsync poison tests are valuable follow-ons even though the shared
  implementation paths were reviewed as correct;
- the deactivation receipt still lacks a closed authenticated producer; and
- no disposable AL2023/NVMe/EBS, reboot, detach/reattach, power-loss, or
  complete activation/deactivation proof exists.

The remaining provider, packaging, health, garbage-collection, and
clean-account boundaries from V69-V74 also still apply.

## Next slice: closed blank proof and durable preparation

Do not add `mkfs` yet.

1. Extend the existing retained-storage observer with a narrow blank-format
   inspection that reuses its two identical closed snapshots and internally
   creates the exact blank proof from observed device, by-id, mount-namespace,
   partition/holder/signature/mount, and boot-wiring facts.
2. Preserve the existing coarse `inspect()` behavior for activation.
3. Reject snapshot drift, changed namespace/device identity, mounted, held,
   partitioned, boot-enabled, foreign, existing-ext4, unavailable, or
   ambiguous media without publishing anything.
4. Add a pure orchestration boundary that consumes the proof observer and
   journal store, publishes `prepared`, and rereads the exact durable record.
5. Treat a CAS loser as non-authority, recover response loss only by exact
   readback, reuse the stable target across request churn, and keep terminal
   journals immutable and idempotent.
6. Snapshot all orchestration input before its first await.

A later destructive runner must remain under the same host lock, freshly
reauthorize the current controller request immediately before mutation,
reread the exact `prepared` record, and immediately reobserve the same
EBS/by-id/device/rdev/mount namespace. Only then may a separately proven
formatter boundary be considered.

Before implementing that formatter, use a disposable AL2023 host and real EBS
to prove installed e2fsprogs behavior, exact arguments and profile readback,
device-path race containment, flush semantics, interruption recovery, and
reboot/detach/reattach behavior.

## Repository state and resume instructions

The V75 implementation tip is
`a6c813fb644f4343c513abb658a301348ae1b4a7` on
`agent/strict-manifest` and was pushed to
`origin/agent/strict-manifest` before this checkpoint was written. The commit
containing this file is the V75 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from `origin/agent/strict-manifest` at the checkpoint commit, confirm a
clean synchronized branch, and begin with the closed blank-proof plus durable
preparation slice above. Continue to pin Node 24.13.1, never run native LMDB
on this Mac, disable Jest cache and coverage for focused runs, avoid real
block-device tools locally, and remove every generated test or build artifact
immediately.
