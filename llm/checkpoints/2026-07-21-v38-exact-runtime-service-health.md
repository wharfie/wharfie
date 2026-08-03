# V38 exact runtime service-health checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`edcd42d4e841b0f010b4b582d63216e8aead494b`

This checkpoint follows the
[V37 runtime-identity resource-graph checkpoint](./2026-07-21-v37-runtime-identity-resource-graph.md).
It closes the service-health addressing and first-publication prerequisites
before Wharfie defines or implements the four AWS runtime-identity effects.

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

## Why the health address changed

The previous current-object address used deployment, incarnation, and binding
content identities:

```text
health/v2/<deploymentInstanceId>/<incarnationId>/<nodeBindingId>
```

Those values describe durable coordinator authority well, but they do not name
the two immutable provider identities that a runtime publisher must ultimately
prove: its IAM role and its EC2 node. V38 moves the one current object to:

```text
health/v3/<RoleId>:<InstanceId>
```

`RoleId` is AWS's immutable role unique ID, not a mutable role name or ARN.
`InstanceId` is the exact long-format EC2 node ID. The separator is part of the
key contract. The shared runtime-identity validator accepts only:

```text
RoleId:     ^AROA[A-Z0-9]{12,124}$
InstanceId: ^i-[0-9a-f]{17}$
```

The key shape gives the future IAM and publisher contracts an exact provider
identity pair to authorize and prove. This slice does not yet define that IAM
policy, evaluate a live caller's STS identity, or claim that the credentials
used for a write belong to the role/node pair in the key.

## Health receipt V3 authority

`DeploymentServiceHealthReceiptV3` is strict, canonical, secret-free JSON with:

```text
schema version: 3
kind:           deploymentServiceHealthReceipt
ID domain:      wharfie:deployment-service-health-receipt:v3
ID prefix:      whr3
```

It carries forward the exact provider scope/specification, deployment and
incarnation, non-destroy operation and authorizing head lineage, running
deployment/application/artifact revisions, resident service/session,
lifecycle and owner generations, activation record and selection generations,
process ID, positive heartbeat sequence, and sole `healthy` state.

V3 additionally requires all four provider/binding fields:

```text
runtimeRoleBindingId
runtimeRoleId
nodeBindingId
nodeProviderResourceId
```

The runtime role and node identities are stable authority fields across legal
receipt successors. A successor cannot switch either binding or either
provider ID. Existing head, operation, release, session, activation, and
sequence transition rules remain strict.

Before any S3 I/O, the exported health-authority validator now:

1. validates the deployment revision, profile, provider scope/specification,
   and exact non-destroy head;
2. requires exactly one `runtime-role` binding and one `substrate` binding;
3. validates their provider IDs as an immutable IAM RoleId and long-format EC2
   InstanceId;
4. recursively proves the substrate's complete graph-defined dependency
   closure against the exact head bindings, with cycle and visited guards; and
5. separately proves the runtime-role graph member so neither key endpoint can
   be supplied outside the fixed graph.

Receipt-context validation then requires both binding IDs and both provider
IDs to equal that durable authority. The S3 transport derives its object
location only from the validated role/node pair. A plausible receipt or key is
not enough to bypass the head and graph lineage.

## PUT-first first publication

A publisher without `s3:ListBucket` cannot safely use a failed current-object
read as an absence oracle: access failure and a missing key may be
indistinguishable at that boundary. V38 removes that prerequisite from the
first publication protocol.

For a sequence-one candidate, `publish` first sends the exact conditional
write:

```text
PutObject({
  Key: "health/v3/<RoleId>:<InstanceId>",
  IfNoneMatch: "*",
  ...canonicalReceiptEnvelope
})
```

It performs no `GetObject` or `HeadObject` before that first attempt. The
transport never calls `ListObjectsV2`, `ListObjectVersions`, or another list
operation. First-publication recovery therefore has no `ListBucket` absence
dependency.

The conditional write response is never settlement evidence. Whether the
request succeeds, loses its response, reports an occupied key, or has another
ambiguous outcome, the publisher performs bounded exact current-object
readback. Matching `GetObject` and `HeadObject` observations must agree on the
current VersionId, opaque ETag, provider `LastModified`, length, checksum,
encryption, storage class, content type, cache control, V3 metadata, and the
complete canonical receipt.

Readback then has only conservative outcomes:

- the exact candidate converges;
- an already-current legal successor is adopted;
- a legal predecessor may be advanced with its opaque ETag as `IfMatch`;
- an incompatible occupant is conflict;
- missing evidence after a sequence greater than one is conflict rather than a
  second beginning;
- a missing first-publication readback permits another bounded
  `IfNoneMatch: *` attempt; and
- access failure, malformed evidence, a body/head race that does not stabilize,
  or exhausted retries remains unknown.

A sequence greater than one still reads its predecessor before mutation so it
can validate the semantic successor and obtain the exact ETag CAS token. A new
fenced session restarts at sequence one: its first `IfNoneMatch` attempt may
discover the old session, after which the same exact successor checks and
`IfMatch` CAS apply. ETag remains only an opaque concurrency token, never
content identity, time, or receipt order.

This closes first-write recovery without weakening later-write ordering and
without claiming provider API exactly-once execution.

## Inspection V5 and retained bucket behavior

The serialized inspection advances to:

```text
schema version: 5
ID domain:      wharfie:deployment-inspection:v5
ID prefix:      win5
```

An inspection health observation must correlate the receipt's node binding and
InstanceId with the `substrate` resource and its runtime-role binding and
RoleId with the `runtime-role` resource. A mismatched role can no longer hide
behind an otherwise internally valid node receipt. Only the exact fresh
provider-visible observation can mark the resident healthy or the whole
inspection converged.

The current S3 envelope uses metadata value
`deployment-service-health-v3`. The retained control bucket's sole admitted
health lifecycle rule is now:

```text
rule ID: wharfie-expire-noncurrent-service-health-v3
prefix:  health/v3/
age:     one day after becoming noncurrent
```

As before, the lifecycle affects only noncurrent health versions. It does not
delete the current V3 receipt, a staged artifact, or another retained control
object.

## Namespace rationale

The receipt schema and identity move from V2/`whr2` to V3/`whr3` because both
its serialized fields and authority meaning changed. The object path moves to
`health/v3/` because its addressing and future authorization boundary changed;
an object at the old V2 path is never reinterpreted as a V3 current receipt.
The S3 metadata value and lifecycle-rule ID move in lockstep so stale transport
or retention configuration cannot masquerade as the current contract.

Inspection moves from V4/`win4` to V5/`win5` because it now embeds V3 health
evidence and independently correlates the runtime-role endpoint. Plan/Action
V3 remains structurally unchanged but now accepts only V5 inspection IDs.
ProviderSpec V4/`wap4`, ResourceGraph V2/`wrg2`, Binding V2, and Head/Operation
V2 remain current because their serialized contract did not change in this
slice. No compatibility reader migrates a V2 receipt, V2 health object, or V4
inspection into the new authority.

## Explicit limitations

- RoleId and InstanceId are validated against durable provider bindings, but
  no live `GetCallerIdentity` proof binds the publishing credential session to
  that claimed pair.
- The concrete IAM trust policy, inline runtime policy, derived policy digest,
  IAM authority, and four runtime-identity drivers remain absent.
- No implemented IAM policy is claimed to enforce `IfNoneMatch` or `IfMatch`.
  Those headers are currently application-protocol fences; the future policy
  must state only the permissions AWS IAM can actually enforce.
- The privileged host observer is still not installed or wired to systemd,
  ledger state, EC2 credentials, or this S3 publisher in production.
- No provider router, production inspection composition, deployment operator
  command, live-account health publication, or clean-account lifecycle proof
  is added here.
- The one-day lifecycle expires only noncurrent V3 versions. One current object
  remains at every retired RoleId/InstanceId key, and this slice neither
  migrates nor deletes current objects left in earlier health namespaces. A
  future explicit retained-state collector must prove which current objects
  are safe to remove.

## Focused proof and disk hygiene

Final deterministic verification passes:

- focused health receipt, S3 transport, and control-bucket gate: 86/86 tests;
- plan, provider-contract, controller, and control-store gate: 125/125 tests;
- all nine migrated EC2 driver suites: 762/762 tests; and
- the root's independent combined seven-suite health/control/controller gate:
  211/211 tests.

All four source, application, test, and SEA-verifier TypeScript configurations
pass, as does the full repository `lint:js` target. Prettier, diff-integrity,
and generated-artifact scans are clean.

Focused Jest used pinned Node 24.13.1 with `--runInBand`,
`--coverage=false`, and `--no-cache`. The final artifact scan retained no
coverage tree, Jest cache, build or distribution tree, TypeScript build-info
file, or package tarball. The final repository size is 542 MiB, including 244
MiB under `node_modules`.

## Ordered next work

1. Define the exact runtime-role and instance-profile names, role trust policy,
   least-privilege inline policy, policy digest derivation, intrinsic state
   digests, provider identities, discovery keys, and safe-delete fences. The
   policy must scope the role/node health object exactly and, if it enforces
   conditional writes, use the documented `s3:if-none-match` and
   `s3:if-match` condition keys rather than attributing that enforcement to
   the resource ARN.
2. Extend the credential-bound AWS authority with only the IAM reads/mutations
   and EC2 usage evidence required by those four graph roles, including strict
   error sanitization and bounded pagination.
3. Implement `runtime-role`, `runtime-role-policy`, `runtime-identity`, and
   `runtime-identity-role-association` in graph order with independent intent,
   readback, settlement, and reverse-order cleanup.
4. Implement managed artifact publication, substrate creation, and the two
   retained-volume attachments; then compose graph-wide inspection, planning,
   provider routing, and controller ports.
5. Wire the privileged publisher, add live STS caller/session proof, expose the
   deployment commands, and prove the complete interruption and response-loss
   lifecycle in a clean AWS account through ordinary user credentials.
6. Design the explicit retained-state collector before deleting any current
   health object from a retired role/node or an earlier namespace.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v38-exact-runtime-service-health.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; breaking changes are
> allowed and v1 compatibility is abandoned. Current health is V3/`whr3`, at
> exact key `health/v3/<RoleId>:<InstanceId>`, and Inspection V5/`win5`
> correlates both runtime-role and node bindings/provider identities. Sequence
> one is PUT-first with `IfNoneMatch: *`; every outcome settles only through
> bounded exact `GetObject` plus `HeadObject`, and the transport never depends
> on `ListBucket` absence. Do not overclaim: STS proof of the live publishing
> credentials, the concrete IAM policy/authority/drivers, and production
> publisher wiring remain absent. Next define the exact IAM contract and narrow
> authority, then implement the four runtime-identity effects independently.
> Keep focused tests on pinned Node with coverage and caches disabled, remove
> generated artifacts after testing, and preserve the historical stash.
