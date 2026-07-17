# Wharfie checkpoint — resident ledger-service lifecycle foundation

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Published parent:** `fe37147` (`Externalize ledger payloads into immutable refs`)
- **Scope:** create the narrow resident-service lifecycle and same-host
  ownership boundary before schedules, queues, effects, workflows, or a public
  run-history surface.

Read this after [the ledger-v2 payload checkpoint](2026-07-17-ledger-v2-payload-references.md).
The project decisions remain: trusted nodes only, no v1/backwards compatibility,
Node-first with future native/WASI seams, and exactly-once only where a
destination atomically deduplicates with its mutation.

## What changed

- `src/core/lib/db/tables/ledger-service-lifecycle.js` adds a strict lifecycle
  record in a separate partition of the existing execution-ledger table. A
  deterministic `wls_...` service identity binds to `appId`, not revision, so
  a successor revision contends for the same service. A fresh random
  `wss_...` session fence and strictly higher generation bind each start.
- The only durable lifecycle states are `STARTING`, `READY`, `STOPPING`, and
  `STOPPED`. Exact conditional replacements fence every transition. A stale
  session or generation cannot change a successor record. A successor can
  replace an abandoned lifecycle record with a new generation.
- `src/core/runtime/local-service-session.js` supplies process-held,
  one-OS-principal local endpoint ownership. It derives a short hashed endpoint
  from the logical control namespace, service ID, current principal, and a
  fresh session ID, avoiding macOS Unix-socket path limits. An old endpoint is
  never reused or unlinked: if it is occupied but not live, acquisition fails
  closed and a successor instead uses a new session endpoint.
- The lifecycle table also contains a separate strict ownership record. It
  binds a typed session ID, local scope digest, operating-system principal,
  owner kind, and generation. A candidate binds its fresh endpoint before an
  exact conditional claim of the previously observed record. A scope/principal
  mismatch fails closed; two stale-owner contenders can both observe absence,
  but only one CAS wins and the loser releases its own fresh endpoint.
- `src/core/runtime/services/ledger-service.js` composes those pieces: acquire
  local ownership, persist `STARTING`, persist `READY`, then on graceful
  shutdown persist `STOPPING`/`STOPPED` and release ownership. It has no
  scheduler, work claim, queue poller, heartbeat, coordinator epoch, or
  activity execution path.
- `src/core/runtime/services/ledger-service-command.js` adds the hidden
  `ledger-service` runtime command. Generated SEA bootstrap code now maps that
  command and no longer statically imports the legacy NodeAgent, DB, queue, or
  Lambda runtime mappings. Legacy `state-start` has no replacement route in
  the new generated runtime map.
- On the local LMDB control-store path, mutation commands acquire the same app
  ownership record before changing the ledger: `ops run` and `ops recover`
  refuse while a resident service owns it. `ops inspect` remains read-only and
  does not take ownership. The hidden resident runtime rejects vanilla and
  distributed control adapters; direct manual use of those diagnostic/future
  adapters does not claim this local ownership guarantee.

## Exact boundary and recovery semantics

The socket is only proof that a process currently owns an endpoint under the
same local scope and operating-system principal. A candidate binds a fresh
session-keyed endpoint before it claims the durable ownership record. Process
death removes the listener but may leave an unreachable Unix pathname; no
later owner deletes or binds that pathname. The durable lifecycle record is
deliberately allowed to remain `STARTING` or `READY` after a crash rather than
asserting a false graceful stop. One later candidate conditionally replaces the
absent durable owner, then writes a new random session and higher generation.
This supports single-volume process restart within one host/network namespace
and OS principal, but does not establish authority after host loss,
shared-volume split brain, a network partition, another OS user, or coordinator
replacement.

No user work is yet associated with this service lifecycle. Do not add schedule
polling, generic run claims, leases, or worker execution to it until typed
per-service ready/run-directory semantics and cancellation/reconciliation are
designed.

There is intentionally no stale-endpoint garbage collector yet. A crashed
process can leave one inaccessible private Unix-socket pathname; automatically
removing it without reintroducing an ownership race needs a separate,
scope-aware design. New sessions remain safe because they never reuse that
pathname.

## Important portability blocker

The hidden command is source-tested but is **not yet proven runnable from a
clean relocated SEA**. `SeaBuild.esbuild()` currently externalizes `lmdb`, and
`createOperationsDBClient()` defaults to LMDB outside tests. The core SEA does
not currently package that native control-store dependency. Do not substitute
the vanilla in-memory client: it only flushes at clean close and would make a
resident process crash unsafe. Solve or replace/package the durable local
control store, then prove clean SEA lifecycle startup and crash/restart before
calling this a portable resident service.

## Verification at this handoff

- `npm run typecheck`
- `npm run lint`
- focused lifecycle, local-session, hidden-runtime, generated-bootstrap, and
  CLI ownership suites with real Unix sockets, LMDB, and child processes,
  including a forced two-contender stale-owner CAS race and stale-release
  fencing.
- `git diff --check`

The full local packaging test file has two pre-existing fixture failures under
the current Node `23.11.1`: fixtures target Node `24.13.1`. The selected
package test that asserts the new hidden runtime entry passed; do not mistake
the version-fixture mismatch for lifecycle verification.

## Next work

1. Resolve the durable local control-store packaging boundary and prove the
   resident lifecycle under a clean relocated SEA, including crash/restart.
2. Add the typed atomic per-service ready directory/run index before any public
   history listing or scheduling loop.
3. Design cancellation and effect reconciliation transitions before reintroducing
   an `ops cancel` surface.
