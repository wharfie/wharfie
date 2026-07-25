# V70 authenticated current-head authority checkpoint

Date: 2026-07-25

Parent:
[V69 root host activation persistence](./2026-07-25-v69-root-host-activation-persistence.md)
(`ab931c8db16f8d0967a7f1ad022dad9aadb6eda3`)

Implementation: `1ccbeafc923a82f9b70b1259e228ff040d6b8fca`

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be packaged
as one portable SEA, run locally, become a durable resident service, and then
be projected into a trusted cloud node without requiring Node, containers,
Kubernetes, or a hosted orchestration service on that node. Its purpose is to
carry an author's intent beyond one interactive LLM session while keeping the
result inspectable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use the operator's ordinary cloud credentials to create the
specific resources they require. The public path remains Node-first; native
bindings or WASM remain available for measured hot paths. Exactly-once claims
remain abstraction-specific and require durable protocol evidence.

V65 defined the immutable controller-to-host request and terminal receipt. V66
implemented the pure durable six-stage activation kernel. V67 implemented
exact live STS EC2 instance-profile identity proof. V68 supplied its fixed
IMDSv2 credential source and pinned owned STS lifetime. V69 implemented the
root-owned local persistence and crash-releasing locks required by V66.

V70 now closes the authenticated controller-current-head authority path:

- the controller derives a complete V65 request only from its exact
  all-actions-settled non-destroy frontier and a fresh managed-artifact
  `HeadObject`;
- one DynamoDB transaction conditions on that exact current head while
  publishing the complete request at one stable deployment-scoped key;
- the runtime role receives one code-owned, exact-key `GetItem` grant;
- the host-owned AWS lifetime gains one pinned, one-attempt DynamoDB client;
  and
- the host resolves selector-only wakeups and independently authorizes every
  V66 `claim`, `dispatch`, `settle`, and `replay` decision by reading the
  stable request first and the strongly consistent current head last.

This is controller authorization, unlike V69's local fence classification. It
still is not a deployed privileged host. The bootstrap does not yet deliver
the selectors to a root host command, and the four remaining host-effect
adapters are still injected ports.

## Controller publication point

`createDeploymentController(...)` now requires the narrow
`hostActivationAuthorityPublisher.publish(...)` port. Finalization invokes it
only after every action intent has settled and before the final provider
inspection or READY head compare-and-set.

For a non-destroy operation the exact call is:

```text
publish({
  plan,
  settledPlan,
  profile,
  head
})
```

Destroy skips publication. Any publication failure follows the controller's
existing fail-closed finalization path: it blocks the active operation, does
not perform the final provider inspection, and cannot publish a READY
successor. A publication may therefore be durable before a later controller
step fails; re-entry must reuse or supersede that durable result rather than
minting incompatible authority.

The production AWS invocation constructs the publisher from the invocation's
existing deployment-control store and managed-artifact S3 client. Credentials
and raw clients remain outside the controller.

## Fresh artifact evidence before reuse

Every publication attempt, including re-entry after response loss, first
performs a fresh `HeadObject` of the deterministic managed-current key with:

```text
ChecksumMode: ENABLED
ExpectedBucketOwner: <provider account>
```

The call does not supply a `VersionId`; it observes the exact version that is
current at that moment. The existing strict managed-artifact evidence decoder
then binds its returned VersionId, ETag, checksum, content length, encryption,
metadata, ownership lineage, application, deployment, and incarnation to the
controller's exact artifact binding. A missing current object is conflict.
Malformed or unavailable provider evidence remains bounded unknown.

Only after fresh evidence has produced a complete canonical V65 request does
the publisher read the existing authority record. This ordering prevents an
old same-operation request from bypassing a new artifact observation.

Same-operation reuse is deliberately narrow. Every stable request field must
match. Only these fields may differ:

```text
requestId
authorizedHeadId
authorizedHeadGeneration
```

Artifact VersionId, ETag, checksum, release identity, bindings, volumes,
operation identity, provider scope, and every other request field remain
stable. A same-operation artifact change is conflict and never replaces
authority. A later operation may replace the prior operation's request through
the atomic successor protocol below.

## Stable authority record and atomic publication

The control table now has shared validated key helpers for:

```text
head/v1/<deploymentInstanceId>
host-activation-authority/v1/<deploymentInstanceId>
```

The authority item is one exact bounded physical record:

```text
{
  record_key:
    "host-activation-authority/v1/<deploymentInstanceId>",
  storage_schema_version: 1,
  record_kind:
    "aws-single-node-host-activation-authority",
  document_id: "<requestId>",
  document: <complete canonical V65 request>
}
```

The stable key holds only the current mutable authority pointer. The contained
request remains immutable and content-addressed. Strong reads return the
validated request document or conclusive absence; malformed physical or
logical content fails as store-integrity error.

`compareAndSetHostActivationAuthority(...)` accepts exactly:

```text
{
  expectedRequest: <prior request or null>,
  nextRequest: <complete request>,
  authorizedHead: <exact HeadV2>
}
```

Before I/O it proves that the request names that head ID and generation, that
the head authorizes the request, and that any predecessor belongs to the same
deployment at a strictly lower authorized generation.

One DynamoDB transaction then:

1. condition-checks the stable head item's schema, kind, and exact document ID;
   and
2. puts the new authority item only if the stable authority key is absent or
   its schema, kind, and exact predecessor request ID still match.

A normalized conditional loss returns literal `false`. Transport, timeout,
throttling, and other ambiguous failures propagate to publisher recovery. The
transaction never treats an SDK response or a request content hash as writer
authority.

## Publication response-loss recovery

After a conditional loss or ambiguous write, the publisher reads the authority
record first and the current head last, both strongly consistently.

It accepts a winner only when:

- the winner is a complete valid V65 request;
- it belongs to the exact same operation and plan;
- all stable request fields match the freshly derived candidate; and
- the last-read current head still authorizes that winner.

This lets concurrent re-entry converge on an exact same-operation request
minted at a compatible newer head generation. It does not let one operation
adopt a different artifact observation or another operation's request.

A conditional loss without that exact winner is conflict. An ambiguous write
without conclusive readback is unknown. Raw provider and store errors are not
attached as public causes and are not echoed through these fixed failure
classes.

## Exact current-head authorization

The shared pure authority predicate validates the complete request and HeadV2.
It rejects:

- another deployment, provider scope, or incarnation;
- a head older than the request's authorized generation;
- a different head ID at the same generation;
- destroy, another operation, another plan, or incomplete action intents;
- a different target or settled deployment revision; and
- drift in the artifact, substrate node, runtime role, either retained volume,
  or either retained-volume attachment binding and provider identity.

A higher generation remains authoritative only in one of two shapes:

1. `CONVERGING` still carries the same non-destroy, all-settled operation and
   target revision; or
2. `READY` has no active operation and its exact last operation plus settled
   and target revisions consume that same operation.

No S3 pointer, transport signature, artifact hash, local fence, or SSM message
can substitute for this DynamoDB current-head relationship.

## Host authority adapter

`createAwsSingleNodeHostActivationAuthorityAdapter(...)` binds one provider
scope and deployment instance to a client exposing only
`getControlRecord(...)`. It returns:

```text
{
  readAuthorizedRequest({
    deploymentInstanceId,
    requestId
  }),
  authorizeRequest({
    request,
    purpose,
    step,
    receipt
  })
}
```

`readAuthorizedRequest(...)` is the selector-only wakeup boundary. It reads
the stable authority record, requires the selected request ID and bound
provider/deployment scope, then reads the current head last. Absence,
supersession, and a valid selector for another bound deployment return `null`;
storage corruption and provider unavailability remain distinct fixed errors.

`authorizeRequest(...)` implements V66's four exact purposes:

- `claim`, `settle`, and `replay` require `step: null`;
- `dispatch` requires one exact V66 activation step;
- only `replay` accepts a receipt; and
- replay reconstructs the exact V65 terminal receipt from the request and its
  service-health receipt before any provider read.

Every successful purpose then independently reads and matches the complete
stable authority request before reading and authorizing against the head.
There is no authority cache. A timeout, cancellation, malformed response, or
provider error cannot become `true`.

## Owned DynamoDB lifetime

The V68 host-only family now requires both the exact provider scope and
deployment instance. It reuses only its owned fixed IPv4 IMDSv2 credential
source and constructs:

- the existing pinned commercial-regional STS client; and
- one pinned
  `https://dynamodb.<region>.amazonaws.com` DynamoDB document client.

The DynamoDB client has one SDK attempt, no FIPS, dual-stack, account-endpoint,
ambient credential, environment endpoint, or retry authority, and a silent
logger. It exposes only strongly consistent `GetItem` against the fixed
control table. Each raw send is combined with the adapter deadline and family
abort signals, retained until settlement, and drained before close. Close
fences new calls and destroys STS, DynamoDB, and the credential source with
complete all-settled cleanup.

The family exposes only:

```text
{
  providerScope,
  runtimeIdentity,
  activationAuthority,
  close
}
```

It does not expose the credential source, SDK clients, generic DynamoDB reads,
table names, endpoints, retries, or client destruction.

## Runtime IAM boundary

The code-owned runtime-policy template now includes one
`dynamodb:GetItem` statement for the exact regional/account control-table ARN.
It requires TLS and a present `dynamodb:LeadingKeys` context whose value is
one of exactly:

```text
host-activation-authority/v1/<deploymentInstanceId>
head/v1/<deploymentInstanceId>
```

The policy still grants no DynamoDB list, query, scan, write, transaction, or
table-control action. Region and deployment instance are now inputs to the
policy renderer, so its code-owned template digest changes. Older
ProviderSpec/plan documents carrying the preceding digest are intentionally
not a V70 compatibility surface.

This statement describes only Wharfie's identity-policy grant. The retained
control-table lifecycle does not currently inspect, reject, or continuously
validate a DynamoDB resource-based policy. A separately attached table policy
could independently grant this principal broader reads, so V70 does not claim
that the inline `LeadingKeys` condition proves the principal's complete
effective permissions. A clean-account security proof must close that gap by
failing closed on an unexpected table resource policy or establishing an
equivalent explicit deny boundary.

## Guarantees to preserve

V70's exact guarantees are:

- controller publication occurs before final inspection and READY;
- destroy cannot publish host activation authority;
- every publication starts with fresh managed-current object evidence;
- same-operation artifact evidence cannot silently change;
- the complete canonical request occupies one stable deployment key;
- head freshness and authority replacement commit in one transaction;
- conditional loss is distinct from ambiguous outcome;
- recovery reads authority first and current head last;
- the host repeats those reads for selector resolution and every V66 purpose;
- higher-generation authorization is limited to the same all-settled operation
  or its exact READY successor;
- replay additionally requires exact request/receipt correlation;
- unavailable or malformed authority always fails closed;
- the host client cannot be redirected through ambient AWS configuration; and
- fixed public errors do not echo raw AWS or durable-store detail.

This protects the V66 kernel from forged or replayed wakeups,
cross-deployment selectors, stale requests, local application-user messages,
artifact-current drift, a replaced controller operation, and ordinary
transport response loss.

## Verification and disk hygiene

The integrated V70 verification completed with cache and coverage disabled:

- the integrated V70 matrix passed **237/237 tests across 8 suites**;
- the combined V65-V70 host chain passed **153 tests across 10 suites**, with
  **1 platform skip**;
- the complete systemd service-manager regression passed **92 tests**, with
  **2 platform skips**;
- all **4** TypeScript configurations passed;
- the full ESLint and Prettier gates passed;
- the documentation command matrix passed **9/9**; and
- package-content verification retained exactly **250 files**.

Verification used pinned Node **24.13.1**. After generated Jest cache and the
V70 review temporary were removed, the repository occupied about **528 MiB**
and the workspace volume reported about **13 GiB** available. No root
coverage, Jest-cache, tarball, distribution, or TypeScript build-info artifact
remained. The free-space change during verification was larger than the
repository and writable temporary roots accounted for, so unrelated
system-level storage was not deleted.

The final independent adversarial review found no remaining
medium-or-higher defect. Its residual validation gap is provider realism: the
exact DynamoDB endpoint configuration and IAM condition document are tested,
but V70 did not run a disposable live-AWS evaluation. A defective SDK that
ignores both abort and destruction can also keep family close pending; the
family correctly refuses to claim complete draining in that case.

Verification kept Jest cache and coverage disabled and removed generated
tarball and temporary review output. It did not run the full-repository Jest
gate, native LMDB, native package, SEA, disposable Linux, live IMDS/AWS, or
clean-account proof.

## Honest boundaries

V70 is a production-shaped authenticated authority boundary, not a complete
privileged-host lifecycle:

- the fixed EC2 bootstrap remains deployment-agnostic, secret-free user data;
  it creates the locked runtime account, IMDS restriction, lingering, and SSM
  agent, but stores neither a deployment instance selector nor the
  later-minted request ID;
- no SSM sender, selector spool, root command, or host SEA currently composes
  `{deploymentInstanceId,requestId}` into the host client family, V69
  persistence, V66 kernel, and V70 authority adapter;
- SSM or another future wakeup may carry only those selectors; it is never
  durable authority and transported request bytes must not be accepted;
- concrete application storage, control storage, exact versioned-artifact
  projection, fixed-user service convergence, and S3 health publication remain
  unwired;
- V70 does not mint the final success receipt or prove READY end to end;
- the DynamoDB table resource-policy gap above prevents a complete
  effective-permissions claim;
- the V69 namespace claim and native process-death lock still need disposable
  root/Linux proof;
- there is no privileged package, reboot proof, pinned-AMI bootstrap/IMDS
  smoke test, live AWS lifecycle, or clean-account proof;
- root compromise, a principal allowed to mutate the control table, or stolen
  still-valid instance credentials remain explicit trust-root failures; and
- there is no backward-compatible migration for prior runtime-policy template
  digests.

Wharfie still promises exact-convergent, at-least-once-safe work. It does not
claim that an AWS API call, filesystem mutation, mount, service-manager
operation, application activity, or external effect physically executes
exactly once. Durable intent, exact observations, conditional settlement, and
destination-side idempotency are required wherever the abstraction makes a
stronger logical claim.

## V71 concrete privileged-host lifecycle

The next slice should connect the existing contracts through real host effects
without widening the public application model:

1. Implement concrete application- and control-storage adapters for the exact
   retained volume/attachment identities. Format and mount only after exact
   observation, persist intent before mutation, recover response loss through
   independent readback, and add the stop/quiesce/unmount dependency required
   before those now-used volumes can detach.
2. Implement exact versioned-artifact projection. Read the request's explicit
   S3 VersionId rather than mutable current, verify all request-bound evidence,
   publish through a crash-safe immutable release path, and never execute
   application bytes as root.
3. Implement fixed-user service convergence through the locked
   `wharfie-runtime` account and the existing packaged `service converge`
   semantics. Root may own privileged projection and mounts, but authored
   application code must run only as the fixed unprivileged user.
4. Implement V3 S3 health publication from exact live identity, service, and
   request evidence, then mint and settle the V65 success receipt.
5. Compose those ports with V66, V67, V69, and V70 and prove claim, dispatch,
   settle, replay, supersession, response loss, process death, format/mount,
   versioned projection, service repair, and health readback on a disposable
   Linux host.

The proof may inject exact selectors directly until the bootstrap/delivery
slice exists, but it must identify that seam explicitly. It must not promote
SSM message contents, mutable S3 current state, a local fence, or a successful
SDK response into authority.

## Repository state

The V70 implementation commit is
`1ccbeafc923a82f9b70b1259e228ff040d6b8fca`. The commit containing this file
is the V70 restart marker. Its parent restart marker is the V69 checkpoint
commit `79ee651cd8528c5e90829e6ef417617946023496`; the V69 implementation it
records is `ab931c8db16f8d0967a7f1ad022dad9aadb6eda3`.

The historical `stash@{0}: WIP on master: 3dee66b work prompt` remains
untouched.
