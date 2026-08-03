# V35 derived EC2 subnet route-table association checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`598312d4d5c5f2802c8744c405709c45055ac655`

This checkpoint follows the
[V34 derived EC2 default IPv4 route checkpoint](./2026-07-21-v34-derived-default-ipv4-route.md).
It closes the last relationship in Wharfie's fixed public-IPv4 network path by
explicitly associating the owned subnet with the owned custom route table.

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

`deployment-aws-subnet-route-table-association-resource.js` implements the
fixed managed, derived, purged `network-subnet-route-table-association` role
from ProviderSpec V3's 15-role graph. It provides controller-compatible
`executeAction` and `verifySettlement` ports for create, no-op, reconcile, and
reverse-order destroy.

The relationship is one explicit, nonmain association between Wharfie's exact
subnet and exact custom route table. It is not a generic association API: it
does not replace or adopt a different table occupying the subnet's unique
explicit-association slot, and it never disassociates a foreign occupant.

## Narrow authority extension

`createAwsDeploymentAuthority().createNetworkResourceClient()` adds exactly
two EC2 methods:

- `associateRouteTable`; and
- `disassociateRouteTable`.

They retain the invocation-local credential snapshot, explicit Region, caller
scope, and one-total-attempt EC2 transport policy used by the existing network
boundary. The sanitizer additionally preserves only the documented
`InvalidAssociationID.NotFound` classification needed for fresh delete
readback. Raw messages, request IDs, causes, credentials, and SDK
configuration do not cross the authority boundary. The resource factory does
not own or close its caller's narrow client.

## Intrinsic state and provider identity

The state digest uses the fresh
`wharfie:aws-single-node-ec2-subnet-route-table-association-state:v1` domain
and binds an explicit subnet association, `Main=false`, `State=associated`,
and purge lifecycle.

The derived binding does not persist AWS's ephemeral `rtbassoc-*` identifier.
Its provider resource ID instead uses the fresh
`wharfie:aws-single-node-ec2-subnet-route-table-association:v1` domain and
`wsa1` prefix over the exact route-table and subnet IDs. Destroy obtains the
current association ID from fresh provider evidence immediately before
mutation. This keeps durable identity stable across a legitimate external
disassociate and later recovery while ensuring deletion is authorized by the
currently observed endpoints.

## Exact dependency and transitive lineage

The action depends directly and only on:

1. `network-subnet`;
2. `network-route-table`; and
3. `network-default-ipv4-route`.

The resulting binding records those three direct binding IDs in canonical
order. Execution also re-proves the complete transitive chain through the VPC,
internet gateway, gateway attachment, and default route. The subnet and route
table must name the identical durable VPC binding; the gateway attachment must
name that VPC and the exact gateway; and the default route must name the exact
attachment and route-table bindings. Their synthetic provider identities and
state digests are recomputed rather than trusted as opaque strings.

Every dependency action, intent, and receipt must have the correct graph
ordering, operation state, provider scope, deployment incarnation, role,
capability, ownership mode, purge policy, ownership nonce, and creation
lineage. No EC2 call occurs before this authority is complete.

## Three-view natural-slot evidence

Every observation combines three independent provider reads:

1. exact `DescribeSubnets` for the bound subnet;
2. exact `DescribeRouteTables` for the intended table; and
3. complete, bounded `DescribeRouteTables` discovery filtered only by
   `association.subnet-id` for the bound subnet.

The third read deliberately carries neither ownership tags nor a VPC filter,
because either could hide a wrong table occupying the subnet's unique explicit
association slot. Discovery uses `MaxResults=100`, at most 16 pages, and rejects
duplicate tables, cycling tokens, malformed pages, and exhausted pagination.

Create and no-op require exact schema-2 ownership tags and topology on both
parents. The subnet must have the fixed account, VPC, CIDR, availability-zone,
IPv4-only, public-IP, block-public-access, and `available` shape. The route
table must have the fixed account, VPC, local route, active exact default route,
no propagation, and only the expected association cardinality.

The exact-table and broad-slot views must agree on the same well-formed
association ID and endpoints. `associated` is present;
`associating`, `disassociating`, and lingering `disassociated` evidence is
transitional and causes no mutation; and `failed` is a conflict. A different
table in the subnet slot, a main association, gateway association, duplicate,
or contradictory endpoint blocks and is never replaced or adopted. A
successful empty exact-ID response is malformed rather than absence.

AWS documents that a subnet without an explicit association uses its VPC's
main route table and that implicit associations do not expose a subnet ID in
route-table results. Complete empty natural-slot discovery therefore means
this managed explicit relationship is absent; Wharfie neither searches for
nor adopts the implicit main association.

## Crash recovery without an exactly-once fiction

`AssociateRouteTable` has no client token and is not in EC2's documented
idempotent-action lists. Its exact request is:

```text
AssociateRouteTable({ RouteTableId, SubnetId })
```

AWS permits only one route table per subnet, giving this relationship a
natural explicit-association slot. Wharfie reads that slot before mutation and
again for settlement. A lost successful response is recovered by observing
the exact occupant without replaying while it remains present. Mutation
responses, including the returned `rtbassoc-*`, and all sanitized mutation
errors are nonauthoritative and only lead to fresh readback.

The slot prevents simultaneous multiple occupants and makes response-loss
recovery practical. It does not prove exactly-once API calls or lifetime
effects: eventual-stale evidence can cause another call, and an external
disassociate followed by replay can create a later association with a new AWS
association ID. Higher-level workflow guarantees must continue to use durable
intent, fencing, and effect-specific provider guarantees.

## Reverse-order purge and corroborated absence

Delete re-proves durable binding and transitive authority, then disassociates
only a fresh, exact, nonmain record whose subnet and route-table endpoints
match the binding:

```text
DisassociateRouteTable({ AssociationId })
```

The Boolean response and `InvalidAssociationID.NotFound` or other allowlisted
mutation errors never settle deletion. Transitional records trigger another
read without a second mutation. A wrong-table slot occupant remains a conflict
even during destroy and is never touched.

Delete intentionally tolerates a missing exact parent and well-formed foreign
nonmain associations elsewhere on the desired table. Complete empty natural
slot discovery, together with each exact parent being either validly present
or typed not-found, proves the explicit relationship absent without stranding
cleanup after external parent loss. Malformed or inaccessible parent reads,
an exact/broad disagreement, a main table, or contradictory present evidence
cannot become absence authority.

## Focused proof and disk hygiene

Focused deterministic-mock verification covers the authority surface, exact
digest and synthetic provider ID, direct and transitive dependency receipts,
shared-VPC lineage, parent ownership and topology, three-view correlation,
bounded pagination, wrong-occupant refusal, all documented association states,
response-loss recovery, exact frozen mutations, reverse deletion with parent
loss, no-op binding preservation, sanitizer behavior, retry bounds, and frozen
factory contracts.

The final verification counts are:

- AWS deployment authority: 47 tests;
- derived subnet route-table association resource: 90 tests;
- combined V35 slice: 137 tests; and
- broader nine-suite network regression gate: 607 tests.

All four source, application, test, and SEA-verifier TypeScript configurations
also pass, together with targeted ESLint, Prettier, and `git diff --check`.

All Jest runs use pinned Node 24.13.1 with `--coverage=false`, `--no-cache`, and
`--runInBand`. Generated-artifact scans and repository-size checks follow
testing; no coverage, Jest cache, `dist`, build tree, or TypeScript build-info
artifact is intentionally retained.

## What is still intentionally absent

- No application security-group or later fixed-graph driver is implemented in
  this slice.
- The retained-volume and seven implemented network-effect drivers are not yet
  composed into a complete AWS provider, inspection, plan, or controller path.
- No operator `plan`, `apply`, `inspect`, `reconcile`, or `destroy` command is
  mounted.
- No retained volume is attached, formatted, or mounted.
- No resident service, privileged host observer, live-account lifecycle proof,
  coordinator recovery, or trusted multi-node mesh is added here.

## Ordered next work

1. Implement the directly owned application security group with no ingress and
   the ProviderSpec's fixed public IPv4 egress policy.
2. Continue in fixed graph order with runtime identity, managed artifact,
   substrate node, and the two retained-volume attachments.
3. Compose graph-wide inspection, deterministic planning, provider routing,
   controller ports, and packaged lifecycle commands; then project retained
   storage and activate the resident service.
4. Prove the full interruption and response-loss matrix in a clean AWS account
   through the user's ordinary credential chain.
5. Begin provider-backed coordinator recovery only after the complete
   single-node lifecycle is proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v35-derived-subnet-route-table-association.md` on
> branch `agent/strict-manifest`. Use only the local git CLI; do not spend time
> on PRs or issues. Breaking changes are allowed, v1 compatibility is abandoned,
> and the historical stash must remain untouched. Run only focused pinned-Node
> tests with coverage and caches disabled, then remove generated artifacts. The
> next fixed graph resource is `network-security-group`; implement its narrow
> AWS authority, tagged crash recovery, exact no-ingress/public-IPv4-egress
> contract, and reverse purge before moving to runtime identity.
