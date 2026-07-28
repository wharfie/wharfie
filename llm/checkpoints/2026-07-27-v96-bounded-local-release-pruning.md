# V96 bounded local release-pruning checkpoint

- **Date:** 2026-07-27
- **Status:** **IMPLEMENTED, COMMITTED, AND LOCALLY VERIFIED**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `ea8917ea07a3ff5f881efc394abdc57b7fb5c54c`
- **V96 implementation commit:**
  `c4d36fb1b9a0951ba63ac84f8f6e8622fbec64d8`
- **Parent checkpoint:** [V95 versioned durable-operation receipts](./2026-07-27-v95-versioned-durable-operation-receipts.md)

## Restart summary

Wharfie's target remains a normal TypeScript/Node CLI that can become one
approachable portable executable, run locally, remain resident as a durable
service, and coordinate work across trusted machines without requiring Node,
containers, Kubernetes, or a hosted orchestration service on those machines.

V96 closes the first explicit local packaged-release collector. The exact
selected SEA can run `wharfie service prune` to remove fully verified immutable
release copies outside settled selected and one-step rollback authority. The
operation is bounded, fail closed, rename-first, crash recoverable, and valid in
both coherent installed and intentionally uninstalled states.

V96 also closes the staging-residue deadlock exposed during final review.
Ordinary release staging and explicit prune can authenticate and remove a
hard-kill residue in the private `.<artifactId>.<token>.tmp` namespace without
trusting partial bytes. Staging enforces the same finite entry and logical-byte
bounds before publication.

V96 does not add automatic garbage collection, physical exactly-once deletion
or output claims, a general revision/payload/history collector, or the still
missing native V93 relocated Linux schedule/restart evidence. Breaking changes
remain acceptable. Continue with Git CLI, exact Node 24.13.1 and npm 11.12.0,
focused disposable tests, and immediate measurement and cleanup of test roots.

## What V96 closes

### Explicit exact-selected pruning

The packaged operator now exposes:

```text
<selected-app> wharfie service prune [--json]
```

Prune:

1. holds the existing app-scoped kernel operation lock;
2. requires an existing settled `ACTIVE` activation;
3. requires the invoking artifact and embedded revision to equal the selected
   release exactly;
4. requires an exact installation receipt and no unfinished uninstall marker;
5. admits either a coherent installed projection or an inert intentionally
   uninstalled projection;
6. verifies selected and optional rollback release records and bytes;
7. performs one complete bounded release-namespace census before mutation;
8. removes authenticated interrupted stage temporaries and prune tombstones;
9. reverifies every unprotected canonical candidate before rename;
10. atomically renames each candidate to a deterministic same-root tombstone
    before fixed-order deletion; and
11. performs a final census that must contain only selected plus optional
    rollback authority.

A rollback or stale SEA cannot invoke pruning. Missing activation is a state
conflict with install/converge guidance; only an existing unsettled transition
directs the operator to `service recover`.

Historical unprotected releases may carry a different valid build target. Their
own strict receipts and bytes remain authoritative for verification, while
protected releases and reuse of an existing artifact ID remain fenced to the
invoking selected target. This preserves target-changing reinstall and later
cleanup without weakening current authority.

### Bounded namespace and publication

The release root admits at most 128 entries, including canonical releases,
deterministic prune tombstones, and recognized staging temporaries. Canonical
releases and prune tombstones may represent at most 64 GiB of logical artifact
bytes in aggregate.

Before copying a new release, staging:

- validates the complete bounded namespace;
- removes every authenticated interrupted stage temporary;
- rejects a duplicate canonical/tombstone artifact ID;
- reserves the new temporary entry; and
- proves existing logical bytes plus the prospective artifact remain within
  64 GiB.

The bound tests use synthetic reported logical sizes and tiny files; they do not
allocate a large artifact or consume material disk.

### Two separate crash-recovery namespaces

Canonical candidate deletion uses deterministic schema-v1 tombstones whose
names encode artifact ID, revision ID, and logical artifact length. The only
accepted states are:

- complete verified `app` plus `release.json`;
- `release.json` alone after app deletion; and
- an empty directory after receipt deletion.

Deletion is `app -> release.json -> directory`, with directory and parent
fsyncs. An app-only prune tombstone is invalid.

Unpublished stage recovery uses the strict private
`.<artifactId>.<publication-token>.tmp` grammar. The directory must be a
private, owned, real direct child and may contain only owned, real, single-link
`app` and `release.json` files. Partial bytes are deliberately not parsed,
hashed, trusted, or promoted: a kill can interrupt `copyFile`, receipt writing,
or the chmod that follows copy. The accepted shapes are:

- both named children;
- app only; and
- empty.

Cleanup is `release.json -> app -> directory`, making its own interruption
converge only through app-only or empty states. Receipt-only staging residue is
invalid. No recursive deletion is used.

### Stable receipt and redacted failures

Successful explicit pruning returns strict schema version 1 kind
`wharfie.service.release-prune`. It includes:

- installed/uninstalled projection state;
- exact selected and optional rollback references;
- scanned, retained, remaining, removed, resumed-prune, and
  recovered-staging counts;
- a unique artifact-ID-sorted allowlist of removed releases and logical byte
  lengths; and
- summed removed logical bytes.

`recoveredStagingCount` counts only stage temporaries removed by that prune
invocation. A normal install/update may clean staging residue as an internal
convergence step and does not create or replay a prune receipt.

The manager brands only errors it created with a private `WeakSet`; every other
failure, including lock, filesystem, artifact-inspection, activation,
installation, status, and final-verification errors, is wrapped in a static
path-free message while retaining its cause internally. The packaged command
applies a second allowlist to prune codes, messages, and remediation text.

Retry is convergent rather than an exactly-once display protocol. A lost
successful response is not replayed byte-for-byte.

## Verification completed

All checks used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
Node 24.13.1
npm 11.12.0
```

Completed locally:

- all four TypeScript projects with `--noEmit`;
- full-repository ESLint with zero warnings;
- full JavaScript/JSON Prettier and all modified Markdown through Prettier;
- JavaScript syntax checks and `git diff --check`;
- 220 focused tests across the manager, release-prune protocol, and packaged
  command suites, with two platform-specific tests skipped; and
- two independent final reviews covering filesystem/crash safety and
  protocol/lifecycle/documentation integration.

The final focused Jest invocation ran in band with coverage and cache disabled
under the exact `/private/tmp/wharfie-v96-final-tests` parent. The runner
removed its owned child; the exact parent measured 0 bytes and was then
removed. No checkout-local coverage, cache, build, package, or `.wharfie`
output was generated by these checks.

Adversarial coverage includes:

- selected/rollback survival across three releases and a working rollback
  after pruning;
- refusal from a rollback SEA before candidate mutation;
- installed and inert-uninstalled pruning;
- no-op retry;
- rename-first interruption and tombstone completion;
- staging retry after a killed partial publication;
- a second kill after stage receipt deletion, leaving recoverable app-only
  state;
- pre-chmod group-writable staged app recovery beneath a private parent;
- receipt-only stage-temp refusal;
- duplicate physical artifact-ID refusal;
- 128-entry and 64-GiB publication refusal without large files;
- mixed-target historical-candidate cleanup;
- missing-activation remediation; and
- native path-bearing error redaction, including a spoofed public error name
  and code.

Not run locally:

- the full Jest suite;
- native SEA construction;
- native LMDB execution;
- the actual relocated Linux due-occurrence/`SIGKILL`/restart proof;
- real systemd-host pruning;
- Docker;
- block-device operations; or
- live cloud/resource mutation.

## Boundaries that remain

- Canonical pruning is explicit and packaged-only; it never runs
  automatically during update or uninstall.
- Uninstall remains state preserving.
- This collector owns only one local packaged service's immutable releases and
  authenticated publication/deletion residue.
- Application revisions, execution payloads, run/log history, remote
  artifacts, deployment resources, and provider objects remain outside its
  authority.
- The 64-GiB value is logical artifact bytes, not filesystem blocks reclaimed.
- Stage temporaries are unpublished partial state and therefore consume entry
  slots but do not claim a trusted logical artifact length.
- There is no native SEA, real-systemd, or disposable-host prune proof.
- V93's committed relocated Linux schedule/restart verifier still has not been
  executed in its required environment.

## Exact next work

1. Run the committed V93 verifier in an explicitly authorized disposable Linux
   environment and retain its exact result.
2. Only after that proof passes, add the narrow source/packaged schedule
   `list`, `inspect`, `pause`, and `resume` surface.
3. Run V84 against one already-present immutable local Linux/amd64 image. If
   its read-only report is attemptable, run V83 only with explicit approval and
   retain only its checksummed `whlp2` receipt.
4. Keep native LMDB/SEA, Docker, block-device, and live-cloud work behind their
   existing explicit approval boundaries.
5. If those environments remain unavailable, choose another bounded local
   cleanup or observability slice without weakening the proof gates or
   broadening V96 into automatic garbage collection.

## Resume state

- Branch: `agent/strict-manifest`
- V96 implementation:
  `c4d36fb1b9a0951ba63ac84f8f6e8622fbec64d8`
- Parent checkpoint:
  `ea8917ea07a3ff5f881efc394abdc57b7fb5c54c`
- Historical stash to leave untouched:
  `stash@{0}: WIP on master: 3dee66b work prompt`
- Exact Node:
  `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`
- Continue with the authorized V93 relocated Linux proof if that environment
  becomes available. Otherwise choose the next ungated bounded local slice.
