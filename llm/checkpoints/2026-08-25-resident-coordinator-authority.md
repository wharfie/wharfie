# Resident coordinator-authority checkpoint

- **Date:** 2026-08-25
- **Status:** **IMPLEMENTED AND LOCALLY VALIDATED**
- **Branch:** `agent/coordinator-authority`
- **Parent before this slice:** `95ed59b` (`Add AWS and Hetzner self-deployment for packaged apps (#145)`)

## Restart summary

This bounded Outcome 2 slice adopts the existing explicit coordinator-authority
kernel in selected production execution paths. The local resident service,
direct durable-submission fallback, and foreground durable-activity host now
acquire one fresh app-scoped authority, bind the execution ledger, and release
that authority before relinquishing local ownership. New manual, workflow, and
managed-effect successor assignments carry the bound epoch.

Source and packaged CLIs now expose exact non-authoritative inspection and a
caller-confirmed takeover path. The operator conditionally replaces the exact
inspected ACTIVE predecessor, then releases its temporary successor with a
deterministic request identity. That two-leg operation fences the predecessor
without leaving an ownerless ACTIVE token, and a normal fresh resident can
subsequently acquire the next epoch.

This is explicit recovery, not automatic failure detection. Heartbeat age,
process reachability, socket state, and caller time do not authorize takeover.

## Production binding

`createExecutionLedger()` now exposes a one-way
`bindCoordinatorAuthority(authority)` view over the same durable stores plus
`getCoordinatorEpoch()`. Rebinding an already-bound view fails. The existing
transaction wrapper still places the exact active-authority condition in the
same table transaction as every ledger mutation.

`withExecutionLedgerCoordinatorAuthority()` owns acquisition, ledger binding,
handler execution, and graceful release. A release that becomes stale after a
deliberate takeover cannot restore old authority and does not mask the primary
handler result. Other release failures remain visible, including as an
aggregate when work and cleanup both fail.

The adopted paths are:

- the LMDB resident service, using its held local-owner session identity;
- direct durable-submission fallback, using the local-owner session when one
  exists and a fresh session identity for a non-LMDB control adapter; and
- foreground durable-activity execution, with the same LMDB/non-LMDB split and
  the existing authenticated cancellation server retained for local ownership.

Authority acquisition completes before the resident becomes READY or a
foreground command server starts. Graceful shutdown closes command admission,
releases coordinator authority, releases local ownership, and then closes the
control store.

## Assignment provenance

Admissions remain coordinator epoch `0` under the execution-ledger v10
contract; their mutation is nevertheless transaction-fenced when the ledger is
bound. New physical assignments now use the bound positive epoch:

- manual invocation claims;
- workflow activity claims; and
- managed-effect successor starts.

Start, settlement, recovery, cancellation, log, effect, and terminal paths
retain the exact epoch recorded on the attempt they are closing. A successor
holding a newer current authority can therefore conservatively settle an older
attempt without rewriting its physical identity.

## Explicit operator contract

Source commands:

```text
wharfie ops coordinator inspect --app-id <app-id> [--json]
wharfie ops coordinator takeover --app-id <app-id> \
  --inspection-file <path> \
  --coordinator-id <temporary-id> \
  --request-id <stable-request-id> \
  --confirm-authority-replacement [--json]
```

Packaged commands derive the application ID from immutable embedded identity:

```text
<app> wharfie coordinator inspect [--json]
<app> wharfie coordinator takeover \
  --inspection-file <path> \
  --coordinator-id <temporary-id> \
  --request-id <stable-request-id> \
  --confirm-authority-replacement [--json]
```

The schema-v1 inspection document is explicitly non-authoritative and contains
the complete verified authority snapshot. Takeover rejects absent, RELEASED,
cross-application, malformed, extended, or no-longer-current observations. It
never infers replacement permission from diagnostic timestamps.

The takeover request identity is stable across retry. A domain-separated digest
of its application, temporary coordinator, and request identity derives the
release request identity, so response loss on either leg can be replayed without
creating a new transition. The receipt names `takeoverAuthority` and
`resultAuthority`; it deliberately does not claim `currentAuthority`, because a
later resident may already have acquired after an exact receipt replay.

## Deterministic proof

The focused tests include these boundaries without timing sleeps:

- a predecessor reaches the ledger transaction barrier, a successor takes over,
  and the delayed predecessor commit fails with
  `CoordinatorAuthorityStaleError`;
- an ACTIVE predecessor prevents resident and foreground startup before work is
  admitted while local ownership still unwinds;
- graceful resident and direct lifetimes leave RELEASED authority records and
  advance monotonically on the next lifetime;
- the exact operator takeover-and-release request replays after later authority
  advancement without claiming it is current; and
- a fresh resident-style acquisition succeeds at epoch 3 after the operator
  fences epoch 1 through its temporary epoch-2 authority.

## Validation status

Validation used the repository's pinned Node 24 toolchain (`v24.13.1`) in the
fresh worktree. Final branch-wide gate results are recorded in the subsequent
[operator and schedule checkpoint](2026-08-26-operator-schedule-authority.md).
The retained focused results for this initial slice are:

- `npm run typecheck` passed source, application implementation, test, and SEA
  verifier configurations.
- The focused coordinator/resident matrix passed 10 suites and 183 tests,
  including core authority transitions, ledger fencing, operator commands,
  resident and foreground lifecycles, manual/workflow runners, managed-effect
  successors, packaged CLI composition, and documented command surfaces.
- `npm run verify:package` verified all 360 files in the packed npm artifact.
- `git diff --check` passed.

No provider-backed lease, native external integration, systemd/Lima lifecycle,
or two-node recovery proof was run or is claimed by this slice.

## Honest boundary

The standalone-operator and same-table scheduling exclusions below describe
this initial slice. They are closed by the subsequent
[operator and schedule authority checkpoint](2026-08-26-operator-schedule-authority.md).

- This is not runtime-wide authority adoption. Standalone mutating commands in
  `execution-ledger-operator.js` still construct unbound ledgers.
- Schedule occurrence ledger writes are fenced when they receive the bound
  ledger, but schedule-control activation and cursor-only advancement retain
  only local-owner fencing.
- Application-state writes remain outside the coordinator-authority transaction
  domain and need a destination-local fence before they can inherit this claim.
- A stale process may continue computing or performing physical work. It cannot
  commit through the bound execution ledger after replacement; immutable
  payload publication before a rejected transaction can leave harmless orphan
  bytes.
- A crashed ACTIVE coordinator blocks normal acquisition until a human or
  higher-level operator inspects evidence and explicitly confirms takeover.
- Diagnostic heartbeat fields are not a lease. There is no automatic expiry,
  renewal, store-authoritative clock, reconstruction proof, or two-node proof.
- Same-volume LMDB tests establish local transaction fencing, not recovery after
  loss of the host or volume.

## Next work

1. Bind or deliberately exclude every standalone mutating execution-ledger
   operator path.
2. Compose authority into same-table schedule-control transitions and finish
   coordinator provenance only where history makes that claim.
3. Add fail-fast current-authority checks at safe resident boundaries so a
   taken-over process stops polling promptly; keep transaction fencing as the
   safety boundary.
4. Define a provider-certified semantic lease with store-authoritative time and
   an atomic expiry predicate before adding automatic takeover.
5. Reconstruct runnable, in-flight, blocked, and terminal work after replacement
   and then prove one trusted two-node recovery sequence.
