# V87 Jest 30 alignment checkpoint

- **Date:** 2026-07-27
- **Status:** **COMMITTED, PUSHED, AND LOCALLY VERIFIED; NO FULL-SUITE OR
  PRODUCTION CLAIM**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `40d86b09a3d7fde2399ff6336f4c0b35a2861efd`
- **V87 implementation commit:**
  `a40927cdba4b038e8bbb32f2b752f1ca8660e198`
- **Remote implementation tip before this checkpoint:**
  `a40927cdba4b038e8bbb32f2b752f1ca8660e198`
- **Parent checkpoint:** [V86 disposable test harness](./2026-07-27-v86-disposable-test-harness.md)

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that becomes one
approachable portable executable, runs locally or remains resident as a
durable service, and coordinates work across trusted machines without
requiring Node, containers, Kubernetes, or a hosted orchestration service on
the target machines.

The product exists to carry useful software beyond the coding session that
created it. It should preserve executable behavior and legible durable truth
so a person or later coding session can follow, recover, and evolve that work.

The settled project boundaries remain:

- nodes are trusted;
- one authoritative coordinator is acceptable initially when its durable
  authority is fenced and recoverable after coordinator loss;
- V1 and backward compatibility are abandoned;
- Wharfie is not general cloud IaC;
- finite Wharfie abstractions may use normal operator credentials to create
  only the resources they require;
- TypeScript/Node is the public authoring path, while measured Node-API, WASM,
  or other native hot paths remain possible behind versioned boundaries;
- exactly-once claims are made only where durable evidence and the managed
  destination's atomic effect semantics support them; and
- one executable and a machine-readable CLI remain the primary operator
  surface; a web UI is optional and later.

The standing working mode is local repository and Git CLI work rather than
PR/issue churn. Breaking changes are acceptable. Focused commits and pushes
are authorized. Use exact Node 24.13.1 and npm 11.12.0. Tests must remain
proportionate, disposable, and cleaned immediately. Never run native LMDB,
native SEA creation on this Mac, or block-device tools locally. Docker, live
AWS, disposable hosts/EBS, formatting, and other external mutation require
explicit approval.

V86 made ordinary Jest execution coverage-free and placed runner-owned output
under one disposable temporary root. V87 resolves the remaining mixed-major
test toolchain so the Jest runtime, imported globals, and test types describe
one coherent major version.

## What V87 closes

Commit `a40927cdba4b038e8bbb32f2b752f1ca8660e198` aligns the direct and
locked Jest toolchain on major 30:

```text
jest             30.4.2
@jest/globals    30.4.1
@types/jest      30.0.0
```

The package lock contains no stale Jest 29 runtime or test-type installation.
`eslint-plugin-jest` remains on its own major 29 release line; that package is
an ESLint integration with an independent version sequence, not another copy
of the Jest runtime or its test types.

The npm lockfile remains lockfile version 3. Its installed package entries
shrank from 933 to 794 after the alignment. The direct
dependency declarations, top-level locked packages, `jest-cli`, and
`jest-runtime` now resolve to one Jest major.

### Regression boundary

The disposable-runner suite now includes a direct-and-locked same-major
regression. It reads both `package.json` and `package-lock.json`, extracts the
major versions for:

```text
direct: jest, @jest/globals, @types/jest
locked: jest, @jest/globals, @types/jest, jest-cli, jest-runtime
```

The test requires one direct major, one locked major, and equality between
them. A future partial upgrade or stale locked runtime therefore fails the
ordinary safe runner suite instead of silently restoring the mismatch.

## Dependency installation and disk accounting

The `npm install` dependency update used exactly:

```text
Node 24.13.1
npm 11.12.0
```

Installation scripts were disabled. The install used a dedicated temporary
npm cache that reached about 85 MB and was removed immediately afterward.

The resulting dependency tree reduced existing disk use:

```text
node_modules   about 249 MB -> about 238 MB
repository     about 534 MB -> about 522 MB
```

`npm ls` completed cleanly after the update.

## Verification completed

All validation used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
```

Completed checks:

- targeted Prettier verification;
- targeted ESLint with cache disabled;
- `tsc -p tsconfig.json --noEmit`;
- `tsc -p tsconfig.app-implementation.json --noEmit`;
- `tsc -p tsconfig.test.json --noEmit`;
- `tsc -p tsconfig.sea-verifier.json --noEmit`;
- clean dependency-tree inspection through `npm ls`; and
- five final safe Jest suites with 63 passing tests.

The safe suites cover direct `@jest/globals` use, ESM
`jest.unstable_mockModule`, ordinary mock behavior, verified run-history
behavior, and the disposable runner including the new same-major regression.

The final successful result was:

```text
test suites:
  5 passed / 5
tests:
  63 passed / 63
coverage:
  disabled
Jest cache:
  disposable
```

No repository coverage directory, repository Jest cache, or owned temporary
runner residue remained afterward. Review found no remaining blocker in the
alignment itself.

No successful native LMDB operation or proof was run. The initial aborted
whole-file suite contains one explicit LMDB case and may have reached it before
the process exited without a report; local investigation stopped rather than
retrying native work. No native SEA creation, native build, Docker operation,
AWS call, block-device operation, or live external-resource action occurred.

## Unresolved local exit 134

One separate `operations-command-errors` suite was excluded from the successful
matrix because its local process exited with status 134, including when invoked
with a test-name filter intended to select only non-LMDB cases.

The cause is unresolved. This checkpoint does not attribute the exit to Jest,
LMDB, the operations implementation, macOS, or any other component. It does
not count that suite as passing, does not claim that its filtered cases ran,
and does not claim the complete test suite. Because the unfiltered file also
contains an explicit native-LMDB case, it must remain outside local validation
until that host boundary is understood.

If that coverage becomes relevant to a product change, reproduce it on a
hosted Linux environment with bounded diagnostics and no native proof enabled
before deciding whether it is a host-specific limitation or an implementation
regression.

## Honest boundaries

V87 aligns the ordinary JavaScript test toolchain, but:

- semver-compatible packages within major 30 need not share an identical
  minor or patch version;
- the same-major regression covers the declared and principal locked runtime
  packages, not every transitive package whose name contains `jest`;
- `eslint-plugin-jest` has an independent release line and is deliberately not
  forced to major 30;
- the unresolved exit 134 leaves one local suite outside the passing matrix;
- no full-suite, coverage-threshold, package-tarball, native, or SEA proof was
  run for this checkpoint;
- dependency installation had scripts disabled and therefore is not evidence
  that optional native installation scripts work; and
- this changes developer validation coherence, not runtime durability,
  coordinator recovery, mesh placement, or cloud lifecycle.

The historical stash remains unrelated and untouched.

## Next safe work — V88

Return to the local product surface and build the durable attempt-log
append/acknowledgement foundation. V88 should establish stable attempt/log
identity, append ordering, durable acknowledgement semantics, bounded
retention, explicit sensitive-data and disclosure semantics, and crash-safe
replay before exposing a public reader. A terminal-only reader over ephemeral
process output would not carry a user's work beyond the original session.

Keep that first slice narrow and adapter-independent. Verify it with
coverage-free/cache-disposable safe suites. Do not use the unresolved
operations-command-errors suite as an implicit gate; reproduce its exit 134 on
hosted Linux only if V88 or a later change genuinely requires that coverage.

V84 remains a separate approval-only external experiment. Neither its Docker
admission scan nor the V83 bounded proof should run automatically. Live
AWS/EBS and block-device work require separate explicit authorization.

## Repository state and resume instructions

The V87 implementation commit is:

```text
a40927cdba4b038e8bbb32f2b752f1ca8660e198
```

It was pushed to `origin/agent/strict-manifest`. Immediately before this
checkpoint was written, local HEAD and that remote branch both resolved to
that commit. The commit containing this file and the synchronized lineage
documents is the V87 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from the V87 checkpoint commit on `agent/strict-manifest`. Verify that
local HEAD equals the remote branch before new work. Preserve exact Node
24.13.1/npm 11.12.0, disposable coverage-free ordinary tests, explicit
coverage runs, immediate disk cleanup, local Git CLI focus, and the approval
boundaries above.
