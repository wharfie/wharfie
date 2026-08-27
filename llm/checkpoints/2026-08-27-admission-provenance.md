# Durable coordinator admission provenance checkpoint

- **Date:** 2026-08-27
- **Status:** **IMPLEMENTED AND FOCUSED-VALIDATED**
- **Branch:** `agent/admission-provenance`
- **Base:** `89ce01c`
- **Decision:** [ADR 0036](../../docs/architecture/decisions/0036-durable-coordinator-admission-provenance.md)

## Restart summary

New authority-bound logical admissions now retain the complete stable
coordinator token without changing the version 10 attempt-fence namespace.
The bounded writers are manual-run creation, workflow-run creation, scheduled
occurrence/workflow admission, and both records of an atomic managed-effect
successor handoff. Exact retry after takeover returns the retained original
token because provenance is not part of semantic request identity.

Absence remains the exact legacy/unbound meaning. There is no backfill,
current-authority inference, cursor provenance field, lease, automatic
takeover, reconstruction policy, or global version 11 namespace in this
slice.

## Durable contract

- Creation events accept an optional strict `coordinatorAuthority` payload.
  Bound writers persist it while their existing event fence remains
  `coordinatorEpoch: 0`.
- Schedule occurrence schema version 2 requires the same token as
  `coordinator_authority`; schema version 1 remains the strict no-token legacy
  shape. An unbound preparation consumed by a bound ledger rewrites only its
  uncommitted occurrence row to version 2.
- Scheduled occurrence and workflow creation tokens must agree exactly. Both
  successor handoff events must also agree exactly. Missing-on-one-side,
  malformed, application-mismatched, or different tokens fail closed.
- A fresh higher-authority schedule control can re-prepare a retained logical
  occurrence. Its bound ledger returns the original admitting token without a
  write.
- Internal admission results and low-level folded history retain provenance.
  The public operator projection adds no authority field and redacts the token
  across manual, workflow, and successor cases.

## Validation

Pinned Node `v24.13.1` focused tests pass:

- `execution-ledger-coordinator-authority.test.js`: 10 tests;
- `schedule-control.test.js`: 31 tests;
- `schedule-workflow-admission-cutover.test.js`: 10 tests; and
- `managed-effect-successor-lifecycle.test.js`: 12 tests.

The 63 passing tests cover bound and unbound events, initial and
higher-authority replay results, the unbound-preparation/bound-consumer rewrite,
strict occurrence v1/v2 reads, malformed v2/v1 and application mismatch,
atomic schedule/event agreement, atomic successor pair agreement, and public
redaction.

After `npm ci` under Node `v24.13.1` and npm `11.12.0`, full `npm run lint` and
full `npm run typecheck` pass. The four focused suites also pass together
in-band: 4 suites and 63 tests in 12.619 seconds. Prettier and
`git diff --check` pass. A describe-qualified run of the modified version 10
unbound-admission test passes both DynamoDB and vanilla cases (2 tests, 148
skipped) in 1.406 seconds.

The broad `execution-ledger.test.js` process and a combined five-file process
were not used as acceptance evidence: the broad file and its exact-name rerun
both exit 134 during LMDB startup with the known managed-mac allocator issue
and emit no assertion failure. The four focused suites above each exit
normally.

The implementation anchors at this checkpoint are:

- `execution-ledger.js` SHA-256
  `d3db291a7b675cf3f0cb07940613bd1303452b244fbf7f3e0252fa202d1b3a6b`;
- `schedule-control.js` SHA-256
  `540a96159ea8b9e85e9c3e08b88f39a1983b35e6004d35b606bae0f1fe8233e9`;
  and
- ADR 0036 SHA-256
  `19ef20e16b4c62603f63e2dd61a21564829d903fd1f5c4f113d59fa9a59e8cbf`.

## Handoff boundary

This branch does not touch `release-v0.0.15`, push a remote branch, add leases,
perform automatic takeover, migrate history, or expose coordinator identifiers
through public operator history. The next independent Outcome 2 work remains a
provider-certified semantic lease followed by replacement reconstruction and
crash-boundary proof.
