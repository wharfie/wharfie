# Wharfie checkpoint — portable core control-store closure

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Parent foundation:** resident ledger-service lifecycle checkpoint
  (`2026-07-17-ledger-service-lifecycle.md`)
- **Scope:** make the first durable local control store available to a clean,
  relocated Node SEA without relying on an ambient Node installation,
  `node_modules`, a sidecar native addon, or the application's own dependency
  lock.

Read this after the [resident lifecycle checkpoint](2026-07-17-ledger-service-lifecycle.md).
The project decisions remain: trusted nodes only, no v1/backwards
compatibility, Node-first with a future native/WASI seam, one recoverable
coordinator later, and exactly-once only where a destination atomically
deduplicates with its own mutation.

## What changed

- `src/core/resources/builds/assets/core-lmdb.package-lock.json` is a shipped,
  minimal package-lock v3 snapshot for `lmdb@3.4.4`. It contains the complete
  reachable graph, including optional target-native packages and the otherwise
  unsupported Linux-arm optional edges Arborist needs before target filtering.
  Its canonical SHA-256/base64url digest is
  `aTLcH6_nhkLpmYgXRHTGIzEhzZKgT4gQ_mE-SOBct4w`.
- `CoreRuntimeDependenciesResource` resolves that lock with the existing
  frozen target-closure installer, emits a deterministic gzip archive, and
  seals a strict descriptor plus archive under the reserved SEA asset prefix
  `<WHARFIE_CORE>/dependencies/v1/`. This is intentionally separate from
  activity externals: user application locks never control the core durable
  store.
- Every ActorSystem target now depends on that core resource. The generated
  entrypoint prepares it before dispatching either developer CLI code or the
  hidden `ledger-service` runtime command. SEA asset evidence and package-time
  provenance validate and digest the exact core receipt, so the archive cannot
  silently drift from the final artifact record.
- `lmdb-module.js` makes the adapter boundary explicit. Source execution uses
  the installed development LMDB package; a SEA can resolve LMDB only after
  the verified packaged closure is prepared. Both DB and queue LMDB adapters
  use this seam instead of static ambient imports.
- The SEA loader verifies the descriptor, target, and raw archive digest;
  extracts to a fresh mode-0700 per-process directory below `TMPDIR`; rejects
  links and special files; and never uses a cross-process mutable native cache.
  It pins package locations inside that extraction root and constrains
  `node-gyp-build-optional-packages` to the closure's exact target-native
  package. Executable-adjacent prebuilds, parent `node_modules`, `NODE_PATH`,
  and `LMDB_PREBUILD` cannot supply a native addon.
- The generated bootstrap prepares core dependencies before dynamically
  evaluating the developer CLI, so module-scope use of a Wharfie LMDB adapter
  cannot race the SEA loader. Resident shutdown handlers are registered before
  durable `READY` is published, closing the SIGTERM readiness race.
- The clean verifier's installed-package observer opens LMDB read-only and
  no-create only after the copied SEA creates a stable `data.mdb`/`lock.mdb`
  pair. It therefore cannot initialize the control volume or lifecycle table
  it is supposed to observe.
- Core resource outputs are removed after local packaging succeeds or fails;
  they are not left under Wharfie's temporary build directory.
- Windows SEA targets are rejected up front for now. The POSIX `0700` and
  physical-path guarantees used by extraction are not a Windows ACL/reparse-
  point security design, and emitting a binary that would fail at bootstrap
  would be dishonest.

## Clean-SEA proof

`scripts/verify-package-sea.js`, which CI and release verification run under
the exact Node engine, now does all of the following from a copy of only the
generated executable in a clean directory:

1. confirms `node` is unavailable on `PATH` and exercises the application CLI
   plus an activity with a locked native LMDB dependency;
2. starts hidden `ledger-service` with a stable LMDB control volume;
3. uses an installed-package host reader only as an observer to wait for
   durable `READY` generation 1;
4. sends `SIGKILL`, verifies the record honestly remains `READY`, starts a
   successor, and observes generation 2 with a fresh session;
5. sends `SIGTERM` and observes durable `STOPPED` generation 2.

The abrupt-kill leg deliberately leaves one stale session-specific Unix socket
pathname under `/tmp/wharfie-$UID` on POSIX. The runtime never unlinks an
unproven stale endpoint, and the verifier must not clean it up. CI runners are
ephemeral; scope-aware stale-endpoint garbage collection remains future work.

## Verification at this handoff

- `npm run typecheck`
- `npm run lint`
- 61 focused tests across the core resource/loader, resident command,
  read-only observer boundary, ActorSystem resource, SeaBuild, and artifact
  provenance suites
- a direct actual-closure smoke: reconcile
  `CoreRuntimeDependenciesResource`, prepare its emitted archive, and resolve
  its LMDB module from the fresh closure
- `node --check scripts/verify-package-sea.js`
- `git diff --check`

The current shell runs Node `23.11.1` while this repository requires Node
`24.13.1`; therefore the full package SEA verifier is intentionally not run
locally here. CI's `verify:package:sea` step uses the engine from
`package.json` on hosted Linux and is the designated authoritative execution
proof; its run for this branch remains pending.
The installed LMDB prebuild can be resolved under Node 23 but is not safe to
open there, so the loader unit test opens it only under the exact target Node
version; the full SEA proof always opens and writes it under Node 24.

## Next work

1. Obtain and review the Node-24 hosted-Linux recovery proof before treating
   the portable resident vertical as complete.
2. Embed the full frozen closure plan (not only its digest) and preflight every
   extracted package before generic CommonJS resolution, eliminating the
   remaining malformed-closure ambient-JS fallback edge.
3. Add the typed, atomic per-service ready directory/run index before any
   app-wide history or `ops list` surface.
4. Design durable cancellation and effect-reconciliation transitions before an
   `ops cancel` replacement.
5. Add OS service installation and reboot recovery only after the single
   portable resident vertical has reviewed CI evidence.
