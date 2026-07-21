# 0021 — Provider-backed single-node deployment

**Status:** Accepted · **Date:** 2026-07-20

## Context

Wharfie can package a TypeScript CLI as one content-addressed Node SEA, keep
that exact executable resident under a Linux systemd user service, recover its
durable work after process or machine restart, and change between two exact
releases without rewriting the application around containers or a hosted
orchestrator. The next product proof is for that executable to create and
operate its own narrow remote substrate through a user's ordinary provider
credential chain.

The original `DeploymentProfileV1` in ADR 0008 intentionally described only
external references. Reinterpreting `wpr1` as managed infrastructure would
change the meaning of already content-addressed documents. The repository also
contains no general infrastructure graph worth restoring: Wharfie is a finite
application runtime, not a cloud IaC language.

A plan hash or provider-resource tag is not mutation authority. A document can
be internally self-consistent while containing stale or fabricated provider
claims. Likewise, a successful provider response is not enough to recover
after response loss. Deployment correctness needs provider-backed durable
state, optimistic concurrency, explicit ownership receipts, inspection before
mutation, and persisted action intent before each physical effect.

## Decision

### One AWS golden path and one fresh profile namespace

The first provider path is AWS and creates one managed Linux node for the
existing systemd user-service runtime. `DeploymentProfileV2` uses the fresh
`wpr2` identity namespace and has one exact mode:

```text
single-node-systemd-user version 1
```

The profile binds one application, one Linux/glibc x64 or arm64 Node target,
one explicit AWS region, and one fixed versioned capability fulfillment. It
contains no credentials, secrets, environment variables, shell fragments,
user data, arbitrary resource graph, provider-native tags, or caller-selected
template. Unsupported fields fail closed.

The initial fixed fulfillment provides:

- one small managed resident node;
- retained application and control state on encrypted attached storage;
- private provider object storage for exact artifacts, purged on destroy;
- a host identity limited to SSM management, exact artifact reads, and exact
  current service-health object reads and writes;
- public outbound network access with no inbound rule; and
- no managed ingress.

The implementation may use a private, fixed CloudFormation template as its
AWS convergence mechanism. That template is not a public infrastructure
authoring surface. The managed service runs as a non-root user. Host bootstrap
may create that user, enable lingering, install the fixed service projection,
and prevent the application UID from reaching instance metadata. Provider
credentials remain in the ambient operator or host-management boundary and
are never serialized into a profile, plan, inspection, head, artifact, or
application input. Service-health publication belongs to a privileged
host-owned observer outside that application UID; application code cannot
manufacture its own provider-visible readiness proof.

External/adopted nodes, multiple nodes, private-NAT topology, ingress, managed
application secrets, node replacement, and arbitrary provider resources are
refused in this version. Another provider or fulfillment shape requires a new
strict provider contract version rather than optional unvalidated fields.

### Exact deployment and provider identity

`DeploymentRevisionV1` binds one human deployment ID to the exact tuple:

```text
appId
revisionId
artifactId
profileRevisionId
```

Apply and reconcile must read the embedded revision/runtime records from the
SEA that is actually running and hash the held executable bytes. The embedded
application, revision, and target must match the profile and the observed
`artifactId`. A caller cannot redirect that production check to another path.
Destroy does not require historical executable bytes or a sidecar that may no
longer exist; it uses the durable provider scope, deployment head, and exact
ownership receipts.

Resolving the ordinary AWS credential chain produces a secret-free provider
scope containing the partition, account, and region. The stable deployment
instance identity includes that scope, so the same logical deployment in a
different account or region is a different instance. Every mutation
re-resolves the scope and refuses account or region drift.

One invocation resolves the ordinary credential chain exactly once for its
explicit region and copies only the signing identity into an immutable,
invocation-local snapshot that is never returned or persisted. STS scope
checks, portable DynamoDB data access, and the narrow DynamoDB and S3 control
capabilities all use that same snapshot. The public authority exposes neither
credentials nor the SDK client's credential-bearing configuration. S3
failures retain only the allowlisted classifications and HTTP status needed
for authoritative readback, never raw messages, request IDs, or causes.
Repeated scope checks fail closed if the caller identity changes during the
invocation.

Mutable regional prerequisites are resolved only while previewing a new
incarnation and reduced to one secret-free, content-addressed
`AwsSingleNodeProviderSpecV1`. It pins the exact SSM public-parameter name and
version, AMI ID/owner/architecture, bootstrap and runtime-policy digests,
instance and metadata shape, retained-volume and artifact behavior, fixed
network, and service-health timing, publication, and retention.
`DeploymentPlanV2` embeds the complete
specification; every action ID binds its `providerSpecId`, and
`DeploymentInspectionV3` binds the same ID and carries the complete
provider-visible service-health observation when one exists.

Converge and recovery validate the submitted or stored specification and never
resolve “latest” again. A deployment already in `READY` loads the specification
from its last settled plan for update, reconcile, and destroy. Changing the
profile or target inside an incarnation is refused; a fresh apply after destroy
may resolve a new specification.

### Credential-bound provider-spec resolution

The AWS authority exposes one caller-owned read capability containing only SSM
`GetParameter` and EC2 `DescribeImages`. Both clients use the same immutable
ordinary-credential snapshot, explicit region, and provider scope already used
by the rest of the invocation; neither SDK client nor credentials cross the
authority boundary.

Only `resolveProviderSpec` for a new incarnation may read the fixed
architecture-specific AL2023 public parameter without a version selector. AWS
publishes AL2023 AMI aliases under
[`/aws/service/ami-amazon-linux-latest`](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-public-parameters-ami.html),
and `GetParameter` returns both the selected value and positive parameter
version. Unknown SSM failures retry only the identical request; an authoritative
missing result fails immediately. The first well-formed response is frozen as
one candidate before EC2 inspection begins, and later retries never switch to
a newer value during that resolution.

`validateProviderSpec` reads `name:version`, which is AWS's documented exact
[`GetParameter` version selector](https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetParameter.html),
and requires it to reproduce the pinned name, version, and AMI ID before the
new-incarnation controller performs its first mutation. It does not ask for
latest. Both resolve and validate then use
[`DescribeImages`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeImages.html)
for the one frozen AMI ID with Amazon ownership scoped in the request.

One candidate is admissible only when the unique EC2 image is the exact
architecture-specific AL2023 image associated back to the same public SSM
parameter and is Amazon-owned, public, available, Linux, machine-image, EBS
rooted, HVM virtualized, and ENA capable. These checks use the provider's
documented
[`Image` fields](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_Image.html),
not its identifier or SSM value alone. An authoritatively missing SSM
parameter/version is typed `missing`; present but contradictory, multiple, or
paginated evidence is typed `conflict`; and access, throttling, service,
malformed successful envelopes without usable evidence, empty or transitional
EC2 state, or another unresolved read is typed `unknown`. The resolver bounds
each read stage to three attempts by default, with an explicit range of one
through ten attempts. None of these reads creates a resource or grants later
mutation authority by itself.

Each create-to-destroy lifetime has a fresh unpredictable incarnation ID.
Managed resource bindings contain an immutable provider ID, provider scope,
incarnation, logical resource key, creating action ID, and an independently
random ownership nonce. External references, when a later contract admits
them, are verify-only and carry no manufactured ownership. Names and tags by
themselves do not authorize update or deletion.

### Plans are previews, not authority

`plan` performs no mutation. A plan is deterministic for one exact deployment
revision, provider scope, incarnation, head generation, and provider
inspection. It contains a bounded ordered action list and no timestamps or
credentials. The plan and every action are content-addressed so retries can
name the same operation and provider idempotency token.

Structural plan validation proves only that a document is canonical and
internally consistent. Before starting an operation, apply, reconcile, or
destroy must:

1. re-resolve the provider scope;
2. read the exact durable head;
3. obtain a fresh provider inspection;
4. ask the selected versioned provider driver to regenerate the plan; and
5. require the regenerated document to equal the submitted plan exactly.

The driver, not a generic hash validator, owns the finite mapping from profile
capabilities to provider types and desired state. A stale or recomputed
caller-authored plan causes zero physical effects.

The exact accepted plan and immutable deployment profile are stored durably
before the head begins referring to their IDs. A recovering coordinator loads
those immutable documents by ID; it does not require the prior terminal
session to resubmit action details or reinterpret a newer profile contract.

### Provider-backed head and action protocol

Each deployment instance has one provider-backed, linearizable head. Head
writes use full-record compare-and-swap with a monotonically increasing
generation. Creation compares against `NOT_EXISTS`; destruction retains a
positive-generation tombstone, so delete and recreate cannot suffer an absent
state ABA.

The phases are:

```text
CONVERGING -> READY
READY      -> CONVERGING
READY      -> DESTROYING -> DESTROYED
```

`CONVERGING` distinguishes create, update, and reconcile. It records settled
and target deployment revisions, exact resource bindings, the active plan and
operation IDs, a current action cursor, and its ordered intents. `READY` has
one exact settled revision and no active authority. `DESTROYING` retains the
settled revision while removal is in flight. `DESTROYED` has no active or
settled revision, retains the incarnation tombstone and completed destroy
settlement, and may retain bindings for state whose profile policy is
`retain`.

The initial contract refuses a fresh apply from `DESTROYED` while any retained
binding exists. Moving retained state into a fresh incarnation requires a
future explicit adoption protocol that preserves the original provider
identity and ownership receipt; simply clearing the old bindings would lose
authority. A later fresh incarnation is allowed only after no retained binding
remains or such a protocol is accepted.

Every action moves through this durable frontier:

```text
pending -> intended -> settled
```

Future actions remain `pending`. Before one provider mutation, CAS publishes
that action as `intended`, including any preallocated ownership nonce. Only
the current intended action may execute. Immediately before every physical
attempt, the controller re-resolves scope and re-inspects current absence or
the exact bound provider identity, ownership, and state. After the effect, it
re-inspects again and requires exact desired/observed state before one CAS may
store the binding or verified absence, mark the intent `settled`, and advance
the cursor. Provider execution receives the same action ID and nonce on every
retry. Every non-create action identifies one exact existing provider resource,
and update, verify, and no-op actions preserve that identity; node replacement
is not smuggled through settlement.

An error, timeout, permission failure, unreachable node, incomplete listing,
or lost response is never converted into absence. The intended action remains
recoverable and may become visibly blocked. Recovery re-inspects and resumes
the same plan and action; it cannot silently choose an opposite operation.
This protocol claims convergent, idempotent logical effects where the provider
supports the action token and evidence checks. It does not claim that an
arbitrary physical API request executes exactly once.

`resume` is an explicit assertion that the prior coordinator has stopped. It
first CAS-claims the active operation through a blocked recovery boundary, so
only one of two successor sessions may retry the intended action. This initial
one-coordinator contract has no automatic failure detector or lease and does
not authorize takeover while the old coordinator may still be running. A
losing CAS grants no mutation authority. The local ledger-service ownership
record is scoped to one OS principal and is not reused as a distributed
deployment lease.

### Inspection, reconciliation, and destroy

Provider inspection is derived from a fresh head read, exact bindings, provider
observations, and the existing service status proof. A serialized inspection
is evidence for humans and planning, not standalone authorization. `unknown`
and `conflict` are first-class results even when no head or incarnation can be
read. `absent` requires an authoritative provider-locator not-found result;
an empty caller-supplied array is not absence.

One host-owned `DeploymentServiceHealthReceiptV1` may be published to the
deterministic current object
`health/v1/<deployment-instance>/<incarnation>/<node-binding>`. It binds the
provider scope and specification, deployment instance and incarnation, one
stable non-destroy operation plus the head ID/generation that authorized it,
the exact resident-node binding and provider resource ID, deployment and
application revisions, artifact, service and process session, lifecycle and
owner generations, activation record and selection generations, process ID,
and a positive sequence. It can assert only `healthy`. The authorizing head is
not required to remain the exact latest mutable head: a later head may retain
the same target or settled deployment lineage and operation authority.

Every new S3 publication must name the exact current head ID and generation.
After publication, a coordinator head transition may leave that receipt
temporarily useful while the same non-destroy operation and deployed revision
remain current or settled. In that case the retained receipt's older head ID
is host-authored history, while the current operation lineage is the authority
the coordinator can independently revalidate.

Publication writes canonical JSON with SHA-256 checksum and AES256 encryption
to the current versioned S3 object. `If-None-Match` establishes the first
receipt; later writes use the current ETag only as an opaque `If-Match`
compare-and-swap token. ETag is neither content identity nor ordering
evidence. Ambiguous writes, including response loss, are decided by bounded
`GetObject` plus `HeadObject` readback of the current VersionId, checksum,
metadata, encryption, and complete receipt. Within one process session the
sequence must advance by exactly one; a new fenced session restarts at one and
must advance the lifecycle generation. Owner generation is stable inside one
session but may reset after graceful ownership release; the newer lifecycle
generation and session ID remain the cross-session fence. Release changes
require a newer authorizing head, operation, activation record, selection
generation, and session.

Freshness comes from S3's `LastModified`, never a host-authored timestamp. The
pinned provider contract publishes every 15 seconds and admits a receipt only
through 60 seconds of age plus 5 seconds of clock-skew allowance; a provider
timestamp more than 5 seconds in the coordinator's future is conflict. The
inspection `win3` namespace carries the complete receipt and current object
VersionId/ETag/`LastModified` observation. Only an exact, fresh, context-bound
observation can make the resident service healthy, and only that healthy
resident observation can make the whole inspection `converged` or authorize
final readiness.

`converged` requires complete provider-defined capability coverage, verified
ownership, exact desired/observed state, and a resident service status proving
the target artifact and revision healthy. `reconcile` repairs only
non-destructive drift in this version. Missing retained state, unverifiable
ownership, or infrastructure drift that would require node replacement is
blocked rather than recreated automatically.

Destroy regenerates its plan from the current head and fresh inspection,
deletes only exact managed bindings whose ownership is re-proven, never mutates
an external reference, purges artifact resources, and preserves the fixed
retained state volumes. A future explicit purge operation is required before
Wharfie may delete retained state.

Unknown or conflicting inspection evidence cannot authorize any mutation.
Delete requires either the exact present provider identity with verified
ownership or authoritative current absence for that exact durable binding.
Failure to prove the final converged or destroyed inspection leaves the
operation durably blocked even after every action intent has settled.

The reserved packaged surface will be:

```text
<app> wharfie deployment plan
<app> wharfie deployment apply
<app> wharfie deployment inspect
<app> wharfie deployment reconcile
<app> wharfie deployment destroy
```

The same core operations may be mounted by the source CLI. Human and JSON
output follow the existing operator conventions. A web UI remains outside the
initial proof.

## Consequences

- ADR 0008 remains authoritative for revision and artifact identity, but its
  `DeploymentProfileV1` section is superseded for managed deployment by this
  fresh V2 profile. `wpr1` documents are never reinterpreted.
- The first useful cloud proof is deliberately narrower than the full future
  capability model. It can be replaced quickly because there are no downstream
  compatibility requirements.
- One coordinator is sufficient without making its process or node the source
  of deployment truth. A later session can recover the exact persisted plan,
  intent, provider bindings, and tombstone.
- Retained volumes make destroy non-total by design. Status and cost remain
  visible until a separately designed purge operation removes them.
- Multi-node placement, automatic coordinator replacement, fenced scheduling,
  and peer enrollment remain the next mesh milestone after this one-node path
  is proven in a clean account.

## Initial implementation boundary

The first repository slice implements strict V2 profile, deployment revision,
provider scope, binding, plan, inspection, head, and crash-resumable controller
contracts against a deterministic fake provider. The second slice binds the
controller to an explicit, already-created portable DB table whose sole String
partition key is `record_key`. It stores exact bounded envelopes:

```text
record_key
storage_schema_version: 1
record_kind: deployment-head | deployment-plan | deployment-profile |
             deployment-artifact-stage-intent |
             deployment-artifact-stage-receipt
document_id
document
```

Head, plan, profile, stage-intent, and stage-receipt keys use distinct
versioned namespaces. Every read is strongly consistent. Immutable profiles,
plans, intents, and receipts use conditional insertion; head creation and
replacement use conditional transactional writes with the complete prior head
identity as the fence. Conditional collisions are checked against the exact
stored envelope, while ambiguous or system failures remain errors for
caller-driven recovery.

Record inputs and reads are capped at 128 KiB before document validation.
Provider resource IDs are at most 1,024 bytes of JSON-stable printable ASCII,
keeping every structurally valid head and plan well below that bound and
DynamoDB's item limit.

The third slice composes this portable boundary with one credential-bound AWS
invocation authority and a fixed retained DynamoDB table named
`wharfie-deployment-control-v1`. Read-only inspection admits only the exact
account, region, ARN, String `record_key` schema, required reserved tags,
on-demand standard class, deletion protection, AWS-owned encryption, no
indexes/replicas/stream, disabled TTL, and exact 35-day point-in-time recovery.
Explicit bootstrap is the sole mutator: it may create the table or strengthen
PITR, resolves ambiguous responses through bounded exact readback, never
adopts incompatible state, and never deletes the table. Focused SDK mocks prove
the request and recovery boundary; no live AWS resource claim is made.

The fourth slice introduces AWS provider contract version 2 plus fresh `wpl2`
and `win2` namespaces. The immutable provider specification fixes all current
machine-image and fulfillment choices, plans embed it, inspections bind it,
and controller tests prove that only initial preview resolves provider
prerequisites while converge, crash recovery, and resident destroy reuse the
stored specification.

The fifth slice adds one deterministic retained S3 control bucket per provider
scope. Atomic creation tags bind the complete scope; read-only inspection and
explicit bootstrap require the exact owner, region, reserved tags, versioning,
public-access block, bucket-owner-enforced ownership, AES256 default
encryption, and absence of lifecycle, bucket policy, and replication. Before
the first sentinel write, each bootstrap invocation that lacks ready evidence
waits the full 15-minute first-enable propagation interval documented in
[Amazon S3's versioning guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/manage-versioning-examples.html)
and reinspects the complete bucket contract. A retained fixed sentinel must then
prove that object writes actually receive a non-`null` version ID before any
artifact key is used. Bucket state is never weakened or deleted.

Artifact staging has two fresh immutable documents. `wsi1` binds full provider
scope, running artifact digest/size/app/revision/target, deterministic bucket
and `stage/v1/<artifactId>` key, and a fresh ownership nonce. `wsr1` binds that
intent to one exact S3 version, length, SHA-256 checksum, AES256 encryption, and
STANDARD storage. Both use context-bound, conditional portable-store records;
a receipt cannot be written or read without its exact already-persisted intent.

Converge opens and hashes the running executable, cross-checks that held
observation against the SEA's embedded application revision and runtime target,
retains the same descriptor for the sole checksum-protected conditional
`PutObject`, persists intent first, and accepts a receipt only after exact
`HeadObject` readback. Concurrent intent nonces adopt the first complete
semantic intent; ambiguous upload/write responses are resolved through strong
readback. After staging, converge rereads the durable head, revalidates the
pinned provider specification, and regenerates the exact provider plan before
accepting controller state. Recovery needs no local old bytes: it reloads
intent/receipt and revalidates the exact immutable version before claiming the
active head. Destroy deliberately skips staging. Every non-destroy provider
action receives the independently revalidated stage bundle, while a stale or
malformed bundle causes no plan/profile/head mutation.

The sixth slice advances the strict profile/provider contract to version 3 and
the inspection namespace to `win3`. Runtime identity is limited to SSM,
artifact reads, and the exact current-health object read/write boundary.
`DeploymentServiceHealthReceiptV1` and its S3 transport implement the
host-owned health protocol above: complete context and successor validation,
conditional canonical publication, response-loss readback, current VersionId
evidence, provider-owned freshness, and final inspection gating. The retained
control bucket now admits exactly one lifecycle rule: noncurrent versions only
under `health/v1/` become eligible for asynchronous expiration after one day.
The current health version, all artifact-stage versions, and all other retained
control objects remain untouched. As with the preceding slices, deterministic
mocks prove the contract; the privileged host observer is not yet installed or
wired, and no real AWS driver or live resource is claimed.

The seventh slice implements the abstract provider-spec ports with
`createAwsSingleNodeProviderSpecResolver`. Its `resolveProviderSpec` performs
the only unversioned AL2023 public-parameter read permitted for one new
incarnation, retries only an identical SSM request until it has one successful
candidate, freezes that candidate, and proves its exact EC2 image metadata.
Its `validateProviderSpec` instead reads the pinned positive parameter version
and must reproduce the complete content-addressed specification before first
mutation. Both paths use the authority's narrow
`createProviderSpecReadClient`, bounded frozen-candidate retries, strict
Amazon/public/available/Linux/EBS/HVM/ENA/SSM association, and typed
missing/conflict/unknown outcomes. Deterministic SDK mocks prove this read
boundary; no production driver or live AWS resource is claimed.

The production runtime policy must grant only current-object reads and
conditional writes for the deployment's exact health key and deny object or
version deletion; otherwise a delete marker could hide the semantic
predecessor. Noncurrent lifecycle retention also deliberately leaves one
current version at every retired incarnation/node key until a future explicit
retained-state collector proves it may remove that history.

The independently recoverable resource driver, source and packaged deployment
commands, production composition, and clean-account lifecycle proof remain
unfinished. A document, bucket/table tag, SSM result, EC2 description, or
content ID still never proves that an application resource effect occurred.
