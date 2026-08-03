# Wharfie checkpoint — mutable Operation/Action retirement

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** obsolete runtime retirement
  (`2026-07-17-obsolete-runtime-retirement.md`)
- **Scope:** make the append-only execution ledger the only writable durable
  run model by deleting the superseded mutable Operation/Action graph.

Read this after the [obsolete runtime checkpoint](2026-07-17-obsolete-runtime-retirement.md).
Wharfie remains an experimental, breaking-change-friendly reset with no
downstream compatibility requirement.

## Hosted proof for the parent deletion

GitHub Actions run
[29623459315](https://github.com/wharfie/wharfie/actions/runs/29623459315)
verified parent commit `6fc341e` on hosted Node 24:

- clean `npm ci` succeeded;
- the relocated generated Linux SEA passed with Node absent from `PATH`;
- its locked LMDB activity dependency and resident ledger-service crash/
  recovery path still worked after the old NodeAgent, bootstrap-mode, and gRPC
  services were removed; and
- the job remained red only at the known clean-install lint failure caused by
  the undeclared direct `@typescript-eslint/parser` dependency.

## What changed

- Deleted the entire `src/core/lib/graph/` implementation, the mutable
  operations table, and their superseded model/store/runner tests.
- Removed the legacy queue/graph half of `src/core/runtime/app-runs.js`:
  operation construction, provider-message operation IDs, retry/deduplication
  snapshots, and graph execution. The file now contains only strict manifest
  activity preparation and Activity Protocol dispatch.
- Renamed the generic durable-store API from operations-specific
  `createOperationsDBClient`/`resolveOperationsAdapterName` to
  `createControlDBClient`/`resolveControlAdapterName`. Removed
  `WHARFIE_OPERATIONS_TABLE`; the V3 execution ledger retains its explicit
  table setting and schema.
- Renamed `wharfie ops run --operation-id` to `--idempotency-key`. Output now
  distinguishes the user-facing `idempotency_key` from the derived durable
  `run_id`, and the deleted `app:<id>#<operation-id>` resource notation no
  longer appears in current execution messages.
- Changed `createManualLedgerRunId` to accept `{ appId, idempotencyKey }` and
  bumped its canonical identity domain from `manual-ledger-run:v3` to `v4`.
  This intentionally produces a fresh run identity. Old development-only
  manual-run IDs and operation snapshots are neither migrated nor read.
- Marked ADR 0007 superseded by the append-only ledger decision, and updated
  ADRs 0008 and 0011 to describe run, trigger, revision, and idempotency
  identity without implying that the deleted snapshot store remains active.

## Preserved boundary

This deletion keeps:

- the versioned Activity Protocol and framed per-attempt worker transport;
- immutable application revisions, frozen dependency closures, and SEA
  packaging;
- manual run → invocation → attempt events, projections, receipts, immutable
  payload references, exact-run inspection, and explicit recovery;
- the verified V3 per-service run directory;
- local ledger-service ownership and lifecycle records; and
- DB adapters, transactions, bounded pagination, and payload storage used by
  the ledger/control store.

The generic worker `exec`/resource-RPC path and manifest resource declarations
remain the next compatibility island. They share files with supported protocol
code and need a separate symbol-level deletion with migrated security tests.

## Dependency constraint

Root `package.json` and `package-lock.json` remain untouched pending explicit
approval. `@grpc/grpc-js` is now unused, and the AWS S3/SQS clients are expected
to become unused after resource-injection/provider cleanup. Remove those only
in an intentional package metadata change that also addresses the direct parser
declaration; do not silently churn the lockfile during code cleanup.

## Verification at this handoff

- Activity Protocol source/external-revision focused suites pass after the
  app-runs deletion.
- Manual-ledger identity and lifecycle tests pass with the v4 idempotency-key
  contract.
- Control-store configuration, ledger-service command/lifecycle, ops run,
  exact-run operator, and documentation-surface suites cover the renamed APIs
  and CLI flag.
- `npm run typecheck -- --pretty false` passes.
- `npm run lint` and `git diff --check` pass after formatting.
- Repository search finds no production or test import of the deleted graph,
  operation table, or operations-specific control-store names.

The default local shell remains Node `23.11.1`; some multi-process CLI Jest
commands abort there with exit 134 and no test output. The repository pins Node
`24.13.1`, so the final focused/full verification for this slice should be run
under Node 24 and the next pushed commit should again inspect hosted CI.

## Next work

1. Remove `resources` from the strict manifest/types/compiler, remove empty
   `resourceSpecs` artifact baggage, and make `callerMetadata.resources`
   ordinary inert JSON rather than a magic rejected key.
2. Delete Function/ActorSystem runtime resource injection and the worker's
   legacy generic `exec`/RPC transport while preserving framed attempt
   cancellation, deadline, archive, external-closure, and sandbox security
   coverage.
3. Delete unused queue/object-storage/shared-resource code after confirming the
   ledger/control-store path has no dependency on it.
4. With explicit approval, update package metadata/lockfile and make draft PR
   #125 green.
5. Build one shared source/SEA operator layer before exposing the V3 run
   directory.
