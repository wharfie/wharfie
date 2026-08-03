# Wharfie checkpoint — recovery-safe artifact staging

- **Date:** 2026-07-20
- **Status:** **THE RUNNING SEA HAS DURABLE, EXACT S3 OBJECT-VERSION EVIDENCE BEFORE DEPLOYMENT ACCEPTANCE**
- **Branch:** `agent/strict-manifest`
- **Parent/base head:** `fafad814fb61a498b49fc04db25c55b291dc5ed7`
- **Parent checkpoint:** [pinned AWS provider specification](2026-07-20-v22-pinned-aws-provider-spec.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md)

Wharfie can now reduce the exact executable running the deployment command to
one retained, provider-visible S3 object version before a non-destroy plan is
accepted. Intent is durable before upload, every ambiguous network/store result
is resolved through strong exact readback, and a recovering coordinator can
revalidate the immutable version without the historical executable remaining
on its local filesystem.

This checkpoint implements and tests the boundary under deterministic AWS and
portable-store doubles. It does **not** claim that a live AWS bucket, object,
node, or service exists.

## Product scope carried forward

- Nodes are trusted; a trustless mesh remains out of scope.
- TypeScript/Node is the public model and SEA is the first portable packaging
  backend. Native Node-API or WASM may later serve measured hot paths.
- Wharfie exposes finite application/deployment capabilities, not general IaC.
- One coordinator is sufficient initially because plans, stage evidence,
  action intents, bindings, and heads are provider-backed durable truth.
- Exactly-once claims remain evidence-specific: Wharfie persists intent first,
  uses conditional provider operations, and exposes unresolved ambiguity.
- Breaking changes are expected, v1 is abandoned, and no downstream
  compatibility is required.

## Implemented boundary

### Held running executable

`openHeldArtifactSource()` opens one canonical absolute executable path, hashes
through positional reads, and retains that same descriptor for one bounded
upload stream. BigInt device/inode/size/mode/mtime/ctime evidence detects
mutation; path replacement cannot redirect the stream. The observation,
one-shot stream, post-stream verification, and idempotent close lifecycle are
all explicit. Before intent creation, that same held observation is
cross-checked with the SEA's authoritative embedded application revision and
runtime target; caller-authored app/revision/target labels cannot be attached
to genuine but semantically different bytes. Production staging uses
`/proc/self/exe` on Linux and the actual process executable elsewhere.

### Immutable stage documents and portable records

`DeploymentArtifactStageIntentV1` (`wsi1`) binds:

- the complete provider scope;
- exact artifact ID, SHA-256 digest, byte length, app, logical revision, and
  build target;
- deterministic bucket/key
  `wharfie-dc-v1-<account>-<scope-hash>/stage/v1/<artifactId>`; and
- a fresh unpredictable ownership nonce.

`DeploymentArtifactStageReceiptV1` (`wsr1`) binds the intent and artifact to
one opaque, non-`null`, well-formed Unicode S3 VersionId (at most 1,024 UTF-8
bytes), exact length and SHA-256 checksum, AES256 server-side encryption, and
STANDARD storage. Single-Put staging is capped at 5 GiB.

The portable deployment store adds strong, conditional namespaces:

```text
artifact-stage-intent/v1/<providerScopeId>/<artifactId>
artifact-stage-receipt/v1/<stageIntentId>
```

A receipt API requires the complete intent, strongly proves that exact intent
already exists at its canonical key, context-validates receipt-to-intent, and
only then writes or exposes the receipt. An orphan or standalone-valid but
intent-mismatched document cannot poison the immutable receipt slot through
the store capability.

### Retained S3 control bucket and authority

The invocation-local AWS authority now issues a frozen caller-owned S3 facade
from the same static credential snapshot and explicit region used by STS and
DynamoDB. It exposes only the bucket/object operations needed here plus an
idempotent close. Raw credentials, SDK clients/configuration, provider
messages, request IDs, and causes remain hidden; consumers receive only
allowlisted error classifications and an HTTP status when required for
readback.

The deterministic retained bucket lifecycle has read-only `inspect` and sole
mutating `bootstrap` operations. It requires exact expected owner, region,
reserved provider-scope tags, enabled versioning, all public access blocked,
bucket-owner-enforced ownership, AES256 default encryption, and no lifecycle
configuration, bucket policy, or replication configuration. Creation applies
ownership tags atomically. Existing incompatible or ambiguously observed
buckets fail closed and the module never deletes the bucket or weakens its
configuration.

Configuration status alone is not object-version readiness. Bootstrap retains
one exact zero-byte `control/v1/versioning-ready` sentinel and requires strong
HeadObject evidence of a usable non-`null` VersionId before reporting active.
Before its first sentinel write, every bootstrap invocation without ready
evidence conservatively waits the full 15-minute first-enable propagation
interval documented in Amazon S3's
[versioning guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/manage-versioning-examples.html),
then reinspects the whole bucket. A restart therefore starts a fresh safe
interval rather than trusting lost local time. An absent
sentinel is conditionally created; an exact unversioned sentinel may be
overwritten with the same fixed bytes after the barrier. Lost responses and
transient 404s use bounded readback/retry, and a later invocation can resume
safely without touching an artifact key.

### Conditional upload and controller enforcement

`createDeploymentArtifactStager()`:

1. validates deployment revision, profile, and provider scope;
2. opens and hashes the running executable, then cross-checks that held
   observation against the embedded app, revision, and runtime target;
3. creates a candidate intent and conditionally persists it;
4. strongly adopts only the winner's full semantic intent under a concurrent
   nonce race;
5. reuses an existing exact receipt or performs one `PutObject` with
   `If-None-Match: *`, exact ContentLength, precomputed SHA-256 checksum,
   AES256, STANDARD, fixed content type, expected bucket owner, and exact
   intent/nonce/artifact/digest metadata;
6. validates the returned exact version, or the current version after an
   ambiguous response, through checksum-enabled `HeadObject`; and
7. persists and rereads the context-bound receipt before returning a frozen
   `{intent, receipt}` bundle.

ETag is never treated as a digest. Existing receipts are always revalidated
against their exact VersionId. The stager never deletes objects or closes its
caller-owned S3 client.

The deployment controller now requires an artifact-stager port. Non-destroy
converge rejects an already-stale preflight, stages before plan/profile/head
acceptance, then rereads the durable head, revalidates the pinned provider
specification, and regenerates the exact provider plan to close the upload
window. It independently revalidates both stage documents, then supplies that
same bundle to every provider execute/verify call. Resume revalidates the exact
retained version before its first recovery CAS. Destroy skips stage reads and
passes `artifactStage: null`, so safe removal never depends on old bytes.

## Crash and concurrency semantics

- A crash before durable stage intent causes no object write.
- A crash after intent but before object creation resumes the same semantic
  intent; concurrent candidate nonces adopt the first complete durable intent.
- Upload response loss, conditional collision, and concurrent equivalent work
  are decided by exact current HeadObject evidence, not by the call result.
- Receipt response loss is decided by a strong context-bound store read.
- A crash after stage receipt but before head CAS may retain an unused input
  object, but it grants no active deployment authority and is safe to reuse.
- Once the head is active, recovery validates the stored exact S3 version
  before claiming work. It never resolves latest, uploads old bytes again, or
  trusts the current object in place of the receipt's version.
- The control bucket and stage objects are intentionally retained in this
  slice. No garbage collection, purge, or lifecycle rule is implied.

## Explicit limitations and next prerequisites

- Production composition does not yet wire authority, table, bucket, store,
  stager, provider driver, and operator commands together.
- The host-owned provider-visible service-health receipt is still required
  before a real node can prove the intended artifact/revision is healthy.
- The AWS provider-spec resolver/validator and independent network, identity,
  volume, managed-artifact, and resident-node capabilities remain unfinished.
- No live-account S3 behavior or complete clean-account create/recover/destroy
  lifecycle has been proven.
- Retained-stage garbage collection, retained-state purge/adoption, ingress,
  node replacement, multiple nodes, and automatic coordinator leases/fencing
  remain later work.

## Validation and artifact hygiene

Focused Jest is always invoked directly with `--coverage=false`; the repository
`npm test` script still hard-codes coverage. Source/test typechecks, targeted
ESLint/Prettier, and diff checks cover the new boundary. The final combined
runtime regression pass is 13 suites and 248 tests; all four TypeScript project
checks also pass under the repository-pinned Node 24.13.1 runtime.

No validation output was left behind: there is no `coverage/`, `.nyc_output`,
Jest cache, or TypeScript build-info artifact. The only ignored `dist/` match is
the pre-existing empty scratch-example directory. Dependency installation
added only the S3 SDK path needed by this slice; after validation the repository
is 506 MB including a 214 MB `node_modules` tree.

## Preservation state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`fafad814fb61a498b49fc04db25c55b291dc5ed7`, preserving the pinned-provider-spec
checkpoint. The historical local stash remains untouched as
`stash@{0}: WIP on master: 3dee66b work prompt`. The commit containing this
checkpoint becomes the next restart point after it is pushed and its exact
remote tip is verified.

## Ordered next work

1. Define and implement the host-owned provider-visible service-health receipt
   and bind incarnation, node, artifact/revision, session, head/activation
   generations, monotonic sequence, and provider-controlled freshness.
2. Implement the exact AWS provider-spec SSM/EC2 resolver and validator.
3. Implement the fixed AWS driver as independently recoverable network,
   identity, retained-volume, managed-artifact, and resident-node capabilities
   with exact ownership/readback behavior.
4. Compose authority, retained table/bucket, store, stager, driver, and
   controller behind source and packaged deployment operator commands.
5. Prove clean-account create, interruption recovery, update/reconcile,
   ownership-safe destroy, and retained-state reporting through ordinary user
   credentials.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v23-recovery-safe-artifact-staging.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are fine, v1 is abandoned, and no downstream
> users exist. The exact provider spec plus retained DynamoDB table/S3 control
> bucket, held-running-SEA stage intent, and exact immutable S3 object-version
> receipt are implemented under focused mocks. Non-destroy converge must stage
> before plan/head acceptance and regenerate provider authority afterward;
> resume revalidates the receipt version; destroy
> needs no historical bytes. No live AWS resource claim has been made. Next
> implement the host-owned freshness-bounded service-health receipt, then the
> exact AWS resolver/validator and independent-capability driver. Preserve
> trusted-node scope, one-recoverable-coordinator semantics, evidence-backed
> effects, ordinary user credential chains, exact ownership checks, focused
> no-coverage testing, and immediate cleanup of generated artifacts.
