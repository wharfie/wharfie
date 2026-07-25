# V66 durable host activation kernel checkpoint

Date: 2026-07-25

Parent:
[V65 host activation contract](./2026-07-25-v65-host-activation-contract.md)
(`a4f167d`)

Implementation: `7368b42986b1e05bd35eb944aa4198049cded5fd`

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

V65 defined the immutable controller-to-host activation request and terminal
receipt. V66 supplies the pure durable host kernel between those two
documents. It persists activation intent, observes exact external state,
dispatches narrow convergent effects only under current authority, and mints
the V65 receipt only from a complete independently observed state. It still
does not supply concrete AWS, Linux, local-store, SEA, or delivery adapters.

## Fixed durable activation state

`src/core/runtime/deployment-aws-host-activation.js` defines one injectable
activation kernel with six fixed stages:

1. `runtime-identity`;
2. `application-storage`;
3. `control-storage`;
4. `artifact-projection`;
5. `service-convergence`; and
6. `health-publication`.

The order is part of the protocol. The kernel cannot skip a prerequisite or
turn a later observation into authority for an earlier effect.

Four bounded canonical document families make the protocol restartable:

- `whas1` is the content-addressed per-request activation state. It embeds the
  complete canonical V65 request rather than depending on an ephemeral caller
  to resupply it.
- `whag1` is the per-deployment authority fence. It names the request and head
  generation currently allowed to advance that deployment.
- `whai1` is a step effect intent, persisted before a physical mutation may be
  dispatched.
- `whao1` is a validated step observation that records the exact settled,
  ready, unknown, or conflicting evidence returned by the relevant adapter.

Activation state is `running`, `blocked`, or `succeeded`. Each step is
`pending`, `intended`, or `settled`. Effect-attempt generations are monotonic:
resetting an invalid downstream suffix preserves its previous generation, so
an ambiguous old physical attempt ID is never silently reused.

All documents are bounded, strict-keyed, canonical, independently cloned,
deeply frozen, content-addressed, and scanned for secret material. Content
IDs prove integrity and identity; they are not signatures or authorization.
Opaque S3 VersionId and ETag masking is limited to their exact validated
health-observation paths rather than acting as a generic escape hatch for
arbitrary keys with those names.

## Store, lock, fence, and authorization contract

The injected store must provide strongly consistent reads and exact
compare-and-swap for both activation state and deployment fence. A CAS returns
literal `true` only to the single invocation that actually changes the exact
expected value into the exact next value. Discovering that the next value is
already present is not a successful CAS. Every CAS path is followed by a
strong readback.

This distinction is the physical-dispatch boundary. A kernel invocation may
dispatch an effect only after:

- it receives literal `true` for the exact attempt CAS;
- strong readback returns the exact attempted state;
- `authorizeRequest` returns literal `true` for dispatch; and
- a strong read immediately before dispatch still returns the request's exact
  current deployment fence.

A lost CAS response may prove after readback that intent became durable, but
it never grants dispatch authority to the caller that lost the response.
Mutator return values are deliberately ignored. Exact post-effect observation,
not an SDK or command response, is settlement evidence.

`withHostLock` is mandatory and deployment-scoped. Its concrete implementation
must serialize local advancement and release automatically when the owning
process dies. The durable store is a root-owned, authenticated,
exclusive-writer security boundary; V66 does not pretend that document hashes
protect a writable store from a local attacker.

`authorizeRequest` is also mandatory. It receives a frozen
`{request,purpose,step,receipt}` envelope and must independently authenticate
and live-authorize the request against the current controller head. Its four
purposes are:

- `claim`, before a request may become current or resume;
- `dispatch`, immediately before a physical step effect;
- `settle`, before the terminal receipt may be committed; and
- `replay`, before a previously succeeded receipt may be returned.

The oracle must return literal `true`; truthy values are rejected. For replay
it must additionally validate the exact terminal receipt supplied by the
kernel.

Claim ordering deliberately persists the complete `whas1` state before
advancing `whag1`. If the process dies after the state CAS but before the fence
CAS, `resume({requestId})` can recover the canonical request from durable
state, reauthorize it, and finish the claim. Persisting the fence first would
have created an unrecoverable current request whose request body existed only
in the crashed process.

## Observation, effect, and settlement protocol

Every stage follows the same evidence-first protocol:

1. persist the step intent;
2. make a live, side-effect-free observation;
3. settle immediately when the exact desired evidence already exists;
4. remain pending without mutation when evidence is unknown;
5. durably block without mutation when evidence conflicts;
6. dispatch only when the observation explicitly says the effect is ready;
7. persist and win the exact next attempt generation;
8. reauthorize and recheck the current fence immediately before mutation; and
9. observe again, accepting only exact desired evidence as settlement.

Observers must be live, contextual, and side-effect-free. Evidence validators
must be pure and deterministic. Convergers are at-least-once operations: they
must be safe to retry after an ambiguous response and must not return while a
spawned physical effect is still running. V66 makes no physical exactly-once
claim. It instead gives every effect a durable intent/attempt identity and
requires concrete effects to converge exact external state.

Each mutation clears all invocation-local freshness. Before any later effect
or terminal receipt, the kernel reobserves the full settled prerequisite
prefix. This prevents a later mutation from invalidating an earlier
observation while stale in-memory evidence is still treated as current. Here
“fresh” means observed during the current invocation; V66 does not impose a
wall-clock freshness window on a concrete provider adapter.

When an upstream settled observation changes, the downstream suffix returns
to pending while retaining its monotonic attempt generations. An ambiguous
attempt therefore remains distinguishable through repair and replay.

## Exact health evidence and terminal replay

The last stage reuses the existing strict
`DeploymentServiceHealthObservation`. Its evidence contains the complete
health receipt plus the exact S3 object identity:
`{receipt, object}` with the required `versionId`, `etag`, and
`lastModifiedAt` projection. The terminal `whar1` host activation receipt is
bound to that exact validated health evidence. A generic syntax-valid receipt
cannot substitute for the object the host actually observed.

Before the success receipt is stored, the kernel reauthorizes `settle` and
strongly rereads the exact current deployment fence. A response loss after the
terminal state CAS is recovered by reading the succeeded state.

Succeeded replay is historical, not a new activation pass. It requires both
`claim` and `replay` authorization, validates the exact stored receipt, checks
the current fence, and performs no live effect observation or mutation. This
lets a caller recover an accepted terminal result without silently using an
old receipt after the deployment has moved to a newer authorized head.

## Authorized supersession

A higher authorized head generation may supersede an in-flight, blocked, or
succeeded request while holding the deployment lock. The kernel advances the
deployment fence to the newer request and leaves the old immutable state as
historical evidence. A later attempt to resume or replay the old request is
rejected by live authority and fence checks.

An unauthorized higher generation cannot displace the current request. A
content-addressed request ID alone grants no privilege, and a blocked request
does not permanently wedge a deployment once the controller has authorized a
new head.

`inspect({requestId})` is intentionally a historical state read. It does not
interpret the current deployment fence. Operator tooling must compare the
state with `whag1` before presenting it as the current activation; otherwise a
superseded record may still appear `running` or `blocked`.

## Verification and disk hygiene

Final V66 verification used pinned Node 24.13.1 and serial Jest with coverage
and cache disabled:

- the V66 activation suite passed **16 tests**;
- the focused V66 activation, V65 host-agent contract, and strict S3
  service-health suites passed **47 tests across 3 suites** in about
  **30.156 seconds**;
- the documentation command-surface suite passed **9 tests** after the restart
  pointers were advanced;
- all four TypeScript configurations passed;
- changed JavaScript passed ESLint with zero warnings and Prettier;
- package-content verification retained exactly **242 files**; and
- independent kernel, state-contract, and security reviews found no remaining
  unconditional high-severity issue.

No coverage directory, Jest cache, tarball, package-verification directory,
dist directory, TypeScript build info, or other generated test output remained.
The repository occupied about 526 MiB and the workspace volume had about 22
GiB available after verification.

No full-repository Jest gate, SEA build, native package build, or native LMDB
test was run. Native LMDB remains excluded on this Mac because its addon has
previously terminated the process with an allocator double-free.

## Honest boundaries

V66 is the protocol kernel, not a deployable privileged host:

- historical inspection does not by itself distinguish the current fence;
- per-record documents are bounded, but per-request cardinality retention and
  pruning are not implemented;
- invocation freshness is not a provider-defined time window;
- authorization and the local physical effect cannot share one atomic
  transaction, so supersession may race an effect after its final authority
  check; exact reobservation and convergence repair the eventual state, while
  strict post-supersession exclusion would require a lease/fencing token
  enforced by the effect or shared global serialization;
- raw provider or adapter errors can remain as an in-memory `cause`; future CLI
  and logging surfaces must sanitize them before rendering;
- there is no concrete durable store, crash-releasing lock, authority adapter,
  AWS or Linux effect adapter, root host command, mount syscall layer, host
  SEA, SSM delivery path, or clean-account proof; and
- the existing health publisher/readback machinery is not yet connected to
  this kernel through a concrete host adapter.

These limits are deliberate. SSM delivery, a command response, a local hash,
or a returned AWS mutation envelope is not the durable activation protocol.

## Next implementation slice

Connect the kernel to a real privileged host in this order:

1. Implement a root-owned durable local store, crash-releasing
   deployment-scoped lock, and authenticated authority adapter. Add bounded
   retention and current-versus-superseded inspection at the same boundary.
2. Add exact live STS authority projection with one shared credential/client
   lifetime. Account must equal provider scope, `UserId` must equal
   `<RoleId>:<InstanceId>`, and ARN must equal the derived assumed-role session
   for the fixed runtime role and instance ID.
3. Implement application and control storage as separate concrete adapters.
   Resolve the guest device from actual volume identity, never from requested
   `/dev/sd*` names. Derive filesystem UUID from stable
   volume/incarnation/capability identity rather than request or revision;
   format only media proven blank, treat foreign media as conflict, and mount
   at fixed root-owned locations with crash-safe replay.
4. Fetch the request's exact mandatory S3 VersionId, verify byte length,
   SHA-256, and artifact ID, then fsync and atomically publish root-owned
   immutable bytes.
5. Converge the fixed `wharfie-runtime` user and invoke fixed argv
   `wharfie service converge --json` through a clean bounded environment and
   restrictive systemd unit. Root must never execute application bytes.
6. Connect the existing strict S3 health publisher and readback adapter, then
   mint the V65 receipt only from its exact settled evidence.
7. Prove crash, response-loss, retry, reboot, and supersession behavior on a
   clean disposable Linux host.
8. Only then add the root host SEA/command and eventual SSM wakeup. SSM wakes
   the durable protocol; it does not replace it.

## Repository state

The V66 implementation recorded here is commit
`7368b42986b1e05bd35eb944aa4198049cded5fd` on
`agent/strict-manifest`. The commit containing this checkpoint is the restart
marker to publish after that implementation. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remains untouched.
