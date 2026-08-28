# DynamoDB RVN coordinator-replacement checkpoint

- **Date:** 2026-08-27
- **Status:** **PROVIDER PRIMITIVE CERTIFIED; RESIDENT WIRING NOT IMPLEMENTED**
- **Branch:** `agent/dynamodb-rvn-authority`
- **Source base:** `2230419069e326a199aa135d95c613ceefe3fd81`
- **Decision:** [ADR 0037](../../docs/architecture/decisions/0037-single-region-dynamodb-rvn-coordinator-replacement.md)

## Restart summary

ADR 0037 accepts a provider-specific path to automatic epoch replacement
without store-authoritative expiry. The scope is one ordinary DynamoDB table in
one AWS Region with no Global Tables replicas. The authority record and every
protected execution-ledger mutation must share that table's
`TransactWriteItems` boundary, and authority observations must be strongly
consistent.

The current owner performs receiptless exact renewal by conditionally replacing
its full ACTIVE snapshot and advancing its Wharfie-owned `recordVersion` (RVN)
by exactly one. A contender may attempt takeover only after strongly observing
one unchanged exact snapshot across a complete local monotonic window.
Takeover conditionally replaces that exact predecessor and advances the epoch
by one.

The observation window is not the safety boundary. Local time, scheduling
pause, or an aggressive interval can cause premature eviction and availability
churn. Safety comes solely from comparing the stable ACTIVE coordinator tuple
in the same DynamoDB transaction as every protected ledger mutation. After
takeover, a delayed predecessor transaction carries the old tuple and must be
rejected.

## Bounded protocol

### Receiptless exact renewal

1. The owner retains one exact full ACTIVE authority snapshot.
2. It constructs the exact successor with the same stable tuple, RVN plus one,
   and bounded diagnostic metadata.
3. It conditionally replaces the exact predecessor without writing a separate
   request-receipt item.
4. An ambiguous response is resolved with a strongly consistent read: exact
   successor proves success, exact predecessor permits exact retry, and any
   other state fails closed.

Renewal changes observation evidence, not the work capability. RVN and
diagnostic fields remain outside the stable tuple used by ledger fences.
An existing request-receipted heartbeat also advances RVN and therefore aborts
an unchanged-snapshot observation; receiptless renewal is the continuous path
that avoids permanent per-renewal receipt growth. Timestamp age remains
diagnostic only.

### Monotonic observation and exact takeover

1. A contender strongly reads an exact ACTIVE snapshot.
2. Its local monotonic window begins only after that read completes.
3. Any changed exact snapshot or RVN restarts the complete window.
4. One unchanged exact snapshot after the full interval is eligible only as
   the predecessor of an exact takeover attempt.
5. The conditional takeover creates a fresh ACTIVE authority at exactly the
   next epoch. Concurrent contenders for the same predecessor cannot both win.

Heartbeat timestamps, caller wall time, message silence, reachability, and
DynamoDB TTL never authorize takeover.

### Transaction-fence safety claim

Every protected mutation conditionally compares the schema, record kind,
application, coordinator, authority ID, epoch, and ACTIVE status in the same
DynamoDB transaction as its ledger write. A predecessor mutation racing a
successful takeover therefore either commits before takeover or fails its
stale tuple condition afterward. The protocol does not require the predecessor
process to stop believing it is active.

This claim does not cross into another table or store. It does not make an
unmanaged external effect exactly once.

## Deterministic validation matrix

| Boundary                 | Observed result                                                                                                     | Result |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------ |
| Exact renewal            | exact predecessor advanced from RVN 1 to 2 and preserved the stable fence tuple                                     | Passed |
| Renewal CAS race         | one exact predecessor admitted one renewal; a stale predecessor was rejected                                        | Passed |
| Ambiguous renewal        | successor readback proved a lost committed response; exact predecessor retried; unrelated advancement failed closed | Passed |
| Receiptful heartbeat     | its committed RVN advance returned `changed/renewed` and exposed no takeover closure                                | Passed |
| Strong reads             | both observation reads set `ConsistentRead: true`                                                                   | Passed |
| RVN change               | renewal, heartbeat, release, and replacement changes prevented takeover from the prior observation                  | Passed |
| Premature suspicion      | injected monotonic advancement authorized only exact takeover; the stale stable-tuple transaction still failed      | Passed |
| Concurrent contenders    | two contenders over one predecessor produced one next-epoch winner and one definite authority conflict              | Passed |
| Delayed stale commit     | an epoch-2 mutation prepared before epoch-3 takeover was released afterward and failed its condition                | Passed |
| Current successor commit | an epoch-3 mutation committed through the same fence and was retained                                               | Passed |
| Overflow and ambiguity   | RVN/epoch exhaustion, malformed state, non-advancing clocks, and unknown write outcomes failed closed               | Passed |

### Local validation fields

- Pinned versions: Node `v24.13.1`; npm `11.12.0`.
- Focused protocol/proof command:
  `node ./test/run-jest.js --silent --runInBand test/runtime/coordinator-authority.test.js test/runtime/dynamodb-coordinator-authority-protocol.test.js test/scripts/run-dynamodb-coordinator-authority-live-proof.test.js`.
- Focused result: 3 suites, 54 tests, all passed.
- Existing protected-writer command:
  `node ./test/run-jest.js --silent --runInBand test/runtime/execution-ledger-coordinator-authority.test.js test/runtime/schedule-control.test.js test/runtime/ledger-service-lifecycle.test.js`.
- Existing protected-writer result: 3 suites, 84 tests, all passed.
- Lint and formatting: `npm run lint` passed with zero warnings; all matched
  JavaScript and JSON files use Prettier style.
- Typecheck: `npm run typecheck` passed all source, app, test, and SEA-verifier
  programs.
- Package contents: `npm run verify:package` passed with 368 files.
- Provider boundary: `npm run verify:provider-boundary` passed; zero provider
  SDK graph inputs, 158 core production packages, and 205 packages with the
  optional AWS companion.
- Production audit: `npm run audit:prod` passed with zero vulnerabilities.
- `git diff --check`: passed.

Relevant SHA-256 digests:

```text
fef0546791da3a760174a503f9d89b126f20a0654985061f113615dde7ba7c07  src/core/lib/db/tables/coordinator-authority.js
8a9cc509796bc839e0134b70f9f78b57cb1d9f624bc68feb9f51bbfdb8c30eb4  src/core/lib/db/tables/dynamodb-coordinator-authority.js
e22910fc9336c23ce6329228fccc2c901b60c133b95910c5c48c0edc860337fb  scripts/run-dynamodb-coordinator-authority-live-proof.js
bb3844fbb4ed648fdcc84e0d53f95c42ac6655dabe503d8d805cb6089f8c4924  test/runtime/coordinator-authority.test.js
2526ab0d1493efd9c8b0cad1fdfb8043cb491a0f9df7e40288c3e891d27c253c  test/runtime/dynamodb-coordinator-authority-protocol.test.js
969065b88ddfc9a84f724cc5de38b4f3dc37549dd1bbe7b8736808e93d5a6339  test/scripts/run-dynamodb-coordinator-authority-live-proof.test.js
```

## Executed live DynamoDB proof

After the final review hardened early-failure cleanup, partial client cleanup,
publication cleanup, and renewal-barrier ordering, the exact hashed runner was
executed again on 2026-08-28.

The live proof used a disposable table and retained redacted evidence for all
of these steps:

1. Record the AWS Region and verify that the table has no Global Tables
   replicas or multi-Region relationship.
2. Create one ACTIVE authority and show receiptless renewals advancing its RVN
   while preserving its stable tuple.
3. Strongly observe one unchanged exact snapshot across the configured local
   monotonic window.
4. Hold a predecessor's authority-fenced ledger transaction before commit.
5. Commit an exact takeover to the next epoch from the observed predecessor.
6. Release the delayed predecessor transaction and verify DynamoDB rejects its
   stale authority condition.
7. Commit one successor-fenced mutation, inspect retained state, and remove all
   proof-owned records and table resources.

### Live-proof result

- Redacted AWS identity: account fingerprint
  `sha256:40316ba8e46264061fcee06c941638b9435b039cef6775d736a1070259cb727e`.
- AWS Region: `us-east-2`.
- Disposable table: `wharfie-rvn-proof-be87a910eda2ce6b`.
- Topology: `DescribeTable` returned the exact `us-east-2` table ARN,
  `PAY_PER_REQUEST`, no replicas, and no Global Tables version.
- Observation window: 1,500 local monotonic milliseconds.
- Renewal: exact RVN `1 -> 2`; the in-flight contender returned
  `changed/renewed` and received no takeover capability.
- Stable takeover: epoch `1 -> 2` from observed RVN 2.
- Contender race: two epoch-2 observations produced one epoch-3 winner and one
  `WHARFIE_COORDINATOR_AUTHORITY_CONFLICT` loser.
- Delayed predecessor: the epoch-2 mutation was prepared before epoch-3
  takeover, released afterward, rejected as
  `ConditionalCheckFailedException`, and not retained.
- Current successor: the epoch-3 fenced mutation committed and was retained by
  a strongly consistent read.
- Receipt: `/private/tmp/wharfie-dynamodb-rvn-proof-2026-08-28-review.json`, 1,178
  bytes; its canonical contents are archived below.
- Receipt SHA-256:
  `c8586cdd88890f0b41ae01e7c7a04972016a07b9c6abcc304c87aa1f55d64a40`;
  the adjacent checksum verified successfully.
- Cleanup: the proof waited until `DescribeTable` returned resource-not-found;
  `tableDeleted` is `true`.

The exact semantic invocation was:

```sh
AWS_PROFILE=<redacted-authorized-profile> node scripts/run-dynamodb-coordinator-authority-live-proof.js \
  --confirm-live-aws \
  --region us-east-2 \
  --output /private/tmp/wharfie-dynamodb-rvn-proof-2026-08-28-review.json
```

Canonical sanitized receipt:

```text
{"cleanup":{"tableDeleted":true,"tableName":"wharfie-rvn-proof-be87a910eda2ce6b"},"evidence":{"contenderRace":{"contenders":2,"loserCode":"WHARFIE_COORDINATOR_AUTHORITY_CONFLICT","rejected":1,"winnerEpoch":3,"winners":1},"initialAcquisition":{"applied":true,"epoch":1,"recordVersion":1},"renewalAbortedObservation":{"afterRecordVersion":2,"beforeRecordVersion":1,"outcome":"changed","reason":"renewed"},"stableTakeover":{"applied":true,"fromEpoch":1,"observedRecordVersion":2,"toEpoch":2},"staleFencedMutation":{"currentEpoch":3,"errorName":"ConditionalCheckFailedException","preparedBeforeTakeover":true,"rejected":true,"releasedAfterTakeover":true,"retainedMutation":false,"staleEpoch":2},"successorFencedMutation":{"committed":true,"coordinatorEpoch":3,"retained":true}},"kind":"wharfie.dynamodb-rvn-coordinator-authority-live-proof","protocol":{"kind":"record-version-number-observation","observationWindowMs":1500,"stableFence":"coordinator-authority-active-tuple"},"provider":{"billingMode":"PAY_PER_REQUEST","globalTable":false,"kind":"aws-dynamodb","region":"us-east-2","replicas":0,"tableName":"wharfie-rvn-proof-be87a910eda2ce6b"},"schemaVersion":1,"status":"passed"}
```

## Honest boundary

- No resident automatically renews, observes, or takes over through this
  checkpoint.
- No ledger reconstruction or work-reassignment policy is proved.
- No second-node service recovery is proved.
- No control/application-state cross-store atomicity is added.
- No DynamoDB Global Tables or other multi-Region claim is made.
- No generic-store lease or replacement claim is made.
- The primitive checks the adapter brand, not table topology or consumer
  co-location; provisioning and future resident wiring must enforce those
  deployment preconditions.
- A false suspicion may interrupt availability and duplicate physical work;
  the claim is only that stale protected DynamoDB commits remain fenced.

## Next handoff

Wire the certified provider primitive into the resident renewal and
replacement lifecycle, then add exact reconstruction and crash-boundary proof.
Those remain separate Outcome 2 slices before any automatic resident or
multi-node recovery claim.
