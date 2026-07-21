# V30 derived internet-gateway attachment checkpoint

Date: 2026-07-21

This is an immutable restart handoff for the Wharfie project reset. Read it
with [the project charter](../../PROJECT.md), [the live roadmap](../../ROADMAP.md),
[ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md),
and the preceding
[V29 direct EC2 internet-gateway checkpoint](./2026-07-21-v29-direct-ec2-internet-gateway-resource.md).
Later work should add another checkpoint rather than rewriting this one.

## Outcome

The fixed `network-internet-gateway-attachment` role now has a
controller-compatible derived-relationship lifecycle driver. Wharfie can
preflight, attach, strictly read back, bind, reconcile, detach, and prove the
absence of the exact relationship between its settled VPC and internet
gateway. The attachment is one independently recoverable effect in ProviderSpec
V3's fixed 15-role graph rather than hidden mutable state in either directly
owned endpoint receipt.

This slice is deterministic and mock-backed. The relationship driver is not
yet composed into a complete provider router, and no live-account lifecycle
claim is made.

## Preserved repository state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`adc6f357788a74e337664e8faeebf8e092c968f9`. That V29 commit implements the
recoverable standalone internet-gateway lifecycle and preserves the VPC
attachment as the following derived graph effect.

The historical local stash remains untouched as
`stash@{0}: WIP on master: 3dee66b work prompt`. The commit containing this
checkpoint becomes the V30 restart point after it is pushed and the exact
remote tip is fetched and verified.

## Narrow network-authority extension

`createAwsDeploymentAuthority().createNetworkResourceClient()` retains the
existing VPC and internet-gateway surface and adds exactly two relationship
mutations:

- `attachInternetGateway`; and
- `detachInternetGateway`.

Both calls reuse the same credential/region EC2 client and its one-total-attempt
transport policy. The sanitizer preserves the bounded
`Resource.AlreadyAssociated` and `Gateway.NotAttached` classifications needed
to distinguish provider outcomes without returning provider messages, request
IDs, causes, credentials, or client configuration. Neither classification
settles an action by itself.

## Exact derived contract

The relationship accepts only graph key
`network-internet-gateway-attachment`, capability `networking@1`, role
`internet-gateway-attachment@1`, provider type
`ec2-internet-gateway-attachment`, derived ownership, purge lifecycle, and the
two dependencies in canonical graph order:

1. `network-vpc`; and
2. `network-internet-gateway`.

Its context validates the complete profile, plan, ProviderSpec V3, head,
current action index, running intent, action, exact dependency bindings, and
ownership nonce before any provider call. The dependencies must be settled
direct bindings from the same provider scope, deployment, and incarnation,
and their exact binding IDs become the new relationship binding's immutable
lineage.

The state digest is intentionally constant: it binds the relationship kind,
the target provider state `available`, and purge policy. Endpoint identities
come from dependency lineage rather than the target-state digest. Because EC2
does not assign an attachment ID or permit tags on this relation, Wharfie
derives one `wia1` synthetic provider-resource ID by content-addressing the
exact VPC and internet-gateway provider IDs. That identifier cannot establish
provider state; it is only a stable receipt for the pair that strict readback
must re-prove.

## Two independent relationship observations

Every settlement attempt completes two bounded
[`DescribeInternetGateways`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInternetGateways.html)
observations:

- complete paginated discovery filtered by the exact VPC ID; and
- an independent exact-ID lookup of the dependency-bound gateway.

Both reads must corroborate the same gateway/VPC pair and an `available`
attachment before create or no-op can settle. The expected pair appearing on
only one side is an eventual-consistency transition, as is a well-formed
nonavailable attachment state. A gateway occupied by another VPC, another
gateway occupying the expected VPC, duplicate attachment rows, or any other
impossible one-to-one cardinality is a conflict. Truncated pagination,
malformed records, invalid endpoint IDs, inaccessible evidence, and unexpected
provider shapes are unknown rather than absence.

The relationship is untaggable, so there is no broad ownership search or
winner selection. Authority always comes from the exact dependency-binding
lineage, and evidence always comes from the complete pair of provider reads.

## Recovery-safe attach and no-op

Create first performs both observations. An already available exact pair is
converged and produces the derived binding without another mutation. A cleanly
absent pair may send one deeply frozen
[`AttachInternetGateway`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_AttachInternetGateway.html)
request containing only the exact dependency endpoint IDs, then performs both
reads again. A response, missing response, malformed response, or sanitized
`Resource.AlreadyAssociated` error is never settlement evidence.

EC2 permits a VPC to have one attached internet gateway and an internet
gateway to attach to one VPC. That cardinality makes replay of the same pair
logically idempotent: strict read-before-write and readback either observe the
intended relationship, retain a transition, or expose a conflicting endpoint.
Wharfie does not claim the underlying API call executes exactly once.

No-op performs the same two observations, requires the exact available pair,
and preserves the original derived receipt. It never attaches, adopts another
pair, repairs lineage, or rewrites an endpoint binding.

## Reverse-order detach and absence proof

Canonical reverse graph order reaches this derived relationship before the
standalone gateway or VPC. Destroy first revalidates its exact binding and
dependency lineage, then performs both observations. It may send one deeply
frozen
[`DetachInternetGateway`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DetachInternetGateway.html)
request only for the exact pair. A response, missing response, malformed
response, or sanitized `Gateway.NotAttached` error is never settlement
evidence.

The null binding settles only after complete VPC-filtered discovery and the
independent exact-gateway read both prove that exact pair absent. One-sided or
nonavailable evidence remains transitional, while another endpoint or
impossible cardinality blocks. This prevents the later intrinsic gateway purge
from using the relationship action as hidden detach authority and preserves
the gateway driver's own independently corroborated empty-attachment fence.

## Exactly-once boundary

This slice claims logical convergence for one exact relationship, not
exactly-once provider execution. Unlike direct VPC or gateway creation, there
is no invisible duplicate object to distinguish: the provider's one-to-one
relationship can be re-read before retry. Even so, transport acceptance is not
durable evidence. Only the two complete observations can settle attach or
detach, and contradictory evidence remains visible rather than being repaired
behind the controller's plan.

## Verification and disk hygiene

All Jest commands use direct `test/run-jest.js` execution with
`--coverage=false --no-cache --runInBand`. Final focused verification under
Node 24.13.1 passed:

- the AWS authority suite, 39 tests;
- the direct VPC suite, 78 tests;
- the direct internet-gateway suite, 55 tests; and
- the derived internet-gateway attachment suite, 80 tests.

The four focused suites pass 252 tests in total.

The final V30 verification also covers all four source, app implementation,
test, and SEA-verifier TypeScript configurations; targeted ESLint and Prettier
checks for changed implementation files; Prettier for changed Markdown; and
`git diff --check`. Generated-artifact scans and repository-size checks run
after testing so no coverage, Jest cache, nyc output, TypeScript build info, or
other generated test/build artifact is intentionally retained. The repository
remains approximately 540 MiB, including a 244 MiB `node_modules`.

## Deliberate limitations

- This role owns only the exact VPC/internet-gateway relationship. It does not
  create the subnet, route table, default route, association, or security
  group.
- The relationship is derived and untaggable; its `wia1` ID is a local durable
  receipt, never a provider ownership tag or substitute for readback.
- Same-pair retries are logically idempotent, but Wharfie makes no
  `AttachInternetGateway` or `DetachInternetGateway` API-call exactly-once
  claim.
- The direct and derived network drivers are not yet composed into a complete
  AWS provider router, inspection implementation, or deterministic
  `createPlan` path.
- No operator deployment command or live AWS lifecycle proof exists yet.
- No privileged host observer, resident service activation, coordinator
  failover, or multi-node trusted mesh behavior is added here.

## Ordered next work

1. Extract a narrow internal tagged direct-EC2 effect kernel for the duplicated
   VPC and internet-gateway discovery, exact corroboration, ownership
   validation, and attempted-effect fencing; migrate both drivers without
   weakening their distinct state contracts.
2. Implement the subnet, route table, default IPv4 route, subnet/route-table
   association, and application security group in graph order with exact
   reverse-destroy behavior.
3. Implement runtime identity, artifact, substrate node, and the two volume
   attachments, then compose the provider router, graph-wide inspection, and
   deterministic `createPlan`.
4. Project retained volumes into the guest, format only newly owned empty
   volumes, mount them safely, and activate the packaged resident service.
5. Add packaged operator lifecycle commands and prove the interruption matrix
   in a clean AWS account through the user's ordinary credential chain.
6. Begin provider-backed coordinator recovery only after the complete
   single-node lifecycle is proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v30-derived-internet-gateway-attachment.md` on
> branch `agent/strict-manifest`. Use only the local git CLI; do not spend time
> on PRs or issues. Breaking changes are allowed, v1 and superseded document
> namespaces are abandoned, and no downstream users exist. The exact remote
> parent is preserved at `adc6f357`; the historical stash must remain
> untouched. ProviderSpec V3 pins one exact 15-role graph. The retained EBS
> volumes, direct VPC, standalone internet gateway, and derived VPC/gateway
> attachment have controller-compatible drivers. The relationship's exact
> dependency lineage, `wia1` endpoint identity, and complete VPC-filtered plus
> independent exact-gateway readback make same-pair retries logically
> idempotent without claiming API-call exactly-once execution. Responses and
> typed errors never settle mutations; one-sided and nonavailable evidence
> remains transitional, while occupied endpoints and impossible cardinality
> block. Extract and migrate the narrow tagged direct-EC2 effect kernel next,
> then continue the fixed graph with the subnet. Preserve evidence-backed
> effects, exact ownership, ordinary credential chains, direct no-coverage
> testing, immediate artifact cleanup, and honest exactly-once boundaries.
