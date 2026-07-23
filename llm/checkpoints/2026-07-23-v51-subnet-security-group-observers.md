# V51 subnet and security-group observer checkpoint

Date: 2026-07-23

Parent:
[V50 tagged-EC2 VPC and internet-gateway observers](./2026-07-23-v50-tagged-ec2-vpc-gateway-observers.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V50 established stateless tagged-EC2 evidence and read-only observers for the
managed VPC and standalone internet gateway. V51 extends that boundary to the
two directly owned network resources whose provider namespaces also have
natural occupancy constraints: the fixed subnet and the application security
group.

This checkpoint deliberately stops before route-table observation and
client-token replay. It also stops before the graph's derived network
relationships, runtime identity, artifact, substrate node, retained-volume
attachments, aggregate InspectionV5, controller composition, and operator
commands.

## Shared interpretation rules

Both new observers are read-only. Each accepts exactly one caller-owned narrow
`describe` client method, the exact provider scope, and a bounded retry policy.
Neither owns credentials, closes a client, exposes mutation or settlement
ports, remembers create-response candidates, or claims a create attempt.

Each observer recreates V48 observation authority and compares its derived
binding and current action before provider I/O. It admits only its fixed
managed, directly owned, purged graph role. A durable binding is correlated
only by its exact provider ID; locator or natural-slot scans never substitute a
replacement for a bound resource.

Unbound evidence is collision detection, not adoption. A stable Wharfie
locator candidate or a natural-slot occupant is present/conflict. Absence
requires every bounded attempt and every page of every available independent
view to finish successfully and empty. A prior candidate, malformed response,
provider error, repeated or overlong continuation, duplicate provider ID,
failed retry wait, or unavailable required view removes the absence proof.

Current-create presence requires three agreeing views:

1. the complete stable Wharfie locator and creation receipt tags;
2. the provider's natural VPC-local occupancy slot; and
3. an independent exact-ID read.

Partial visibility remains unknown while AWS evidence may be propagating.
Successful exact empty responses are malformed evidence rather than typed
absence. Typed exact-ID NotFound for a durable binding remains unknown after
bounded retries.

## Subnet evidence and observation

The subnet mutation driver and observer share pure exact and paginated
`DescribeSubnets` decoders, provider identity, natural-slot discovery, and
actual-state normalization. The natural slot is the exact VPC ID plus the
fixed IPv4 subnet CIDR. Its VPC and CIDR filters are corroborating queries, not
ownership evidence.

The actual subnet digest covers the readable provider configuration:

- VPC and owner identity;
- primary IPv4 CIDR;
- availability-zone ID;
- nondefault status;
- associated IPv6 state and native-IPv6 mode;
- IPv6 assignment on creation;
- subnet-wide public IPv4 assignment;
- VPC internet-gateway block mode; and
- purge lifecycle.

Readable supported differences produce present/verified evidence with the
actual digest. They are drift rather than ownership conflict. Malformed,
internally contradictory, unsupported, or propagating physical evidence stays
unknown. Provider account, VPC identity, exact provider ID, natural-slot, or
reserved ownership-tag contradictions are conflicts.

The VPC dependency is a durable receipt, not an inferred provider
relationship. Bound and current-create subnet reads require the exact managed
VPC binding and exact dependency-binding lineage. An early initial-create head
may legitimately have neither a subnet nor a VPC binding yet. Stable locator
discovery can still detect a collision in that state, but the observer cannot
query the natural VPC/CIDR slot and therefore cannot prove absence; clean
locator emptiness remains unknown.

## Security-group evidence and observation

The security-group mutation driver and observer share pure exact and paginated
`DescribeSecurityGroups` decoders, identity and ARN validation, bounded natural
slot discovery, permission normalization, and actual-state digest derivation.
The fixed natural name is `wharfie-single-node`.

AWS security-group names are unique case-insensitively within a VPC, while
`DescribeSecurityGroups` filter values are case-sensitive. Natural discovery
therefore scans the exact VPC and performs the fixed-name comparison locally
without case. Duplicate IDs, more than one case-folded occupant, foreign-owner
records, wrong-VPC records, and invalid continuations fail closed.

Ingress and egress permissions are normalized independently of provider array
order. IPv4 CIDRs, IPv6 CIDRs, prefix-list destinations, security-group
references, descriptions, protocols, and port bounds contribute to readable
actual state. The exact desired no-ingress, all-protocol public-IPv4 egress
configuration retains the pre-V51 state digest byte-for-byte. A supported
physical rule, name, or description difference is present/verified drift with
a different digest. Account, VPC, ARN, provider-ID, or immutable reserved-tag
contradictions remain ownership conflicts.

A bound security group is read only through `GroupIds`. A current create must
correlate locator, case-folded VPC/name slot, and exact-ID evidence to the same
complete ownership receipt. An unbound no-action locator or slot candidate is
a collision and is never adopted. As with the subnet, an early initial-create
history without its settled VPC dependency cannot produce natural-slot absence
evidence, so clean locator emptiness remains unknown.

## Replay boundary

Natural uniqueness corroborates occupancy; it does not make a crossed create
boundary idempotent. Neither `CreateSubnet` nor `CreateSecurityGroup` accepts a
client token. Both observers therefore return `execution: none` for every
observation, including a completely clean current-create scan. They never tell
the controller to replay a response-lost create.

Route-table creation is different: `CreateRouteTable` accepts a client token,
and Wharfie's mutation driver already derives it from the stable action ID and
ownership nonce. Route-table observation remains the next separate checkpoint
so its replay proof and its downstream route and association evidence remain
explicit.

See
[CreateSubnet](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSubnet.html),
[CreateSecurityGroup](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSecurityGroup.html),
[DescribeSecurityGroups](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSecurityGroups.html),
[CreateRouteTable](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateRouteTable.html),
and
[EC2 eventual consistency](https://docs.aws.amazon.com/ec2/latest/devguide/eventual-consistency.html).

## Mutation compatibility

Sharing evidence does not weaken the existing mutation contracts. The subnet
and security-group drivers retain their exact controller authority, dependency
ordering, non-idempotent create-attempt fences, ephemeral response candidates,
delete readiness, and settlement mappings. Their existing desired digests and
request shapes remain stable. Mutation settlement may still map actual drift
to blocked even though read-only observation reports the same readable state
as verified drift.

## Explicit non-claims and next work

V51 does not yet provide:

- route-table observation or token-safe replay advice;
- observers for the internet-gateway attachment, default route, subnet
  association, runtime IAM resources, managed artifact, substrate node, or
  retained-volume attachments;
- aggregate InspectionV5;
- provider-complete controller composition;
- controller consumption of `replay-safe-create`;
- migration of stored plans and heads across future fixed-graph role additions;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- guest formatting, mounting, quiescence, or service projection;
- one invocation-scoped caller-owned AWS client family;
- clean-account lifecycle proof; or
- provider API-call exactly-once execution.

Continue with the directly owned route table. Preserve its stable
client-token-derived replay proof separately from the downstream default-route
and subnet-association observers. Then adapt the remaining graph roles before
building aggregate InspectionV5 and controller composition.

## Verification and disk hygiene

V51 was verified with pinned Node 24.13.1, serial Jest, no coverage, and no
Jest cache:

- the focused subnet mutation and observer suites passed 103 tests;
- the focused security-group evidence, mutation, and observer suites passed
  185 tests;
- all 50 deployment suites passed all 2,171 tests;
- all four TypeScript configurations passed;
- repository-wide ESLint and JavaScript/JSON Prettier checks passed;
- changed Markdown passed Prettier;
- `git diff --check` passed; and
- the final generated-artifact scan, excluding `node_modules`, found no
  coverage, build, dist, cache, TypeScript incremental, tarball, or package
  output.

The repository's coverage-default test scripts were not run. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remained untouched.
