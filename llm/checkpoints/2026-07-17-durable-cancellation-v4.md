# Wharfie checkpoint — V4 durable cancellation

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Remote branch tip before this local slice:** `aa994f4`
- **Parent checkpoint:** shared source/SEA ledger operator
  (`2026-07-17-shared-source-sea-ledger-operator.md`)
- **Scope:** establish honest durable cancellation semantics and prove the
  foreground active owner persists intent before signalling physical work.

Read this after the [shared source/SEA ledger-operator checkpoint](2026-07-17-shared-source-sea-ledger-operator.md).
Wharfie remains free to make breaking changes, Node-first with future
native/WASI component seams, trusted-node only, and centered on carrying an
ordinary local CLI into a portable executable and then a durable service.

## Result

The append-only execution ledger now has a cancellation-capable V4 contract.
Cancellation is a durable request, not a process-local flag and not a synonym
for a terminal result. The first accepted request is immutable and fenced to
the current invocation generation and physical attempt when one exists.

The current aggregate transitions are:

- `RUNNABLE` becomes `CANCELLED` without inventing a physical attempt;
- `CLAIMED` becomes `CANCELLED` only with its exact attempt fence and never
  acquires a start or terminal-evidence record;
- `STARTED` remains `RUNNING` after the request while the active owner delivers
  cancellation and gathers evidence;
- `CANCELLED` after `STARTED` requires a complete Activity Protocol transcript
  containing the exact matching host cancel frame and component terminal;
- complete `completed` or `failed` evidence may still win after a request; and
- an ambiguous post-cancel termination becomes `ABANDONED` / `UNCERTAIN` /
  `BLOCKED`, never an invented failure or cancellation.

A terminal or uncertain state that wins before a new request remains
authoritative. Replaying the same request identity requires an exact semantic
digest match. A different later request observes the retained first request.
Conditional-write loss is resolved by rereading and classifying durable state.

## Fresh identity boundary

This is intentionally not a migration:

- ledger schema, records, transition digests, event IDs, and attempt IDs use
  V4 domains and the `ledger/v4/` record prefix;
- the default table is `wharfie-execution-ledger-v4`;
- the atomically maintained run directory and cursor use their V2 namespace;
- manual idempotency keys derive V5 run IDs; and
- the redacted operator JSON projection is schema 2 because it can disclose a
  cancellation request ID and timestamp.

Older development records are ignored. No V1–V3 history is dual-read,
dual-written, or reinterpreted with the new semantics.

## Foreground active-owner delivery

Source `wharfie ops run` converts its first `SIGINT` or `SIGTERM` into a
structured cancellation request. The manual runner commits or rereads that
request before aborting the signal passed down through the manifest dispatch,
prepared-source/embedded execution, source function, and one-shot Activity
Protocol adapter seams.

The physical signal is sent only if the durable result still names the same
`STARTED` attempt and retains the accepted request. A persistence failure never
causes a best-effort abort. Terminal commit retries rebind to the new run
version when the request append won first, while response-loss reads recognize
an already committed terminal. The process listeners are removed together on
the first signal so a later signal regains ordinary force-termination behavior,
and all listeners are cleaned on command exit.

This is deliberately an **active foreground owner** path. There is still no
public `ops cancel` command, resident-owner command channel, or direct external
writer that races the local LMDB ownership fence.

## Inspection and audit boundary

Exact-run source and SEA inspection expose only the cancellation request ID and
timestamp. Actor, reason, error details, payloads, evidence, transcripts, and
fencing tokens stay redacted. Rebuild validation preserves every invocation
terminal/uncertainty field and every attempt start/terminal/evidence field
exactly, so a fully rehashed forged history cannot smuggle lifecycle changes
inside a cancellation event.

Read-only operator access is enforced by the local adapters and payload store;
the Dynamo control client is also wrapped so its mutation primitives fail
before reaching the remote store. Explicit `actor: null` is malformed rather
than silently becoming the default local actor.

The full decision and deferred boundaries are recorded in
[ADR 0013](../../docs/architecture/decisions/0013-durable-cancellation-and-evidence-reconciliation.md).

## Verification

All checks ran with Node `24.13.1` after the final source changes:

- focused cancellation/operator/configuration coverage: 12 suites, 195 tests;
- full serial test suite: 62 passing suites, 740 passing tests, and one
  intentional skip;
- `npm run lint` and `npm run typecheck -- --pretty false`;
- `npm run verify:package`, which verified 109 tarball files; and
- `npm run verify:package:sea`, which installed the tarball in a clean
  directory, built a 138,186,192-byte Darwin SEA, relocated it, removed Node
  from `PATH`, and proved source/SEA activity behavior plus app-scoped
  inspection/recovery and ledger-service crash recovery with locked LMDB.

The full suite requires an unsandboxed run because LMDB's mmap integration
aborts in this environment's filesystem sandbox. The clean SEA verifier needs
network access only for its isolated npm install; both checks passed outside
those environment restrictions.

Root `package.json` and `package-lock.json` remain untouched. The known package
dependency/audit cleanup still requires its own explicit reviewed change.

## Still deliberately absent

- external-owner or resident-service cancellation delivery;
- evidence-backed reconciliation of already `UNCERTAIN` work;
- durable deadlines and timers;
- managed effect request/outcome records, transactional inbox/outbox behavior,
  compensation, and exactly-once effect claims;
- scheduler leases, heartbeats, retry policy, and coordinator failover; and
- public bounded run history.

## Next work

1. Add an authenticated, fenced command path to the current local owner before
   exposing an external cancellation command.
2. Implement evidence-backed reconciliation as a new append-only event that
   resolves an invocation without rewriting its abandoned physical attempt.
3. Persist managed effect boundaries and destination-backed evidence before
   making exactly-once processing claims.
4. Finish the explicit package dependency/audit cleanup and merge reset PR
   #125 once repository mutation is available.

## Repository state at this checkpoint

The remote repository was archived before reset work began, and the last pushed
branch tip is `aa994f4`. This operator-plus-cancellation slice is present in the
working tree but is not yet committed because the current execution environment
does not permit writing `.git`. Do not discard or reset this worktree. Once Git
metadata writes are approved, review the complete diff, commit the coherent
slice, and push `agent/strict-manifest`.
