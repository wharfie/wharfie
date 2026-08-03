# Wharfie checkpoint — retained EBS volume resource

- **Date:** 2026-07-21
- **Status:** **PLACEMENT AND STORAGE ARE PINNED; ONE RETAINED EBS VOLUME CAN CONVERGE THROUGH AMBIGUOUS CREATE**
- **Branch:** `agent/strict-manifest`
- **Parent/base head:** `21c096891bd1777b9f56953eaf11dfd9780e5355`
- **Parent checkpoint:** [exact AWS provider-spec resolution](2026-07-21-v25-exact-aws-provider-spec-resolution.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md)

The AWS single-node provider specification now has schema and identity version 2. A fresh incarnation pins not only one exact AL2023 image but also one stable
standard Availability Zone ID that offers the fixed instance type, the exact
account/region default EBS KMS key ARN, and the complete performance,
encryption, device, attachment, and retention contract for both state volumes.
The incompatible content-addressed namespace is deliberately `wap2`; no `wap1`
document is reinterpreted.

This slice also adds the first controller-compatible physical AWS resource
capability: one retained EBS volume can be strictly inspected, created with a
stable EC2 idempotency token and atomic ownership tags, recovered after an
ambiguous create response, and retained explicitly during destroy. The proof
uses deterministic SDK mocks only. A provisioned volume is **not** yet an
attached application/control-state capability or a deployed service node.

## Product scope carried forward

- The first cloud proof remains one trusted managed node. Trustless membership,
  multiple nodes, and automatic coordinator failover are later milestones.
- TypeScript/Node remains the public model and Node SEA the first portable
  packaging backend. Node-API or WASM may later implement measured hot paths.
- Wharfie creates only the finite substrate required by its application
  abstractions; it is not general cloud IaC.
- One coordinator is sufficient initially because provider-backed heads,
  plans, intents, bindings, stage receipts, and health evidence survive its
  process. Explicit recovery remains the current takeover boundary.
- Exactly-once language remains evidence-specific. A stable `ClientToken` plus
  strict readback makes one logical volume-create effect convergent; it does
  not prove an arbitrary EC2 request physically executed exactly once.
- Breaking changes are expected, v1 and provider-spec V1 are abandoned, and no
  downstream compatibility is required.

## Implemented boundary

### Provider-spec schema and identity V2

`AwsSingleNodeProviderSpecV2` uses schema version 2, the domain
`wharfie:aws-single-node-provider-spec:v2`, and the `wap2` ID prefix. The
provider contract remains version 3, and the existing `DeploymentPlanV2` and
`DeploymentInspectionV3` documents continue to embed or bind the complete
provider specification. Because placement and storage fields participate in
the canonical hash, their addition intentionally changes every provider-spec,
plan, and action identity produced for a fresh deployment.

The provider specification adds these exact provider choices:

```text
placement.availabilityZoneId
storage.ebsKmsKeyArn

capabilities.applicationState:
  gp3 / 8 GiB / 3000 IOPS / 125 MiB/s / single attach
  encrypted / device /dev/sdf / DeleteOnTermination false / retain

capabilities.controlState:
  gp3 / 8 GiB / 3000 IOPS / 125 MiB/s / single attach
  encrypted / device /dev/sdg / DeleteOnTermination false / retain
```

The KMS selection is a full key ARN whose partition, region, and account must
equal the provider scope. Alias names and alias ARNs are rejected because AWS
allows an alias to be redirected, while the
[key ARN is a fully qualified key identifier](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#key-id).

### Deterministic placement and exact storage discovery

The credential-bound provider-spec read client now exposes only SSM
`GetParameter` and EC2 `DescribeImages`, `DescribeAvailabilityZones`,
`DescribeInstanceTypeOfferings`, and `GetEbsDefaultKmsKeyId`. It remains a
caller-owned, frozen capability over the authority's one static credential
snapshot and explicit region. It exposes neither credentials nor the SDK
clients' credential-bearing configuration.

AWS documents that account-specific Availability Zone names can map to
different physical zones, whereas
[Availability Zone IDs are stable across accounts](https://docs.aws.amazon.com/ram/latest/userguide/working-with-az-ids.html).
Resolution therefore reads only available standard zones in the exact region
with
[`DescribeAvailabilityZones`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeAvailabilityZones.html),
fully reads the fixed machine type's
[`DescribeInstanceTypeOfferings`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstanceTypeOfferings.html)
pages using `availability-zone-id` locations, intersects the two sets, sorts
the result, and pins its first ID. Provider response order cannot choose the
placement. Pagination, duplicate evidence, repeated tokens, and retry bounds
are handled explicitly rather than converting an incomplete listing to
absence.

Exact validation queries only the pinned zone ID and fixed instance type. It
does not choose a replacement if availability or the offering drifts. Both
resolution and validation also call
[`GetEbsDefaultKmsKeyId`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_GetEbsDefaultKmsKeyId.html)
and require the exact provider-scoped KMS key ARN; changing the regional
default is a conflict instead of an implicit storage migration.

The frozen latest/exact-version AMI behavior from v25 remains intact. Each
placement, offering, storage, SSM, and image stage is bounded and produces the
same typed provider-spec `missing`, `conflict`, or `unknown` outcome family.
None of these reads creates a resource or grants mutation authority.

### Narrow volume mutation authority

`createAwsDeploymentAuthority().createVolumeResourceClient()` is a separate
caller-owned EC2 capability with exactly `createVolume`, `describeVolumes`,
and `close`. It uses the invocation's immutable credential snapshot and
explicit region but is not coupled to the read-only provider-spec client. Its
surface is frozen; construction, closed-client use, and close failure have
fixed boundary errors.

Operation failures preserve only the EC2 classifications needed by the
resource protocol—`IdempotentParameterMismatch` and
`InvalidVolume.NotFound`—plus an integer HTTP status from 400 through 599.
Everything else becomes one fixed volume-resource operation error. Raw SDK
messages, request IDs, access classifications, causes, credentials, and client
configuration do not cross the boundary.

### Controller-compatible retained EBS volume resource

`createAwsSingleNodeVolumeResource(...)` returns the controller's frozen
`executeAction` and `verifySettlement` ports for one exact managed
application-state or control-state volume. It validates the complete
profile/plan/provider-spec/head context, requires the current action and
matching ownership nonce to be the head's one intended action, and accepts
only `create` or retained `noop` actions for an `ebs-volume`. The factory does
not own or close its caller's narrow client.

`getAwsSingleNodeVolumeStateDigest(...)` binds the provider-observable physical
volume fields in its own V1 domain: zone ID, KMS key ARN, type, size, IOPS,
throughput, encryption, multi-attach, and retain policy. It deliberately omits
the instance and requested device because attachment is a later independent
effect. The plan action's `after.stateDigest` must equal that exact digest.

`executeAction` sends one create request whose EC2 `ClientToken` is the intended
action ID. It pins the provider-spec Availability Zone ID, KMS key ARN, `gp3`
size, IOPS, throughput, and encryption choices. It omits
`MultiAttachEnabled` because AWS supports that create parameter only for
`io1` and `io2`; strict readback still requires the fixed `gp3` volume to
report multi-attach disabled. The create supplies 12 reserved scope,
incarnation, action, ownership, capability, and state-digest tags in
`TagSpecifications` on the same API call. Tags are never repaired after an
unowned create. AWS documents these request fields on
[`CreateVolume`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateVolume.html)
and admits `volume` as a
[`TagSpecification` resource type](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_TagSpecification.html).

Create does not trust the mutation response as a durable receipt. A valid
returned volume ID is only a process-local candidate locator. Settlement reads
that ID or an existing binding through an exact `VolumeIds` request to
[`DescribeVolumes`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeVolumes.html)
and accepts only the unique, complete provider state matching the exact scope,
placement, KMS key, volume performance, encryption, multi-attach, no-snapshot/
source/outpost contract, provider state, operator state, attachments, and
reserved tags. Without a durable ID—such as after process loss—it performs a
bounded 16-page, 500-result-per-page discovery using seven exact locator tags,
then requires one unique volume and validates the complete 12-tag contract.
Duplicate IDs, multiple candidates, pagination conflicts, and unknown reserved
Wharfie tags cannot manufacture ownership. The resulting managed binding
retains the exact provider ID, scope, incarnation, resource key, action ID, and
ownership nonce.

When `CreateVolume` has an ambiguous failure, `executeAction` reports the fixed
unknown error and leaves the intended action recoverable. Controller recovery
may repeat the same action and therefore the exact request and `ClientToken`;
fresh-process settlement can also discover the atomically tagged result. AWS
documents that
[the same token and parameters replay one idempotent result, while changed
parameters produce `IdempotentParameterMismatch`](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html).
Any replayed or discovered volume is decided only by strict readback. Exact
readback retries three times by default and at most ten; it is bounded because
AWS also documents
[eventual consistency after resource creation](https://docs.aws.amazon.com/ec2/latest/devguide/eventual-consistency.html).
`IdempotentParameterMismatch` becomes
`AwsSingleNodeVolumeResourceConflictError`; another mutation failure, malformed
provider envelope, or exhausted unknown read becomes
`AwsSingleNodeVolumeResourceUnknownError`. Contradictory present evidence
returns `blocked`; a still-creating or still-missing create returns
`not-converged`. `InvalidVolume.NotFound` is never treated as proof that the
logical managed resource is absent.

A retained `noop`, including destroy planning, revalidates the exact prior
binding but `executeAction` makes no provider mutation; the authority does not
even expose `DeleteVolume`. Settlement still requires the exact provider
object. When no resident-node binding exists it ultimately must be available
and unattached. If that node binding exists, the no-op observation must instead be
`in-use` with one fully attached exact instance/device and
`DeleteOnTermination=false`. The module verifies that attachment evidence but
does not create it. If destroy has already removed the node binding, a matching
attachment to the plan's retired node remains transient until EC2 reports the
retained volume available and unattached. The retained binding therefore
survives the deployment tombstone for future inspection and a separately
designed purge/adoption protocol.

## Crash, concurrency, and authority semantics

- The provider-spec identity changes whenever its pinned placement, KMS key,
  or volume/attachment contract changes. V1 identities cannot authorize V2
  actions.
- Discovery chooses from one complete, bounded zone/offering observation and
  never relies on AWS response order or account-relative zone names.
- Exact validation never substitutes a different zone or KMS key. Drift before
  first acceptance causes zero controller mutation.
- A volume action is intended durably before the resource module receives
  mutation authority. Every retry must carry the same action ID, ownership
  nonce, desired state, and EC2 `ClientToken`.
- Atomic create tags ensure there is no interval in which a successful volume
  exists without the ownership evidence required by strict inspection.
- A lost create response leaves the same logical action recoverable. Replaying
  the exact token and exact parameters or discovering the exact atomic tags,
  followed by authoritative readback, may settle it; changing parameters is
  conflict.
- Provider not-found, malformed, transitional, access-denied, throttled, and
  transport outcomes are not interchangeable. Exact-ID not-found is unresolved,
  contradictory evidence blocks, transitional or missing create evidence is
  not converged, and exhausted unknown evidence throws the fixed unknown error.
- Retention is a positive policy outcome, not an omitted delete call. Destroy
  settles the retained resource without erasing its durable binding.

## What this does not yet prove

- Provisioning an EBS volume alone does not fulfill application or control
  state. A later action must attach the exact volume to the exact node in the
  same Availability Zone, request the specified device, prove attachment and
  `DeleteOnTermination=false`, then arrange host-side format, mount, and state
  wiring. AWS makes the instance ID, volume ID, and device explicit on
  [`AttachVolume`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_AttachVolume.html),
  while retention across termination depends on the
  [delete-on-termination setting](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html).
- The current controller plan settles one logical action around one provider
  effect. The fixed network capability requires multiple independently
  observable effects, and volume attachment is separate from volume creation.
  Wharfie needs explicit action expansion or a durable partial-execution model
  before either path can be represented honestly.
- There is no complete AWS provider driver, resource router, production
  inspection, `createPlan`, composition root, or source/packaged deployment
  command.
- No VPC, subnet, route, gateway, security group, IAM role/profile, EC2 node,
  volume attachment, systemd projection, or application service is created or
  inspected by this slice.
- The privileged host observer remains unimplemented and unwired.
- No live AWS account validates permissions, quotas, eventual consistency,
  idempotency retention windows, KMS policy, AZ capacity, cost, cleanup, or the
  complete clean-account lifecycle.

## Validation and artifact hygiene

Final verification used Node 24.13.1. Direct cacheless, no-coverage Jest passed
all 10 affected suites and all 359 tests. All four TypeScript checks passed:
source, app implementation, tests, and SEA verifier. Targeted ESLint passed for
the 14 changed JavaScript source/test files; Prettier passed for those files
and the five changed Markdown documents. `git diff --check` passed. The final
generated-artifact scan found no coverage, Jest cache, TypeScript build-info,
JUnit, core, or tarball output. After cleanup the repository remained 538 MB,
including 244 MB of intentional `node_modules` dependencies.

No live AWS test is part of this checkpoint. Continue using focused direct
Jest with `--coverage=false` and no cache; the repository `npm test` command
hard-codes coverage. Inspect and remove generated coverage, cache,
TypeScript-build, JUnit, core, tarball, and other disposable build output
immediately after testing.

## Preservation state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`21c096891bd1777b9f56953eaf11dfd9780e5355`, preserving the exact AWS
provider-spec resolution checkpoint. The historical local stash remains
untouched as `stash@{0}: WIP on master: 3dee66b work prompt`. The commit
containing this checkpoint becomes the next restart point after it is pushed
and its exact remote tip is verified.

## Ordered next work

1. Extend the durable plan/action contract so one logical network capability
   can expand into several independently intended, inspected, retried, and
   settled provider effects. Model volume attachment as a separate action with
   its own exact binding and response-loss recovery.
2. Implement the remaining recoverable AWS network, identity, node,
   volume-attachment, managed-artifact, and resident-service resources, then
   build the provider router, inspection, `createPlan`, and complete controller
   composition.
3. Mount source and packaged `plan`, `apply`, `inspect`, `reconcile`, and
   `destroy` commands, requiring apply and reconcile to re-observe the
   currently running SEA.
4. Install the privileged host observer and prove the complete lifecycle in a
   clean account through the user's ordinary credential chain, including
   interruption, response loss, attached-volume retention, and ownership-safe
   destroy.
5. Begin provider-backed coordinator recovery only after the single-node
   lifecycle and control-store fencing are proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v26-retained-ebs-volume-resource.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are fine, v1/provider-spec V1 are abandoned, and
> no downstream users exist. The v25 provider-spec checkpoint is preserved at
> `21c0968`. Provider-spec schema/ID V2 (`wap2`) now pins one deterministic
> standard Availability Zone ID with the exact instance-type offering, the
> exact regional/account default EBS KMS key ARN, and explicit retained-volume
> performance and attachment contracts. The credential-bound authority has
> narrow placement/storage reads and a separate create/describe-volume client.
> The first controller-compatible retained EBS volume resource uses stable
> `ClientToken` create, atomic ownership tags, strict `DescribeVolumes`
> readback, response-loss replay, and an explicit retained destroy no-op. This
> is deterministic-mock proof only: a volume is not attached or mounted, and
> there is no full driver/router/inspection/`createPlan`/composition/commands
> or live AWS proof. First extend the action model for network multi-effect
> execution and separate volume attachment, then implement and compose the
> remaining resources. Preserve trusted-node scope, one-recoverable-
> coordinator semantics, evidence-backed effects, ordinary credential chains,
> exact ownership, focused no-coverage testing, and immediate cleanup of
> generated artifacts.
