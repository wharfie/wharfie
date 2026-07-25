# V65 host activation contract checkpoint

Date: 2026-07-25

Parent:
[V64 target service convergence](./2026-07-25-v64-target-service-convergence.md)
(`e3153f8`)

Implementation: `7908bb5d44d808169411df833c0e0684d1ca849b`

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be packaged
as one portable SEA, run locally, become a durable resident service, and then
be projected into a trusted cloud node without requiring Node, containers,
Kubernetes, or a hosted orchestration service on that node. The broader
purpose is to carry an author's intent beyond one interactive LLM session
while keeping the result inspectable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use the operator's ordinary cloud credentials to create the
specific resources they require. The public path remains Node-first; native
bindings or WASM remain available for measured hot paths. Exactly-once claims
remain abstraction-specific and require durable protocol evidence.

V64 made one invoking desired SEA able to converge its exact local systemd
user service safely. V65 defines the immutable controller-to-host authority
that can eventually ask a separate privileged framework agent to project that
SEA, while ensuring the root process never needs to execute application bytes
as root.

## All-settled active-operation authority

`src/core/runtime/deployment-aws-host-agent-contract.js` now exports the
content-addressed `whaq1` host activation request and `whar1` terminal receipt.
The request is derivable only from:

- one validated non-destroy PlanV3 and exact profile;
- the optional exact predecessor settled plan;
- one `CONVERGING` HeadV2 whose active operation is `running`, whose action
  frontier is complete, and whose intents are all durably `settled`; and
- one decoded exact managed-artifact head projection.

This frontier is deliberate. An early version of V65 tried to mint the request
from `READY`, but the controller can reach `READY` only after final inspection
already sees healthy service evidence for the active operation. That would
have made activation circular. The all-settled `CONVERGING` frontier is the
last infrastructure state before service-health proof. A `blocked` operation
cannot mint new privileged authority; the controller must first reacquire its
running operation lease. A request already durably minted while running
remains immutable replay authority.

There is no resident-service graph action yet. V65 does not borrow the
artifact, node, or volume-attachment action ID. The request instead binds:

- exact provider scope and ProviderSpec;
- deployment instance, incarnation, plan, active operation, head ID, and head
  generation;
- deployment revision, profile revision, application, artifact, application
  revision, build target, and target ID;
- exact substrate binding and immutable EC2 instance ID;
- exact runtime-role binding, immutable IAM RoleId, and derived role name;
- the deterministic managed-object ARN, bucket, key, mandatory VersionId,
  opaque ETag, length, artifact byte digest, desired-state digest, and staging
  intent/receipt IDs; and
- exact application/control volume bindings, EBS volume IDs, attachment
  bindings, derived attachment IDs, dependency lineage, and fixed requested
  `/dev/sdf` and `/dev/sdg` names.

Each relevant resource is re-derived through the complete desired-target
catalog and `createAwsSingleNodeResourceObservationAuthority`. That reuses the
existing plan/head/action/binding/dependency closure rather than creating a
parallel authority interpretation. Create and resident reconcile frontiers are
covered, including the required predecessor plan for reconcile.

Documents are bounded, canonical, independently cloned, deeply frozen,
strict-keyed, content-addressed, and scanned for secret material. Opaque AWS
VersionId and ETag values are syntax-checked but masked during the
user-authored secret scan because a valid provider identifier may contain text
such as `Bearer`.

## Managed artifact projection

`validateAwsSingleNodeManagedArtifactHeadEvidence()` now revalidates the exact
decoded shape returned by `decodeAwsSingleNodeManagedArtifactHead()`. It
strictly clones and bounds the projection, re-decodes its complete metadata
against ownership authority, cross-checks every derived field, and returns a
fresh canonical frozen object.

This is projection validation, not fresh provider proof. Once the raw
HeadObject envelope has been discarded, an arbitrary syntax-valid VersionId
or ETag cannot be proven to exist, and checksum, encryption, content type, and
storage class are no longer independently observable. The controller adapter
must own a fresh exact S3 read and decoder invocation. More importantly, the
future host kernel must fetch the mandatory VersionId and hash the downloaded
bytes before publication. V65 does not mistake a serialized projection for
provider freshness.

## Success-only receipt and successor validation

The terminal receipt contains:

- the exact request ID;
- the request's mandatory artifact VersionId; and
- one complete existing DeploymentServiceHealthReceiptV3.

The health receipt must match every shared provider, deployment, operation,
head, node, role, and desired-release identity. Receipt context validation
accepts the immutable original request, its original request context, and a
current head. This lets the same receipt validate while the operation is still
`CONVERGING` and after the controller consumes health and advances it to a
`READY` successor whose last operation retains the same operation ID. A
destroying head is rejected.

The receipt is a trusted-host attestation, not standalone local-device proof.
Its pure factory proves document consistency but cannot independently observe
an EBS device, filesystem, mount, process, STS session, or S3 object. The
future durable host kernel may mint it only after independently settling those
steps. Pending, refused, and failed observations belong to that kernel's
durable state, not immutable success receipts.

## Verification and disk hygiene

Final V65 verification used pinned Node 24.13.1 and serial Jest with coverage
and cache disabled:

- host activation contract: **10 passed** in **15.913 seconds**;
- managed-artifact evidence: **10 passed**;
- all four TypeScript configurations passed;
- all four changed JavaScript files passed ESLint with zero warnings and
  Prettier;
- package-content verification retained exactly **241 files**; and
- two independent contract reviews found and then cleared the READY-cycle,
  blocked-operation, predecessor-plan, and READY-successor issues.

No coverage directory, Jest cache, tarball, package-verification directory,
dist directory, TypeScript build info, or other generated test output remained.
The repository occupied about 526 MiB and the workspace volume had about 24
GiB available after verification.

No full-repository Jest gate, SEA build, native package build, or native LMDB
test was run. Native LMDB remains excluded on this Mac because its addon has
previously terminated the process with an allocator double-free. These omitted
gates would not add proportional confidence to this pure contract slice on the
nearly full workstation.

## Next implementation slice

Build the pure durable activation kernel in
`src/core/runtime/deployment-aws-host-activation.js` before adding AWS delivery,
graph mutation, privileged commands, or SEA packaging:

1. Define one bounded durable state machine keyed by request ID. Persist intent
   before every identity, storage, artifact, and service effect; verify exact
   evidence before replay; and create the success receipt only from a complete
   independently observed state.
2. Keep effects narrow and injectable in kernel tests. A returned command or
   SDK mutation response is not settlement evidence.
3. Add exact live STS caller projection: account must equal provider scope,
   `UserId` must equal `<RoleId>:<InstanceId>`, and ARN must equal the derived
   assumed-role session for the fixed runtime role and instance ID.
4. Resolve guest EBS devices from actual volume identity, never from the
   requested `/dev/sd*` name. Define deterministic formatting/mount authority,
   safe replay after partial formatting, fixed root-owned mount points, and
   exact unmount/deactivation before any future graph destroy role.
5. Fetch exactly the request's mandatory S3 VersionId, verify length and
   SHA-256/artifact ID, and atomically publish root-owned immutable bytes.
6. Invoke the exact artifact as the fixed `wharfie-runtime` user through fixed
   argv `wharfie service converge --json`, a clean bounded environment, and
   systemd privilege restrictions. Never execute application bytes as root.
7. Derive and publish DeploymentServiceHealthReceiptV3 from independently
   validated local lifecycle/session state, then mint the V65 success receipt.

Only after the pure kernel and its response-loss/restart matrix are complete
should Wharfie add the privileged host command, framework-only Linux SEA, and
eventual SSM wakeup. SSM command delivery is not the durable protocol.

## Repository state

The V65 implementation is pushed on `agent/strict-manifest` at
`7908bb5d44d808169411df833c0e0684d1ca849b`; local HEAD and
`origin/agent/strict-manifest` matched after publication. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remained untouched.
