<h1 align="center">
  <img src="./docs/assets/beanie.svg" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
  <br>
  <br>
</h1>

<p align="center">
  <a href="https://github.com/wharfie/wharfie/actions/workflows/ci.yml"><img src="https://github.com/wharfie/wharfie/actions/workflows/ci.yml/badge.svg" alt="Wharfie CI"></a>
</p>

> **Project reset:** Wharfie's v1 Athena/table implementation has been removed. Wharfie remains experimental, and breaking changes are expected while the new application model is made coherent.

Wharfie is a local-first TypeScript application runtime that turns an ordinary CLI into a portable executable, then lets that same application become a durable, observable service across trusted machines without an architectural rewrite.

The product goal is continuity:

1. Write and run a normal CLI locally.
2. Mark named operations as durable activities.
3. Package the application as one approachable executable.
4. Promote it to a persistent service on one machine.
5. Add schedules, workflows, retries, and durable state.
6. Enroll more trusted nodes when placement or resilience requires them.
7. Inspect, intervene in, update, and roll back the application through the same executable.

No separate service rewrite, preinstalled Node runtime, Dockerfile, Kubernetes cluster, or hosted orchestration service should be required on the target machine.

Inside a packaged application, normal argv belongs to the application. Wharfie
reserves only `<app> wharfie <command>` for operator commands; internal service
startup uses a private environment-selected runtime command instead of
consuming public commands.

Local and single-node use should require no external Wharfie control plane. The initial automatic coordinator-failover design does depend on a linearizable durable store.

The abandoned v1 source and dependency graph have been deleted. The strict v2
manifest and the append-only V10 run → invocation → attempt → effect ledger
are now defined; the superseded mutable Operation/Action snapshot store is
gone. The manifest can declare a bounded plain-data linear workflow, and the
internal ledger can atomically create a workflow run headed by an activity,
timer, or signal wait with its immutable plan and start payloads, stable cursor
and activation identities, run-directory entry, and any cursor-bound
ready-work row. The resident claims, starts, and executes exact manifest-bound
ordinary workflow activities and fires exact due timers as framework work,
atomically persisting each output and next activation or terminal cursor. The
ledger's redacted per-service history directory is transactionally bound to
every run transition. Its exact-revision ready-work projection is bound to each
relevant manual activity, workflow activity, recovery, and timer transition,
while
revision-backed source and SEA activities consume
one frozen target dependency closure instead of ambient `node_modules` or a
newly resolved npm tree. Exact-run inspection, confirmed recovery, and
authenticated current-owner cancellation use one shared source/SEA operator
layer; packaged commands bind authority to their embedded application identity.
Source `wharfie ops run` and packaged `<app> wharfie run` now also use one
durable activity host. The source adapter supplies a sealed prepared revision;
the packaged adapter accepts only its cross-checked embedded manifest and
revision/runtime pair and exposes no source-directory override. Operator and
private runtime dispatch choose their path before authored CLI code is loaded.

That host now supports durable submission separately from execution. Source
`wharfie ops submit` and packaged `<app> wharfie submit` persist an exact
app/revision activity request even when no worker is running. If the matching
resident is live, submission reaches it through the authenticated local-owner
command endpoint; otherwise a short-lived exclusive owner appends the same
`RUNNABLE` invocation and exits. Source `wharfie ops worker` and packaged
`<app> wharfie worker` run the first single-node resident activity worker, and
the hidden packaged service runtime delegates to that same implementation. The
worker accepts only its exact app and revision, executes one physical attempt
at a time, and consumes the bounded ready-work projection only as a locator
before rebuilding and claiming from authoritative ledger state. On restart it
can release and
reschedule a stale `CLAIMED` attempt that never started; a stale `STARTED`
attempt becomes blocked `UNCERTAIN` work and is never silently redispatched.
If that stopped attempt retains unresolved managed effects, the resident uses
the same source-free compound recovery boundary: `PENDING` siblings are
cancelled, `STARTED` application-state siblings are probed read-only for their
permanent receipts, and the exact set settles atomically before the run blocks.

Foreground durable `ops run` and resident execution share an authenticated
current-owner cancellation path. Source `wharfie ops cancel` and packaged
`<app> wharfie cancel` can reach only the exact live, same-principal LMDB owner
of a `STARTED` manual attempt. The required stable `--request-id` is reused
after a lost response. That owner persists intent before beginning physical
delivery; an inactive, stale, unreachable, or resident owner that is not
running the exact attempt never triggers a direct-write fallback. A verified
completion or failure may still win the ledger race, while ambiguous
post-cancellation termination becomes blocked `UNCERTAIN` work. Blocked work
can now be resolved only through an explicit, evidence-backed reconciliation
event: a complete bounded Activity Protocol
transcript proves one retained abandoned attempt's terminal outcome, while the
physical attempt itself stays `ABANDONED`. The local command transport is not
yet supported on Windows. V10 carries forward verifier-backed managed effects
through the framed source/SEA worker boundary and exposes one finite public
operation: `application-state` / `put-if-absent`. Its LMDB destination
atomically commits the business value with a permanent effect receipt.
Confirmed source/SEA operator recovery and resident restart recovery now settle
the complete active-effect set—at most 16 unresolved effects—for one stopped
attempt under the held LMDB owner. A retained `PENDING`
request becomes `CANCELLED` without opening application state; every `STARTED`
sibling is probed read-only, with an exact receipt becoming `COMPLETED` or
`FAILED` and strict absence becoming `UNCERTAIN`. One append-only transaction
applies all sibling dispositions and blocks the arbitrary stopped activity
attempt. Unsupported, missing, or corrupt destination evidence leaves the whole
set unchanged. Recovery never reruns application or adapter code. Destination-
finalized reconciliation can now resolve one retained `UNCERTAIN` built-in
effect without resolving the abandoned activity. One narrow public successor
policy can authorize a fresh application-state V2 `put-if-absent` target only
after the exact source effect is permanently `NOT_APPLIED`. Its dedicated
effect-only lifecycle starts fresh target identities and never redispatches the
abandoned authored activity. The source stays `BLOCKED` / `UNCERTAIN`.

The public packaged command's Node-absent relocated-SEA crash/recovery matrix
passes across every successor publication and transaction boundary, including
redaction and response-loss replay. Generic handler retries, compensation,
scheduled workflow starts, and wider exactly-once claims remain unfinished.
Earlier V8 real-child coverage exercises seven source/core durable-run
`SIGKILL` boundaries and three mixed-set recovery
boundaries. A relocated SEA with Node absent from `PATH` proves the complete
eight-boundary managed-effect matrix, three-boundary mixed-settlement matrix,
and four-disposition effect-reconciliation matrix, including exact orphan-
payload reuse and LMDB owner recovery. Those paths never dispatch authored
app/CLI/activity code or the normal adapter. The resident activity vertical now
persists offline submissions, executes serially, recovers conservative restart
states, and drains gracefully through the transactional ready-work index. The
internal linear workflow path is durable and rebuildable; the resident now
executes exact manifest-bound activities, fires persisted due timers without
Activity Protocol dispatch, persists outputs, advances the cursor atomically,
releases unstarted claims after restart, and blocks lost started attempts
without redispatch. Source `wharfie ops start` and packaged
`<app> wharfie start` persist activity-, timer-, or signal-headed manifest
workflows. Source `wharfie ops signal` and packaged `<app> wharfie signal`
deliver one stable, current-wait-only signal decision through the same local
owner boundary. The shared exact-run inspection, recovery, cancellation, and
evidence-reconciliation commands understand the activation-aware cursor and
schema-v7 redacted timer/signal lifecycle state. Managed-effect workflow
successors and schedules remain unfinished. Packaged Linux artifacts now have
a recoverable systemd user-service
install/converge/update/rollback/recover/start/stop/restart/status/uninstall
lifecycle.
A single local coordinator serializes release changes, closes durable work
admission, requires every existing source run to be terminal during update or
rollback, and retains one exact rollback candidate before it changes the
executable selection. First install separately admits already queued work for
the exact target revision. Interrupted activation is resumed explicitly from
durable phase state. In addition to focused repository tests, a checksummed
Ubuntu proof builds three distinct SEAs from the installed npm tarball and
covers exact-unit startup, resident `SIGKILL` replacement, abrupt VM power
loss, pre-login recovery, durable workflow continuation, all five post-commit
update and rollback boundaries, all five failed-target source-restoration
boundaries, ambiguous-response recovery, and state-preserving uninstall.
Multi-host leases and heartbeats and public run history/listing are still later
work. The npm package remains deliberately private. It is not ready for
production use.

The first provider deployment authority is now defined. A strict AWS-shaped
one-node profile now resolves one schema-V6, `wap6` content-addressed provider
specification that pins the exact regional AMI, parameter version, sole EBS
root mapping and snapshot, a stable standard Availability Zone ID that offers
the fixed instance type, and the exact regional/account default EBS KMS key
ARN. The same document owns the complete on-demand instance, private-DNS,
primary-ENI, encrypted root-volume, metadata, and lifecycle shape plus the
code-owned bootstrap and runtime-policy digests. It also pins explicit retained-volume
performance and attachment contracts, network, service-health timing, and the
content ID of one fixed 18-role physical-resource graph. Runtime identity is
four independently recoverable effects: an IAM role, its derived inline
policy, an instance profile, and their derived association. DeploymentPlanV3
expands the small portable capability model into one independently recoverable
action per graph role, while DeploymentInspectionV6 binds present ownership to
exact BindingV2 dependency lineage, distinguishes authoritative absence from
access failure, and content-addresses narrowly bounded create-replay advice
without treating it as provider truth. Apply and reconcile use one canonical topological order;
destroy reverses it, retaining state volumes while purging their attachments.
Dependent creates re-prove earlier settled dependency authority, destroy
re-proves prior purges at every later frontier, and finalization requires each
role's exact planned state or absence.
The provider/profile contract remains version 3. Only a fresh incarnation resolves mutable
provider prerequisites; converge, resume, and resident update/destroy reuse
the pinned document. Running-SEA deployment identity, exact provider scope and
ownership bindings, and a CAS deployment head support crash-resumable
convergence against a deterministic fake. The AWS boundary also resolves one
ordinary credential-chain snapshot for an explicit region and bootstraps the
fixed retained DynamoDB control table. These AWS calls are proven under
focused mocks, not a live account. That credential snapshot now also exposes a
narrow SSM/EC2 provider-spec read capability. Only a new incarnation resolves
the architecture-specific AL2023 latest parameter; converge validates the
pinned parameter version and exact Amazon-owned, public, available,
Linux/EBS/HVM/ENA image association, exact pinned zone/instance offering, and
exact default EBS key without selecting a newer default or replacement zone.
Frozen-candidate bounded retries distinguish missing, contradictory, and
unresolved provider evidence. The same snapshot also exposes narrow
caller-owned S3, EBS-volume, and IAM/EC2 runtime-identity capabilities. Wharfie
can bootstrap one retained,
versioned control bucket with no bucket policy, wait through S3's documented
first-enable propagation interval, persist an immutable stage intent before
streaming a held SEA descriptor, and accept only exact
checksum, encryption, metadata, and non-`null` object-version readback. The
held bytes are also cross-checked against their exact app, revision, and
runtime target. Packaged converge stages and proves the currently running SEA.
Source preparation instead transfers one freshly selected SEA descriptor into
the same stager, returns only after its exact intent, object version, and
receipt are durable, and can later converge through an explicit pre-staged
path that never falls back to the running Node executable. Resume revalidates
the retained version without historical local bytes, while destroy
deliberately does not require it. The fixed graph's managed artifact now has one
incarnation-stable S3 identity at
`artifact/v1/<deploymentInstanceId>/<incarnationId>/current`; its exact ARN,
not an allocated object version, is the durable provider binding. Create and
update revalidate and server-side copy the receipt's exact staged VersionId,
fence that source with its ETag, and use destination `If-None-Match: *` or the
current ETag as `If-Match`. Settlement comes only from exact current-version
readback. Before mutation, the driver walks the complete bounded exact-key
version and delete-marker history and validates every content version's
immutable ownership and state. Destroy purges every owned entry by explicit
VersionId. The artifact is the sole graph role that reconcile may recreate
under an existing binding after authoritative current-object absence; it does
so as a conditional update only after the retained history is safe.

A host-owned provider-visible V3/`whr3` health receipt
now binds the exact deployment, operation/head lineage, running release,
service session, durable generations, process, and heartbeat sequence to both
the resident-node binding/EC2 instance ID and runtime-role binding/immutable
IAM RoleId. Its one current S3 object is addressed exactly as
`health/v3/<RoleId>:<InstanceId>`. A sequence-one publisher attempts the
conditional `PutObject` before any read, then resolves every outcome through
bounded exact `GetObject` plus `HeadObject` readback; later successors use the
current ETag as an opaque compare-and-swap token. The transport never lists
objects and does not require `ListBucket` to prove first-publication absence.
The current object supplies version and `LastModified` freshness evidence, and
only a fresh context-bound receipt can make Inspection V6/`win6` converged.
The exact `health/v3/` bucket lifecycle makes noncurrent health versions
eligible for asynchronous expiration after one day without collecting the
current receipt or staged artifacts. This boundary is proved under
deterministic mocks. It does not yet prove the publishing caller's live STS
identity or wire the privileged production publisher. The first
controller-compatible resource module can create one exact retained `gp3`
volume with a stable EC2
`ClientToken` derived from the durable action and exact ownership nonce, apply
atomic ownership tags, recover an ambiguous response through controller replay
or bounded tagged discovery plus strict `DescribeVolumes` readback, and make
retention an explicit no-op.
The eight implemented network-effect drivers create, discover, strictly
validate, and purge the fixed VPC, internet gateway and attachment, subnet,
route table, default route, subnet association, and application security
group. Direct resources use the shared tagged recovery kernel while derived
relationships bind exact endpoint lineage; duplicate or contradictory
provider evidence blocks rather than being adopted, deleted, or described as
provider exactly-once execution.

The four runtime-identity drivers independently create and recover one
EC2-only IAM role, its exact least-privilege inline policy, one tagged instance
profile, and their bidirectionally verified membership. ProviderSpec V6 owns
the policy-template digest; callers cannot substitute one. The concrete policy
grants only the modern Session Manager channels, the exact managed-artifact
object, and role-session-scoped V3 health reads and conditional writes, while
denying health deletion. Every privilege-bearing step re-proves immutable IAM
IDs, ownership, trust, policy shape, and dependency lineage. Profile deletion
also fences role membership and current-region EC2 use; the account-global IAM
profile relies on Wharfie's explicit exclusive-profile/single-region contract.

The node launch prerequisite is now code rather than a caller-supplied hash.
One bounded, deterministic EC2 user-data contract creates the locked
`wharfie-runtime` account and fixed directories, enables lingering and the SSM
agent, and installs a root-owned systemd restriction that denies the runtime
user-manager subtree access to IPv4 instance metadata. It intentionally
downloads no application and starts no application service before the retained
volumes are attached.
The credential snapshot also exposes a separate single-attempt node authority
containing only launch, stopped-node recovery, exact instance, attribute,
CPU-credit and root-volume reads, termination, and `close`. The recoverable
substrate driver consumes that authority: it binds the eight fixed direct
dependencies, launches one exact instance with a replay-stable token and atomic
instance/root-volume ownership tags, and settles only from bounded tagged
discovery plus independent exact readback. Running evidence proves an
Amazon-owned, auto-assigned public IPv4 association, while every later non-root
mapping must preserve `DeleteOnTermination=false` so node termination cannot
implicitly delete a retained descendant. A stopped owned node is validated and
restarted in place. Destroy repeats the complete instance and root-volume proof
before termination. Delete settles only after an exact owned `terminated`
record or typed exact-ID instance absence is joined with terminal root evidence:
bounded root-tag discovery is empty, or it identifies one exact owned
unattached `deleted` tombstone. When a root ID remains available but no deleted
tombstone does, typed `InvalidVolume.NotFound` is required and a successful
empty exact response remains unknown. Joint bounded instance- and root-tag
absence must remain stable through the configured retry window and covers
provider tombstones that have both aged out. The two derived retained-volume
attachment roles now share one generic controller-compatible driver and a
separate single-attempt EC2 authority. Their content-addressed relationship
identity binds the exact retained volume, substrate instance, fixed device,
card zero, `DeleteOnTermination=false`, and purge lifecycle; their durable
bindings record only the exact volume and substrate receipts after the complete
upstream closure is re-proved.

Attachment convergence is evidence-driven rather than response-driven. Create
issues exact `AttachVolume`, re-reads both the instance block-device mapping and
the volume attachment, applies exact `ModifyInstanceAttribute` when
`DeleteOnTermination` is not yet false, and settles only when both views agree
on the pair, device, card, attached/in-use state, and retained delete behavior.
This recovers lost attach or modify responses without claiming API-call
exactly-once execution. A durable no-op whose relationship disappeared blocks
instead of silently recreating externally removed state. Reverse destroy can
detach the exact relationship from a running or stopped node because V43 never
mounts or uses either device, but it always sends `Force:false`. Busy,
detaching, and a lagging `in-use` volume after both attachment rows disappear
remain retryable; no one-sided sample settles absence. Typed endpoint absence
must repeat with the identical
instance/volume/both signature through the full bounded retry window, while
dual exact present views with no attachment can settle delete immediately.
One immutable action router now composes all 16 resource-driver factories over
six caller-owned narrow clients and maps every one of the 18 graph resource
keys to exactly one handler. The two volume roles share one volume driver and
the two attachment roles share one attachment driver; all other roles retain
their distinct handler. The router forwards the original controller authority
unchanged, never fans out, owns no clients, and rejects malformed or unknown
routes through one fixed non-echoing error before resource I/O. Each selected
driver still performs the complete action, intent, scope, ownership, and
dependency proof.

One pure desired-resource boundary now projects the fixed graph into a deeply
frozen, apply-ordered 18-role target catalog. Its exact seven-key input is the
deployment revision, profile, provider scope, provider specification,
deployment-instance ID, incarnation ID, and nullable durable head. Every
desired digest is freshly derived from that authority. Existing bindings are
reused only after their complete graph, context, lineage, and direct or derived
provider identity have been revalidated. The managed artifact ARN is the sole
provider identity that can be allocated before a binding exists; the catalog
does not consume observations, adopt provider state, or speculate about future
AWS IDs.

One pure controller-compatible planner now joins that catalog to one already
validated InspectionV6 document through the controller's exact nine-key
`createPlan` call. It derives a complete deterministic PlanV3 with all 18
actions and an exact head-generation, settled-revision, and inspection basis.
An absent head produces only ordered creates. A READY head can reconcile the
settled revision or project a different revision; only the deterministic
artifact may update in place. Missing unbound leaves may be created; every
other unsupported absence, drift, ownership conflict, or adoption attempt fails
closed. Destroy reverses graph order into 16 purge deletes and two
retained-volume no-ops, including safe convergence when provider effects are
already ahead of the durable READY head. Planning performs no provider I/O,
clock sampling, or random generation.

One shared read-only resource-observation boundary now normalizes the finite
evidence that those plans consume. Its exact seven fields admit only exact
present, authoritative absent, or provider-unknown evidence; keep ownership
conflict distinct from state drift; require provider identities and normalized
digests for exact owned presence; and deliberately exclude service-level
`healthy` claims. The seventh field keeps provider truth separate from a
narrow execution recommendation: an eventually consistent empty read remains
unknown, while a fully authorized managed/direct current create may say that
replaying its action-ID-and-ownership-nonce-derived idempotency token is safe.
An immutable router accepts only 16 one-method observer families, maps all 18
graph roles to exactly one observer, validates the returned evidence against
the routed role, and never receives a mutation method or client lifecycle.

One pure observation-authority constructor now derives the exact input for one
of those role reads. Its eleven caller fields bind the desired deployment
tuple, non-null durable head, nullable active and last-settled plans, and one
V45 target. The constructor recreates the complete desired catalog, pins
resident provider choices through the exact last-settled plan, and derives the
target's durable binding. It exposes an action and ownership nonce only for the
one CAS-claimed `intended` frontier role after reproducing the controller's
target, binding, dependency, and nonce reachability checks. A pending frontier
remains inspectable without mutation authority. READY carries only the settled
plan, an initial create only the active plan, and a resident active operation
carries both. DESTROYED reincarnation remains explicitly unsupported.

The first provider observer now covers both retained EBS volume roles through
one exact caller-owned `describeVolumes` port. Bound state is read only by its
durable ID, ownership is checked against creation-era plan history, and the
observed digest comes from actual EBS configuration so verified drift is not
mistaken for a tag conflict. Unbound reads never adopt. Only a completely clean
bounded empty no-action scan is absent; the same current-create scan remains
unknown but may carry replay-safe advice for the exact stable EC2 client token.
The observer and mutation driver share strict EBS evidence decoders without
sharing mutation authority.

The next two observers cover the directly owned VPC and standalone internet
gateway. Their mutation drivers now delegate stateless tags, bounded discovery,
exact reads, and strict resource decoders to a shared tagged-EC2 evidence
layer, while create-attempt fencing and response candidate memory remain
mutation-only. Bound observation is exact-ID-only and never searches for a
replacement. The VPC digest is derived from actual CIDR, tenancy, default,
IPv6, DNS, and block-mode state; readable differences remain verified drift.
Unbound no-action absence still requires an entirely clean empty history.
Neither current-create observer emits replay advice because neither EC2 create
API accepts a client token. The shared observation authority now also requires
each settled create, update, or no-op receipt to retain its exact durable
binding, while a settled delete must be unbound, before any observer can reach
provider I/O.

The subnet and application security group now follow the same read-only
boundary while retaining independent natural-slot proof. A subnet correlates
its stable locator with the exact VPC/CIDR/availability-zone slot; the security
group scans its exact VPC and compares the fixed name locally without case
because AWS name uniqueness is case-insensitive while filter values are not.
Both require locator, natural-slot, and exact-ID agreement for current-create
presence, use only exact-ID reads for durable bindings, and report readable
physical differences through actual digests rather than ownership conflict.
An early create history without a settled VPC can detect a tagged collision but
cannot prove natural-slot absence. Neither observer recommends replay because
neither create API accepts a client token.

The directly owned route table now also has a narrow read-only observer. Bound
state is exact-ID-only, while a current create requires its settled VPC receipt
plus complete locator and independent exact-ID agreement. Its actual digest
covers only intrinsic local-route, nonmain, and virtual-gateway propagation
state; the fixed default route and subnet association remain separate graph
roles and do not create false parent drift. A completely clean bounded empty
current-create history remains unknown but may recommend replay through the
same action-ID-and-ownership-nonce-derived `CreateRouteTable` client token.
Any candidate or uncertain read removes that advice.

The three derived network relationships now have read-only observers over the
same evidence used by their mutation drivers. The gateway attachment retains
independent VPC-filtered and exact-gateway views; the default route retains its
exact route-table slot and gateway lineage; and the subnet association retains
exact parent reads plus complete subnet-slot discovery. Their synthetic IDs
remain endpoint-lineage receipts rather than provider evidence. Current-create
emptiness is unknown, unbound candidates are collisions rather than adoptions,
and none recommends API replay without a stable provider client token.

All four runtime-IAM roles now also have read-only observers over shared pure
IAM evidence. The direct role and profile retain exact deterministic names,
immutable IDs, ownership tags, and complete supported child inventories. The
derived policy and role/profile association re-prove their direct and
transitive binding lineage before joining independent list, document, and
membership views. Readable state drift carries actual digests, current-create
collisions remain distinct, and no IAM observer recommends replay because the
mutation APIs expose no stable client token.

The final private read kernels are now adapted as well. The managed artifact
audits its complete exact-key version namespace and requires the current alias
to equal the audited latest immutable head. The substrate joins exact instance,
attribute, credit, ENI, and root-volume evidence and is the only remaining
observer allowed to recommend a stable-token create replay after a completely
clean current-create history. One generic attachment observer joins exact
instance and volume views for both retained volumes; typed endpoint loss must
retain the identical signature through the full retry window. All 18 graph
roles can therefore reach V47's mutation-incapable raw observation boundary.

One lossless AWS aggregate now fences the complete desired tuple, active plan,
last-settled plan, durable head, and optional just-settled binding before any
provider read. A null head is a zero-I/O absent fast path. Live inspection
routes all 18 apply-ordered authorities exactly once, preserves raw
uncertainty, conflict, actual drift, and stable-token replay recommendations,
then joins exact binding lineage and the separately narrowed resident-health
proof into InspectionV6. Conflict suppresses replay advice; advice can
authorize only an identical current create and can never settle it.

The controller now inspects a pending action before changing it to `intended`,
so a definitely applied intent CAS is required before the first provider call.
Recovery verifies settlement first and repeats a create only when InspectionV6
binds `replay-safe-create` to the exact action ID, ownership nonce, desired
digest, and dependency receipts. Creates without a provider idempotency token
receive at most one definitely authorized first call and are never guessed
safe after coordinator ambiguity. One strict provider composer exposes the
controller's seven methods from separate scope, provider-spec, inspection,
planning, and mutation ports; the read-only aggregate cannot acquire an action
method and aggregate-only context cannot leak into the pure planner.

The restriction is structurally pinned for AL2023's systemd/cgroup-v2 host,
but this slice does not claim a pinned-AMI execution proof. A clean-host smoke
test must still prove bootstrap completion and denied IMDS access before this
becomes a production security claim.

These modules now implement both retained-volume attachment effects under
deterministic mocks and expose their read-only evidence, but do not format,
mount, unmount, quiesce, or fulfill a complete service capability. Future guest
use must add a quiesce/unmount or stop dependency before attachment deletion.
One production composition boundary now opens an invocation-owned family from
one ordinary-chain credential snapshot, fences every exact client projection
at shutdown, and closes all children before its credential authority. A second
pure boundary assembles all 16 observer families, service-health and
ProviderSpec readers, planner, and six mutation clients into the controller's
seven-method provider without provider I/O or lifecycle authority.

One CLI-free invocation now composes the fixed retained table and bucket,
branded store, artifact stager, provider, and controller behind an exact owned
lifetime. Control inspection and require-active are read-only; existing-only
reconcile can strengthen but never create; bootstrap is the sole explicit
create policy. The controller and invocation now expose a top-level read-only
deployment `inspect({deploymentInstanceId})`. The controller's absent-head path
returns one exact null-document envelope without deployment-provider I/O. A
live or destroyed head hydrates its exact active and last-operation plans,
profile, pinned ProviderSpec, and InspectionV6 without selecting prerequisites,
planning, staging, writing, CAS, or effects. Unknown and conflict remain
truthful inspection data. The invocation first requires fresh active control
evidence for inspection, plan, ordinary converge, pre-staged converge, and
resume. Shutdown fences new calls, drains entered work, and closes the family
once.

One finite operation runner now opens exactly one invocation, applies an
explicit `require-active`, `reconcile-existing`, or `bootstrap` control policy,
dispatches exactly one inspection, plan, ordinary converge, explicit
pre-staged converge, or resume operation, and unconditionally closes the
invocation. It snapshots the complete request before opening credentials and
preserves deterministic primary-operation and cleanup failures.

Source packaging can now mint one opaque, process-local selected-SEA authority
only from a fresh successful `packageLocalApp()` generation and one retained
descriptor. The authority binds the generation-backed artifact record to the
descriptor's exact bytes, creates one deployment revision from that same
evidence, and permits exactly one source claim or deterministic discard.
Paths, sidecars, copies, JSON, and reconstructed objects carry no authority.

Source preparation now claims that authority directly into the invocation's
artifact stager. The stager revalidates the exact generation record, revision,
runtime, held-byte observation, deployment revision, profile, and provider
scope, durably stages the bytes, and unconditionally closes the claimed
descriptor. `prepareAwsSelectedSeaPlan()` returns the frozen, JSON-safe
`{plan, profile, artifactStage}` only after the immutable intent, exact object
version, and receipt are durably present and revalidated. Direct
`applyAwsSelectedSea()` stages once and passes that same evidence to
`convergePreStaged()`. A later process can select the one-shot
`converge-pre-staged` runner operation, which validates the supplied evidence
against durable state and never opens or substitutes its running executable.
Ordinary `converge` deliberately remains the packaged running-SEA path.

The experimental deployment command tree is now mounted in both operator
surfaces. Source uses `wharfie deployment ...`; a generated SEA uses
`<app> wharfie deployment ...`. There are exactly five leaves: `plan`, `apply`,
`inspect`, `reconcile`, and `destroy`. The exact source grammar is:

```text
wharfie deployment plan <deployment> --profile <canonical-profile.json> --control-policy <policy> [--dir <app-dir>] [--output-dir <package-dir>] [--json]
wharfie deployment apply <deployment> --profile <canonical-profile.json> [--dir <app-dir>] [--output-dir <package-dir>] [--control-policy <policy>] [--json]
wharfie deployment apply --plan <plan.json> [--control-policy <policy>] [--json]
wharfie deployment inspect <deployment-instance> --region <region> [--control-policy <policy>] [--json]
wharfie deployment reconcile <deployment-instance> --region <region> [--confirm-coordinator-stopped] [--control-policy <policy>] [--json]
wharfie deployment destroy <deployment-instance> --region <region> [--control-policy <policy>] [--json]
```

Packaged commands have the same leaves and options except that `plan` and
direct `apply` do not accept source `--dir` or `--output-dir`. The canonical
DeploymentProfileV2 supplied through `--profile` is operator input outside the
app manifest and contains no credentials. Both surfaces resolve the ordinary
AWS credential chain. Source plan/direct apply package and durably pre-stage a
selected SEA; source `apply --plan` and reconcile consume exact durable staged
evidence. Packaged plan/apply and non-destroy reconcile instead prove the
running SEA. Recovery of an active destroy remains executable-independent,
matching destroy's durable-only authority.
Create the canonical profile with
`@wharfie/wharfie/deployment-profile`, whose narrow Node authoring API exports
`DEPLOYMENT_MODE`, `createAwsSingleNodeProvider()`, and
`createDeploymentProfile()`; the quickstart contains a complete recipe.
Source `plan --json` output includes staged-artifact evidence and is reusable
only by source `apply --plan`. Packaged plan output omits that evidence and is
reusable only by an exact matching SEA; the two plan envelopes deliberately do
not cross command surfaces.
Plan always requires an explicit `--control-policy`, because source planning
may package, stage, and create bootstrap control state. Direct apply defaults to
`bootstrap`; prepared apply, inspect, reconcile, and destroy default to
`require-active`. Source `apply --plan` rejects `--dir` and `--output-dir`
rather than silently ignoring artifact-selection options. Scalar selectors
such as profile, plan, region, policy, and source paths may be supplied only
once. A correlated controller head that still carries an active operation is a
nonzero incomplete result; inspect it and use confirmed reconcile after the
former coordinator is known stopped.

Command mounting is not a production claim. The privileged host observer and
publisher, guest service projection, exact live STS session proof,
clean-account lifecycle proof, and complete deployed-service readiness remain
unfinished. External resource verification is represented by the generic V6
contract but remains unreachable through the fixed all-managed AWS profile and
planner.
Fresh apply from a DESTROYED tombstone is also currently unsupported:
InspectionV6 requires retained resources to remain exactly bound, while the
controller permits a fresh incarnation only after those bindings are gone.

## Start here

- [Project charter](PROJECT.md) — the canonical problem, scope, public concepts, boundaries, and success test.
- [Documentation](docs/README.md) — source-first installation, quickstart, application structure, design decisions, and project-reset history.
- [Architecture decisions](docs/architecture/decisions/README.md) — accepted constraints on trusted nodes, coordination, provisioning, effects, and language boundaries.
- [Roadmap](ROADMAP.md) — the live ordered cleanup and implementation plan.
- [Target service convergence checkpoint](llm/checkpoints/2026-07-25-v64-target-service-convergence.md) — the latest recorded checkpoint for retry-safe desired-SEA activation, exact liveness repair, honest settlement, verification limits, and the next privileged host-agent boundary.
- [Deployment command surface checkpoint](llm/checkpoints/2026-07-24-v63-deployment-command-surface.md) — the parent handoff for mounted source and packaged lifecycle commands, profile authoring, recovery fencing, bounded operator input, and exact artifact-authority boundaries.
- [Durable selected SEA plan checkpoint](llm/checkpoints/2026-07-24-v62-durable-selected-sea-plan.md) — the parent handoff for source staging, portable pre-staged evidence, and the distinct source-versus-packaged convergence paths.
- [Selected SEA artifact authority checkpoint](llm/checkpoints/2026-07-24-v61-selected-sea-artifact-authority.md) — the parent handoff for fresh-generation trust, one retained descriptor, observed deployment identity, and linear claim-or-discard ownership.
- [One-shot deployment operation runner checkpoint](llm/checkpoints/2026-07-24-v60-one-shot-deployment-operation-runner.md) — the parent handoff for explicit control policy, one finite operation, unconditional cleanup, and deterministic failure precedence.
- [Read-only deployment inspection checkpoint](llm/checkpoints/2026-07-24-v59-read-only-deployment-inspection.md) — the parent handoff for exact durable inspection hydration, completed-destroy observation, guarded controller operations, active-call draining, and one owned AWS lifetime.
- [Owned AWS deployment invocation checkpoint](llm/checkpoints/2026-07-24-v58-owned-aws-deployment-invocation.md) — the parent handoff for explicit inspect/require/reconcile/bootstrap control policy, guarded controller operations, active-call draining, and one owned AWS lifetime.
- [Production AWS provider assembly checkpoint](llm/checkpoints/2026-07-24-v57-aws-provider-assembly.md) — the parent handoff for one ordinary-chain invocation lifetime, exact fenced AWS client projections, and complete pure assembly of the seven-method controller provider.
- [InspectionV6 aggregate and controller checkpoint](llm/checkpoints/2026-07-24-v56-inspection-aggregate-controller.md) — the earlier handoff for lossless 18-role aggregation, exact provider composition, pre-intent first-call fencing, and stable-token-only crash replay.
- [Complete AWS resource observers checkpoint](llm/checkpoints/2026-07-24-v55-complete-aws-resource-observers.md) — the parent handoff for complete raw observation coverage, bounded artifact history, joined node/root evidence, stable node-create replay advice, and attachment endpoint-loss proof.
- [Runtime IAM observers checkpoint](llm/checkpoints/2026-07-24-v54-runtime-iam-observers.md) — the parent handoff for immutable IAM identity, exact policy and membership views, actual drift, and conservative no-token replay semantics.
- [Derived network observers checkpoint](llm/checkpoints/2026-07-23-v53-derived-network-observers.md) — the parent handoff for endpoint-lineage receipts, independent relationship views, natural-slot absence, and conservative no-token replay semantics.
- [Route-table observer checkpoint](llm/checkpoints/2026-07-23-v52-route-table-observer.md) — the parent handoff for exact bound reads, child-state separation, and client-token-backed response-loss replay advice.
- [Subnet and security-group observer checkpoint](llm/checkpoints/2026-07-23-v51-subnet-security-group-observers.md) — the parent handoff for dependency-bound natural-slot corroboration, exact bound reads, actual network drift, and conservative no-token response-loss semantics.
- [Tagged-EC2 VPC and internet-gateway observer checkpoint](llm/checkpoints/2026-07-23-v50-tagged-ec2-vpc-gateway-observers.md) — the parent handoff for stateless tagged identity evidence, exact bound reads, actual VPC drift, and conservative no-token response-loss semantics.
- [Retained-volume observer checkpoint](llm/checkpoints/2026-07-23-v49-retained-volume-observer.md) — the parent handoff for the first strict provider reader, actual EBS drift, creation-era ownership, and truth-preserving idempotent replay advice.
- [AWS resource-observation authority checkpoint](llm/checkpoints/2026-07-22-v48-aws-resource-observation-authority.md) — the parent handoff for exact target, binding, active-plan, and CAS-claimed current-action read authority.
- [AWS resource-observation boundary checkpoint](llm/checkpoints/2026-07-22-v47-aws-resource-observation-boundary.md) — the parent handoff for strict raw evidence normalization and mutation-incapable routing across all 18 graph roles.
- [Deterministic AWS deployment planning checkpoint](llm/checkpoints/2026-07-22-v46-deterministic-aws-deployment-planning.md) — the parent handoff for exact controller-compatible 18-action planning, no-adoption reconciliation, and reverse destroy derivation.
- [AWS desired-resource targets checkpoint](llm/checkpoints/2026-07-22-v45-aws-desired-resource-targets.md) — the parent handoff for the pure, deterministic 18-role target catalog and complete durable-binding identity revalidation.
- [AWS resource action router checkpoint](llm/checkpoints/2026-07-22-v44-aws-resource-action-router.md) — the parent handoff for exhaustive 18-key execute/settle routing over the six caller-owned narrow resource clients.
- [Recoverable retained-volume attachments checkpoint](llm/checkpoints/2026-07-22-v43-recoverable-volume-attachments.md) — the preceding handoff for both exact derived EBS relationships, dual-view response-loss recovery, retained delete behavior, and non-forced detach.
- [Recoverable AWS substrate-node checkpoint](llm/checkpoints/2026-07-22-v42-recoverable-substrate-node.md) — the parent handoff for exact launch, response-loss recovery, stopped-node restart, and terminal-instance/root-absence deletion evidence.
- [Exact EC2 node-launch contract checkpoint](llm/checkpoints/2026-07-21-v41-exact-node-launch-contract.md) — the preceding handoff for ProviderSpec V6, deterministic bootstrap bytes, and narrow recoverable node authority.
- [Recoverable managed-artifact checkpoint](llm/checkpoints/2026-07-21-v40-recoverable-managed-artifact.md) — the preceding handoff for stable managed-current identity, exact staged-version conditional copy, bounded history proof, and explicit-version purge.
- [Recoverable runtime-identity checkpoint](llm/checkpoints/2026-07-21-v39-recoverable-runtime-identity.md) — the earlier handoff for ProviderSpec V5, exact least-privilege IAM, and all four recoverable runtime-identity effects.
- [Exact runtime service-health checkpoint](llm/checkpoints/2026-07-21-v38-exact-runtime-service-health.md) — the preceding handoff for V3 role/node-addressed health, PUT-first conditional publication, and Inspection V5 authority.
- [Runtime-identity graph checkpoint](llm/checkpoints/2026-07-21-v37-runtime-identity-resource-graph.md) — the preceding handoff for the fixed 18-role graph and recoverable IAM effect boundaries.
- [Direct EC2 internet-gateway resource checkpoint](llm/checkpoints/2026-07-21-v29-direct-ec2-internet-gateway-resource.md) — the preceding handoff for the standalone gateway lifecycle, attachment-independent intrinsic state, and attachment-fenced purge.
- [Direct EC2 VPC resource checkpoint](llm/checkpoints/2026-07-21-v28-direct-ec2-vpc-resource.md) — the preceding handoff for the narrow single-attempt network authority, atomically tagged VPC lifecycle, and explicit no-token ambiguity boundary.
- [Multi-effect resource graph checkpoint](llm/checkpoints/2026-07-21-v27-multi-effect-resource-graph.md) — the historical handoff for the superseded 15-role graph, strict role/dependency/lifecycle contracts, and recoverable multi-effect controller frontier.
- [Retained EBS volume resource checkpoint](llm/checkpoints/2026-07-21-v26-retained-ebs-volume-resource.md) — the preceding handoff for provider-spec V2 placement and encryption pinning plus the first controller-compatible, response-loss-safe retained resource capability.
- [Exact AWS provider-spec resolution checkpoint](llm/checkpoints/2026-07-21-v25-exact-aws-provider-spec-resolution.md) — the preceding handoff for frozen latest resolution, exact-version validation, strict SSM/EC2 image evidence, and typed bounded failure handling.
- [Provider-visible service-health checkpoint](llm/checkpoints/2026-07-21-v24-provider-visible-service-health.md) — the preceding handoff for strict health receipts, conditional S3 publication, provider-owned freshness, final Inspection V3 readiness, and bounded noncurrent-version retention.
- [Recovery-safe artifact-staging checkpoint](llm/checkpoints/2026-07-20-v23-recovery-safe-artifact-staging.md) — the preceding handoff for the retained versioned control bucket, held-source upload, and exact object-version recovery evidence.
- [Pinned AWS provider-spec checkpoint](llm/checkpoints/2026-07-20-v22-pinned-aws-provider-spec.md) — the preceding handoff for immutable regional prerequisites and recovery-stable Plan/Inspection V2 authority.
- [AWS deployment-control checkpoint](llm/checkpoints/2026-07-20-v21-aws-deployment-control.md) — the preceding handoff for credential-bound AWS scope, retained DynamoDB bootstrap, and the durable deployment store.
- [Recoverable deployment-controller checkpoint](llm/checkpoints/2026-07-20-v20-recoverable-deployment-controller.md) — the preceding handoff for strict single-node deployment identity, planning, ownership, and provider-neutral crash recovery.
- [Bounded runtime extraction checkpoint](llm/checkpoints/2026-07-20-v19-bounded-runtime-extraction.md) — the preceding handoff for crash-safe packaged native extraction cleanup and the provider-backed next vertical.
- [Real-host activation proof checkpoint](llm/checkpoints/2026-07-20-v18-real-host-activation-proof.md) — the preceding handoff for checksummed two-release update, rollback, response-loss, and failed-target source-restoration evidence.
- [Recoverable systemd activation checkpoint](llm/checkpoints/2026-07-20-v17-recoverable-systemd-activation.md) — the preceding handoff for durable single-node release activation and manager/CLI integration.
- [Systemd reboot-proof checkpoint](llm/checkpoints/2026-07-20-v16-systemd-reboot-proof.md) — the preceding handoff for checksummed real-VM crash, boot, workflow-continuation, lifecycle, and uninstall evidence.
- [Shared packaged-storage checkpoint](llm/checkpoints/2026-07-20-v15-shared-packaged-storage.md) — the preceding handoff that unified foreground and resident durable state.
- [Systemd user-service checkpoint](llm/checkpoints/2026-07-20-v14-systemd-user-service-foundation.md) — the implementation foundation for packaged Linux service lifecycle, immutable releases, and PID-bound health.
- [Workflow timers and signals checkpoint](llm/checkpoints/2026-07-20-v13-workflow-timers-signals.md) — the preceding handoff for persisted timers, current-wait signals, exact replay, and source/SEA crash proof.
- [Workflow cancellation checkpoint](llm/checkpoints/2026-07-19-v12-workflow-cancellation.md) — the preceding handoff for durable run-level cancellation, active delivery, replay, and cancelled-evidence reconciliation.
- [Workflow crash-recovery checkpoint](llm/checkpoints/2026-07-19-v11-workflow-crash-recovery.md) — the preceding handoff for public source and relocated-SEA process-death recovery.
- [Public workflow operator checkpoint](llm/checkpoints/2026-07-19-v10-public-workflow-operator-surface.md) — the earlier handoff for shared source/package start, schema-v6 inspection, confirmed recovery, and event-anchored evidence reconciliation.
- [Resident workflow activity checkpoint](llm/checkpoints/2026-07-19-v9-resident-workflow-activities.md) — the preceding handoff for exact manifest-bound dispatch and conservative restart recovery.
- [Activity-headed workflow-start checkpoint](llm/checkpoints/2026-07-19-v5-activity-headed-workflow-start.md) — the historical handoff for immutable workflow inputs, stable cursor identities, atomic initial materialization, and ready-work V2.
- [V10 ready-work checkpoint](llm/checkpoints/2026-07-19-v4-v10-ready-work.md) — the preceding implementation handoff for the exact-revision transactional scheduler locator and strict workflow authoring contract.
- [Resident activity worker checkpoint](llm/checkpoints/2026-07-19-v3-resident-activity-worker.md) — the preceding fully validated handoff for offline submission, serial resident execution, and conservative restart recovery.
- [V2 foundation stabilization checkpoint](llm/checkpoints/2026-07-19-v2-foundation-stabilized.md) — the preceding clean-install restart point after repository cleanup, the portable module gate, and the public V9 successor proof.
- [V9 managed-effect successor checkpoint](llm/checkpoints/2026-07-19-v9-managed-effect-successors.md) — the historical pre-mount restart point for the first causally linked fresh-identity retry policy and its internal relocated-SEA proof.
- [V8 destination-effect reconciliation checkpoint](llm/checkpoints/2026-07-18-v8-destination-effect-reconciliation.md) — the preceding restart point after destination-finalized uncertain-effect reconciliation and its relocated-SEA crash matrix.
- [Relocated-SEA mixed-settlement checkpoint](llm/checkpoints/2026-07-18-relocated-sea-mixed-settlement-sigkill-matrix.md) — the preceding restart point after proving packaged stopped-attempt settlement across mixed sibling dispositions.
- [Relocated-SEA managed-effect checkpoint](llm/checkpoints/2026-07-18-relocated-sea-managed-effect-sigkill-matrix.md) — the preceding restart point after repeating managed-effect crash recovery through the moved SEA.
- [Shared packaged durable-run checkpoint](llm/checkpoints/2026-07-18-shared-packaged-durable-run-host.md) — the historical point that unified source and packaged foreground durable execution and proved a moved-SEA managed effect with exact replay.
- [Real-process managed-effect crash checkpoint](llm/checkpoints/2026-07-18-real-process-managed-effect-crash-matrix.md) — the preceding restart point after proving the source/core and compound-recovery `SIGKILL` matrices and the narrower packaged-operator response-loss boundary.
- [V7 atomic effect-settlement checkpoint](llm/checkpoints/2026-07-18-v7-atomic-effect-settlement.md) — the preceding restart point after closing stopped-attempt sibling sets in one bounded transaction.
- [Public effects and receipt-recovery checkpoint](llm/checkpoints/2026-07-18-public-effects-and-receipt-recovery.md) — the preceding restart point after exposing finite application state and closing its first singular stopped-runner recovery window.
- [July 2026 checkpoint](llm/checkpoints/2026-07-16-project-reset.md) — immutable historical evidence of the pre-reset state and conversation handoff.
- [Packaging salvage checkpoint](llm/checkpoints/2026-07-16-packaging-salvage.md) — historical first implementation proof and the release blockers that existed before v1 deletion.
- [V1 deletion checkpoint](llm/checkpoints/2026-07-16-v1-deletion.md) — historical deletion boundary and evidence.
- [Strict v2 manifest checkpoint](llm/checkpoints/2026-07-16-strict-v2-manifest.md) — historical strict public-boundary handoff.
- [Atomic operation-store checkpoint](llm/checkpoints/2026-07-16-atomic-operation-store.md) — historical atomic snapshot and fencing boundary.
- [Immutable identity-spine checkpoint](llm/checkpoints/2026-07-17-immutable-identity-spine.md) — historical identity and artifact boundary.
- [Mutable Operation/Action retirement checkpoint](llm/checkpoints/2026-07-17-mutable-operation-retirement.md) — historical deletion boundary after making the append-only V3 ledger the only writable durable run model.
- [V5 managed-effect foundation checkpoint](llm/checkpoints/2026-07-18-v5-managed-effect-foundation.md) — historical internal persisted-effect boundary before destination binding and public application state.
- [Evidence-backed uncertain-reconciliation checkpoint](llm/checkpoints/2026-07-18-evidence-backed-uncertain-reconciliation.md) — historical predecessor for the V4 terminal-resolution event, shared source/SEA operator command, and final local branch cleanup.
- [Authenticated current-owner cancellation checkpoint](llm/checkpoints/2026-07-18-authenticated-current-owner-cancellation.md) — parent checkpoint for the narrow external cancellation contract.
- [V4 durable-cancellation checkpoint](llm/checkpoints/2026-07-17-durable-cancellation-v4.md) — historical foreground durable-before-signal boundary.
- [Shared source/SEA ledger-operator checkpoint](llm/checkpoints/2026-07-17-shared-source-sea-ledger-operator.md) — historical boundary after unifying exact-run inspection/recovery and binding packaged operators to embedded app identity.
- [Resource-injection retirement checkpoint](llm/checkpoints/2026-07-17-resource-injection-retirement.md) — historical boundary after narrowing activities to the framed protocol and deleting the unusable injected-resource/runtime-RPC island.
- [Obsolete runtime retirement checkpoint](llm/checkpoints/2026-07-17-obsolete-runtime-retirement.md) — historical deletion boundary for the disconnected NodeAgent/systemd/private-gRPC runtime island.
- [Atomic run-directory checkpoint](llm/checkpoints/2026-07-17-run-directory-index.md) — historical hosted SEA evidence, verified V3 history index, and the cleanup boundary that preceded the runtime deletion.

The charter and accepted decisions are authoritative; the roadmap is expected
to evolve, and dated checkpoints and project-reset records are historical
snapshots. The repository-native guides under `docs/guides/` track the current
public command surface. Older material under `llm/design/` can be stale.

## Current application contract

A source application is a default-exported plain object in `wharfie.app.js`.
The v2 boundary is deliberately small and strict:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  schemaVersion: 2,
  app: { id: 'my-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.js',
      export: 'main',
    },
  },
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/activities/greet.js',
        export: 'greet',
      },
    },
  },
  workflows: {
    greet: {
      steps: [
        {
          id: 'greet',
          kind: 'activity',
          activity: 'greet',
          input: { kind: 'workflow-input' },
        },
      ],
    },
  },
});
```

Application and activity IDs are lowercase kebab identifiers matching
`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, with a maximum of 63 ASCII bytes. Wharfie
does not trim or rewrite them. The CLI is required; activities and package
targets and workflows are optional. A workflow is one to 64 ordered plain-data
activity, timer, or signal steps; activity inputs explicitly select the
workflow input, a JSON literal, or one earlier step's persisted output. The
manifest compiler and packager bind that definition to the revision. The
shared source and packaged `start` commands accept the complete finite
activity/timer/signal plan and atomically materialize its first activation. The
resident executes activity steps and fires persisted due timers; a signal step
advances only through an explicit current-wait delivery. Exact-run `inspect`,
confirmed `recover`, and evidence-backed `reconcile` are workflow-aware.
Generic `cancel` is run-level for workflows:
it terminalizes unstarted work, durably records intent before signaling an
exact active attempt, and fences a blocked uncertain activation against later
continuation. Stable request IDs make response-loss retries idempotent.
Application- and activity-level `resources` are not part
of the schema and are rejected as unknown fields. A caller-metadata object may
contain a property named `resources`, but it is ordinary inert JSON—not an
injection request. Managed effects are a separate finite API on
`runtime.effects`; the first exact request is `application-state` /
`put-if-absent` with `['idempotent', 'transactional']` replay properties.
Durable `ops run` fulfills that request, while ephemeral invocation rejects it
with `effect-handler-unavailable`. Schedules remain outside this schema. Build
credentials, signing material, and extra asset configuration are also outside
the public manifest. Branches, loops, parallel steps, a durable early-signal
inbox, and managed-effect workflow successors remain unsupported.

See the [quickstart](docs/guides/quickstart.md) and [application
structure](docs/guides/application-structure.md) for the complete
authoring rules.

## Submit durable work and run a local resident

The source submission, start, and worker commands prepare and pin the
application revision from `--dir`; `signal` resolves app scope from the
existing run:

```bash
wharfie ops submit --dir ./path/to/app --activity greet \
  --idempotency-key <stable-key> --input '{"name":"Ada"}'
wharfie ops start --workflow greet --dir ./path/to/app \
  --idempotency-key <stable-workflow-key> --input '{"name":"Ada"}'
wharfie ops worker --dir ./path/to/app
wharfie ops signal --run-id <run-id> --signal <signal-step-id> \
  --delivery-id <stable-delivery-id> --payload '{"approved":true}'
```

A packaged application exposes the same operations without a source-directory
override:

```bash
<app> wharfie submit --activity greet \
  --idempotency-key <stable-key> --input '{"name":"Ada"}'
<app> wharfie start --workflow greet \
  --idempotency-key <stable-workflow-key> --input '{"name":"Ada"}'
<app> wharfie worker
<app> wharfie signal --run-id <run-id> --signal <signal-step-id> \
  --delivery-id <stable-delivery-id> --payload '{"approved":true}'
```

`submit` and `start` are durable and do not require a live worker. Reusing the
same idempotency key with the identical activity or workflow request returns
the retained run; changing the request conflicts. A matching resident wakes
immediately when it accepts the authenticated request, while offline work
remains `RUNNABLE` until that exact app/revision worker starts. The workflow
start output includes the derived run ID, immutable revision, workflow,
current cursor position, and activation kind without exposing inputs or
payload references. `signal` requires a caller-stable delivery ID and a JSON
payload. It accepts only the signal named by the current wait: an early,
unexpected, or late delivery is durably rejected as `early-signal`,
`unexpected-signal`, or `late-signal`, with no early-signal inbox. Repeating
the exact delivery returns the retained accepted or rejected decision;
changing a reused delivery ID conflicts. The shared `inspect --json` surface
emits a schema-v7 redacted manual/workflow view, including safe cursor, timer,
signal-wait, and signal-delivery lifecycle fields but no signal payload,
payload reference, digest, or actor. Confirmed `recover` and evidence-backed
`reconcile` return the same safe view around their result. The worker is
deliberately serial. On
`SIGINT` or `SIGTERM` it stops admitting commands and claims, records
`STOPPING`, allows the active attempt up to 30 seconds to finish naturally,
then retains ownership until the attempt and admitted command handlers settle.
A manual attempt receives cooperative durable cancellation; a workflow attempt
receives physical drain cancellation and becomes durably uncertain unless it
still returns a supported terminal. That shutdown path remains physical-only;
an operator `cancel` request is the separate durable run-level decision.

On Linux with a usable systemd user manager and administrator-enabled user
lingering, the packaged artifact can manage that same resident as a fixed user
service:

```bash
<app> wharfie service install
<app> wharfie service status --json
<desired-app> wharfie service converge
<next-app> wharfie service update
<next-app> wharfie service rollback
<next-app> wharfie service recover
<app> wharfie service stop
<app> wharfie service start
<app> wharfie service restart
<app> wharfie service uninstall
```

These commands reject root, never invoke `sudo`, and preserve durable state and
immutable releases on uninstall. `service converge` is the retry-safe
desired-artifact operation for automation: it recovers interrupted
non-rollback activation, then makes at most one install, repair, or ordinary
update attempt toward the invoking SEA, while preserving non-fulfilled
settlements. An in-flight first install of another artifact can be replaced,
and an exact receipt-backed ACTIVE projection can be restarted from stopped,
failed, or degraded liveness before settlement or update; systemd failure and
start-limit state are cleared when present. Missing, corrupt, or contradictory
source authority still fails closed. It never expresses or recovers rollback.
`service update` is invoked through the new artifact and activates it only
after closing run admission and proving every durable run terminal. A fresh
`service rollback` must be invoked through the currently selected
artifact—`<next-app>` immediately after an update—and selects the one retained
prior release. If its response is ambiguous, run `service recover`; do not
issue a new rollback and risk requesting the reverse transition. A rollback
request from the prior/candidate SEA is rejected because it cannot be
distinguished from a false fresh request.

The coordinator persists every activation phase. It enables the exact unit
without starting it, then permits `systemctl start` only after the durable
state reaches `ACTIVATING`. A first install has no source: queued work for the
target revision is admitted, while nonterminal work for another revision
leaves the request `pending` and fenced. During update or rollback, the exact
selected source has a narrow `QUIESCING` start exception so it can finish
draining or be retained safely. Results separate request status
(`fulfilled`, `refused`, `failed`, or `pending`) from outcome
(`target-active`, `source-retained`, `source-restored`, `in-flight`, or
`absent`).

Durable activation state is the authority for repairing a missing receipt,
selector, or fixed unit. Physical wiring without that authority is reported
as degraded and is never adopted by install, converge, start, update, rollback,
or recovery; the existing exact orphan checks remain available only for
cleanup through `service uninstall`.
Uninstall preserves immutable releases and durable state, retains the `ACTIVE`
selection and same-revision run admission, and writes an installation
tombstone while removing physical wiring. Running `service install` from that
same selected release rehydrates the service without changing activation
record version or selection generation. That tombstone also gives a new
artifact narrow authority to reproject the exact retained source, prove it
healthy, and then perform the ordinary durable update under the same operation
lock; `service install` from the new artifact is treated as that update. If
retained-source repair is interrupted before an activation transition begins,
run `service install` from the exact selected SEA to resume it. The unit
location is fixed to the service account's
`~/.config/systemd/user`; custom `XDG_CONFIG_HOME` topology is rejected, and
unit-name mutations require an exact, non-stale effective fragment without
drop-ins.
The repository's disposable Ubuntu proof builds the app from the installed npm
tarball, removes Node from the packaged command `PATH`, force-cycles the VM,
requires automatic healthy startup before a login session, and completes the
same persisted workflow after the kernel boot ID changes. It builds distinct
source, target, and clean-exit target SEAs; exact source-mapped breakpoints then
kill update, rollback, and restoration operators after each durable write and
require public recovery plus independent selector, receipt, process, systemd,
and immutable-byte evidence. Run it with
`npm run verify:service:systemd:lima`. A due timer remains persisted until the
exact-revision resident observes and fires it; there is deliberately no public
timer-fire command. Wharfie does not yet provide schedules, managed-effect
workflow successors, multi-host reassignment, or public run-history/listing
commands.

## Reconcile one uncertain managed effect

The source and packaged operator surfaces can resolve one retained
`UNCERTAIN` application-state effect from a permanent destination decision:

```bash
wharfie ops reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped
<app> wharfie reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped
```

All four options are required. Reuse the same `--reconciliation-id` and exact
request after a lost response; an exact replay returns the retained decision
without another destination or ledger transition. Both forms are trusted local
mutations: they require the held app-scoped LMDB local-owner protocol, refuse
to race a live resident session or prior runner, and do not provide remote
operator routing. The packaged form additionally binds the run to the app
identity embedded in the artifact.

The command can retain a late verifier-backed positive receipt or atomically
finalize the exact destination effect as permanently `NOT_APPLIED`. It never
loads application source, redispatches the effect, or unblocks the enclosing
`UNCERTAIN` invocation. Human and `--json` output are redacted: they expose the
stable reconciliation/effect identities, resulting effect status, replay
state, and safe lifecycle view, but not request values, destination/store
details, receipts, finalizations, evidence, private reason text, or fences.

## Managed-effect successor retry

After an exact application-state V2 effect has been verified permanently
`NOT_APPLIED`, a trusted local operator can authorize and run its one finite
causally linked successor:

```sh
wharfie ops retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped
```

The packaged equivalent is:

```sh
<app> wharfie retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped
```

Both forms accept an optional private `--reason <text>` and redacted `--json`
output. Reuse the exact source run, effect, successor ID, actor, and reason
after a lost response. Exact replay returns or advances the one retained target;
it cannot authorize a sibling or enter an already-started adapter again.

The successor receives fresh run, invocation, attempt, effect, destination,
and fence identities through a dedicated effect-only lifecycle. It never
redispatches the abandoned authored activity, and the source remains `BLOCKED`
/ `UNCERTAIN` even when the target completes. This is only the finite
application-state V2 `put-if-absent` retry policy; it is not generic handler
retry or compensation.

## Current external dependency boundary

An activity can declare exact npm package names and versions that are direct
production or optional dependencies in its application's local npm lock v3.
Wharfie derives the complete target closure from that sealed lock without ideal-
tree resolution, extracts exact credential-free HTTPS tarballs under canonical
SHA-512 integrity, and binds semantic closure plus archive receipts to the
application revision and artifact provenance. Revision-backed source execution
uses the same closure rather than the author's ambient install.

The frozen-lock contract deliberately ignores package lifecycle scripts,
creates no package `bin` links, and treats failure of a selected optional
package as fatal. It rejects aliases, links, bundled dependencies, unsupported
targets, and non-registry edges. Private-registry authentication, workspace-lock
selection, musl Linux, and reproducible builds are not yet supported. Published native
packages must already contain usable locked target bytes. Windows SEA targets
are deliberately deferred until private runtime extraction has a tested ACL and
reparse-point design. Moved Darwin SEAs and the clean hosted-Linux verifier
exercise a real LMDB dependency with Node absent from `PATH`.

Packaged core native dependencies are always extracted into a fresh private
root; they are never reused as a mutable cache. Normal exit removes that root.
After `SIGKILL`, a successor verifies the same UID/host/boot/process authority
and removes only roots whose owner is positively dead, with fixed inspection
and removal budgets. Foreign or uncertain claims are retained, and a large
backlog converges through retries instead of making startup cleanup unbounded.

Prepared revisions also fail closed when reachable JavaScript or TypeScript
uses a runtime-computed native module path or aliases a native loader. Portable
code must use literal module specifiers so the frozen dependency closure and
artifact provenance describe everything the application can load.

## Current development checks

Use the Node version in `engines` and the contributor npm version in
`packageManager` (currently Node 24.13.1 and npm 11.12.0), install dependencies,
and run:

```bash
npm ci
npm run test:ci
```

`npm run test:ci` covers lint, source and test type checks, the full unit and
integration suite, package-tarball verification, and the production dependency
audit. The parser used by the portable-module audit is a direct runtime
dependency, and clean-install validation no longer relies on the unused
TypeScript ESLint import preset or resolver. Native LMDB and generated-SEA
proofs are available through `npm run test:native` and the SEA verifier.
The destructive, disposable real-machine service gate is
`npm run verify:service:systemd:lima`; it requires Lima on macOS and creates,
force-cycles, verifies, and deletes an isolated Ubuntu VM.

Current source is organized as follows:

- `src/cli/` — the current developer and operator CLI implementation.
- `src/core/` — activity runtime, durable ledger, provider, and packaging foundations.
- `docs/` — the small repository-native guide and accepted architecture decisions.
- `llm/` — design notes, prompt templates, and dated project checkpoints.
