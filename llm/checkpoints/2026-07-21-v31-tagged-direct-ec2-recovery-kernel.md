# V31 tagged direct-EC2 recovery kernel checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`b2d251b0dcc7bce8e4ba1ffeb6c63f9b6f2cdf99`

This checkpoint follows the
[V30 derived internet-gateway attachment checkpoint](./2026-07-21-v30-derived-internet-gateway-attachment.md).
It removes the duplicated identity-recovery protocol from the direct VPC and
internet-gateway drivers without merging their distinct resource semantics.

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

`deployment-aws-tagged-ec2-recovery.js` is a narrow internal kernel for a
directly owned EC2 resource whose tags are written atomically with creation. It
owns only the mechanics shared by the VPC and standalone internet gateway:

- the exact 13-tag schema-2 ownership and contract envelope;
- lexicographically sorted create tags;
- the fixed eight stable logical-discovery filters, deliberately excluding the
  action ID, ownership nonce, state digest, retention, and schema tags;
- deeply frozen, bounded paginated discovery requests;
- one logical identity across all pages, with duplicate or multiple IDs
  classified as conflicts;
- correlation of logical discovery with a candidate or durable exact provider
  ID;
- neutral conflict, transient, and unknown evidence markers;
- strict ownership-tag validation, including propagation-only incompleteness,
  duplicate keys, reserved-tag conflicts, unknown Wharfie tags, malformed
  values, and the EC2 tag limit; and
- factory-local candidate storage plus a non-idempotent create fence keyed by
  the exact action ID and ownership nonce.

The create fence is claimed immediately before the provider mutation. It
survives a thrown call, malformed response, candidate cleanup, and successful
settlement. A changed ownership nonce denotes a new durable intended effect and
therefore receives a new fence. A successful provider response remains only an
ephemeral locator and never proves convergence.

## Deliberate kernel boundary

The kernel does not decode VPC or internet-gateway AWS response envelopes and
does not interpret their typed not-found errors. Each role supplies a
normalized discovery-page adapter and an exact-read adapter. Resource-specific
owner and lifecycle evidence, VPC CIDR/DNS/IPv6/public-access checks, gateway
attachment delete fences, mutation requests, dependency rules, binding
construction, public error mapping, and retry outcomes remain in their drivers.

This prevents a shared helper from becoming a generic cloud-resource framework
or silently imposing one role's semantics on another.

Role adapters sanitize provider-call failures before decoding. The kernel also
recreates its neutral marker errors at the adapter boundary instead of
preserving arbitrary error objects, so a custom client cannot inject provider
details or select conflict/transient classification by throwing an internal
marker instance. Once two distinct logical IDs are already well-formed and
visible, that conclusive conflict short-circuits later pages; a subsequent
provider failure cannot erase the proven duplicate.

## Preserved VPC and gateway differences

The VPC migration selects `useDiscoveredId: false`. In a fresh process with no
candidate or binding, one completely validated logical VPC may recover from the
broad tag query plus its two DNS-attribute reads without an additional exact-ID
`DescribeVpcs`. Once a candidate or binding exists, its broad and exact views
must agree.

The internet-gateway migration selects `useDiscoveredId: true`. A sole logical
gateway is promoted to an exact locator and must be corroborated by an
independent exact-ID `DescribeInternetGateways` before settlement. Create/no-op
continue to ignore attachment state because the derived attachment role owns
that relationship. Destroy continues to require explicit empty attachments in
both views.

Both drivers still validate every present record before classifying one-sided
visibility as transitional. Provider conflicts therefore cannot hide behind a
temporarily absent corroborating view. AWS response decoding, exact typed
absence, create requests, delete requests, binding contents, retry bounds, and
sanitized public errors are unchanged.

## Characterization and focused proof

The new direct kernel suite locks:

- exact tags, sorted create tags, eight-filter discovery, and deep freezing;
- tag propagation, conflict, malformed-evidence, and factory-contract cases;
- bounded pagination, malformed/cyclic tokens, duplicate/multiple IDs, and
  exact identity mismatch;
- explicit discovery-only versus discovery-plus-exact policy;
- sanitized adapter failures; and
- action-plus-nonce attempt fencing, candidate correlation, and cleanup that
  does not clear the attempted-effect fence.

The VPC suite now also explicitly proves that fresh response-loss recovery
issues one broad request and no exact-ID request. It locks malformed discovery
tokens and the impossible exact-response continuation-token classification.

Focused verification at this checkpoint:

- tagged recovery kernel: 10 tests;
- direct VPC: 79 tests;
- standalone internet gateway: 55 tests;
- combined focused total: 144 tests;
- all four source, application, test, and SEA-verifier TypeScript checks passed;
- targeted ESLint passed;
- targeted Prettier and `git diff --check` passed.

All Jest runs used pinned Node 24.13.1 with `--coverage=false --no-cache`.
No coverage, Jest cache, `dist`, or build tree is intentionally retained.

## What is still intentionally absent

- No subnet or later fixed-graph driver is implemented in this slice.
- The four implemented resource drivers are not yet composed into a complete
  AWS provider, inspection, or controller path.
- No operator `plan`, `apply`, `inspect`, `reconcile`, or `destroy` command is
  mounted.
- No retained volume is attached, formatted, or mounted.
- No resident service, privileged host observer, live-account lifecycle proof,
  coordinator recovery, or trusted multi-node mesh is added here.
- No API-call exactly-once claim is made for non-idempotent EC2 creates.

## Ordered next work

1. Extend the single-attempt network authority with `CreateSubnet`,
   `DescribeSubnets`, and `DeleteSubnet`, preserving both AWS subnet not-found
   spellings and the existing sanitized retryable delete errors.
2. Implement `network-subnet` as a managed, direct, purge resource with exact
   dependency lineage to the settled VPC binding. Its state digest should bind
   the fixed subnet CIDR, pinned Availability Zone ID, nondefault identity,
   IPv4-only behavior, subnet-wide public-IP auto-assignment disabled, and
   purge policy. The dynamic VPC ID belongs in the dependency binding rather
   than the plan-time digest.
3. Reuse the tagged kernel for logical identity, then add a bounded collision
   read filtered by the exact VPC ID and subnet CIDR. Correlate the logical,
   natural-slot, candidate/bound exact, and VPC-dependency evidence before
   create, no-op, or delete. This distinguishes tag propagation from a foreign
   subnet permanently occupying the immutable CIDR.
4. Keep `MapPublicIpOnLaunch` false. The provider specification's public IPv4
   requirement belongs to the later substrate node's primary ENI, where only
   Wharfie's node receives a public address. Do not add a second
   `ModifySubnetAttribute` mutation to this resource.
5. Continue in graph order with the route table, default IPv4 route,
   subnet/route-table association, and application security group; then add
   runtime identity, managed artifact, node, and retained-volume attachments.
6. Compose inspection, planning, controller ports, packaged lifecycle commands,
   resident-service activation, and clean-account interruption proof before
   starting provider-backed coordinator recovery.

The intended subnet create request is one atomic operation containing the
exact VPC dependency ID, fixed subnet CIDR, pinned Availability Zone ID, and
the complete schema-2 `subnet` tag specification. It must not use an account-
relative zone name, IPAM, Outpost, IPv6 allocation, or a nonexistent client
token. Mutation responses and typed errors remain nonauthoritative; only fresh
complete provider reads settle actions.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v31-tagged-direct-ec2-recovery-kernel.md` on
> branch `agent/strict-manifest`. Use only the local git CLI; do not spend time
> on PRs or issues. Breaking changes are allowed, v1 and superseded document
> namespaces are abandoned, and no downstream users exist. The exact remote
> parent before V31 is `b2d251b0`; the historical stash must remain untouched.
> The retained volumes, direct VPC, standalone gateway, and derived gateway
> attachment have controller-compatible drivers. VPC and gateway now share the
> narrow internal tagged direct-EC2 recovery kernel for exact schema-2 tags,
> bounded singleton discovery, identity correlation, and action-plus-nonce
> create fencing while keeping AWS decoding and role lifecycle evidence local.
> Implement the subnet next: exact VPC dependency lineage, atomic subnet tags,
> pinned AZ ID/CIDR, public-IP auto-assignment off, and complete tag plus
> VPC/CIDR collision and exact-ID readback. Preserve evidence-backed effects,
> ordinary credential chains, direct no-coverage testing, immediate artifact
> cleanup, and honest exactly-once boundaries.
