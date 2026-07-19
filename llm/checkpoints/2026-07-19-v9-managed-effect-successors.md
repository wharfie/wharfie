# Wharfie checkpoint — V9 causally linked managed-effect successors

- **Date:** 2026-07-19
- **Status:** **DRAFT — V9 core, the full suite, package gates, and the internal
  hidden-fixture relocated-SEA matrix pass; deliberate public-surface review
  remains pending**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [V8 destination-finalized effect reconciliation](2026-07-18-v8-destination-effect-reconciliation.md)
- **Published baseline before this in-progress slice:**
  `cb1c49fb554e1635896b4d06c42a1e361a8318b5`
- **Implementation commits:**
  `08a18f72cd9cb0a035692fedbc7b0533e8fd747f` (`feat: add crash-safe managed
effect successors`) and
  `6b83975a809dba08d6315531d717dc72fdd9523c` (`test: harden successor
lifecycle races`), plus
  `fa00593ac36d47c594ccc390e2654c566132bb35` (`test: cover successor catalog
  and destination outcomes`)
- **Validation proof commits:**
  `ab4e3ca6c2032a6207fb0b1f91cf07e8a0ba4ab8` (`test: prove packaged successor
  crash recovery`) and
  `a2a0618c05fefbc8968b0856cc176a2f47cb09c1` (`test: cover successor conflict
  receipt replay`)
- **Checkpoint receipt:** this follow-up commit binds the exact commands below
  to both validation proof commits; publish all three commits together
- **Scope:** authorize and execute one exact destination-specific successor
  retry without reopening the retained V8 source history or rerunning its
  authored handler

This file is an immutable restart receipt for the validation proof commits
above, not a release or public-support handoff. The implementation and proof
must be pushed together before a future session treats them as backed up.
Finalize the product surface only after a deliberate public command decision
and its parity tests; tracker work remains separate.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v9-managed-effect-successors.md`. This checkpoint
> is explicitly draft: first inspect the dirty worktree and the live branch
> before assuming any listed implementation exists. Read `PROJECT.md`,
> `ROADMAP.md`, ADRs 0001, 0002, 0004, 0011, 0017, and 0018, and the parent V8
> checkpoint. Preserve `package.json` and `package-lock.json` until the user
> explicitly approves the parser dependency. Inspect the published V9 core at
> `08a18f72cd9cb0a035692fedbc7b0533e8fd747f` and race hardening at
> `6b83975a809dba08d6315531d717dc72fdd9523c` and coverage follow-up
> `fa00593ac36d47c594ccc390e2654c566132bb35`. The only
> executable policy is an exact application-state V2 `put-if-absent` retry after verified
> `NOT_APPLIED`. Authorization, target creation, causal slot, and
> stable application-scoped caller-supplied successor ID must commit atomically.
> Execute a fresh
> framework-owned effect-only target; never load or rerun the authored source
> handler. Keep the source run `BLOCKED`, invocation `UNCERTAIN`, attempt
> byte-identical `ABANDONED`, and reconciled effect byte-identical. The target
> must use its dedicated atomic successor lifecycle, never generic claim/start
> transitions. Source and packaged CLI parents currently omit the successor
> operation, and the SEA verifier asserts normal help omits it. Its six-boundary
> internal matrix uses a hidden packaged fixture alias only under
> `WHARFIE_TEST_SEA_SUCCESSOR_FIXTURE=1`; this unsupported test-harness switch
> is not an authorization boundary for a trusted operator controlling the SEA
> environment, and it is not public support. The current matrix and
> full-suite/package gates pass; inspect the exact commands below and both
> validation proof commits before trusting them. The proposed exact public
> surface is recorded below. Do not accept ADR 0018 or publish a
> public-support claim until an intentional source/package mount review and its
> public parity tests pass. Do not add a generic compensation or persistent
> scheduler.

## Product and recovery boundary retained

Wharfie turns a normal TypeScript CLI into an approachable portable SEA that
can later remain resident as a durable service and coordinate work across a
trusted mesh. It is not general cloud infrastructure-as-code. A produced SEA
may use a user's ordinary provider credentials to fulfill the finite node and
resource abstractions Wharfie owns.

Node/TypeScript remains the control plane and application model. Native
bindings or WASM may serve measured hot paths without creating a general
multi-language promise. Exactly-once claims remain limited to destinations
that atomically commit a stable effect identity with their business mutation
or mutually exclusive permanent negative closure.

One authoritative coordinator remains sufficient initially only if durable
truth survives its process and a replacement can recover under linearizable,
fenced ownership. This slice does not implement provider-backed coordinator
replacement, multi-host scheduling, or trusted-node placement.

## Proposed V9 contract

ADR [0018](../../docs/architecture/decisions/0018-causally-linked-managed-effect-successors.md)
is the proposed design for this slice:

- execution ledger V9 and run-directory V7 are fresh authorities with no
  compatibility or migration path; application-state deliberately remains V2;
- `MANAGED_EFFECT_DESTINATION_IDENTITY_VERSION` remains independently versioned
  at 8, so a control-ledger schema bump cannot rotate the same tuple's
  destination authority or hide retained V2 business state;
- the only executable policy accepts an exact built-in application-state V2
  `put-if-absent` source effect after its retained reconciliation verifies
  `NOT_APPLIED` and its registered contract substantiates exactly
  `idempotent, transactional`;
- source authorization, the deterministic causal retry slot, target run and
  invocation creation, target directory row, transition receipts, projections,
  and stable application-scoped caller-supplied successor ID are one
  transaction;
- the target receives fresh run, invocation, effect, destination effect,
  physical attempt, and fence identities and executes only the copied immutable
  managed request through a Wharfie-owned effect-only handler;
- it has a dedicated lifecycle: atomic start creates its sole `STARTED` attempt
  and effect together, an adapter may run only after that transition returns
  `dispatchAuthorized`, and dedicated terminal/interruption/reconciliation
  transitions close or visibly block it. Generic manual lifecycle operations
  and cancellation are rejected;
- the authored source handler, CLI, and continuation are never loaded or
  redispatched;
- authorization advances only source run/invocation event metadata. The source
  attempt and effect remain byte-identical, and the source aggregate remains
  blocked and uncertain even if its successor completes; and
- forward compensation is not executable yet. A later implementation requires
  separately authorized, explicit versioned forward work; no replay label
  creates authority and no generic inverse is inferred. Whether authority must
  be predeclared in an application revision or may come from a strict finite
  plan submitted after an incident by a trusted operator/LLM remains undecided.

## Published implementation map

The core implementation is in the commits above. Reinspect the live branch and
dirty worktree; this remains an unfinished validation/surface slice rather than
a public support receipt:

- the V9 execution-ledger contract, record keys, V7 run directory, table
  defaults, and retained application-state V2 semantic namespace;
- `src/core/lib/ledger/managed-effect-successor-contract.js` for the finite
  policy, deterministic authorization, source lineage, target identities,
  request digest, stable caller-supplied successor ID, and causal slot;
- `authorizeManagedEffectSuccessorRetry` in the execution-ledger store for the
  atomic cross-partition decision;
- `src/core/runtime/managed-effect-successor.js` for target-only execution and
  source-free recovery, plus a manual-ledger guard that retires the old
  precreated-successor runner seam;
- special atomic start, terminal, interruption, and reconciliation events in
  the ledger. A successor cannot enter generic claim, attempt, effect, terminal,
  or cancellation transitions;
- internal operator support for successor authorization, recovery,
  reconciliation, and a chained `S1 -> S2` source after `S1` receives a
  permanent `NOT_APPLIED` decision;
- source and packaged CLI parents currently omit a public successor command.
  The packaged-SEA verifier proves that both `retry-effect` and
  `__sea-successor-fixture` are unavailable with the fixture gate absent, then
  enables the hidden alias only under its unsupported test environment so it
  exercises the real packaged command parser, identity fence, redaction, and
  lifecycle without claiming a public surface. The environment switch is not
  an authorization boundary for a trusted operator who controls the SEA
  environment. The exact proposed, still-gated shape is:

  ```text
  wharfie ops retry-effect \
    --run-id <source-run-id> \
    --effect-id <source-effect-id> \
    --successor-id <stable-id> \
    --confirm-runner-stopped \
    [--reason <private-bounded-text>] [--json]

  <app> wharfie retry-effect <same options>
  ```

  It accepts no caller-supplied reconciliation ID, lifecycle status,
  destination, adapter, evidence, or authored handler. Both public mounts and
  their public source/package parity remain pending; and

- focused contract, lifecycle, adapter-failure, CLI-surface, and real
  child-process crash tests. The source crash matrix covers authorization,
  atomic target start, destination commit, and atomic terminal commit.

## Validation recorded — 2026-07-19

All commands used Node 24.13.1 at
`/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`; none changed
`package.json` or `package-lock.json`.

- `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
  scripts/verify-package-sea.js` exited 0. The installed-package Node-absent
  relocated SEA passed all six hidden-fixture successor crash boundaries:
  target-request payload, authorization, atomic start, destination commit,
  terminal payload, and atomic terminal. It proved SIGKILL recovery/replay,
  exact orphan payload reuse, raw target/directory/identity absence before
  authorization, immutable source/target history, copied request/contract/fence
  authority, receipt-bound direct terminal evidence, both `inserted: true` and
  a separate-writer `inserted: false` / `already-present` receipt outcome, and
  no authored app, activity, or normal-adapter redispatch.
- `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
  test/run-jest.js --silent --coverage --runInBand` exited 0: 78 of 79 suites
  and 1058 of 1059 tests passed, with one intentional skip.
- `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
  test/run-jest.js --silent --runInBand
  test/cli/docs-command-surface.test.js
  test/runtime/services/actor-system-cli-runtime.test.js
  test/runtime/managed-effect-successor-lifecycle.test.js` exited 0: 3 suites
  and 32 tests passed. This includes the normal gate-off unknown-command proof
  for both `retry-effect` and `__sea-successor-fixture`.
- The direct Node 24 npm CLI exited 0 for `npm run lint`, `npm run typecheck`,
  and `npm run verify:package`; the package verifier found 123 files. `git diff
  --check` also exited 0.

The matrix hardening caught and corrected verifier-only assumptions around the
retained source reconciliation event, JSON prototype normalization, a target's
expected `NOT_APPLIED` reconciliation state, and the independent-writer
`already-present` receipt branch. Those corrections expand the proof; they do
not alter the product lifecycle.

## Required validation before finalization

The final-worktree tests above are useful evidence, but this draft does not
claim release or public-support readiness. Before finalization:

- rerun affected gates if the validated worktree changes;
- explicitly decide whether to mount the proposed public command. If mounting,
  add source/package command parity and response-loss coverage; if not, retain
  the unsupported SEA fixture and update the roadmap accordingly;
- unchanged `package.json` and `package-lock.json`; and
- push both validation proof commits and this receipt together. Draft PR #125,
  issue #129, and hosted CI review remain follow-up tracker work.

## Work after this slice

After V9 is fully proven and published, the shortest path toward the product is
durable workflow continuations, explicit scheduling decisions and outputs, and
a truly persistent resident worker with a dedicated ready-work index and lease
contract. Do not overload the run-history directory as a queue.

Forward compensation remains later application-model work. First decide whether
an explicit, versioned forward plan must be predeclared in an application
revision or may be submitted after an incident by a trusted operator/LLM
through a strict finite schema. Then define its authority and preconditions,
finite target effect, transaction and verifier, and causal slot before exposing
any compensation command.

Provider-backed single-coordinator replacement, capability fulfillment, and
trusted multi-node placement remain later roadmap milestones. Only after
explicit dependency approval should the clean-install
`@typescript-eslint/parser` declaration be changed.
