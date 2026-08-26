# Operator and schedule authority checkpoint

- **Date:** 2026-08-26
- **Status:** **IMPLEMENTED AND LOCALLY VALIDATED**
- **Branch:** `agent/coordinator-authority`
- **Preceding slice:** [Resident coordinator authority](2026-08-25-resident-coordinator-authority.md)
- **Following slice:** [Application-state destination authority](2026-08-26-application-state-authority.md), with its separate fencing boundary and validation record.

## Restart summary

This bounded continuation closes the standalone execution-ledger operator and
same-table resident scheduling gaps from the preceding slice. It adds no
automatic takeover, lease, or application-state fencing. Low-level store
factories remain explicitly bindable; the guarantee belongs to the production
paths that supply authority.

## Direct operator lifetimes

All five direct mutation scopes in `execution-ledger-operator.js` now use the
existing authority lifecycle helper:

1. offline workflow cancellation;
2. run recovery, including stopped attempts and managed-effect successors;
3. evidence-backed run reconciliation;
4. managed-effect reconciliation; and
5. effect-successor retry, including authorization, execution, and exact retry.

For LMDB, local ownership is acquired first and its session ID identifies the
coordinator. Other adapters receive a fresh session identity without claiming
local exclusion. Authority release finishes before local ownership and store
cleanup. An existing ACTIVE coordinator blocks acquisition; these commands do
not implicitly take over or retry with another epoch.

Read-only preflight retains the absent-store/no-create behavior and existing
confirmation checks. Cancellation routed to a resident remains transport-only:
the receiving resident commits through its already-bound ledger. Cancellation
also retains its existing redacted non-delivery result on an authority conflict;
the other direct scopes expose the authority conflict.

## Same-table schedule fencing

`createScheduleControl()` accepts an optional normalized authority token. All
five activation/advance transaction sites add its exact active-authority
condition alongside the existing local-owner, application-admission, and
cursor checks. This includes condition-only validation transactions. Mutating
calls reject cross-application authority before reading or writing a cursor.

The execution ledger exposes its immutable token through
`getCoordinatorAuthority()`. The resident schedule observer derives its binding
from that exact token rather than a separately configurable token. A
currentness probe also runs at the observer boundary, including passes with no
new minute or no due work. That read is only fail-fast behavior; the
same-transaction condition is what makes delayed stale writes fail.

Prepared workflow admissions retain their optional authority in private
metadata. Both resolution and reconciliation require a bound preparation to
be consumed by a ledger carrying the same stable token, even on an existing
run replay. The execution ledger supplies that context in every create/replay
branch. Unbound preparations remain compatible with bound ledgers.

The prepared transaction material does not add another authority condition.
The consuming ledger adds exactly one, so the combined cursor, occurrence,
workflow, history, and ready-work transaction never operates twice on the
authority item. This preserves the same-item restriction of DynamoDB
transactions.

## Replay and takeover contract

An exact retained workflow/occurrence result can be read through its original
binding after authority replacement without another write or a claim of
currentness. A mismatched or missing consuming token cannot use that prepared
result, including the unbound replay path that otherwise repairs ready work.

Cursor advancement also preserves an exact already-durable requested cursor
after an ambiguous response, before diagnosing stale authority. A broader
readback or fresh condition-only validation still requires the current token.
Successful writes are not followed by a currentness read that could hide a
result accepted immediately before takeover.

Admissions retain the existing v10 epoch-zero event contract. This slice
enforces current authority transactionally; it does not rewrite stored history
or claim new scheduling provenance.

## Validation

Focused regression coverage includes:

- ACTIVE-conflict rejection in each of the five direct operator scopes;
- authority release on success and handler failure, fresh monotonically
  increasing epochs on exact retry, and bound successor assignment;
- no authority acquisition for missing-store preflight or resident-routed
  cancellation;
- delayed schedule activation and cursor advancement losing to explicit
  takeover while local ownership remains held;
- prepared create and replay rejecting missing or different consuming tokens;
- a delayed combined workflow/occurrence admission leaving every projection
  unchanged after takeover;
- exact old-token replay remaining write-free; and
- resident schedule activation, due admission, and empty-window advancement
  carrying one authority condition, with no-work observation stopping after
  replacement.

Validation uses the pinned Node `v24.13.1` and npm `11.12.0`:

- Full source, application, test, and SEA-verifier typechecks pass.
- Full ESLint and JavaScript/JSON Prettier checks pass.
- The separate non-coverage full run passes 314 suites and 7,012 tests, with
  one suite and five tests intentionally skipped, and exits normally.
- The focused operator suites pass 35 tests; the combined schedule suites pass
  58 tests.
- The public coordinator-handoff helper passes 40 tests, including exact
  inspection-file reuse, command-intent reuse, pre-command SIGKILL/ownership
  guards, receipt drift, and failure-cause preservation. The existing inspector
  and abstract schedule-restart harness suites pass another 21 tests.
- Full coverage passes 314 suites and 7,012 tests, with one suite and five tests
  intentionally skipped. Coverage is 83.95% statements, 80.78% branches, 91.35%
  functions, and 84.68% lines, all above the configured thresholds.
- The coverage run reported one forced worker-exit cleanup warning. A focused
  `--detectOpenHandles` run across ten affected suites passes all 179 tests,
  exits normally, and reports no retained handles. The full-run warning is
  recorded, not claimed fixed.
- Package-content verification passes for all 360 packed files.
- The generated and relocated Darwin SEA gate passes, including real SIGKILL
  boundaries, explicit coordinator handoff, exact replay, and response-loss
  recovery. The Linux-only real schedule/restart proof remains gated and was
  not run on this host.

`git diff --check` also passes. These results cover the uncommitted
`agent/coordinator-authority` worktree; the original dirty checkout was not
modified.

The initial relocated-SEA gate exposed an older crash-test assumption: recovery
was attempted directly after a killed coordinator left ACTIVE authority. Its
proof handoff now uses the public exact inspection and confirmed takeover
commands after verifying that the predecessor was killed. It reuses the exact
inspection file and request for receipt replay. Response-loss crashes after
graceful cleanup only inspect and preserve the unchanged RELEASED snapshot.
Successor proof assertions retain the originating attempt's epoch across later
operator lifetimes. None of this introduces automatic runtime replacement.

## Remaining boundary

- Application-state mutations require a destination-local fence and remain
  outside this claim.
- Unbound low-level stores and caller-supplied low-level helpers do not acquire
  authority automatically.
- A replaced process may keep computing or performing physical external work;
  fencing prevents its authoritative commits through the bound stores.
- A crashed ACTIVE authority still requires exact inspected, explicitly
  confirmed operator takeover. Diagnostic heartbeat age is not a lease.
- There is no provider-certified lease, store-time expiry, renewable authority,
  automatic failover, or two-node recovery proof in this slice.
- Local-store and mocked-adapter evidence does not prove recovery after host
  or volume loss. Native external, systemd/Lima, and live-cloud proofs are not
  part of this validation.

The next independent design work is destination-local application-state
fencing and the provider-certified semantic lease, followed by replacement
reconstruction and a trusted two-node recovery proof.
