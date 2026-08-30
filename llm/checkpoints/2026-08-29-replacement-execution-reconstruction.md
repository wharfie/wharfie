# Replacement execution-reconstruction checkpoint

- **Date:** 2026-08-29
- **Status:** **INTERNAL RECONSTRUCTION COMPOSED; PRODUCT GATES CLOSED**
- **Branch:** `agent/replacement-ledger-reconstruction`
- **Source base:** `d44e932`
- **Decision:** [ADR 0038](../../docs/architecture/decisions/0038-authority-bound-replacement-reconstruction.md)

## Restart summary

This slice gives an ADR 0037 replacement authority complete, explicit
knowledge of retained execution work before any dispatcher can start. It
inventories verified ledger history across all pages, revisions, statuses, and
run kinds; classifies replay policy without loading source or entering an
effect boundary; repairs canonical ready-work locators; and strongly
reasserts the exact stable coordinator token before handoff.

The internal resident order is now fixed as topology proof → supervisor →
reconstruction → application-state preparation → dispatcher body. The
supervisor continues renewal across every phase and one authority-loss signal
prevents later phases from starting. The wrapper has no production call site,
and all existing DynamoDB resident, submission, workflow, recovery, and
application-state product gates remain closed.

## Reconstruction contract

1. A reusable history visitor pages `listRuns` at the maximum bounded page
   size, rejects repeated runs or cursors and cross-application data, and
   rebuilds every directory item before visiting it. Application-state
   readiness now uses this same inventory primitive.
2. The first reconstruction pass validates every lifecycle shape before any
   repair. A second pass must reproduce the same ordered
   SHA-256 fingerprint while repairing expected locators. Detected inter-pass
   drift fails startup closed even though any already-applied locator repair
   remains an idempotent liveness improvement; this is not a transactional
   global snapshot. The returned report is bounded, while exact duplicate-run
   and cursor detection retains sets proportional to history size.
3. Manual/workflow `RUNNABLE`, `CLAIMED`, `STARTED`, timer-waiting, and signal-
   waiting states are distinct. Blocked and terminal states remain inert.
   Nonterminal active or waiting work from old revisions remains parked.
   Runnable and started effect successors remain operator-only; blocked
   successors use the ordinary blocked-reconciliation policy.
4. `repairReadyWork` independently rebuilds each manual/workflow run under the
   bound authority and condition-checks its head. Its returned `ACTIVITY`,
   `RECOVERY`, `TIMER`, or absent expectation must match the inventory.
   Obsolete rows at other keys remain harmless locators and are removed only
   when the worker observes, rebuilds, and supplies that exact stale row.
5. Reconstruction never calls an activity executor, effect adapter, timer
   fire, signal delivery, successor execution, or recovery transition. A later
   worker must rebuild again and win its ordinary fenced claim or continuation
   transition.
6. Reports are deeply frozen and bounded: complete counters, an inventory
   digest, repair totals, and at most 50 redacted samples. Payloads and
   authority identities are excluded.

## Deterministic evidence

The focused matrix currently passes 3 suites and 98 tests. It covers:

- every reconstruction classification and policy, including current and old
  revisions, claimed versus started attempts, timers, signals, blocked and
  terminal runs, and runnable/started effect successors;
- complete-before-mutation validation, two-pass history drift detection,
  exact authority binding, authority loss before inventory and at final
  handoff, and bounded frozen reporting;
- one real Vanilla ledger integration that removes a runnable locator, runs
  reconstruction under an acquired replacement authority, restores the exact
  locator, and strongly rechecks current authority;
- strict supervisor ordering through reconstruction, application-state
  preparation, the captured strong authority recheck, and the resident body,
  including proof that authority loss prevents later phases and a callback
  cannot redirect the final authority assertion; and
- the existing application-state inventory regression matrix after extraction
  to the shared history visitor.

The expanded authority, reconstruction, ready-work, worker, and resilience
matrix passes 8 suites and 294 tests. The complete serial coverage run passes
344 suites and 7,901 tests, with 5 tests skipped, at 84.12% statements, 80.87%
branches, 91.53% functions, and 84.84% lines. Lint, all source/app/test/SEA
type checks, the 373-file package-content check, the provider-boundary check,
and the production dependency audit also pass; the audit reports zero
vulnerabilities.

The default parallel coverage run once exhausted an unchanged retained-storage
persistence test's 30-second timeout under local load. That test passed in
2.7 seconds when isolated, passed again with coverage instrumentation, and the
complete serial coverage run passed it in context. No assertion mismatch or
branch-related failure was observed.

Local validation uses Node `v24.13.1` and npm `11.12.0`. No release, preview,
deployment, live AWS, or publication command is part of this slice.

## Honest boundary

- DynamoDB execution-ledger payload references still name a local filesystem
  payload store. A different node cannot rebuild complete history without the
  same retained payload volume or a new certified distribution boundary.
- The provisioning-retained DynamoDB `tableResourceId` is validated internally
  but is not yet durably distributed to replacement nodes.
- Application-state adoption remains a separate LMDB-only, cross-store
  boundary. This slice fixes its required position but does not implement a
  DynamoDB replacement handoff.
- The local service-ownership session is not a distributed node lease. Trusted
  node enrollment, revision authorization, capability advertisement, and work
  placement remain open.
- Reconstruction repairs locators and encodes policy; it does not automatically
  replay `CLAIMED` work or resolve `STARTED` work. Existing source-free worker
  recovery remains the later transition authority.
- The two passes require admissions and schedule mutation to remain quiescent.
  The internal wrapper does not yet establish that durable barrier, so it is a
  product-activation prerequisite rather than a claim of a global snapshot.
- Assignment, activity-start, managed-effect-settlement, terminal-response-
  loss, and two-node crash proofs remain required before product activation.

## Next handoff

Distribute the exact table and payload identities to an enrolled replacement,
implement and prove the separate application-state handoff, then connect this
internal ordered wrapper to the resident behind the still-closed explicit
DynamoDB gate. Extend deterministic process-boundary coverage before any
two-node or public activation claim.
