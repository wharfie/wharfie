# Wharfie checkpoint — exact AWS provider-spec resolution

- **Date:** 2026-07-21
- **Status:** **NEW INCARNATIONS FREEZE ONE STRICT AL2023 IMAGE; CONVERGE REVALIDATES ITS EXACT SSM VERSION**
- **Branch:** `agent/strict-manifest`
- **Parent/base head:** `d425471a08f1c7414bc9d7e9966153f1ef99ad6c`
- **Parent checkpoint:** [provider-visible service health](2026-07-21-v24-provider-visible-service-health.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md)

Wharfie's abstract provider-spec ports now have one concrete AWS SSM/EC2 read
boundary. A new deployment incarnation may resolve the fixed
architecture-specific Amazon Linux 2023 public parameter once, freeze its AMI
ID and positive parameter version, and reduce the complete provider evidence
to the existing content-addressed `AwsSingleNodeProviderSpecV1`. Before the
controller's first new-incarnation mutation, validation reads that exact
parameter version and must reproduce the same specification; it never silently
upgrades to a newer “latest” value.

This checkpoint implements and tests the resolver under deterministic SDK
mocks. It does **not** implement or compose the production AWS resource driver,
mount deployment commands, install the privileged health observer, or claim
that any live AWS resource exists.

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
- Exactly-once claims remain evidence-specific. Read-only discovery proves a
  pinned prerequisite; it does not prove that a resource mutation happened.
- Breaking changes are expected, v1 is abandoned, and no downstream
  compatibility is required.

## Implemented boundary

### Narrow credential-bound AWS read authority

`createAwsDeploymentAuthority().createProviderSpecReadClient()` exposes only:

- SSM `GetParameter` for one parameter name or exact `name:version`; and
- EC2 `DescribeImages` for the frozen AMI ID and Amazon owner scope.

Both caller-owned SDK clients use the authority's single immutable ordinary
credential-chain snapshot and explicit region. The public boundary exposes no
credentials or credential-bearing SDK configuration. It sanitizes failures to
the allowlisted SSM missing classifications plus a bounded HTTP status, or one
fixed provider-spec read failure; raw messages, causes, request IDs, and
credentials never cross the boundary. The status is diagnostic metadata; the
resolver does not use it as authority. Closing the narrow client closes both
SDK clients and later operations fail closed.

The AWS authority is still invocation-local: repeated provider-scope checks,
DynamoDB, S3, SSM, and EC2 calls all derive from the same credential snapshot.
The new SSM/EC2 capability cannot mutate either service.

### Latest resolution only for a new incarnation

`createAwsSingleNodeProviderSpecResolver(...)` returns the controller's exact
`resolveProviderSpec` and `validateProviderSpec` ports. Resolution selects only
the fixed AL2023 public parameter for the profile architecture:

```text
x64   -> /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64
arm64 -> /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64
```

Both ports first require the exact credential-bound scope, deployment/profile/
target tuple, `apply` operation, and fresh incarnation. The durable predecessor
must be absent or a fully destroyed tombstone with no active operation, and a
destroyed predecessor cannot reuse its incarnation ID. Old-incarnation retained
bindings do not authorize discovery for the new incarnation. The current
controller separately refuses reapply while such bindings remain because
explicit retained-state adoption is not implemented. Resident, in-flight,
update, reconcile, and destroy contexts cannot invoke this discovery boundary.

AWS documents AL2023 image aliases beneath
[`/aws/service/ami-amazon-linux-latest`](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-public-parameters-ami.html).
The resolver permits an unversioned `GetParameter` request only on this
new-incarnation path. It requires the exact public String parameter name, an
AMI-ID value, and a positive version. Unknown SSM failures retry the identical
request, while `ParameterNotFound` fails immediately. The first successful
response freezes one candidate before any EC2 read. Later retries inspect only
that candidate; they never call latest again and cannot splice together a
newer SSM value with earlier EC2 evidence.

The frozen AMI ID is described with Amazon owner scope. The response must
contain exactly one matching image and no pagination token. The image must be
the architecture-specific AL2023 machine associated back to the same public
SSM parameter. It must be Amazon-owned, public, available, Linux, EBS-rooted,
HVM-virtualized, and ENA-capable; meet Allowed AMIs criteria whenever AWS
reports that field; and not already be deprecated at the response-time sample
for the admitted EC2 read. `DescribeImages`
supports exact image IDs and owner scoping, while its result is an array that
may include public, owned, or explicitly launchable images; the resolver
therefore validates the complete returned evidence rather than trusting
availability to the caller alone.
[AWS documents those request and result semantics here](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeImages.html).
The individual ownership, state, public, image type, root-device,
virtualization, ENA, and SSM-association claims are checked against AWS's
documented
[`Image` fields](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_Image.html).

Only after those checks does the resolver call
`createAwsSingleNodeProviderSpec` with the pinned bootstrap and runtime-policy
digests. The resulting canonical `wap1` document remains secret-free and binds
the exact profile, provider scope, target, parameter name/version, AMI
identity, and fixed contract-version-3 capability shape.

### Exact-version validation before first mutation

Validation begins from an already canonical, context-bound provider
specification. It requests the pinned public parameter as `name:version`, the
exact selector supported by
[`GetParameter`](https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetParameter.html),
and requires the response to reproduce the exact parameter name, positive
version, and AMI ID. Unknown SSM failures retry only that identical selector,
while `ParameterNotFound` or `ParameterVersionNotFound` fails immediately. It
then performs the same complete EC2 image proof for that pinned candidate and
recreates the provider specification. The complete canonical result must equal
the submitted document.

The deployment controller already calls this port before the first
new-incarnation artifact/control mutation and again after artifact staging,
before plan/profile/head acceptance. Resident update, reconcile, destroy, and
active recovery continue to use the already accepted provider specification
from durable plan/head lineage; they do not re-resolve latest or require an old
AMI to remain discoverable merely to recover or destroy.

### Frozen bounded retries and typed outcomes

Each read stage permits three attempts by default and accepts only an explicit
bound from one through ten. SSM retries repeat one identical latest or
exact-version selector until the first success; that success freezes the
candidate before the EC2 stage starts. EC2 retries always inspect only that AMI,
and exact validation is additionally fixed by the submitted parameter
name/version/AMI tuple. Retry exhaustion never returns partial evidence.

Provider results use three concrete typed non-success outcomes:

- `AwsSingleNodeProviderSpecMissingError`
  (`AWS_SINGLE_NODE_PROVIDER_SPEC_MISSING`) means SSM authoritatively reports
  that the required public parameter or exact version is absent;
- `AwsSingleNodeProviderSpecConflictError`
  (`AWS_SINGLE_NODE_PROVIDER_SPEC_CONFLICT`) means present evidence is
  multiple, paginated, mismatched, or violates the strict AL2023/Amazon/public/
  available/Linux/EBS/HVM/ENA/SSM relationship; and
- `AwsSingleNodeProviderSpecUnknownError`
  (`AWS_SINGLE_NODE_PROVIDER_SPEC_UNKNOWN`) means access, throttling, service,
  transport, retry-wait failure, a successful response without a usable
  Parameter/Images envelope, empty EC2 results, a pending/transient image, or
  another unresolved provider state exhausted the bound.

An empty `DescribeImages` result is deliberately not authoritative absence:
AWS documents that recently deregistered images may appear briefly and then
produce empty results. The resolver retries the frozen AMI and ultimately
classifies continued emptiness as unknown rather than missing.

No outcome embeds raw SDK error text or grants mutation authority. A missing,
conflicting, or unknown candidate cannot produce or validate a provider
specification.

## Crash, concurrency, and authority semantics

- A change to the public “latest” parameter after the initial response cannot
  change the frozen candidate inside that resolution attempt.
- A repeated resolution after a failed preview may legitimately select a newer
  candidate because no plan/head mutation accepted the earlier preview.
- Exact validation never asks for latest. If the pinned version disappears,
  points elsewhere, or its image evidence becomes incompatible before first
  acceptance, converge fails with zero controller mutation.
- Bounded retry may recover an eventually readable frozen candidate, but it
  cannot combine evidence from two candidates or convert ambiguity into
  success.
- Once accepted, recovery uses the immutable stored plan and provider
  specification. This read boundary does not make recovery depend on mutable
  discovery history.
- SSM and EC2 responses are prerequisite evidence only. The future driver must
  still persist intent before effects and resolve ambiguous mutations through
  exact provider readback.

## Explicit limitations and next prerequisites

- The fixed AWS resource driver is not implemented. No network, IAM role,
  retained volume, EC2 instance, systemd projection, or application service is
  created or inspected by this resolver.
- The new resolver is not yet wired with authority, retained table/bucket,
  portable store, artifact stager, health transport, controller, and operator
  commands in one production composition root.
- The privileged host observer remains unimplemented and unwired.
- No live-account behavior has validated public-parameter history, account
  Allowed AMIs policy, eventual AMI state changes, permissions, throttling, or
  regional availability.
- The complete clean-account create/recover/update/reconcile/destroy lifecycle
  and ownership-safe retained-state reporting remain unproven.
- Node replacement, retained-stage collection, retained-state purge/adoption,
  ingress, multiple nodes, and automatic coordinator fencing remain later
  work.

## Validation and artifact hygiene

On exact Node 24.13.1, focused direct Jest with `--coverage=false` and no cache
passes 6 suites and 152 tests. The source, app, test, and SEA-verifier
typechecks all pass. Changed JavaScript passes ESLint; changed JavaScript,
Markdown, and `package.json` pass Prettier; and `git diff --check` is clean.
The generated-artifact scan found no coverage, cache,
TypeScript-build, JUnit, core, or tarball output. After verification the
repository uses 538 MiB, including 244 MiB under `node_modules`.

The roughly 31 MiB repository increase from the preceding checkpoint is the
intentional installed dependency surface for the modular EC2 and SSM SDK
clients, not generated test or build output.

No live AWS test is part of this checkpoint. Continue using focused direct
Jest with `--coverage=false`; the repository `npm test` command hard-codes
coverage. Inspect and remove generated coverage, cache, TypeScript-build,
JUnit, core, or tarball output immediately after testing.

## Preservation state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`d425471a08f1c7414bc9d7e9966153f1ef99ad6c`, preserving the provider-visible
service-health checkpoint. The historical local stash remains untouched as
`stash@{0}: WIP on master: 3dee66b work prompt`. The commit containing this
checkpoint becomes the next restart point after it is pushed and its exact
remote tip is verified.

## Ordered next work

1. Implement the fixed AWS driver as independently recoverable network,
   identity, retained-volume, managed-artifact, and resident-node capabilities
   with exact ownership and authoritative readback.
2. Compose authority, retained table/bucket, portable store, provider-spec
   resolver, artifact stager, health transport, driver, and controller behind
   source and packaged deployment commands.
3. Install the privileged host observer and prove that its exact runtime
   identity can read staged bytes and conditionally publish only its current
   health object while the application UID cannot use provider credentials.
4. Prove clean-account create, interruption recovery, update/reconcile,
   ownership-safe destroy, retained-state reporting, and response-loss
   recovery through ordinary user credentials.
5. Begin provider-backed coordinator recovery only after the single-node
   lifecycle and control-store fencing are proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v25-exact-aws-provider-spec-resolution.md` on
> branch `agent/strict-manifest`. Use only the local git CLI; do not spend time
> on PRs or issues. Breaking changes are fine, v1 is abandoned, and no
> downstream users exist. The provider-visible health checkpoint is preserved
> at `d425471`. The credential-bound AWS authority now exposes only SSM
> `GetParameter` and EC2 `DescribeImages` for provider-spec reads.
> `createAwsSingleNodeProviderSpecResolver` resolves latest only for a fresh
> incarnation, freezes one architecture-specific AL2023 candidate, and
> validates its exact positive parameter version before first mutation. Strict
> Amazon/public/available/Linux/EBS/HVM/ENA/SSM evidence and bounded retries
> produce typed missing, conflict, or unknown failures. This is deterministic-
> mock proof only: no fixed production driver, composition root, privileged
> host observer, operator commands, or live AWS resource is wired. Next
> implement independently recoverable AWS resource capabilities and compose
> the complete single-node path. Preserve trusted-node scope,
> one-recoverable-coordinator semantics, evidence-backed effects, ordinary
> credential chains, exact ownership checks, focused no-coverage testing, and
> immediate cleanup of generated artifacts.
