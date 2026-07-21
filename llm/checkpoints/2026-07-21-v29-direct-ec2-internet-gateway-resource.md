# V29 direct EC2 internet-gateway resource checkpoint

Date: 2026-07-21

This is an immutable restart handoff for the Wharfie project reset. Read it
with [the project charter](../../PROJECT.md), [the live roadmap](../../ROADMAP.md),
[ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md),
and the preceding
[V28 direct EC2 VPC checkpoint](./2026-07-21-v28-direct-ec2-vpc-resource.md).
Later work should add another checkpoint rather than rewriting this one.

## Outcome

The fixed `network-internet-gateway` role now has a controller-compatible
direct-EC2 lifecycle driver. Wharfie can preflight, create, discover, strictly
read back, bind, reconcile, and purge the one standalone internet gateway owned
by a deployment incarnation. The resource is one independently recoverable
effect in ProviderSpec V3's fixed 15-role graph. Attaching it to the VPC remains
the next derived graph effect rather than hidden state inside this receipt.

This slice extends the existing finite direct-EC2 network boundary instead of
introducing another provider protocol. The proof is deterministic and
mock-backed. The driver is not yet composed into a complete provider router,
and no live-account lifecycle claim is made.

## Preserved repository state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`8d4e33d53af798734c15e8503f02a0c1f5ae6143`. That commit implements the
recoverable direct-EC2 VPC lifecycle. The retained-volume ownership-incarnation
token correction remains in history at `8213319886670c8314a868be569d8c4bda446b24`.

The historical local stash remains untouched as
`stash@{0}: WIP on master: 3dee66b work prompt`. The commit containing this
checkpoint becomes the V29 restart point after it is pushed and the exact
remote tip is fetched and verified.

## Narrow network-authority extension

`createAwsDeploymentAuthority().createNetworkResourceClient()` retains the VPC
surface and adds exactly three caller-owned internet-gateway operations:

- `createInternetGateway`;
- `describeInternetGateways`; and
- `deleteInternetGateway`.

The frozen capability continues to reuse one credential/region EC2 client,
keeps the SDK at one total attempt, and exposes neither credentials, SDK
configuration, `send`, nor `destroy`. Construction, operation, closed-client
use, and close failure still cross the boundary only as fixed non-echoing
errors. The sanitizer now preserves `InvalidInternetGatewayID.NotFound` in
addition to the existing network classifications needed for authoritative
absence and dependency-fenced deletion.

`CreateInternetGateway` has no durable client token. Capping the SDK at one
attempt ensures that retry decisions remain in Wharfie's evidence protocol
rather than becoming invisible transport replays.

## Exact intrinsic gateway contract

`getAwsSingleNodeInternetGatewayStateDigest(...)` validates the complete
ProviderSpec V3 and hashes this constant provider-observable descriptor in the
domain `wharfie:aws-single-node-ec2-internet-gateway-state:v1`:

```text
schema version: 1
kind: awsSingleNodeEc2InternetGatewayState
destroy policy: purge
```

The digest intentionally contains no VPC identity or attachment state. The
resource accepts only graph key `network-internet-gateway`, capability
`networking@1`, role `internet-gateway@1`, provider type
`ec2-internet-gateway`, managed direct ownership, no dependencies, and purge
lifecycle. It validates the exact profile, plan, provider specification, head,
current action index, running intent, action, and durable ownership nonce
before any provider call.

Create sends one deeply frozen request containing only a sorted complete
schema-2 ownership tag envelope in the `internet-gateway`
`TagSpecification`. Those atomic tags bind the resource kind, capability,
role, provider scope, deployment, incarnation, graph key, original creating
action, ownership nonce, state digest, and purge policy. Wharfie never creates
an untagged gateway and never repairs ownership tags after creation.

## Recovery and evidence fence

Every create first completes paginated logical discovery. Discovery uses the
same eight stable locator tags as the VPC driver, with at most 100 results per
page and 16 pages, while complete validation checks every reserved ownership
tag and the exact provider account. Missing tags can remain retryable during
create propagation; malformed evidence is unknown; contradictory present
evidence is a conflict.

A valid create response ID is only a process-local candidate locator. Whether
the ID comes from the sole discovery, a candidate, or a durable binding, the
driver keeps broad tagged discovery and exact-ID `DescribeInternetGateways`
observations separate, requires both to identify the same sole gateway, and
validates every present record before classifying one-sided visibility as
unresolved. A successful exact response with an empty `InternetGateways`
collection is malformed; only the sanitized
`InvalidInternetGatewayID.NotFound` classification proves exact absence.

The process records `actionId + ownershipNonce` immediately before crossing
the `CreateInternetGateway` mutation boundary. An error or malformed response
preserves that attempt fence, so the same resource factory never issues a
second create for the same intended effect. A newly persisted ownership nonce
is a distinct authorized effect and therefore receives a separate fence. A
fresh process can recover one uniquely and atomically tagged gateway after
response loss.

There is the same explicit provider boundary as V28: EC2 supplies neither a
durable internet-gateway create token nor a uniqueness constraint on tags. If
a process dies after an accepted create but before that effect becomes visible,
a fresh process can still race another create. Wharfie therefore does not claim
provider exactly-once execution. During create, zero evidence remains not
converged, while multiple logical matches block. A nondestructive create or
no-op never picks a winner, detaches a gateway, or deletes a duplicate; cleanup
requires a future explicitly destructive operator action.

This slice applies the same present-evidence ordering to the VPC driver. A
wrong owner, ownership tag, nondefault invariant, or intrinsic contract in a
visible broad or exact record is now classified before a missing corroborating
read can reduce it to an eventual-consistency transition.

## Attachment-independent create and reconcile

Create and no-op validate gateway identity, account ownership, and the complete
ownership-tag envelope required by the contract, but deliberately do not
constrain the provider's `Attachments` collection. Once the following derived role has attached the
gateway, that nonempty relationship is the expected observation of this
earlier intrinsic resource. Requiring detachment here would invert the graph
and make an already converged gateway fail after downstream progress.

A no-op must rediscover the one logical gateway, corroborate the exact durable
binding, and preserve its original creation receipt. Missing or incomplete
bound ownership evidence blocks rather than being repaired. The separate
`network-internet-gateway-attachment` role will own the VPC identity,
`AttachInternetGateway` and `DetachInternetGateway` mutations, attachment
state, and exact dependency-binding lineage.

## Attachment-fenced destroy

Destroy re-proves the sole logical match, exact bound identity, provider
account, and complete ownership tags immediately before deletion. It then
requires the broad discovery record and the independently fetched exact-ID
record each to expose an explicit `Attachments: []`. A visible well-formed
attachment is a retryable dependency fence; a missing, non-array, or malformed
attachment observation is unknown. Neither condition authorizes implicit
detachment or deletion.

Only after both records independently prove emptiness may the driver send
`DeleteInternetGateway` for the exact bound ID. `DependencyViolation` and
`IncorrectState` remain retryable races, and a typed exact-ID not-found during
mutation is idempotent. Settlement publishes a null binding only when complete
logical discovery is empty and exact typed not-found independently proves the
bound identity absent. Duplicate evidence always blocks.

## Verification and disk hygiene

All Jest commands use direct `test/run-jest.js` execution with
`--coverage=false --no-cache --runInBand`. Final focused verification under
Node 24.13.1 passed:

- the AWS authority, internet-gateway resource, and VPC resource suites, 170
  tests total;
- all four source, app implementation, test, and SEA-verifier TypeScript
  configurations;
- targeted ESLint and Prettier checks for every changed JavaScript file;
- Prettier for every changed Markdown file and `git diff --check`; and
- a generated-artifact scan outside `node_modules`.

No coverage, Jest cache, nyc output, TypeScript build info, or other generated
test/build artifact is intentionally retained. The repository remained
approximately 540 MiB, including a 244 MiB `node_modules`.

## Deliberate limitations

- Direct EC2 internet-gateway creation has the documented
  process-loss/invisible-effect ambiguity; duplicate evidence blocks rather
  than being hidden.
- This driver owns only standalone gateway identity. It does not attach the
  gateway to the VPC, create routes, or manage any downstream network effect.
- Attachment state is intentionally outside create and no-op convergence but
  becomes a strict, independently corroborated safety fence for deletion.
- The driver and narrow client are not yet composed into a complete AWS
  provider router, inspection implementation, or deterministic `createPlan`
  path.
- No operator deployment command or live AWS lifecycle proof exists yet.
- No privileged host observer, resident service activation, coordinator
  failover, or multi-node trusted mesh behavior is added here.

## Ordered next work

1. Implement `network-internet-gateway-attachment` as a derived relationship
   with exact VPC and gateway dependency bindings, explicit attach/detach, and
   recovery-safe relationship readback.
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
> `llm/checkpoints/2026-07-21-v29-direct-ec2-internet-gateway-resource.md` on
> branch `agent/strict-manifest`. Use only the local git CLI; do not spend time
> on PRs or issues. Breaking changes are allowed, v1 and superseded document
> namespaces are abandoned, and no downstream users exist. The exact remote
> parent is preserved at `8d4e33d`; the historical stash must remain untouched.
> ProviderSpec V3 pins one exact 15-role graph. The retained EBS volumes, direct
> EC2 VPC, and standalone internet gateway now have controller-compatible
> drivers. The network authority gives the SDK one attempt; atomic schema-2
> tags, bounded discovery, strict broad-plus-exact readback, and in-process
> action/nonce fences recover one visible logical effect. Because the VPC and
> gateway create APIs have no durable token, an invisible effect across process
> loss may still duplicate; duplicates block and require a future explicit
> destructive repair action. Implement the derived VPC/gateway attachment
> next, then continue the remaining fixed graph in order. Preserve
> evidence-backed effects, exact ownership, ordinary credential chains, direct
> no-coverage testing, immediate artifact cleanup, and honest exactly-once
> boundaries.
