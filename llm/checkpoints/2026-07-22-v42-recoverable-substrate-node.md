# V42 recoverable AWS substrate-node checkpoint

Date: 2026-07-22
Branch: `agent/strict-manifest`
Remote parent preserved at:
`2c5a2cd053c8c2470b742188292bde15d3e56ed4`

This checkpoint follows the
[V41 exact EC2 node-launch contract checkpoint](./2026-07-21-v41-exact-node-launch-contract.md).
V41 made one launch exactly representable. V42 implements that launch as a
controller-compatible, response-loss-recoverable resource effect with strict
dependency authority, independent readback, stopped-node recovery, and
terminal destroy evidence.

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
intended design. One coordinator is acceptable initially if durable state and
fencing permit robust recovery after coordinator loss.

## One intrinsic node identity, eight direct receipts

`deployment-aws-node-resource.js` derives the substrate state digest from only
plan-time launch authority:

- ProviderSpec V6's complete AMI receipt, placement, KMS key, and node
  contract;
- the deterministic incarnation-scoped runtime instance-profile name; and
- purge lifecycle.

The digest deliberately excludes provider-allocated instance, root-volume,
ENI, subnet, security-group, and instance-profile IDs. Those identities belong
to provider evidence and binding lineage.

The durable node binding records the eight graph dependencies directly named
by `substrate`, sorted canonically by resource key:

1. `artifact`;
2. `network-default-ipv4-route`;
3. `network-security-group`;
4. `network-subnet`;
5. `network-subnet-route-table-association`;
6. `runtime-identity`;
7. `runtime-identity-role-association`; and
8. `runtime-role-policy`.

Before every read or mutation, the driver also validates the complete thirteen
resource upstream closure. Each action, intent status and nonce, graph role,
provider type, state digest, allocated provider identity, binding ID, and
transitive dependency receipt must match the current immutable plan and head.
Apply/reconcile requires earlier settled authority; reverse destroy requires
later still-pending dependencies. A stale, missing, foreign, or graph-invalid
receipt causes no provider call.

## Exact launch and replay identity

Each durable create intent receives one lowercase 64-hex EC2 `ClientToken`
derived from a domain-separated SHA-256 of the original create action ID and
ownership nonce. Reconcile and destroy recover the original token through the
binding's `createdByActionId`; they do not reinterpret the current no-op or
delete action as the launch identity.

The deeply frozen `RunInstances` request fixes:

- one exact AMI, architecture-derived instance type, minimum one and maximum
  one;
- exact availability-zone ID, default tenancy, and on-demand purchase by
  absence of market options;
- EBS optimization, disabled detailed monitoring, standard CPU credits, and
  no capacity reservation;
- disabled stop and termination protection, stop-on-guest-shutdown, no
  hibernation or enclave, and default maintenance recovery;
- the exact runtime instance-profile ARN;
- IMDSv2-only metadata and exact private-DNS options;
- one device-zero/card-zero primary ENI with the exact subnet, security group,
  interface shape, description, delete behavior, and public IPv4 allocation;
- one encrypted `gp3` root mapping from the exact AMI snapshot, size, 3,000
  IOPS, 125 MiB/s throughput, KMS key, and delete behavior; and
- the exact code-owned bootstrap base64.

Zero secondary IPv4 and IPv6 allocations and source/destination checking are
proved from readback because this `RunInstances` network-interface form does
not safely encode all of them as request fields. No key, launch template,
credential, artifact receipt, application bytes, or ambient launch default is
supplied by a caller.

## Atomic instance and root ownership

The same `RunInstances` call applies thirteen complete schema-2 ownership tags
to both created resources. The instance uses
`wharfie:resource-kind=single-node-substrate`; the root volume uses
`single-node-substrate-root-volume`. The other tags bind managed-by, retention,
schema, capability, role, provider scope, deployment instance, incarnation,
resource key, original create action, ownership nonce, and desired-state
digest.

Unknown `wharfie:` tags, missing or duplicate required tags, and wrong values
block ownership. Unrelated non-Wharfie tags remain outside this abstraction.
A successful mutation response is only an ephemeral candidate locator; it is
never a durable binding or settlement receipt.

## Bounded discovery and exact readback

Logical recovery walks at most sixteen `DescribeInstances` pages of 1,000
records using the eight stable locator tags. It does not filter out terminated
instances, so an old tombstone cannot be mistaken for an empty logical slot.
Duplicate IDs, more than one logical candidate, malformed or cycling cursors,
wrong account ownership, and discovery/exact disagreement fail closed.

An exact instance ID is then corroborated through:

- exact owner, original client token, AMI, architecture, instance type,
  singleton launch index, virtualization, root-device, lifecycle, placement,
  monitoring, EBS/ENA, capacity, hibernation, enclave, maintenance, metadata,
  private-DNS, profile ID/ARN, and absence of spot/capacity-block/key state;
- exactly one primary ENI with the bound VPC, subnet and security group, exact
  attachment indices and delete policy, source/destination checking, one
  canonical private IPv4, no secondary/prefix/IPv6 allocation, and a canonical
  public IPv4 while running whose matching association views prove Amazon-owned
  auto-assigned provenance rather than an Elastic, carrier, or customer-owned
  address;
- exactly one root-device mapping; every later non-root mapping must be unique,
  attached, and `DeleteOnTermination=false`, proving only that node termination
  cannot implicitly delete it—its ownership, exact pair, device and attachment
  lifecycle remain deferred to the attachment effects;
- four separate `DescribeInstanceAttribute` reads for exact user data,
  termination protection, stop protection, and guest shutdown behavior;
- `DescribeInstanceCreditSpecifications` proving `standard`; and
- exact `DescribeVolumes` proof of the root snapshot, availability-zone ID,
  encrypted KMS identity, `gp3` shape, single-attach behavior, attachment
  instance/device/delete policy, and root ownership tags.

Successful exact-ID responses with empty instance or volume arrays are not an
absence oracle. Only the allowlisted typed instance/volume NotFound classes
enter recovery classification; malformed successful envelopes remain unknown.
A missing root during the complete live or stopped-node proof never authorizes
termination. Delete-specific root recovery walks at most sixteen
`DescribeVolumes` pages of 500 records and requires the logical proof described
below. Provider messages, request IDs, causes, credentials, and raw access
errors do not cross the public driver boundary.

## Lifecycle and response-loss recovery

Desired presence settles only from exact `running` evidence. `pending` and
`stopping` remain non-converged. `shutting-down` and `terminated` block create
or no-op rather than silently launching a replacement under an existing
durable intent.

A stopped create or no-op is recoverable in place. The verifier first proves
the full static instance, four attributes, credit mode, and root volume while
allowing the ephemeral auto-assigned public IPv4 to be absent. Only then does
it return non-converged. Execution independently re-proves that complete state
before calling `StartInstances`; the start response does not settle anything.
If stopped state becomes visible before a still-valid Amazon-owned ephemeral
association is released, that mixed sample is transient. Foreign or
contradictory association evidence remains a conflict.

Create-response loss is recovered by the same logical and exact reads in a
fresh process. If no evidence exists, replay uses the byte-equivalent request
and stable zonal token. `IdempotentParameterMismatch` is a fixed conflict.
Other ambiguous mutation outcomes remain readback-driven. This is logical
idempotency and evidence-based convergence, not an assertion that an AWS API
request executes exactly once or that EC2 retains a token forever.

Destroy repeats the complete static instance, four-attribute, CPU-credit, ENI,
block-mapping and exact root-volume proof before sending `TerminateInstances`
with OS shutdown enabled for a running or stopped node. Live, pending,
stopping, or stopped state remains unsettled until readback advances;
`shutting-down` remains non-converged.

An `OperationNotPermitted` termination refusal triggers fresh identity/state
readback. An unchanged actionable state is a fixed conflict; a concurrent state
change remains unsettled, and terminal or absent readback is left to normal
settlement. Other ambiguous termination failures remain readback-driven.

Delete settlement joins two independent logical views. The instance side must
be either an exact owned `terminated` tombstone corroborated by logical
discovery or typed exact-ID absence with bounded instance-tag discovery empty.
Root-volume evidence must also be terminal: bounded tag discovery is empty, or
it identifies one exact owned unattached `deleted` tombstone. When an exact root
ID remains without that tombstone, exact readback must yield typed
`InvalidVolume.NotFound`; a successful `{Volumes: []}` response is unknown.
After long coordinator downtime both provider tombstones may have aged out and
no root ID may remain; typed exact instance absence plus joint bounded
instance/root tag absence then proves logical absence only after the same joint
negative remains stable through every configured retry attempt. The node driver
accepts two through ten attempts and defaults to three. Future graph inspection
must project only this combined evidence as
`absent`/`authoritative-not-found`, so later controller destroy rechecks neither
settle early nor wait indefinitely for physical disappearance.

## Narrow authority correction

The V41 node client could not prove its pinned CPU-credit mode. V42 adds only
`DescribeInstanceCreditSpecifications` to the same separate, single-attempt,
caller-owned EC2 client. Its final surface is:

- `runInstances`;
- `startInstances`;
- `describeInstances`;
- `describeInstanceAttribute`;
- `describeInstanceCreditSpecifications`;
- `describeVolumes`;
- `terminateInstances`; and
- idempotent `close`.

The credential snapshot, error sanitization, use-after-close behavior, and
cross-client isolation remain unchanged.

## What this slice does not claim

V42 is a deterministic driver and contract proof. It does not yet claim:

- a live EC2 instance, successful AMI boot, cloud-init/bootstrap completion,
  SSM availability, cgroup-BPF enforcement, or runtime-user IMDS denial;
- that the new driver is routed through complete AWS inspection, planning,
  controller composition, or source/packaged operator commands;
- retained application/control-volume attachment, guest format/mount/unmount,
  artifact installation, service activation, or host observation;
- safe automatic repair of an externally removed settled attachment; or
- API-call exactly-once semantics.

The next attachment drivers must never use forced EBS detach. Once the volumes
are mounted, a prior host service-stop/unmount effect is required or a destroy
may legitimately remain busy.

## Verification commands and disk hygiene

Use pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache:

```sh
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-node-resource.test.js test/runtime/deployment-aws-authority.test.js

TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-*.test.js

env PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run typecheck

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run lint:js

git diff --check

find . -path './node_modules' -prune -o \( -name coverage -o -name dist -o -name build -o -name .cache -o -name '*.tsbuildinfo' -o -name '*.tgz' \) -print
```

The focused node/authority gate passes **142/142 tests** across two suites. The
aggregate deployment regression passes **1,717/1,717 tests** across 36 suites.
All four source/app/test/SEA-verifier TypeScript configurations pass, as do the
complete JavaScript lint/Prettier gate, tracked and untracked whitespace checks,
and the generated-artifact scan. The scan is empty: no coverage, build, dist,
cache, TypeScript build-info, or package-tarball output remains. The repository
uses 549 MiB including the pre-existing 249 MiB `node_modules` tree.

## Ordered next work

1. Add a separate single-attempt attachment authority exposing only
   `AttachVolume`, `DetachVolume`, `ModifyInstanceAttribute`, exact instance and
   volume reads, and close.
2. Implement one generic application/control retained-volume attachment
   driver with exact pair/device natural-slot evidence,
   `DeleteOnTermination=false`, dual instance/volume readback, response-loss
   recovery, and non-forced detach.
3. Compose the implemented graph effects behind provider inspection, routing,
   deterministic `createPlan`, and controller ports; project only exact owned
   terminal or typed exact-ID instance evidence joined with terminal root
   evidence as authoritative logical absence.
4. Add host stop/unmount, storage projection, exact artifact installation,
   resident-service activation, and the privileged observer/publisher path.
5. Prove the complete lifecycle in a clean AWS account, including pinned-AMI
   bootstrap, cgroup-BPF IMDS denial, SSM, response loss, stop/start, reboot,
   destroy, and ordinary user credential-chain behavior.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-22-v42-recoverable-substrate-node.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 compatibility is abandoned, and
> the historical stash must remain untouched. V42 implements the exact V6
> substrate instance with a stable original-create token, atomic instance/root
> tags, thirteen-upstream authority validation, eight direct binding receipts,
> complete exact readback, full-proof stopped restart, and an exact owned
> `terminated` record or typed exact-ID instance absence joined with terminal
> root evidence for deletion. Joint logical absence must remain stable through
> the full configured retry window. Preserve those boundaries, prove Amazon
> auto-assigned public-IP provenance, require `DeleteOnTermination=false` on
> every non-root mapping, repeat the complete root proof before termination,
> and never infer settlement from a mutation response. Attachment ownership
> itself remains deferred.
> Implement the two retained-volume attachment effects next using a separate
> single-attempt client, dual instance/volume evidence, explicit
> `DeleteOnTermination=false`, and only non-forced detach. Remember that
> provider inspection must normalize only the combined instance/root terminal
> proof to authoritative logical absence; one exact owned unattached `deleted`
> root tombstone is terminal, otherwise any available exact root ID requires
> typed `InvalidVolume.NotFound`, while a successful empty exact response is
> unknown. Run pinned
> Node 24.13.1 tests with `--coverage=false --no-cache`, remove generated
> artifacts, checkpoint coherent slices, commit and push them, and verify the
> remote SHA with git CLI only.
