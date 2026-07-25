# V68 owned host AWS lifetime checkpoint

Date: 2026-07-25

Parent:
[V67 live host runtime identity](./2026-07-25-v67-live-host-runtime-identity.md)
(`9fedb7d4786bc19ba5db2c4214b90d4da652cc4c`)

Implementation: `7bdfec0b810abaa84f57bee7c9f4326071655006`

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
implemented the pure durable six-stage activation kernel. V67 implemented its
first concrete read-only stage adapter, accepting only the exact STS EC2
instance-profile role session pinned by the request. V68 now owns the
credential and AWS-client lifetime behind that adapter. It uses a fixed
IMDSv2-only transport, a pinned regional STS endpoint, rotating temporary
credentials, bounded cancellation, and complete close draining. It still does
not provide controller authorization, the durable host store and lock, or any
physical host mutation.

## Fixed IMDSv2 credential source

`src/core/runtime/deployment-aws-host-instance-credentials.js` exports
`openAwsSingleNodeHostInstanceCredentialSource()`. It accepts no options and
returns the exact frozen surface:

```text
{
  credentials,
  close
}
```

`credentials` is the private AWS credential-provider function consumed by the
host family. `close` owns its cache, refresh, and live HTTP requests. The
provider, credentials, token, request objects, and cache are not exposed by the
family returned to activation code.

The source intentionally does not use the Node default credential chain or the
AWS SDK's `fromInstanceMetadata` helper. The default chain would admit
environment, shared-file, process, web-identity, SSO, ECS, and other
authorities. The direct helper is credential-source-specific, but the installed
SDK still permits ambient metadata endpoint and endpoint-mode overrides and
extends stale credentials under some refresh failures. Neither behavior is an
acceptable root-host authority boundary.

Every refresh therefore performs exactly this code-owned sequence with
`node:http`:

```text
PUT  http://169.254.169.254/latest/api/token
     x-aws-ec2-metadata-token-ttl-seconds: 21600

GET  http://169.254.169.254/latest/meta-data/iam/security-credentials/
     x-aws-ec2-metadata-token: <token>

GET  http://169.254.169.254/latest/meta-data/iam/security-credentials/<role>
     x-aws-ec2-metadata-token: <token>
```

This is the session-oriented sequence documented by
[Amazon EC2 for IMDSv2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html)
and for
[instance-role security credentials](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-metadata-security-credentials.html).
The implementation fixes IPv4 family 4, host `169.254.169.254`, port 80,
connection close, and no agent. It performs no hostname lookup, redirect,
alternate-endpoint selection, IMDSv1 request, or retry. The existing node
launch contract separately requires the metadata endpoint enabled, tokens
required, response hop limit one, and the IPv6 metadata endpoint disabled.

Each request has both a 1,000 ms socket-inactivity timeout and an independent
1,000 ms absolute deadline. The absolute deadline matters because Node's
socket timeout alone could be held open by a slow-drip response. Close cancels
the same owned request objects and drains the in-progress refresh.

Responses are bounded before decoding:

- response headers: 8 KiB;
- IMDSv2 token: 1 KiB of visible non-whitespace ASCII;
- role-name response: 256 bytes, then one canonical IAM role name of at most
  64 characters; and
- credential document: 16 KiB.

The credential document must be a plain parsed object with the documented
`Success`/`AWS-HMAC` fields and valid timestamps. It may additionally contain
the current Smithy-supported 12-digit `AccountId`; that field is validated and
discarded. Unknown fields are rejected. The returned frozen credential
projection contains only:

```text
{
  accessKeyId,
  secretAccessKey,
  sessionToken,
  expiration
}
```

The credential bytes remain process-private and are never placed in durable
evidence, logs, public errors, or the host-family surface.

## Rotation without stale extension

Concurrent credential requests coalesce behind one refresh. A successful
credential set is cached while more than five minutes remain before its
internally recorded expiration, matching EC2's documented advance rotation
window. Within the last five minutes the next request refreshes.

If that refresh fails while the cached credential is still unexpired, the
source may return the same still-valid credential and tries to refresh again
on the next call. Once its internally recorded expiration is reached, it is
cleared and can never be returned. Mutating the public `Date` object cannot
extend the private cache lifetime. V68 never fabricates a later expiration and
never performs the SDK helper's stale-credential extension.

Retrieval failures, HTTP errors, timeouts, malformed responses, unsafe role
names, invalid credential fields, and raw transport messages reduce to one
fixed typed retrieval error. The source owns no logger and writes nothing to
the console.

## Pinned STS composition

`src/core/runtime/deployment-aws-host-client-family.js` exports
`openAwsSingleNodeHostClientFamily({providerScope})`. It validates one exact
provider scope before constructing authority and currently accepts only the
commercial `aws` partition. Noncommercial partitions are modeled elsewhere,
but Wharfie's runtime trust policy and deployment proofs have not been audited
successfully for GovCloud, China, or ISO partitions.

The opener creates exactly one fixed IMDSv2 source and one STS client with:

```text
region:                 providerScope.region
endpoint:               https://sts.<region>.amazonaws.com
maxAttempts:            1
useDualstackEndpoint:   false
useFipsEndpoint:        false
useGlobalEndpoint:      false
credentials:            the one owned rotating provider
logger:                 a private no-op logger
```

The retry strategy is also fixed to one SDK attempt. V67 alone owns the
identity-level bounded retry and conflict-versus-unknown classification.

The explicit endpoint is a trust boundary, not cosmetic configuration. AWS
documents that service endpoint environment variables and shared configuration
can otherwise override an SDK client's destination, while an endpoint set
directly on the client takes precedence. See the
[service-specific endpoint precedence](https://docs.aws.amazon.com/sdkref/latest/guide/feature-ss-endpoints.html)
and the commercial
[regional STS endpoints](https://docs.aws.amazon.com/general/latest/gr/sts.html).
A redirected STS-compatible local service could forge the expected response
tuple; V68 therefore does not inherit `AWS_ENDPOINT_URL`, service endpoint,
FIPS, dual-stack, global-endpoint, region, or retry choices.

`GetCallerIdentity` requires no additional role permission according to the
[STS API contract](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html).
The family forwards only `new GetCallerIdentityCommand({})` and an abort
signal. V67 remains the sole decoder and requires the exact account,
`RoleId:InstanceId`, and assumed-role ARN before settlement.

The returned family is exactly:

```text
{
  providerScope,
  runtimeIdentity: {
    observe,
    validateEvidence
  },
  close
}
```

It exposes no credential source, credentials, IMDS token, SDK client, endpoint
configuration, logger, retry strategy, abort controller, or destroy method.

## Owned shutdown

Calling `close()` fences new observations and evidence validations
synchronously, aborts the lifetime signal, and starts credential-source close
immediately. A V67 observation that was already admitted may complete, but its
retry wait is lifetime-aware: close cancels the wait rather than sleeping
through later attempts.

The memoized close then:

1. waits every admitted observation;
2. destroys the captured STS client once;
3. drains every underlying STS send, including one that ignored abort and
   outlived V67's local timeout; and
4. awaits the canceled and drained credential-source close.

Initialization cleanup is best-effort across any partially created STS client
and credential source. Close attempts all owned cleanup even when one child
fails. Raw construction, provider, send, destroy, and source-close errors
never become public causes or messages; the family exposes only fixed typed
initialization, closed, and close errors.

## Verification and disk hygiene

Final V68 verification used pinned Node 24.13.1 and serial Jest with coverage
and cache disabled:

- the fixed IMDSv2 credential-source suite passed **14 tests**;
- the owned host client-family suite passed **19 tests**;
- the combined V68, V67 identity, V66 activation, and V65 host-contract suites
  passed **83 tests across 5 suites**;
- the documentation command-surface suite passed **9 tests** after the restart
  pointers were advanced;
- all four TypeScript configurations passed;
- changed JavaScript passed ESLint with zero warnings and Prettier;
- package-content verification retained exactly **245 files**; and
- two independent final implementation/security reviews found no remaining
  medium-or-higher blocker after the absolute deadline and valid-cache
  fallback fixes.

Generated coverage, Jest cache, tarball, distribution, and TypeScript
build-info output was not retained. The repository remained about 527 MiB and
the workspace volume had about 22 GiB available during final validation. No
full-repository Jest gate, SEA build, native package build, live IMDS or AWS
call, or native LMDB test was run. Native LMDB remains excluded on this Mac
because its addon has previously terminated the process with an allocator
double-free.

## Honest boundaries

V68 closes the credential-source and STS-destination gaps behind V67, but is
not a complete privileged host:

- `GetCallerIdentity` proves the credentials used for the signed call, not the
  physical machine or current instance-profile attachment independently of
  those credentials;
- cached or exfiltrated valid instance credentials can identify as the same
  role session until AWS expires or revokes them;
- the fixed IMDSv2 source and pinned STS client have focused mocked evidence
  and a real no-network SDK configuration check, but no disposable-EC2 proof
  yet;
- only the commercial `aws` partition is accepted; other partitions require
  audited endpoint metadata, service principals, and successful tests;
- JavaScript credential strings cannot be reliably zeroized, although the
  family does not expose them and clears its retained references on close;
- a faulty SDK implementation that ignores both abort and destroy and never
  settles can keep close pending; V68 does not falsely report that an owned
  operation was drained;
- V68 is not yet wired into a root host command or V66 durable invocation;
- the authenticated controller-head authority transport, root-owned durable
  store, crash-releasing deployment lock, and bounded historical retention
  remain absent;
- application and control storage, artifact projection, service convergence,
  health publication, and final receipt minting remain injected ports;
- the runtime user's IPv4 IMDS denial and disabled IPv6 metadata endpoint are
  contract-tested but still need clean-host enforcement proof and
  defense-in-depth review; and
- privileged host packaging, SSM wakeup, reboot/retry/rotation evidence, and a
  clean-account lifecycle remain unfinished.

## Next implementation slice

Continue connecting V66 to a real privileged host in this order:

1. Implement the authenticated controller authority transport together with
   the root-owned durable local store and deployment-scoped crash-releasing
   lock. Add bounded retention and current-versus-superseded inspection at
   this boundary.
2. Implement separate application- and control-storage adapters. Resolve
   devices from actual volume identity, format only media proven blank, treat
   foreign media as conflict, and use fixed root-owned crash-safe mounts.
3. Fetch the request's exact mandatory S3 VersionId, validate length, SHA-256,
   and artifact ID, then fsync and atomically publish immutable root-owned
   artifact bytes.
4. Converge the fixed `wharfie-runtime` user and restrictive service unit with
   fixed argv and a clean bounded environment. Root must never execute
   application bytes.
5. Connect the existing strict S3 health publisher/readback machinery and
   mint the V65 receipt only from exact settled evidence.
6. Prove crash, timeout, response-loss, retry, credential rotation, reboot,
   supersession, IMDS isolation, and endpoint pinning on a clean disposable
   Linux host.
7. Only then add the root host SEA/command and eventual SSM wakeup. SSM wakes
   the durable protocol; it does not replace it.

## Repository state

The V68 implementation recorded here is commit
`7bdfec0b810abaa84f57bee7c9f4326071655006` on
`agent/strict-manifest`. Its parent restart marker is the V67 checkpoint commit
`9fedb7d4786bc19ba5db2c4214b90d4da652cc4c`. The commit containing this
checkpoint is the new restart marker to publish after the V68 implementation.
The historical `stash@{0}: WIP on master: 3dee66b work prompt` remains
untouched.
