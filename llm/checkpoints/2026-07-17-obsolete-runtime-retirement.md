# Wharfie checkpoint — obsolete runtime retirement

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** atomic V3 run-history directory
  (`2026-07-17-run-directory-index.md`)
- **Scope:** delete the disconnected NodeAgent/systemd/private-gRPC runtime
  island without changing the strict activity protocol, durable ledger, or
  current SEA operator surface.

Read this after the [V3 run-directory checkpoint](2026-07-17-run-directory-index.md).
The project remains Node-first, trusted-node only, free to make breaking
changes, and centered on turning an ordinary local CLI into a portable
executable and then a durable service.

## Why this deletion is safe

The removed runtime was no longer reachable from a supported product path:

- the source CLI exposes `app` and `ops`, not `ctl state`;
- the packaged operator CLI exposes only `manifest` and `metadata` under the
  reserved `wharfie` argv namespace;
- generated SEA code maps only that operator CLI and the private
  `ledger-service` runtime command;
- the old `state-start` bootstrap selected a missing `start` module, and its
  NodeAgent children selected missing `serve-db`, `serve-queue`, and
  `serve-lambda` modules; and
- all remaining consumers of the private gRPC DB, queue, and Lambda services
  were inside that orphan command tree or its tests.

The current framed Activity Protocol worker, immutable revision boundary,
manual V3 ledger runner, local ledger-service ownership/lifecycle, DB adapters,
and SEA packaging path do not import the deleted services.

## What changed

- Deleted NodeAgent and its state `start`/`serve` command tree.
- Deleted the private DB, queue, and Lambda gRPC services and their RPC
  transport.
- Deleted the unexposed `infra deploy|status|logs|rollback` systemd release
  implementation, process runner, runtime resource bootstrap, and self-spawn
  compatibility helpers.
- Deleted the corresponding integration and orchestration suites rather than
  preserving tests for unreachable behavior.
- Removed the retired `WHARFIE_BOOTSTRAP_MODE`, `WHARFIE_BOOTSTRAP_ARGS`, and
  `WHARFIE_APP_MANIFEST` compatibility paths. A packaged process enters private
  runtime dispatch only when a nonempty `WHARFIE_RUNTIME_COMMAND` is present;
  its optional `WHARFIE_RUNTIME_ARGS` must be a JSON array of strings.
- Kept the packaged application's public argv contract unchanged: ordinary
  argv belongs to the developer CLI, and only `<app> wharfie <command>` enters
  Wharfie's operator surface.
- Pruned dead manifest helpers and the `manifest_file` compatibility alias.
  Explicit `--manifest`, `--manifest-file`, and the embedded canonical manifest
  remain supported.
- Updated active agent prompts so a future session does not begin by reading
  deleted supervisor/graph files or recommend manifest resource injection.

The future roadmap item for systemd installation intentionally remains. It
must be rebuilt around the durable resident runtime and recovery model rather
than reviving the removed supervisor and mutable release commands.

## Deliberately unchanged dependency files

The root dependency graph and lockfile remain untouched because the preceding
checkpoint requires explicit user approval for those files. Consequently:

- `@grpc/grpc-js` is now an unused direct dependency and should be removed when
  package metadata changes are authorized; and
- clean-install lint still lacks a direct `@typescript-eslint/parser`
  declaration, so the known CI lint failure remains independent of this code
  deletion.

Do not disguise either package-metadata task as part of another cleanup.

## Verification at this handoff

- The focused packaged-dispatch suite passes all 15 tests, including private
  ledger-service selection, strict runtime arguments, retired-bootstrap
  noninterference, developer argv ownership, and the reserved operator
  namespace.
- `npm run typecheck -- --pretty false` passes.
- `git diff --check` passes.
- Repository search finds no source import of a deleted service. Remaining
  NodeAgent/service references are in explicitly historical design documents
  and dated checkpoints.
- The local shell is Node `23.11.1` while the repository pins `24.13.1`.
  Target-sensitive package tests therefore retain their known local mismatch;
  the next pushed commit should rely on the hosted Node-24 SEA verifier for the
  portable artifact regression.

## Next work

1. Delete the now-unreachable mutable `Operation`/`Action` graph and the legacy
   half of `app-runs.js`; preserve the strict Activity Protocol and V3 ledger.
2. Remove the manifest resource schema and the generic worker `exec`/RPC
   injection bridge. Adapt sandbox and external-closure security tests to the
   framed activity-attempt path rather than discarding those guarantees.
3. With explicit approval, fix the parser declaration and remove newly unused
   direct dependencies in one reviewed package/lockfile change, then make draft
   PR #125 green.
4. Build one shared source/SEA operator layer before exposing the verified V3
   run directory.
5. Design cancellation, reconciliation, and durable effect transitions before
   adding a public cancellation command.
