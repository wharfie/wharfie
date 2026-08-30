# Replacement quiescence-barrier checkpoint

- **Date:** 2026-08-30
- **Status:** **INTERNAL QUIESCENCE BARRIER COMPOSED; PRODUCT GATES CLOSED**
- **Branch:** `agent/replacement-quiescence-barrier`
- **Source base:** `7fc3c4f`
- **Decision:** [ADR 0039](../../docs/architecture/decisions/0039-retained-coordinator-quiescence-barrier.md)

## Restart summary

This slice closes the admission race left by ADR 0038's two-pass replacement
reconstruction. One retained application-scoped `OPEN`/`CLOSED` generation now
lives in the execution-ledger table. Fresh run admission and schedule mutation
compare that exact generation in the same transaction, while exact committed
replays remain readable during a close.

The internal reconstructed-resident wrapper now closes or adopts the barrier
before history reconstruction and application-state preparation. It reopens
the exact closed predecessor only after strong coordinator-authority checks;
failures before that retained transition leave admissions closed. A final
strong authority check still prevents a stale handler after reopen. The wrapper
has no production call site, and all existing public/DynamoDB product gates
remain closed.

## Durable barrier contract

1. One strict row per application retains `OPEN` or `CLOSED`, a monotonic
   version, the advancing authority, transition identity, and diagnostic time.
   The row is never deleted. Missing is the compatibility `OPEN` generation,
   represented to fresh transactions by an exact `NOT_EXISTS` condition.
2. A strongly observed `OPEN` row becomes an exact same-table condition. A
   close racing that writer has one atomic winner. Every close, adopt, or reopen
   advances the version, so an earlier generation cannot become valid again.
3. Close, not authority takeover, is the admission-cutover linearization point.
   `OPEN` may still name a predecessor because barrier authority governs
   transition ownership, not admission ownership. Work committed before close
   is included in reconstruction; a delayed old-generation write loses after
   close and remains stale after reopen.
4. Every transition compares both the exact predecessor and current coordinator
   authority and commits one permanent stable-request receipt beside the new
   state. Exact request replay returns its frozen accepted successor even after
   later transitions; conflicting request reuse fails closed. Strong receipt
   readback handles response loss without guessing an outcome.
5. `close` accepts the absent or exact `OPEN` predecessor. `adopt` requires an
   exact `CLOSED` predecessor and a strictly newer authority epoch. `reopen`
   requires the exact `CLOSED` predecessor and the same authority that owns it.
6. Strict structural and digest validation applies to both barrier and receipt
   records. Corrupt, conflicting, stale-authority, or unproved outcomes fail
   closed rather than silently creating a new generation.

## Protected mutation contract

- Fresh manual-run creation, workflow-run creation, and managed-effect
  successor authorization carry the exact barrier condition in their existing
  ledger transaction.
- Schedule activation and cursor-only advancement carry the condition beside
  their existing owner and activation fences.
- Create-mode scheduled-workflow preparation captures the barrier condition in
  its opaque prepared token. The later combined schedule/ledger transaction
  consumes that original condition; it does not refresh the generation. A
  close/reopen between preparation and commit therefore rejects the delayed
  token atomically instead of permitting an ABA.
- Exact durable run, request, or occurrence winners are resolved before a
  fresh barrier read. They remain read-only replay results while the barrier is
  `CLOSED` and create no new work.
- Recovery, repair, settlement, reconciliation, inspection, and other
  non-admission paths do not receive a generic barrier check. Their existing
  finite transition authority remains unchanged.

## Ordered replacement startup

The internal sequence is now:

```text
topology proof → authority supervisor → close/adopt barrier →
two-pass execution reconstruction → application-state preparation →
strong authority assertion → reopen exact closed predecessor →
strong authority assertion → resident handler
```

A repeated startup callback under the exact same authority reuses the retained
closed generation. A newer replacement adopts an older closed generation
before continuing. Reopen is a successful handoff transition, not unconditional
cleanup: an aborted supervisor, reconstruction error, application-state error,
or pre-reopen stale authority leaves the barrier closed. A reopen conflict
prevents dispatcher admission; if authority changes after a committed reopen,
the final strong assertion blocks the stale handler without rolling back that
retained transition.

## Deterministic evidence

Focused coverage exercises absent-first close, monotonic close/reopen cycles,
request-response loss and stable replay, closed-generation adoption by a newer
authority, stale pre-close fence rejection after reopen, and corrupt-record
failure. Ledger and schedule coverage exercises fresh rejection versus exact
replay, direct schedule mutation fencing, managed-effect successor admission,
prepared scheduled-workflow cutover, and strict wrapper ordering and failure
behavior.

The focused replacement matrix passed 13 suites and 272 tests. The complete
two-worker repository run then completed 339 suites and 7,928 tests while
identifying one stale transaction-shape expectation across three adapters and
six unrelated resource-contention timeouts. After revising the expectation to
assert the retained barrier condition explicitly, all seven affected suites
passed serially: 153 tests. Lint, all four TypeScript projects, package-content
verification, the provider-boundary verification, and the production
dependency audit also passed; the audit reported zero vulnerabilities. Hosted
pull-request checks remain the final whole-repository two-worker receipt. This
checkpoint does not claim a deployment, live provider run, publication,
promotion, release, or tag-triggered workflow.

## Honest boundary

- The provisioned DynamoDB `tableResourceId` is still not durably distributed
  to independently starting replacement nodes.
- DynamoDB ledger history still references execution-payload bytes in a local
  payload store; another node cannot reconstruct without the exact retained
  volume or a certified payload distribution boundary.
- Application-state preparation remains a separate LMDB-only transactional
  domain. The wrapper orders it correctly but does not implement its replacement
  handoff.
- The wrapper remains internal and does not lift resident, submission,
  workflow, recovery, schedule, or application-state DynamoDB product gates.
- Trusted-node enrollment, revision authorization, capability advertisement,
  placement, and node-lease fencing remain open.
- Assignment, authored-start, managed-effect-settlement, terminal-commit, and
  two-node replacement crash evidence remain required before public
  activation.

## Next handoff

Durably distribute the exact `tableResourceId` and execution-payload bytes,
then implement and prove the separate application-state handoff. Add trusted
node/revision authorization and placement, finish the deterministic crash
matrix, and run one bounded two-node recovery proof before considering a public
DynamoDB resident path.
