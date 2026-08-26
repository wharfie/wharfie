# Application-state adoption before resident readiness

Date: 2026-08-26

Status: complete, validated, and revalidated on the current hardened tree.

Follow-up: the
[explicit crash/reboot and partial-handoff proof](2026-08-26-coordinator-readiness-systemd-proof.md)
now exercises the real-process and VM boundaries identified below. Its current
hardened snapshot is `a13e21e2a07fea6c0a66b6965921d871ad8c792f`. This checkpoint
retains its original validation results as historical evidence and records the
superseding current-tree gates separately.

This continues
[destination-local coordinator fencing](2026-08-26-application-state-authority.md)
on `agent/coordinator-authority` in the `coordinator-authority` worktree. It
preserves the earlier authority, operator, schedule, and application-state
changes already in that worktree. No commit or deployment is implied.

## Bounded outcome

A replacement local resident cannot start scheduling, accept owner commands,
or publish READY until it has adopted the exact application-state destination
required by retained history and any existing primary-store pin. READY's
control transaction checks both that adoption and the same current coordinator
token. Interrupted adoption is durable and resumable by a fresh coordinator.

This is one configured LMDB application-state v2 / primary destination per
application, with independent retained control and application volumes. It is
not an atomic transaction across those stores, automatic failover, or recovery
after either volume is lost.

## Implementation

### Control-side primary-store pin

`src/core/lib/db/tables/application-state-readiness.js` adds a strict flat
schema-v1 control record at the typed
`application-state-readiness/v1/primary` sort key. It contains:

- the exact normalized destination: kind, version, binding, provider, store
  identity, table, and application namespace;
- the captured stable coordinator tuple;
- PREPARING or ADOPTED status;
- the expected destination-authority record digest and its own record digest.

The destination identity is immutable across epochs. Prepare and acknowledge
adoption compare the active coordinator fence and exact readiness predecessor
in the same control transaction. PREPARING is limited to genuine first use or
recovery of retained pre-adoption progress; a higher fresh epoch may resume it
for the same destination. Once ADOPTED exists, `prepare` cannot replace that
confirmed record with PREPARING.

The retained ADOPTED record is a verified destination-authority floor. The
runtime accepts the exact retained barrier or a structurally valid strictly
higher current barrier, and rejects absence, rollback, or a different token at
the same epoch. It adopts the current token against the exact observed
destination predecessor before conditionally advancing the exact retained
control record directly from ADOPTED to ADOPTED. Exact same-token ADOPTED replay
is read-only and requires current authority. Neither path may select a
replacement store, reset an epoch, or rebase an ambiguous write onto a
different predecessor; ambiguous responses use exact readback.

ADOPTED requires a strict destination barrier matching the exact store,
application, and coordinator token. The runtime owns opening and independently
reading that destination; the control kernel does not claim to transact across
stores or authenticate arbitrary untrusted caller-supplied records.

### Resident startup ordering

`src/core/runtime/application-state-readiness.js` implements the orchestration:

1. Capture the exact bound ledger token and verify current control authority.
2. Read any retained primary pin, list every application run-directory page,
   and rebuild every run across revisions and statuses. Include every effect
   destination and every authorization-only effect-successor trigger contract.
3. Refuse conflicting identities, unsupported destinations, routing mismatches,
   corrupt/incomplete rebuilds, duplicate runs, and non-advancing pagination.
4. For a known destination, verify identity through a read-only handle before
   writable opening. Never create a missing pinned root or identity.
5. Open the separate writable destination and recheck its identity. Genuine
   first use with neither history nor a pin may atomically bootstrap identity
   and its initial destination barrier before creating the control pin.
6. With no retained ADOPTED floor, save or resume PREPARING, adopt the captured
   destination token, read its exact barrier, and save ADOPTED under current
   control authority. With retained ADOPTED state, first verify its destination
   floor, adopt the captured token, and then advance the exact predecessor
   directly from ADOPTED to ADOPTED without publishing PREPARING. Close the
   destination handle before returning the adopted record.
7. Only then construct the resident worker, its schedule observer, and command
   endpoint. Publish READY using exact readiness, coordinator, and lifecycle
   conditions in one control transaction.

`ledger-service-lifecycle.js` accepts an optional validated ADOPTED snapshot for
READY only. It snapshots caller input, requires the exact application service
and coordinator/local-owner session, and diagnoses current authority and
readiness for bound READY replay. STARTING, STOPPING, and STOPPED are not
coordinator-fenced: a session that lost authority must still close its own
resources. The production resident assembly always supplies this guard;
low-level unbound lifecycle construction remains explicit compatibility scope.

### Later foreground and operator writes

`resolveApplicationStateWriteBinding` reads the immutable pin without acquiring
authority or adopting a destination. All three production writable catalog
paths use it: the durable activity host, destination reconciliation, and
managed-effect successor retry. PREPARING is rejected because it confirms no
destination barrier. ADOPTED returns both the exact store identity and its
reconstructed destination-authority floor. Read-only preflight and later
catalog adoption accept the exact floor or a structurally valid strictly higher
current barrier, while absence, rollback, or a different same-epoch token fails
closed. A retained effect destination must agree with the binding.

`resolveApplicationStateExpectedStoreId` remains an identity-only compatibility
projection for read-only callers; writable callers must preserve the complete
binding.

Review caught that checking only inside `executeAttempt` was too late for
foreground execution: a missing root could be created and the ledger could
reach STARTED without running authored code. The shared read-only
`preflightApplicationStateStoreIdentity` now runs during dispatch preparation
for a known pin, before writable open or STARTED. Failure abandons the unstarted
claim and leaves the invocation retryable. After dispatch authorization, the
host still rechecks the captured pin and current full authority before catalog
adoption. Initialization of genuinely new application data remains behind
durable STARTED for ordinary foreground execution.

## Interruption and replacement

| Interruption                                                     | Retained truth                                                            | Next allowed action                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before a known destination passes identity preflight             | Existing pin/history only; destination unchanged                          | Restore the exact retained volume or correct routing; do not bootstrap                                                                                                     |
| After PREPARING, before destination adoption                     | Immutable pre-adoption pin with old/local barrier                         | Fresh current authority prepares the same pin and adopts a higher token                                                                                                    |
| After destination adoption on the PREPARING path, before ADOPTED | PREPARING plus the committed higher destination barrier                   | Read the exact barrier and acknowledge under current authority; a new session may resume the same pre-adoption path with its own token                                     |
| During replacement of retained ADOPTED state                     | The old ADOPTED floor remains confirmed while destination adoption occurs | Accept only the exact floor or a structurally valid strictly higher current barrier, adopt the current token, then conditionally advance exact ADOPTED directly to ADOPTED |
| After ADOPTED, before READY                                      | Adopted destination, no readiness publication                             | Current same-token retry may finish; a fresh session uses the retained floor and direct ADOPTED-to-ADOPTED handoff at its higher epoch                                     |
| Control takeover races adoption acknowledgement or READY         | New control token wins; old control write fails                           | New coordinator resumes; old cleanup never lowers the destination barrier                                                                                                  |
| After an ungraceful process exit                                 | ACTIVE authority may remain                                               | Inspect and explicitly takeover-and-release, then acquire a fresh resident session                                                                                         |

Normal shutdown releases the exact current control authority and local owner,
not the application-state barrier. Permanent values, receipts, negative
dispositions, and ledger event history remain unchanged by handoff. A READY row
is historical evidence after later takeover, not perpetual authority or proof
of process liveness.

## Proof coverage

- Control kernel matrix over vanilla and mocked DynamoDB: exact flat records,
  immutable pins, full-token control guards, stale-write races, readback after
  response loss, idempotent current replay, corruption, and input snapshots.
- Readiness inventory tests: complete pagination, terminal and cross-revision
  history, successor-only contracts, conflicting destinations, malformed
  history, cancellation, and read-only expected-store lookup.
- Lifecycle matrix: both exact READY guards share the lifecycle transaction;
  stale/mixed sessions and changed adoption records cannot publish or replay
  readiness; cleanup remains possible after takeover.
- Real separate LMDB roots: interruption before destination adoption and before
  control acknowledgement, explicit fresh-authority resumption, response loss,
  both stale-A races, unchanged historical receipts, and missing/replaced
  destination refusal with and without a registry.
- Production resident assembly: real idle READY/stop/restart, exact identity and
  barrier retention, paused adoption with neither scheduling nor command
  listener, cancellation/failure cleanup, and missing/replaced store refusal.
- Production foreground assembly: missing/replaced stores fail before STARTED,
  preserve retryability and absence, release ownership/authority, and finish
  the same logical request after the original store is restored. Only physical
  authored-function invocation is mocked in these tests.
- Packaged proof assertions use the installed tarball's contracts and only
  read-only handles to pre-existing, physically separate LMDB volumes. Every
  live READY checkpoint verifies exact current authority, ADOPTED pin,
  destination identity/barrier, local ownership, and final control/lifecycle
  readback. Restart retains the same destination and advances the token. The
  assertion helper has 29 focused positive/negative tests; the complete Darwin
  generated/relocated SEA proof also passes with these assertions enabled.

## Validation

### Original checkpoint validation (historical)

All commands use the pinned Node 24.13.1 runtime.

- Focused runtime regression with `--runInBand --detectOpenHandles`: 13 suites,
  451 tests passed in 32.492 seconds, normal exit with no open-handle report.
- Inventory/host callsite pass: 2 suites, 55 tests. Native foreground pin
  integration: 3 tests with handle detection. Packaged assertion helper: 29
  tests. These counts overlap the broader regression suite; do not sum them as
  a distinct test total.
- `npm run lint`: passed, including repository-wide formatting.
- `npm run typecheck`: all four source/application/test/SEA-verifier checks
  passed after final code edits.
- `npm run verify:package`: passed, 364 package files.
- `npm run verify:package:sea`: passed, including the existing real SIGKILL,
  explicit takeover-and-release, effect/successor/workflow recovery, source and
  generated CLI, relocation, and Node-absent PATH gates. New exact application-
  state adoption assertions ran at every live READY checkpoint. The due-
  schedule/restart proof remains correctly gated to Linux and was not rerun on
  this Darwin host. The verifier removed its owned temporary artifacts.
- Verified Darwin artifact: 155,506,160 bytes;
  SHA-256 `6ee2a2dcb906e1ac2afbec857e028bb7014cf5d2836d8ba83211fec3eb27005f`.
- Final whole-repository coverage passed on its first run, alone with two workers:
  `npm run test:coverage -- --maxWorkers=2 --reporters=default --coverageReporters=text-summary --coverageReporters=json-summary`.
  323 suites / 7,388 tests passed; 1 suite / 5 tests skipped, with the existing
  opt-in skip policy unchanged. Normal exit 0 in 764.938 seconds. Coverage:
  statements 84.07%, branches 80.87%, functions 91.44%, lines 84.79%; all
  repository thresholds passed.
- Final `git diff --check`: passed. The final independent read-only protocol
  review found no further actionable issues after the foreground preflight fix.

Early local checks caught only test-fixture typing/assertion issues and
formatting while concurrent test work was still in progress. They were fixed
before these final gates; no behavioral assertion or timeout was weakened.

### Current hardened-tree validation

The original results above remain intact as point-in-time evidence. The current
tree supersedes their gate and artifact status with the following results:

- `npm run test:ci` passed 328 active suites and 7,578 active tests in 755.272
  seconds; 1 suite and 5 tests remained skipped under the existing policy.
  Coverage passed at 84.06% statements, 80.89% branches, 91.45% functions, and
  84.79% lines. The package verifier accepted 364 package files, and the
  production dependency audit reported 0 vulnerabilities.
- The isolated same-token adoption-race regression passed 15 of 15 tests.
- The locally packed magnetic proof passed its explicit retained-inspection and
  confirmed takeover-and-release journey before exact named-run resumption.
- Darwin SEA verification passed with a 155,538,992-byte artifact whose SHA-256
  is `1e085d1f20b43e6bdfef481beef54d26fff4f236b97fc7d9e7ba2ac385265cf2`.

## Remaining boundaries and next work

- The barrier revokes old destination writers only when the successor adopts
  it. Control takeover still has an intervening window. READY now comes after
  that adoption, not before it.
- Inventory assumes intact atomic run-directory/history writes and stopped
  legacy writers. It cannot discover deleted or unindexed historical rows or
  retrospectively fence old binaries. Every startup scans all retained history
  in pages of at most 100, so startup cost grows with history.
- Foreground paths before the first resident pin retain their prior explicit
  effect-store checks; they do not independently inventory and register all
  historical destinations.
- The complete authority lineage and both stores must be retained. Foreign
  control lineage, reset, rollback, missing-volume reconstruction, barrier
  deletion, mixed-old-binary operation, and arbitrary multi-destination handoff
  are not supported.
- Mocked DynamoDB verifies the control transaction semantics, not live provider
  certification. The production readiness destination remains LMDB.
- The former next real-VM crash/reboot proof is satisfied by the sibling
  [coordinator-readiness systemd checkpoint](2026-08-26-coordinator-readiness-systemd-proof.md)
  at hardened snapshot `a13e21e2a07fea6c0a66b6965921d871ad8c792f`; its full receipt
  table remains there and is not duplicated here. Automatic takeover still
  needs a provider-certified semantic lease, and multi-node recovery remains a
  later outcome.

No external infrastructure was changed and no authority was inferred from
heartbeat age, process reachability, or message silence.
