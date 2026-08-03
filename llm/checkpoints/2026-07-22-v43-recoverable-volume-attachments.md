# V43 recoverable retained-volume attachments checkpoint

Date: 2026-07-22
Branch: `agent/strict-manifest`
V42 parent preserved at:
`62a1fad076c12ddc8d9983d82d49c2183dae6c9e`

This checkpoint follows the
[V42 recoverable AWS substrate-node checkpoint](./2026-07-22-v42-recoverable-substrate-node.md).
V42 made the exact substrate and its non-root volume-survival invariant
recoverable. V43 implements the two derived relationships that attach the
retained application and control volumes to that substrate without treating an
EC2 mutation response as settlement evidence.

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

## One generic driver implements both fixed roles

`deployment-aws-volume-attachment-resource.js` implements exactly the two
`ebs-volume-attachment` graph roles:

- `application-state-attachment` joins the retained `application-state`
  volume to `substrate` at `/dev/sdf`;
- `control-state-attachment` joins the retained `control-state` volume to
  `substrate` at `/dev/sdg`.

Both relationships use EBS card index zero, require
`DeleteOnTermination=false`, have derived ownership, and purge on destroy while
their underlying volumes remain retained. The driver accepts no caller-defined
role, device, card, delete policy, or lifecycle substitution.

The plan-time desired-state digest binds the exact ProviderSpec attachment
descriptor, capability, device, card, retained delete behavior, and purge
lifecycle without provider-allocated IDs. The synthetic `wva1` provider
resource identity additionally binds the exact instance and volume IDs. It
contains no provider attachment response or timestamp. A durable binding
records only the exact retained-volume and substrate binding receipts, sorted
canonically.

## Complete dependency authority is re-proved

The attachment action directly depends on its retained volume and the
substrate, but neither receipt is trusted in isolation. Before every read or
mutation, the driver validates the current profile, plan, operation/head,
action, intent, ownership nonce, graph definition, provider scope, ProviderSpec
V6 identity, prior binding when present, and current action index.

It then walks both dependencies' complete transitive binding closure. Every
upstream action position, intent status, desired-state digest, provider type,
allocated provider identity, ownership mode, lifecycle, dependency lineage,
and create identity must agree with the immutable plan and current head.
Apply/reconcile requires earlier settled dependencies; reverse destroy requires
the retained volume's no-op and substrate delete actions still pending later in
the graph. A stale, missing, malformed, foreign, or graph-invalid receipt
causes no attachment call.

## Separate single-attempt attachment authority

The invocation authority exposes one separately owned EC2 client containing
only:

- `attachVolume`;
- `detachVolume`;
- `modifyInstanceAttribute`;
- `describeInstances`;
- `describeVolumes`; and
- idempotent `close`.

The client has one SDK transport attempt, its own close state, and the same
frozen credential snapshot and explicit region as the invocation. It is
isolated from the volume, node, and network clients. Construction, operation,
close, and use-after-close failures cross the boundary only through fixed
messages and stable codes. A finite attachment-specific allowlist preserves
typed exact-ID absence, attachment/state races, and deterministic contract or
provider refusals; raw messages, request IDs, causes, access classifications,
and credentials are discarded.

## Exact dual-view observation

The relationship cannot carry tags, so endpoint authority and two independent
exact reads replace logical tag discovery. Each observation concurrently
requests the settled instance ID and retained volume ID.

The instance view requires the exact account owner and Availability Zone ID, a
canonical EC2 lifecycle code/name pair, well-formed unique block-device
mappings, no AWS-managed operator on the intended mapping, and no ambiguous
reuse of either the configured device or desired volume. When present, the
intended mapping must name the exact volume, device, EBS card zero, attachment
state, and delete behavior.

The volume view requires the exact volume and zone, `MultiAttachEnabled=false`,
no AWS-managed operator, a valid volume lifecycle, and zero or one attachment.
When present, that attachment must name the exact instance, volume, device, EBS
card zero, state, and delete behavior. Settlement requires the two views to
agree on the relationship and explicitly report
`DeleteOnTermination=false`. Once both views prove the exact attached pair, a
missing, true, or temporarily disagreeing delete flag drives the same
idempotent retention correction and remains unsettled.

A successful exact response with an empty instance or volume collection is
unknown, not authoritative absence. Typed exact-ID instance or volume NotFound
can participate in delete recovery only when the identical `instance`,
`volume`, or `instance-and-volume` absence signature survives every attempt in
the bounded retry window. Dual exact present views that both show no attachment
can settle delete immediately. Neither form authorizes create or no-op to invent
a replacement relationship. Foreign endpoints, duplicate mappings,
Multi-Attach, managed-resource ownership, wrong zones, or terminal/error live
evidence blocks. One-sided or otherwise plausible cross-view propagation stays
retryable and never settles.

## Attach, retain, and dual-settle protocol

Fresh create begins only when the exact volume is available and both views
show that the desired volume/device slot is empty. It sends one exact
`AttachVolume` request containing the volume ID, instance ID, fixed device, and
EBS card index zero. The response is not a binding or settlement receipt.

The controller returns to dual readback. Attaching, detaching, detached,
one-sided, or pending/stopping/shutting-down-node evidence is transitional and
remains unsettled. Once both views expose the same attached/in-use
relationship, any delete behavior not explicitly false in both views enters
`needs-retention`. The driver sends
exact `ModifyInstanceAttribute` for the one block-device mapping with the exact
volume ID and `DeleteOnTermination=false`. That response is also
nonauthoritative.

Only a later dual read in which instance and volume agree on the exact pair,
device, EBS card zero, attached/in-use lifecycle, and false delete flag settles
the derived binding. An attach or modify response can therefore be lost at any
boundary: a new coordinator repeats exact reads, recognizes the current phase,
and either waits, corrects retention, or settles without issuing a second
logical relationship. This is evidence-based logical idempotency, not an EC2
API-call exactly-once claim.

## No-op fails closed after external loss

A no-op repeats the complete dependency and dual-view proof. If its exact
relationship remains attached with `DeleteOnTermination=false`, it preserves
the original binding. If the relationship has disappeared after durable
settlement, no-op returns blocked. It does not reinterpret the existing
controller intent as authority to recreate externally removed state.

This deliberately differs from fresh create and from the managed artifact's
explicit conditional-recreation exception. Automatic attachment repair needs
its own future accepted action and safety contract; it is not smuggled through
no-op.

## Destroy never forces detach

Destroy first preserves the retained-volume invariant. If dual evidence shows
the exact relationship attached without both views explicitly proving a false
delete flag, the driver corrects that mapping and waits for readback before
detaching.

Exact `DetachVolume` is issued only when both views prove the intended
relationship attached. The exact substrate may be running or stopped because
V43 never formats, mounts, or uses either device. The request names the exact
volume, instance, and device and always sets `Force:false`. Neither a successful
response nor a typed mutation error settles deletion. Busy, detaching, and a
lagging `in-use` volume after both attachment rows disappear remain
not-converged; no one-sided sample settles deletion.

Dual exact present views with no attachment can settle a null binding
immediately. Typed endpoint absence settles only when the identical instance,
volume, or both-absent signature remains unchanged through every configured
attempt. The driver requires two through ten attempts and defaults to three.

This slice does not format, mount, unmount, flush, or quiesce a guest filesystem
and does not prove that an application service has released it. Future guest
use must add an explicit quiesce/unmount or stop dependency before attachment
deletion. Forced detach is not an escape hatch.

## What this slice does not claim

V43 is a deterministic driver and contract proof. It does not yet claim:

- that either retained volume has been attached in a live AWS account;
- guest partitioning, formatting, mount, unmount, flush, quiescence, or storage
  projection;
- managed-artifact installation or resident application-service activation;
- a complete AWS router, graph inspection, deterministic `createPlan`,
  controller composition, or source/packaged deployment command path;
- production host-observer/publisher wiring or exact live STS caller proof;
- successful pinned-AMI bootstrap, SSM availability, cgroup-BPF IMDS denial,
  or a clean-account lifecycle; or
- API-call exactly-once semantics or safe implicit repair after external loss.

## Verification commands and disk hygiene

Run pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache:

```sh
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-volume-attachment-resource.test.js test/runtime/deployment-aws-authority.test.js

TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-*.test.js

env PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run typecheck

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run lint:js

git diff --check

find . -path './node_modules' -prune -o \( -name coverage -o -name dist -o -name build -o -name .cache -o -name '*.tsbuildinfo' -o -name '*.tgz' \) -print
```

The focused attachment/authority gate passes **163/163 tests** across two
suites. The aggregate deployment regression passes **1,778/1,778 tests** across
37 suites. All four source/app/test/SEA-verifier TypeScript configurations
pass, as do the complete JavaScript lint/Prettier gate, changed-Markdown
Prettier check, tracked and untracked whitespace checks, and the
generated-artifact scan. The scan is empty: no coverage, build, dist, cache,
TypeScript build-info, or package-tarball output remains. The repository uses
550 MiB including the pre-existing 249 MiB `node_modules` tree. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remains untouched.

## Ordered next work

1. Compose every implemented graph effect behind AWS provider routing, strict
   graph inspection, deterministic `createPlan`, and controller ports. Preserve
   the node driver's joint instance/root terminal absence projection and the
   attachment driver's fail-closed no-op semantics.
2. Add host-side storage projection and lifecycle ordering: exact artifact
   installation, mount, resident-service activation, then an explicit
   quiesce/unmount or stop dependency before attachment detach.
3. Mount source and packaged `plan`, `apply`, `inspect`, `reconcile`, and
   `destroy` commands, requiring apply/reconcile to re-observe the currently
   running SEA and regenerate provider authority.
4. Install the privileged observer/publisher outside the application UID and
   bind publication to the exact live STS role/session identity.
5. Prove the complete lifecycle in a clean AWS account through the user's
   ordinary credential chain, including response loss, process/coordinator
   loss, stop/start, reboot, destroy, retained volumes, SSM, bootstrap, and
   runtime-user IMDS denial.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-22-v43-recoverable-volume-attachments.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 compatibility is abandoned, and
> the historical stash must remain untouched. V43 implements both derived
> retained-volume attachment roles through one generic driver and a separate
> single-attempt EC2 authority. Preserve exact `wva1` pair/device/card identity,
> complete dependency-closure validation, independent exact instance and
> volume reads, `DeleteOnTermination=false`, mutation-response-independent
> settlement, fail-closed no-op after external loss, identical typed endpoint
> absence across the full retry window, and `Force:false` detach from an exact
> running or stopped node. V43 permits both only because it never mounts or uses
> the devices; compose an explicit quiesce/unmount or stop dependency before a
> future mounted-volume destroy path. Next build the complete AWS provider router,
> inspection, deterministic `createPlan`, and controller composition, then add
> storage/service projection and operator commands. Run pinned Node 24.13.1
> tests with `--coverage=false --no-cache`, clean generated artifacts, checkpoint
> coherent slices, commit and push them, and verify the remote SHA with git CLI
> only.
