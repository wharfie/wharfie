# V33 direct EC2 route-table resource checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`85b92fac5c6e7dad21169d26120100b0f8aa3e09`

This checkpoint follows the
[V32 direct EC2 subnet resource checkpoint](./2026-07-21-v32-direct-ec2-subnet-resource.md).
It implements the next fixed network role beneath the exact VPC lineage and
introduces the first direct network create whose recovery can use a durable
provider idempotency token.

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

`deployment-aws-route-table-resource.js` implements the fixed managed,
directly owned, purged `network-route-table` role from ProviderSpec V3's
15-role graph. It provides controller-compatible `executeAction` and
`verifySettlement` ports for create, no-op, reconcile, and reverse-order
destroy.

The driver requires exactly one `network-vpc` dependency. Apply and reconcile
re-prove the earlier settled VPC binding; reverse destroy re-proves the later
pending, still-intact VPC binding. The resulting route-table receipt records
the exact VPC binding ID, provider scope, deployment and incarnation, creating
action, ownership nonce, and provider route-table ID. No provider call occurs
until that complete controller and dependency authority has been validated.

## Narrow authority extension

`createAwsDeploymentAuthority().createNetworkResourceClient()` adds exactly
three EC2 methods:

- `createRouteTable`;
- `describeRouteTables`; and
- `deleteRouteTable`.

They reuse the same invocation-local credential snapshot, explicit Region,
scope checks, and one-total-attempt EC2 transport policy as the existing
network operations. Resource-level retries therefore remain visible to the
driver. The sanitizer preserves `InvalidRouteTableID.NotFound` for exact
absence and `IdempotentParameterMismatch` for a token/parameter conflict,
along with the already bounded `DependencyViolation` and `IncorrectState`
delete classifications. Raw messages, request IDs, causes, credentials, and
SDK configuration never cross the authority boundary. The resource factory
neither owns nor closes its caller's narrow client.

## Exact intrinsic contract

The state digest uses the fresh
`wharfie:aws-single-node-ec2-route-table-state:v1` domain and binds exactly:

- one active IPv4 local route for the ProviderSpec's VPC CIDR;
- `GatewayId=local` and `Origin=CreateRouteTable` for that route;
- nonmain route-table identity;
- no propagating virtual gateways; and
- purge lifecycle.

The VPC CIDR is stable ProviderSpec input, while the dynamically allocated VPC
provider ID belongs only to dependency-binding lineage. A route-table target
therefore remains content-addressed before its parent exists without weakening
the exact parent receipt required at execution.

Create sends one deeply frozen
[`CreateRouteTable`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateRouteTable.html)
request containing only `VpcId`, one complete lexically sorted schema-2
`route-table` tag specification, and `ClientToken`. All 13 reserved ownership
and contract tags are attached atomically; the driver never creates an
untagged table for later repair.

## Durable provider idempotency boundary

The token uses the
`wharfie:aws-single-node-ec2-route-table-create-client-token:v1` domain. It is
a stable 64-character lowercase hexadecimal SHA-256 value derived from the
exact deployment action ID and durable ownership nonce. The same intended
effect reproduces the same token and create parameters across an ambiguous
response, process loss, and a fresh resource factory. A changed nonce denotes
a different durable effect and yields a different token.

AWS documents `ClientToken` as the parameter that ensures
`CreateRouteTable` idempotency. Its general
[EC2 idempotency contract](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html)
says that retrying a successful request with the same token and parameters
succeeds without performing another action, while changed parameters fail with
`IdempotentParameterMismatch`. This slice therefore claims provider-enforced
at-most-one successful route-table create effect for that token in the Region.
It never claims that an API call executes exactly once, and AWS does not
document how long the token is retained. Atomic tags plus complete logical and
exact readback remain Wharfie's durable settlement evidence.

A create response must echo the exact token and contain one syntactically valid
route-table ID before it may become a factory-local candidate locator. A
missing or malformed token is unknown; a mismatched token or provider
idempotency mismatch is a fixed conflict. Even a valid response does not prove
settlement, and retrying after a thrown call is safe only because every retry
uses the same token and byte-identical parameters.

## Two corroborating provider views

A custom route table has no unique natural VPC slot: one VPC can contain
several route tables. Every settlement attempt instead performs two bounded
observations:

1. complete logical discovery through the tagged kernel's eight stable
   ownership filters; and
2. an independent exact-ID read selected from the durable binding, response
   candidate, or sole logical match.

Logical discovery uses
[`DescribeRouteTables`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeRouteTables.html)
with `MaxResults=100`, allows at most 16 pages, and rejects malformed,
repeated, truncated, duplicate, or contradictory pagination. Exact readback
rejects pagination and treats only typed route-table-not-found as authoritative
absence. Both views must identify the same account-owned route table in the
exact dependency VPC with the complete ownership envelope.

Present foreign ownership, a different VPC, main-table evidence, duplicate
logical owners, disagreeing IDs, unexpected route or association forms, and
virtual-gateway propagation block instead of being adopted or repaired.
One-sided visibility remains transitional. Malformed, inaccessible, or
exhausted evidence is unknown. Conclusive present conflicts retain precedence
over another missing or typed-not-found read. If a generic exact-read failure
prevents the shared kernel from returning broad evidence to the role validator,
the result remains safely unknown and no mutation is authorized.

## Pristine create and fixed-descendant no-op

Create performs complete logical discovery before mutation. Converged existing
evidence settles without another call. An absent logical view may submit the
exact token-backed request and then rely only on fresh discovery plus exact
readback.

Fresh create settlement must be pristine:

- exactly one active local route for the VPC CIDR;
- no subnet or gateway association;
- no `0.0.0.0/0` internet-gateway route;
- no virtual-gateway propagation; and
- all 13 atomic schema-2 tags.

The pristine fence prevents a matching tag envelope with pre-existing,
unmodeled descendants from being treated as this create's result.

No-op preserves the original binding after re-proving the same identity, VPC,
ownership tags, and exact local route. It accepts only the fixed later graph
descendants: at most one well-formed nonmain subnet association and at most one
well-formed default IPv4 route created toward an internet gateway. No other
route or association shape and no virtual-gateway propagation is accepted.
Those descendant effects retain their own later binding lineage; the earlier
route-table receipt does not absorb or recreate them.

## Reverse-order purge and strict absence

Canonical reverse graph order deletes the subnet association and default IPv4
route before reaching the route table. Destroy re-proves the exact durable
binding, VPC dependency lineage, provider identity, account ownership, atomic
tags, nonmain status, and local route. It waits while associations, nonlocal
routes, or virtual-gateway propagation remain, and it never hides cleanup of a
foreign or malformed descendant behind the route-table action.

Only then may it send one deeply frozen
[`DeleteRouteTable`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DeleteRouteTable.html)
request containing the exact bound route-table ID. AWS documents that subnet
associations must be removed before a nonmain route table can be deleted, but a
provider rejection is not graph-order authority. Delete success and sanitized
not-found, dependency, or incorrect-state errors remain nonauthoritative and
trigger only fresh readback.

A null binding settles only when complete logical discovery is empty and the
independent exact bound read returns typed not-found. A successful empty exact
response is not typed absence. Duplicate, foreign, malformed, inaccessible, or
contradictory present evidence never becomes deletion or absence authority.

## Focused proof and disk hygiene

Focused deterministic-mock verification passes:

- AWS deployment authority: 43 tests;
- direct EC2 route-table resource: 86 tests;
- combined V33 slice: 129 tests; and
- broader seven-suite network regression gate: 437 tests.

The route-table suite covers the exact digest and token derivation, create
shape, atomic tags, VPC dependency authority, bounded logical pagination,
logical/exact correlation, response-loss replay, idempotency mismatch,
pristine create, fixed-descendant no-op, reverse-order deletion blockers,
strict typed absence, evidence precedence, retry bounds, sanitizer boundary,
and frozen factory contract. The final slice gate also runs all four
source, application, test, and SEA-verifier TypeScript configurations plus
targeted ESLint, Prettier, and `git diff --check`.

All Jest runs must use pinned Node 24.13.1 with `--coverage=false`,
`--no-cache`, and `--runInBand`. Generated-artifact scans and repository-size
checks follow testing; no coverage, Jest cache, `dist`, build tree, or
TypeScript build-info artifact is intentionally retained.

## What is still intentionally absent

- No default IPv4 route, route-table association, security group, or later
  fixed-graph driver is implemented in this slice.
- The retained-volume and five implemented network-effect drivers are not yet
  composed into a complete AWS provider, inspection, plan, or controller path.
- No operator `plan`, `apply`, `inspect`, `reconcile`, or `destroy` command is
  mounted.
- No retained volume is attached, formatted, or mounted.
- No resident service, privileged host observer, live-account lifecycle proof,
  coordinator recovery, or trusted multi-node mesh is added here.
- The idempotency claim is at most one successful create effect for an exact
  token in one Region. It is not API-call exactly-once, cross-Region
  uniqueness, or an assertion about an undocumented token-retention horizon.

## Ordered next work

1. Implement the default IPv4 route as a derived relationship between the
   exact route-table and internet-gateway dependency bindings. Read both
   endpoints and the route state independently; mutation responses and typed
   errors remain nonauthoritative.
2. Implement the exact subnet/route-table association, then the application
   security group.
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
> `llm/checkpoints/2026-07-21-v33-direct-ec2-route-table-resource.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 and superseded document
> namespaces are abandoned, and no downstream users exist. The exact remote
> parent before V33 is `85b92fac`; the historical stash must remain untouched.
> The retained-volume, direct VPC, standalone gateway, derived gateway
> attachment, direct subnet, and direct route-table drivers are
> controller-compatible. The route table binds exact settled/reverse-pending
> VPC lineage, an active local VPC-CIDR route, nonmain identity, no
> virtual-gateway propagation, and purge lifecycle. Its 13 schema-2 tags are
> atomic and its 64-hex action-plus-nonce `ClientToken` permits byte-identical
> response-loss replay with provider-enforced at-most-one successful create
> effect in the Region. Token retention is undocumented, mutation results
> never settle actions, and Wharfie makes no API-call exactly-once claim.
> Implement the derived default IPv4 route next, then the subnet association
> and security group. Preserve evidence-backed effects, exact dependency
> lineage, ordinary credential chains, direct no-coverage testing, immediate
> artifact cleanup, and honest exactly-once boundaries.
