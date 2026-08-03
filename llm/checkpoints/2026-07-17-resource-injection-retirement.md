# Wharfie checkpoint — resource-injection retirement

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** mutable Operation/Action retirement
  (`2026-07-17-mutable-operation-retirement.md`)
- **Scope:** remove the unusable manifest-resource and generic worker-RPC
  contract while preserving the framed activity protocol, packaging graph, and
  append-only execution ledger.

Read this after the
[mutable Operation/Action checkpoint](2026-07-17-mutable-operation-retirement.md).
Wharfie remains an experimental reset with no downstream compatibility
requirement. TypeScript/Node stays the initial authoring model; portable
deployment capabilities and managed effects remain future, explicit contracts.

## Hosted proof for the parent deletion

GitHub Actions run
[29623822600](https://github.com/wharfie/wharfie/actions/runs/29623822600)
verified parent commit `c38b4d3` on hosted Node 24:

- clean `npm ci` succeeded;
- the relocated generated Linux SEA passed with Node absent from `PATH`;
- its locked LMDB activity dependency and resident ledger-service crash/
  recovery path still worked after the mutable Operation/Action graph was
  removed; and
- the job remained red only at the known clean-install lint failure caused by
  the undeclared direct `@typescript-eslint/parser` dependency.

## Why this deletion is safe

The removed surface never formed one supported product path:

- the strict manifest accepted finite resource descriptors, but source, SEA,
  and ledger-backed Activity Protocol entrypoints rejected every nonempty
  application or activity declaration;
- activity-level declarations were not propagated consistently into sealed
  function assets, so the apparent provenance contract could not be true;
- a caller-metadata property named `resources` was rejected as a magic key even
  though caller metadata is otherwise inert JSON;
- supported source and packaged activity invocation already used the private
  framed attempt wrapper, while raw `Function.run`, `Function.fn`, worker
  `exec`, and object RPC remained compatibility-only entrypoints; and
- the shared-resource registry plus queue/object-storage adapters had no
  production consumer outside that compatibility island.

Keeping these paths would imply deployable capabilities and durable effect
semantics that Wharfie does not yet provide.

## What changed

- Removed top-level and activity `resources` from the public TypeScript types,
  source compiler, canonical manifest validator, embedded manifest, and
  packaging projection. Exact-key validation now rejects either field.
- Made `callerMetadata.resources` ordinary cloned JSON in source, packaged, and
  ledger-backed manual execution. It is persisted only through the same
  redacted immutable payload boundary as other caller metadata and cannot
  request injection.
- Added ADR 0012, which supersedes only the resource-declaration portion of ADR
  0006 and keeps future deployment capabilities separate from runtime object
  handles.
- Bumped the strict function-asset schema from version 3 to version 4 and
  removed `resourceSpecs` from its only accepted encoding, parsed bundle,
  sealed SEA evidence, and artifact provenance. Version 3 development assets
  are intentionally rejected rather than migrated.
- Removed Function and ActorSystem runtime-resource creation, context merging,
  raw invocation, and close lifecycle. Removed the raw packaged function symbol;
  an activity bundle now exposes only its private Activity Protocol wrapper.
  Internal build-resource grouping remains intact.
- Removed the worker's generic `exec`, arbitrary resource RPC, proxy hydration,
  stream materialization, and reusable raw-result API. The remaining worker API
  runs one authenticated framed attempt with strict start/component messages,
  deadline and cancellation termination, late-frame rejection, frozen external
  archive validation, and private sandbox cleanup.
- Migrated worker lifecycle, sandbox-cache, external-package, and runner edge
  tests to the framed attempt API so their security guarantees remain covered.
- Deleted the unused shared-resource registry, runtime resource factory,
  queue adapters, object-storage adapters, AWS SQS helper, and their contract
  tests. Ledger/control DB adapters remain. The AWS S3 helper remains because
  the documentation deployment script still imports it directly.

## Preserved boundary

This cleanup deliberately keeps:

- Activity Protocol v1 frames, ordered logs, cancellation/deadline behavior,
  host-effect requests, structured terminal evidence, and uncertainty rules;
- immutable application revisions, frozen target dependency closures, SEA
  packaging, artifact records, and build-resource reconciliation;
- manual V3 run → invocation → attempt ledger transitions, immutable payload
  references, exact-run inspection/recovery, and the per-service run directory;
- local ledger-service ownership/lifecycle plus the private runtime selector;
- DB adapters, transactions, pagination, and payload storage used by durable
  control state; and
- the product-level capability/deployment-profile model in `PROJECT.md`. It is
  a future fulfillment contract, not the deleted object-injection API.

## Dependency constraint

Root `package.json` and `package-lock.json` remain untouched pending explicit
approval. `@grpc/grpc-js` and `@aws-sdk/client-sqs` are now unused direct
dependencies. The clean-install lint failure still requires a direct
`@typescript-eslint/parser` declaration. Make those package/lockfile changes
together as an intentional reviewed dependency cleanup; do not churn them as a
side effect of code deletion. `@aws-sdk/client-s3` is still used by docs
deployment and must not be classified as orphaned.

## Verification at this handoff

- Under the exact pinned Node `24.13.1`, 19 manifest, packaging, provenance,
  Function/ActorSystem, framed-worker, Activity Protocol, and source/embedded
  execution suites passed all 285 tests. The subsequently restored prepared
  archive-drift regression also passed in the 14-test Function attempt suite
  and proves the worker is not started for mismatched bytes.
- `npm run lint`, `npm run typecheck -- --pretty false`,
  `npm run verify:package`, formatting, stale-reference searches, and
  `git diff --check` pass. The package verifier reports 110 shipped files.
- The clean installed-package verifier built a 137,575,248-byte Darwin SEA,
  matched source and packaged CLI argv/stdin/stdout/stderr/exit behavior, ran
  the source and relocated SEA activities with locked LMDB, proved Node absent
  from `PATH`, and passed ledger-service `SIGKILL` recovery plus graceful
  `SIGTERM` shutdown.
- A combined local Jest command that includes the full LMDB adapter/CLI suites
  still aborts with exit 134 in this workstation environment. That known local
  runner issue does not reproduce in the clean generated SEA proof. The pushed
  commit must still inspect hosted Node-24 Linux CI; its real SEA/LMDB leg is
  the cross-platform authority.

## Next work

1. With explicit approval, add the direct parser declaration and remove the
   unused gRPC/SQS dependencies, then make draft PR #125 fully green.
2. Build one shared source/SEA operator-command layer over the verified V3 run
   directory before exposing history; do not implement scan-based listing.
3. Design durable cancellation and uncertain-effect reconciliation transitions
   before adding an `ops cancel` replacement.
4. Embed the full frozen core closure plan and preflight generic CommonJS
   resolution before closing the remaining ambient-JS fallback concern.
5. Review and merge the reset stack before beginning self-deployment work.
