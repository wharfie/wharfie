# V71 exact host artifact projection checkpoint

Date: 2026-07-25

Parent:
[V70 authenticated current-head authority](./2026-07-25-v70-authenticated-current-head-authority.md)
(`369fa99e87b79dc9649d6db9b487c2075a1493e2`)

Implementation: `82dd0088a7b9675e6b692750a16624f12f050cd3`

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be
packaged as one portable SEA, run locally, become a durable resident service,
and then be projected into a trusted cloud node without requiring Node,
containers, Kubernetes, or a hosted orchestration service on that node. Its
purpose is to carry an author's intent beyond one interactive LLM session
while keeping the result inspectable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use the operator's ordinary cloud credentials to create the
specific resources needed by a portable application. Node/TypeScript remains
the application and framework language; native Node bindings or WASM may
implement measured hot paths without widening the public authoring model.
Logical exactly-once outcomes require durable intent, exact observations,
conditional settlement, and destination-side idempotency. Physical effects
remain at-least-once and replayable.

V71 completes the first real guest-content effect in the V66 activation
kernel. The privileged host now has one owned, pinned S3 read capability and
one concrete artifact-projection adapter. It reads only the explicit immutable
S3 object version named by the authenticated V65 request, verifies all managed
headers and bytes, and atomically publishes one immutable local artifact
directory. A real V66 integration test drives observe, converge, post-observe,
and settlement through this adapter, including a lost successful `rename`
response.

The host still has no selector delivery, application/control storage adapters,
fixed-user service adapter, health publisher, root command, or packaged host
SEA. V71 does not execute the projected bytes.

## Exact provider read

The artifact adapter issues exactly:

```text
GetObject({
  Bucket,
  Key,
  VersionId,
  ExpectedBucketOwner,
  ChecksumMode: "ENABLED",
  IfMatch
})
```

Every value comes from the already authenticated V65 request. The adapter
never resolves mutable S3 current state, lists the bucket, follows a provider
redirect, or accepts a caller-selected bucket, key, version, account, or ETag.

The response is accepted only when the existing managed-artifact decoder and
an additional exact comparison establish:

- the explicit `VersionId` and ETag;
- complete-object SHA-256 checksum and checksum type;
- exact content length and content-addressed `artifactId`;
- deployment revision, application revision, stage intent, stage receipt, and
  managed state digest;
- deployment instance, incarnation, application, creator action, and ownership
  nonce lineage;
- `AES256`, `STANDARD`, the fixed binary content type, and `no-store`; and
- the complete byte length and SHA-256 digest after streaming to disk.

Provider failures and malformed bodies cross the privileged boundary only as
fixed conflict, timeout, or unknown errors. Raw SDK messages, metadata values,
VersionIds, and ETags are not echoed.

## Owned pinned S3 lifetime

`openAwsSingleNodeHostClientFamily()` now owns S3 beside its existing STS and
DynamoDB clients. It uses the same exact IMDSv2-only rotating credential
source, commercial regional account scope, silent logger, and one-attempt
policy. Its S3 endpoint is fixed to
`https://s3.<region>.amazonaws.com`. Dual stack, FIPS, path-style addressing,
bucket endpoints, acceleration, ARN-region substitution, multiregion access
points, and region redirects are disabled. Request checksum calculation is
`WHEN_REQUIRED`; response checksum validation is `WHEN_SUPPORTED`.

The family exposes only the frozen
`artifactStorage.getObject(input, {abortSignal})` capability. It captures the
original SDK `send` and `destroy` methods, composes caller cancellation with
family shutdown, and retains a family lease after GetObject headers arrive
until a returned Node stream reaches a real terminal state. Close:

1. memoizes and fences itself before reentrant cleanup;
2. closes the credential source;
3. aborts every admitted send and owned response body;
4. waits for operations and response bodies to terminate; and
5. destroys S3, STS, and DynamoDB exactly once.

Stream cleanup distinguishes data completion, close, abort, synchronous and
asynchronous destroy, `emitClose:false`, late `_destroy` failures, and hostile
thenables. `destroyed` alone never proves a body drained. An owned stream that
cannot be terminally accounted for makes family close fail instead of
claiming complete draining.

## Runtime IAM correction

The exact managed artifact is always read with an explicit `VersionId`.
Accordingly, the code-owned runtime policy grants only
`s3:GetObjectVersion` on that one object ARN, with the existing secure
transport and resource-account conditions. AWS documents
`s3:GetObjectVersion` as the required permission for a version-specific
GetObject; `s3:GetObject` is not required for that operation:
[GetObject API permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

The separately unversioned current-health read retains `s3:GetObject`. The
runtime policy template digest is now:

```text
sha256:QkpOaiHXhz7bvfZc3ZruH35LVafg0sJrz7YL31ckrfQ
```

Provider-spec creation and validation, runtime-policy resources, and runtime
evidence all consume the same exported digest. There is no compatibility
migration for a prior unreleased template digest.

## Immutable local projection

Production projection has one fixed root:

```text
/opt/wharfie/app/v1/
  <deploymentInstanceId>/
    <requestId>/
      app
      projection.json
```

Opaque provider identifiers never become path components. The request and
deployment IDs are already strict content-addressed identifiers. The final
layout is owned by root and readable/executable only by the adapter-supplied
runtime group:

- namespace and final directories: `root:<runtimeGid>`, mode `0750`;
- `app`: `root:<runtimeGid>`, mode `0550`, one link;
- `projection.json`: `root:<runtimeGid>`, mode `0440`, one link; and
- in-progress files and directory: root-owned mode `0600`/`0700`.

The adapter refuses symlinks, FIFOs, hard-linked files, foreign ownership,
group/world-writable ancestors, unexpected entries, noncanonical records, and
unsafe namespace drift. Safe root-owned, non-writable bootstrap mode drift is
repairable. Alternate roots exist only as explicit isolated test seams below
the operating-system temporary directory and require the expected UID. The
production root rejects alternate-owner and filesystem seams, fixes ownership
to UID 0, and uses native filesystem operations. The future host composition
must resolve the supplied numeric GID from the code-owned `wharfie-runtime`
group before constructing this adapter.

The local evidence contains only:

```text
schemaVersion, kind, requestId, deploymentInstanceId, appId, artifactId,
revisionId, targetId, contentLength, byteDigest, artifactPath
```

The content-addressed request ID already commits to the complete V65 request.
Raw VersionId and ETag values are deliberately omitted because provider-opaque
values may contain secret-looking text and need not become durable activation
evidence.

## Streaming and bounded work

The object body is streamed through a held `O_EXCL|O_NOFOLLOW` destination
descriptor and hashed while writing. It is never buffered as one whole
artifact. Every write must make progress, the total length may never exceed
the request, and completion must match the exact requested length and SHA-256.
Direct in-memory empty bytes remain valid for an exact zero-byte artifact;
iterator-produced zero-length chunks are rejected immediately so an infinite
microtask stream cannot starve the deadline.

The S3 header/body deadline defaults to five minutes and is bounded at fifteen
minutes. Iterator `next`, `return`, and body destruction are captured and
contained. Cleanup thenables have a fixed 100 ms bound. Unexpected provider or
iterator detail is redacted.

The deployment directory is bounded at 128 entries. Before S3 or local
publication begins, the adapter authenticates all entries, collects only exact
owned `.<requestId>.tmp` directories with bounded known contents, and reserves
one free namespace slot. It never deletes immutable final request directories;
retention for those finals is a separate future owner.

## Crash-safe publication and observation

Publication uses the stable temporary directory
`.<requestId>.tmp`, followed by:

1. fsync, ownership, and final mode for `app`;
2. canonical evidence write, fsync, ownership, and final mode for
   `projection.json`;
3. final directory mode and fsync;
4. atomic directory rename to `<requestId>`;
5. exact final-directory, record, byte-length, and digest readback; and
6. authenticated fsync of every managed directory from the deployment leaf
   through the trusted anchor.

The same final readback decides a lost successful rename response. A failure
after any local mutation remains unknown until the entire authenticated
directory chain can be made durable.

That rule does not depend only on process memory. Every non-null observation
and every existing-final convergence path re-authenticates and fsyncs the full
managed namespace before reporting settled or returning success. A recreated
adapter therefore cannot convert a predecessor's ambiguous directory sync
into a false durable claim.

Observation is local-only and never calls S3. It holds no path-derived file
trust: managed records and artifacts are opened with `O_NOFOLLOW`, authenticated
through their held descriptors, bounded, checked before and after reads, and
verified against the exact request. A stale authenticated temporary directory
makes observation ready rather than settled so convergence can collect it.

## V66 integration

The integration test installs the concrete projection adapter in the real V66
`artifactProjection` port while retaining focused fakes for the other five
stages. It synthesizes a byte-accurate request by recomputing:

- artifact ID;
- deployment-revision ID;
- managed-artifact state digest; and
- final activation request ID.

It intentionally preserves an opaque VersionId containing Unicode, a newline,
and secret-looking provider text. The real kernel reaches `succeeded` through
observe, converge, post-observe, and exact settlement after the filesystem
performs the rename and throws a simulated response-loss error. The test proves
one exact-version download, byte-identical publication, no stable temp,
and no VersionId, ETag, or provider-looking text in evidence.

## V69 restart-durability repair

V71 review found and closed one older process-restart ambiguity in the V69
activation state store. Atomic state-file publication poisoned the current
handle when rename might have committed but the `states` directory fsync
failed. A new process previously authenticated the directory but synced only
its parent before reading records, so process-local poison could be lost.

Initialization now fsyncs the already authenticated exact `states` directory
before acquiring locks or reading records. The existing child-directory
initialization already syncs the fence directory itself, covering fence-entry
durability. The regression proves:

- the original handle remains poisoned;
- a recreated handle still rejects initialization while the exact states
  directory cannot be synced; and
- only a recreated handle that authenticates and successfully fsyncs that
  directory may read the committed state.

## Guarantees to preserve

Later host composition must preserve all of these boundaries:

- the controller's strongly read V70 request/current-head authority remains
  the only dispatch and settlement authority;
- SSM or another wakeup may carry only
  `{deploymentInstanceId,requestId}` selectors, never trusted request bytes;
- artifact selection comes only from the authenticated request's exact S3
  version, not mutable current state;
- no caller or ambient AWS configuration may redirect credentials, region,
  endpoint, retries, bucket, key, version, account, or checksum behavior;
- root may authenticate and publish bytes but must never execute authored
  application code;
- settled local evidence requires byte readback and authenticated full-chain
  directory durability, including after process recreation;
- provider-opaque selectors remain outside durable evidence and public errors;
- fixed immutable finals require a separate explicit retention owner; and
- failures remain conflict, timeout, or unknown rather than optimistic
  success.

## Verification and disk hygiene

Final V71 validation used pinned Node **24.13.1** with cache and coverage
disabled:

- the combined focused matrix at the primary feature commit passed **185 tests
  across 6 suites**, with **1 platform skip**;
- the final production-seam hardening reran the artifact suite **15/15** at the
  implementation tip;
- source TypeScript checking passed;
- test TypeScript checking passed;
- focused ESLint passed with zero warnings;
- focused Prettier passed;
- all changed source modules imported successfully;
- `git diff --check` passed; and
- two independent final reviews found no medium-or-higher artifact,
  integration, IAM, recovery, or secrecy defect.

The six-suite matrix covered the host client family, artifact projection,
durable activation kernel integration, activation persistence, runtime
identity policy contract, and provider spec. The host-client suite passed
48/48; the persistence suite passed 17 runnable tests with one platform skip;
and the integration/IAM/provider-spec review matrix passed 105/105.

Every dedicated Jest cache and fixture root under `/private/tmp` was removed
immediately after its run and confirmed absent. The repository remained about
**528 MiB**. The workspace volume had about **16 GiB** available at the final
implementation gate. Native LMDB, full packaging, coverage, distribution, and
SEA builds were deliberately not run, both because this slice does not alter
those paths and because generated artifacts would consume scarce local disk.

## Honest boundaries

V71 proves a production-shaped exact artifact projection in focused local
tests. It does not yet prove the whole privileged-host lifecycle:

- no live S3, IAM policy simulation, IMDS, disposable AWS account, or regional
  endpoint smoke test was run;
- no disposable root/Linux test has exercised `/opt` ownership, directory
  fsync, process death, reboot, or a real SDK response stream;
- immutable final request directories are bounded but not garbage-collected;
- hashing every observation is correctness-first and may be expensive for a
  large artifact;
- no signature or code-signing claim is added beyond the existing
  content-addressed artifact and managed provider evidence;
- application and control retained volumes are not formatted or mounted;
- no fixed-user systemd service is converged from the projected artifact;
- the adapter requires a positive runtime GID, but no current production
  composition resolves and proves that it names the code-owned
  `wharfie-runtime` group;
- no V3 health receipt is published and no V65 success receipt is minted;
- selector delivery, root host command/SEA, SSM wakeup, bootstrap deployment
  binding, and clean-account proof remain absent;
- the DynamoDB table-resource-policy gap from V70 remains;
- there is no backward-compatible migration for prior runtime policy template
  digests; and
- root compromise or stolen still-valid instance credentials remain explicit
  trust-root failures.

Wharfie still does not claim physical exactly-once execution. An S3 request,
filesystem mutation, mount, systemd operation, application activity, or
external effect may execute more than once. The abstractions must derive
logical exactly-once outcomes from durable intent, exact observation,
conditional settlement, and destination-side idempotency.

## V72 fixed-user service convergence

The next slice should connect the exact projected SEA to the existing packaged
service lifecycle without widening root authority:

1. Implement the concrete V66 `service-convergence` adapter over the existing
   target-enforcing packaged `service converge` semantics.
2. Bind the exact V71 `artifactPath`, desired release, deployment/request
   identity, and fixed `wharfie-runtime` account. Root may own projection and
   service-manager setup; the service process and all authored code must run
   only as the locked unprivileged user.
3. Persist intent before service mutation, independently inspect durable
   service selection and exact live PID/revision health, and recover install,
   repair, update, restart, and response loss without toggling releases.
4. Refuse unexpected units, users, paths, mutable selectors, foreign process
   identity, incomplete activation, and any attempt to execute application
   bytes in the privileged host process.
5. Prove the adapter first through the real V66 kernel and then on a disposable
   Linux host. Keep storage ports injected until their own exact
   format/mount/quiesce contract lands; identify that seam explicitly.

After V72, implement the two retained-volume storage adapters, then the exact
V3 health publisher and V65 success receipt. Only after those concrete stages
work together should Wharfie expose the root host command/SEA, add SSM as
wakeup rather than authority, and run the complete clean-account lifecycle.

## Repository state

The V71 implementation ends at
`82dd0088a7b9675e6b692750a16624f12f050cd3`. Its primary feature commit is
`29add48aeabf0193a7caff15eb10b19ee78543f4`; the tip additionally locks
production projection ownership/filesystem seams to root and native
operations. The commit containing this file is the V71 restart marker. Its
parent restart marker is the V70 checkpoint commit
`369fa99e87b79dc9649d6db9b487c2075a1493e2`; the V70 implementation it records
is `1ccbeafc923a82f9b70b1259e228ff040d6b8fca`.

The branch `agent/strict-manifest` and its upstream matched the V71
implementation before this checkpoint was written. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remains untouched.
