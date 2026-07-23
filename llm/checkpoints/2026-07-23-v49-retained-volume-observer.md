# V49 retained-volume observer checkpoint

Date: 2026-07-23

Parent: [V48 AWS resource-observation authority](./2026-07-22-v48-aws-resource-observation-authority.md)

## Restart summary

Wharfie's first golden path remains a normal TypeScript/Node CLI that can run
locally, become a durable single-node AWS service through the user's ordinary
credentials, and later be inspected, reconciled, updated, or destroyed without
a hosted orchestration service. The portable artifact is a Node SEA. Nodes are
trusted. One coordinator is acceptable initially when its durable authority is
recoverable. V1 compatibility, trustless mesh, general-purpose cloud IaC, and a
web UI remain outside scope.

V45 through V48 supplied desired targets, deterministic plans, a raw
observation boundary, and exact target-local read authority. V49 implements the
first provider observer behind that boundary for both retained EBS volume
roles. It observes `application-state` and `control-state` without accepting a
create, delete, settlement, candidate-memory, credential, or client-lifecycle
port.

This slice also corrects the raw observation contract where EC2's consistency
model made the old six-field result insufficient. Provider truth and execution
advice are now separate. A bounded empty read can remain `unknown` while the
exact current create separately says that replaying its stable idempotency
token is safe.

## Seven-field provider truth

Every raw observation now has exactly:

- `resourceKey`;
- `presence`;
- `ownership`;
- `providerIdentity`;
- `observedDigest`;
- `health`; and
- `execution`.

`execution` is `none` except for one tightly constrained union:

```text
presence: unknown
ownership: unknown
providerIdentity: null
observedDigest: null
health: unknown
execution: replay-safe-create
```

This result does not claim that the volume is absent. The generic router
accepts it only for the exact routed managed/direct current create with a
canonical deployment action ID and valid ownership nonce. The volume observer
first revalidates the complete V48 authority and derives the existing EC2
client token from that action ID and nonce.

The distinction follows AWS's documented behavior:

- [EC2 API results are eventually consistent](https://docs.aws.amazon.com/ec2/latest/devguide/eventual-consistency.html);
- [CreateVolume accepts a client token for idempotency](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateVolume.html); and
- [EC2 idempotency is parameter-sensitive](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html).

No aggregate or controller consumes `replay-safe-create` yet. Until a later
slice maps it to the existing exact action driver, it is inert read output.

## Exact observer boundary

`createAwsSingleNodeVolumeResourceObserver` accepts:

- the exact one-method `{describeVolumes}` client port;
- the exact factory `providerScope`;
- an optional bounded `maxAttempts`, defaulting to three and capped at ten; and
- an optional retry waiter.

Explicit null option values are rejected rather than silently selecting
defaults. The returned deeply frozen port is exactly `{observe}`. The caller
retains the credential and client lifecycle.

Each observation re-creates the V48 authority from its eleven source fields,
compares the derived binding and current action to the supplied thirteen-field
authority, and rechecks the factory scope. Only the two managed, direct,
dependency-free, retained `ebs-volume` roles are accepted. A bound create or an
unbound non-create is rejected before provider I/O.

## Three read modes

### Bound exact identity

A durable binding is read only through `VolumeIds: [exactId]`. The observer
never searches for or adopts a replacement. The immutable ownership envelope
is checked against the binding's creation receipt and a creation-era state
digest proven from durable plan history:

- a resident or READY binding uses the exact last-settled plan's action-after
  digest; and
- a binding created and settled during the current initial create uses that
  create action's after digest only when its action ID equals
  `binding.createdByActionId`.

The active action's `before` digest is never used for tag ownership: it is
fresh observed state and may legitimately differ from the immutable creation
tag under drift. If durable history cannot prove the tag, authority is rejected
before I/O.

A readable exact ID with matching ownership returns verified presence and a
digest freshly derived from actual EBS configuration. A prospective target
digest is not substituted, so owned configuration drift stays verified and is
visible to planning. Contradictory ownership returns present/conflict. Exact-ID
NotFound, an empty response, malformed or contradictory response envelopes,
access failure, incomplete provider state, and unsupported lifecycle states
remain unknown; they are never promoted to absence.

### Current intended create

An unbound V48 current create searches only through the eight stable locator
tags. Complete pagination must identify at most one candidate. A unique
candidate is verified only after its exact action ID, ownership nonce,
creation-era state-digest tag, lifecycle, and normalized EBS configuration are
validated.

Only an observation whose entire bounded history consists of successful,
complete, empty discovery attempts returns unknown plus
`replay-safe-create`. Any earlier candidate, creating state, incomplete tag
propagation, malformed page, pagination failure, access failure, or failed
retry waiter permanently removes replay advice from that observation even if a
later attempt is empty.

### Unbound without a current action

This mode performs collision detection, not adoption. Every returned candidate
must corroborate the complete stable locator tag envelope; server-side filters
are not treated as self-proving evidence. One exact locator collision returns
present/conflict. Missing or malformed locator evidence and multiple or
otherwise ambiguous candidates return unknown.

Absent is returned only when every page of every bounded attempt is a clean,
successful, empty locator scan. Any earlier candidate or uncertainty followed
by an empty attempt remains unknown.

## Shared EBS evidence kernel

The mutation driver and observer now share one pure module for:

- stable locator and ownership tags;
- discovery filters;
- exact-ID and paginated response decoding;
- ownership and collision-tag validation;
- lifecycle classification; and
- provider-observable volume-state hashing.

The normalized state descriptor has an exact schema. It recognizes only the
finite EC2 volume types, canonical Availability Zone IDs and KMS key ARNs,
positive sizes and optional positive IOPS/throughput, consistent encryption and
SSE evidence, booleans, and the retained lifecycle policy. The digest includes
volume configuration but deliberately excludes attachment state. Valid
unencrypted or otherwise supported configuration drift remains readable;
malformed provider data remains unknown.

The existing mutation driver retains its public API and client-token formula.
It now consumes the same decoders and digest implementation, preventing the
read and write paths from silently disagreeing about tags or physical state.
Its mutation-specific lifecycle and conflict mapping remains separate from raw
observation semantics.

## Boundedness and failure policy

One discovery attempt reads at most 16 pages with `MaxResults: 500`. Repeated
tokens, duplicate IDs, overlong pagination, malformed envelopes, and access
errors fail closed. Retries use the injected waiter and never retry the whole
future 18-role aggregate.

`available` and `in-use` are readable. `creating` is transient but becomes
unknown without replay advice on exhaustion. `deleting`, `deleted`, `error`,
unknown strings, and malformed lifecycle evidence are unknown to the
observer. Non-substrate raw health remains `not-applicable`; this observer
cannot claim service health.

## Explicit non-claims and next work

V49 does not yet provide:

- observers for the other 14 implementation families and 16 graph roles;
- aggregate InspectionV5;
- a provider-complete controller composition;
- controller consumption of `replay-safe-create`;
- source or packaged `plan`, `apply`, `inspect`, `reconcile`, or `destroy`
  commands;
- guest formatting, mounting, quiescence, or service projection for either
  retained volume;
- one invocation-scoped caller-owned AWS client family;
- clean-account lifecycle proof; or
- provider API-call exactly-once execution.

Continue by adapting the remaining private AWS readers to the seven-field
boundary without duplicating their decoders. The next high-leverage extraction
should establish a shared tagged-EC2 observation kernel for the direct network
resources, then cover derived relationships, IAM, the artifact, the substrate,
and volume attachments before aggregate InspectionV5.

## Verification and disk hygiene

Use pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache. Do not run
the repository's coverage-default test scripts for this slice.

The observation boundary, retained-volume observer, and retained-volume
mutation suites pass 245/245 tests:

```text
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-resource-observation.test.js test/runtime/deployment-aws-volume-resource-observer.test.js test/runtime/deployment-aws-volume-resource.test.js
```

The complete deployment aggregate passes 2,025/2,025 tests over 44 suites:

```text
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-*.test.js
```

All four TypeScript configurations pass under pinned Node 24.13.1. Full
JavaScript lint and formatting, changed-document Markdown formatting, and
`git diff --check` pass. The final artifact scan excludes `node_modules` and
finds no coverage, build, dist, cache, TypeScript incremental, tarball, or
package output.

The historical stash `stash@{0}: WIP on master: 3dee66b work prompt` remains
untouched.
