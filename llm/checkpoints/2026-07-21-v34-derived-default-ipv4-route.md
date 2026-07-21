# V34 derived EC2 default IPv4 route checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`eaa88340ec926d2e1ac11caf697aae5a01919f5e`

This checkpoint follows the
[V33 direct EC2 route-table resource checkpoint](./2026-07-21-v33-direct-ec2-route-table-resource.md).
It implements the first route inside the fixed custom route table and closes
the public IPv4 egress edge between Wharfie's owned route table and attached
internet gateway.

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

`deployment-aws-default-ipv4-route-resource.js` implements the fixed managed,
derived, purged `network-default-ipv4-route` role from ProviderSpec V3's
15-role graph. It provides controller-compatible `executeAction` and
`verifySettlement` ports for create, no-op, reconcile, and reverse-order
destroy.

The relationship is exactly the ProviderSpec networking egress CIDR
(`0.0.0.0/0`) in Wharfie's custom route table, targeted at Wharfie's internet
gateway with `Origin=CreateRoute`. It is not a generic route-management API,
does not replace an occupied route, and cannot adopt a route whose target or
origin differs from the fixed contract.

## Narrow authority extension

`createAwsDeploymentAuthority().createNetworkResourceClient()` adds exactly
two EC2 methods:

- `createRoute`; and
- `deleteRoute`.

They share the invocation-local credential snapshot, explicit Region, caller
scope, and one-total-attempt EC2 transport policy already used by the network
resource boundary. The sanitizer preserves only the documented route
classifications needed to drive fresh readback: `RouteAlreadyExists`,
`InvalidRoute.NotFound`, and `InvalidGatewayID.NotFound`, in addition to the
existing route-table, state, and dependency classifications. Raw messages,
request IDs, causes, credentials, and SDK configuration do not cross the
authority boundary. The route factory neither owns nor closes its caller's
narrow client.

## Intrinsic state and provider identity

The state digest uses the fresh
`wharfie:aws-single-node-ec2-default-ipv4-route-state:v1` domain and binds:

- the ProviderSpec egress IPv4 CIDR;
- internet-gateway target kind;
- `Origin=CreateRoute`;
- `State=active`; and
- purge lifecycle.

Provider-allocated endpoint IDs remain in dependency lineage instead of the
intrinsic digest. The derived provider resource ID uses the fresh
`wharfie:aws-single-node-ec2-default-ipv4-route:v1` domain and `wir1` prefix
over the exact destination CIDR, internet-gateway ID, and route-table ID.
Including both endpoint IDs makes a binding specific to the intended topology
while retaining a deterministic identity across coordinator recovery.

## Exact dependency and transitive lineage

The action depends directly and only on:

1. `network-internet-gateway-attachment`; and
2. `network-route-table`.

The resulting binding records those two direct binding IDs in canonical order.
Execution also re-proves the complete transitive chain from the current plan
and durable head:

- the attachment receipt names the exact direct VPC and internet-gateway
  receipts and has the canonical provider ID derived from those endpoints;
- the route-table receipt names that same exact VPC receipt; and
- all four dependency actions and intents have the required apply/reconcile
  settled ordering or reverse-destroy pending ordering, provider scope,
  deployment incarnation, role, capability, ownership mode, purge policy,
  provider identity, ownership nonce, and creation lineage.

No EC2 call occurs until this authority is complete. A same-account route
table and gateway that do not share the exact durable VPC lineage are therefore
not enough.

## Parent ownership and topology evidence

Every exact route-table observation must identify the bound table, AWS account,
and VPC and carry the complete 13-tag schema-2 ownership envelope created by
the V33 route-table driver. Missing or changed reserved tags, duplicate tags,
or an unknown `wharfie:` tag are conflicts. Malformed provider shapes are
unknown.

The table must contain exactly one active local route for the ProviderSpec VPC
CIDR and no unmodeled route, virtual-gateway propagation, main association, or
gateway association. Create requires no association. Reverse delete treats one
well-formed nonmain subnet association as a retryable descendant fence and
rejects additional associations; it never removes the route while that fence
is visible. No-op, which cannot mutate, may observe at most one well-formed
nonmain subnet association shape so the earlier route receipt remains valid
after its descendant settles. The later association driver, not this route
driver, owns proof of that association's exact subnet endpoint.

Before create or no-op settlement, an independent exact
[`DescribeInternetGateways`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInternetGateways.html)
read must identify the bound account-owned gateway with one `available`
attachment to the exact shared VPC. A different VPC or identity blocks;
missing or transitional attachment evidence remains not converged. Delete
does not require current attachment availability: the exact owned route slot
is safe to remove even if the gateway attachment state has drifted, and
requiring that attachment would strand cleanup. The route's target ID must
still be the exact bound gateway.

## Natural-slot crash recovery

[`CreateRoute`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateRoute.html)
has no `ClientToken`. Its exact request contains only `RouteTableId`,
`DestinationCidrBlock`, and `GatewayId`. AWS gives each route table one natural
slot per destination CIDR and documents `RouteAlreadyExists` when that slot is
occupied. Wharfie always reads the slot before mutation and again for
settlement:

- an exact gateway target with `Origin=CreateRoute` and `State=active`
  converges;
- the exact target in `blackhole` state is transitional for create/no-op;
- a different target or origin blocks and is never replaced or adopted; and
- absent, malformed, duplicate, or unmodeled evidence cannot be converted into
  ownership.

The Boolean mutation response and every typed mutation error are
nonauthoritative. If a response is lost after AWS creates the route, a fresh
worker sees the desired natural-slot occupant before attempting another
mutation. If AWS reports `RouteAlreadyExists`, Wharfie rereads and either
settles the exact route or blocks on the conflicting occupant.

This prevents two simultaneous occupants of Wharfie's exact destination slot;
it does not prove that an EC2 API call or a create effect executes exactly once
over all time. In particular, an external delete followed by a later replay
could produce a second successful create effect. Higher-level workflow
exactly-once semantics must continue to come from durable intent, fencing, and
effect-specific provider guarantees rather than from a false blanket claim.

## Reverse-order purge and corroborated absence

Delete first re-proves the durable binding and transitive authority and reads
the exact route table. It removes only an exact `CreateRoute` slot targeted at
the bound gateway; either `active` or `blackhole` is safely deletable. The
request is exactly:

```text
DeleteRoute({ RouteTableId, DestinationCidrBlock })
```

[`DeleteRoute`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DeleteRoute.html)
success and `InvalidRoute.NotFound` remain readback-only. AWS documents that
`InvalidRoute.NotFound` can also mean the route table is absent, so the error
cannot settle deletion by itself.

When exact route-table readback returns typed not-found, bounded logical
discovery uses the parent's stable eight-tag locator, `MaxResults=100`, and at
most 16 pages. Only exact not-found plus complete empty tagged discovery proves
that the parent—and therefore the derived route—is absent. An exact/broad
disagreement is transitional; duplicate or foreign logical ownership blocks;
malformed, inaccessible, cycling, or exhausted discovery is unknown. This
preserves eventual-consistency safety without permanently stranding cleanup
after an externally removed parent.

## Focused proof and disk hygiene

Focused deterministic-mock verification covers the authority surface, exact
digest and provider ID, direct and transitive dependency receipts, same-VPC
lineage, exact immutable requests, route and gateway evidence, natural-slot
recovery, wrong-occupant refusal, blackhole transitions and deletion,
corroborated parent absence, retry bounds, no-op binding preservation,
sanitization, and frozen factory contracts.

The final verification counts are:

- AWS deployment authority: 46 tests;
- derived default IPv4 route resource: 76 tests;
- combined V34 slice: 122 tests; and
- broader eight-suite network regression gate: 516 tests.

All four source, application, test, and SEA-verifier TypeScript configurations
also pass, together with targeted ESLint, Prettier, and `git diff --check`.

All Jest runs use pinned Node 24.13.1 with `--coverage=false`, `--no-cache`, and
`--runInBand`. Generated-artifact scans and repository-size checks follow
testing; no coverage, Jest cache, `dist`, build tree, or TypeScript build-info
artifact is intentionally retained.

## What is still intentionally absent

- No subnet/route-table association, security group, or later fixed-graph
  driver is implemented in this slice.
- The retained-volume and six implemented network-effect drivers are not yet
  composed into a complete AWS provider, inspection, plan, or controller path.
- No operator `plan`, `apply`, `inspect`, `reconcile`, or `destroy` command is
  mounted.
- No retained volume is attached, formatted, or mounted.
- No resident service, privileged host observer, live-account lifecycle proof,
  coordinator recovery, or trusted multi-node mesh is added here.

## Ordered next work

1. Implement the derived subnet/route-table association with exact subnet and
   route-table lineage, its natural subnet association slot, response-loss
   recovery, and reverse-order disassociation.
2. Implement the application security group, then continue in fixed graph
   order with runtime identity, managed artifact, substrate node, and the two
   retained-volume attachments.
3. Compose graph-wide inspection, deterministic planning, provider routing,
   controller ports, and packaged lifecycle commands; then project retained
   storage and activate the resident service.
4. Prove the full interruption and response-loss matrix in a clean AWS account
   through the user's ordinary credential chain.
5. Begin provider-backed coordinator recovery only after the complete
   single-node lifecycle is proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v34-derived-default-ipv4-route.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 and superseded document
> namespaces are abandoned, and no downstream users exist. The exact remote
> parent before V34 is `eaa88340`; the historical stash must remain untouched.
> The retained-volume, direct VPC, standalone gateway, derived gateway
> attachment, direct subnet, direct route-table, and derived default-route
> drivers are controller-compatible. The default route binds exact direct and
> transitive shared-VPC lineage, re-proves the parent route table's schema-2
> tags and topology, and uses the `(RouteTableId, DestinationCidrBlock)` natural
> slot for response-loss recovery because CreateRoute has no ClientToken.
> Mutation results never settle actions and Wharfie makes no exactly-once API
> call or lifetime create-effect claim. Implement the subnet route-table
> association next, then the application security group. Preserve
> evidence-backed effects, ordinary credential chains, direct no-coverage
> testing, immediate artifact cleanup, and honest exactly-once boundaries.
