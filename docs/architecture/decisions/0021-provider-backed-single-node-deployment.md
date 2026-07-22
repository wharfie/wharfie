# 0021 — Provider-backed single-node deployment

**Status:** Accepted · **Date:** 2026-07-20

## Context

Wharfie can package a TypeScript CLI as one content-addressed Node SEA, keep
that exact executable resident under a Linux systemd user service, recover its
durable work after process or machine restart, and change between two exact
releases without rewriting the application around containers or a hosted
orchestrator. The next product proof is for that executable to create and
operate its own narrow remote substrate through a user's ordinary provider
credential chain.

The original `DeploymentProfileV1` in ADR 0008 intentionally described only
external references. Reinterpreting `wpr1` as managed infrastructure would
change the meaning of already content-addressed documents. The repository also
contains no general infrastructure graph worth restoring: Wharfie is a finite
application runtime, not a cloud IaC language.

A plan hash or provider-resource tag is not mutation authority. A document can
be internally self-consistent while containing stale or fabricated provider
claims. Likewise, a successful provider response is not enough to recover
after response loss. Deployment correctness needs provider-backed durable
state, optimistic concurrency, explicit ownership receipts, inspection before
mutation, and persisted action intent before each physical effect.

## Decision

### One AWS golden path and one fresh profile namespace

The first provider path is AWS and creates one managed Linux node for the
existing systemd user-service runtime. `DeploymentProfileV2` uses the fresh
`wpr2` identity namespace and has one exact mode:

```text
single-node-systemd-user version 1
```

The profile binds one application, one Linux/glibc x64 or arm64 Node target,
one explicit AWS region, and one fixed versioned capability fulfillment. It
contains no credentials, secrets, environment variables, shell fragments,
user data, arbitrary resource graph, provider-native tags, or caller-selected
template. Unsupported fields fail closed.

The initial fixed fulfillment provides:

- one small managed resident node;
- retained application and control state on encrypted attached storage;
- private provider object storage for exact artifacts, purged on destroy;
- a host identity limited to SSM management, exact artifact reads, and exact
  current service-health object reads and writes;
- public outbound network access with no inbound rule; and
- no managed ingress.

The implementation may use a private, fixed CloudFormation template as its
AWS convergence mechanism. That template is not a public infrastructure
authoring surface. The managed service runs as a non-root user. Host bootstrap
may create that user, enable lingering, install the fixed service projection,
and prevent the application UID from reaching instance metadata. Provider
credentials remain in the ambient operator or host-management boundary and
are never serialized into a profile, plan, inspection, head, artifact, or
application input. Service-health publication belongs to a privileged
host-owned observer outside that application UID; application code cannot
manufacture its own provider-visible readiness proof.

External/adopted nodes, multiple nodes, private-NAT topology, ingress, managed
application secrets, node replacement, and arbitrary provider resources are
refused in this version. Another provider or fulfillment shape requires a new
strict provider contract version rather than optional unvalidated fields.

### Exact deployment and provider identity

`DeploymentRevisionV1` binds one human deployment ID to the exact tuple:

```text
appId
revisionId
artifactId
profileRevisionId
```

Apply and reconcile must read the embedded revision/runtime records from the
SEA that is actually running and hash the held executable bytes. The embedded
application, revision, and target must match the profile and the observed
`artifactId`. A caller cannot redirect that production check to another path.
Destroy does not require historical executable bytes or a sidecar that may no
longer exist; it uses the durable provider scope, deployment head, and exact
ownership receipts.

Resolving the ordinary AWS credential chain produces a secret-free provider
scope containing the partition, account, and region. The stable deployment
instance identity includes that scope, so the same logical deployment in a
different account or region is a different instance. Every mutation
re-resolves the scope and refuses account or region drift.

One invocation resolves the ordinary credential chain exactly once for its
explicit region and copies only the signing identity into an immutable,
invocation-local snapshot that is never returned or persisted. STS scope
checks, portable DynamoDB data access, and the narrow DynamoDB and S3 control
capabilities all use that same snapshot. The public authority exposes neither
credentials nor the SDK client's credential-bearing configuration. S3
failures retain only the allowlisted classifications and HTTP status needed
for authoritative readback, never raw messages, request IDs, or causes.
Repeated scope checks fail closed if the caller identity changes during the
invocation.

Mutable regional prerequisites are resolved only while previewing a new
incarnation and reduced to one secret-free, content-addressed
`AwsSingleNodeProviderSpecV6` in the fresh `wap6` identity namespace. It pins
the exact SSM public-parameter name and version, AMI ID/owner/architecture and
sole EBS root device/snapshot receipt, one standard Availability Zone ID that
offers the fixed instance type, the account's exact regional default EBS KMS
key ARN, code-owned bootstrap and runtime-policy digests, complete instance,
private-DNS, metadata, primary-ENI, encrypted root-volume, retained-volume and attachment behavior,
fixed network, service-health timing, publication, and retention, plus the
content ID of the exact finite physical-resource graph. Each
application and control volume is explicitly `gp3`, 8 GiB, 3,000 IOPS, 125
MiB/s, encrypted, single-attach, retained on destroy, and attached with
`DeleteOnTermination=false`; their fixed guest device requests are `/dev/sdf`
and `/dev/sdg`, respectively.
`DeploymentPlanV3` embeds the complete
specification; every action ID binds its `providerSpecId`, and
`DeploymentInspectionV5` binds the same ID and carries the complete
provider-visible service-health observation when one exists.

Converge and recovery validate the submitted or stored specification and never
resolve “latest” again. A deployment already in `READY` loads the specification
from its last settled plan for update, reconcile, and destroy. Changing the
profile or target inside an incarnation is refused; a fresh apply after destroy
may resolve a new specification.

### Credential-bound provider-spec resolution

The AWS authority exposes one caller-owned read capability containing only SSM
`GetParameter` plus EC2 `DescribeImages`, `DescribeAvailabilityZones`,
`DescribeInstanceTypeOfferings`, and `GetEbsDefaultKmsKeyId`. Both clients use
the same immutable ordinary-credential snapshot, explicit region, and provider
scope already used by the rest of the invocation; neither SDK client nor
credentials cross the authority boundary.

Only `resolveProviderSpec` for a new incarnation may read the fixed
architecture-specific AL2023 public parameter without a version selector. AWS
publishes AL2023 AMI aliases under
[`/aws/service/ami-amazon-linux-latest`](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-public-parameters-ami.html),
and `GetParameter` returns both the selected value and positive parameter
version. Unknown SSM failures retry only the identical request; an authoritative
missing result fails immediately. The first well-formed response is frozen as
one candidate before EC2 inspection begins, and later retries never switch to
a newer value during that resolution.

`validateProviderSpec` reads `name:version`, which is AWS's documented exact
[`GetParameter` version selector](https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetParameter.html),
and requires it to reproduce the pinned name, version, and AMI ID before the
new-incarnation controller performs its first mutation. It does not ask for
latest. Both resolve and validate then use
[`DescribeImages`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeImages.html)
for the one frozen AMI ID with Amazon ownership scoped in the request.

One candidate is admissible only when the unique EC2 image is the exact
architecture-specific AL2023 image associated back to the same public SSM
parameter and is Amazon-owned, public, available, Linux, machine-image, EBS
rooted, HVM virtualized, and ENA capable. ProviderSpec V6 additionally requires
exactly one EBS block-device mapping at the image's canonical root device,
with one canonical snapshot, `gp3` source type, a bounded 8-64 GiB source
size, an unencrypted public snapshot, and delete-on-termination enabled. These checks use the provider's
documented
[`Image` fields](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_Image.html),
not its identifier or SSM value alone. An authoritatively missing SSM
parameter/version is typed `missing`; present but contradictory, multiple, or
paginated evidence is typed `conflict`; and access, throttling, service,
malformed successful envelopes without usable evidence, empty or transitional
EC2 state, or another unresolved read is typed `unknown`. The resolver bounds
each read stage to three attempts by default, with an explicit range of one
through ten attempts. None of these reads creates a resource or grants later
mutation authority by itself.

Placement is pinned by Availability Zone ID, not its account-relative name.
AWS documents that zone-name mappings can differ between accounts while
[Availability Zone IDs identify the same physical zone](https://docs.aws.amazon.com/ram/latest/userguide/working-with-az-ids.html).
Resolution reads only standard, available zones in the exact region with
[`DescribeAvailabilityZones`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeAvailabilityZones.html),
then intersects those IDs with the fixed instance type returned by paginated
[`DescribeInstanceTypeOfferings`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstanceTypeOfferings.html)
using `availability-zone-id` locations. Because AWS does not promise response
order, the resolver sorts the complete bounded intersection and pins the first
ID. Validation queries only that pinned zone ID and exact instance type; a zone
that is unavailable or no longer offers the type cannot be replaced silently.

Resolution also calls
[`GetEbsDefaultKmsKeyId`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_GetEbsDefaultKmsKeyId.html)
and pins the exact full KMS key ARN for the provider partition, account, and
region. A KMS alias is not sufficient: AWS documents that a
[key ARN is the fully qualified key identifier while an alias may target a
different key](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#key-id).
Validation requires the provider's current default EBS key to remain that
exact ARN. A changed default is an explicit provider-spec conflict, not an
implicit storage migration.

### Retained EBS volume creation is one resource effect

Volume mutation uses a separate caller-owned authority surface containing only
EC2 `CreateVolume`, `DescribeVolumes`, and `close`. It shares the invocation's
immutable credential snapshot and explicit region, but neither this client nor
its SDK configuration crosses the boundary. Errors retain only
`IdempotentParameterMismatch`, `InvalidVolume.NotFound`, and a bounded HTTP
status; all raw messages, request IDs, causes, access classifications, and
credential-bearing details are discarded.

`createAwsSingleNodeVolumeResource` exposes the controller's `executeAction`
and `verifySettlement` ports for one application- or control-state volume at a
time. It accepts only the active head's current intended managed `create` or
retained `noop` action with the exact profile, plan, provider specification,
state digest, and ownership nonce. Its
[`CreateVolume`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateVolume.html)
request carries the exact pinned zone ID, KMS key ARN, type, size, IOPS,
throughput, and encryption contract. It omits `MultiAttachEnabled` because AWS
supports that create parameter only for `io1` and `io2`; strict readback still
requires the fixed `gp3` volume to report multi-attach disabled. A
domain-separated SHA-256 digest of the durable action identity and that exact
intent's independently persisted ownership nonce supplies the stable
`ClientToken`; a later logically identical action therefore cannot reuse an
earlier incarnation's provider token. The complete ownership/contract tags are
included atomically through the `volume`
[`TagSpecification`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_TagSpecification.html).
Wharfie does not create an untagged volume and attempt to adopt or repair it
later.

A create response is not a durable resource receipt. Its valid volume ID is
only a process-local candidate locator. A prior binding or that candidate is
queried exactly with
[`DescribeVolumes`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeVolumes.html),
and settlement requires one complete observation matching the provider scope,
placement, encryption key, performance choices, multi-attach setting, and
reserved tags. If no durable ID exists after process/response loss, settlement
performs bounded paginated discovery with the exact locator tags, requires one
unique result, and then validates the full ownership and state contract.

An ambiguous create reports the fixed unknown error and leaves the intended
action recoverable. A later controller attempt replays the exact request and
token; EC2 documents that the
[same token and parameters are idempotent while different parameters produce
`IdempotentParameterMismatch`](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html).
Readback is bounded and treats provider propagation as unresolved rather than
absence because EC2 documents
[eventual consistency after create](https://docs.aws.amazon.com/ec2/latest/devguide/eventual-consistency.html).
Settlement returns an exact binding only for converged evidence, `blocked` for
contradictory present evidence, or `not-converged` for a still-creating or
still-missing create. Malformed or exhausted unknown evidence throws
`AwsSingleNodeVolumeResourceUnknownError`; idempotency or action-authority
conflict throws `AwsSingleNodeVolumeResourceConflictError`. Exact-ID not-found
does not prove logical absence.

A retained action is an explicit no-op: it validates the exact resource
context and preserves the binding without issuing `DeleteVolume`; that method
is absent from the authority. Volume settlement deliberately reads only the
volume's intrinsic provider state. The independently modeled attachment roles
own instance, device, attachment-state, and delete-on-termination evidence, so
an earlier retained-volume action cannot depend on a later graph effect. This
is only volume provisioning. A separate future action must call
[`AttachVolume`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_AttachVolume.html)
for the exact node, volume, zone, and device, prove attachment and
`DeleteOnTermination=false`, and arrange formatting and mounting. AWS documents
that
[delete-on-termination controls whether an attached EBS volume survives
instance termination](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/preserving-volumes-on-termination.html).

### Direct VPC creation is a recoverable logical effect

Network mutation uses a separate caller-owned authority with only the fixed
VPC, internet-gateway, subnet, and route-table create, describe, and delete
operations; gateway attach and detach; `DescribeVpcAttribute`; and `close`.
The SDK client is configured for one transport attempt so the resource drivers
retain retry authority. The VPC, gateway, and subnet creates expose no provider
idempotency token; for example,
[`CreateVpc`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateVpc.html)
and
[`CreateSubnet`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSubnet.html)
have no client-token parameter. The route-table driver instead supplies the
durable token supported by
[`CreateRouteTable`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateRouteTable.html)
on every identical driver-controlled retry. Errors preserve only
`InvalidVpcID.NotFound`,
`InvalidInternetGatewayID.NotFound`, both `InvalidSubnetID.NotFound` and
`InvalidSubnetId.NotFound`, `InvalidRouteTableID.NotFound`,
`IdempotentParameterMismatch`, `DependencyViolation`, `IncorrectState`,
`Gateway.NotAttached`, `Resource.AlreadyAssociated`, and a bounded HTTP status;
raw provider details never cross the authority boundary.

`createAwsSingleNodeVpcResource` accepts only the fixed managed
`network-vpc` role. Its state digest binds the provider specification's exact
VPC CIDR plus default instance tenancy, nondefault-VPC identity, no IPv6, DNS
support enabled, DNS hostnames disabled, an effective VPC Block Public Access
internet-gateway mode of `off`, and purge lifecycle. Subnet, routing,
public-address, and egress behavior belong to their own later graph roles and
are not folded into the VPC receipt. Blocking modes are contradictory because
the fixed graph's later internet-gateway route is intended to provide public
IPv4 egress; AWS documents those modes in its
[VPC Block Public Access overview](https://docs.aws.amazon.com/vpc/latest/userguide/security-vpc-bpa.html).

Create performs a complete tagged discovery before mutation, then sends one
`CreateVpc` request with the CIDR, default tenancy, IPv6 allocation disabled,
and the complete ownership/contract tag envelope in the request's `vpc`
`TagSpecification`. It never creates an untagged VPC or repairs tags after the
fact. A valid create response is only an ephemeral locator. Settlement accepts
one unique logical VPC after strict `DescribeVpcs` and
`DescribeVpcAttribute` readback proves its account owner, ID, primary CIDR and
sole associated IPv4 range, empty IPv6 associations, tenancy, nondefault and
available state, DNS attributes, a syntactically valid DHCP-options identifier,
an effective nonblocking public-access mode, and reserved tags. This slice does
not inspect the contents of the associated DHCP options set.

EC2 resource discovery is eventually consistent. After a lost response, a
unique atomically tagged VPC can therefore settle without another create, and
an in-process attempted-intent fence prevents an immediate duplicate request.
Across process loss, however, an invisible prior create can still race a
replay because AWS exposes no durable VPC create token or tag-uniqueness
constraint. Zero visible results remain not converged; two logical matches
block with no hidden deletion or arbitrary adoption. Cleaning duplicates must
be a future explicit destructive repair action so a nominally nondestructive
create plan cannot remove resources behind the operator's preview. This is
convergent logical reconciliation with visible ambiguity, not a claim that the
provider request executes exactly once.

No-op settlement requires the one discovered logical VPC to be the exact
durably bound provider identity and preserves its original creation receipt.
Delete re-proves the exact bound resource and unique logical match immediately
before sending `DeleteVpc`; dependency or provider-state races remain
recoverable. Once binding identity, account ownership, reserved ownership tags,
the nondefault-VPC invariant, and a sane provider lifecycle state are
re-proved, mutable VPC configuration drift does not revoke an explicitly
destructive plan's authority to purge that bound identity. Only exact
not-found evidence can settle the purge with a null binding. Unknown,
malformed, inaccessible, contradictory, or duplicate identity/ownership
evidence never becomes absence or deletion authority.

AWS creates a default route table, default security group, default network
ACL, and DHCP-options association as intrinsic parts of a VPC. They are not
separate Wharfie bindings. The dedicated route-table and security-group roles
in the fixed graph are later application-substrate effects and do not imply
ownership of those AWS defaults.

### Internet-gateway identity is separate from VPC attachment

The fixed `network-internet-gateway` role uses the same caller-owned network
authority's EC2 `CreateInternetGateway`, `DescribeInternetGateways`, and
`DeleteInternetGateway` operations. The SDK remains capped at one attempt
because
[`CreateInternetGateway`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateInternetGateway.html)
accepts atomic tag specifications but no durable client token. Its intrinsic
state digest binds only the fixed gateway kind and purge policy; VPC identity,
attachment state, and routes belong to later graph effects.

Create sends the complete sorted schema-2 ownership envelope in the request's
`internet-gateway` `TagSpecification`. As with the VPC, complete paginated
discovery runs before mutation, the intended action and ownership nonce are
fenced in process before the provider call, and a valid response ID is only an
ephemeral candidate. Settlement keeps logical tag discovery separate from
exact-ID `DescribeInternetGateways` evidence and requires both observations to
agree on one exact account-owned identity with every required ownership tag.
Missing,
malformed, contradictory, or duplicate evidence cannot manufacture a binding.
Across process loss an invisible effect can still race another create, so this
is visibly convergent reconciliation rather than provider exactly-once
execution.

Create and no-op deliberately ignore the gateway's `Attachments` collection.
After the derived attachment role settles, an attached gateway is the normal
intrinsic observation; making the gateway binding depend on that later effect
would invert the graph. The separate
`network-internet-gateway-attachment` role owns `AttachInternetGateway`,
`DetachInternetGateway`, VPC identity, relationship state, and dependency
lineage.

Destroy applies the opposite safety boundary. AWS requires an internet gateway
to be detached before deletion, so both the unique logical record and exact
bound record must expose an explicit empty attachment collection immediately
before `DeleteInternetGateway`. A visible attachment is a retryable fence, not
delete authority; missing or malformed attachment evidence is unknown.
Dependency/state races remain retryable, while only exact typed not-found plus
zero complete logical discoveries can settle absence. Duplicate evidence never
triggers implicit detachment, deletion, or winner selection.

### Gateway attachment is an exact derived relationship

The fixed `network-internet-gateway-attachment` role has derived ownership and
depends on the exact settled `network-vpc` and `network-internet-gateway`
bindings in graph order. Its state digest binds only the constant relationship
kind, `available` target state, and purge policy. The relationship has no
provider-assigned ID or tags, so its `wia1` synthetic provider-resource ID is
content-addressed from the exact VPC and gateway provider IDs. That ID is a
receipt locator, not provider evidence; every action must re-prove both
dependency bindings and the relationship itself.

Settlement performs complete bounded
[`DescribeInternetGateways`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInternetGateways.html)
discovery filtered by the exact VPC and an independent exact-ID read for the
gateway. Both observations must identify the one expected gateway attached to
the expected VPC in `available` state. One-sided visibility or a nonavailable
state is transitional. An attachment to another endpoint, multiple matching
gateways, duplicate attachment rows, or any other impossible one-to-one
cardinality is a conflict. Missing or malformed evidence is never converted
into ownership or absence.

Create may call
[`AttachInternetGateway`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_AttachInternetGateway.html)
only for the exact dependency endpoints after readback shows the relationship
is absent without conflicting occupancy. No-op performs only the same strict
readback. Destroy calls
[`DetachInternetGateway`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DetachInternetGateway.html)
for that exact pair and settles a null binding only after both independent
reads prove it absent. Canonical reverse graph order therefore detaches the
relationship before either directly owned endpoint can be purged.

EC2's one-to-one gateway/VPC cardinality makes retrying an identical pair
logically idempotent: after an ambiguous call, exact readback can prove either
the intended relationship or its absence before another mutation. Wharfie
still makes no claim that an attach or detach API call executes exactly once.
Mutation responses, malformed responses, and sanitized
`Resource.AlreadyAssociated` or `Gateway.NotAttached` errors are never
settlement evidence; only the complete independent reads can settle the
action. This is deterministic mock-backed protocol proof, not a live-account
lifecycle claim.

### Tagged direct-resource recovery shares identity mechanics, not lifecycle

The VPC, internet-gateway, subnet, and route-table drivers use one internal
tagged direct-EC2 recovery kernel. It owns the common schema-2 ownership
envelope, sorted atomic create tags, eight stable discovery filters, bounded
singleton pagination, broad/exact identity correlation, and an optional
in-process create fence and candidate locator keyed by action ID plus ownership
nonce. The three non-token creates claim that fence so a malformed or failed
mutation cannot be replayed by the same driver instance. The route table
reuses the identity mechanics but keeps its response candidate role-local; it
does not use the local replay prohibition and deliberately replays only the
same durable provider token and identical request parameters. A successful
create response remains only an ephemeral candidate locator in either case.

The kernel deliberately does not own AWS response-envelope decoding, typed
not-found interpretation, resource state validation, delete eligibility,
mutation requests, bindings, or retry outcomes. Those are role contracts. The
VPC therefore preserves its fresh-process discovery-only recovery path and
separate DNS-attribute reads, while the gateway explicitly promotes a sole
discovery ID into an independent exact-ID read. The subnet also promotes a
sole discovery ID and adds its separate VPC/CIDR natural-slot read. The route
table promotes a sole discovery ID, requires independent exact-ID
corroboration, and adds its durable provider token plus route, association, and
propagation evidence. Once a candidate or durable binding exists, every role's
configured views must agree and validate all present records before treating
one-sided visibility as transitional. Sharing these mechanics prevents later
tagged resources from copying the recovery protocol without turning the kernel
into general-purpose cloud infrastructure machinery.

### Subnet identity adds a natural VPC/CIDR slot

The fixed managed `network-subnet` role is a directly owned, purged child of
the exact `network-vpc` binding. Apply and reconcile accept only the earlier
settled VPC dependency; reverse destroy accepts only the later pending,
still-intact VPC dependency. The subnet binding records that exact VPC binding
ID as immutable lineage. The plan-time state digest instead contains only the
fixed subnet CIDR, pinned Availability Zone ID, nondefault and IPv4-only
identity, disabled subnet-wide public IPv4 assignment, effective VPC Block
Public Access internet-gateway mode `off`, and purge lifecycle. The dynamic
VPC provider ID therefore cannot alter a previously content-addressed target
state.

Create sends one
[`CreateSubnet`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSubnet.html)
request containing only the exact dependency VPC ID, fixed IPv4 CIDR, pinned
Availability Zone ID, and complete sorted schema-2 `subnet` tag specification.
It does not select an account-relative Availability Zone name, IPAM pool,
Outpost, IPv6 allocation, or an unavailable client token, and it never creates
an untagged subnet for later repair. Subnet-wide `MapPublicIpOnLaunch` remains
false. AWS documents that nondefault subnets do not assign public IPv4
addresses by default; the later substrate node's primary ENI will explicitly
request the one public address instead of broadening the whole subnet's
[public-IP behavior](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-public-ip.html).
Wharfie consequently does not introduce a second
[`ModifySubnetAttribute`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_ModifySubnetAttribute.html)
mutation.

Settlement correlates three complete, bounded
[`DescribeSubnets`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeSubnets.html)
views: logical discovery through the shared eight ownership filters, natural
slot discovery filtered by the exact VPC ID and subnet CIDR, and an independent
exact-ID read selected from the durable binding, response candidate, or sole
logical match. Every present record is validated before one-sided visibility
is classified as transitional. Create and no-op require all three views to
agree on one account-owned, available subnet in the exact VPC and CIDR, pinned
Availability Zone ID, nondefault status, no IPv6 allocation or automatic IPv6
assignment, `MapPublicIpOnLaunch=false`, effective internet-gateway block mode
`off`, and the full reserved ownership envelope. Account-relative Availability
Zone names and address occupancy are deliberately outside this intrinsic
contract. AWS's
[`Subnet` response](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_Subnet.html)
defines the provider evidence, including the effective
[`BlockPublicAccessStates`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_BlockPublicAccessStates.html)
observation.

The natural slot is stronger response-loss evidence than tags alone because
EC2 refuses overlapping subnet CIDRs within one VPC. A lost first response may
therefore be recovered from the occupied intended slot, while a foreign slot
or disagreeing provider ID blocks rather than being adopted or deleted. The
shared action-plus-nonce fence still prevents an immediate in-process replay,
and mutation responses and typed errors remain nonauthoritative. This is a
claim that at most one desired CIDR can be successfully allocated in the exact
VPC, not a claim that `CreateSubnet` executes exactly once.

Destroy keeps the stricter identity boundary while allowing mutable subnet
configuration to drift. Logical and exact bound reads must still corroborate
the same available, account-owned, tagged, nondefault subnet in the exact VPC;
a present natural-slot record must agree, but the original desired slot may be
empty after CIDR drift. CIDR, Availability Zone, IPv4/IPv6 assignment, and
effective public-access settings therefore do not revoke an explicit purge of
the exact owned identity. A null binding settles only when complete logical
discovery and natural-slot discovery are empty and the independent exact read
returns one of AWS's typed subnet not-found classifications. Delete success,
not-found, dependency, and incorrect-state outcomes all require fresh readback
rather than settling the action themselves.

### Route-table create has durable provider idempotency

The fixed managed `network-route-table` role is a directly owned, purged child
of the exact `network-vpc` binding. Apply and reconcile accept only the earlier
settled VPC dependency; reverse destroy accepts only the later pending,
still-intact VPC dependency. Its binding records that exact VPC binding ID as
immutable lineage. The plan-time state digest contains only one active local
IPv4 route for the ProviderSpec's VPC CIDR, `GatewayId=local`,
`Origin=CreateRouteTable`, nonmain identity, no propagating virtual gateways,
and purge lifecycle. The dynamically allocated VPC provider ID remains in
dependency lineage rather than changing the content-addressed target state.

Create sends one exact
[`CreateRouteTable`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateRouteTable.html)
request containing only the dependency VPC ID, one complete sorted schema-2
`route-table` tag specification, and a durable 64-character lowercase
hexadecimal `ClientToken`. Wharfie derives that token by domain-separated
SHA-256 over the exact action ID and ownership nonce. The same durable intent
therefore reproduces byte-identical parameters across an ambiguous response,
process loss, and a fresh driver factory; a changed nonce produces a different
effect identity.

AWS documents that `ClientToken` makes the request idempotent. Its general
[EC2 idempotency contract](https://docs.aws.amazon.com/ec2/latest/devguide/ec2-api-idempotency.html)
says that retrying a successful request with the same token and parameters
performs no further action, while changing parameters produces
`IdempotentParameterMismatch`. Wharfie consequently claims provider-enforced
at-most-one successful route-table create effect for that token in the Region.
It does not claim that one API call executes exactly once, and AWS does not
document the token-retention horizon. Atomic ownership tags and provider
readback therefore remain necessary durable evidence rather than treating the
token or a mutation response as settlement.

Unlike the subnet, a custom route table has no unique natural VPC slot because
one VPC may contain several route tables. Settlement instead correlates
complete, bounded logical discovery through the shared eight ownership-tag
filters with an independent exact-ID
[`DescribeRouteTables`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeRouteTables.html)
read chosen from the durable binding, create-response candidate, or sole
logical match. Both views must agree on one account-owned, atomically tagged
route table in the exact VPC. A successful create response and its echoed
token are only an ephemeral locator. Duplicate owners, different IDs, a main
association, foreign ownership or VPC lineage, unexpected route forms, and
virtual-gateway propagation block rather than being adopted or repaired.
One-sided visibility is transitional; malformed or inaccessible evidence is
unknown.

Fresh create settlement is intentionally pristine: exactly one active local
IPv4 VPC-CIDR route, no association, no default route, and no propagation.
That fence prevents a pre-existing logical match with unmodeled descendants
from being mistaken for a newly created intrinsic resource. No-op re-proves
the same identity and local route but permits only the fixed later graph
descendants: at most one well-formed nonmain subnet association and at most one
well-formed `0.0.0.0/0` route created toward an internet gateway. It permits no
other route or association shape and no virtual-gateway propagation. The
later derived actions retain authority for the exact descendant endpoint
lineage; this earlier route-table binding does not absorb those relationships.

Reverse destroy reaches the derived subnet association and default route
before the directly owned route table. The route-table driver keeps reading
while any association, nonlocal route, or virtual-gateway propagation remains
and sends
[`DeleteRouteTable`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DeleteRouteTable.html)
only after both logical and exact views re-prove the exact owned, nonmain table
with its local route and no deletion blockers. Delete success, typed not-found,
dependency, and incorrect-state outcomes remain nonauthoritative and trigger
fresh readback. A null binding settles only after complete logical discovery
is empty and the exact bound read returns typed route-table not-found. This
matches AWS's requirement that subnet associations be removed before a
nonmain route table can be deleted without using provider refusal as Wharfie's
destroy-order authority.

The portable capability model expands through one immutable, content-addressed
`AwsSingleNodeResourceGraphV2`, not user-authored infrastructure. Its 18 exact
roles are the artifact object; two retained volumes; VPC; internet gateway and
attachment; subnet; route table, default IPv4 route, and subnet association;
security group; runtime IAM role, derived inline policy, instance profile, and
derived role/profile association; resident node; and two volume attachments.
`AwsSingleNodeProviderSpecV6` pins the graph's `wrg2` identity and exact
runtime-policy template, so changing topology, lifecycle, or runtime
permissions cannot reinterpret an existing specification.

`DeploymentPlanV3` contains exactly one independently recoverable action for
each graph role. Apply and reconcile use the graph's one canonical topological
order; destroy uses its exact reverse. Reconcile may create an authoritatively
missing role with no durable binding in an existing deployment. The managed
artifact has the one explicit exception described below: its deterministic
current-object identity may be recreated by an update under the original
binding after authoritative absence. Each action repeats the exact role,
provider type, ownership mode, dependencies, and role-level destroy policy.
The volumes are retained while their attachment relationships are purged.

`DeploymentResourceBindingV2` records the same role metadata plus exact
dependency binding IDs. Direct resources prove provider-visible ownership;
untaggable relationships use derived ownership rooted transitively in directly
owned resources. `DeploymentHeadV2` accepts no dangling, stale, self-referential,
or cyclic lineage, and a retained binding may not depend on a role that destroy
purges. `DeploymentInspectionV5` distinguishes exact reads, authoritative
not-found results, and access failures, and names the exact binding and
dependency lineage behind present ownership evidence. Present evidence must
reproduce the referenced binding's provider identity, graph role, ownership,
lifecycle, and dependency binding IDs; an extra or graph-inconsistent head
binding is refused. A newly created binding may be supplied only as
context-only pending settlement authority for the head's exact current
intended action; it is not serialized into the inspection or accepted as
durable before compare-and-set settlement.

Each create-to-destroy lifetime has a fresh unpredictable incarnation ID.
Managed resource bindings contain an immutable provider ID, provider scope,
incarnation, logical resource key, creating action ID, and an independently
random ownership nonce. External references, when a later contract admits
them, are verify-only and carry no manufactured ownership. Names and tags by
themselves do not authorize update or deletion.

### The managed artifact is one stable current object with bounded history authority

The fixed artifact role owns exactly one incarnation-scoped S3 key:

```text
artifact/v1/<deploymentInstanceId>/<incarnationId>/current
```

The key's exact ARN is both the planned provider resource ID and the durable
binding identity. An allocated S3 VersionId, ETag, stage intent, or stage
receipt never changes that identity. The desired-state digest binds the exact
deployment, profile, fixed artifact-storage contract, incarnation,
destination, and selected application artifact using only plan-time authority; provider
observations and staging-attempt identities are settlement evidence, not
desired identity.

Before publication, the driver revalidates the immutable stage intent and
receipt and heads the receipt's exact staged VersionId. It requires the exact
checksum, length, metadata, encryption, storage class, content type, and source
ETag, then uses server-side `CopyObject` from that explicitly versioned source.
`CopySourceIfMatch` fences the source. A fresh destination or an
authoritatively missing current object uses `If-None-Match: *`; replacement of
an observed current version uses that version's opaque ETag as `If-Match`.
Neither a successful copy response nor a conditional error proves settlement.
Only bounded exact destination readback can establish the resulting current
VersionId and complete immutable metadata.

Every create, update, and destroy first lists the complete bounded history for
the exact key. The evidence walk admits at most sixteen 1,000-entry pages and
16,000 exact-key entries across content versions and delete markers, rejects
malformed or cycling cursors and impossible latest-version evidence, and heads
every content version. All content versions must reproduce the binding's
immutable ownership core and their own exact application state; foreign,
malformed, or checksum-inconsistent history blocks before mutation. A fresh
create therefore requires an empty history, except that exactly one current
version with the same action, ownership nonce, stage receipt, and desired state
may be adopted as response-loss recovery. It never adopts arbitrary
pre-existing content.

Destroy removes only entries from that completely audited exact-key history.
It deletes every content version and delete marker through an explicit
VersionId, rechecks an individual VersionId after an ambiguous delete response,
and settles only when the exact history is empty. It never sends an
unversioned delete that could merely install another marker.

The artifact is the sole fixed-graph resource allowed to remain durably bound
while its current provider object is authoritatively absent. Reconcile models
that repair as `update`, preserves the stable ARN, binding receipt, and
ownership nonce, and conditionally recreates the current object only after the
same full history audit. A retained exact-key delete marker is compatible with
that audit; foreign or malformed content is not. Every other bound resource
still blocks on missing current state unless a later accepted contract grants
it an equally explicit recreation rule.

### The substrate node is one recoverable EC2 instance effect

The substrate desired-state digest contains only plan-time launch authority:
ProviderSpec V6's machine-image receipt, placement, KMS identity and complete
node contract, the deterministic instance-profile name, and purge lifecycle.
Provider-allocated instance, root-volume, ENI, subnet, security-group and
instance-profile IDs are not predicted by the digest. The action instead
requires the exact eight direct dependency receipts and re-proves the complete
thirteen-resource upstream action, intent, provider-identity and transitive
binding closure before any provider call.

`RunInstances` receives one 64-character lowercase hexadecimal client token
derived from the durable create action and ownership nonce. The request fixes
one AMI and instance, placement and default tenancy, on-demand behavior,
instance profile, primary ENI, metadata and private-DNS options, lifecycle and
protection settings, exact bootstrap bytes, and one encrypted root mapping.
The same launch atomically tags the instance and root volume with complete
schema-2 action, scope, incarnation, nonce and state ownership; their resource
kind tags remain distinct. A successful response supplies only an ephemeral
candidate ID and never a durable receipt.

Settlement uses bounded logical tag discovery and exact-ID
`DescribeInstances`, then corroborates all four mutable instance attributes,
`DescribeInstanceCreditSpecifications`, the primary ENI and the exact root
mapping and `DescribeVolumes` state. Logical and exact identities must agree;
duplicate, malformed, foreign or drifted evidence blocks or remains unknown.
A running primary ENI must carry matching Amazon-owned, auto-assigned public
IPv4 association provenance rather than merely a syntactically valid address.
Every later non-root EBS mapping must also prove
`DeleteOnTermination=false`, so terminating the node cannot implicitly delete
a retained descendant. Those mappings' ownership, exact pair, device and
attachment lifecycle remain the separate attachment effects; this slice proves
only their non-deletion safety invariant.

Only exact `running` evidence converges desired presence. `pending` and
`stopping` remain non-converged. A stopped create or no-op is fully revalidated
without requiring its released ephemeral public IPv4 address, then
`StartInstances` may recover the same owned identity; fresh readback must still
prove running settlement. A still-valid Amazon-owned ephemeral association in
a newly stopped sample is transient until release; foreign or contradictory
association evidence conflicts. `shutting-down` or `terminated` state blocks a
non-delete action rather than implicitly replacing the durable binding.

Destroy repeats the complete static instance, four-attribute, CPU-credit, ENI,
block-mapping and exact root-volume proof before it calls
`TerminateInstances` for a running or stopped exact owned instance. It never
treats the mutation response as settlement. `OperationNotPermitted` receives a
fresh identity/state read: an unchanged actionable state conflicts, a concurrent
state transition remains unsettled, and terminal or absent evidence proceeds to
normal settlement. Other ambiguous failures remain readback-driven. Delete then requires either an
exact owned `terminated` tombstone corroborated by logical instance discovery,
or typed exact-ID instance absence with bounded logical instance discovery also
empty. Root-volume evidence must independently be terminal: bounded tag
discovery is empty, or it identifies one exact owned unattached `deleted`
tombstone. When a root ID remains available without that tombstone, exact
`DescribeVolumes` must return typed `InvalidVolume.NotFound`; a successful
`{Volumes: []}` response is unknown, not absence. If both provider tombstones
have aged out and no root ID remains, the joint bounded instance/root tag
absence plus typed exact instance absence is authoritative logical absence only
after remaining stable through the configured retry window. The node driver
therefore accepts two through ten attempts and defaults to three. The future
provider inspector must project only that combined evidence as
`absent`/`authoritative-not-found`, so controller destroy rechecks neither
settle early nor wait forever on provider tombstone retention. These rules
provide recoverable logical effects; they do not claim an EC2 API request
executes exactly once.

### Each retained-volume attachment is one exact derived relationship

The application-state and control-state attachment roles use one generic
provider effect, parameterized only by their fixed graph role and ProviderSpec
capability. The application volume occupies `/dev/sdf`; the control volume
occupies `/dev/sdg`. Each uses EBS card zero, requires
`DeleteOnTermination=false`, and is purged while its underlying volume remains
retained. A `wva1` synthetic provider ID binds the exact ProviderSpec
relationship descriptor, substrate instance ID, retained volume ID, device,
card, delete behavior, and lifecycle. The binding records only the exact
volume and substrate receipts. Before any provider call, the driver re-proves
those dependencies and their complete action, intent, provider-identity, and
transitive binding closure.

Attachment I/O uses a separately owned EC2 client with one SDK transport
attempt and only `AttachVolume`, `DetachVolume`,
`ModifyInstanceAttribute`, exact `DescribeInstances`, exact
`DescribeVolumes`, and `close`. It shares the invocation's frozen ordinary
credential snapshot and explicit region without exposing either. Raw provider
messages, request IDs, causes, credentials, and nonallowlisted classifications
do not cross the authority boundary.

The derived relationship has no tags of its own and is never inferred from a
mutation response. Every observation reads both exact dependency IDs. The
instance view must have the expected account, Availability Zone ID, canonical
lifecycle, unique device and volume mappings, no AWS-managed operator on the
intended mapping, and either no desired mapping or the exact pair/device/card.
The volume view must have the expected ID and zone,
single-attach rather than Multi-Attach behavior, no AWS-managed operator, and
either no attachment or one exact pair/device/card. Settlement requires both
views to agree on the relationship, stable attachment state, and
`DeleteOnTermination=false`. Once both views prove the exact attached pair, a
missing, true, or temporarily disagreeing delete flag safely drives the same
idempotent correction and remains unsettled. Successful exact responses with
empty arrays are unknown rather than absence; typed exact-ID NotFound
participates only in delete recovery.

Fresh create requires both views to show the volume available and the desired
slot empty. The driver sends exact `AttachVolume` for the volume, instance,
device, and card zero, then returns to dual readback. Attaching, detaching,
one-sided, pending-node, stopping-node, and shutting-down-node samples remain
transitional. Once both views prove the exact attached/in-use relationship,
delete behavior not yet proven false in both views is corrected with exact
`ModifyInstanceAttribute` for that one block-device mapping. Attach and modify
responses are nonauthoritative; only a later dual read in which both views
agree on `attached`, `in-use`, the pair, device, card zero, and
`DeleteOnTermination=false` settles the binding. Lost responses therefore
recover without claiming provider API-call exactly-once execution.

A no-op under an existing durable binding repeats the same proof but is not
authorized to repair an externally removed relationship. Exact absence blocks
instead of silently issuing a new attach. Contradictory device reuse, another
attachment, mismatched endpoints, Multi-Attach, managed-resource evidence, or
terminal/error resource state also blocks.

Reverse destroy first repairs delete behavior not yet proven false in both
views so instance termination can never collect the retained volume. It calls
exact `DetachVolume` only when both views prove the relationship attached, and
it always sends `Force:false`. The exact substrate may be running or stopped
because V43 never mounts or uses either device. A response does not settle
deletion. Busy, detaching, and lagging `in-use`/no-row samples are retryable;
no one-sided or transitional sample settles deletion. Dual exact present views
with no attachment settle deletion immediately. Typed endpoint absence instead
settles only when the identical
`instance`, `volume`, or `instance-and-volume` NotFound signature survives the
complete bounded retry window; the driver accepts two through ten attempts and
defaults to three. This relationship effect does not format, mount, unmount,
flush, or quiesce guest storage. Future guest use must add a quiesce/unmount or
stop dependency before attachment deletion; forced detach is not an escape
hatch.

### Plans are previews, not authority

`plan` performs no mutation. A plan is deterministic for one exact deployment
revision, provider scope, incarnation, head generation, and provider
inspection. It contains a bounded ordered action list and no timestamps or
credentials. The plan and every action are content-addressed so retries can
name the same operation and provider idempotency token.

Structural plan validation proves only that a document is canonical and
internally consistent. Before starting an operation, apply, reconcile, or
destroy must:

1. re-resolve the provider scope;
2. read the exact durable head;
3. obtain a fresh provider inspection;
4. ask the selected versioned provider driver to regenerate the plan; and
5. require the regenerated document to equal the submitted plan exactly.

The driver, not a generic hash validator, owns the finite mapping from profile
capabilities to provider types and desired state. A stale or recomputed
caller-authored plan causes zero physical effects.

The exact accepted plan and immutable deployment profile are stored durably
before the head begins referring to their IDs. A recovering coordinator loads
those immutable documents by ID; it does not require the prior terminal
session to resubmit action details or reinterpret a newer profile contract.

### Provider-backed head and action protocol

Each deployment instance has one provider-backed, linearizable head. Head
writes use full-record compare-and-swap with a monotonically increasing
generation. Creation compares against `NOT_EXISTS`; destruction retains a
positive-generation tombstone, so delete and recreate cannot suffer an absent
state ABA.

The phases are:

```text
CONVERGING -> READY
READY      -> CONVERGING
READY      -> DESTROYING -> DESTROYED
```

`CONVERGING` distinguishes create, update, and reconcile. It records settled
and target deployment revisions, exact resource bindings, the active plan and
operation IDs, a current action cursor, and its ordered intents. `READY` has
one exact settled revision and no active authority. `DESTROYING` retains the
settled revision while removal is in flight. `DESTROYED` has no active or
settled revision, retains the incarnation tombstone and completed destroy
settlement, and may retain bindings for state whose profile policy is
`retain`.

The initial contract refuses a fresh apply from `DESTROYED` while any retained
binding exists. Moving retained state into a fresh incarnation requires a
future explicit adoption protocol that preserves the original provider
identity and ownership receipt; simply clearing the old bindings would lose
authority. A later fresh incarnation is allowed only after no retained binding
remains or such a protocol is accepted.

Every action moves through this durable frontier:

```text
pending -> intended -> settled
```

Future actions remain `pending`. Before one provider mutation, CAS publishes
that action as `intended`, including any preallocated ownership nonce. Only
the current intended action may execute. Immediately before every physical
attempt, the controller re-resolves scope and re-inspects current absence or
the exact bound provider identity, ownership, and state. After the effect, it
re-inspects again and requires exact desired/observed state before one CAS may
store the binding or verified absence, mark the intent `settled`, and advance
the cursor. Before a dependent create executes or settles, every dependency
must still be freshly present under its exact durable binding and provider
identity, must bind back to an earlier settled intent, and must still match
that dependency action's planned state digest. During destroy, every later
frontier re-proves that all earlier purges remain authoritatively absent and
unbound. Finalization branches on each action's exact target: deleted roles
must be absent, while present roles—including retained volumes—must reproduce
the planned desired and observed digest. Provider execution receives the same
action ID and nonce on every retry. Every non-create action identifies one
exact existing provider resource, and update, verify, and no-op actions
preserve that identity; node replacement is not smuggled through settlement.

An error, timeout, permission failure, unreachable node, incomplete listing,
or lost response is never converted into absence. The intended action remains
recoverable and may become visibly blocked. Recovery re-inspects and resumes
the same plan and action; it cannot silently choose an opposite operation.
This protocol claims convergent, idempotent logical effects where the provider
supports the action token and evidence checks. It does not claim that an
arbitrary physical API request executes exactly once.

`resume` is an explicit assertion that the prior coordinator has stopped. It
first CAS-claims the active operation through a blocked recovery boundary, so
only one of two successor sessions may retry the intended action. This initial
one-coordinator contract has no automatic failure detector or lease and does
not authorize takeover while the old coordinator may still be running. A
losing CAS grants no mutation authority. The local ledger-service ownership
record is scoped to one OS principal and is not reused as a distributed
deployment lease.

### Inspection, reconciliation, and destroy

Provider inspection is derived from a fresh head read, exact bindings, provider
observations, and the existing service status proof. A serialized inspection
is evidence for humans and planning, not standalone authorization. `unknown`
and `conflict` are first-class results even when no head or incarnation can be
read. `absent` requires an authoritative provider-locator not-found result;
an empty caller-supplied array is not absence. For an exactly bound and owned
EC2 substrate instance, authoritative logical absence requires an exact owned
`terminated` record or typed exact-ID instance absence plus terminal root
evidence: bounded root-tag absence or one exact owned unattached `deleted`
tombstone. Any remaining exact root ID must yield typed
`InvalidVolume.NotFound`; a successful empty exact response remains `unknown`.
When both tombstones have aged out and no root ID remains, typed exact instance
absence plus joint bounded instance and root tag absence is sufficient only
after that joint negative remains stable through the configured retry window.

One host-owned `DeploymentServiceHealthReceiptV3` (`whr3`) may be published to
the deterministic current object:

```text
health/v3/<RoleId>:<InstanceId>
```

It binds the provider scope and specification, deployment instance and
incarnation, one stable non-destroy operation plus the head ID/generation that
authorized it, deployment and application revisions, artifact, service and
process session, lifecycle and owner generations, activation record and
selection generations, process ID, and a positive sequence. It additionally
binds both the exact resident-node binding and long-format EC2 instance ID and
the exact runtime-role binding and immutable IAM RoleId. Before provider I/O,
the health boundary validates those two graph members, their provider-ID
shapes, and the complete transitive dependency-binding closure rooted at the
substrate against the current non-destroy head. It can assert only `healthy`.
The authorizing head is not required to remain the exact latest mutable head:
a later head may retain the same target or settled deployment lineage and
operation authority.

Every new S3 publication must name the exact current head ID and generation.
After publication, a coordinator head transition may leave that receipt
temporarily useful while the same non-destroy operation and deployed revision
remain current or settled. In that case the retained receipt's older head ID
is host-authored history, while the current operation lineage is the authority
the coordinator can independently revalidate.

Publication writes canonical JSON with SHA-256 checksum and AES256 encryption
to the current versioned S3 object. A sequence-one publication attempts
`PutObject` with `If-None-Match: *` before any read. The conditional write and
its bounded exact `GetObject` plus `HeadObject` readback distinguish an accepted
first receipt, an occupied predecessor, a lost response, and unresolved
provider evidence without treating `GetObject` authorization as proof that a
key is absent. The transport never calls object or version listing and has no
`ListBucket` absence dependency. A later-sequence publication first reads the
current object and uses its ETag only as an opaque `If-Match` compare-and-swap
token. A sequence-one new session that finds an existing legal predecessor may
likewise advance it through that conditional CAS. ETag is neither content
identity nor ordering evidence.

No mutation response proves settlement. Every successful, conditional, or
ambiguous write outcome is decided by bounded `GetObject` plus `HeadObject`
readback of the same current VersionId, checksum, metadata, encryption, and
complete receipt. A forbidden or otherwise unresolved exact read remains
unknown; it never falls back to listing. Within one process session the
sequence must advance by exactly one; a new fenced session restarts at one and
must advance the lifecycle generation. Owner generation is stable inside one
session but may reset after graceful ownership release; the newer lifecycle
generation and session ID remain the cross-session fence. Release changes
require a newer authorizing head, operation, activation record, selection
generation, and session.

Freshness comes from S3's `LastModified`, never a host-authored timestamp. The
pinned provider contract publishes every 15 seconds and admits a receipt only
through 60 seconds of age plus 5 seconds of clock-skew allowance; a provider
timestamp more than 5 seconds in the coordinator's future is conflict.
`DeploymentInspectionV5` in the fresh `win5` namespace carries the complete
receipt and current object VersionId/ETag/`LastModified` observation. It
correlates both the node binding/instance ID and runtime-role binding/RoleId
with the inspection resource evidence. Only an exact, fresh, context-bound
observation can make the resident service healthy, and only that healthy
resident observation can make the whole inspection `converged` or authorize
final readiness.

This contract validates the claimed role and node identities against durable
bindings; it does not prove that the credentials used to publish belong to that
exact STS role session. Live caller-identity proof, the privileged observer,
and production publisher wiring remain separate future work. ProviderSpec V6
now pins the exact runtime IAM policy, but this decision does not claim that
IAM enforces `If-None-Match` or `If-Match`; those headers remain fences in the
application publication protocol.

`converged` requires complete provider-defined resource-graph coverage,
verified ownership, exact desired/observed state, and a resident service status
proving the target artifact and revision healthy. `reconcile` may create an
authoritatively absent role only when no durable binding exists; missing
retained state that still has a binding, unverifiable ownership, or
infrastructure drift that would require node replacement remains blocked. The
sole current exception is the managed artifact's stable-identity update after
authoritative absence and complete bounded history validation.

Destroy regenerates its plan from the current head and fresh inspection,
deletes only exact managed bindings whose ownership is re-proven, never mutates
an external reference, purges artifact resources, and preserves the fixed
retained state volumes. A future explicit purge operation is required before
Wharfie may delete retained state.

Unknown or conflicting inspection evidence cannot authorize any mutation.
Delete requires either the exact present provider identity with verified
ownership or authoritative current absence for that exact durable binding.
Failure to prove the final converged or destroyed inspection leaves the
operation durably blocked even after every action intent has settled.

The reserved packaged surface will be:

```text
<app> wharfie deployment plan
<app> wharfie deployment apply
<app> wharfie deployment inspect
<app> wharfie deployment reconcile
<app> wharfie deployment destroy
```

The same core operations may be mounted by the source CLI. Human and JSON
output follow the existing operator conventions. A web UI remains outside the
initial proof.

## Consequences

- ADR 0008 remains authoritative for revision and artifact identity, but its
  `DeploymentProfileV1` section is superseded for managed deployment by this
  fresh V2 profile. `wpr1` documents are never reinterpreted.
- The first useful cloud proof is deliberately narrower than the full future
  capability model. It can be replaced quickly because there are no downstream
  compatibility requirements.
- One coordinator is sufficient without making its process or node the source
  of deployment truth. A later session can recover the exact persisted plan,
  intent, provider bindings, and tombstone.
- Retained volumes make destroy non-total by design. Status and cost remain
  visible until a separately designed purge operation removes them.
- Multi-node placement, automatic coordinator replacement, fenced scheduling,
  and peer enrollment remain the next mesh milestone after this one-node path
  is proven in a clean account.

## Initial implementation boundary

The first repository slice implements strict V2 profile, deployment revision,
provider scope, binding, plan, inspection, head, and crash-resumable controller
contracts against a deterministic fake provider. The second slice binds the
controller to an explicit, already-created portable DB table whose sole String
partition key is `record_key`. It stores exact bounded envelopes:

```text
record_key
storage_schema_version: 1
record_kind: deployment-head | deployment-plan | deployment-profile |
             deployment-artifact-stage-intent |
             deployment-artifact-stage-receipt
document_id
document
```

Head, plan, profile, stage-intent, and stage-receipt keys use distinct
versioned namespaces. Every read is strongly consistent. Immutable profiles,
plans, intents, and receipts use conditional insertion; head creation and
replacement use conditional transactional writes with the complete prior head
identity as the fence. Conditional collisions are checked against the exact
stored envelope, while ambiguous or system failures remain errors for
caller-driven recovery.

Record inputs and reads are capped at 128 KiB before document validation.
Provider resource IDs are at most 1,024 bytes of JSON-stable printable ASCII,
keeping every structurally valid head and plan well below that bound and
DynamoDB's item limit.

The third slice composes this portable boundary with one credential-bound AWS
invocation authority and a fixed retained DynamoDB table named
`wharfie-deployment-control-v1`. Read-only inspection admits only the exact
account, region, ARN, String `record_key` schema, required reserved tags,
on-demand standard class, deletion protection, AWS-owned encryption, no
indexes/replicas/stream, disabled TTL, and exact 35-day point-in-time recovery.
Explicit bootstrap is the sole mutator: it may create the table or strengthen
PITR, resolves ambiguous responses through bounded exact readback, never
adopts incompatible state, and never deletes the table. Focused SDK mocks prove
the request and recovery boundary; no live AWS resource claim is made.

The fourth slice introduces AWS provider contract version 2 plus fresh `wpl2`
and `win2` namespaces. The immutable provider specification fixes all current
machine-image and fulfillment choices, plans embed it, inspections bind it,
and controller tests prove that only initial preview resolves provider
prerequisites while converge, crash recovery, and resident destroy reuse the
stored specification.

The fifth slice adds one deterministic retained S3 control bucket per provider
scope. Atomic creation tags bind the complete scope; read-only inspection and
explicit bootstrap require the exact owner, region, reserved tags, versioning,
public-access block, bucket-owner-enforced ownership, AES256 default
encryption, and absence of lifecycle, bucket policy, and replication. Before
the first sentinel write, each bootstrap invocation that lacks ready evidence
waits the full 15-minute first-enable propagation interval documented in
[Amazon S3's versioning guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/manage-versioning-examples.html)
and reinspects the complete bucket contract. A retained fixed sentinel must then
prove that object writes actually receive a non-`null` version ID before any
artifact key is used. Bucket state is never weakened or deleted.

Artifact staging has two fresh immutable documents. `wsi1` binds full provider
scope, running artifact digest/size/app/revision/target, deterministic bucket
and `stage/v1/<artifactId>` key, and a fresh ownership nonce. `wsr1` binds that
intent to one exact S3 version, length, SHA-256 checksum, AES256 encryption, and
STANDARD storage. Both use context-bound, conditional portable-store records;
a receipt cannot be written or read without its exact already-persisted intent.

Converge opens and hashes the running executable, cross-checks that held
observation against the SEA's embedded application revision and runtime target,
retains the same descriptor for the sole checksum-protected conditional
`PutObject`, persists intent first, and accepts a receipt only after exact
`HeadObject` readback. Concurrent intent nonces adopt the first complete
semantic intent; ambiguous upload/write responses are resolved through strong
readback. After staging, converge rereads the durable head, revalidates the
pinned provider specification, and regenerates the exact provider plan before
accepting controller state. Recovery needs no local old bytes: it reloads
intent/receipt and revalidates the exact immutable version before claiming the
active head. Destroy deliberately skips staging. Every non-destroy provider
action receives the independently revalidated stage bundle, while a stale or
malformed bundle causes no plan/profile/head mutation.

The sixth slice advances the strict profile/provider contract to version 3 and
the inspection namespace to `win3`. Runtime identity is limited to SSM,
artifact reads, and the exact current-health object read/write boundary.
`DeploymentServiceHealthReceiptV1` and its S3 transport implement the
host-owned health protocol above: complete context and successor validation,
conditional canonical publication, response-loss readback, current VersionId
evidence, provider-owned freshness, and final inspection gating. The retained
control bucket now admits exactly one lifecycle rule: noncurrent versions only
under `health/v1/` become eligible for asynchronous expiration after one day.
The current health version, all artifact-stage versions, and all other retained
control objects remain untouched. As with the preceding slices, deterministic
mocks prove the contract; the privileged host observer is not yet installed or
wired, and no real AWS driver or live resource is claimed.

The seventh slice implements the abstract provider-spec ports with
`createAwsSingleNodeProviderSpecResolver`. Its `resolveProviderSpec` performs
the only unversioned AL2023 public-parameter read permitted for one new
incarnation, retries only an identical SSM request until it has one successful
candidate, freezes that candidate, and proves its exact EC2 image metadata.
Its `validateProviderSpec` instead reads the pinned positive parameter version
and must reproduce the complete content-addressed specification before first
mutation. Both paths use the authority's narrow
`createProviderSpecReadClient`, bounded frozen-candidate retries, strict
Amazon/public/available/Linux/EBS/HVM/ENA/SSM association, and typed
missing/conflict/unknown outcomes. Deterministic SDK mocks prove this read
boundary; no production driver or live AWS resource is claimed.

The eighth slice deliberately advances the provider-spec schema, ID domain,
and prefix to V2/`wap2`. The resolver adds stable Availability Zone ID and
exact instance-offering discovery plus the provider-scoped default EBS KMS key
ARN; exact validation refuses placement or key substitution. The authority
adds those three reads to the narrow provider-spec client and exposes a
separate exact create/describe-volume client. The first retained EBS resource
uses an explicit stable `ClientToken`, atomic create tags, strict
`DescribeVolumes` readback or bounded tag discovery, controller-driven
response-loss replay, fixed typed errors/statuses, and an explicit retained
no-op. Deterministic mocks prove this isolated resource only. Attachment
evidence belongs exclusively to later attachment roles, and no complete
provider router, inspection, `createPlan`, controller composition, command
surface, or live AWS path exists yet.

The ninth slice introduces the fixed 15-role resource graph and advances the
strict namespaces to provider-spec V3/`wap3`, plan/action V3, inspection V4,
binding V2, and head/operation V2. The existing linear action cursor now
intends, verifies, and settles every physical resource or relationship
independently. Exact dependency-binding lineage protects derived ownership,
apply/reconcile and destroy use canonical opposite orders, and role-level
lifecycle retains volumes while purging attachments. The retained-volume
resource adopts the new action and tag envelope. Deterministic contract and
controller tests prove this expansion; none of the newly named network,
identity, node, or attachment roles has a production AWS resource
implementation yet.

The tenth slice implements the first network role through the narrow,
single-attempt EC2 network authority and direct VPC resource driver. Atomic
tags, strict paginated discovery and readback, response-candidate recovery,
in-process attempt fencing, exact no-op identity, and ownership-safe delete
make the logical effect recoverable where provider evidence is unique. Because
`CreateVpc` has no durable idempotency token, duplicate logical evidence blocks
and requires a future explicit repair action; the slice does not claim
provider exactly-once execution. The remaining network roles and complete
provider composition remain unfinished.

The eleventh slice adds the directly owned internet gateway without collapsing
its derived VPC attachment into the same receipt. It extends the single-attempt
network authority by exactly three gateway operations and repeats the atomic
tag, candidate, attempted-effect, dual-read, and duplicate-blocking protocol.
Create/no-op accept an attached gateway because relationship evidence belongs
to the following graph role; destroy requires independently observed empty
attachments before deletion. The gateway attachment and remaining network
roles are still unfinished. The same slice also makes the VPC driver's
one-sided-visibility fence validate every present ownership record first, so a
contradictory visible VPC cannot hide behind a temporarily absent corroborating
read.

The twelfth slice implements the derived internet-gateway attachment as its
own recoverable effect. Exact VPC and gateway dependency-binding lineage plus
the endpoint-derived `wia1` identity replace direct tags. Complete bounded
VPC-filtered discovery and an independent exact gateway read must corroborate
the same pair before create, no-op, or destroy can settle. Same-pair attach and
detach retries exploit the provider's one-to-one cardinality for logical
idempotence without claiming API-call exactly-once execution; responses and
typed errors remain nonauthoritative. Reverse destroy detaches the
relationship before gateway or VPC purge. The next implementation slice
extracts and migrates only the narrow common tagged direct-EC2 recovery kernel
before continuing with the subnet and remaining fixed graph.

The thirteenth slice extracts that internal tagged direct-EC2 recovery kernel
and migrates the VPC and internet-gateway drivers onto it. Common tag
construction and validation, bounded discovery, broad/exact identity
correlation, candidate storage, and action-plus-nonce mutation fencing now
have one tested implementation. AWS envelopes and typed errors, VPC intrinsic
and DNS evidence, gateway attachment fences, delete mutations, bindings, and
settlement mappings stay in the role drivers. The migration explicitly keeps
fresh VPC discovery broad-only and gateway discovery independently
corroborated, so it removes duplicated protocol code without weakening or
homogenizing their evidence contracts. The subnet is the next graph role.

The fourteenth slice extends the same single-attempt network authority with
the three subnet operations and implements the directly owned subnet beneath
the exact VPC dependency binding. Logical tag discovery, the VPC/CIDR natural
slot, and independent exact-ID evidence must corroborate one complete subnet
before create or no-op settles. The natural slot prevents a second successful
desired-CIDR allocation after response loss without pretending the provider
call executes exactly once. The state contract keeps the subnet nondefault,
IPv4-only, nonblocking, and free of subnet-wide public IPv4 assignment; the
later node ENI owns its explicit public address. Reverse destroy preserves
identity, ownership, VPC, nondefault, and available-state fences while
allowing mutable configuration drift. The route table is the next graph role.

The fifteenth slice extends the single-attempt network authority with the
three route-table operations and the bounded route-table errors, then
implements the directly owned application route table beneath exact VPC
lineage. Its stable action-plus-nonce token is the first fixed network create
with provider-enforced idempotency: identical token and parameters permit
response-loss replay without another successful create effect in the Region,
while a mismatch blocks. Logical tag discovery and independent exact-ID
readback still provide settlement because token retention is undocumented and
mutation results are not durable evidence. Create requires the pristine local
route; no-op accepts only the fixed later default-route and subnet-association
shapes; reverse destroy waits for both plus any virtual-gateway propagation to
disappear. The default IPv4 route is the next graph role, followed by the
subnet association and application security group.

The sixteenth through eighteenth slices complete the fixed network path with
three more independently recoverable effects: the derived default IPv4 route,
the derived subnet/route-table association, and the directly owned application
security group. The two derived resources use exact endpoint-binding lineage
and provider natural slots instead of pretending that mutation responses are
durable receipts. The security group correlates exact ID, ownership-tag, and
case-insensitive VPC/name-slot evidence and accepts only the fixed no-ingress,
all-IPv4-egress shape. The retained volume and all eight network effects now
have controller-compatible deterministic-mock drivers, but they are not yet a
composed provider.

The nineteenth slice replaces the old compound runtime identity role with the
18-role `AwsSingleNodeResourceGraphV2` and pins it in ProviderSpec V4/`wap4`.
IAM role creation, inline-policy installation, instance-profile creation, and
role/profile membership are four independent durable actions. No IAM driver or
IAM authority is implemented by that graph change.

The twentieth slice advances the host-owned receipt to V3/`whr3`, changes its
current-object address to `health/v3/<RoleId>:<InstanceId>`, and advances
inspection to V5/`win5`. It requires both exact runtime-role and node binding
correlation and makes sequence-one publication a conditional PUT-first
protocol, with every outcome resolved by bounded exact body/head readback.
The transport does not list objects and does not need `ListBucket` to infer
first-publication absence. The provider specification remains V4 because its
serialized fixed timing and abstract conditional-current-object capability did
not change.

The future production runtime policy must grant only the exact current-object
reads and writes intended for one runtime identity and deny object or version
deletion; otherwise a delete marker could hide the semantic predecessor. That
policy is not implemented here, and this decision does not claim IAM
enforcement of the HTTP conditional headers. The health boundary also does not
yet use STS to prove that the live publishing credentials' caller identity is
the RoleId/InstanceId pair claimed by the receipt. Noncurrent lifecycle
retention deliberately leaves one current object at every retired role/node
key, while earlier V1/V2 current objects are not migrated or collected. A
future explicit retained-state collector must prove when any such current
object may be removed.

The twenty-first slice defines and implements the four runtime-identity
effects. ProviderSpec V5/`wap5` removes the caller-supplied policy digest and
pins a digest derived from the same exact policy renderer used for concrete
roles. Deterministic account-global role and instance-profile names bind the
provider scope, deployment instance, and incarnation. The role trusts only
EC2, has no permissions boundary or managed policy, and receives one inline
policy granting only modern Session Manager channels, the exact stable managed
artifact object, and `${aws:userid}`-scoped V3 health reads and conditional
writes; object and version deletion are explicitly denied.

The role, inline policy, instance profile, and role/profile association have
independent controller ports and durable bindings. Direct IAM containers use
13 atomic ownership tags and immutable RoleId/InstanceProfileId readback.
Derived effects re-prove exact dependency lineage and provider endpoints before
mutation, and the final association corroborates membership from both
`GetInstanceProfile` and bounded `ListInstanceProfilesForRole` reads. Its
plan-time state digest binds deterministic names; provider-allocated IDs belong
only to the synthetic provider identity and dependency-binding lineage, so a
fresh plan never predicts future AWS IDs. Destruction refuses foreign or
drifted state. Instance-profile deletion additionally requires no roles and no
nonterminated use found by a bounded current-region EC2 query. Because IAM
profiles are account-global while EC2 observation is regional, that final
fence depends on Wharfie's explicit rule that the managed profile is exclusive
to this deployment and is never used outside its configured region.

The twenty-second slice implements the managed artifact as one stable,
controller-compatible S3 current-object effect. The provider binding is the
exact `artifact/v1/<deploymentInstanceId>/<incarnationId>/current` ARN rather
than a mutable VersionId. Publication validates and copies the receipt's exact
staged version, applies source ETag and destination create/update CAS, and
settles only from complete readback. A bounded full-history audit validates
every exact-key content version before mutation; physical destroy explicitly
deletes every owned content version and marker by VersionId and proves empty
history. The controller grants only this role missing-with-binding recreation,
modeled as an update that preserves its binding and ownership authority.

The twenty-third slice advances the provider specification to V6/`wap6`
before any node mutation is implemented. Caller-supplied bootstrap digests are
removed. A code-owned, domain-separated bootstrap contract renders one exact
LF-terminated UTF-8 user-data body below EC2's 16 KiB raw limit. It creates a
locked `wharfie-runtime` account and fixed host/application directories,
enables systemd lingering and the Amazon SSM agent, and installs an idempotent
root-owned `IPAddressDeny` drop-in on that user's systemd manager. The drop-in
rejects IPv4 IMDS traffic from the future application-service subtree without
depending on a host firewall package. It embeds
no deployment identity, credential, artifact location, or application bytes,
and deliberately starts no application service before the later attachment
and host-configuration effects settle.

The AL2023 host contract targets systemd on supported cgroup v2, but
`IPAddressDeny` still depends on cgroup-BPF enforcement. This slice proves the
exact bytes and shell syntax, not successful boot or the live network denial. A
pinned-AMI smoke test must prove both before production security claims.

V6 also pins the AMI's sole root device, snapshot, source volume type/size,
encryption, and delete policy, then derives the exact encrypted `gp3` root
volume that a future `RunInstances` request must create with the pinned KMS
key. It fixes on-demand/default-tenancy behavior, EBS optimization, monitoring,
standard burst credits, no capacity reservation, stop-on-guest-shutdown, both
API protections disabled, no hibernation or enclave, default maintenance
recovery, IMDSv2-only IPv4 metadata with tags and IPv6 disabled, private-DNS
options, and the sole public-IPv4 primary ENI contract. The credential-bound
authority gains a separate EC2 client with one SDK transport attempt and only
`RunInstances`, `StartInstances`, `DescribeInstances`,
`DescribeInstanceAttribute`, `DescribeInstanceCreditSpecifications`,
`DescribeVolumes`, `TerminateInstances`, and `close`. This slice does not claim
that an instance exists; those methods are authority for the next recoverable
resource driver.

The twenty-fourth slice implements that substrate resource. Its intrinsic
digest includes the exact V6 launch contract and deterministic profile name,
while its binding carries the eight direct dependency receipts and execution
revalidates the thirteen-resource upstream closure. A stable action/nonce token
and atomic instance/root tags recover ambiguous launch responses. Settlement
requires logical and exact instance identity plus attributes, standard CPU
credits, sole ENI with Amazon auto-assigned public-address provenance,
bootstrap, encrypted root-volume evidence, and
`DeleteOnTermination=false` for every non-root mapping. Attachment ownership
was deliberately deferred to the following graph effects. Stopped create/no-op
recovery
performs the same full proof before `StartInstances`, and destroy repeats it
before termination. Purge settlement joins an exact owned `terminated` record
or typed exact-ID instance absence with terminal root evidence: bounded root-tag
absence or one exact owned unattached `deleted` root tombstone. Any remaining
exact root ID must be typed not-found, while successful empty exact evidence is
unknown. Joint bounded instance/root tag absence handles provider tombstones
that have both aged out only after remaining stable through the configured
retry window. These are deterministic driver contracts, not a live AWS
lifecycle or API-call exactly-once claim.

The twenty-fifth slice implements both volume-attachment roles through one
generic derived-relationship driver and one separate single-attempt EC2
authority. Its `wva1` identity binds the settled instance/volume pair and fixed
ProviderSpec device contract. Exact instance and volume reads must agree before
`AttachVolume`, before correcting `DeleteOnTermination` through
`ModifyInstanceAttribute`, and before settlement. Lost mutation responses are
recovered through the same dual evidence. No-op blocks externally missing
relationships, while destroy may detach from an exact running or stopped node
because this slice never mounts the devices and always sends `DetachVolume`
with `Force:false`. Identical typed endpoint-absence signatures must survive
the complete retry window. This is deterministic driver proof and does not
claim guest mount, unmount, quiescence, or a live AWS lifecycle; future guest
use must add an explicit quiesce/unmount or stop dependency before detach.

The twenty-sixth slice composes the complete action surface without claiming a
complete provider. One immutable router constructs all 16 resource-driver
factories exactly once over six caller-owned narrow clients: managed artifact,
volume, network, runtime identity, node, and volume attachment. It covers the
18 resource keys in canonical graph order, sharing only the generic volume and
attachment handlers across their two exact capability roles. Both execution
and settlement dispatch solely by `resourceKey`, receive the original
controller authority object unchanged, and never fan out. A malformed or
unknown route produces one fixed non-echoing error before any resource handler
runs. The router validates the six closable client families and every factory's
exact two-port result but neither resolves credentials nor closes clients; the
future owned provider composition must fence and close every client it obtains
from the invocation authority.

The twenty-seventh slice adds the pure desired-resource input to deterministic
planning. `createAwsSingleNodeDesiredResourceTargetCatalog` accepts exactly
seven fields: deployment revision, profile, provider scope, ProviderSpec,
deployment-instance ID, incarnation ID, and a nullable durable head. It emits
one deeply frozen catalog entry for every graph role in canonical apply order,
including the graph contract and a target with provider type, provider-resource
ID, and a freshly derived desired-state digest.

The catalog never treats a head as trusted merely because it has already been
persisted. Every binding must reproduce its exact graph markers, management and
ownership modes, destroy policy, deployment context, dependency-binding
receipts, and provider type. Direct AWS identifiers are checked against their
resource family, while all seven derived relationship identifiers are
recomputed from their exact durable endpoints. The existing internet-gateway
attachment, default IPv4 route, and subnet/route-table association formulas are
now exported so planning and effects share the same identity algorithm without
changing its domain, prefix, or ordering. Those newly public helpers reject
malformed fixed-CIDR or EC2 identifiers before hashing, and downstream effects
reuse them instead of retaining private copies.

Only the managed-current artifact has an identity derivable before provider
mutation, so its exact stable ARN is present even with no head. Every other
unbound provider-resource ID remains null, including a missing derived binding
whose dependencies already exist. Observation is deliberately not an input:
this boundary neither adopts discovered resources nor copies observed digests
or speculates about future provider-allocated IDs.

The twenty-eighth slice adds the pure production plan derivation boundary.
`createAwsSingleNodeDeploymentPlan` accepts exactly the nine fields passed to
the provider's controller port: operation, deployment revision, profile,
provider scope, ProviderSpec, deployment-instance ID, incarnation ID, nullable
head, and InspectionV5 evidence. The controller has already validated that
inspection against its immutable context and sampled-clock freshness before it
calls the planner. The pure planner therefore revalidates the serialized
InspectionV5 structure and content identity, then independently binds its
deployment tuple, provider-spec ID, control-state evidence, incarnation, head
generation, resource order, graph roles, desired digests, provider identities,
and durable binding receipts. It cannot call the full contextual validator
again because the exact controller port deliberately carries no clock.

Plan derivation performs no provider I/O, clock sampling, random generation,
or adoption. An absent head and authoritative absent inspection yield all 18
creates in topological order. A READY head may project either its settled
revision or a prospective revision; V45's target catalog no longer mistakes
READY's previous target revision for the authority of a future apply. Exact
owned resources become no-ops. An authoritatively absent unbound role becomes
a create, but a discovered unbound role is never adopted. The managed-current
artifact is the sole bound role that may update in place, whether its current
object drifted or is authoritatively absent; every other bound absence or state
drift is unsupported. Unsupported evidence fails through one fixed non-echoing
error before any effect.

Destroy requires the complete 18-binding graph and reverses dependency order
into 16 purge deletes plus retained-data no-ops for the application-state and
control-state volumes. A purge already authoritatively absent still receives a
delete action so its binding can settle away; the artifact action also runs to
purge noncurrent object history. Present purge roles bind `before` to the fresh
observed digest. The artifact and both volume attachments additionally require
that digest to equal desired state because their current delete drivers enforce
that stronger contract; the other thirteen purge roles accept a non-null fresh
drifted digest after exact ownership proof. A READY head with already-destroyed
provider evidence is valid destroy recovery: the plan converges provider
effects that ran ahead of durable state.

Fresh apply from a DESTROYED tombstone remains unreachable under the current
fixed retained-volume contract. The controller admits a fresh incarnation only
when the tombstone has no retained bindings, while InspectionV5 requires each
retained role to remain present with verified ownership and therefore resolve
to an exact head binding. V46 rejects this state rather than weakening either
proof; a future lifecycle revision must reconcile those requirements
explicitly.

Source and packaged deployment commands, shared authoritative resource
observation, aggregate inspection, owned provider and controller composition,
guest storage/service projection, privileged publisher wiring, live STS
session proof, and clean-account lifecycle proof remain unfinished. A
document, bucket/table tag, SSM result, EC2 description, health receipt, or
content ID still never proves that an application resource effect occurred or
that a particular live AWS principal published it.
