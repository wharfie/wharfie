# Replacement input and payload-distribution checkpoint

- **Date:** 2026-08-30
- **Status:** **INTERNAL INPUT/DISTRIBUTION COMPOSED; APPLICATION-STATE TRANSPORT OPEN; PRODUCT GATES CLOSED**
- **Branch:** `agent/replacement-input-envelope`
- **Source base:** `a7ebbcf`
- **Decision:** [ADR 0040](../../docs/architecture/decisions/0040-provisioned-replacement-input-and-payload-distribution.md)

## Restart summary

This slice supplies the durable identities and execution-payload bytes that an
independently starting replacement needs before it may enter ADR 0037's
DynamoDB authority profile. One strict, content-addressed provisioning receipt
pins the application and current revision, exact control-table identity,
payload store and distribution, and normalized application-state destination.
A durable local artifact store retains and copies that receipt without
embedding credentials or runtime paths.

The execution-payload store now has a provider-neutral replicated boundary.
Writes publish and independently read back verified immutable bytes before a
reference can reach the ledger. Reads prefer a verified local replica and
fetch, verify, and hydrate only on exact absence. Reconstruction coverage shows
an empty replacement replica can rebuild from the distribution and then
continue from its hydrated local copy.

The internal reconstructed-resident wrapper validates the entire receipt,
ambient configuration, ledger, and exact payload-store scope before topology
or authority. After reconstruction it requires one strict `ADOPTED`
application-state readiness record at the receipt's exact destination, owned by
the exact current replacement authority token, before the retained admission
barrier can reopen. This fixes the application-state handoff contract only; it
does not move application-state bytes between nodes.

## Provisioning receipt

The version 1 `wrri1` receipt contains exactly:

- `appId` and `currentRevisionId`;
- the `dynamodb-rvn-v1` profile, `dynamodb` adapter, Region, table name, and
  domain-separated `tableResourceId`;
- the local content-addressed payload kind and logical store ID;
- the `wharfie.execution-payload-distribution.v1` kind, domain-separated
  distribution ID, and matching store ID; and
- one normalized application-state destination whose namespace matches the
  application.

Canonical JSON ordering and a domain-separated SHA-256 receipt identity bind
all fields. Validation rejects extra, missing, malformed, oversized, or
substituted data. The serialized form deliberately excludes local paths,
credentials, secrets, timestamps, observation state, node identity, renewal
timers, account IDs, and ARNs. The expected adapter, Region, and table name are
comparison inputs; actual provider connections and credentials resolve
independently and must agree.

The local handoff store publishes canonical bytes create-if-absent, synchronizes
file and directory metadata for every newly created path component and its
parent, validates an existing artifact before accepting idempotent reuse, and
detects missing, replaced, malformed, or tampered files. Its exact-byte
read/write boundary can seed a fresh durable root, but it does not authenticate
or enroll the receiving node.

## Replicated payload contract

1. Local stores accept exact reference-bound byte imports without changing the
   existing execution-payload reference schema or overwriting an immutable
   object.
2. The replicated writer verifies its local object, publishes it through an
   injected immutable distribution port, then reads it back and verifies the
   complete reference before returning.
3. The replicated reader always verifies local bytes first. Only the local
   store's typed not-found error carrying the exact requested payload ID
   enables a remote read.
4. Remote bytes must match size, digest, payload schema, storage identity, and
   canonical JSON before local immutable hydration begins. Every new local
   directory component and parent is synchronized, and the hydrated object is
   read back and verified locally before its bytes return.
5. Local integrity failures never fall back. After one successful hydration,
   later reconstruction can proceed locally even when the distribution is
   unavailable.

The core port retains only the distribution kind, distribution ID, store ID,
immutable publish, and read. Provider account, endpoint, bucket, table, and
credential routing belongs in a future adapter rather than the portable
identity.

## Ordered replacement startup

The still-internal order is:

```text
validate receipt/config/exact ledger payload store → topology proof →
authority supervisor → close/adopt quiescence barrier →
two-pass history reconstruction with verified read-through →
application-state preparation → exact ADOPTED destination validation →
exact current-authority ownership validation → strong authority assertion →
exact barrier reopen →
strong authority assertion → resident handler
```

A wrong application, revision, authority profile, adapter, Region, table,
`tableResourceId`, payload store ID, distribution ID, or ledger payload-store
object fails before topology and authority callbacks. A missing distributed
payload or integrity failure leaves the barrier closed and prevents
application-state preparation and dispatch. A non-`ADOPTED` readiness result
or destination or current-authority mismatch also leaves the barrier closed.
The wrapper also requires the construction-only replicated-store factory brand;
distribution-shaped metadata copied onto a plain local store cannot satisfy the
replacement capability.

## Deterministic evidence

The stable `npm run test:replacement-input` matrix passed 7 suites and 124
tests. It covers the strict receipt and durable handoff store, local import and
replicated payload behavior, ambient configuration, exact ledger payload-store
scope, reconstructed read-through, and ordered wrapper failure paths. Within
that combined receipt, the reconstructed-wrapper suite passed 43 tests,
including exact current-authority application-state ownership, and the
configuration suite passed 18 tests, including provisioning-supplied IDs and
ambient conflicts.

Separate changed-area lifecycle evidence also remains green:

- the seven-suite changed-area lifecycle matrix passed 153 tests under the
  pinned Node `24.13.1` and npm `11.12.0` toolchain outside the filesystem
  sandbox.

One real Vanilla-ledger integration removes a ready-work locator, constructs a
replacement with an empty local payload replica, reconstructs through the
distribution, restores the locator, removes the distributed source, and then
rebuilds successfully from hydrated local bytes.

The complete non-release `npm run test:ci` validation exited 0. The coverage
runner completed in 946.521 seconds with 349 of 350 suites passed and 1 skipped,
and 7,983 of 7,988 tests passed and 5 skipped. Coverage passed at 84.15%
statements, 80.86% branches, 91.58% functions, and 84.88% lines. The package
verifier accepted 377 files, the provider-boundary verifier returned `ok`, and
the production dependency audit reported 0 vulnerabilities.

The Darwin LMDB investigation found no Wharfie teardown regression. Inside the
filesystem sandbox, native `lmdb.open()` receives `mdb_env_open` `EPERM` from
the denied lock operation and the upstream addon then aborts while destroying
the failed environment. The behavior reproduced across Node 22–26 and both the
pinned and newer LMDB addon builds. That seven-suite matrix passes outside the
sandbox with the pinned repository toolchain, so no lifecycle code change was
made for the sandbox-only native failure.

No deployment, live-provider activation, package publication, promotion,
release, or tag-triggered workflow was run for this slice.

## Honest boundary

- The receipt is a durable local handoff artifact and content-integrity
  contract, not a signed enrollment credential or a production distribution
  service.
- The payload layer defines and proves a provider-neutral port. No remote
  provider adapter or trusted-node placement policy is activated here.
- Application-state startup now checks one exact `ADOPTED` destination owned
  by the exact current replacement authority. It does not copy a local store,
  select or attach a volume, recover lost application-state bytes, or make two
  stores atomic.
- The reconstructed wrapper remains internal and has no production resident
  call site. Existing resident, submission, workflow, recovery, schedule, and
  application-state DynamoDB gates remain closed.
- Old-revision work remains parked and started work remains recovery-only.
  Another node still needs explicit revision authorization and the exact
  executable revision before it may run work.
- Trusted-node enrollment, capability advertisement, placement, node-lease
  fencing, the full crash matrix, and a two-node recovery proof remain open.

## Next handoff

Implement and prove cross-node application-state transport for the exact
receipt-pinned destination, including interruption and volume-loss behavior.
Then finish deterministic crash coverage across renewal, takeover, assignment,
authored start, managed-effect settlement, terminal commit, and the handoff
phases. Only after those boundaries and trusted-node revision authorization are
proved should the internal wrapper be connected to the resident behind an
explicit DynamoDB product gate and exercised in one bounded two-node recovery
proof.
