# V50 tagged-EC2 VPC and internet-gateway observer checkpoint

Date: 2026-07-23

Parent: [V49 retained-volume observer](./2026-07-23-v49-retained-volume-observer.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V49 established the first strict provider observer for both retained EBS
volumes. V50 begins the direct tagged-EC2 family by implementing separate
read-only observers for the managed VPC and standalone internet gateway. It
also separates the shared, stateless identity evidence from the mutation
drivers' in-process create fencing and response-loss candidate state.

This checkpoint deliberately stops before subnet and security-group natural
slot corroboration and before route-table client-token replay. Those resources
have different absence and replay proofs and remain separate checkpoints.

## Shared tagged-EC2 evidence

`createAwsTaggedEc2EvidenceKernel` accepts only the fixed resource tag envelope,
ID field and pattern, tag and pagination bounds, and two caller-supplied read
adapters. Its returned frozen port contains only:

- provider-ID validation;
- stable locator and complete ownership-tag derivation;
- canonical tag sorting and eight stable discovery filters;
- full owned-tag and locator-only collision validation;
- bounded plural locator discovery; and
- exact-ID read corroboration.

It has no action-shaped authority, candidate map, crossed-effect set, create or
delete method, settlement method, credential lifecycle, clock, or randomness.
Each discovery call owns fresh pagination state. Duplicate IDs, repeated or
overlong pagination, malformed envelopes, adapter failures, and exact-ID
mismatches fail closed through sanitized finite evidence errors.

Locator-only collision validation deliberately differs from complete ownership
validation. Missing or malformed stable locator evidence is unknown. Duplicate,
contradictory, or unexpected reserved Wharfie tags are conflict. The three
creation receipt tags and non-Wharfie operator tags may be present without
turning an unbound collision scan into adoption.

The existing `createAwsTaggedEc2RecoveryKernel` now delegates all of those
stateless mechanics to the evidence kernel while retaining only:

- the non-idempotent create-attempt fence;
- ephemeral create-response candidate IDs; and
- mutation-shaped authority adaptation.

Its existing public operations and legacy error exports remain compatible, and
the five existing direct EC2 mutation drivers continue to use it. The legacy
recovery error import names are aliases of the finite evidence errors.

## VPC evidence and observation

The VPC mutation driver and observer now share pure decoders for exact and
paginated `DescribeVpcs` responses, VPC identity and lifecycle, the primary
IPv4 CIDR association, IPv6 presence, block-public-access mode, and the two
exact VPC attribute responses.

The observed VPC digest is derived from provider-visible state:

- canonical primary IPv4 CIDR;
- instance tenancy;
- default-VPC status;
- IPv6 presence;
- DNS support;
- DNS hostnames;
- internet-gateway block mode; and
- purge lifecycle.

Supported, readable differences produce a verified observation with a digest
that differs from desired state. They are drift, not ownership conflict.
Malformed, internally contradictory, propagating, or unsupported physical
evidence remains unknown. Only exact provider identity/account or immutable
reserved ownership-tag contradictions become present/conflict.

`createAwsSingleNodeVpcResourceObserver` accepts exactly the caller-owned
`describeVpcs` and `describeVpcAttribute` functions plus the exact provider
scope and bounded retry policy. It returns only frozen `{observe}`.

A bound VPC is read only by its durable VPC ID. It is never searched for by
tags and never replaced by an unbound candidate. Once identity and ownership
are established, exactly two frozen auxiliary requests read
`enableDnsSupport` and `enableDnsHostnames`. Typed NotFound, a successful empty
exact response, access failure, malformed evidence, and retry exhaustion remain
unknown rather than claiming absence.

A current intended create uses stable locator discovery and validates the
complete current action, ownership nonce, and state-digest receipt before
returning verified presence. A completely clean empty history remains unknown
with `execution: none`: `CreateVpc` has no client-token parameter, so tag
discovery cannot make response-loss replay safe.

An unbound VPC without a current action is collision detection only. One
corroborated locator is present/conflict and is never adopted. Absence requires
every bounded attempt and every page to be a successful, complete, empty
locator scan. Any prior candidate, provider uncertainty, malformed page, or
wait failure permanently removes that absence proof.

## Internet-gateway evidence and observation

The internet-gateway mutation driver and observer now share strict exact and
paginated `DescribeInternetGateways` decoders, provider-ID/account evidence,
stable tags, and the intrinsic standalone gateway digest.

VPC attachment state is intentionally excluded from the gateway's digest and
readable intrinsic state. The fixed graph owns that effect separately as
`network-internet-gateway-attachment`. The mutation driver's delete path keeps
its stricter detached-state fence; sharing evidence does not weaken purge
readiness.

`createAwsSingleNodeInternetGatewayResourceObserver` accepts exactly one
caller-owned `describeInternetGateways` function, the exact provider scope, and
bounded retry options. It returns only frozen `{observe}`.

A bound gateway is read only by its durable ID. Typed NotFound and empty exact
responses remain unknown after bounded retries; the observer performs no
locator search for a replacement and never claims bound absence.

Current-create and unbound modes use stable locator discovery plus an exact-ID
corroboration read. A current create requires the complete action/nonce/digest
receipt on both views before returning verified presence. Clean emptiness
remains unknown with no replay advice because `CreateInternetGateway` has no
client-token parameter. An unbound no-action candidate is a collision, never
an adoption. Only an entirely clean empty discovery history is absent.

## Durable ownership history

Both observers recreate V48 observation authority and compare its derived
binding and current action before provider I/O. They accept only their exact
managed, direct, purge graph role and the constructor's exact provider scope.
Bound creates, unbound non-create actions, malformed provider IDs, forged
bindings, scope substitutions, and unsupported client methods fail before
provider reads.

V50 additionally strengthens that shared authority across every graph role. A
settled create, update, or no-op receipt must retain the exact binding implied
by its action, dependency receipts, management mode, provider identity, and
ownership nonce. A settled delete must be unbound. Pending creates remain
unbound, while pending non-create actions must retain their exact binding.
These invariants apply to both active and last-settled plans, including READY
heads, and are proven before an observer reaches provider I/O. A prospective
READY apply still validates the old settled plan's receipts without pretending
its old desired state is the new revision's target.

Bound ownership tags use the binding's immutable creation action and nonce.
The state-digest tag comes from the matching settled create in durable active
or last-settled plan history. It never comes from the prospective target or an
active action's `before` state. Current-create ownership uses only the exact
CAS-claimed action and persisted nonce derived by V48.

## Replay boundary

EC2 reads are eventually consistent, so an empty locator query is not itself a
linearizable claim that a just-created object does not exist. Neither
`CreateVpc` nor `CreateInternetGateway` accepts a client token. These observers
therefore never return `replay-safe-create`.

The later route-table observer is the sole direct networking role currently
eligible for that advice because `CreateRouteTable` accepts Wharfie's stable
action-ID-and-nonce-derived client token. Subnet and security-group natural
uniqueness can corroborate occupancy but is not treated as provider
idempotency.

See [EC2 eventual consistency](https://docs.aws.amazon.com/ec2/latest/devguide/eventual-consistency.html),
[CreateVpc](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateVpc.html),
[CreateInternetGateway](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateInternetGateway.html),
and
[CreateRouteTable](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateRouteTable.html).

## Explicit non-claims and next work

V50 does not yet provide:

- subnet or security-group observation with natural-slot corroboration;
- route-table observation or token-safe replay advice;
- observers for derived network relationships, IAM, the artifact, substrate,
  or retained-volume attachments;
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

Continue with the subnet and security-group observers using both stable locator
and natural-slot views. Then implement route-table observation separately so
its downstream route/association state and client-token replay proof remain
explicit.

## Verification and disk hygiene

Use pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache. Do not run
the repository's coverage-default test scripts for this slice.

The shared evidence, VPC observer, internet-gateway observer, and compatible
mutation-driver slice passes 358 tests across nine suites under the pinned
runtime. The complete deployment aggregate passes 2,076 tests across 47
suites. All four TypeScript configurations pass with `--noEmit`.

Repository-wide ESLint and JavaScript/JSON Prettier checks pass. Prettier also
accepts every changed Markdown document, and `git diff --check` is clean.

The final artifact scan must exclude `node_modules` and find no coverage,
build, dist, cache, TypeScript incremental, tarball, or package output. The
historical `stash@{0}: WIP on master: 3dee66b work prompt` must remain
untouched.
