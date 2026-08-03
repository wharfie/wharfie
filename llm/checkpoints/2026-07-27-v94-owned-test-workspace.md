# V94 owned test-workspace checkpoint

- **Date:** 2026-07-27
- **Status:** **IMPLEMENTED, COMMITTED, AND LOCALLY VERIFIED**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `89edef3a81de56e6dce81acda90c5680738ad86f`
- **V94 implementation commit:**
  `6a99e1a1a0d027d067ce2378cc820d837f7db357`
- **Parent checkpoint:** [V93 relocated SEA schedule/restart proof](./2026-07-27-v93-relocated-sea-schedule-restart-proof.md)

## Restart summary

Wharfie's target remains a normal TypeScript/Node CLI that can become one
approachable portable executable, run locally, remain resident as a durable
service, and coordinate work across trusted machines without requiring Node,
containers, Kubernetes, or a hosted orchestration service on those machines.

V93 left its actual relocated Linux SEA schedule/restart run as an explicit
evidence boundary. V94 does not claim that proof. It closes a local development
problem discovered while validating V93: Jest owned its cache and coverage
directory, but child temporary files, platform data, downloaded/build
artifacts, and app-local revision trees could escape that root and accumulate
on the workstation.

Breaking changes remain acceptable. Continue with Git CLI, exact Node 24.13.1
and npm 11.12.0, focused disposable tests, and immediate measurement and
cleanup of test roots.

## What V94 closes

### One child environment root

`test/run-jest.js` now clones rather than mutates the caller environment and
points these child locations beneath its existing disposable root:

- `HOME` and `USERPROFILE`;
- `TMPDIR`, `TMP`, and `TEMP`;
- `APPDATA` and `LOCALAPPDATA`;
- XDG cache, config, data, and state;
- Wharfie's `CONFIG_DIR`;
- npm's cache; and
- `WHARFIE_TEST_WORKSPACE`, which exposes the owned root to test helpers.

Inherited case variants of owned keys are removed before the canonical values
are assigned. Caller-selected Jest cache or coverage directories remain
caller-owned. The synchronous runner still removes its root after normal exit,
failure, signal, or thrown spawn.

A real-path regression imports Wharfie's path resolver plus the Node and SEA
build resources inside the Jest child and proves their default data, config,
cache, log, temp, binary, and build paths remain under that root.

### Authored applications are inputs, not build directories

Tests that can prepare revisions no longer point at the tracked hello-world,
kitchen-sink, or workflow-crash directories. A shared helper:

1. fingerprints the authored source;
2. copies it beneath the Jest-owned temporary root;
3. excludes `.wharfie` and `node_modules`;
4. supplies an owned ESM package scope and lightweight dependency/package
   resolution links without copying dependency bytes;
5. removes the entire owned root; and
6. verifies that the source fingerprint is unchanged.

Cleanup attempts every fixture and preserves both containment and removal
failures. The helper rejects path-like temporary prefixes and does not traverse
source `node_modules` while fingerprinting.

The kitchen-sink and workflow-crash manifests now import Wharfie's public app
subpath instead of depending on checkout-relative source paths. The redundant
nested workflow-crash package boundary was removed so the repository and
isolated fixture package scopes agree.

### Existing generated residue was removed

The two ignored checkout-local `.wharfie` revision trees were inspected and
removed. They have not returned after the final tests.

The default macOS Wharfie data directory contained about 2.5 GiB of generated
Node binaries, actor binaries, and VM/build material. Those generated
directories were removed. `database.json` and its small existing temporary
sibling were deliberately preserved; the directory remained 12 KiB after
rerunning the relevant package test.

## Verification completed

All checks used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
Node 24.13.1
npm 11.12.0
```

Completed locally:

- all four TypeScript projects with `--noEmit`;
- scoped ESLint with zero warnings;
- scoped Prettier, JavaScript syntax checks, and `git diff --check`;
- 48 tests across the runner, fixture helper, run-history command, example,
  and application-command suites; and
- seven targeted package-reconciliation and invalid-control-adapter tests
  with 34 unrelated tests skipped.

Two independent blocker reviews found no remaining fixture-relocation,
cleanup-ordering, package-resolution, or cross-platform environment-containment
problem.

Every final Jest invocation used `/private/tmp/wharfie-v94-tests`, disabled
coverage and cache, and ran in band. The outer root was 0 bytes after each
runner returned. The static-check root contained only 1.9 MiB of Node compile
cache. Both exact roots were deleted, and no `/private/tmp/wharfie-v94-*`
directory remains.

Not run locally:

- the full Jest suite;
- native SEA construction;
- native LMDB execution;
- the actual relocated Linux due-occurrence/SIGKILL/restart proof;
- Docker;
- block-device operations; or
- live cloud/resource mutation.

## Boundaries that remain

- A caller-supplied Jest cache or coverage path is intentionally not owned by
  the wrapper.
- A test or application that deliberately writes an unrelated absolute path is
  not filesystem-sandboxed by this helper.
- Uncatchable death of the wrapper itself can still leave its temporary root.
- Tests that bypass `test/run-jest.js` do not receive this environment.
- V94 changes test hygiene only; it does not add schedule operator commands,
  strengthen exactly-once claims, or provide the missing native Linux proof.

## Exact next work

1. Run the committed V93 verifier in an explicitly authorized disposable
   Linux environment and retain its exact result.
2. Only after that proof passes, add the narrow source/packaged schedule
   `list`, `inspect`, `pause`, and `resume` surface.
3. While the native proof remains externally gated, define stable versioned
   JSON documents for source and packaged `run`, `submit`, `start`, and
   `signal`, with shared schemas and parity tests.
4. Keep Docker, native LMDB/SEA, block-device, and live-cloud work behind their
   existing explicit approval boundaries.

## Resume state

- Branch: `agent/strict-manifest`
- V94 implementation:
  `6a99e1a1a0d027d067ce2378cc820d837f7db357`
- Parent checkpoint:
  `89edef3a81de56e6dce81acda90c5680738ad86f`
- Historical stash to leave untouched:
  `stash@{0}: WIP on master: 3dee66b work prompt`
- Exact Node:
  `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`
- Continue with the versioned operator JSON slice unless the authorized Linux
  V93 proof environment becomes available first.
