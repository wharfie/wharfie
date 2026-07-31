# 0035 — Two-provider single-node self-deployment

**Status:** Accepted · **Date:** 2026-07-29

## Context

Wharfie's single-host developer preview proves that a packaged application can
carry unfinished work into a clean Linux systemd user service without Node,
containers, or a hosted control plane. The next product step is for the
application to create that host through credentials supplied by its operator.

The repository's existing managed-deployment surface does not provide that
experience. Its public profile, provider scope, plans, controller, artifact
stage, and fixed physical-resource graph are AWS-specific. The AWS
implementation spans dozens of resource drivers and mock-heavy tests, but has
no clean-account proof and does not wire guest activation through application
installation and service readiness. Extending that graph for another provider
would preserve complexity before proving the user journey.

Application SEAs are target-specific. A Darwin SEA cannot execute its own bytes
on Linux. Literal cross-platform self-deployment therefore also needs an exact
Linux application payload; it cannot be hidden inside provider work.

## Decision

### One bounded product proof

The active cloud milestone is a two-provider single-node self-deployment
preview for AWS and Hetzner Cloud.

Given one deployment-capable local application SEA and ambient provider
credentials, an operator can:

1. produce a read-only plan;
2. create one trusted public Linux node;
3. transfer and verify the exact Linux application SEA;
4. install it as a non-root boot-persistent systemd user service;
5. operate durable work there through the local application surface; and
6. destroy every resource owned by the preview.

This milestone proves remote application continuity, not node replacement,
coordinator replacement, or mesh placement.

### One local SEA with one bound Linux payload

The final acceptance artifact is one local-platform application SEA containing
one content-addressed Linux/glibc x64 application payload for the same immutable
revision. Its package receipt binds both artifacts, targets, byte digests, and
sizes.

The local SEA extracts only that held payload to proof-owned temporary storage,
reverifies its digest, transfers it, and removes the temporary copy. It does not
compile arbitrary sources or select another revision at deployment time.

Provider development may initially use the source CLI to package and hold the
same Linux payload. The feature is not accepted until the deployment-capable
application SEA drives both live provider proofs.

### Small provider-neutral contract

The public deployment intent contains only:

- the application and deployment identity;
- one exact Linux/glibc x64 target;
- mode `single-node-systemd-user` version 1;
- machine class `small`;
- public SSH access from explicit IPv4 `/32` addresses; and
- either an AWS region or Hetzner location.

It contains no credentials, tokens, SSH private material, provider resource
graph, user data, shell fragments, arbitrary tags, application infrastructure,
or secret values. Unknown fields fail closed.

One invocation-local provider adapter privately owns ambient credentials and
exposes a secret-free scope, inspection, plan, convergence, and destroy
boundary. Core sees one managed-node aggregate, not the provider's physical
resource decomposition. Provider adapters are internal; this milestone does
not define a third-party plugin SDK.

Plan is strictly read-only. It cannot package, stage, create a control store,
reserve an address, or perform another provider mutation.

The packaged `deployment preview` command realizes that boundary as a
point-in-time diagnostic receipt. It validates the embedded desired state,
performs only provider identity/describe/list queries, and reads an existing
local journal without creating its directory. The receipt separates external
references from managed resource roles and names semantic apply steps; it does
not claim to predict generated resource identities or byte-exact mutation
requests. Apply always re-plans before persisting those authorities.

The packaged
`<app> wharfie deployment status --deployment-instance <id> [--data-root <absolute>] [--json]`
command is the corresponding read boundary for an existing deployment. It
derives the provider and scope only from the exact durable journal, then joins
that authority with a one-shot exact provider observation and the pinned
guest's packaged `service status`. It does not create a missing data root,
acquire mutation authority, change provider resources, or change guest state.
The command binds the embedded application identity, but deliberately does not
bind the current outer SEA revision, allowing a newer artifact for the same
application to inspect an older journal-bound deployment.

The packaged
`<app> wharfie deployment exec --deployment-instance <id> [--data-root <absolute>] [-- <application argv...>]`
command is the initial provider-free application-operation boundary. It reads
only existing active local deployment authority, re-proves the pinned SSH and
bootstrap identities plus the exact healthy active service, and invokes only
the journal-authorized application artifact with the supplied argv. It cannot
select a host, SSH option, user, executable, shell command, or provider
credential. Exact bounded stdout, stderr, and exit status retain ordinary CLI
semantics.

The packaged
`<next-app> wharfie deployment update --deployment-instance <id> [--data-root <absolute>] [--json]`
command supplies a new release only from the invoking SEA's authenticated
embedded Linux payload. It cannot change provider, placement, deployment,
machine, access, mode, platform, architecture, or libc authority. Node version,
application revision, and artifact bytes may change. Update performs no
provider read or mutation; it reuses the journal-pinned SSH identity and host.

Deployment journal schema v3 separates immutable provider-substrate authority
from release authority. `release.current` remains authoritative while one
`install` or `update` transition accumulates target artifact and activation
evidence. Only a fully proven target can settle atomically; update settlement
moves the previous current release into one rollback slot. This project has no
v2 compatibility or migration requirement, so v3 uses a new storage namespace
and refuses older journals instead of reinterpreting them.

The packaged
`<app> wharfie deployment recover --deployment-instance <id> [--data-root <absolute>] [--json]`
command derives apply, update, stable-release repair, destroy, or no-op from the
exact durable phase and release transition. It accepts no provider or action
selector. Apply recovery requires the journal-selected install artifact. For
an update, the target SEA resumes the transition; the committed-current SEA
may instead reconverge current and only then abandon a permanently failed
target. Any third release is rejected until that explicit choice settles.
Remote execution remains pinned to committed current authority and fails
closed if the guest has already advanced but local settlement has not.
Convergence retains only current, rollback, and an optional target wrapper SEA
under the fixed remote artifact root and removes older validated artifact-ID
directories without a shell or glob.

### Minimal physical substrate

The preview uses provider public/default networking.

AWS treats one suitable default VPC and subnet as external references and owns
only the instance, its delete-on-termination root volume, and a restrictive
security group. It fails clearly when the external network prerequisite is
absent.

Hetzner owns one server, its Primary IPv4, and one directly attached firewall.
Wharfie does not create a provider SSH-key resource: cloud-init installs the
deployment public key only for the non-root runtime account, avoiding
provider-side injection into the image's default or root account.

Both providers use a pinned provider image observation for Ubuntu 24.04, public
IPv4, outbound access, and inbound TCP/22 only from the exact addresses in the
intent. No rule silently opens SSH to all IPv4 addresses.

The first preview stores application state on the node's root disk. Destroy is
therefore explicitly data-destructive and removes every owned cost-bearing
resource. Retained volumes and node replacement are a later capability.

### Credentials stay local

AWS uses the SDK's ordinary credential chain and resolves the exact account,
partition, and region through STS. Hetzner uses ambient `HCLOUD_TOKEN`; token
values are never accepted as CLI arguments or profile fields.

Credentials remain inside the local deployment invocation. They never enter
the application input, Linux payload, cloud-init, host environment, profile,
plan, log, error, receipt, or durable run output. Hetzner's project-wide
read/write token scope is an explicit preview limitation, and documentation
recommends a dedicated project.

### SSH is the shared bootstrap transport

Provider metadata cannot carry the application payload: the SEA is much larger
than either provider's user-data limit. The preview therefore uses one shared
SSH transport instead of requiring unrelated AWS and Hetzner artifact services.

Wharfie generates a deployment-specific client keypair. The private key remains
in local application data with owner-only permissions; only the public key
enters cloud-init. Cloud-init creates the non-root runtime user, enables
lingering, disables password authentication, and prepares the fixed service
directories. It contains no provider credential.

The first SSH host key is trust-on-first-use. Wharfie cross-checks the address
against the exact provider-created resource, records the observed fingerprint,
and requires that fingerprint thereafter. This is not described as
provider-attested node identity. Explicit Wharfie node enrollment supersedes it
in a later mesh milestone.

Artifact upload uses a temporary remote name, remote SHA-256 verification, and
an atomic final rename. Service activation calls the packaged application's
existing converge and status boundaries rather than synthesizing a separate
unit.

### Durable intent and conservative recovery

Wharfie persists the exact intended action before each physical mutation.
Provider resources carry bounded ownership labels or tags containing a stable
deployment identity, incarnation, and role.

AWS create operations use provider idempotency tokens where available and
recover through exact tag and resource-ID readback. Hetzner creates are treated
as non-idempotent: after a lost response, Wharfie searches by exact stable name
and ownership labels before deciding whether creation may be retried.

Zero owned matches permits creation. One exact owned match permits adoption.
Multiple matches, contradictory ownership, wrong credential scope, or an
unresolved observation fail closed. A timeout is never treated as proof that a
mutation failed.

Destroy checks both durable provider IDs and live ownership evidence before
mutation, waits for asynchronous deletion, and ends with an independent
provider inventory proving absence. External network references are never
deleted. Packaged destroy derives its provider from the journal and accepts no
provider, region, or location selector.

## Acceptance evidence

The same hello-world application must pass independently on AWS and Hetzner:

1. credential checking and planning disclose no secret and plan performs zero
   mutation;
2. the deployment creates exactly one intended node and no unplanned resource;
3. the target has no Node, npm, Docker, or repository checkout;
4. the exact Linux SEA digest is verified remotely and its non-root systemd
   service is healthy across reboot;
5. a durable timer remains unfinished when the local deployment process exits,
   completes remotely, and is read by a later local application process;
6. lost-response injection after create, upload, activation, and deletion
   converges without duplicate resources;
7. conflicting ownership and credential scope fail closed;
8. receipts contain no cloud credential or SSH private material;
9. destroy removes every owned billable resource and an independent inventory
   proves no provider residue; and
10. the proof removes generated keys, temporary SEAs, build caches, and local
    test state while retaining only bounded checksummed receipts.

## Consequences

- Hetzner is implemented first to expose AWS assumptions against a smaller
  resource model; AWS then uses the same semantic seam.
- The existing AWS implementation is a source of narrow credential,
  observation, ownership, and idempotency components, not a compatibility
  constraint. Unused public profiles, graph layers, and resource drivers are
  quarantined and deleted after the live proofs replace their evidence.
- No general IaC, private network, persistent volume, object-storage delivery,
  managed application secret, arbitrary ingress, multiple node, mesh
  enrollment, or automatic coordinator lease is part of this preview.
- Root-disk persistence proves process and host-reboot durability only. It does
  not survive node destruction or replacement.
