# V52 route-table observer checkpoint

Date: 2026-07-23

Parent:
[V51 subnet and security-group observers](./2026-07-23-v51-subnet-security-group-observers.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V51 established read-only evidence for the directly owned subnet and
application security group. V52 extends that boundary to the directly owned
route table and makes the first network-resource use of the raw observation
contract's `replay-safe-create` result.

This checkpoint stops before observation of the derived internet-gateway
attachment, default IPv4 route, and subnet/route-table association. It also
stops before the runtime identity, managed artifact, substrate node, retained
volume attachments, aggregate InspectionV5, controller composition, operator
commands, and guest projection.

## Evidence and mutation compatibility

The route-table mutation driver and observer share pure decoders for:

- successful create response correlation;
- exact-ID and complete paginated discovery responses;
- provider identity and ownership tags;
- local routes, downstream routes, associations, and virtual-gateway
  propagation; and
- normalized intrinsic actual state.

The mutation driver retains the mutable and effectful parts of recovery:
ephemeral create-response candidates, controller authority, create/delete
ports, delete readiness, and settlement mappings. The observer receives only
one caller-owned `describeRouteTables` method, the exact provider scope, and a
bounded retry policy. It cannot mutate, settle, close a client, or remember a
response candidate.

The desired route-table digest remains byte-for-byte compatible with the
pre-V52 contract. It covers the active local IPv4 route for the configured VPC
CIDR, nonmain status, no virtual-gateway propagation, and purge lifecycle.
Dynamic VPC and route-table IDs remain dependency and provider identity rather
than desired state.

Readable intrinsic physical state produces an actual digest from provider
evidence. The one supported fixed default IPv4 route and one supported
nonmain subnet association are deliberately excluded because the graph models
them as separate resources. They may be present during resident observation
without creating false parent drift. A fresh current-create receipt must still
be pristine before it is accepted.

Malformed, ambiguous, duplicate, or unsupported physical structures remain
unknown or conflicting rather than being silently discarded. The exact
12-digit account, VPC, durable provider ID, and complete creation-era ownership
receipt remain identity constraints rather than drift.

## Read modes

Every call recreates V48 observation authority and compares its derived
binding and current action before provider I/O. Only the fixed managed,
directly owned, purged `network-route-table` role is admitted.

A durable binding is read only by its exact route-table ID. Locator discovery
never supplies a replacement. A typed exact-ID NotFound, successful empty
exact response, malformed response, provider failure, or incomplete physical
state remains unknown after bounded retries. Exact owned readable evidence is
present/verified with its actual digest; an identity or ownership contradiction
is present/conflict.

An unbound target without a current create uses complete stable-locator
discovery only for collision detection. A candidate is never adopted.
Authoritative absence requires every bounded attempt and every discovery page
to complete successfully and empty. Unlike the subnet and security group,
route tables have no provider natural-uniqueness slot, so no VPC-local natural
query is required to prove locator absence.

A current create requires:

1. the exact settled VPC dependency and dependency-binding lineage;
2. one complete stable-locator and creation-receipt match; and
3. an independent exact-ID read of that same route table.

One-sided visibility stays unknown while EC2 evidence may be propagating.
Multiple or disagreeing IDs and conclusive identity or ownership
contradictions are conflicts. Current-create descendants or virtual-gateway
propagation contradict the required pristine settlement boundary.

## Client-token replay proof

The observer recomputes the same 64-character lowercase hexadecimal client
token as the mutation driver from the exact current action ID and persisted
ownership nonce. Its VPC dependency fixes the remaining create parameters.

If every bounded locator-discovery attempt is complete and empty, observation
truth remains unknown because EC2 reads are eventually consistent, but
execution may be `replay-safe-create`. The result is never absent. Any earlier
candidate, one-sided evidence, malformed response, provider or pagination
error, failed retry wait, or other dirty attempt permanently removes replay
advice for that observation.

AWS documents that retrying a successful request with the same client token
and parameters succeeds without another effect, while parameter changes
produce `IdempotentParameterMismatch`. Wharfie therefore claims only
provider-backed at-most-one creation for the identical request within the
provider's idempotency boundary. It does not claim that an API call executes
exactly once, that every retry succeeds, or that AWS retains tokens forever.

See
[CreateRouteTable](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateRouteTable.html),
[EC2 idempotency](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html),
[DescribeRouteTables](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeRouteTables.html),
and
[EC2 eventual consistency](https://docs.aws.amazon.com/ec2/latest/devguide/eventual-consistency.html).

## Explicit non-claims and next work

V52 does not yet provide:

- observers for the internet-gateway attachment, default IPv4 route,
  subnet/route-table association, runtime IAM resources, managed artifact,
  substrate node, or retained-volume attachments;
- aggregate InspectionV5;
- provider-complete controller composition;
- controller consumption of `replay-safe-create`;
- migration of stored plans and heads across future fixed-graph role additions;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- guest formatting, mounting, quiescence, or service projection;
- one invocation-scoped caller-owned AWS client family;
- clean-account lifecycle proof;
- an indefinite provider client-token retention claim; or
- provider API-call exactly-once execution.

Continue with the three derived network relationships: the internet-gateway
attachment, default IPv4 route, and subnet/route-table association. Preserve
their endpoint-lineage and dual-view recovery proofs without folding them into
their directly owned parent observations. Then adapt the remaining graph roles
before building aggregate InspectionV5 and controller composition.

## Verification and disk hygiene

Verification used pinned Node 24.13.1, serial Jest, no coverage, and no Jest
cache:

- the focused route-table evidence, mutation, and observer suites passed
  120/120 tests;
- the complete deployment aggregate passed 2,205/2,205 tests across 52 suites;
- all four TypeScript configurations passed with `--noEmit`;
- repository JavaScript/JSON ESLint and Prettier checks passed;
- changed Markdown passed Prettier; and
- `git diff --check` passed.

The final generated-artifact scan excluded `node_modules` and found no
coverage, build, dist, cache, TypeScript incremental, tarball, or package
output. The historical `stash@{0}: WIP on master: 3dee66b work prompt`
remained untouched.
