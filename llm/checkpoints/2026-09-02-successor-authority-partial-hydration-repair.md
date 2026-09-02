# Successor-authority partial-hydration repair checkpoint

- **Date:** 2026-09-02
- **Status:** **INTERNAL STALE-RECEIPT REPAIR COMPLETE; ACTIVATION NO-GO**
- **Decision:**
  [ADR 0042](../../docs/architecture/decisions/0042-successor-authority-partial-hydration-repair.md)

## Restart summary

The retained incomplete hydration-recovery receipt is no longer a permanent
internal liveness boundary after its original authority or `CLOSED` barrier
becomes stale. Ordinary recovery still refuses to reinterpret the old `washr1`.
A separate read-only inspection and literally confirmed successor repair now
preserve it unchanged, retain a stable `washrr1` repair identity, and append one
`washrra1` authorization for each exact current authority and barrier that
continues the operation.

The stable repair never becomes stale authority. A later coordinator takeover
creates a fresh integrity-bound inspection and, while repair remains incomplete,
appends authorization for the same repair and resumes from the exact retained
filesystem phase. A physically completed repair is instead reverified read-only
under the current scope. Repair-specific target and claim retirement paths
preserve the old receipt's missing evidence as missing. Registry projection
reports both the raw incomplete old receipt and its exact logical resolution.

This closes only the explicit stale-receipt repair requested by the replacement
roadmap. It does not activate the public DynamoDB resident, authorize nodes or
revisions, place work, create a node lease, or prove machine-loss recovery.

## Exact inspection and authorization

Inspection requires one canonical raw-incomplete `washr1` in
`RECOVERY_RECORDED` or `TARGET_REMOVED`, the exact current coordinator authority,
its exact durable `CLOSED` barrier, unchanged central publication, no activation,
and the same transport, store root, physical replica, receipt file, target, and
claim identities. The current scope must be causally newer than the receipt's
scope. Same-scope ordinary recovery remains the correct operation and is not
eligible for repair.

Mutation requires the exact frozen `washrri1` inspection and literal
`confirmStaleHydrationRecoveryRepair: true`. It synchronizes the stable repair
receipt, then synchronizes the exact-current authorization before any canonical
rename. Current control scope is checked again immediately before each physical
step and on successful return.

Authorization receipts are retained provenance, not leases. Once their authority
or barrier is stale, they cannot authorize another step. A later exact successor
appends a new authorization to an incomplete repair rather than overwriting
history or creating a nested repair receipt. If the repair is already physically
complete, exact replay remains read-only and remains available at authorization
capacity.

Authorization capacity is enforced by canonical slots `000` through `127`, not
by a read-then-append count. Each synchronized private candidate competes for a
fixed slot with one atomic hard link; an occupied slot is validated before the
caller rechecks current scope and tries the next. The registry rejects gaps,
aliases, and duplicate identities or scopes, so overlapping authorities cannot
create an immutable 129th receipt and brick later inspection.

## Physical and registry result

For `RECOVERY_RECORDED`, the exact active empty target is atomically moved into
the repair's retained target path. For `TARGET_REMOVED`, the exact old retired
target remains where the old receipt placed it. In both cases, the exact active
claim moves into the repair's retained claim path. Source-exact/destination-
absent and source-absent/destination-exact are the only accepted transitions.

The original receipt remains physically incomplete. A completed, fully verified
repair overlays it as logically resolved so the next exact hydration claim may
begin. Older completed receipts, the stale receipt, repair, authorizations, and
retired filesystem objects remain present. The independent 128 ordinary-receipt
capacity remains unchanged, and no repair artifact is compacted or collected.

## Process-death evidence

The Unix real-process matrix starts from both stale raw states and kills an
independent repair process after each durable repair boundary: repair receipt,
current authorization, target retirement, and claim retirement. After every
kill, the parent reopens control and filesystem state, takes authority again,
adopts the retained `CLOSED` barrier, proves the stale caller cannot continue,
and freshly inspects the same repair identity. An incomplete repair persists
the new authorization and resumes; the already claim-retired case performs
exact read-only completion verification.

Exact replay retains publication and the closed barrier, creates no activation
before repair completion, and never duplicates or rewrites old evidence. Once
repair is complete, ordinary snapshot transport hydrates the intended replica;
the existing one-shot activation rule still rejects another physical replica.

## Validation

Validation uses the pinned Node `24.13.1` and npm `11.12.0` toolchain.

- The expanded replacement-input lane passes 19 suites and 397 tests in
  167.007 seconds.
- The dedicated open-handle process-death lane passes 4 suites and 23 tests in
  67.106 seconds.
- The adapted LMDB unit suite passes 107 tests, including the intercepted
  127-to-128 authorization-slot race. The partial-hydration Unix real-process
  suite passes 17 tests, including the 2×4 SIGKILL matrix.
- Lint, JavaScript/JSON formatting, source, app, test, and SEA-verifier
  typechecks, and diff hygiene pass.
- The package verifier accepts 382 files. The provider boundary passes at 158
  production packages against a cap of 170, 59,869,240 logical bytes against a
  cap of 89,128,960, and zero provider SDK graph inputs.
- The configured moderate production-audit gate passes. The registry currently
  reports one low-severity `postcss-selector-parser` advisory.

Repository-wide instrumented runs on this Darwin host hit unchanged
five-second integration-test deadlines only under aggregate load. The two
unchanged suites from the normal two-worker attempt pass together at 46 tests;
the unchanged ready-work suite from the serial attempt passes all 40 tests alone
under coverage instrumentation. The pull request's normal hosted CI is the
aggregate merge authority.

## Activation decision and next handoff

The activation-readiness decision remains **NO-GO**. The stale-receipt repair
blocker is closed internally, but public automatic replacement still requires:

- trusted-node enrollment;
- exact per-application-revision execution authorization;
- finite capability advertisement and compatible placement;
- a fenced node lease; and
- bounded two-node machine-loss evidence.

No release, deployment, publication, promotion, live-provider run, public gate
change, or cloud resource mutation is part of this checkpoint.
