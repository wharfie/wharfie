# Wharfie checkpoint — atomic V3 run-history directory

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Parent foundation:** portable core control-store closure
  (`2026-07-17-core-control-store-closure.md`)
- **Scope:** add the first safe app-wide run locator without reviving the old
  scan-based `ops list`, scheduler, or mutable operation store.

Read this after the [portable core control-store checkpoint](2026-07-17-core-control-store-closure.md).
The project decisions remain: trusted nodes only, no v1/backwards
compatibility, Node-first with a future native/WASI seam, one recoverable
coordinator later, and exactly-once only where a destination atomically
deduplicates with its own mutation.

## Hosted portable-control-store proof

The intended hosted proof completed in GitHub Actions run
[29621495162](https://github.com/wharfie/wharfie/actions/runs/29621495162) on
commit `f95d392`:

- the packed tarball installed cleanly on hosted Linux under Node 24;
- a generated Linux SEA ran from a relocated clean directory with `node`
  absent from `PATH`;
- the SEA unpacked and used Wharfie-owned locked LMDB bytes, started hidden
  `ledger-service`, recorded `READY`, retained that durable truth across
  `SIGKILL`, recovered a higher generation with a fresh session, and committed
  `STOPPED` after `SIGTERM`.

The workflow job is still red only because clean `npm ci` does not install the
direct `@typescript-eslint/parser` dependency that ESLint's import parser
requires. The SEA verifier ran under `if: always()` and passed; the separate
external RWX status has no GitHub Actions log. Do not change the root
dependency graph or lockfile without the user's explicit approval.

## What changed

- The ledger is now a deliberately fresh **V3** namespace:
  `wharfie-execution-ledger-v3` by default, `ledger/v3/` run records, and V3
  manual-run/event/transition/attempt identity domains. V2 has no migration
  or backfill because it lacks the required directory invariant. The default
  therefore selects a new physical table, while an explicit
  `WHARFIE_EXECUTION_LEDGER_TABLE` override remains in force and can hold V3
  records beside older V2 rows under their separate key prefixes. V3 never
  reads or backfills those V2 rows: preserve or export that history, or choose
  a new V3 table deliberately, before upgrading an overridden deployment.
- `src/core/lib/ledger/run-directory.js` derives a typed directory partition
  from the existing stable per-app service identity. It uses an immutable,
  newest-first-by-creation sort key, so a status change cannot create a second
  index row or move an existing cursor boundary.
- Every `appendTransition` transaction now writes the event, receipt, run
  head/projections, affected attempt/invocation projection, **and** exactly one
  redacted directory row. Later transitions conditionally replace the expected
  directory row in that same transaction. A missing or altered directory row
  prevents a later run mutation rather than allowing the index to drift.
- The directory contains only service/app/run/revision identity, `manual`
  kind, status/version/sequence, and creation/update times. It never includes
  input, caller metadata, payload references, terminal values, evidence, or
  fencing tokens.
- All DB adapters now implement a bounded `queryPage` primitive: one primary
  equality plus one lexical sort-key prefix, a limit from 1–100, no filters,
  and a portable exclusive `startAfter` cursor. DynamoDB no longer has to
  materialize every provider page before this API can paginate.
- `ExecutionLedgerStore.listRuns({ appId, limit, cursor })` uses that directory
  but treats it only as a locator: it rebuilds every referenced run and requires
  exact agreement before returning a redacted page. Its canonical base64url
  cursor is bound to app, service, directory, and prior sort key. A concurrent
  projection/index replacement attempts a page at most three times, then fails
  closed.

## Intentionally not added

- No public `ops list` command yet. The source CLI currently has operations
  that the packaged SEA operator surface does not; adding history only to the
  source CLI would deepen that split. Build one shared source/SEA operator
  command layer first.
- No ready queue, service admission, lease, or scheduler behavior. Manual runs
  can appear in a service's history directory but are never permission to run
  work. A future typed invocation-level ready index must bind to a `READY`
  lifecycle generation and will be a distinct data structure.
- No snapshot-read claim across pages. Immutable creation ordering prevents an
  existing row from moving or duplicating during pagination, but a new earlier
  row can appear only on a later fresh scan. This is documented semantics, not
  a hidden consistency promise.

## Explicit current constraint

The first directory intentionally keeps one mutable locator row per run under
one per-service partition. That is correct and simple for the initial
single-coordinator slice, but it is not the final high-throughput write shape:
every transition for one app shares that partition. Before broad multi-worker
throughput, replace or shard this mutable status view while retaining the
immutable creation-order locator and its verification rules.

The page size bounds returned rows, not replay work: each row is rebuilt and
rehashes its referenced payloads before it is returned. Ordinary concurrent
transitions that do not present as a directory/projection mismatch can also
fail closed rather than consume a retry, and a directory-only read cannot
discover a run whose directory row was deleted; that deletion is fenced on the
next mutation. Keep this API internal until a bounded inspection model and a
separate integrity/audit pass are designed.

## Verification at this handoff

- `node test/run-jest.js --runInBand --runTestsByPath` for the DB adapter
  contract, execution-ledger record keys and matrix, manual ledger runner,
  source-free ledger operators, ops runner, and unified DB configuration.
- The adapter contract covers the same two-page UTF-8-byte-ordered ASCII query
  across mocked DynamoDB, vanilla, and LMDB, including nondefault Dynamo key
  schemas and Dynamo's ambiguous continuation probe. The ledger matrix covers
  redaction, newest-first multi-page traversal, equal-timestamp tie ordering,
  canonical/scope-bound cursor rejection, atomic directory replacement,
  V2/V3 shared-table isolation, and fail-closed mutation after directory
  removal.
- `npm run lint`
- `npm run typecheck -- --pretty false`
- `git diff --check`

The local shell is still Node `23.11.1` while the repository pins `24.13.1`,
so it does not run the full package SEA verifier. The completed hosted proof
above is the authoritative Node-24 result; the next pushed commit should rerun
it before review.

## Next work

1. Obtain explicit approval to add/lock the direct ESLint parser dependency,
   then make PR #125's GitHub Actions job green and review the new hosted run.
2. Delete, rather than repair, the stale NodeAgent/systemd and mutable
   Operation/Action paths. Also remove manifest resource injection that current
   V2 activities always reject. Preserve only the activity protocol and
   durable-control pieces that serve the reset model.
3. Build one shared source/SEA operator layer and expose the verified V3 run
   directory there, with human and JSON output—not a scan-based history call.
4. Design cancellation, uncertainty reconciliation, and effect transitions
   before adding an `ops cancel` replacement.
5. Embed/preflight the full core frozen dependency plan to close the remaining
   malformed-closure ambient CommonJS fallback edge.
