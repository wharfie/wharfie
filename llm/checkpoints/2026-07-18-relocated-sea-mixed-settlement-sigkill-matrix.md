# Wharfie checkpoint — relocated-SEA mixed-settlement SIGKILL matrix

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [relocated-SEA managed-effect SIGKILL matrix](2026-07-18-relocated-sea-managed-effect-sigkill-matrix.md)
- **Parent remote tip before this milestone:**
  `6276e0513e9a4cab39ebb98c8a252af6a186f41c`
- **Implementation commit:**
  `5f13b0e4146645ee95f37570049df19ff840fd16`
- **Checkpoint receipt commit:** resolve with
  `git log -1 --format=%H -- llm/checkpoints/2026-07-18-relocated-sea-mixed-settlement-sigkill-matrix.md`
- **Scope:** externally kill the actual relocated SEA at the three stopped
  mixed-effect settlement boundaries, then prove exact packaged recovery and
  replay without adapter dispatch, low-level destination writes, payload
  replacement, partial aggregate settlement, or history rewrites

This is an immutable handoff. Update the live roadmap or add a later dated
checkpoint instead of rewriting it after publication. Wharfie still has no
known downstream users: breaking changes and fresh durable namespaces remain
acceptable when they shorten the path to the intended design. V1 and
V1-through-V6 execution compatibility remain abandoned. Package metadata was
intentionally left untouched.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-18-relocated-sea-mixed-settlement-sigkill-matrix.md`.
> Read `PROJECT.md`, `ROADMAP.md`, ADRs 0001 through 0016, the parent checkpoint,
> and this checkpoint before changing durable execution. Verify implementation
> commit `5f13b0e4146645ee95f37570049df19ff840fd16` and this checkpoint receipt on
> `origin/agent/strict-manifest`, then inspect draft PR #125, issue #129, and
> the current GitHub Actions run. Use exact Node 24.13.1 and npm 11.12.0. The
> actual moved SEA now passes real `SIGKILL`/restart at eight single-effect and
> three mixed-settlement boundaries with Node absent from `PATH`; recovery and
> replay are guarded at both adapter dispatch and the low-level
> application-state write entry. Next implement destination-specific
> reconciliation and compensation for retained `UNCERTAIN` effects, beginning
> with typed application-state evidence and append-only, causally linked
> successor work. Never reopen settled V7 history or silently redispatch the
> abandoned attempt. Package metadata still needs explicit user approval before
> declaring `@typescript-eslint/parser` directly.

## Product boundary retained

Wharfie still aims to carry intent beyond a local coding session: author a
normal TypeScript CLI, package it as one approachable executable, promote it to
a durable resident service, and later place work across trusted machines
without requiring Node, containers, Kubernetes, or a hosted orchestration
service on the target.

This milestone proves the packaged crash semantics of the existing single-node
manual durable host and built-in atomic `application-state` adapter. It does
not make arbitrary activities or future adapters exactly once, add workflow
durability or automatic retry, or prove resident-service and coordinator
failover. The control plane remains Node/TypeScript; native bindings or WASM
can later sit behind explicit hot-path boundaries without promising general
multi-language application support.

Wharfie promises one authoritative logical terminal, not one guaranteed
physical handler execution. Arbitrary activity code and unmanaged SDK calls
remain at-least-once or ambiguous. The built-in `application-state` /
`put-if-absent` operation supports its narrow exactly-once-at-destination
statement only because one LMDB transaction commits the stable destination
effect ID, business value, and permanent receipt.

## What this milestone closes

The actual relocated SEA now covers the three remaining stopped mixed-effect
settlement crash boundaries:

| Boundary | Durable truth at `SIGKILL` | First packaged restart |
| --- | --- | --- |
| Recovered outcome payload published | Original run is unchanged; exactly one new content-addressed outcome payload is orphaned | Reuses that exact payload key and bytes, then atomically settles the complete set |
| Compound settlement transaction committed | Outcome payload is reachable and the complete aggregate transition is durable | Returns `{action: "none", changed: false}` without rewriting history |
| Recovery helper returned before operator readback | Settlement is durable, but the packaged operator has not constructed its view or emitted stdout | Returns the same no-op result without another event or destination work |

Every case starts with one `PENDING` effect, one permanent-receipt-backed
`STARTED` effect, one strict-absence `STARTED` effect, and one already terminal
sibling. Settlement produces `CANCELLED`, `COMPLETED`, `UNCERTAIN`, and the
exact unchanged terminal sibling respectively. The run, invocation, and
attempt become `BLOCKED`, `UNCERTAIN`, and `ABANDONED` through exactly one
`attempt-became-uncertain` event.

The verifier compares the full aggregate head, run, invocation, attempt, event
prefix, effect cardinality/order, and each effect against the exact prior row
plus its intended delta. It pins the cancellation, uncertainty, and stopped
attempt reasons; one shared sequence/time; exact version increments; recovered
terminal marker and immutable outcome reference; unchanged request and
terminal-sibling authority; and exact outcome payload size, digest, store, key,
and decoded content.

Each case uses fresh control, payload, session, and application-state roots.
The parent observes exact ledger, immutable-payload hashes and reachability,
destination business values and permanent receipts, and mutation ownership
before sending a real OS `SIGKILL`. It then proves exact stale durable state and
owner/session evidence from disk.

First and repeated recovery execute through the moved SEA. Source-map anchors
are bound to the installed package's exact `sourcesContent`; entering either
the public destination adapter or the first executable statement in
`application-state.putIfAbsent` fails the proof. Destination state never
changes, recovered payloads are reused rather than republished, settled cases
restart as no-ops, and repeated recovery leaves the entire stable view
unchanged.

Together with the preceding eight-boundary packaged activity matrix, this
closes the current moved-SEA crash surface from request publication through
effect start, atomic destination commit, outcome publication, worker delivery,
user continuation, aggregate stopped-attempt settlement, and recovery-helper
return. The existing oversized-stdout proof remains separate: it covers
operator transport loss after ownership release, not a settlement write
boundary.

## Verification receipt

All final local gates passed under exact Node 24.13.1 with npm 11.12.0:

- **Complete Jest gate:** 75 suites and all 982 enabled tests passed; one
  opt-in suite/test remained skipped (76 suites / 983 tests total).
- **Static gates:** repository ESLint/Prettier, TypeScript checking, direct
  verifier syntax, and `git diff --check` passed.
- **Package-content verification:** all 121 expected files passed.
- **Installed exact-tree tarball and relocated SEA:** all three new cases plus
  the preceding eight-boundary, oversized-response-loss, and resident-lifecycle
  legs passed. The moved Darwin artifact was exactly 141,653,712 bytes with
  Node absent from `PATH`.
- **Sandbox note:** the restricted Jest attempt failed only because Unix socket
  binds returned `EPERM` and LMDB workers received `SIGABRT`; the required
  unrestricted rerun passed the complete gate above.
- **Package metadata:** `package.json` and `package-lock.json` remain untouched
  pending explicit dependency approval.
- **Remote backup before mutation:** local `HEAD` and
  `origin/agent/strict-manifest` both named
  `6276e0513e9a4cab39ebb98c8a252af6a186f41c` with divergence `0 0`.
- **Publication check:** after pushing the implementation and checkpoint
  commits, require
  `git rev-list --left-right --count HEAD...origin/agent/strict-manifest` to
  print `0 0`.

## GitHub and hosted-CI snapshot

Draft PR #125 and issue #129 remain the live trackers. GitHub Actions run #475
for parent tip `6276e0513e9a4cab39ebb98c8a252af6a186f41c` completed with these exact
results:

- `npm ci` succeeded;
- the Linux package SEA verification succeeded with a 162,270,400-byte
  artifact;
- `npm run test:ci` failed in lint because eslint-plugin-import could not load
  undeclared `@typescript-eslint/parser`; and
- the lint report contained 41 findings: 34 errors and 7 warnings.

That is a clean-install dependency declaration issue, not a packaged-SEA
failure. Per the user's package-metadata boundary, this milestone does not add
the parser or modify either lockfile. Refresh the PR body and existing issue
comment `5013214064` after publication; do not create a duplicate checkpoint
comment.

## Next implementation slice

Implement destination-specific reconciliation and compensation before enabling
automatic retries. Start narrowly with the built-in application-state
capability:

1. define typed, verifier-backed destination evidence for each supported
   uncertain outcome;
2. retain the original V7 uncertainty event and abandoned attempt unchanged;
3. model retry or compensation as new append-only work with an explicit causal
   link to that authority;
4. require a new stable effect identity and destination fence for any physical
   successor action; and
5. prove crash/replay behavior before exposing an operator command.

After that, add durable workflow continuations, scheduling decisions, outputs,
and a truly persistent resident worker. Coordinator leases, failover, provider
fulfillment, and trusted multi-node placement remain later roadmap work after
the local execution kernel can safely evolve ambiguous effects.
