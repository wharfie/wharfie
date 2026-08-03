# Wharfie checkpoint — v2 foundation stabilized

- **Date:** 2026-07-19
- **Status:** **COMPLETE — cleanup tranche implemented and validated from a
  clean install**
- **Branch:** `agent/strict-manifest`
- **Implementation receipt:**
  `5b38c13521b5d0fece5ead8cc8767028b5d9141e`
- **Parent:** [post-V9 repository audit](2026-07-19-post-v9-repository-audit.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR 0018](../../docs/architecture/decisions/0018-causally-linked-managed-effect-successors.md)

This checkpoint closes the loose-end tranche proposed by the post-V9 audit.
Wharfie now has one honest v2 source tree, package boundary, validation path,
portable module rule, and public V9 successor command. It remains private and
experimental; the next product work is a minimal durable workflow running in a
persistent single-node service.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v2-foundation-stabilized.md`. Read `PROJECT.md`,
> `ROADMAP.md`, ADR 0018, and this checkpoint. Confirm the branch contains
> implementation receipt `5b38c13` and inspect the worktree before editing.
> Use Node 24.13.1 and npm 11.12.0. Breaking changes remain acceptable: there
> are no downstream users and no v1 compatibility requirement. Work locally
> with the git CLI; do not spend time reconciling pull requests or issues.
> Begin with the smallest explicit persisted workflow state machine, then run
> it through a genuinely persistent resident worker with restart recovery.
> Preserve Wharfie's finite managed-effect and uncertainty semantics; do not
> replay arbitrary workflow code or broaden exactly-once claims.

## Product boundary retained

Wharfie turns a normal TypeScript CLI with named activities into an
approachable target-specific Node SEA. The same application should later run
as a durable, observable service and coordinate work across trusted nodes
without requiring Node, containers, Kubernetes, or a hosted Wharfie control
plane on target machines.

- TypeScript/Node remains the only authoring and control-plane model. Exact
  native Node dependencies and future WASM/component workers remain available
  behind versioned serializable boundaries.
- One coordinator is sufficient initially only when durable truth survives its
  process and a replacement can acquire fenced authority and reconstruct work.
- Generated applications may use a user's normal provider credential chain to
  fulfill finite Wharfie capabilities. Wharfie is not general cloud IaC.
- Exactly-once claims remain destination-specific: the destination must
  atomically bind a stable effect identity to the business mutation or install
  a mutually exclusive permanent negative closure.
- Trustless mesh behavior, a web UI, and v1 compatibility remain out of scope.

## What changed

### Repository and package cleanup

- Retired the obsolete React/PWA documentation application, generated search
  and report assets, destructive S3 deployer, separate docs lockfile, and root
  S3 wrapper. Current documentation is a small repository-native guide plus
  accepted ADRs and historical reset records.
- Deleted the unshipped self-hosting app prototype and the misleading release
  workflow and publisher-verifier scripts while the package is private.
- Removed unused S3, SQS, gRPC, UUID, and TypeScript ESLint-resolver
  dependencies. Node's `randomUUID()` replaces UUID package calls.
- Updated the retained AWS, tar, pacote, and Arborist families and regenerated
  the npm lockfile. Production and complete dependency audits report zero
  vulnerabilities.
- Narrowed the npm tarball to the public/runtime source boundary. Repository
  scripts, tests, docs, examples, checkpoints, and apps are rejected by the
  package gate.

### Validation truth

- ESLint covers production CLI and tests and fails on any warning. The inactive
  TypeScript import preset/resolver is gone.
- Type checking is split into strict source, public app implementation,
  consumer declaration/tests, and the large repository-only SEA verifier. The
  verifier retains only explicit `noImplicitAny: false`,
  `strictNullChecks: false`, and `skipLibCheck: true` ratchets; other strict
  checks remain inherited.
- Jest discovers every current `test/**/*.test.js` suite and collects all
  `src/**/*.js` coverage with ratcheting global thresholds.
- npm `devEngines` fails before install, CI, or run commands unless the exact
  contributor Node/npm pair is active. `test:full` composes ordinary CI,
  target-native LMDB, and real generated-SEA validation.

### Portable module boundary

- Every esbuild-reachable in-snapshot JavaScript/TypeScript input is parsed at
  revision preparation. Static imports/exports and literal `import()` or
  `require()` calls remain supported.
- Runtime-computed specifiers, native `require` values and aliases,
  `require.resolve`, `module.require`, `import.meta.resolve`, and
  `createRequire` are rejected with source location diagnostics. Locally
  shadowed functions with the same names remain ordinary application code.
- The exact installed `@babel/parser` version is now part of artifact
  toolchain provenance, so changing the parser that enforces portability
  changes the toolchain digest.

### Public V9 successor

- Accepted ADR 0018 and mounted source `wharfie ops retry-effect` plus packaged
  `<app> wharfie retry-effect`; the hidden environment-selected alias is gone.
- Source and packaged surfaces share options, redaction, authorization, and
  response-loss semantics. A real source-CLI test seeds an exact
  application-state V2 `NOT_APPLIED` effect, completes its fresh-identity
  successor, removes destination state, and proves replay neither redispatches
  nor rematerializes it.
- The relocated SEA verifier exercises the public packaged command across all
  six successor crash boundaries, inserted and already-present receipts,
  response loss, orphan reuse, immutable causal histories, and the absence of
  authored handler or normal-adapter redispatch.

## Validation receipt

All commands ran from a clean Node 24.13.1/npm 11.12.0 install:

- `npm ci` — 889 packages installed; complete audit found 0 vulnerabilities.
- `npm run test:full` — exit 0.
  - lint: 0 warnings; Prettier clean;
  - all four type-check lanes passed;
  - Jest: 77 active suites passed, 1 suite skipped; 1,071 tests passed, 1
    skipped;
  - coverage: 78.61% statements, 73.83% branches, 83.53% functions, 79.56%
    lines;
  - package gate: 115 files verified;
  - production audit at moderate-or-higher: 0 vulnerabilities;
  - native LMDB fixture: 1/1 passed; and
  - clean installed package plus relocated generated Darwin SEA: passed the
    complete argv/stdio, activity, durable effect, inspection/recovery,
    reconciliation/cancellation, eight-boundary effect, three-boundary mixed
    settlement, four-disposition reconciliation, six-boundary public
    successor, response-loss, and resident ledger-service crash matrices with
    Node absent from `PATH`. Final binary size: 142,281,168 bytes.
- `npm ls --depth=0` — exact clean direct dependency tree, no missing or
  extraneous packages.
- `git diff --check` — clean before the implementation commit.

The native LMDB checks must run outside restricted macOS sandboxes that deny
SysV semaphore creation. Exact LMDB 3.4.4 arm64 N-API loading and all host/SEA
tests pass outside that restriction; `MDB_NOLOCK` must not be used.

## Preservation state

The remote state that predated the reset remains preserved under verified
`archive/2026-07-16/remote/...` tags. The last pre-tranche branch receipt was
`c5455d9925cbb71a7b8d512116c7b4740708b56b`; the audit checkpoint itself was
committed as `0db89e66ab2cd02977dacdc1ff012d74f107d7b6`. This tranche is rooted in
those recoverable receipts and deletes no archive tags.

## Next work

1. Define the smallest explicit persisted workflow state machine: immutable
   revision, continuation state, durable outputs, timers/signals, and
   cancellation.
2. Execute it through a truly persistent single-node worker with service
   installation, graceful shutdown, startup recovery, and health reporting.
3. Route manual and scheduled starts through that one path and expose status,
   history, logs, cancellation, and recovery through the reserved human/JSON
   operator surface.
4. Prove process and machine restart behavior at every attempt/effect ambiguity
   boundary before adding remote placement or coordinator failover.
5. Then implement the smallest provider-backed deployment that can create,
   inspect, update, and remove one durable node using the operator's normal
   credential chain.
