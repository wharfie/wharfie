# Wharfie checkpoint — pinned AWS provider specification

- **Date:** 2026-07-20
- **Status:** **REGIONAL AWS PREREQUISITES ARE CONTENT-ADDRESSED AND RECOVERY-STABLE**
- **Branch:** `agent/strict-manifest`
- **Parent/base head:** `38641e412b8fc8181263431838b7798ed5975d50`
- **Parent checkpoint:** [AWS deployment control](2026-07-20-v21-aws-deployment-control.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md)

The deployment controller no longer has to reinterpret mutable AWS defaults
after a preview. A new incarnation resolves one strict, secret-free provider
specification; the immutable plan embeds it, every action identity binds it,
and every inspection names it. Converge and recovery operate on that exact
document rather than asking what “latest” means later.

This checkpoint defines and tests the contract. It does **not** implement the
AWS resolver/validator or resource driver and does not claim a live AWS
resource exists.

## Product scope carried forward

- Nodes are trusted; a trustless mesh remains out of scope.
- TypeScript/Node is the public model and SEA is the first portable packaging
  backend. Native Node-API or WASM can later serve measured hot paths behind
  explicit boundaries.
- Wharfie exposes finite application/deployment capabilities, not a general
  cloud IaC language.
- One coordinator is sufficient initially because accepted plans, intents,
  bindings, and heads are provider-backed durable truth.
- Managed effects converge from explicit intent and provider evidence;
  ambiguous calls never become blanket exactly-once claims.
- Breaking changes are expected, v1 is abandoned, and no downstream
  compatibility is required.

## Implemented boundary

`AwsSingleNodeProviderSpecV1` (`wap1`) binds:

- provider contract version 2, exact provider scope, profile revision, and
  build-target ID;
- the exact regional public SSM parameter name and positive version, AMI ID,
  owning account, target architecture, HVM/EBS shape, and ENA requirement;
- `t3.small` for x64 or `t4g.small` for arm64;
- required IMDSv2, hop limit 1, disabled instance-metadata tags, and a pinned
  bootstrap digest;
- retained encrypted 8 GiB gp3 application/control volumes;
- AES256 private artifact storage purged with the managed deployment object;
- a runtime identity limited to SSM management, exact artifact reads, and
  service-health writes while the application UID remains blocked from IMDS;
- one fixed public-IPv4 egress/no-ingress network; and
- S3 health receipts every 15 seconds with a 60-second maximum age and
  5-second skew allowance.

`DeploymentProfileV2` now selects provider contract version 2 and the fresh
runtime-identity kind. `DeploymentPlanV2` (`wpl2`) embeds the complete provider
specification, intrinsically cross-checks its provider-scope/profile IDs, and
includes `providerSpecId` in every fresh `wda2` action-ID preimage.
`DeploymentInspectionV2` (`win2`) includes that ID and requires the full
specification in its trusted validation context. The portable control-store
plan namespace is now only `plan/v2/`; v1 reads and writes are not supported.

The provider-neutral controller now requires two distinct read-only ports:

- `resolveProviderSpec` may reduce mutable provider discovery to one exact
  document while previewing a new incarnation; and
- `validateProviderSpec` must validate an unaccepted new-incarnation document
  without selecting newer defaults and must reproduce it exactly before the
  first durable mutation.

For a `READY` deployment, plan and converge load the provider spec from
`head.lastOperation.planId`. They verify the settled plan's operation kind,
deployment/revision/scope/incarnation, generation ordering, and every settled
action ID before trusting its lineage. Update, reconcile, and destroy cannot
substitute another valid spec or change profile/target within that
incarnation. Active recovery loads the already accepted stored plan and does
not re-query SSM history or AMI availability, so disappearing discovery data
cannot strand crash recovery or safe destroy. A fresh incarnation after
destroy may resolve a new spec.

## Authority semantics

- Preview remains read-only and is not mutation authority.
- A new-incarnation converge re-resolves credentials, validates the exact
  pinned provider receipt, re-inspects, regenerates the same plan, and only
  then persists the accepted plan/profile and CASes the head.
- A resident converge must additionally match the last settled plan's exact
  provider spec before regeneration.
- Resume uses the accepted plan referenced by the active head; it never
  resolves “latest” or externally revalidates historical prerequisites.
- Provider spec, profile, plan, inspection, and action identities contain no
  credentials or timestamps.

## Explicit limitations and next prerequisites

- The actual AWS resolver/validator still needs bounded SSM and EC2 reads that
  prove the exact parameter-version-to-AMI/owner/architecture relationship.
- Recovery-safe executable bytes still need a retained provider control
  bucket, immutable stage intent, exact S3 object-version receipt, and
  end-to-end digest verification.
- Final service convergence still needs a provider-visible, freshness-bounded
  health receipt published by a host-owned boundary and inspected without SSM
  mutation.
- The independent-capability AWS resource driver, source/packaged deployment
  commands, and disposable clean-account lifecycle proof remain unfinished.
- Retained-state purge, ingress, node replacement, multiple nodes, and
  provider-backed coordinator leases/fencing remain later work.

## Validation and artifact hygiene

Focused no-coverage Jest passes 125 tests across the provider specification,
Plan/Inspection V2, controller lineage and crash recovery, portable store,
head, profile, and provider contracts. Source and test typechecks plus targeted
ESLint, Prettier, and diff checks pass. The controller tests explicitly prove
one mutable-spec resolution during initial preview, no additional resolution
during converge or resume, refusal of a forged READY spec, and exact provider
validation before accepting a new incarnation.

Continue using direct focused Jest invocations with `--coverage=false`; the npm
test script hard-codes coverage. The repository root contains no generated
`coverage/`, `dist/`, `.nyc_output`, or TypeScript build-info artifact.

## Preservation state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`38641e412b8fc8181263431838b7798ed5975d50`, preserving the credential-bound
AWS-control checkpoint. The historical local stash remains untouched as
`stash@{0}: WIP on master: 3dee66b work prompt`. The commit containing this
checkpoint becomes the next restart point after it is pushed and its exact
remote tip is verified.

## Ordered next work

1. Implement the retained AWS control bucket plus immutable artifact-stage
   intent/receipt protocol. Stage the currently running SEA through one held
   descriptor before any deployment action becomes active.
2. Define and implement the host-owned S3 service-health receipt and extend
   inspection evidence to bind incarnation, node, artifact/revision, session,
   generations, sequence, and provider-controlled freshness.
3. Implement the fixed AWS driver as independent network, identity, retained
   volume, artifact, and resident-node capabilities with exact ownership
   evidence and response-loss recovery.
4. Compose authority, table, store, staging, driver, and controller behind
   source and packaged `plan`, `apply`, `inspect`, `reconcile`, and `destroy`
   commands, including running-SEA re-observation.
5. Prove create, interruption recovery, update/reconcile, and ownership-safe
   destroy in a disposable clean account and retain exact receipts.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v22-pinned-aws-provider-spec.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are fine, v1 is abandoned, and no downstream
> users exist. The exact AWS provider scope/control table and durable store are
> implemented. Provider contract version 2 now pins the regional AMI receipt,
> bootstrap/identity digests, machine/storage/network/health shape in
> DeploymentPlanV2; converge and resume never reselect latest. No live AWS
> resource claim has been made. Next implement the retained control bucket and
> recovery-safe artifact-stage intent/object-version receipt, then the
> host-owned provider-visible health receipt and independent-capability AWS
> driver. Preserve trusted-node scope, one-recoverable-coordinator semantics,
> evidence-backed effects, ordinary user credential chains, and exact
> ownership checks. Run focused tests without coverage and remove generated
> artifacts immediately.
