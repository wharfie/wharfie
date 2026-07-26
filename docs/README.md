<h1 align="center">
  <img src="./assets/beanie.svg" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
</h1>

Wharfie is an experimental, local-first TypeScript application runtime. Its
goal is to turn an ordinary CLI into a portable executable, then let that same
application become a durable, observable service across trusted machines
without an architectural rewrite.

The project is being reset around that goal. Wharfie v1's Athena and table
framework is no longer part of the product, and breaking changes are expected.

## The intended path

1. Write and run a normal TypeScript or JavaScript CLI locally.
2. Declare named activities that can be run and observed durably.
3. Package the application as a Node SEA executable for a specific target.
4. Promote that executable to a persistent single-node service.
5. Enroll more trusted nodes when placement or recovery requires them.

The current implementation proves the first four steps on Linux, including a
packaged single-node systemd service that recovers after process death and an
abrupt machine reboot in a disposable Ubuntu environment. That packaged
service also supports serialized, crash-recoverable update and rollback:
Wharfie closes admission, refuses while any durable run remains nonterminal,
retains one exact prior release, and resumes interrupted activation through
`service recover`. Its target-enforcing `service converge` operation lets host
automation make one non-rollback recovery plus install, repair, or update
attempt toward an exact desired SEA. Update runs from the new target SEA and a
fresh rollback runs from the currently selected SEA. After an ambiguous
rollback response, only explicit recovery verifies or finishes the durable
transition without toggling releases.
These activation semantics have focused unit and packaged-manager evidence;
the earlier disposable-host proof did not exercise update or rollback. A
source or packaged command can durably submit one
revision-pinned activity while the worker is offline; the matching single-node
resident later executes requests serially and recovers conservatively after a
process restart. A stale unstarted claim can be rescheduled, while work that
crossed `STARTED` becomes blocked `UNCERTAIN` rather than being redispatched.
Any unresolved managed-effect siblings settle atomically through receipt-only
recovery before that block. The public worker command and hidden packaged
service runtime share this implementation and consume an exact-revision
transactional ready-work locator rather than scanning run history. The strict
manifest also accepts the bounded linear workflow definition from ADR 0019.
The resident executes exact manifest-bound activity continuations, fires
persisted due timers as framework work, persists their outputs, and
conservatively releases `CLAIMED` or blocks lost `STARTED` workflow attempts.
Source `wharfie ops start` and packaged `<app> wharfie start` persist bounded
activity/timer/signal workflow plans. Source `wharfie ops signal` and packaged
`<app> wharfie signal` consume only the current declared signal wait under a
caller-stable delivery ID. The shared exact-run inspection, confirmed recovery,
cancellation, and evidence-reconciliation commands understand the redacted
activation-aware workflow cursor.

This is not yet a complete durable workflow engine. Packaged Linux artifacts
implement a systemd user-service lifecycle with real reboot evidence,
recoverable local activation, and explicit orphan-wiring reconciliation.
Durable activation state is the only authority for reconstructing missing
service projections; physical wiring without it is never adopted. First
install admits already queued work only when it matches the target revision,
and uninstall deliberately retains the `ACTIVE` selection and same-revision
admission so the service can later be rehydrated. An intentional-uninstall
tombstone lets a new target SEA automatically reproject and prove the retained
source before it requests the normal durable update; unexplained missing
projection state still requires the exact selected SEA. Workflow cancellation
has durable cursor authority and
active-owner delivery. Branches, an early-signal inbox, managed-effect workflow
successors, schedules, complete provider-backed deployment, multi-host
leases/heartbeats, and the trusted-node mesh remain roadmap work; Wharfie is
not production ready.

## Start locally

```bash
wharfie app manifest ./path/to/app
wharfie app run <activity-id> --dir ./path/to/app --input '{"who":"cli-user"}'
wharfie ops submit --activity <activity-id> --dir ./path/to/app \
  --idempotency-key <stable-key> --input '{"who":"cli-user"}'
wharfie ops start --workflow <workflow-id> --dir ./path/to/app \
  --idempotency-key <stable-key> --input '{"who":"cli-user"}'
wharfie ops worker --dir ./path/to/app
wharfie ops signal --run-id <run-id> --signal <signal-step-id> \
  --delivery-id <stable-delivery-id> --payload '{"approved":true}'
wharfie app package ./path/to/app
```

The packaged equivalents are `<app> wharfie submit ...`, `<app> wharfie start
...`, `<app> wharfie worker`, and `<app> wharfie signal ...`; they are bound to
the manifest and revision embedded in that artifact and do not accept `--dir`.
Signal delivery accepts only the current wait. `early-signal`,
`unexpected-signal`, and `late-signal` are durable, exactly replayable
rejections rather than a buffered inbox. Exact-run `inspect --json` emits the shared schema-v7 redacted trigger,
activation-aware cursor, timer, signal-wait, and signal-delivery lifecycle;
confirmed `recover` and evidence-backed `reconcile` use the same safe view.

The source CLI also mounts an experimental provider-backed lifecycle:

```text
wharfie deployment plan <deployment> --profile <canonical-profile.json> --control-policy <policy> [--dir <app-dir>] [--output-dir <package-dir>] [--json]
wharfie deployment apply <deployment> --profile <canonical-profile.json> [--dir <app-dir>] [--output-dir <package-dir>] [--control-policy <policy>] [--json]
wharfie deployment apply --plan <plan.json> [--control-policy <policy>] [--json]
wharfie deployment inspect <deployment-instance> --region <region> [--control-policy <policy>] [--json]
wharfie deployment reconcile <deployment-instance> --region <region> [--confirm-coordinator-stopped] [--control-policy <policy>] [--json]
wharfie deployment destroy <deployment-instance> --region <region> [--control-policy <policy>] [--json]
```

These are the only five deployment leaves. A canonical DeploymentProfileV2 is
operator input outside the manifest, and the commands use the ordinary AWS
credential chain without serializing credentials. Source plan/direct apply
package and durably pre-stage a selected SEA; source `apply --plan` and
reconcile consume exact durable staged evidence. Generated SEAs mount the same
leaves at `<app> wharfie deployment ...`, accept neither `--dir` nor
`--output-dir`, and use the running SEA for plan, apply, and non-destroy
reconcile authority. Active destroy recovery remains durable-only.
The supported `@wharfie/wharfie/deployment-profile` Node authoring API creates
the canonical profile and its `wpr2` identity. Source plan JSON is reusable
only on source `apply --plan`; packaged plan JSON is reusable only from the
exact matching SEA. Their artifact-authority envelopes intentionally do not
cross surfaces.
Plan requires an explicit control policy because source planning may package,
stage, and create bootstrap control state. Direct apply defaults to `bootstrap`;
prepared apply, inspect, reconcile, and destroy default to `require-active`.
Source `apply --plan` rejects `--dir` and `--output-dir`. Scalar selectors may
be supplied only once. An operation that returns a correlated but still-active
head fails as incomplete rather than being reported as successful.

The command surface is not a clean-account or deployed-service-readiness
claim. The strict content-addressed privileged-host request/receipt contract
and its pure injected durable activation kernel are now defined. Its first
concrete adapter now proves the live STS runtime identity from the exact EC2
role session; provider uncertainty remains bounded and redacted. One owned
host-only AWS lifetime now supplies rotating credentials through a fixed IPv4
IMDSv2 token flow, pins the commercial regional STS, DynamoDB, and S3
endpoints and one-attempt policy, cancels and drains active work and S3
response bodies, and exposes only the identity, activation-authority, and
artifact-read adapters.
One production persistence boundary now supplies the V66 four-method store,
deployment lock, bounded retention, fence-aware inspection, and draining close.
It requires Linux with real and effective UID 0, fixes state beneath
`/var/lib/wharfie/host-activation/v1/<deploymentInstanceId>`, and accepts no
caller redirection of that root. Initialization now fsyncs the authenticated
record-bearing directory before reading, so predecessor rename ambiguity
cannot escape through process-local poison. The inspection `authority` field
classifies only the durable local fence relationship. Independently, the
controller now publishes one complete V65 request at a stable DynamoDB key
only while its exact all-settled head remains current and after fresh
managed-artifact evidence. The host strongly reads that request first and
current head last for selector resolution and every V66 authorization purpose.
The concrete artifact adapter reads only that request's explicit S3 VersionId
under `s3:GetObjectVersion`, verifies the complete managed-object envelope and
bytes, and atomically publishes an immutable fixed-path SEA. Exact final
readback and authenticated full-chain fsync recover rename and process-response
ambiguity without persisting opaque VersionId or ETag values in evidence.
The fixed `wharfie-runtime` account, root-owned launcher, Status V3 desired
convergence proof, and fail-closed service-repair authorization are now
concrete. Retained application/control storage now has exact contracts, a
closed Linux inspection observer, one shared two-mount gate, recoverable
deactivation authority, an immutable format-history contract, and an
authenticated host-lock-scoped journal. Integration with real V66/V69
persistence proves that a synthetic stable blank-media observation may durably
publish only the non-destructive `prepared` prerequisite after a definite
attempt, fresh dispatch authorization, and current local fence; it deliberately
remains pending and cannot format or claim settlement. A separate
repository-only preflight now double-reads and fingerprints fixed AL2023 OS,
configuration, and tool paths without executing a command or accepting a
filesystem path, and without touching a device, calling AWS, or publishing raw
configuration bytes. Its receipt is non-authoritative and has not run on a live
host.
Selector delivery, destructive formatting and exact-profile verification,
mounting, control-storage convergence, health publication, production host
assembly, deactivation execution, and a clean-account provider lifecycle proof
remain unfinished.

The shipped source top-level CLI contains `app`, `ops`, and experimental
`deployment`. Continue with the
[installation guide](./guides/installation.md), [quickstart](./guides/quickstart.md),
and [application structure guide](./guides/application-structure.md). The
[project charter](../PROJECT.md), [roadmap](../ROADMAP.md), [architecture
decisions](./architecture/decisions/README.md), and [project-reset
record](./project-reset/2026-07-16-cleanup-inventory.md) remain the authoritative
contract, delivery sequence, design constraints, and historical cleanup
evidence.

The latest recorded restart handoff is the [read-only host toolchain
fingerprint
checkpoint](../llm/checkpoints/2026-07-25-v78-read-only-host-toolchain-fingerprint.md).
Its parent is the [authorized storage preparation
checkpoint](../llm/checkpoints/2026-07-25-v77-authorized-storage-preparation-command.md),
whose parent is the [closed blank-format preparation
checkpoint](../llm/checkpoints/2026-07-25-v76-closed-blank-format-preparation.md),
whose parent is the [retained-storage format journal
checkpoint](../llm/checkpoints/2026-07-25-v75-retained-storage-format-journal.md),
whose parent is the [retained host storage
checkpoint](../llm/checkpoints/2026-07-25-v74-retained-host-storage-boundary.md),
whose parent is the [desired service convergence
checkpoint](../llm/checkpoints/2026-07-25-v73-desired-service-convergence-proof.md),
whose parent is the [fixed-user service convergence
checkpoint](../llm/checkpoints/2026-07-25-v72-fixed-user-service-convergence.md),
whose parent is the [exact host artifact projection
checkpoint](../llm/checkpoints/2026-07-25-v71-exact-host-artifact-projection.md),
whose parent is the [authenticated current-head authority
checkpoint](../llm/checkpoints/2026-07-25-v70-authenticated-current-head-authority.md),
whose parent is the [root host activation persistence
checkpoint](../llm/checkpoints/2026-07-25-v69-root-host-activation-persistence.md),
whose parent is the [owned host AWS lifetime
checkpoint](../llm/checkpoints/2026-07-25-v68-owned-host-aws-lifetime.md),
whose parent is the [live host runtime identity
checkpoint](../llm/checkpoints/2026-07-25-v67-live-host-runtime-identity.md),
whose parent is the [durable host activation kernel
checkpoint](../llm/checkpoints/2026-07-25-v66-durable-host-activation-kernel.md),
whose parent is the [host activation contract
checkpoint](../llm/checkpoints/2026-07-25-v65-host-activation-contract.md),
whose parent is the [target service convergence
checkpoint](../llm/checkpoints/2026-07-25-v64-target-service-convergence.md).
One CLI-free lifetime now composes the fixed retained controls, durable store,
artifact stager, complete V57 provider, and controller. It exposes read-only
control inspection and require-active, existing-only reconciliation that can
never create, and separately explicit bootstrap. Top-level deployment
inspection returns an exact frozen absent or hydrated envelope without
ProviderSpec selection, planning, staging, writes, CAS, or effects. Inspection,
plan, ordinary converge, pre-staged converge, and resume require both controls
to be freshly active. Close fences new calls, waits for entered work, and
closes the AWS family once.
The finite operation runner snapshots one exact request before credentials,
selects explicit require-active, reconcile-existing, or bootstrap policy,
dispatches one operation, and unconditionally closes that lifetime with
ordered operation/cleanup failure precedence.

A closed source-packaging path can now mint an empty frozen token whose private
WeakMap state binds exactly one fresh generation-backed SEA record to one
retained descriptor. That token creates one deployment revision from the same
held-byte observation and can be claimed or discarded only once. It does not
survive JSON, IPC, or a process exit.

The source-deployment boundary now transfers that claim into the invocation
stager without an intervening await. The stager verifies the complete V61
record, revision, runtime, held-byte observation, deployment revision, profile,
and provider scope before durably accepting it, and closes the descriptor on
every outcome. `prepareAwsSelectedSeaPlan()` returns only a frozen, JSON-safe
`{plan, profile, artifactStage}` after the exact intent, object version, and
receipt are durable and revalidated. `applyAwsSelectedSea()` stages once and
passes the same bundle to `convergePreStaged()`. The one-shot runner's
`converge-pre-staged` operation lets a later process validate that supplied
bundle against durable evidence without opening or falling back to the running
SEA. Ordinary `converge` remains the packaged running-SEA path.

Source and packaged deployment commands now preserve that artifact-authority
split. Exact guest artifact projection is now implemented and
integration-tested behind the privileged host contract. Fixed-user desired
service convergence and authorized non-destructive retained-storage
preparation are also component- and activation-integration-tested with injected
host observations; retained preparation additionally exercises real V69
persistence. The command-free/device-free V78 host fingerprint collector is
implemented but has not run on AL2023. Before formatter code, the next priority
is portable source-bound delivery and controller-side provider evidence,
followed by explicitly authorized disposable AL2023/real-EBS evidence for the
exact toolchain, filesystem profile, device-path races, interruption, reboot,
and detach/reattach behavior.
Formatting/profile verification, persistent mounts, control storage, and the
privileged health publisher then precede a complete clean-account proof.
Mounted commands alone make no service-readiness claim.

The V63 checkpoint's parent is the [durable selected SEA plan
checkpoint](../llm/checkpoints/2026-07-24-v62-durable-selected-sea-plan.md),
whose parent is the [selected SEA artifact authority
checkpoint](../llm/checkpoints/2026-07-24-v61-selected-sea-artifact-authority.md),
whose parent is the [one-shot deployment operation runner
checkpoint](../llm/checkpoints/2026-07-24-v60-one-shot-deployment-operation-runner.md),
whose parent is the [read-only deployment inspection
checkpoint](../llm/checkpoints/2026-07-24-v59-read-only-deployment-inspection.md),
whose parent is the [owned AWS deployment invocation
checkpoint](../llm/checkpoints/2026-07-24-v58-owned-aws-deployment-invocation.md),
whose parent is the [production AWS provider assembly
checkpoint](../llm/checkpoints/2026-07-24-v57-aws-provider-assembly.md), whose
parent is the [InspectionV6 aggregate and controller
checkpoint](../llm/checkpoints/2026-07-24-v56-inspection-aggregate-controller.md),
whose parent is the [complete AWS resource observers
checkpoint](../llm/checkpoints/2026-07-24-v55-complete-aws-resource-observers.md).
The managed artifact, substrate node, and both retained-volume attachments now
join the earlier observer families at the shared mutation-incapable raw
boundary. Artifact evidence audits the complete exact-key version namespace;
node evidence joins exact instance, attribute, credit, ENI, and root-volume
proof; and attachment evidence joins exact instance and volume views. Among
these final V55 families, only the node may recommend a current-create replay,
and only through its exact stable EC2 client token after a completely clean
bounded history. All 18 graph roles have read-only adapters.

The V55 checkpoint's parent is the [runtime IAM observers
checkpoint](../llm/checkpoints/2026-07-24-v54-runtime-iam-observers.md). The
direct role and instance-profile observers preserve deterministic names,
immutable provider IDs, complete ownership tags, and supported child
inventories. The derived policy and role/profile association retain exact
dependency lineage and independent list, document, and membership evidence.
Readable physical differences carry actual digests, and no IAM create emits
replay advice without a provider token.

That checkpoint's parent is the [derived network observers
checkpoint](../llm/checkpoints/2026-07-23-v53-derived-network-observers.md).
The gateway attachment, default IPv4 route, and subnet/route-table association
share pure provider evidence with their mutation drivers while retaining
read-only ports. Their observers re-prove exact endpoint-binding lineage,
independent provider views, natural-slot collision and absence semantics, and
synthetic receipt identities. Current-create emptiness remains unknown, and
none emits replay advice without a provider client-token guarantee.

The derived-network checkpoint's parent is the [route-table observer
checkpoint](../llm/checkpoints/2026-07-23-v52-route-table-observer.md). The
directly owned route table shares strict provider evidence with its mutation
driver while keeping mutation authority and response candidates private. Bound
reads use only the durable ID; current-create presence requires the settled VPC
receipt plus complete locator and independent exact-ID agreement. Its parent
digest excludes the separately modeled default route and subnet association. A
completely clean empty current-create history stays unknown but may carry
`replay-safe-create` through the exact stable `CreateRouteTable` token.

That checkpoint's parent is the [subnet and security-group observer
checkpoint](../llm/checkpoints/2026-07-23-v51-subnet-security-group-observers.md).
Those two directly owned resources add dependency-bound natural-slot
corroboration to the shared read-only evidence model. Current-create presence
requires stable locator, VPC-local natural slot, and independent exact-ID
agreement. Durable bindings are still read only by exact ID, physical drift is
hashed from actual state, and unbound candidates remain collisions rather than
adoptions. An early create history without its VPC binding cannot prove
natural-slot absence. Neither create API accepts a client token, so neither
observer emits replay advice.

The subnet/security-group checkpoint's parent is the [tagged-EC2 VPC and
internet-gateway observer
checkpoint](../llm/checkpoints/2026-07-23-v50-tagged-ec2-vpc-gateway-observers.md).
A stateless tagged-EC2 evidence layer now supplies exact tags, bounded locator
discovery, exact reads, and collision proof without admitting mutation state.
The VPC and standalone gateway observers revalidate V48 authority before I/O,
read durable bindings only by exact ID, refuse unbound adoption, and never
offer replay advice for their non-idempotent create APIs. The VPC hashes actual
CIDR, tenancy, default, IPv6, DNS, and block-mode state so readable drift stays
distinct from ownership conflict. Bound NotFound remains unknown, while
unbound no-action absence requires an entirely clean empty history.
Observation authority also rejects settled create, update, or no-op receipts
whose durable binding disappeared, and rejects settled deletes that remain
bound, before either observer can perform provider I/O.

That checkpoint's parent is the [retained-volume observer
checkpoint](../llm/checkpoints/2026-07-23-v49-retained-volume-observer.md).
Both retained EBS volume roles share their strict evidence decoders with one
read-only observer. A completely clean current-create scan may separately
carry `replay-safe-create` only because the exact action and nonce reproduce an
idempotent `CreateVolume` client token.

That checkpoint's parent is the [AWS resource-observation authority
checkpoint](../llm/checkpoints/2026-07-22-v48-aws-resource-observation-authority.md).
One pure exact eleven-field constructor now validates a desired deployment
tuple, non-null durable head, nullable active and last-settled plans, and one
V45 target. It recreates the full desired catalog, admits exactly one member,
and derives that role's durable binding. READY requires the plan named by its
last settled operation; an initial active create requires only its active plan;
resident active operations require both. The settled plan pins ProviderSpec
lineage, while an active plan must reproduce the controller's operation kind,
plan ID, strictly older basis generation, settled revision basis, target
revision, ordered actions, and durable intent IDs. Only a target-local
`intended` frontier with exact action state, binding, dependency, and nonce
reachability exposes its action and ownership nonce; `pending` remains
inspectable without action authority. Null heads stay the aggregate absent fast
path, and DESTROYED reincarnation fails through a fixed unsupported result.

V48's parent is the [AWS resource-observation boundary
checkpoint](../llm/checkpoints/2026-07-22-v47-aws-resource-observation-boundary.md).
One strict seven-field result now separates exact provider presence,
authoritative absence, provider uncertainty, ownership conflict, normalized
observed state, raw resource health, and narrow execution advice. Exact present
evidence is correlated to the fixed graph's provider type; absent and unknown
evidence cannot carry identity or state. An eventually consistent empty read
therefore remains unknown; only an exact routed managed/direct current create
with a canonical action ID and ownership nonce may additionally carry
`replay-safe-create`. Service-level healthy status is deliberately outside
this raw boundary. One immutable router accepts only 16 exact one-method
observer families, maps all 18 graph roles, forwards one original context
without fanout, validates the awaited result against its routed role, and
admits no mutation or client-close method. The existing action drivers still
need read-only authority adapters; this checkpoint does not claim aggregate
InspectionV5.

V47's parent is the [deterministic AWS deployment planning
checkpoint](../llm/checkpoints/2026-07-22-v46-deterministic-aws-deployment-planning.md).
One pure boundary accepts exactly the controller's nine `createPlan` fields and
combines the desired-resource catalog with its already context- and
freshness-validated InspectionV5 evidence. It emits a complete deterministic
18-action PlanV3 whose basis names the exact inspection, head generation, and
settled revision. Null-head apply creates in graph order. READY apply or
reconcile no-ops exact resources, updates only the deterministic artifact,
creates only absent unbound roles, and refuses adoption or unsupported repair
through a fixed non-echoing error. Destroy reverses the graph into 16 purge
deletes plus two retained-volume no-ops and can reconcile provider effects that
are already ahead of durable READY state. The planner performs no provider I/O,
clock sampling, or random generation.

Its parent is the [AWS desired-resource targets
checkpoint](../llm/checkpoints/2026-07-22-v45-aws-desired-resource-targets.md).
That pure seven-key boundary projects the exact deployment revision, profile,
provider scope, ProviderSpec, deployment-instance ID, incarnation ID, and
nullable durable head into a deeply frozen, apply-ordered 18-role target
catalog. It derives every desired digest fresh and carries an existing provider
ID forward only after complete binding, graph, context, lineage, and direct or
derived identity revalidation. The managed artifact ARN is the sole
preallocated provider ID; observations, adoption, and speculative non-artifact
IDs are outside this boundary. V45's parent is the [AWS resource action router
checkpoint](../llm/checkpoints/2026-07-22-v44-aws-resource-action-router.md).
One immutable controller action boundary constructs the 16 implemented
resource drivers once over six caller-owned narrow clients and routes every
one of the fixed graph's 18 resource keys. It forwards the original authority
context without cloning or weakening it, never fans out, and rejects malformed
or unknown routes with one fixed non-echoing error before a handler runs. The
router deliberately owns no credentials or client lifecycle. V44's parent is
the [recoverable retained-volume attachments
checkpoint](../llm/checkpoints/2026-07-22-v43-recoverable-volume-attachments.md).
One generic controller-compatible driver implements both derived graph roles:
application state at `/dev/sdf` and control state at `/dev/sdg`. Each synthetic
relationship identity binds its exact retained volume, substrate instance,
fixed device, EBS card zero, `DeleteOnTermination=false`, and purge lifecycle.
The driver re-proves the exact volume/substrate binding receipts and their
complete upstream closure before any provider call.

Create uses exact `AttachVolume`, independent exact instance and volume reads,
and exact `ModifyInstanceAttribute` when the two views do not yet prove
`DeleteOnTermination=false`. Only matching attached/in-use pair, device, card,
and retained-delete evidence settles the effect, so lost attach or modify
responses recover through readback. No-op fails closed if an externally removed
settled relationship is absent. Because V43 never mounts or uses either device,
destroy may detach the exact relationship from a running or stopped node, but
always sends `DetachVolume` with `Force:false`; busy, detaching, and lagging
`in-use`/no-row evidence is retryable, while no one-sided sample settles
deletion. Typed endpoint absence
must retain one identical signature through the full bounded retry window,
while dual exact present views with no attachment settle delete immediately.
The slice does not format, mount, unmount, or quiesce a guest filesystem;
future guest use must
add a quiesce/unmount or stop dependency before detach. Read-only driver
observation adapters, aggregate inspection, owned provider composition, and
command wiring remain unfinished. Fresh apply from a DESTROYED tombstone is
also unsupported until the retained-binding requirements shared by
InspectionV5 and the controller are reconciled. The attachment checkpoint's
parent is the [recoverable AWS substrate-node
checkpoint](../llm/checkpoints/2026-07-22-v42-recoverable-substrate-node.md).
