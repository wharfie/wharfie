# V32 direct EC2 subnet resource checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`07f56463b041f952a4320601ba868fd8055d8793`

This checkpoint follows the
[V31 tagged direct-EC2 recovery kernel checkpoint](./2026-07-21-v31-tagged-direct-ec2-recovery-kernel.md).
It implements the next fixed network role by combining that shared logical
identity protocol with the subnet's exact VPC/CIDR natural slot and dependency
lineage.

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

`deployment-aws-subnet-resource.js` implements the fixed managed, directly
owned, purged `network-subnet` role from ProviderSpec V3's 15-role graph. It
provides controller-compatible `executeAction` and `verifySettlement` ports
for create, no-op, reconcile, and reverse-order destroy.

The driver requires exactly one `network-vpc` dependency. Apply and reconcile
re-prove the earlier settled VPC binding; reverse destroy re-proves the later
pending, still-intact VPC binding. The resulting subnet receipt records the
exact VPC binding ID, provider scope, deployment and incarnation, creating
action, ownership nonce, and provider subnet ID. No provider call occurs until
that complete controller and dependency authority has been validated.

## Narrow authority extension

`createAwsDeploymentAuthority().createNetworkResourceClient()` adds exactly
three EC2 methods:

- `createSubnet`;
- `describeSubnets`; and
- `deleteSubnet`.

They reuse the same invocation-local credential snapshot, explicit region,
scope checks, and one-total-attempt EC2 transport policy as the existing VPC
and gateway operations. The sanitizer preserves both AWS spellings,
`InvalidSubnetID.NotFound` and `InvalidSubnetId.NotFound`, plus the already
bounded `DependencyViolation` and `IncorrectState` classifications required
for delete readback. Raw messages, request IDs, causes, credentials, and SDK
configuration never cross the authority boundary. The resource factory neither
owns nor closes its caller's narrow client.

## Exact subnet contract

The state digest uses the fresh
`wharfie:aws-single-node-ec2-subnet-state:v1` domain and binds exactly:

- the ProviderSpec's fixed subnet IPv4 CIDR;
- the pinned Availability Zone ID, never an account-relative zone name;
- nondefault subnet identity;
- `Ipv6Native=false` and no automatic IPv6 assignment;
- `MapPublicIpOnLaunch=false`;
- effective VPC Block Public Access internet-gateway mode `off`; and
- purge lifecycle.

The dynamic VPC provider ID belongs only to dependency-binding lineage, not the
plan-time digest. Create sends one deeply frozen
[`CreateSubnet`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSubnet.html)
request containing only `VpcId`, `CidrBlock`, `AvailabilityZoneId`, and one
complete lexically sorted schema-2 `subnet` tag specification. It supplies no
client token, zone name, IPAM pool, Outpost, IPv6 allocation, or post-create
tag repair.

Subnet-wide public IPv4 auto-assignment deliberately remains disabled. AWS
documents the default and configurable
[subnet public-IP behavior](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-public-ip.html),
but only Wharfie's later substrate node needs a public address. That node's
primary ENI will request it explicitly, so this resource does not add a second
[`ModifySubnetAttribute`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_ModifySubnetAttribute.html)
mutation or broaden public addressing to every future interface in the subnet.

## Three corroborating provider views

Each settlement attempt performs three independent bounded observations:

1. complete logical discovery through the tagged kernel's eight stable
   ownership filters;
2. complete natural-slot discovery filtered by the exact VPC ID and subnet
   CIDR; and
3. an exact-ID read selected from the durable binding, response candidate, or
   sole logical match.

Both paginated discovery paths use `MaxResults=100`, allow at most 16 pages,
and reject malformed, repeated, truncated, or contradictory pagination. The
exact read rejects pagination and treats only either typed subnet-not-found
spelling as authoritative absence. Provider calls and envelopes are decoded in
the subnet adapter, while common logical tag discovery, exact correlation,
candidate retention, and action-plus-nonce create fencing stay in the shared
kernel.

Create and no-op require all three
[`DescribeSubnets`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSubnets.html)
views to identify the same account-owned subnet. Every present record is
validated before incomplete visibility is classified. Complete settlement
requires the exact VPC, CIDR, Availability Zone ID, available and nondefault
state, `Ipv6Native=false`, `AssignIpv6AddressOnCreation=false`,
`MapPublicIpOnLaunch=false`, an explicitly empty IPv6 association set,
effective internet-gateway block mode `off`, and all 13 ownership and contract
tags. The AWS
[`Subnet` response](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_Subnet.html)
and
[`BlockPublicAccessStates`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_BlockPublicAccessStates.html)
shape are therefore provider evidence, not merely response hints. Address
occupancy and the account-relative Availability Zone name are intentionally not
part of this intrinsic contract.

A present foreign natural slot, duplicate logical matches, or any disagreement
between provider IDs blocks. Missing one-sided evidence and known pending or
unavailable states remain transitional. Failed lifecycle states and complete
contract contradictions block; malformed or inaccessible evidence is unknown.
Those classifications preserve the strongest conclusive present evidence
instead of allowing another missing or failed read to erase it.

## Recovery-safe create and no-op

Create performs all three reads before mutation. A converged existing subnet
settles without another call. A completely empty logical, natural-slot, and
exact view may claim the shared action-plus-nonce fence immediately before one
create call. A valid response subnet ID is only a factory-local candidate for
the following independent reads. A thrown call, malformed response, or
successful response never clears the attempted-effect fence or proves
settlement.

AWS rejects overlapping subnet CIDRs within one VPC. The VPC/CIDR natural slot
therefore prevents a response-loss retry from successfully allocating a second
desired subnet even before ownership tags become visible. An occupied foreign
slot blocks rather than being adopted or implicitly removed. This is stronger
recovery evidence than tags alone, but it is not a claim that an underlying
`CreateSubnet` request executes exactly once.

No-op performs no mutation. It revalidates the exact durable binding,
dependency receipt and intent, then requires the same three-view contract and
preserves the original creating action and ownership nonce.

## Drift-tolerant, identity-strict destroy

Reverse destroy reaches the subnet before its VPC. It re-proves the exact
bound ID, account owner, complete ownership tags, exact VPC, nondefault status,
available lifecycle, and reverse dependency lineage before issuing one frozen
`DeleteSubnet` request. A present natural-slot record must correlate with that
identity, but the desired slot may be absent while logical discovery and exact
bound read still agree. CIDR, Availability Zone, IPv4/IPv6 assignment, and
effective public-access drift therefore do not revoke an already explicit
purge of the exact owned resource.

Delete responses and sanitized not-found, dependency, or incorrect-state
errors remain nonauthoritative and trigger only fresh readback. A null binding
settles only when complete logical discovery and VPC/CIDR slot discovery are
both empty and the exact bound lookup reports typed not-found. Foreign,
duplicate, malformed, inaccessible, or contradictory present evidence never
becomes deletion or absence authority.

## Focused proof and disk hygiene

Focused deterministic-mock verification for this slice passes:

- AWS deployment authority: 41 tests;
- direct EC2 subnet resource: 84 tests; and
- combined slice total: 125 tests.

The broader six-suite network regression gate passes all 349 tests:

- AWS deployment authority: 41 tests;
- tagged direct-EC2 recovery kernel: 10 tests;
- direct EC2 VPC: 79 tests;
- direct EC2 internet gateway: 55 tests;
- derived internet-gateway attachment: 80 tests; and
- direct EC2 subnet: 84 tests.

The subnet suite covers its exact digest and requests, dependency authority,
atomic tags, logical and natural-slot pagination, candidate recovery, create
fencing, evidence precedence, no-op lineage, drift-tolerant deletion, strict
absence, retry bounds, sanitizer boundary, and frozen factory contract. The
final slice gate also runs all four source, application, test, and SEA-verifier
TypeScript configurations plus targeted ESLint, Prettier, and
`git diff --check`.

All Jest runs use pinned Node 24.13.1 with `--coverage=false`, `--no-cache`, and
`--runInBand`. Generated-artifact scans and repository-size checks follow
testing; no coverage, Jest cache, `dist`, build tree, or TypeScript build-info
artifact is intentionally retained.

## What is still intentionally absent

- No route table, default route, route-table association, security group, or
  later fixed-graph driver is implemented in this slice.
- The retained-volume and four implemented network-effect drivers are not yet
  composed into a complete AWS provider, inspection, plan, or controller path.
- No operator `plan`, `apply`, `inspect`, `reconcile`, or `destroy` command is
  mounted.
- No retained volume is attached, formatted, or mounted.
- No resident service, privileged host observer, live-account lifecycle proof,
  coordinator recovery, or trusted multi-node mesh is added here.
- No API-call exactly-once claim is made for EC2 subnet creation or deletion.

## Ordered next work

1. Implement the directly owned application route table beneath the exact VPC
   dependency. Give it atomic schema-2 tags, logical plus exact readback, and a
   destroy fence that proves its derived routes and associations are gone.
2. Implement the default IPv4 route as a derived relationship between that
   route table and the settled internet gateway, followed by the exact
   subnet/route-table association and application security group.
3. Continue in fixed graph order with runtime identity, managed artifact,
   substrate node, and the two retained-volume attachments.
4. Compose graph-wide inspection, deterministic planning, provider routing,
   controller ports, and packaged lifecycle commands; then project retained
   storage and activate the resident service.
5. Prove the full interruption and response-loss matrix in a clean AWS account
   through the user's ordinary credential chain.
6. Begin provider-backed coordinator recovery only after the complete
   single-node lifecycle is proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v32-direct-ec2-subnet-resource.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 and superseded document
> namespaces are abandoned, and no downstream users exist. The exact remote
> parent before V32 is `07f56463`; the historical stash must remain untouched.
> The retained-volume, direct VPC, standalone gateway, derived gateway
> attachment, and direct subnet drivers are controller-compatible. The subnet
> binds exact settled/reverse-pending VPC lineage and combines atomic schema-2
> tags with complete logical discovery, a bounded exact VPC/CIDR natural-slot
> read, and independent exact-ID corroboration. It keeps subnet-wide public-IP
> auto-assignment and IPv6 disabled; the later node primary ENI owns explicit
> public addressing. CIDR slot uniqueness prevents a second successful desired
> allocation after response loss, but provider responses and typed errors never
> settle an action and Wharfie makes no API-call exactly-once claim. Implement
> the route table next, then its default route and subnet association. Preserve
> evidence-backed effects, exact dependency lineage, ordinary credential
> chains, direct no-coverage testing, immediate artifact cleanup, and honest
> exactly-once boundaries.
