# Resident DynamoDB authority-supervisor checkpoint

- **Date:** 2026-08-28
- **Status:** **INTERNAL RESIDENT SUPERVISOR CERTIFIED; PRODUCT GATES CLOSED**
- **Branch:** `agent/resident-dynamodb-authority-supervisor`
- **Source base:** `bfff562cec98e7964e3b300d4a760e9a6c11d2f2`
- **Decision:** [ADR 0037](../../docs/architecture/decisions/0037-single-region-dynamodb-rvn-coordinator-replacement.md)

## Restart summary

This slice composes ADR 0037's single-Region DynamoDB RVN primitive into one
bounded internal resident authority lifecycle. An explicitly configured
supervisor acquires or observation-takes over one application authority,
retains one stable token for every protected ledger mutation, advances only
the full renewable snapshot, renews while the handler drains, fails closed on
authority loss, and releases the latest exact snapshot after the handler
settles.

This is deliberately not product activation. Existing resident, submission,
workflow, recovery, and application-state gates remain LMDB-only. The new
helper has no production call site. Ledger reconstruction, replay policy,
cross-store handoff, and multi-node recovery remain the next Outcome 2 work.

## Certified construction boundary

- The profile is opt-in as `dynamodb-rvn-v1`; merely selecting DynamoDB does
  not enable replacement. Region, table, renewal cadence, and observation
  window are resolved once. Timers are positive, bounded by Node's timer
  limit, and the observation window must exceed the renewal interval.
- A private adapter capability calls `DescribeTable` through the exact raw
  service client already owned by the open DynamoDB ledger wrapper. Copied,
  unrelated, or closed wrappers cannot recover that capability.
- Topology validation requires the exact table ARN Region and resource name,
  `ACTIVE` status, the `run_id`/`sort_key` string key schema, and no replicas,
  Global Table version, witnesses, or multi-Region consistency metadata.
- A separate private execution-ledger capability retains the exact DB object,
  table name, original authority binder, and bound state. The resident helper
  rejects copied, unrelated, differently scoped, or already-bound ledgers and
  invokes the retained one-use binder rather than a mutable public method.
- All caller-owned routing, identity, timing, protocol, and handler inputs are
  read once before validation and use. Accessor or dependency mutation cannot
  split provenance, protocol construction, topology proof, supervision, and
  ledger binding across different clients or tables.

## Supervisor safety and cleanup contract

1. Acquisition and takeover retain one exact request identity across ambiguous
   outcomes. A durable historical receipt is never admission evidence: the
   supervisor strongly reads current authority and requires an exact full-
   snapshot match before invoking the handler.
2. A contender uses only the protocol's strongly consistent, full monotonic
   observation window and retained takeover closure. Wall time, heartbeat age,
   message silence, and DynamoDB TTL never grant authority.
3. The handler receives one immutable stable authority token. RVN renewals
   update only the supervisor's retained full snapshot, so already-admitted
   fenced work keeps the same transaction capability.
4. External cancellation reaches the handler while renewal continues through
   drain. If cancellation intersects an ambiguous startup write, handler
   admission stops but the exact retained pre-cancellation intent keeps
   replaying until definitively ordered. Any authority that replay proves or
   creates is released; no fresh request identity is introduced.
5. One unprovable, stale, conflicting, or otherwise invalid renewal after the
   exact retained retry aborts the handler signal with
   `WHARFIE_RESIDENT_COORDINATOR_AUTHORITY_LOST`.
6. Release uses one immutable receipt-backed intent across opaque retries.
   Stale release means a successor already fenced the owner; known domain
   conflicts are terminal. Cleanup cannot restore old authority.

## Deterministic validation

The final focused command passed 10 suites and 189 tests. It covers the
supervisor, exact ledger wrapper, topology validator/provider, private adapter
capability, DynamoDB RVN protocol, authority store, configuration, operator
routing, and live-proof driver.

| Boundary | Result |
| --- | --- |
| Historical acquisition/takeover receipts | Rejected until exact current strong-read proof; identities rotate |
| Ambiguous startup plus cancellation | Exact retained intent settles after a non-owned read; proven/created authority released; handler never starts |
| Renewal and drain | Stable token retained; latest full snapshot renewed and released |
| Authority loss | Handler signal aborted; stale fenced mutation rejected |
| Opaque release outcomes | Same immutable intent retried; terminal domain errors not retried |
| Construction provenance | Copied, different-client, different-table, already-bound, and accessor-drift inputs rejected or pinned |
| Topology | Wrong Region/name/schema/status and replica/global metadata rejected |
| Live-proof fidelity | Both exact data clients validate identical topology before protocol construction; failed checks settle before cleanup |

Local validation at this checkpoint used Node `v24.13.1` and npm `11.12.0`:

- `npm run lint`: passed with zero warnings; Prettier check passed.
- `npm run typecheck`: all source, app, test, and SEA-verifier programs passed.
- Focused Jest matrix: 10 suites, 189 tests, all passed.
- `npm run verify:package`: passed with 371 packaged files.
- `npm run verify:provider-boundary`: passed with zero provider SDK graph
  inputs, 158 core production packages, and 205 packages with the optional AWS
  companion.
- `npm run audit:prod`: passed with zero vulnerabilities.
- `git diff --check`: passed.

Relevant SHA-256 digests:

```text
66193447127435b4b91bd11a3c511fef96921d664a4c41826b2cb69ba1e0ca85  src/core/runtime/services/resident-coordinator-authority.js
d73d0bbba5b4a0f0409b6fd71af33b66b5ed9837131c3f75eaeba5c7797a3630  src/core/runtime/dynamodb-coordinator-authority-topology.js
6b01ebccc9b06d0b9afb5c83dfcc8e7297db572d90ed51459773270859ff5669  src/core/runtime/dynamodb-coordinator-authority-topology-provider.js
9f24c182dd7f400f13e1c98ff09f4437835bf714f1d76423a140d9f59aaec62e  src/core/runtime/operator/execution-ledger-store.js
d8a3829e57b6c12caf2a403bc5c8392cbc4e63b0efa10605f7004bd1016c6be1  src/core/lib/db/adapters/dynamodb.js
ec99f8c24dd3c3fe13d9a9165b6cbfe8cf3c7fb6b6d95345be4d7e62f2a3009a  src/core/lib/db/tables/execution-ledger.js
52ccc5608ef6b752858b8c057a5c333dae9fca2bf2491b1f438877fb86b2c13e  src/core/lib/config/db.js
bc908d092f1a2fc50a16372398c53cfdad4792fe9ea774aac7101983204e27b2  scripts/run-dynamodb-coordinator-authority-live-proof.js
fd6d940158f4a2a5916be903987210db2aca9fc8a16d999feed11903f1676d1c  test/runtime/services/resident-coordinator-authority.test.js
42ebf4eae181a21b1f4a6011100b3d16a037904d5c76879eee7c61f4e6c1d08a  test/runtime/execution-ledger-store.test.js
7af2eae43706fbf68448a98bbb738327f2fe767f44b1ff7490ed68862dd8e484  test/scripts/run-dynamodb-coordinator-authority-live-proof.test.js
```

## Executed live DynamoDB proof

The exact hashed runner above executed after the final independent review. It
created one disposable `PAY_PER_REQUEST` table, retained one credentials
provider across the administrative client and both data clients, validated
identical topology through both exact opened data clients, exercised the raw
RVN race/fence matrix, and then exercised two production supervisors.

The supervisor leg committed one incumbent renewal, paused the next renewal
before provider submission, let the successor observe a full 1,500 ms local
monotonic window and advance epoch 4 to 5, rejected the incumbent's stale
fenced mutation and paused renewal, aborted its handler, retained the
successor's fenced mutation, drained the successor, and released its latest
authority. Cleanup waited until the table was absent.

- Redacted AWS identity: account fingerprint
  `sha256:40316ba8e46264061fcee06c941638b9435b039cef6775d736a1070259cb727e`.
- AWS Region: `us-east-2`.
- Disposable table: `wharfie-rvn-proof-8cc4af0c8e646ead`.
- Exact validated data clients: 2.
- Receipt:
  `/private/tmp/wharfie-dynamodb-resident-supervisor-proof-2026-08-28-reviewed.json`,
  2,267 bytes.
- Receipt SHA-256:
  `12c11d91e8a244072131154c5c52dffbe0c289f2c23df821dff4afcdbd2426ee`;
  the adjacent checksum verified successfully.
- Cleanup: `tableDeleted` is `true` after resource-not-found confirmation.

The exact semantic invocation was:

```sh
AWS_PROFILE=<redacted-authorized-profile> node scripts/run-dynamodb-coordinator-authority-live-proof.js \
  --confirm-live-aws \
  --region us-east-2 \
  --output /private/tmp/wharfie-dynamodb-resident-supervisor-proof-2026-08-28-reviewed.json
```

Canonical sanitized receipt:

```text
{"cleanup":{"tableDeleted":true,"tableName":"wharfie-rvn-proof-8cc4af0c8e646ead"},"evidence":{"contenderRace":{"contenders":2,"loserCode":"WHARFIE_COORDINATOR_AUTHORITY_CONFLICT","rejected":1,"winnerEpoch":3,"winners":1},"initialAcquisition":{"applied":true,"epoch":1,"recordVersion":1},"renewalAbortedObservation":{"afterRecordVersion":2,"beforeRecordVersion":1,"outcome":"changed","reason":"renewed"},"residentSupervisors":{"incumbent":{"epoch":4,"firstRenewalRecordVersion":7,"handlerAborted":true,"lossCode":"WHARFIE_RESIDENT_COORDINATOR_AUTHORITY_LOST","pausedRenewalAttempt":2,"renewalErrorCode":"WHARFIE_COORDINATOR_AUTHORITY_STALE","staleRenewalRejected":true,"successfulRenewals":1},"staleFencedMutation":{"currentEpoch":5,"errorName":"ConditionalCheckFailedException","rejected":true,"retainedMutation":false,"staleEpoch":4},"successor":{"drained":true,"elapsedNanoseconds":"1502869500","epoch":5,"fencedMutationCommitted":true,"mutationRetained":true,"observationWindowMs":1500,"observedFromEpoch":4,"released":true,"takeoverAdvancedEpoch":true},"supervisors":2},"stableTakeover":{"applied":true,"fromEpoch":1,"observedRecordVersion":2,"toEpoch":2},"staleFencedMutation":{"currentEpoch":3,"errorName":"ConditionalCheckFailedException","preparedBeforeTakeover":true,"rejected":true,"releasedAfterTakeover":true,"retainedMutation":false,"staleEpoch":2},"successorFencedMutation":{"committed":true,"coordinatorEpoch":3,"retained":true}},"kind":"wharfie.dynamodb-rvn-coordinator-authority-live-proof","protocol":{"kind":"record-version-number-observation","observationWindowMs":1500,"stableFence":"coordinator-authority-active-tuple"},"provider":{"billingMode":"PAY_PER_REQUEST","globalTable":false,"kind":"aws-dynamodb","region":"us-east-2","replicas":0,"tableName":"wharfie-rvn-proof-8cc4af0c8e646ead","topology":{"arnPartition":"aws","globalTable":false,"keySchema":[{"attributeName":"run_id","attributeType":"S","keyType":"HASH"},{"attributeName":"sort_key","attributeType":"S","keyType":"RANGE"}],"kind":"dynamodb-coordinator-authority-topology","region":"us-east-2","replicaCount":0,"schemaVersion":1,"tableName":"wharfie-rvn-proof-8cc4af0c8e646ead","tableStatus":"ACTIVE","witnessCount":0},"validatedDataClients":2},"schemaVersion":2,"status":"passed"}
```

## Honest boundary

- No public resident, submission, recovery, workflow, or application-state
  path uses this helper yet; their DynamoDB gates remain closed.
- No ledger reconstruction or work-reassignment policy is implemented or
  proved. A safe takeover capability alone does not decide what may replay.
- No control/application-state cross-store atomicity or handoff is added.
- No second-node service recovery, trusted node enrollment, placement, or
  capability protocol is proved.
- No DynamoDB Global Tables, cross-Region, generic-store, or conventional
  wall-clock lease claim is made.
- A false suspicion may interrupt a live owner and duplicate unmanaged
  physical work. Safety ends at the same-table transaction fence.
- The generic acquisition API does not yet distinguish transient ambiguity
  from permanent transport failure. An opaque result therefore remains exact-
  retried; cancellation suppresses handler admission and identity rotation but
  cannot stop that exact settlement. It may create and immediately release
  authority because returning after a read alone could leave a later-
  committing orphan.

## Next handoff

Reconstruct durable runnable, in-flight, blocked, and terminal work under an
exact replacement authority; encode replay eligibility explicitly; then wrap
the reconstructed dispatcher with this supervisor and decide the separate
application-state adoption boundary before opening the DynamoDB resident gate.
