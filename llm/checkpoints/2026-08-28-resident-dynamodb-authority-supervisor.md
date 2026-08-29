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
  service client already owned by the open, immutable DynamoDB ledger wrapper.
  Copied, unrelated, mutated, or closed wrappers cannot recover that
  capability. First validation is a barrier: prior or racing logical-name data
  traffic prevents certification or remains blocked.
- Topology validation requires the exact table ARN Region and resource name,
  TableId, `ACTIVE` status, the `run_id`/`sort_key` string key schema, and no
  replicas, Global Table version, witnesses, or multi-Region consistency
  metadata. Only the exact retained response can pin the wrapper.
- Every later item, query, batch, and transaction operation resolves the table
  once to the pinned full ARN. Managed credentials may refresh, but a new
  principal can access that resource or fail; it cannot select a same-named
  table in another account. A detected ARN, TableId, or topology change poisons
  the route.
- ARN account and TableId are summarized as an opaque, canonical
  `tableResourceId`. The opt-in profile requires the same provisioning-retained
  expected ID on every participant and compares it before authority protocol,
  supervisor, or handler construction.
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
6. Release uses one immutable receipt-backed intent across opaque retries and
   exact-retries a CAS conflict when a late same-owner renewal advanced the
   full snapshot. A stable release token makes that replay safe. Stale release
   means a successor already fenced the owner; request/domain corruption is
   terminal. Cleanup cannot restore old authority.

## Deterministic validation

The final focused command passed 10 suites and 215 tests. It covers the
supervisor, exact ledger wrapper, topology validator/provider, private adapter
capability, DynamoDB RVN protocol, authority store, configuration, operator
routing, and live-proof driver.

| Boundary                                 | Result                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Historical acquisition/takeover receipts | Rejected until exact current strong-read proof; identities rotate                                                                         |
| Ambiguous startup plus cancellation      | Exact retained intent settles after a non-owned read; proven/created authority released; handler never starts                             |
| Renewal and drain                        | Stable token retained; latest full snapshot renewed and released                                                                          |
| Authority loss                           | Handler signal aborted; stale fenced mutation rejected                                                                                    |
| Opaque release outcomes                  | Same immutable intent retries opaque failures and late-renewal CAS conflicts; stale successor and corrupt domain outcomes remain terminal |
| Construction provenance                  | Copied, mutable, different-client, different-table, already-bound, accessor-drift, prior-use, and racing-use inputs fail closed           |
| Exact resource binding                   | Full ARN/TableId pin, canonical expected resource ID, refresh drift, revalidation poison, and all operation families covered              |
| Topology                                 | Wrong resource ID/Region/name/incarnation/schema/status and replica/global metadata rejected before authority construction                |
| Live-proof fidelity                      | Both exact data clients join the admin-created ARN/TableId before protocol construction; cleanup rechecks identity before ARN deletion    |

Local validation at this checkpoint used Node `v24.13.1` and npm `11.12.0`:

- `npm run lint`: passed with zero warnings; Prettier check passed.
- `npm run typecheck`: all source, app, test, and SEA-verifier programs passed.
- Focused Jest matrix: 10 suites, 215 tests, all passed.
- `npm run verify:package`: passed with 371 packaged files.
- `npm run verify:provider-boundary`: passed with zero provider SDK graph
  inputs, 158 core production packages, and 205 packages with the optional AWS
  companion.
- `npm run audit:prod`: passed with zero vulnerabilities.
- `git diff --check`: passed.

Relevant SHA-256 digests:

```text
b511b9ec52c425adfabf9c852bd6e6a2fe5f323b5a515181dd3d5121a9e8a825  src/core/runtime/services/resident-coordinator-authority.js
12be2b13b6f311d7ccfacf588bf36934e369c6dd49bc2e90916fe9035184ea02  src/core/runtime/dynamodb-coordinator-authority-topology.js
8ebeaaca2bc05f47e508c66d3afab71e4315569003d4b8456d1bd421286c3691  src/core/runtime/dynamodb-coordinator-authority-topology-provider.js
e305b300cbfe62aae8da55e662d4bdd2a139e194df3d98a12559c80ea95773cd  src/core/runtime/operator/execution-ledger-store.js
a6acdfa860511082be7831a22db486a27e059b313613c932a7e28e8d97b9798e  src/core/lib/db/adapters/dynamodb.js
ec99f8c24dd3c3fe13d9a9165b6cbfe8cf3c7fb6b6d95345be4d7e62f2a3009a  src/core/lib/db/tables/execution-ledger.js
f84fa1154d4c1a3062c0aed7ac707f176f1a1fcdb502748b8aaca0810a741d18  src/core/lib/config/db.js
6a277fdb5bd07f5c0d6e9ce4286154b23647e906fb93dd196385862c71393c56  scripts/run-dynamodb-coordinator-authority-live-proof.js
a1ce1ba478ae7ed08a0b425dadde9134961e279aa7c70b2b430d574b2ff2c98c  test/runtime/services/resident-coordinator-authority.test.js
856d28df20281c745f8003d82b718026d68b782067893b974e68a004aae45ec4  test/runtime/execution-ledger-store.test.js
f0aa152d112ef8898544f0961f4b49dd54563467e698d30454690b89a51a1684  test/scripts/run-dynamodb-coordinator-authority-live-proof.test.js
```

## Executed live DynamoDB proof

The exact hashed runner above executed after the final independent review. It
created one disposable `PAY_PER_REQUEST` table, retained one sufficiently
lived credential snapshot across the administrative client and both data
clients while returning SDK-compatible mutable copies, validated and pinned
the exact CreateTable ARN/TableId through both opened data clients, exercised the raw
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
- Disposable table: `wharfie-rvn-proof-d0339e18c573b14f`.
- Exact validated data clients: 2.
- Receipt schema: live proof v3 with nested topology v2 and one opaque
  cross-client `tableResourceId`.
- Receipt:
  `/private/tmp/wharfie-dynamodb-resident-supervisor-proof-2026-08-29-final.json`,
  2,337 bytes.
- Receipt SHA-256:
  `ea1a2f7636eed141366334254dc09ee08397492bd715f5f54f110c7ac280c341`;
  the adjacent checksum verified successfully.
- Cleanup: `tableDeleted` is `true` after resource-not-found confirmation.

The exact semantic invocation was:

```sh
AWS_PROFILE=<redacted-authorized-profile> node scripts/run-dynamodb-coordinator-authority-live-proof.js \
  --confirm-live-aws \
  --region us-east-2 \
  --output /private/tmp/wharfie-dynamodb-resident-supervisor-proof-2026-08-29-final.json
```

Canonical sanitized receipt:

```text
{"cleanup":{"tableDeleted":true,"tableName":"wharfie-rvn-proof-d0339e18c573b14f"},"evidence":{"contenderRace":{"contenders":2,"loserCode":"WHARFIE_COORDINATOR_AUTHORITY_CONFLICT","rejected":1,"winnerEpoch":3,"winners":1},"initialAcquisition":{"applied":true,"epoch":1,"recordVersion":1},"renewalAbortedObservation":{"afterRecordVersion":2,"beforeRecordVersion":1,"outcome":"changed","reason":"renewed"},"residentSupervisors":{"incumbent":{"epoch":4,"firstRenewalRecordVersion":7,"handlerAborted":true,"lossCode":"WHARFIE_RESIDENT_COORDINATOR_AUTHORITY_LOST","pausedRenewalAttempt":2,"renewalErrorCode":"WHARFIE_COORDINATOR_AUTHORITY_STALE","staleRenewalRejected":true,"successfulRenewals":1},"staleFencedMutation":{"currentEpoch":5,"errorName":"ConditionalCheckFailedException","rejected":true,"retainedMutation":false,"staleEpoch":4},"successor":{"drained":true,"elapsedNanoseconds":"1501150750","epoch":5,"fencedMutationCommitted":true,"mutationRetained":true,"observationWindowMs":1500,"observedFromEpoch":4,"released":true,"takeoverAdvancedEpoch":true},"supervisors":2},"stableTakeover":{"applied":true,"fromEpoch":1,"observedRecordVersion":2,"toEpoch":2},"staleFencedMutation":{"currentEpoch":3,"errorName":"ConditionalCheckFailedException","preparedBeforeTakeover":true,"rejected":true,"releasedAfterTakeover":true,"retainedMutation":false,"staleEpoch":2},"successorFencedMutation":{"committed":true,"coordinatorEpoch":3,"retained":true}},"kind":"wharfie.dynamodb-rvn-coordinator-authority-live-proof","protocol":{"kind":"record-version-number-observation","observationWindowMs":1500,"stableFence":"coordinator-authority-active-tuple"},"provider":{"billingMode":"PAY_PER_REQUEST","globalTable":false,"kind":"aws-dynamodb","region":"us-east-2","replicas":0,"tableName":"wharfie-rvn-proof-d0339e18c573b14f","topology":{"arnPartition":"aws","globalTable":false,"keySchema":[{"attributeName":"run_id","attributeType":"S","keyType":"HASH"},{"attributeName":"sort_key","attributeType":"S","keyType":"RANGE"}],"kind":"dynamodb-coordinator-authority-topology","region":"us-east-2","replicaCount":0,"schemaVersion":2,"tableName":"wharfie-rvn-proof-d0339e18c573b14f","tableResourceId":"wdtr1_cYHG521TCJXgaGp9JVti9_T8XsrA4KGnN66d8v3Ww6o","tableStatus":"ACTIVE","witnessCount":0},"validatedDataClients":2},"schemaVersion":3,"status":"passed"}
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
- All future participants must receive the same provisioning-retained
  `tableResourceId`. The internal environment seam proves that admission gate;
  product activation still needs to durably distribute it.
- DynamoDB data requests cannot atomically compare TableId. Provisioning must
  prevent deletion/recreation after startup; explicit revalidation detects and
  poisons a changed incarnation but cannot retroactively fence an unobserved
  administrative replacement.
- Live cleanup checks ARN and TableId immediately before `DeleteTable` and
  never falls back to a logical name. DynamoDB offers no conditional delete on
  TableId, so a narrow describe/delete race remains; the proof's random owned
  name and creation response are the bounded external invariant.
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
