# V27 multi-effect resource graph checkpoint

Date: 2026-07-21

This is an immutable restart handoff for the Wharfie project reset. Read it
with [the project charter](../../PROJECT.md), [the live roadmap](../../ROADMAP.md),
[ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md),
and the preceding
[V26 retained-volume checkpoint](./2026-07-21-v26-retained-ebs-volume-resource.md).
Later work should add another checkpoint rather than rewriting this one.

## Outcome

Wharfie's small portable deployment capability model can now expand into
several independently recoverable provider effects without exposing generic
infrastructure as code. One immutable, content-addressed AWS single-node graph
defines 15 exact resource or relationship roles. Plan, inspection, durable
binding, head, and controller authority all repeat and validate that graph's
role, dependency, ownership, and lifecycle semantics.

The existing linear action cursor remains the crash-recovery mechanism. Each
modeled resource or relationship role has its own pending, intended, and
settled frontier. Apply and reconcile use one canonical topological order;
destroy uses the exact reverse. State volumes are retained, but their
attachments are separate purge effects. Reconcile may create a role that is
authoritatively absent and has no durable binding, even when the deployment
already exists.

This is strict deterministic contract and controller proof. It does not
implement the AWS VPC, identity, node, attachment, artifact, provider router,
complete inspection, or `createPlan` drivers; resident-service activation and
host observation are also unwired. It makes no live-account claim.

## Preserved repository state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`5b65e965042d42991ceea2c801f2ba92ac9592cf`, preserving V26's exact retained
EBS volume resource. The earlier provider-spec checkpoint remains in history
at `21c096891bd1777b9f56953eaf11dfd9780e5355`. The historical local stash was
left untouched as `stash@{0}: WIP on master: 3dee66b work prompt`.

The commit containing this checkpoint becomes the V27 restart point after it
is pushed and the exact remote tip is fetched and verified.

## Fixed physical-resource graph

`deployment-resource-graph.js` defines schema 1 kind
`awsSingleNodeResourceGraph`, domain
`wharfie:aws-single-node-resource-graph:v1`, prefix `wrg1`, and a hard safety
bound of 32 entries. The current graph contains exactly these 15 entries in
apply order. Its complete content ID is
`wrg1_Kyzyg9U3Pih_hbqGmym8keUVatYwkYPxxpv6lkObcY4`.

1. `artifact`: directly owned S3 object, purge.
2. `application-state`: directly owned EBS volume, retain.
3. `control-state`: directly owned EBS volume, retain.
4. `network-vpc`: directly owned VPC, purge.
5. `network-internet-gateway`: directly owned internet gateway, purge.
6. `network-internet-gateway-attachment`: derived VPC/gateway relationship,
   purge.
7. `network-subnet`: directly owned subnet dependent on the VPC, purge.
8. `network-route-table`: directly owned route table dependent on the VPC,
   purge.
9. `network-default-ipv4-route`: derived route dependent on the gateway
   attachment and route table, purge.
10. `network-subnet-route-table-association`: derived association dependent on
    the subnet, route table, and default route, purge.
11. `network-security-group`: directly owned security group dependent on the
    VPC, purge.
12. `runtime-identity`: directly owned instance profile, purge.
13. `substrate`: directly owned EC2 instance dependent on the artifact,
    subnet, route, route association, security group, and runtime identity,
    purge.
14. `application-state-attachment`: derived volume/node attachment, purge.
15. `control-state-attachment`: derived volume/node attachment, purge.

The graph validator requires this one exact serialization and rejects another
valid topological permutation. Its content ID is pinned in every current AWS
provider specification so graph changes cannot silently reinterpret existing
deployment authority.

## Fresh strict namespaces

No compatibility layer interprets the preceding document formats as the new
contracts:

- `AwsSingleNodeProviderSpecV3`: schema/domain V3, `wap3`; it adds the exact
  `resourceGraphId`. The public profile/provider contract remains version 3
  because the portable configuration did not change.
- `DeploymentPlanV3` and `DeploymentActionV3`: `wpl3` and `wda3`.
- `DeploymentInspectionV4`: `win4`.
- `DeploymentResourceBindingV2`: `wrb2`.
- `DeploymentHeadV2` and `DeploymentOperationV2`: `wdh2` and `wdo2`.
- `DeploymentServiceHealthReceiptV2`: `whr2`; its S3 transport uses
  `health/v2/` objects and `deployment-service-health-v2` metadata.

Action and inspection entries now include `role`, `ownershipMode`,
`dependsOn`, and role-level `onDestroy`. Repeated portable capabilities are
valid; the exact graph role is the finite unit. A destroy plan must make every
managed retain role a `retained-data` no-op and every managed purge role a
`destroy-requested` delete. Plan order is exact, not merely any valid
topological ordering.

## Durable ownership DAG

Binding V2 adds the role, ownership mode, destroy policy, and canonical
`dependencyBindings: [{bindingId, resourceKey}]`. All managed direct and
derived bindings retain an unpredictable ownership nonce and immutable
creating-action identity. External bindings cannot manufacture managed
ownership.

Head V2 validates the binding set as a content-addressed DAG:

- dependency resource keys must resolve in the same head;
- every reference must name the dependency's exact binding ID;
- self references, duplicates, dangling references, and cycles are rejected;
- each capability/role pair is unique;
- every derived binding must transitively reach a managed direct ownership
  anchor; and
- a retained binding may not depend on anything destroy will purge.

This makes an untaggable relationship's ownership a precise consequence of
the exact directly owned endpoint bindings rather than a name or provider ID
guess.

## Inspection authority

Inspection V4 reports the complete graph in apply order whenever the durable
provider head is present. Every role distinguishes:

- `exact-read` for provider presence;
- `authoritative-not-found` for absence; and
- `access-failure` for unknown presence.

Present owned evidence names its exact `bindingId` and complete dependency
binding lineage, and context validation requires its provider identity and all
repeated role fields to match that exact binding. Every existing durable or
pending binding must itself match the fixed graph and profile; extra generic
bindings are refused. Managed absence reports missing ownership; unknown
presence reports unknown ownership. Only the exact `substrate` node role may
carry the resident service-health receipt. That V2 receipt is accepted only
when the substrate binding resolves all six exact artifact, network, and
runtime-identity dependency bindings from the current head.

There is one deliberate settlement bridge. After provider verification has
constructed a new binding but before the controller publishes it in the
durable head, inspection context may carry one nonserialized `pendingBinding`.
It is accepted only for the head's exact current intended action, deployment,
scope, incarnation, ownership nonce, creating action ID, and already durable
dependency bindings. The controller then requires the inspection's binding ID
and lineage to equal the proposed settlement before its compare-and-set. This
avoids both a create-settlement deadlock and premature durable authority.

## Controller recovery changes

The controller still persists the complete intent vector before any provider
mutation and advances one action at a time. It now additionally:

- correlates every action, inspection entry, settlement, and binding with the
  exact graph role and lifecycle;
- rejects any extra or graph-inconsistent durable binding before staging,
  persistence, a starting compare-and-set, or a provider effect;
- resolves dependency binding IDs from the current durable head immediately
  before execution and settlement and binds them back to their earlier settled
  plan action, ownership nonce or pinned provider identity;
- requires every dependency of a create to remain freshly present, exactly
  owned, and at the state digest named by its own plan action both before the
  effect and before the new binding is published;
- permits `create` during reconcile only with authoritative absence and no
  binding;
- accepts one exact pending create binding only during settlement inspection;
- selects service authority only from `substrate`/`resident-node`/`node`; and
- skips another destructive provider call when a delete inspection already
  proves authoritative absence, then requires settlement verification;
- re-proves every earlier purge remains authoritatively absent and unbound at
  every later destroy frontier; and
- finalizes only when every present or deleted role matches its exact plan
  target, including the planned digest of retained destroy resources.

Provider exceptions remain outside the evidence-mismatch blocking path, so an
ambiguous call leaves the intended action recoverable instead of being
misclassified as a durable ownership conflict.

## Retained-volume propagation

The existing retained EBS volume resource accepts only the exact volume role:
direct ownership, no dependencies, and retain lifecycle. It now creates
Binding V2, accepts a missing volume role during apply or reconcile, and
derives provider reconciliation solely from intrinsic volume evidence. Its
atomic tag envelope adds `wharfie:role=volume` and advances the resource tag
schema to version 2; tagged discovery includes the role. Volume
create/readback, response-loss replay, and retained no-op behavior otherwise
remain unchanged. Volume settlement deliberately ignores the downstream
attachment collection: it accepts only intrinsic `available` or `in-use`
volume state, while the separate attachment role owns attachment identity and
lifecycle.

## Verification and disk hygiene

All Jest commands for this slice run directly through `test/run-jest.js` with
`--coverage=false --no-cache --runInBand`. Generated coverage, Jest cache, and
TypeScript build-info artifacts are scanned immediately; none are retained.
Repository and `node_modules` sizes are checked throughout so verification
does not silently fill the workstation.

Final verification used Node 24.13.1:

- all 19 deployment runtime suites passed, with 611 tests total;
- the source, app implementation, test, and SEA verifier TypeScript
  configurations passed;
- ESLint passed for all 25 changed JavaScript files, and Prettier passed for
  all 30 changed JavaScript and Markdown files;
- `git diff --check` passed; and
- the artifact scan outside `node_modules` was empty, with the repository at
  539 MiB and `node_modules` at 244 MiB.

## Deliberate limitations

- The resource graph is fixed AWS single-node provider data. Users cannot add
  arbitrary resources, provider templates, or generic IaC nodes.
- Only the retained-volume resource driver is implemented. It includes strict
  inspection/readback, response-loss recovery, and retained no-op behavior;
  attachment remains a separately modeled but unimplemented action.
- No complete AWS provider router, graph-wide inspector, or plan generator is
  composed yet.
- No operator deployment commands or live credential-chain lifecycle proof
  exist yet.
- No privileged host observer installs or publishes service health yet.
- No coordinator failover or trusted-node mesh behavior is added here.
- Stable action identity and provider idempotency/reconciliation narrow
  duplicate execution; Wharfie does not claim universal exactly-once effects.

## Ordered next work

1. Implement the recoverable fixed network roles in graph order, including
   exact derived relationship readback and response-loss recovery.
2. Implement runtime identity, artifact, node, and the two volume-attachment
   roles, then compose the provider router, graph-wide inspection, and
   deterministic `createPlan`.
3. Project the retained volumes into the guest, format only newly owned empty
   volumes, mount them safely, and activate the packaged resident service.
4. Mount source and packaged `plan`, `apply`, `inspect`, `reconcile`, and
   `destroy` commands under the reserved operator surface.
5. Prove the complete lifecycle and interruption matrix in a clean AWS account
   through the user's ordinary credential chain.
6. Begin provider-backed coordinator recovery only after the single-node
   lifecycle is proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v27-multi-effect-resource-graph.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 and all superseded provider
> document namespaces are abandoned, and no downstream users exist. The V26
> remote checkpoint is preserved at `5b65e96`. ProviderSpec V3 (`wap3`) pins
> one exact `wrg1` 15-role physical graph. Plan/Action V3, Inspection V4,
> Binding V2, and Head/Operation V2 give every resource or relationship its
> own durable action, exact dependency-binding lineage, ownership mode, and
> role-level lifecycle. Apply/reconcile are canonical topological order;
> destroy reverses them, retaining volumes while purging attachments.
> Reconcile can repair an authoritatively missing unbound role. Pending create
> settlement authority is context-only and exact. Health Receipt V2 (`whr2`)
> requires exact substrate dependency lineage and uses `health/v2/`. This
> remains deterministic proof: only the retained-volume resource driver is
> implemented; network, identity, artifact, node, attachment, provider
> routing/inspection/planning, operator commands, and live AWS proof remain.
> Preserve trusted-node scope, one recoverable coordinator, evidence-backed
> effects, ordinary credential chains, exact ownership, direct no-coverage
> testing, and immediate cleanup of generated artifacts.
