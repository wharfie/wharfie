# V36 direct EC2 security-group resource checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`e9236267154032dcdbca9e72d9f0be969de3b6bd`

This checkpoint follows the
[V35 derived subnet route-table association checkpoint](./2026-07-21-v35-derived-subnet-route-table-association.md).
It implements the final directly owned networking resource in Wharfie's fixed
single-node graph: the application security group.

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

`deployment-aws-security-group-resource.js` implements the fixed managed,
direct, purged `network-security-group` role from ProviderSpec V3's 15-role
graph. It provides controller-compatible `executeAction` and
`verifySettlement` ports for create, no-op, reconcile, and reverse-order
destroy.

The group has the immutable name `wharfie-single-node`, the immutable
description `Wharfie single-node application security group.`, no ingress, and
one all-protocol/all-port IPv4 egress rule to the ProviderSpec networking CIDR
`0.0.0.0/0`. It is not a generic firewall API and does not authorize or revoke
individual rules.

## AWS defaults are the intended firewall

AWS creates a custom VPC security group with no inbound rules and one default
allow-all IPv4 outbound rule. Because Wharfie's VPC is fixed to IPv4-only,
those provider defaults exactly implement ProviderSpec's
`public-ipv4-egress-no-ingress` capability. The resource therefore creates the
group and verifies its complete rule set without adding rule-mutation
authority.

Accepted settlement evidence contains an empty `IpPermissions` array and
exactly one `IpPermissionsEgress` entry with `IpProtocol=-1`, no port bounds,
no security-group references, one unannotated `0.0.0.0/0` IPv4 range, no IPv6
ranges, and no prefix lists. Missing egress immediately after create is
transitional. Missing or changed egress during no-op, any ingress, an extra
rule, a different destination, a port range, an IPv6 range, a group reference,
a prefix list, or a rule description is drift and cannot settle.

This custom group is deliberately distinct from AWS's undeletable `default`
group, whose self-referencing ingress policy does not meet Wharfie's fixed
contract. Security groups are stateful, so response traffic for connections
initiated through the egress rule does not require an ingress rule.

## Narrow authority extension

`createAwsDeploymentAuthority().createNetworkResourceClient()` adds exactly
three EC2 methods:

- `createSecurityGroup`;
- `describeSecurityGroups`; and
- `deleteSecurityGroup`.

No authorize- or revoke-rule operation is exposed. The new methods share the
invocation-local credential snapshot, explicit Region, caller scope, and
one-total-attempt EC2 transport policy of the existing network boundary. The
sanitizer additionally preserves only the documented classifications required
for fresh readback: `InvalidGroup.Duplicate`, `InvalidGroup.NotFound`,
`InvalidGroup.InUse`, and `InvalidSecurityGroupID.NotFound`. Raw messages,
request IDs, causes, credentials, and SDK configuration do not cross the
authority boundary. The resource factory does not own or close its caller's
narrow client.

## Intrinsic state, provider identity, and VPC lineage

The state digest uses the fresh
`wharfie:aws-single-node-ec2-security-group-state:v1` domain and binds the
fixed name and description, empty ingress, the single all-protocol IPv4 egress
rule, and purge lifecycle. The provider-allocated VPC ID remains in dependency
lineage rather than the intrinsic digest.

The durable provider resource ID is AWS's actual `sg-*` ID. The resource
depends directly and only on `network-vpc`; its binding contains that exact VPC
receipt. Before any EC2 call, execution re-proves the VPC action, intent,
binding, provider scope, deployment incarnation, networking capability, direct
ownership, purge policy, ownership nonce, creation lineage, empty dependency
set, provider ID shape, and exact VPC state digest. Apply/reconcile requires
the earlier VPC action settled; reverse destroy requires its later delete still
pending.

Every accepted security-group observation must name that exact VPC and AWS
account. A separate VPC read is unnecessary at this graph edge: the VPC driver
owns provider verification immediately earlier in apply order, while the
security group's `VpcId` independently corroborates the endpoint. Delete does
not require current VPC health, which would strand cleanup after parent drift.

## Atomic ownership and three-view recovery

Create sends one deeply frozen AWS SDK request containing `GroupName`,
`Description`, `VpcId`, and a `security-group` tag specification with all 13
schema-2 ownership tags sorted canonically. Ownership creation is atomic with
the resource; Wharfie never retags or adopts an existing group.

Every recovery decision reconciles three identities:

1. an exact `GroupIds` read when a durable or ephemeral candidate ID exists;
2. complete discovery through the stable eight-tag logical locator; and
3. complete VPC-wide discovery filtered only by `vpc-id`, with the fixed group
   name compared locally and case-insensitively.

The natural-slot read does not use AWS's case-sensitive name filter because
AWS enforces group-name uniqueness case-insensitively within one VPC. It uses
`MaxResults=1000`, a 16-page bound, and rejects malformed pages, cycling or
exhausted tokens, duplicate IDs, and multiple case-folded slot occupants.
Unrelated well-formed groups are ignored.

The three views must converge on one exact group ID. A one-view lag is
transitional. A different ID, foreign or case-variant name occupant, duplicate
logical match, wrong ownership tag, VPC/account mismatch, or immutable
name/description drift blocks and is never adopted, retagged, replaced, or
deleted. Tag absence can be transitional only while settling create; a durable
no-op or delete requires the complete ownership envelope.

## Crash recovery without an exactly-once fiction

`CreateSecurityGroup` has no `ClientToken`. AWS instead enforces the natural
slot `(VpcId, case-folded GroupName)`. Wharfie reads all three identity views
before mutation, uses the shared in-process crossed-create guard, treats the
returned `GroupId` only as an ephemeral exact-read locator, and settles solely
from later provider evidence.

`InvalidGroup.Duplicate` and every other allowlisted mutation error remain
readback-only. A response lost after successful creation is recovered from the
tagged and natural-slot views. A foreign occupant of the case-insensitive name
slot blocks rather than being replaced. The slot prevents simultaneous
same-name occupants in one VPC; it does not prove exactly-once API calls or
lifetime effects. External deletion followed by a later replay can create a
new `sg-*` resource.

## Reverse-order purge and corroborated absence

Delete re-proves the exact durable binding and VPC lineage, then requires the
bound security-group ID, account, VPC, fixed name and description, and complete
schema-2 ownership tags. Mutable firewall-rule drift does not revoke authority
to delete this exactly owned container. Wharfie sends only:

```text
DeleteSecurityGroup({ GroupId })
```

It never revokes rules or modifies dependent instances, interfaces, group
references, or VPC associations. AWS dependency errors remain retryable
fences. Mutation success, `InvalidGroup.InUse`, `DependencyViolation`, and
not-found errors are nonauthoritative and trigger only fresh readback.

Deletion settles only when the exact bound read returns a documented typed
not-found and both complete tagged and case-insensitive natural-slot discovery
are empty. Successful empty exact-ID responses are malformed rather than
absence. Any one-view disagreement is transitional; foreign, duplicate,
malformed, or inaccessible evidence cannot become deletion authority.

## Focused proof and disk hygiene

Focused deterministic-mock verification covers the authority surface, exact
digest, fixed name and description, VPC dependency authority, atomic tags,
immutable SDK requests, firewall evidence, three-view identity correlation,
case-insensitive collision refusal, bounded pagination, response-loss and
duplicate-error recovery, crossed-create fencing, no-op binding preservation,
reverse deletion with rule drift, dependency errors, strict corroborated
absence, sanitization, retry bounds, and frozen factory contracts.

The security-group suite passes 109/109 tests. The ten-suite networking gate,
including the shared authority and tagged-recovery kernels plus all eight
network-effect drivers, passes 720/720 tests. All four source, application,
test, and SEA-verifier TypeScript checks pass, as do targeted ESLint, Prettier,
and diff-integrity checks.

All Jest runs use pinned Node 24.13.1 with `--coverage=false`, `--no-cache`, and
`--runInBand`. Generated-artifact scans and repository-size checks follow
testing; no coverage, Jest cache, `dist`, build tree, or TypeScript build-info
artifact is intentionally retained.

## What is still intentionally absent

- No runtime-identity, managed-artifact, substrate-node, or retained-volume
  attachment driver is implemented in this slice.
- The retained-volume and eight implemented network-effect drivers are not yet
  composed into a complete AWS provider, inspection, plan, or controller path.
- No operator `plan`, `apply`, `inspect`, `reconcile`, or `destroy` command is
  mounted.
- No retained volume is attached, formatted, or mounted.
- No resident service, privileged host observer, live-account lifecycle proof,
  coordinator recovery, or trusted multi-node mesh is added here.

## Ordered next work

1. Implement the fixed runtime identity and least-privilege instance-profile
   boundary needed by the resident node.
2. Implement managed artifact publication, then the substrate node and its two
   retained-volume attachments in fixed graph order.
3. Compose graph-wide inspection, deterministic planning, provider routing,
   controller ports, and packaged lifecycle commands; then project retained
   storage and activate the resident service.
4. Prove the full interruption and response-loss matrix in a clean AWS account
   through the user's ordinary credential chain.
5. Begin provider-backed coordinator recovery only after the complete
   single-node lifecycle is proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v36-direct-ec2-security-group-resource.md` on
> branch `agent/strict-manifest`. Use only the local git CLI; do not spend time
> on PRs or issues. Breaking changes are allowed, v1 compatibility is abandoned,
> and the historical stash must remain untouched. Run only focused pinned-Node
> tests with coverage and caches disabled, then remove generated artifacts. The
> next fixed graph resource is `runtime-identity`; define and implement its
> narrow AWS authority and recoverable direct ownership contract before moving
> to the managed artifact and substrate node.
