# V40 recoverable AWS managed-artifact checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`9555758fccba69c6c8d19c0434d08b0d6a143a5c`

This checkpoint follows the
[V39 recoverable runtime-identity checkpoint](./2026-07-21-v39-recoverable-runtime-identity.md).
It implements the fixed graph's managed current artifact as one independently
recoverable, controller-compatible S3 resource effect.

## Product direction remains unchanged

Wharfie is a Node-first framework for turning approachable TypeScript CLI
programs with named activities into portable Node SEA executables that can run
locally, remain resident as durable workers, and coordinate work across trusted
machines without requiring Node, containers, Kubernetes, or a hosted
orchestration service at the destination.

The executable may use the operator's ordinary provider credentials to create
the resources required by Wharfie's fixed abstractions. This is not general
cloud IaC, v1 compatibility is abandoned, and there are no known downstream
users. Breaking internal APIs are allowed when they shorten the path to the
intended design. One coordinator is acceptable initially if its durable state
and fencing permit robust recovery after coordinator loss.

## What this slice implements

The V40 slice adds:

- one exact plan-time state digest for the managed current artifact;
- a credential-snapshot-bound S3 authority exposing only conditional copy,
  current/versioned head, version-history list, and exact-version delete;
- the controller-compatible managed-artifact resource with `executeAction` and
  `verifySettlement` ports;
- exact retained-stage VersionId and source-ETag proof before publication;
- destination create/update compare-and-swap and post-mutation readback;
- complete bounded exact-key history validation across prior revisions;
- recoverable intended-create, lost-response, update, no-op, and destroy paths;
- the artifact-only controller exception for recreating a missing current
  object beneath its existing binding; and
- the artifact-only destroy exception that still executes purge when the
  current object is already authoritatively absent.

The driver validates the exact current plan, head, intended action, ownership
nonce, provider scope/specification, profile, deployment revision, and stage
bundle before provider access. It accepts only the fixed `artifact` graph role:
managed, directly owned, dependency-free, `s3-object`, and purged on destroy.

## Stable managed-current identity and desired state

The resource owns one incarnation-scoped key in the retained, versioned control
bucket:

```text
artifact/v1/<deploymentInstanceId>/<incarnationId>/current
```

The exact object ARN is known before apply and is the provider resource ID in
the plan and durable Binding V2 receipt. The ARN remains unchanged across
application revisions, S3 versions, ETags, stage attempts, and legal profile
updates. An update preserves the original binding ID, creating action ID,
ownership nonce, and provider identity.

The desired-state digest uses:

```text
domain: wharfie:aws-single-node-managed-artifact-state:v1
kind:   awsSingleNodeManagedArtifactState
```

It binds the exact provider scope, deployment instance, incarnation, stable
destination, deterministic `stage/v1/<artifactId>` source location,
deployment/profile/application/revision/artifact identities, SHA-256 artifact
checksum, and the ProviderSpec V5 artifact-storage contract. The fixed object
shape is STANDARD storage, AES256/SSE-S3, `application/octet-stream`,
`Cache-Control: no-store`, metadata schema `deployment-managed-artifact-v1`,
and purge-on-destroy.

Provider VersionIds, ETags, observed byte length, stage intent/receipt IDs,
action IDs, and ownership nonces are deliberately excluded from desired state.
They are provider observations or durable operation annotations; the action ID
also depends on the desired state and cannot feed back into it. The `waf1`
artifact ID already commits the complete byte digest. Unsupported digest inputs
are rejected instead of being silently ignored, and the supplied deployment
instance must reproduce the deployment revision plus provider scope identity.

## Narrow S3 authority

`createAwsDeploymentAuthority().createManagedArtifactResourceClient()` creates
one caller-owned S3 client from the invocation's already frozen credential
snapshot, explicit region, and provider scope. Its SDK transport has exactly
one attempt so a hidden SDK retry cannot multiply one authorized copy or
delete. The public surface contains only:

- `copyObject`;
- `headObject`;
- `listObjectVersions`;
- `deleteObjectVersion`; and
- idempotent `close`.

`deleteObjectVersion` refuses a missing, empty, literal `null`, malformed
Unicode, or over-1,024-byte VersionId before SDK access. The authority maps only
the S3 classifications needed for checksum, conditional-write, exact-version,
missing-object, and invalid-storage recovery. Every other failure becomes one
fixed managed-artifact operation error. Raw SDK messages, request IDs, causes,
access details, credentials, and credential-bearing configuration never cross
the boundary.

## Exact staged-version proof

Every non-destroy action receives the independently persisted and revalidated
V23 stage intent/receipt bundle. Immediately before copying, the driver sends
`HeadObject` with `ChecksumMode: ENABLED` for the receipt's exact non-`null`
VersionId and expected bucket owner. The observation must reproduce:

- the exact stage VersionId and a single usable quoted opaque ETag;
- artifact length and SHA-256 checksum;
- the exact five-field stage metadata envelope, including intent, nonce,
  artifact, and digest;
- AES256 encryption, STANDARD storage, and the fixed stage content type; and
- no delete-marker evidence.

Missing or contradictory source evidence blocks before copy. A quoted
multipart-style ETag is accepted as an opaque token. Wildcard, comma/list,
malformed-quote, control-character, non-octet, empty, and over-1,024-byte forms
are rejected; an ETag is never treated as a byte digest, version order, or
durable receipt.

The copy source explicitly appends the URL-encoded receipt VersionId. S3 would
otherwise copy the source key's latest version, so this is part of correctness,
not transport decoration. See AWS's
[`CopyObject` API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html),
which documents exact source-version selection with the `versionId` query and
both source and destination conditional headers.

## Source fencing, destination CAS, and annotation exclusion

Publication is one server-side `CopyObject` request with:

```text
CopySource:       <bucket>/<encoded-stage-key>?versionId=<encoded-VersionId>
CopySourceIfMatch:<exact staged-source ETag>
MetadataDirective: REPLACE
TaggingDirective:  REPLACE
AnnotationDirective: EXCLUDE
ChecksumAlgorithm: SHA256
ServerSideEncryption: AES256
StorageClass:      STANDARD
ContentType:       application/octet-stream
CacheControl:      no-store
```

The request pins both source and destination account ownership. Metadata is
replaced by Wharfie's complete exact ownership, state, application,
byte-length, and stage-provenance envelope. Source tags are not copied and the
copy writes an empty destination tag set. `AnnotationDirective: EXCLUDE`
prevents source object annotations from being copied into the managed
destination; arbitrary stage annotations are not part of resource state or
ownership authority.

A fresh create or an update whose current object is authoritatively absent uses
destination `IfNoneMatch: '*'`. Replacement of an observed predecessor uses
that current version's exact opaque ETag as destination `IfMatch`. The source
ETag independently fences the exact staged version. AWS documents these
destination semantics in its
[conditional-writes guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

Success, `PreconditionFailed`, `ConditionalRequestConflict`, or response loss
is never settlement. The driver rereads the exact destination history and
current version. Only a complete desired observation converges; a conditional
race may adopt the exact desired winner, while incompatible state blocks or
unresolved evidence remains unknown/not-converged for controller recovery.

## Complete bounded history evidence

The stable key is a versioned namespace, not merely its currently visible
object. Before every create, update, or physical destroy, and during settlement,
the driver obtains a complete bounded `ListObjectVersions` view using:

```text
Prefix:       <exact managed-current key>
MaxKeys:      1000
EncodingType: url
page limit:   16
exact-entry limit across versions and markers: 16,000
```

Truncated pages require both a nonempty decoded `NextKeyMarker` and a usable
`NextVersionIdMarker`. Repeated cursor pairs, a seventeenth page, malformed URL
encoding, more than 1,000 returned entries on one page, duplicate opaque
VersionIds, impossible latest flags, or more than 16,000 exact-key entries fail
closed. See the official
[`ListObjectVersions` API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html)
for the paired pagination contract.

The prefix may return sibling keys, but the driver never adopts, heads, or
deletes them. Siblings still consume the fixed page budget, so a hostile or
pathological prefix cannot force unbounded work. For the exact key there must
be exactly one latest entry whenever any version or marker exists.

Every exact-key content version receives its own checksum-enabled `HeadObject`
by VersionId. The listed ETag and length must match that head. The unversioned
current head must in turn match the latest content version, or be absent when
history is empty or the latest entry is a delete marker. Every content version
must have the exact immutable namespace ownership core and a self-consistent
state digest, content checksum, byte length, encryption, storage, content type,
cache policy, no nonzero tag count when S3 exposes one, and forbidden-field
absence. Foreign or malformed history blocks before mutation even if the
current key appears absent.

Only a named current-object `NoSuchKey` or `NotFound` classification is
authoritative absence. `NoSuchBucket`, a status-only 404, access failure, or a
missing exact historical VersionId remains unknown/transitional and cannot
authorize recreate or purge.

## Cross-profile history is authenticated, not rejected wholesale

One deployment instance and incarnation can legally retain managed-object
versions from an earlier profile revision. The immutable ownership core pins
provider scope, deployment instance, incarnation, graph role, original binding
action, ownership nonce, and application ID. Mutable per-version metadata then
records its own deployment revision, profile revision, application revision,
artifact ID, length, stage intent, and stage receipt.

For every historical version, the driver recomputes the state digest from those
recorded references under the current compatible artifact-storage contract. A
prior-profile version with the same deployment identity and self-consistent
metadata is therefore safe to replace or purge. Rewriting only its recorded
profile revision, artifact, checksum, or another field without the matching
digest fails closed. V40 neither assumes all history belongs to the current
profile nor weakens ownership to accept arbitrary historical bytes.

## Fresh create and lost-response recovery

A truly fresh create requires complete exact-key history to be empty. A foreign
content version or even a lone delete marker blocks; current-object absence is
not enough to prove a fresh namespace.

There is one narrow crash-recovery adoption case. If the intended create may
already have crossed the copy boundary, exactly one current content version,
no markers, and no other history may be adopted only when its complete metadata
matches the current creating action, ownership nonce, stage intent/receipt, and
desired state. This recovers process death or a lost `CopyObject` response
without treating an arbitrary occupant as owned.

After any copy attempt, full destination readback decides the outcome. An exact
desired version recovers an ambiguous response. Otherwise the action remains
blocked, unknown, or not-converged according to the evidence; it does not infer
success from the SDK response and does not issue an unguarded overwrite.

## Artifact-only missing-with-binding recreation

Generic controller rules previously required every bound non-delete action to
have present, verified provider evidence. That is too strict for this one
resource because its provider identity is the deterministic stable ARN and its
complete version namespace remains independently auditable after the current
object is externally hidden or removed.

V40 grants only `artifact` an exact exception. A plan must model the repair as
`update`, never as a second create or adoption. Inspection must report
authoritative current-object absence, `ownership: missing`, null provider and
binding observations, null observed digest, and the exact desired digest. The
durable head must still contain the original managed artifact binding and
ownership nonce. Controller execution then re-proves the usual action and
dependency authority before dispatch.

The resource performs the full history audit. Empty history or an exact-key
delete-marker latest state can be repaired with `IfNoneMatch: '*'`; any retained
content must still be owned and self-consistent. Settlement returns the
unchanged durable binding. No other fixed-graph role receives this
missing-with-binding update authority.

## Explicit-version physical purge

S3's ordinary unversioned delete would install another delete marker and leave
the prior content intact. V40 never uses it. After the complete ownership audit,
destroy calls `deleteObjectVersion` for each exact-key entry in this order:

1. nonlatest content versions;
2. nonlatest delete markers;
3. the latest content version, if present; and
4. the latest delete marker, if present.

Each request carries the exact bucket, key, expected owner, and opaque
VersionId. `NoSuchVersion` is compatible with recovery. Any other ambiguous
delete response triggers a fresh full history read: the driver continues only
if that exact VersionId is gone and otherwise returns unknown. Final settlement
requires zero exact-key content versions and zero exact-key delete markers.
Sibling keys are never deleted.

AWS documents that an unversioned delete in a versioning-enabled bucket creates
a marker, while permanent content-version and marker removal requires an exact
VersionId, in
[Deleting object versions from a versioning-enabled bucket](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjectVersions.html)
and the [`DeleteObject` API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html).

The controller also has a matching artifact-only destroy exception. For every
other purge role, authoritative current absence lets the controller skip the
provider mutation. For `artifact`, current absence does not prove noncurrent
versions and markers are gone, so the controller still dispatches execute and
verify. Only the resource's exact-version audit and empty-history proof may
remove the binding.

## No exactly-once fiction

V40 claims recoverable logical resource effects, not exactly-once S3 API calls.
Stable identity, exact stage and destination evidence, source and destination
conditions, immutable metadata, one-attempt transport, complete bounded
history, and readback make retries safe where the destination state is
provable. A mutation response itself is never a receipt.

Malformed or contradictory evidence becomes conflict/blocked. Provider access
failure or structurally unusable evidence becomes one fixed unknown error.
Plausible read races can remain not-converged after bounded retries. ETags stay
opaque CAS tokens and VersionIds stay opaque provider identities.

## What remains intentionally absent

- No substrate EC2 instance or retained-volume attachment driver exists; those
  are the next graph effects.
- The managed artifact, retained volumes, network, and runtime-identity drivers
  are not yet composed into a graph-wide AWS provider, production inspection,
  deterministic `createPlan`, or controller router.
- No source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  command is mounted.
- No privileged host observer or live STS proof confirms that publishing
  credentials are the RoleId/InstanceId session claimed by a V3 health receipt.
- No live-account managed-artifact lifecycle, S3 race, or clean-account proof is
  claimed; this slice is deterministic-mock and contract proof.
- History beyond sixteen pages or 16,000 exact-key entries deliberately blocks
  for explicit repair instead of allowing unbounded provider work.
- Prefix siblings can consume the page budget even though Wharfie never owns or
  deletes them.
- Stage objects and other retained control-bucket history are not garbage
  collected by this resource.
- Annotation exclusion is asserted on `CopyObject`; V40 does not add a separate
  post-copy object-annotation inspection surface.

## Verification commands and disk hygiene

Use pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache:

```sh
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-managed-artifact-resource.test.js

TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-authority.test.js test/runtime/deployment-controller.test.js

env PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run typecheck

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node node_modules/eslint/bin/eslint.js src/core/runtime/deployment-aws-authority.js src/core/runtime/deployment-aws-managed-artifact-resource.js src/core/runtime/deployment-controller.js test/runtime/deployment-aws-authority.test.js test/runtime/deployment-aws-managed-artifact-resource.test.js test/runtime/deployment-controller.test.js

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node node_modules/prettier/bin/prettier.cjs --check README.md ROADMAP.md docs/architecture/decisions/0021-provider-backed-single-node-deployment.md llm/checkpoints/2026-07-21-v40-recoverable-managed-artifact.md src/core/runtime/deployment-aws-authority.js src/core/runtime/deployment-aws-managed-artifact-resource.js src/core/runtime/deployment-controller.js test/runtime/deployment-aws-authority.test.js test/runtime/deployment-aws-managed-artifact-resource.test.js test/runtime/deployment-controller.test.js

git diff --check

find . -path './node_modules' -prune -o \( -name coverage -o -name dist -o -name build -o -name .cache -o -name '*.tsbuildinfo' -o -name '*.tgz' \) -print
```

Final focused V40 gate: **231/231 tests** across the managed-artifact,
AWS-authority, and deployment-controller suites.

Final diff-scoped aggregate regression gate: **629/629 tests** across thirteen
artifact-stage, provider-contract, authority, resource, plan, graph, and
controller suites.

All four source, application, test, and SEA-verifier TypeScript configurations
pass, as do repository JavaScript lint, Prettier, and diff-integrity checks.
The final generated-artifact scan is empty: no coverage tree, Jest cache,
`dist`, build tree, TypeScript build-info file, or package tarball remains.
Repository size is 548 MiB, including 249 MiB under `node_modules`. Do not run
the repository's coverage-producing default test command while preserving disk
hygiene.

## Ordered next work

1. Implement the substrate EC2 node with exact instance-profile association,
   pinned AMI/type/zone, metadata controls, primary ENI/public-address shape,
   block-device contract, bootstrap authority, ownership, response-loss
   recovery, and safe reverse-order purge.
2. Implement the application-state and control-state retained-volume attachment
   effects with exact node/volume dependency lineage, guest devices,
   `DeleteOnTermination=false`, bidirectional provider evidence, and detach
   recovery.
3. Compose all implemented resource effects into graph-wide inspection,
   deterministic planning, provider routing, and controller ports; project and
   mount retained storage and activate the resident service.
4. Mount source and packaged deployment `plan`, `apply`, `inspect`, `reconcile`,
   and `destroy` commands, requiring apply/reconcile to re-observe the currently
   running SEA.
5. Install and wire the privileged publisher, add live STS caller/session proof,
   and prove interruption, response-loss, reboot, and clean-account lifecycle
   behavior through ordinary user credentials.
6. Begin provider-backed coordinator recovery only after the complete
   single-node lifecycle and control-store fencing are proven outside a
   developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v40-recoverable-managed-artifact.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 compatibility is abandoned, and
> the historical stash must remain untouched. The managed artifact owns stable
> key `artifact/v1/<deploymentInstanceId>/<incarnationId>/current` and binds its
> exact ARN, never a mutable S3 VersionId. Preserve exact retained-stage
> VersionId proof, source ETag fencing, destination `IfNoneMatch`/`IfMatch` CAS,
> metadata/tag replacement, annotation exclusion, complete bounded cross-profile
> history validation, response-loss readback, and explicit-VersionId purge.
> Only artifact update may recreate an authoritatively absent current object
> beneath its existing binding, and artifact destroy must still execute when
> current-object inspection is absent because older versions or markers may
> remain. Do not claim exactly-once S3 execution or live-account proof. Next
> implement the substrate node and its two retained-volume attachments, then
> compose the graph-wide provider and deployment commands. Run focused pinned-
> Node tests with coverage and caches disabled, remove generated artifacts,
> commit and push checkpoints, and preserve the historical stash.
