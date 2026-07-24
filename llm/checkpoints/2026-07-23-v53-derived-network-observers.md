# V53 derived network observers checkpoint

Date: 2026-07-23

Parent:
[V52 route-table observer](./2026-07-23-v52-route-table-observer.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V52 completed read-only observation of the directly owned network parents. V53
extends the same raw observation boundary to the three derived relationships
that form the fixed public-IPv4 network path:

- the VPC/internet-gateway attachment;
- the route table's default IPv4 route; and
- the subnet/route-table association.

This checkpoint stops before observation of the runtime IAM resources, managed
artifact, substrate node, and retained-volume attachments. It also stops before
aggregate InspectionV5, controller composition, operator commands, and guest
projection.

## Shared evidence without shared mutation authority

Each relationship mutation driver and observer shares pure provider-response
and physical-state evidence. Create and delete ports, action execution,
settlement mappings, mutation-response handling, and retry-side effects remain
private to the mutation driver.

Every observer:

- receives only the caller-owned describe methods required by its relationship,
  the exact provider scope, and a bounded retry policy;
- recreates V48 observation authority and compares the derived binding and
  current action before provider I/O;
- validates the fixed managed, derived, purged role and its complete direct and
  transitive dependency-binding lineage;
- recomputes the synthetic provider-resource ID from the exact provider endpoint
  IDs instead of trusting the receipt as provider evidence; and
- returns only the shared raw observation contract without mutating, settling,
  remembering a response candidate, or closing a client.

The compatible desired digests remain endpoint-independent. Dynamically
allocated endpoint IDs stay in immutable dependency lineage and the synthetic
relationship receipt.

## Relationship-specific observations

The internet-gateway attachment retains its two independent views: complete
paginated discovery filtered by the exact VPC and an exact-ID read of the exact
gateway. Both must corroborate the same available VPC/gateway pair. One-sided
visibility and transitional states remain unknown; occupied endpoints,
duplicate rows, or contradictory pairs are conflicts. A conclusive foreign
occupant is classified on the page where it appears, so a later pagination
failure cannot erase that conflict.

The default IPv4 route retains its owned route-table evidence and exact gateway
evidence for non-delete reads. Delete deliberately needs only the exact route
slot and dependency-bound gateway target, so a missing or detached gateway
cannot strand safe route removal. Only the fixed `0.0.0.0/0` slot,
`CreateRoute` origin, and dependency-bound target can prove the relationship. A
different target, origin, or impossible route-table topology is a conflict.
Provider-readable relationship state is normalized separately from parent
route-table state so the route-table observer continues to exclude this child
from its own digest.

The subnet/route-table association retains three independent views: exact
subnet, exact intended route table, and complete paginated route-table
discovery filtered by the subnet's explicit-association slot. The exact and
natural-slot views must agree on one nonmain association between the bound
endpoints. The provider-allocated `rtbassoc-*` value remains fresh evidence
rather than durable identity. Wrong-table occupants, main or gateway
associations, duplicate rows, and contradictory endpoints remain conflicts
outside the current delete. Current delete deliberately ignores well-formed
unrelated associations and degraded subnet lifecycle health so they cannot
strand removal of the exact target; the exact target and subnet-slot views must
still agree, and an occupant on another table remains a conflict.

## Bound, recovery, and absence modes

A durable relationship binding is never replaced by provider discovery. Its
synthetic ID, endpoint IDs, complete binding lineage, and current provider
views must agree before observation is verified.

A current create may be verified only when every required view corroborates the
exact relationship and the current action's endpoint lineage. Clean empty
evidence remains unknown because the preceding mutation may be hidden by
eventual consistency.

An unbound target without a current action uses its provider relationship slot
only for collision detection and never silently adopts a present relationship.
For any non-create mode, including effect-ahead delete or physical loss beneath
a durable binding, the relationship's independent views can prove authoritative
absence only after every bounded attempt, every mode-required exact view, and
every discovery page completes successfully and absent. Any earlier candidate,
malformed or failed read, pagination error, contradictory view, or failed retry
wait makes the result unknown or conflicting rather than absent.

## Replay and exactly-once boundary

None of these observers emits `replay-safe-create`.

`AttachInternetGateway`, `CreateRoute`, and `AssociateRouteTable` do not expose
the stable EC2 client-token boundary used by V52's `CreateRouteTable`.
One-to-one endpoint cardinality or a natural provider slot makes response-loss
recovery practical inside the mutation drivers, but it does not make an empty
eventually consistent observation sufficient authority to replay an API call.

Wharfie therefore claims evidence-backed convergence around exact relationship
slots, not exactly-once API execution or lifetime exactly-once effects.
Mutation responses and typed mutation errors remain nonauthoritative.

See
[AttachInternetGateway](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_AttachInternetGateway.html),
[DescribeInternetGateways](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInternetGateways.html),
[CreateRoute](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateRoute.html),
[AssociateRouteTable](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_AssociateRouteTable.html),
[DescribeRouteTables](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeRouteTables.html),
and
[DescribeSubnets](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSubnets.html).

## Explicit non-claims and next work

V53 does not yet provide:

- observers for runtime IAM resources, managed artifact, substrate node, or
  retained-volume attachments;
- aggregate InspectionV5;
- provider-complete controller composition;
- migration of stored plans and heads across future fixed-graph role additions;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- guest formatting, mounting, quiescence, or service projection;
- one invocation-scoped caller-owned AWS client family;
- clean-account lifecycle proof; or
- provider API-call or lifetime effect exactly-once execution.

Continue with the four runtime IAM relationships, then the managed artifact,
substrate node, and generic retained-volume attachment observer. Build aggregate
InspectionV5 and controller composition only after those seven remaining
implementation families share the raw observation boundary.

## Verification and disk hygiene

Validation used pinned Node 24.13.1, serial Jest, no coverage, and no Jest
cache. The results were:

- the nine relationship evidence, mutation, and observer suites passed
  346/346 tests;
- the complete deployment aggregate passed 58/58 suites and 2305/2305 tests in
  175.736 seconds;
- all four TypeScript configurations passed with `--noEmit`;
- repository ESLint and JavaScript/JSON Prettier checks passed;
- changed Markdown Prettier and `git diff --check` passed; and
- the final scan excluding `node_modules` found no coverage, build, dist,
  cache, TypeScript incremental, tarball, or package output.

The historical `stash@{0}: WIP on master: 3dee66b work prompt` remained
untouched.
