# Wharfie checkpoint — public application state and receipt-backed recovery

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [V5 managed-effect foundation](2026-07-18-v5-managed-effect-foundation.md)
- **Implementation commits:** the public-effect stack through `3602044`
  (`feat: expose finite application state effects`) plus the recovery commit
  containing this checkpoint
- **Scope:** carry one finite managed effect through source and SEA workers into
  durable application state, then close the stopped-runner crash window only
  where a permanent destination receipt can establish the outcome

This is the current restart point for the reset conversation. The repository
has no downstream users, so breaking changes remain welcome when they move the
design faster toward a coherent ideal state. Wharfie is trusted-node only,
Node/TypeScript first, and deliberately not general cloud IaC. A produced SEA
may use user credentials through finite Wharfie abstractions to provision the
nodes or resources it needs. Native Node bindings or WASM/WASI remain valid
hot-path implementation seams, but there is no commitment to a second public
application language.

The product idea remains:

> Turn a normal local TypeScript CLI with named activities into a portable SEA
> that can keep running as a durable service, coordinate work across trusted
> machines, and carry the user's intent beyond one coding-agent session without
> requiring Node, containers, Kubernetes, or a hosted orchestration service.

One coordinator is sufficient initially only while durable truth survives its
loss and stale owners are fenced. The current implementation proves local
single-owner recovery boundaries; it does not yet implement automatic
coordinator failover or multi-host leases.

## Current durable execution state

The writable runtime is the append-only V6 run → invocation → attempt → effect
ledger paired with the verified V4 run directory. The retired v1 API, mutable
Operation/Action graph, disconnected supervisor/runtime island, resource
injection surface, and public run scan/list remain deleted. Exact source and
packaged operators share inspection, confirmed recovery, evidence-backed
reconciliation, and authenticated current-owner cancellation.

An activity attempt is still arbitrary user code. Wharfie gives it one logical
terminal only from an exact complete Activity Protocol transcript. If a runner
dies after `STARTED`, recovery never reruns that code. It abandons the physical
attempt and blocks the logical invocation as `UNCERTAIN`; a later terminal
requires complete evidence through the separate reconciliation command.

## Public finite managed effect

`ActivityRuntime.effects` is now a required public source/SEA worker surface.
Its only request is the exact TypeScript and runtime contract:

```text
application-state / put-if-absent
requested replay properties: [idempotent, transactional]
result: { inserted: boolean }
```

The worker boundary rejects hidden, symbol, inherited, accessor, missing, or
additional logical request fields before host dispatch. Durable `ops run`
provides the finite host handler; ephemeral `invokeActivity` supplies the same
runtime shape but rejects requests catchably with
`ActivityEffectUnavailableError` / `effect-handler-unavailable` and never opens
application state.

The production adapter is LMDB. Control state and application state use
separate, alias-resistant roots. Store identity is created only after an exact
fresh attempt wins durable dispatch authorization. `put-if-absent` atomically
commits the business value (or stable already-present disposition) with a
permanent receipt bound to app/run/invocation/effect identity, destination,
request, adapter, verifier, and business-record digest. Ledger delivery occurs
only after the synchronous registered verifier accepts that outcome.

## Confirmed stopped-runner effect recovery

The shared source/SEA `recover --run-id ... --confirm-runner-stopped` path now
handles one deliberately narrow effect shape under the held app-scoped LMDB
owner:

1. Rebuild the exact run and require exactly one unresolved effect for the
   current attempt.
2. Require that effect to be `STARTED` and to retain the exact built-in LMDB
   application-state adapter, verifier, destination, replay properties, and app
   namespace.
3. Open the separately configured application-state store read-only. Read its
   existing identity; never initialize a missing replacement store.
4. Reconstruct the full original effect-request frame from the ledger's
   immutable logical request and attempt-local sequence.
5. Call only the recovery receipt probe. No catalog resolver, adapter
   executable, application source, or new physical delivery is reachable.

If the exact permanent receipt exists, Wharfie verifies its linked business
record and commits the outcome through the original attempt/effect fences:

```text
effect-started → effect-completed → attempt-became-uncertain
```

The effect is known, but the rest of the arbitrary activity is still unknown.
If and only if the exact probe returns strict `null`, Wharfie atomically blocks
the aggregate through:

```text
effect-started → effect-became-uncertain
```

A missing store, changed store identity, path alias, contract mismatch, corrupt
receipt, corrupt linked business row, thrown probe, or verifier failure is an
operator error and leaves the effect `STARTED`. `PENDING` and multiple
unresolved effects are also refused unchanged because the current ledger has no
safe pre-start effect-abandonment transition or atomic bounded sibling batch.

Recovery transitions use separate deterministic `wmr` identities and retain
the original attempt ID, token, generation, coordinator epoch, effect version,
and destination effect ID. Response-loss recovery re-reads verified ledger
truth and never performs another destination mutation. The schema-v3 redacted
operator view now exposes effect ID, status, adapter version, and lifecycle
ordering without requests, values, destination/store identity, paths, receipts,
evidence, or fencing tokens.

## Exactly-once language

Do not claim general exactly-once execution. Wharfie can make a narrow
destination-effect claim only where the destination atomically enforces the
stable effect identity with the business mutation and the verifier proves the
matching permanent receipt. Arbitrary activity code, unmanaged SDK calls,
future destinations, concurrent unresolved recovery, workflow continuation,
and cross-service delivery do not inherit that property.

## Verification at this checkpoint

All final gates ran on Node 24.13.1:

- typecheck, ESLint/Prettier, Markdown formatting, `git diff --check`, and
  package-content verification all pass; the tarball contains the expected 117
  files;
- the focused managed-effect/application-state/operator/manual-run/CLI/worker
  integration matrix passes 12 suites and 316 tests;
- the complete Jest gate passes 71 suites and 950 tests, with the repository's
  one intentional skipped suite/test unchanged; and
- the installed-tarball verifier builds and moves a real 139,143,888-byte
  Darwin SEA, removes Node from `PATH`, holds/restarts the LMDB resident owner,
  and passes source plus SEA recovery for all four receipt-present/strict-absent
  combinations.

The focused and packaged matrices cover direct response loss, competing
terminal/uncertainty winners, exact receipt commit, strict absence, no recovery
execution surface, read-only store reopen, missing identity/store,
request/destination mismatch, active-owner refusal before application-state
probing, zero-mutation refusal for `PENDING` and concurrent unresolved work,
schema-v3 source/SEA parity, and operator redaction. The full gate also exposed
and repaired drift between one strict-shape test and its diagnostic; the error
now names the exact allowed destination fields.

## Repository and external state

The parent remote tip `3602044` remains preserved in the branch history. At
publication, `origin/agent/strict-manifest` should point at the commit containing
this checkpoint; verify that exact ref before resuming. The last known
reset-stack tracker is draft PR #125 with issues #126–#132. Do not assume those
remote objects are unchanged without a fresh authenticated GitHub read. The
current `gh` token is stale, although ordinary Git remote push authentication
still works.

GitHub reports 130 dependency vulnerabilities on the default branch. The known
clean-install lint blocker is still the missing direct declaration of
`@typescript-eslint/parser`. Do not mutate `package.json` or the lockfile for
that diagnosed dependency-only repair without explicit user approval.

## Next work

1. Model a safe append-only terminal for retained `PENDING` effects and an
   atomic bounded recovery decision for concurrent unresolved siblings.
2. Add subprocess/SEA crash tests at request, effect start, destination commit,
   ledger outcome, and attempt settlement boundaries.
3. Design destination-specific reconciliation/compensation and retry policy;
   keep automatic redelivery disabled until each replay property is actually
   substantiated.
4. Turn the resident lifecycle owner into a real durable worker, then add
   scheduling, leases/heartbeats, and recoverable single-coordinator failover.
5. After dependency-change approval, repair clean-install lint and re-evaluate
   the live PR/issue/branch cleanup state.

When resuming: start from the commit containing this file, confirm the remote
branch matches it, run the focused recovery tests before changing transitions,
and preserve the rule that only exact destination evidence—not operator choice
or a second adapter delivery—can settle a begun effect.
