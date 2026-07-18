# Wharfie checkpoint — frozen core closure and V5 managed-effect foundation

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [evidence-backed uncertain reconciliation](2026-07-18-evidence-backed-uncertain-reconciliation.md)
- **Implementation commits:** `dcbd62b` (`fix: preflight the complete core
  runtime closure`) and `49a339d` (`feat: establish V5 managed-effect truth`)
- **Scope:** close ambient core-package fallback before first require, then
  establish internal persisted effect truth without exposing a public effect
  API or making an exactly-once claim.

This is the current restart point for the project-reset conversation. Wharfie
remains breaking-change friendly, trusted-node only, Node/TypeScript first with
future native/WASI component seams, and focused on carrying a normal local CLI
into a portable SEA and durable service. One coordinator remains sufficient for
the first distributed design only if its durable truth can be recovered and
stale owners are fenced.

## Frozen core dependency closure is now preflighted

The core SEA asset no longer carries only a closure digest plus a hand-written
LMDB/msgpackr check. Its strict v2 manifest embeds the complete canonical frozen
dependency plan. Before the first planned package is required, the packaged
runtime verifies:

- exact manifest-to-edge completeness and exact planned physical package set;
- every included package manifest, target constraint, root, and reachable
  non-null CommonJS edge;
- required non-null edges and typed, reasoned optional omissions;
- that omitted optional edges actually resolve to `MODULE_NOT_FOUND` rather
  than an ambient implementation;
- that each resolved entry belongs to the exact planned package and not a
  parent, sibling, or the package's own nested `node_modules`; and
- the v2 domain-separated plan digest and strict asset/provenance linkage.

The lock input format remains v1; the semantic closure plan and strict core
asset are v2. Runtime-computed non-package paths remain outside this static
proof, and the preflight is not a hostile-code sandbox. Darwin and hosted Linux
SEAs have exercised the real locked LMDB package with Node unavailable on
`PATH`.

## V5 adds one durable managed-effect truth path

Execution-ledger schema V5 is a fresh `ledger/v5/` namespace paired with a V3
run-directory partition and default table `wharfie-execution-ledger-v5`. V1
through V4 ledger records and V1 through V2 directory rows are intentionally
inert, including in a deliberately shared physical table. There is no migration
or dual-write behavior because this repository has no downstream users and
backward compatibility is explicitly out of scope.

The V5 manual aggregate is now:

```text
run → invocation → attempt → effect
```

An invocation-scoped effect persists its exact requesting attempt and protocol
sequence, globally scoped destination effect ID, immutable logical request
reference, exact versioned adapter/verifier descriptors, requested replay
properties, and separately adapter-substantiated replay properties. Its first
lifecycle is:

```text
PENDING → STARTED → COMPLETED | FAILED
                  ↘ UNCERTAIN
```

`FAILED` means a verifier-substantiated destination failure and can be returned
to the component without blocking the invocation. `UNCERTAIN` means the adapter
may have begun but no verifier-backed destination outcome became durable; one
atomic event then makes the effect `UNCERTAIN`, retains the attempt as
`ABANDONED`, makes the invocation `UNCERTAIN`, and blocks the run.

### Durable adapter ordering

The internal driver uses this order:

1. validate and snapshot the component request, adapter descriptor, verifier
   descriptor, replay properties, executable function, actor, and optional
   cancellation signal before its first await;
2. commit the immutable logical request as `PENDING`;
3. commit `STARTED` under the exact current attempt fence immediately before
   the one authorized caller may invoke the adapter;
4. require a synchronous exact-version verifier to accept destination evidence;
5. commit the immutable outcome as `COMPLETED` or `FAILED`; and
6. re-read, re-hash, re-verify, and only then return the Activity Protocol
   `effect-result` frame.

The executable function is captured with the persisted semantic selection, so
mutable caller objects cannot replace code after the durable adapter version is
chosen. Verifier inputs are independent deeply frozen JSON snapshots. The
versioned registry is trusted for deterministic verifier semantics; missing,
throwing, asynchronous, or rejecting verifiers fail closed.

### Response loss is phase-specific

- A lost request response can resume from retained `PENDING` state.
- A retained `STARTED` effect is never dispatched again by a retry. If the
  start response was lost before any adapter call, the effect deliberately
  remains stuck until a later destination-specific recovery contract exists.
- A terminal effect is safely redelivered without executing the adapter.
- If a competing authorized starter has already committed a verified outcome,
  a losing caller re-reads and returns that terminal frame without dispatch.
- If an outcome commit response is lost, the re-hashed and re-verified retained
  outcome remains authoritative.
- Every idempotent receipt is returned only from a verified fold containing its
  exact event. Receipt/state interleavings refresh the fold before returning
  request, start, outcome, terminal, or reconciliation state.

The driver uses stable phase transition IDs derived from run, invocation,
attempt, and effect identity. Exact replay returns the retained receipt; changed
request, adapter, verifier, actor, fence, outcome, or other semantic input
conflicts.

### Attempt evidence cannot replace effect truth

An ordinary attempt terminal and the older evidence-backed uncertain-attempt
reconciliation now both cross-check every Activity Protocol effect frame against
the independently persisted effect state. A transcript must contain exactly the
matching persisted request and verifier-backed result for every effect requested
by that physical attempt. An omitted, duplicated, invented, altered, or
unresolved effect rejects the logical terminal.

An `effect-became-uncertain` event cannot use the generic uncertain-attempt
reconciliation path: that path cannot produce the missing destination outcome.
Effect-specific destination reconciliation and compensation remain future
contracts.

### Immutable and portable storage hardening

Every managed request and outcome is content-addressed and re-hashed on each
fold and terminal redelivery. Publication snapshots and freezes an independent
provider value, so a buggy payload provider cannot mutate the caller value,
persist the mutation, and compare it against the same changed object.

Effect projection keys hash the validated invocation/effect tuple under a V5
domain. Two maximum-size legal IDs therefore remain well below DynamoDB's
1,024-byte sort-key limit while delimiter-controlled identities cannot alias.
The fold also preserves exact invocation generation, attempt start evidence,
effect descriptors, bindings, and lifecycle fields across every event.

## Deliberate limits

This slice is an internal semantic foundation, not the public feature:

- source and SEA Function/worker activity paths still reject effect requests;
- there is no production capability/adapter catalog, authenticated effect
  transport, or real destination verifier;
- there is no effect reconciliation worker, compensation, automatic retry, or
  public effect operator command;
- inspection of a run containing effects needs the exact verifier registry,
  which the current public operator store does not yet supply;
- a retained `STARTED` effect is safe but may be non-live until explicit
  destination recovery is designed; and
- no exactly-once claim is made. Such a claim requires a real destination to
  enforce the stable destination effect ID atomically with the business
  mutation, and a verifier that proves that exact contract.

Trusted in-process application code can still bypass Wharfie's effect driver
and call an SDK directly. Begun unmanaged handlers remain `unsafe`; Wharfie
cannot infer an external outcome after interruption.

## Review defects found and closed

Independent implementation and fold reviews found and required regressions for:

1. uncertain-attempt reconciliation omitting persisted effects;
2. effect events rewriting invocation generation or attempt start evidence;
3. a pending effect starting after its verifier registration disappeared;
4. a payload provider mutating semantics before publication;
5. composite effect keys exceeding DynamoDB's sort-key limit;
6. stale pre-receipt folds returning pre-transition aggregates across five
   replay paths;
7. mutable adapter code/metadata and actor identity changing after awaits; and
8. a losing starter failing to redeliver an already verified competing outcome.

The final independent critic reported no remaining correctness or security
blocker in the scoped V5 foundation.

## Verification completed

All commands used Node 24.13.1.

- `npm run lint`;
- `npm run typecheck -- --pretty false`;
- focused execution-ledger/manual/effect/config/key suites: **5 passed suites,
  214 passed tests** across the DynamoDB mock, vanilla store, and real LMDB;
- independent managed-effect critic matrix: **60/60**;
- full serial suite with coverage: **65 passed suites, 1 intentional skip, 845
  passed tests, 1 skipped test**;
- `npm run verify:package`: **112 files** in the private tarball;
- `npm run verify:package:sea`: installed-package source/SEA CLI parity,
  app-scoped inspection/recovery/reconciliation/cancellation fences, durable
  ledger-service crash recovery, locked LMDB, and a relocated 138,747,600-byte
  Darwin SEA with Node unavailable on `PATH`; and
- `git diff --check`.

The closure-specific review also passed its 44 focused resource tests, 107
aggregate owned tests, and 11 real Node 24 core-runtime/LMDB tests before
`dcbd62b` was committed.

## Repository and tracker state

The implementation commit is `49a339d`; the frozen-closure predecessor is
`dcbd62b`. Draft PR #125 remains the one reset-stack PR. Issues #126–#132 remain
the scoped open roadmap, and #129 remains open because real retry policy,
destination recovery, crash-boundary proof, and exactly-once-qualified adapters
are not complete.

The remote namespace should remain only `master` and `agent/strict-manifest`
after this checkpoint is pushed. Historical remote tips remain preserved by the
existing archive tags; the local-only `archive/2026-07-18/local/jvd/*` tags must
not be pushed accidentally.

## Known CI blocker and next work

Clean-install CI still fails before lint because
`@typescript-eslint/parser` is not declared directly for ESLint's TypeScript
resolver. The SEA job passed under GitHub despite that earlier failure. Do not
change `package.json` or `package-lock.json` for this diagnosed dependency-only
repair until the user explicitly approves it.

The next product vertical is authenticated source/SEA Activity Protocol effect
transport through one finite capability/adapter catalog and one real
destination verifier. Before broadening the public surface, consider extracting
the now-large V5 ledger codec/fold/effect sections into cohesive pure modules so
the next durable transition does not deepen the monolith. Then add effect-
specific destination reconciliation and adversarial crash tests at every
request/start/outcome boundary before enabling retries or using exactly-once
language.

When resuming: start from `49a339d` plus this checkpoint commit, confirm draft
PR #125 and issue #129 still describe the live branch, and do not reinterpret
V4 records as V5 history.
