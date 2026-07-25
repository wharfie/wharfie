# V67 live host runtime identity checkpoint

Date: 2026-07-25

Parent:
[V66 durable host activation kernel](./2026-07-25-v66-durable-host-activation-kernel.md)
(`68222ca0d93fabc40835213f0240dbf5e9b508a9`)

Implementation: `2b802e17493ec0cc000ccbbb512b5924e1ff33a0`

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
implemented the pure durable six-stage activation kernel between them. V67
implements the first concrete read-only stage adapter: a live STS projection
that accepts only the exact EC2 instance-profile role session pinned by the
activation request. It does not yet provide the host credential source, the
controller authorization transport, the durable store and lock, or any
physical host mutation.

## Exact adapter boundary

`src/core/runtime/deployment-aws-host-runtime-identity.js` exports
`createAwsSingleNodeHostRuntimeIdentityAdapter(options)`. Its exact factory
surface is:

- `client`, with exactly one own data-property function named
  `getCallerIdentity`;
- `providerScope`, the exact partition, account, and region to which the
  adapter is bound;
- optional `maxAttempts`, defaulting to 3 and bounded from 1 through 10;
- optional `attemptTimeoutMilliseconds`, defaulting to 10,000 and bounded
  from 1 through 60,000; and
- optional `waitForRetry`, primarily an injectable bounded retry wait.

The client method is snapshotted and bound when the adapter is created.
Mutating the caller's client object later cannot replace the capability used
by the adapter. Each provider call receives an empty frozen input and a frozen
options object containing an `AbortSignal`:

```text
getCallerIdentity({}, { abortSignal })
```

The returned frozen adapter has only `observe(context)` and
`validateEvidence(evidence, context)`. It has no converger because runtime
identity is a read-only prerequisite: this stage can settle from current live
evidence, remain unknown, or durably conflict, but it cannot mutate identity
into the desired value.

## Strict V66 context

Every observation and evidence validation revalidates the complete V66
runtime-identity context. The context must have exactly:

- `request`, a canonical V65 AWS single-node host activation request;
- `step`, with the exact request-derived `intentId`, kind
  `runtime-identity`, and `attemptGeneration: 0`; and
- `priorEvidence`, which must be the exact empty object because this is the
  first activation stage.

The request's provider scope must exactly equal the scope bound at adapter
construction. A different region is rejected even though STS caller identity
does not itself report a region. A wrong scope, request, intent, stage,
attempt generation, prior-evidence shape, or extension is configuration or
authority failure and is rejected before any provider I/O. It is not
misclassified as a cloud-state conflict.

This keeps the adapter narrow enough to plug directly into V66. The durable
kernel remains responsible for request authorization, deployment fencing,
state persistence, freshness invalidation, settlement, and replay. V67 does
not duplicate or weaken those boundaries inside an AWS response parser.

## Exact EC2 role-session identity

For a valid activation request, the only settled STS identity is:

```text
Account = request.providerScope.accountId
UserId  = request.runtimeRoleId + ":" + request.nodeProviderResourceId
Arn     = "arn:" + request.providerScope.partition
          + ":sts::" + request.providerScope.accountId
          + ":assumed-role/" + request.runtimeRoleName
          + "/" + request.nodeProviderResourceId
```

This follows AWS's documented [principal-key semantics for a role assigned to
an EC2 instance](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_variables.html):
the caller identity principal ID is the IAM role's stable role ID followed by
the role-session name, and the EC2 role-session name is the instance ID. The
STS ARN uses the documented
[`assumed-role/<role-name>/<role-session-name>` form](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html)
for that same role name and instance-ID session in the request's exact
partition and account.

The request already pins `runtimeRoleId`, `runtimeRoleName`, and
`nodeProviderResourceId`. V67 therefore compares complete strings rather than
accepting a merely plausible account, role ARN, session suffix, or IAM role
ARN. A wrong partition, account, role ID, role name, principal kind, or
instance session cannot become settled evidence.

This is evidence about the credentials used for the live call. It is not a
claim that STS independently attested the physical machine or inspected the
instance's current profile association.

## Live observation and bounded uncertainty

Every `observe` call performs a new STS read. The adapter has no identity
cache, so a previously settled call cannot cause a later observation to
settle after credentials or authority have changed.

Within one observation, transport failures, timeouts, malformed provider
envelopes, and an early well-formed identity mismatch are retried within the
configured bound. The outcomes are deliberately asymmetric:

- an exact well-formed identity returns `settled` immediately with exact
  request-bound evidence;
- a final well-formed but different identity returns `conflict`;
- final transport failure, timeout, or malformed identity returns `unknown`;
  and
- failure of the retry wait also returns `unknown`.

Only a conclusive live identity mismatch becomes a durable conflict. Missing
fields, SDK transport errors, cancellation, hostile response objects, and
other uncertainty cannot prove that a different principal owns the process.
Conversely, provider uncertainty never becomes settled merely because a
previous observation succeeded.

Each attempt has a local timeout race and aborts its signal when the timeout
wins. This bounds the adapter await and therefore V66's local lock residence
even if a client does not settle. The narrow client is required to forward
the signal to its transport; V67 cannot force a faulty injected client to
honor cancellation.

## Strict decoding and redaction

Provider output is decoded without ordinary property access. `Account`,
`UserId`, and `Arn` must each be an enumerable own data property containing a
string. Inherited fields, accessors, exotic prototypes, and failing proxies
are not trusted. Normal SDK metadata and other response fields are ignored
rather than persisted.

This decoder never invokes an identity-field getter, and it contains failures
from any proxy traps encountered while inspecting the response. Provider
exceptions, malformed values, retry failures, and their messages are reduced
to the frozen status `{status: "unknown"}`. Raw error objects, SDK metadata,
credential material, and response extensions do not enter durable evidence.

The adapter factory applies the same capability discipline to the client:
`getCallerIdentity` must be an own data-property function, not an accessor or
inherited method. Evidence validation is independently strict-keyed and
secret-scanned; an extension is rejected without echoing its value.

## Durable evidence

Settled evidence is a bounded, canonical, deeply frozen document with exactly:

```text
{
  schemaVersion: 1,
  kind: "awsSingleNodeHostRuntimeIdentityEvidence",
  requestId,
  accountId,
  userId,
  arn
}
```

The maximum encoded evidence size is 8 KiB. The exported
`validateAwsSingleNodeHostRuntimeIdentityEvidence` reconstructs the expected
identity from the exact V66 context and requires every field to match. Evidence
from an earlier request or another head cannot be relabeled for a later
request, even when most provider fields happen to be identical.

The evidence contains no credentials, session token, SDK request ID, raw
response, or provider error. It is a request-bound observation suitable for
V66 settlement, not an authentication token and not a replacement for
`authorizeRequest`.

## Verification and disk hygiene

Final V67 verification used pinned Node 24.13.1 and serial Jest with coverage
and cache disabled:

- the focused V67 runtime-identity suite passed **24 tests**;
- the combined V67 runtime-identity, V66 activation, and V65 host-agent
  contract suites passed **50 tests across 3 suites** in about **43.085
  seconds**;
- the documentation command-surface suite passed **9 tests** after the restart
  pointers were advanced;
- all four TypeScript configurations passed;
- changed JavaScript passed ESLint with zero warnings and Prettier;
- package-content verification retained exactly **243 files**; and
- independent contract and security reviews were completed, with their
  remaining boundaries recorded below.

Generated coverage, Jest cache, tarball, package-verification, distribution,
and TypeScript build-info output was not retained. Repository and workspace
disk usage were checked after validation: the repository remained about 526
MiB and the workspace volume had about 21 GiB available. No full-repository
Jest gate, SEA build, native package build, or native LMDB test was run. Native
LMDB remains excluded on this Mac because its addon has previously terminated
the process with an allocator double-free.

## Honest boundaries

V67 proves the exact identity of the credentials used for one live STS call;
it is not yet a complete host authority system:

- an EC2 role session identifies a credential session, not the physical host
  or the current instance-profile association independently of those
  credentials;
- cached or exfiltrated instance credentials can produce the same STS
  identity until AWS expires or revokes them;
- the injected client is not yet backed by one concrete IMDS-only credential
  and AWS-client family, so V67 alone cannot exclude environment, shared-file,
  web-identity, or other default credential-chain sources;
- the concrete `authorizeRequest` transport, durable store, crash-releasing
  deployment lock, and authenticated controller-head recovery remain absent;
- when a faulty client ignores `AbortSignal`, the adapter returns after its
  local timeout but the abandoned provider read may remain active in the
  background;
- instance credential rotation or a temporarily stale credential source may
  produce `unknown` or, after the full retry bound, `conflict`; durable
  activation may need to resume after credentials converge; and
- application storage, control storage, artifact projection, service
  convergence, health publication, root command wiring, host SEA packaging,
  SSM wakeup, and clean-account proof remain unfinished.

These limits are deliberate. `GetCallerIdentity` is a narrow live prerequisite
inside the V66 protocol. Treating it as physical machine attestation,
controller authorization, or proof of current provider attachment would
overstate what AWS returned.

## Next implementation slice

Continue connecting V66 to a real privileged host in this order:

1. Construct one shared IMDS-only host credential and AWS-client lifetime.
   Expose only the narrow abort-aware STS port V67 requires, disable unrelated
   credential-chain fallbacks, and reuse that same authority lifetime across
   the later host AWS adapters.
2. Implement the authenticated controller authority transport together with
   the root-owned durable local store and crash-releasing deployment lock.
   Add bounded retention and current-versus-superseded inspection at this
   boundary.
3. Implement separate application- and control-storage adapters. Resolve
   devices from actual volume identity, format only media proven blank, treat
   foreign media as conflict, and use fixed root-owned crash-safe mounts.
4. Fetch the request's exact mandatory S3 VersionId, validate length, SHA-256,
   and artifact ID, then fsync and atomically publish immutable root-owned
   artifact bytes.
5. Converge the fixed `wharfie-runtime` user and restrictive service unit with
   fixed argv and a clean bounded environment. Root must never execute
   application bytes.
6. Connect the existing strict S3 health publisher/readback machinery and
   mint the V65 receipt only from exact settled evidence.
7. Prove crash, timeout, response-loss, retry, credential rotation, reboot,
   and supersession behavior on a clean disposable Linux host.
8. Only then add the root host SEA/command and eventual SSM wakeup. SSM wakes
   the durable protocol; it does not replace it.

## Repository state

The V67 implementation recorded here is commit
`2b802e17493ec0cc000ccbbb512b5924e1ff33a0` on
`agent/strict-manifest`. Its parent restart marker is the V66 checkpoint commit
`68222ca0d93fabc40835213f0240dbf5e9b508a9`. The commit containing this
checkpoint is the new restart marker to publish after the V67 implementation.
The historical `stash@{0}: WIP on master: 3dee66b work prompt` remains
untouched.
