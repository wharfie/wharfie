# Wharfie checkpoint — relocated-SEA managed-effect SIGKILL matrix

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [shared packaged durable-run host](2026-07-18-shared-packaged-durable-run-host.md)
- **Parent remote tip before this milestone:**
  `e21fc5718d654d2258495f30ffa88abef98438a1`
- **Implementation commit:**
  `3b2d91bd87521ed95cf9608f7f68f4c4ed968c75`
- **Checkpoint receipt commit:** resolve with
  `git log -1 --format=%H -- llm/checkpoints/2026-07-18-relocated-sea-managed-effect-sigkill-matrix.md`
- **Scope:** externally kill the actual relocated SEA at eight managed-effect
  boundaries, then prove packaged recovery and repeat recovery never redispatch
  destination work or rewrite settled durable history

This is an immutable handoff. Update the live roadmap or add a later dated
checkpoint instead of rewriting it after publication. Wharfie still has no
known downstream users: breaking changes and fresh durable namespaces remain
acceptable when they shorten the path to the intended design. V1 and
V1-through-V6 execution compatibility remain abandoned. Package metadata was
intentionally left untouched.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-18-relocated-sea-managed-effect-sigkill-matrix.md`.
> Read `PROJECT.md`, `ROADMAP.md`, ADRs 0001 through 0016, and this checkpoint
> before changing durable execution. Verify implementation commit
> `3b2d91bd87521ed95cf9608f7f68f4c4ed968c75` and this checkpoint receipt on
> `origin/agent/strict-manifest`, refresh draft PR #125 and the existing issue
> #129 checkpoint comment, and use exact Node 24.13.1. The moved Darwin SEA now
> passes real `SIGKILL`/restart at eight managed-effect boundaries with Node
> absent from `PATH`; first and repeated packaged recovery are guarded against
> destination redispatch. Next repeat the three mixed-set settlement crash
> boundaries through the moved SEA: recovered outcome payload publication,
> aggregate settlement transaction commit, and recovery-helper response.
> Preserve the separate oversized-stdout response-loss proof. Never reopen
> settled V7 history, and claim exactly-once only where the destination
> atomically enforces the stable effect identity with its business mutation.

## Product boundary retained

Wharfie still aims to carry intent beyond a local coding session: author a
normal TypeScript CLI, package it as one approachable executable, promote it to
a durable resident service, and later place work across trusted machines
without requiring Node, containers, Kubernetes, or a hosted orchestration
service on the target.

This milestone proves the packaged crash semantics of the existing foreground
durable host. It does not add a scheduler, coordinator failover, automatic
retry, compensation, provider fulfillment, general cloud IaC, trustless mesh,
or a broader public effect catalog. The control plane remains Node/TypeScript;
the architecture can later admit native bindings or WASM behind explicit
boundaries without promising general multi-language application support.

Wharfie promises one authoritative logical terminal, not one guaranteed
physical handler execution. Arbitrary activity code and unmanaged SDK calls
remain at-least-once or ambiguous. The built-in `application-state` /
`put-if-absent` operation supports its narrow exactly-once-at-destination
statement only because one LMDB transaction commits the stable destination
effect ID, business value, and permanent receipt.

## Real packaged crash harness

`scripts/sea-inspector.js` is a bounded loopback Chrome DevTools Protocol
controller for the real packaged process. It starts the executable with
`--inspect-brk`, catches SeaBuild's fixed `esbundle.js` entry before authored
code executes, reads that script's embedded source map, and validates the exact
installed `sourcesContent`. It then resolves explicit source anchors to all
candidate generated locations and installs ordinary debugger breakpoints.

The helper has bounded connection, command, event, process-exit, and cleanup
paths. It preserves unmapped source-map segments, caches decoded maps, rejects
ambiguous source/anchor matches, and refuses to overwrite an existing
`NODE_OPTIONS`. It does not add production crash hooks, magic environment
boundaries, source-code rewriting, or inspector dependencies to the packaged
runtime. The proof does not require `--enable-source-maps`.

`scripts/verify-package-sea.js` now builds and installs the exact package tree,
moves the SEA to a clean directory, removes Node from `PATH`, and gives every
case fresh control LMDB, payload, session, application-state, destination, and
authored-continuation roots. Each case pauses at its exact boundary, observes
the pre-kill durable truth, sends a real OS `SIGKILL`, reaps the moved SEA, and
restarts through ordinary packaged `wharfie ops` commands.

Both first recovery and repeated recovery run in the moved SEA with a guarded
destination adapter. Entering physical destination dispatch during either
command fails the proof. The harness checks exact ledger state, payload
reachability and orphans, permanent receipts and business values, event
history, owner/session evidence, authored continuation evidence, and command
responses before cleaning the isolated case.

## Eight-boundary managed-effect matrix

| Crash boundary                               | Durable truth at kill                                                 | Recovery truth                                                     |
| -------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Request payload published                    | No effect row or adapter entry; one orphan request payload            | Effect remains absent and the orphan remains                       |
| Request ledger transaction committed         | Effect is `PENDING`; no adapter entry                                 | Effect becomes `CANCELLED` before start                            |
| `STARTED` ledger transaction committed       | Effect is `STARTED`; strict destination absence and no dispatch entry | Effect becomes `UNCERTAIN` without redispatch                      |
| Atomic destination transaction committed     | Effect is `STARTED`; one business value and permanent receipt exist   | Receipt-backed effect becomes `COMPLETED`                          |
| Outcome payload published                    | Effect is `STARTED`; outcome payload is temporarily orphaned          | Existing payload is referenced and effect becomes `COMPLETED`      |
| Outcome ledger transaction committed         | Effect is `COMPLETED`                                                 | Terminal effect remains exactly unchanged                          |
| Host accepts response before Worker delivery | Effect is `COMPLETED`; authored continuation is absent                | Terminal effect remains exactly unchanged                          |
| Authored continuation fsynced                | Effect is `COMPLETED`; marker proves user code resumed after delivery | Terminal effect and continuation evidence remain exactly unchanged |

Across every case, recovery settles the killed execution as a `BLOCKED` run,
`UNCERTAIN` invocation, and `ABANDONED` attempt with exactly one
`attempt-became-uncertain` event. Recovery never invents a conflicting run or
attempt terminal. A second recovery returns `{action: "none", changed: false}`
and leaves the complete ledger, payload, destination, ownership, continuation,
and event evidence unchanged.

The successful non-crash packaged leg also now proves the exact framed
`start`, `effect-request`, `effect-result`, and `completed` sequence and stable
attempt/effect identities. The pre-existing durable replay, packaged
operator-response-loss, mixed-settlement, and resident crash/restart legs still
run in the same installed-artifact verifier.

## Worker bootstrap isolation

The real matrix exposed a runtime boundary that source tests had not exercised:
an activity `Worker` inherited the host SEA's inspector flags through
`NODE_OPTIONS` and suspended before it could dispatch the effect. Activity
Workers now copy the ambient environment, remove only `NODE_OPTIONS`, and set
`execArgv: []`. Ordinary ambient configuration and credentials remain
available, while host preload, debugger, source-map, policy, and bootstrap
flags cannot leak into the user activity isolate.

A fast Worker-boundary regression sets a deliberately missing host preload,
preserves an unrelated environment sentinel, and proves the activity observes
no `NODE_OPTIONS`, an empty `process.execArgv`, and the preserved sentinel. This
keeps future failures out of the expensive package-only diagnostic path.

## Verification status

All final local gates passed under exact Node 24.13.1 with npm 11.12.0:

- **Complete Jest gate:** 75 suites and all 982 enabled tests passed; one
  opt-in suite/test remained skipped (76 suites / 983 tests total).
- **Static gates:** repository ESLint/Prettier, TypeScript checking, direct
  verifier syntax, and `git diff --check` passed.
- **Package-content verification:** all 121 expected files passed.
- **Installed exact-tree tarball and relocated SEA:** passed end to end with
  locked LMDB and Node absent from `PATH`, including all eight new real
  `SIGKILL` cases, existing durable replay and recovery legs, and resident
  lifecycle crash/restart. The moved Darwin artifact was 141,653,712 bytes.
- **Worker isolation regression:** passed through the real Worker boundary with
  a poisoned host preload and preserved ambient environment.
- **Package metadata:** `package.json` and `package-lock.json` remain untouched;
  the known direct parser declaration remains pending explicit user approval.
- **Remote backup before mutation:** after a fresh fetch, local `HEAD` and
  `origin/agent/strict-manifest` both named
  `e21fc5718d654d2258495f30ffa88abef98438a1` with divergence `0 0`.
- **Publication check:** after pushing the implementation and checkpoint
  commits, require
  `git rev-list --left-right --count HEAD...origin/agent/strict-manifest` to
  print `0 0`.

The first restricted-sandbox Jest attempt could not create its Unix sockets or
crash subprocesses and was discarded as an environment denial. The required
unrestricted rerun passed the complete gate above.

## GitHub and CI snapshot

Draft PR #125 and issue #129 remain the live trackers. The preceding GitHub
Actions run #474 concluded with `npm run test:ci` failing while its package SEA
job succeeded. Exact failure logs are unavailable locally because `gh`
authentication is invalid, so this checkpoint does not infer a parser or code
root cause. Refresh the PR body and existing issue comment `5013214064` after
publishing this milestone; do not create a duplicate checkpoint comment.

## Honest remaining boundary

The next slice should repeat the three stopped mixed-set settlement boundaries
through the actual moved SEA:

1. recovered outcome payload publication;
2. aggregate settlement transaction commit; and
3. recovery-helper response before the packaged caller observes it.

Keep the existing oversized-stdout response-loss proof distinct: it covers a
command transport loss, not an aggregate settlement write boundary. Each new
case must use a real moved-SEA kill/restart, fresh state, permanent
receipt/absence evidence, no destination redispatch, exact aggregate and
per-effect state, payload reachability, one-time attempt abandonment, and
idempotent repeat recovery.

After packaged mixed-set parity, design destination-specific reconciliation and
compensation for retained `UNCERTAIN` effects before enabling retries. A retry
or compensation must be new causally linked append-only work; it must never
reopen settled V7 history. Coordinator recovery, durable residency, and trusted
multi-node placement remain later roadmap work after the local execution kernel
has these crash semantics pinned down.
