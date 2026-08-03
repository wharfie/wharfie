# Wharfie checkpoint — bounded packaged runtime extraction

- **Date:** 2026-07-20
- **Status:** **STALE PACKAGED-CORE EXTRACTION CONVERGES AFTER ABRUPT PROCESS DEATH**
- **Branch:** `agent/strict-manifest`
- **Implementation head:** `bc30e42ce55a4680fc5613231fa6a7426fb38978`
- **Linux fixture normalization:** `fdc89a0e350517828d4c1094dcfe44ce27522653`
- **Parent checkpoint:** [real-host activation proof](2026-07-20-v18-real-host-activation-proof.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR
  0009](../../docs/architecture/decisions/0009-frozen-target-dependency-closures.md)

Packaged core native dependencies still use a fresh verified extraction for
every process and never trust a prior mutable tree. They now also recover disk
space after `SIGKILL`: a successor removes only roots whose exact owner is
positively dead, performs bounded work before allocating its own root, and
fails closed when ownership or directory scale is ambiguous.

This closes the final planned single-node service-hardening item. The next
product vertical is the smallest provider-backed one-node lifecycle.

## Implemented authority and convergence contract

The default temporary authority is versioned and scoped by effective UID plus
an opaque stable host token. Each fresh root atomically carries:

- the verified closure digest prefix;
- stable host and current boot tokens;
- the PID namespace;
- the owner PID;
- Linux `/proc/<pid>/stat` process-start ticks; and
- a creation timestamp plus random `mkdtemp` suffix.

On startup Wharfie:

1. verifies the parent and every claimed child are current-user-owned,
   non-symlink directories with mode `0700`;
2. preserves unrecognized entries without deleting them;
3. preserves claims from another host or unverifiable PID namespace;
4. treats a changed Linux boot as death only for the same stable machine;
5. distinguishes a live PID from PID reuse using kernel process-start ticks;
6. removes at most eight positively dead roots;
7. inspects at most 128 direct entries; and
8. refuses to create a new root when removal work remains or automatic
   inspection cannot finish safely.

More than eight stale roots drain across explicit retries. A process killed
during cleanup cannot add another extraction because scavenging precedes
`mkdtemp`. Normal exit continues to remove the current root best-effort.

The old unscoped temporary parent is deliberately not scavenged: its names do
not carry enough owner evidence to distinguish an old dead process from a
still-running pre-v2 SEA. An operator may remove that legacy parent only after
proving no old artifact is active.

## Safety review outcomes

A read-only review found and closed several issues before commit:

- boot ID alone was not safe on a shared `TMPDIR`; a stable host token is now
  required before boot change can prove death;
- one global mode-`0700` parent would let the first OS user exclude every
  other user, so the default parent now includes the effective UID;
- PID liveness alone could retain a dead Linux root after PID reuse, so Linux
  claims and probes bind kernel process-start time;
- the initial 64-root check was observational rather than an atomic semaphore;
  the false hard-bound claim was removed, leaving explicit per-attempt work
  limits instead;
- an inspection-limit failure now requires manual inspection rather than
  falsely promising that an identical retry will progress; and
- disappearance during the second root identity check is accepted as already
  cleaned instead of spuriously failing startup.

Same-UID hostile path swapping is not a security boundary on Wharfie's trusted
nodes. Claims from another PID namespace remain conservative: without a
host-level view Wharfie cannot prove that namespace's process is dead. Repeated
container namespace churn therefore needs a future host-level lease authority
or operator cleanup; the supported resident service runs in the host namespace.

## Validation

At `bc30e42` with pinned Node 24.13.1 and npm 11.12.0:

- the focused runtime suite passes on Darwin with real child-process
  `SIGKILL`, live-owner preservation, dead-owner reclamation, an oversized
  nine-root backlog drained across retries, foreign-host preservation, and
  unrelated-entry preservation;
- the full unrestricted serial repository suite passes 109 suites with one
  skipped: 1,819 tests pass and three are skipped;
- repository lint and all source, app, test, and SEA-verifier typechecks pass;
  and
- the package verifier confirms 147 published files.

A fresh pinned Ubuntu 24.04 arm64 Lima VM ran the five new cleanup/authority
tests, including the Linux-only PID-reuse case: all five passed. The complete
test file also exposed a pre-existing fixture dependence on npm's inode layout:
Linux `npm ci` hardlinked duplicate installed files, so tar encoded four real-
LMDB fixtures with forbidden `Link` entries. Commit `fdc89a0` makes that test
fixture model Wharfie's actual materializer by always archiving independent
regular files. The normalized fixture passes local lint, typecheck, and the
focused suite; the VM was removed immediately at the user's request rather than
retained for another whole-file run.

## Test artifact hygiene

Do not leave heavyweight validation artifacts behind. After this proof the
disposable VM and virtual disk, Lima image cache, `dist/`, coverage, copied
archives, ignored fixture state, systemd audit files, and all `wharfie-*` test
temporary trees were removed. Future work should:

- prefer the smallest focused test that proves the changed boundary;
- use full serial or VM validation only when its additional evidence matters;
- delete VMs, image caches created for the run, coverage, build output, and
  temporary trees immediately after recording the result; and
- never retain a heavyweight proof artifact without an explicit reason.

## Ordered next work

1. Define the smallest provider-neutral one-node contract and one initial
   provider adapter: `plan`, `apply`, `inspect`, `reconcile`, and `destroy`
   through the operator's ordinary credential chain.
2. Make the produced SEA able to establish the node, install its immutable
   artifact and service, inspect exact physical/durable state, and safely
   converge or remove only resources within its recorded authority.
3. Begin coordinator replacement and fencing only after that single-node
   lifecycle is proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v19-bounded-runtime-extraction.md` on branch
> `agent/strict-manifest` at or after `fdc89a0`. Use only the local git CLI; do
> not spend time on PRs or issues. Breaking changes are fine and there are no
> downstream users, so optimize for the ideal v2 state. Bounded packaged-core
> extraction cleanup is implemented and its new Darwin/Linux crash tests pass.
> Start the smallest provider-backed single-node
> plan/apply/inspect/reconcile/destroy vertical through ordinary user
> credentials. Preserve the trusted-node, one-recoverable-coordinator,
> Node/TypeScript public boundary, portable SEA, and evidence-backed
> exactly-once direction in `PROJECT.md`. Keep validation proportional and
> delete VMs, caches, coverage, builds, and temporary test state immediately.
