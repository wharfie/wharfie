# V39 recoverable AWS runtime-identity checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`3949fac022ba9e8b6a71fad3b471e4b08a364de8`

This checkpoint follows the
[V38 exact runtime service-health checkpoint](./2026-07-21-v38-exact-runtime-service-health.md).
It defines the concrete least-privilege AWS runtime identity and implements all
four independently recoverable IAM effects from ResourceGraph V2.

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

The V39 slice adds:

- one exact runtime-identity contract shared by planning and all four drivers;
- ProviderSpec V5/`wap5`, which owns the runtime-policy template digest instead
  of accepting a caller-selected digest;
- a credential-snapshot-bound, one-attempt IAM/EC2 authority with only the 17
  operations needed by these effects;
- the direct `runtime-role` driver;
- the derived `runtime-role-policy` driver;
- the direct `runtime-identity` instance-profile driver; and
- the derived `runtime-identity-role-association` driver.

Each driver exposes controller-compatible `executeAction` and
`verifySettlement` ports, validates the exact current plan/head/intent and
ownership nonce, preserves exact dependency-binding lineage, settles only from
provider readback, and refuses contradictory state instead of adopting,
rewriting, or deleting it.

## ProviderSpec V5 owns the policy

`AwsSingleNodeProviderSpecV5` moves to schema 5, domain
`wharfie:aws-single-node-provider-spec:v5`, and prefix `wap5`. The provider
contract remains version 3 and the resource graph remains V2.

The obsolete `runtimeIdentityPolicyDigest` factory/resolver input is rejected.
`capabilities.runtimeIdentity.policyDigest` must equal the digest produced from
the same exact policy renderer used for concrete roles:

```text
sha256:IQPpv2fcAo9SCtu5rK4ykyxs-wGfvN8BAn8RkokWI00
```

The template uses placeholders only for provider scope, control bucket, and
managed-artifact key. A permission, resource, condition, or statement change
therefore changes ProviderSpec authority without letting a caller choose a
different policy.

## Account-global names, immutable IDs, and ownership

One domain-separated 128-bit hash of provider scope, deployment instance, and
incarnation produces deterministic account-global names:

```text
wharfie-runtime-role-v1-<32 lowercase hex>
wharfie-runtime-profile-v1-<32 lowercase hex>
```

Both use path `/wharfie/runtime/v1/`. The role description is
`Wharfie single-node resident service runtime role.`, maximum session duration
is 3,600 seconds, the permissions boundary is absent, and its trust document
permits only `ec2.amazonaws.com` to call `sts:AssumeRole`.

Direct bindings retain AWS's immutable modern identifiers: `AROA...` RoleId and
`AIPA...` InstanceProfileId. Names and ARNs are locators; a delete/recreate at
the same name changes the immutable ID and blocks adoption or mutation.

CreateRole and CreateInstanceProfile attach the same exact 13 sorted schema-2
ownership tags atomically. They bind managed-by, resource kind, purge
retention, capability and role, provider scope, deployment instance,
incarnation, graph resource key, creating action, ownership nonce, and exact
state digest. No later retag or adoption path exists.

## Exact runtime policy

The fixed inline policy is named `wharfie-runtime-policy-v1`. It has six exact
statements and no `ListBucket`, broad S3, managed-policy, application-secret,
or application-instance-metadata authority:

1. `ssm:UpdateInstanceInformation` and the four modern `ssmmessages` channel
   calls on `*`;
2. `s3:GetObject` for exactly one managed current artifact;
3. `s3:GetObject` for exactly the role session's V3 health object;
4. `s3:PutObject` for creation only with `s3:if-none-match = *`;
5. `s3:PutObject` for replacement only when `s3:if-match` is present; and
6. an explicit deny of `s3:DeleteObject` and `s3:DeleteObjectVersion` for that
   health object.

Every allowed S3 operation requires TLS and the exact resource account. Writes
also require SSE-S3/AES256 and STANDARD storage. The stable managed artifact is
addressed before planning as:

```text
artifact/v1/<deploymentInstanceId>/<incarnationId>/current
```

It deliberately does not use the retained stage version or revision-specific
artifact ID: the graph owns one managed current object whose provider identity
must remain stable across revision updates.

The health ARN ends in `health/v3/${aws:userid}`. For an EC2 instance-profile
role session, that policy variable is `RoleId:InstanceId`, matching the V3
health key. IAM enforces header presence, encryption, account, TLS, and exact
resource scope; it does not prove that an `If-Match` value is the semantic
predecessor. The application protocol still proves that through ETag readback.

## Plan-time state versus provider identity

Role, policy, and profile state digests bind only deterministic desired state
known when one immutable plan is created. The association state digest likewise
binds the deterministic role/profile names and exactly-one membership contract.
It does **not** predict future RoleId or InstanceProfileId values.

Allocated endpoint IDs instead produce the synthetic derived identities after
the direct bindings exist:

- `wrp1_*` binds RoleId plus the fixed inline-policy name; and
- `wra1_*` binds RoleId plus InstanceProfileId.

The policy binding carries exact `artifact` and `runtime-role` receipts. The
association binding carries exact `runtime-role`, `runtime-role-policy`, and
`runtime-identity` receipts, while re-proving the policy's transitive artifact
and role lineage. This separation is required for a fresh plan to exist before
AWS allocates any IAM IDs.

## Narrow IAM/EC2 authority

`createAwsDeploymentAuthority().createRuntimeIdentityResourceClient()` creates
one IAM client and one regional EC2 client from the invocation's already frozen
credential snapshot. Both have one total SDK attempt. The surface contains
only:

- role create/get/delete, role tags, inline-policy names, attached policies,
  and profiles-for-role;
- inline-policy put/get/delete;
- instance-profile create/get/delete and tags;
- role/profile add and remove; and
- regional `DescribeInstances` for the delete fence.

Suffixed and unsuffixed IAM names for `ConcurrentModification`,
`DeleteConflict`, `EntityAlreadyExists`, and `NoSuchEntity` canonicalize to four
stable classifications. Unknown failures retain only a fixed public error and
optional allowlisted HTTP status. Raw messages, request IDs, causes,
credentials, and SDK configuration do not cross the boundary. Partial
construction closes either client already created; close is idempotent and
attempts both clients.

## Direct runtime role

Create submits one deeply frozen `CreateRole` request with the exact name,
path, trust, description, session duration, and all ownership tags. IAM has no
create idempotency token, so one factory will cross the mutation boundary at
most once for an action/nonce. Success, `EntityAlreadyExists`, and response loss
all advance only through exact named GetRole plus bounded tag and policy-list
readback. Exact tag subsets can be transitional immediately after create;
wrong, extra, or duplicate tags conflict.

Settlement binds only the immutable RoleId. The role may have zero inline
policies or the one fixed derived policy, but no foreign inline or attached
managed policy. Delete additionally requires zero inline policies, zero
attached policies, and zero instance profiles. An ambiguous DeleteRole result
uses exact readback; dependency conflicts never authorize cleanup.

## Derived inline policy

The policy driver accepts only exact settled `artifact` and `runtime-role`
dependencies, including the deterministic managed artifact ARN, exact role
state digest, immutable RoleId, and two-edge receipt lineage.

Before Get/Put/Delete or settlement it re-proves the role's immutable ID, name,
path, ARN, description, maximum session duration, exact EC2-only trust, and
absence of a permissions boundary. Bounded ListRolePolicies and
ListAttachedRolePolicies evidence must show either no inline policy before
create or exactly the fixed inline policy, and no managed policies. The exact
GetRolePolicy document must agree with the list view. List/Get propagation
disagreement is transitional; foreign permission surfaces block.

Put and delete each target only the fixed slot. Semantic document drift is
never overwritten or deleted. Ambiguous mutation responses attempt exact
role/list/document readback, and later settlement remains bounded and
readback-only.

## Direct instance profile

Create submits one deeply frozen `CreateInstanceProfile` request with the exact
name, path, and 13 tags. Like CreateRole, it has no idempotency token and is not
replayed in-process after the first crossed boundary. Success, duplicate name,
and response loss settle only through exact GetInstanceProfile and bounded tag
readback.

Membership is a separate derived effect, so the direct profile contract accepts
zero roles or one structurally valid role and rejects impossible cardinality.
Its durable binding uses only the immutable InstanceProfileId.

Delete requires Roles to be empty and performs a bounded, paginated regional
`DescribeInstances` filtered by exact `iam-instance-profile.id` with
`IncludeManagedResources=true`. Returned instances must corroborate the exact
profile ID/ARN and be structurally confirmed terminated; any active use blocks
without mutation. Ambiguous profile deletion uses exact readback.

IAM profiles are account-global while DescribeInstances is regional. Even a
region enumeration cannot inspect disabled opt-in regions. This driver therefore
makes the narrower honest claim: safe deletion depends on Wharfie's exclusive
profile rule, under which this managed profile is never reused by non-Wharfie
infrastructure or outside the configured region.

## Derived role/profile association

The association driver accepts only exact `runtime-role`,
`runtime-role-policy`, and `runtime-identity` dependency receipts. It also
re-proves the policy binding's transitive exact artifact and role lineage.

Immediately before Add, Remove, or settlement it re-proves:

- complete role ownership, immutable identity, shape, and EC2-only trust;
- exactly one fixed inline-policy name and exact document, with no attached
  managed policies;
- complete profile ownership and immutable identity; and
- membership from both GetInstanceProfile.Roles and bounded paginated
  ListInstanceProfilesForRole results.

Presence means the profile has exactly the bound role and the role reports
exactly the bound profile. Absence means the profile has zero roles and the role
has zero profiles. One-sided evidence is transitional; foreign or multiple
endpoints conflict. Add/Remove executes at most once per `executeAction`, then
response loss and IAM propagation settle only through bounded bidirectional
readback. A recreated role or profile is never mutated, including during
destroy.

## No exactly-once fiction

IAM create operations expose no client token and IAM is eventually consistent.
V39 therefore makes no exactly-once API or lifetime-effect claim. Deterministic
names, atomic tags, immutable IDs, natural relationship slots, one-attempt
transport, in-process crossed-effect guards, exact dependency bindings, and
bounded readback make each durable action recoverable without treating a
mutation response as a receipt.

Malformed or inaccessible evidence becomes one fixed unknown error. Well-formed
contradictory evidence becomes conflict/blocked. Plausible IAM propagation
becomes not-converged after bounded retries. Raw provider details are never
echoed.

## What remains intentionally absent

- The managed current artifact resource is not implemented; only its exact key,
  policy authority, and required dependency binding are defined.
- No substrate instance or retained-volume attachment driver exists.
- The implemented retained volume, eight network effects, and four IAM effects
  are not composed into a graph-wide AWS provider, production inspection,
  planner, or controller port.
- No source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  command is mounted.
- No privileged host observer or live STS proof confirms that publishing
  credentials are the RoleId/InstanceId session claimed by a V3 health receipt.
- No live-account lifecycle or account-global profile-use proof is claimed.
- No retained health-current-object collector is added.

## Focused proof and disk hygiene

Final focused verification passes:

- runtime contract, ProviderSpec/resolver, IAM/EC2 authority, and policy-driver
  gate: 206/206 tests;
- direct role/profile gate: 71/71 tests; and
- association gate: 29/29 tests.

The final combined eight-suite V39 gate passes 306/306 tests.
The final 23-suite diff-scoped regression gate, including every migrated
existing fixture and all new IAM suites, passes 1,231/1,231 tests.

All four source, application, test, and SEA-verifier TypeScript configurations
pass, as do repository JavaScript lint, Prettier, and diff-integrity checks.

Focused Jest uses pinned Node 24.13.1 with `--runInBand`, `--coverage=false`,
and `--no-cache`. The final generated-artifact scan retains no coverage tree,
Jest cache, `dist`, build tree, TypeScript build-info file, or package tarball.
Repository size remains 547 MiB, including 249 MiB under `node_modules`.

## Ordered next work

1. Implement the managed current artifact at the exact stable key, with strict
   staged-version input authority, conditional publication, versioned readback,
   update/recovery behavior, and ownership-safe purge.
2. Implement the substrate node and two retained-volume attachments in graph
   order, including exact instance-profile association, bootstrap, metadata,
   placement, network, block-device, and response-loss evidence.
3. Compose graph-wide inspection, deterministic planning, provider routing,
   controller ports, and source/packaged lifecycle commands; project retained
   storage and activate the resident service.
4. Install and wire the privileged publisher, add live STS caller/session proof,
   and prove the full interruption and response-loss lifecycle in a clean AWS
   account through ordinary user credentials.
5. Begin provider-backed coordinator recovery only after the complete
   single-node lifecycle and control-store fencing are proven outside a
   developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v39-recoverable-runtime-identity.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 compatibility is abandoned, and
> the historical stash must remain untouched. ProviderSpec V5/`wap5` owns the
> exact runtime-policy template digest. All four runtime-identity effects have
> independent recoverable drivers; association desired state is plan-time
> deterministic, while allocated IAM IDs belong in provider identity and exact
> dependency lineage. Preserve the current-region/exclusive-profile deletion
> caveat and do not claim live STS publisher proof. Next implement the managed
> current artifact at its exact stable key, then substrate and retained-volume
> attachments. Run focused pinned-Node tests with coverage and caches disabled,
> remove generated artifacts, commit and push checkpoints, and preserve the
> historical stash.
