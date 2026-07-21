# V28 direct EC2 VPC resource checkpoint

Date: 2026-07-21

This is an immutable restart handoff for the Wharfie project reset. Read it
with [the project charter](../../PROJECT.md), [the live roadmap](../../ROADMAP.md),
[ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md),
and the preceding
[V27 resource-graph checkpoint](./2026-07-21-v27-multi-effect-resource-graph.md).
Later work should add another checkpoint rather than rewriting this one.

## Outcome

The fixed `network-vpc` role now has a narrow direct-EC2 authority and a
controller-compatible lifecycle driver. Wharfie can preflight, create,
discover, strictly read back, bind, reconcile, and purge the one VPC owned by a
deployment incarnation. The resource remains one independently recoverable
effect in ProviderSpec V3's fixed 15-role graph; subnets, routes, gateways,
attachments, and security groups remain separate later effects.

This slice deliberately uses direct EC2 instead of Cloud Control. The VPC
contract is finite, direct EC2 exposes the exact reads and mutations needed by
the graph role, and adding another asynchronous recovery protocol would widen
authority without eliminating Wharfie's own ownership discovery and readback.

The proof is deterministic and mock-backed. The driver is not yet composed
into a complete provider router, and no live-account lifecycle claim is made.

## Preserved repository state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`8213319886670c8314a868be569d8c4bda446b24`. That commit binds EBS volume
idempotency tokens to the action and ownership incarnation. V27's fixed graph
remains in history at `7a9ef53ecaa70706be1b8da95d301fee37d5416c`.

The historical local stash remains untouched as
`stash@{0}: WIP on master: 3dee66b work prompt`. The commit containing this
checkpoint becomes the V28 restart point after it is pushed and the exact
remote tip is fetched and verified.

## Narrow network authority

`createAwsDeploymentAuthority().createNetworkResourceClient()` creates a
caller-owned frozen EC2 capability with exactly:

- `createVpc`;
- `describeVpcs`;
- `describeVpcAttribute`;
- `deleteVpc`; and
- idempotent `close`.

It reuses the invocation's immutable credential snapshot and explicit region
without exposing credentials, SDK configuration, `send`, or `destroy`.
Construction, operation, closed-client use, and close failure cross the
boundary as fixed non-echoing errors. Only `InvalidVpcID.NotFound`,
`DependencyViolation`, `IncorrectState`, and a bounded HTTP status survive as
provider classifications needed by the resource protocol.

The EC2 SDK is configured for one total attempt. `CreateVpc` has no
`ClientToken`, so a hidden transport replay could otherwise turn one authorized
driver call into more than one physical VPC before Wharfie has any evidence to
reconcile.

## Exact VPC contract

`getAwsSingleNodeVpcStateDigest(...)` validates the complete ProviderSpec V3
and hashes this finite provider-observable contract in the domain
`wharfie:aws-single-node-ec2-vpc-state:v1`:

```text
kind: awsSingleNodeEc2VpcState
CIDR: ProviderSpec networking.vpcCidr (currently 10.42.0.0/16)
instance tenancy: default
default VPC: false
IPv6: false
DNS support: true
DNS hostnames: false
internet-gateway block mode: off
destroy policy: purge
```

The resource accepts only graph key `network-vpc`, capability
`networking@1`, role `vpc@1`, provider type `ec2-vpc`, managed direct ownership,
no dependencies, and purge lifecycle. It validates the exact profile, plan,
provider specification, head, current action index, running intent, action,
and durable ownership nonce before any provider call.

Create sends one deeply frozen request with the exact CIDR, default tenancy,
provider IPv6 allocation disabled, and a sorted complete schema-2 ownership tag
envelope in the request's `vpc` `TagSpecification`. The tags bind the resource
kind, capability, role, provider scope, deployment, incarnation, graph key,
original creating action, ownership nonce, state digest, and purge policy.
Wharfie never creates an untagged VPC and never repairs ownership tags after
creation.

## Recovery and evidence fence

Every create first completes paginated logical discovery. Discovery uses eight
stable locator tags, at most 100 results per page and 16 pages, while full
validation also checks every reserved tag. A unique discovered VPC is not
accepted until its ID, owner account, lifecycle state, primary CIDR association,
tenancy, nondefault identity, absence of IPv6, DNS attributes, syntactically
valid DHCP-options ID, effective public-access mode, and complete tags satisfy
the contract. Malformed evidence is unknown; contradictory present evidence is
a conflict; ordinary create propagation is retryable.

Create responses are only process-local candidate locators. When a candidate
or durable binding supplies an exact ID, the driver keeps broad tagged
discovery and exact-ID `DescribeVpcs` observations separate, requires both to
name the same sole VPC, validates both independently, and reads DNS attributes
for that exact identity. One-sided visibility remains unresolved. A successful
exact response with an empty `Vpcs` collection is malformed; only the sanitized
`InvalidVpcID.NotFound` classification proves exact absence.

The process records `actionId + ownershipNonce` immediately before crossing
the `CreateVpc` mutation boundary. An error or malformed response preserves
that attempt fence, so the same factory never issues a second request for the
same intended effect. A fresh process can recover one uniquely tagged VPC
after response loss.

There is an explicit provider boundary: EC2 supplies neither a durable VPC
create token nor a uniqueness constraint on tags. If a process dies after an
accepted create but before the effect becomes discoverable, a fresh process
can still race another create. Wharfie therefore does not claim provider
exactly-once execution. Zero evidence remains not converged, while two logical
matches block. A nondestructive create plan never chooses a winner or deletes
duplicates; repair requires a future explicitly destructive operator action.

## Reconcile and destroy

A no-op must rediscover the sole logical VPC, corroborate the exact bound ID,
and preserve the binding's original creation receipt. Missing or incomplete
bound ownership tags block instead of being repaired. A late-visible duplicate
also blocks without deletion.

Destroy re-proves the sole logical match, exact bound identity, provider
account, complete ownership tags, the nondefault-VPC invariant, and a sane
lifecycle state immediately before `DeleteVpc`. Mutable configuration drift
does not revoke authority to delete an explicitly bound and exactly owned
identity; destroy does not need the resource to reconverge before removing it.
`DependencyViolation` and `IncorrectState` remain retryable races. Settlement
requires both zero complete logical matches and exact typed not-found evidence
before publishing a null binding.

AWS-created default route-table, security-group, network-ACL, and DHCP-options
association artifacts are intrinsic VPC side effects rather than separate
Wharfie bindings. The graph's dedicated route-table and security-group roles
create the application substrate's independently owned resources later.

## Verification and disk hygiene

All Jest commands used direct `test/run-jest.js` execution with
`--coverage=false --no-cache --runInBand`. Final focused verification under
Node 24.13.1 passed:

- the AWS authority and VPC resource suites, 111 tests total;
- all four source, app implementation, test, and SEA-verifier TypeScript
  configurations;
- targeted ESLint and Prettier checks for the authority and VPC source/tests;
- repository Markdown formatting and `git diff --check`; and
- a generated-artifact scan outside `node_modules`.

The repository remained approximately 539 MiB, including a 244 MiB
`node_modules`. No coverage, Jest cache, nyc output, TypeScript build info, or
other generated test/build artifact is intentionally retained.

## Deliberate limitations

- Direct EC2 VPC creation has the documented process-loss/invisible-effect
  ambiguity; duplicate evidence blocks rather than being hidden.
- This driver proves only the intrinsic VPC role. It does not create an internet
  gateway, gateway attachment, subnet, route table, route, association, or
  application security group.
- The DHCP-options identifier is shape-validated, but its referenced option set
  is not inspected or managed in this slice.
- The driver and narrow client are not yet composed into a complete AWS provider
  router, inspection implementation, or deterministic `createPlan` path.
- No operator deployment command or live AWS lifecycle proof exists yet.
- No privileged host observer, resident service activation, coordinator
  failover, or multi-node trusted mesh behavior is added here.

## Ordered next work

1. Implement `network-internet-gateway`, keeping gateway creation independent
   from its later derived VPC attachment role.
2. Implement the gateway attachment, subnet, route table, default route,
   subnet/route-table association, and application security group in graph
   order with exact reverse-destroy behavior.
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
> `llm/checkpoints/2026-07-21-v28-direct-ec2-vpc-resource.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 and superseded document
> namespaces are abandoned, and no downstream users exist. The remote parent
> is preserved at `8213319`; the historical stash must remain untouched.
> ProviderSpec V3 pins one exact 15-role graph. The retained EBS volumes and
> direct EC2 VPC now have controller-compatible drivers. The VPC authority
> gives the SDK one attempt; atomic schema-2 tags, bounded discovery, strict
> broad-plus-exact readback, and an in-process action/nonce fence recover one
> visible logical effect. Because `CreateVpc` has no durable token, an invisible
> effect across process loss may still duplicate; duplicates block and require
> a future explicit destructive repair action. Implement the internet-gateway
> role next, separate its VPC attachment into the following derived role, and
> continue the remaining fixed graph in order. Preserve evidence-backed
> effects, exact ownership, ordinary credential chains, direct no-coverage
> testing, immediate artifact cleanup, and honest exactly-once boundaries.
