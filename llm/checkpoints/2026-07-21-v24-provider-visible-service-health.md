# Wharfie checkpoint — provider-visible service health

- **Date:** 2026-07-21
- **Status:** **FINAL READINESS NOW REQUIRES A FRESH, HOST-OWNED, PROVIDER-VISIBLE HEALTH OBSERVATION**
- **Branch:** `agent/strict-manifest`
- **Parent/base head:** `5972dafb59e83b2b6172531c88f83a64b6365211`
- **Parent checkpoint:** [recovery-safe artifact staging](2026-07-20-v23-recovery-safe-artifact-staging.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR 0021](../../docs/architecture/decisions/0021-provider-backed-single-node-deployment.md)

Wharfie now has a strict provider-visible service-health document and one
conditional current-object transport that can prove the intended SEA is
healthy on the exact managed node. The receipt carries the full durable
release, host-session, activation, and deployment authority needed to reject a
plausible but stale or replayed heartbeat. S3 supplies the current VersionId
and `LastModified` freshness evidence; host-authored bytes do not claim when
the write reached the provider.

This checkpoint implements and tests the boundary under deterministic AWS
mocks. It does **not** install or wire the privileged host observer, compose a
real AWS resource driver, or claim that any live AWS resource or service
exists.

## Product scope carried forward

- The first cloud proof remains one trusted managed node. Trustless membership,
  multiple nodes, and automatic coordinator failover are later milestones.
- TypeScript/Node remains the public model and Node SEA the first portable
  packaging backend. Node-API or WASM may later implement measured hot paths.
- Wharfie creates only the finite substrate required by its application
  abstractions; it is not general cloud IaC.
- One coordinator is sufficient initially because provider-backed heads,
  plans, intents, bindings, stage receipts, and health evidence survive its
  process. Explicit recovery remains the current takeover boundary.
- Exactly-once claims remain evidence-specific. Conditional writes and durable
  readback resolve only the effects their provider boundary can actually prove.
- Breaking changes are expected, v1 is abandoned, and no downstream
  compatibility is required.

## Implemented boundary

### Immutable healthy-service receipt

`DeploymentServiceHealthReceiptV1` (`whr1`) is canonical, content-addressed,
secret-free JSON that can assert only `healthy`. It binds:

- exact provider scope and provider specification;
- stable deployment instance and fresh create-to-destroy incarnation;
- one non-destroy deployment operation and its authorizing head ID/generation;
- the exact resident-node binding and provider resource ID;
- deployment revision, application, artifact, and application revision;
- stable service identity, process-session fence, lifecycle generation, and
  resident-owner generation;
- activation record version and selected-release generation;
- exact healthy process ID; and
- a positive per-session heartbeat sequence.

The authorizing head is deliberately not required to equal the latest mutable
head. A later generation may still accept the receipt only while it retains the
exact operation and deployed-revision lineage as the current target or last
settled non-destroy authority. Future heads, destroy, a different incarnation,
provider scope/spec, node binding/provider ID, application, service, or release
all fail closed.

Every new object publication must carry the exact current head ID and
generation. A previously published receipt may remain inspectable after a head
transition only while the current head still preserves its exact non-destroy
operation and deployed-revision lineage. The older receipt's head ID is then
host-authored history rather than independently reconstructible current-head
evidence; the coordinator revalidates the operation lineage it still owns.

Within one session, lifecycle generation and PID cannot change and sequence
must advance by exactly one. A new session must increase lifecycle generation
and restart sequence at one. Owner generation is stable within one session;
it may reset after a graceful release because the ownership record is deleted,
so the strictly newer lifecycle generation and session ID fence the next owner.
Activation generations cannot regress. A release change additionally requires
a new session, strictly newer activation record and selection generations, and
a newer authorizing head with a different non-destroy operation.

Receipt construction is intended for a privileged host-owned observer that
checks the durable service/activation state and the live process. It is outside
the application UID and does not expose provider credentials to application
code. That observer is specified here but not yet installed or connected to
the systemd runtime.

### Conditional current S3 object

Each node has one deterministic current key:

```text
health/v1/<deploymentInstanceId>/<incarnationId>/<nodeBindingId>
```

Publication serializes the validated canonical receipt as at most 32 KiB of
UTF-8 JSON and writes it with exact length, SHA-256 checksum, AES256
server-side encryption, STANDARD storage, fixed content type/cache control,
expected bucket owner, and receipt metadata. The first write uses
`If-None-Match: *`; a successor uses the observed current ETag only as an
opaque `If-Match` compare-and-swap token. ETag is never interpreted as a
content hash, sequence, or clock.

Every read requires the current `GetObject` body plus a matching current
`HeadObject`. Both envelopes must agree on the complete canonical bytes,
checksum, metadata, encryption, VersionId, ETag, and `LastModified`. A race
between those reads is retried rather than silently accepting an older
version. Conditional failure, response loss, and other ambiguous publication
results use bounded current-object readback: the exact candidate or an already
valid successor converges, an unchanged predecessor may retry, incompatible
evidence is conflict, and unresolved access remains unknown.

S3 versioning retains the immutable object versions behind this current key.
The control bucket now requires exactly one lifecycle rule that makes
noncurrent versions beneath `health/v1/` eligible for asynchronous expiration
after one day. It does not expire the current health object, any `stage/v1/`
artifact version, the versioning sentinel, or another retained control object.
The bucket still waits the full
first-enable interval from Amazon S3's
[versioning guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/manage-versioning-examples.html)
before proving versioned writes ready.

### Provider-owned freshness and inspection authority

The pinned service-health contract publishes every 15 seconds, permits at most
60 seconds of age, and allows 5 seconds of coordinator clock skew. Freshness is
computed from S3's provider-owned `LastModified`: a receipt older than 65
seconds is stale, while a provider timestamp more than 5 seconds in the future
is conflict. There is no host timestamp in the receipt that a stale or skewed
node could forge into freshness.

`DeploymentInspectionV3` (`win3`) carries the full health receipt plus the
current bucket/key/VersionId/ETag/`LastModified` observation. `healthy` service
state requires that complete provider-visible observation; other service
states cannot carry one. The receipt must match the inspection's provider,
incarnation, node provider identity, deployment revision, application,
artifact, and revision. An inspection may be `converged` only when the sole
resident node has an exact fresh healthy receipt for the target artifact and
revision. The controller uses that final inspection gate before publishing
`READY`; plans and serialized inspections remain evidence, never standalone
mutation authority.

### Strict provider contract and retained bucket lifecycle

The profile and AWS provider specification advance together to provider
contract version 3. The fixed runtime identity now names only SSM management,
artifact reads, exact current health-object reads and writes, and blocked
application instance metadata. The provider specification additionally pins
conditional-current-object publication and the exact one-day noncurrent health
retention rule, so an old version-2 profile/spec cannot be reinterpreted as
granting this boundary.

Control-bucket inspection now requires the one exact `health/v1/` lifecycle
rule instead of lifecycle absence. Bootstrap may install that rule and resolves
ambiguous writes through complete bounded readback; extra, broader, disabled,
or differently retained rules conflict. Current health and staged artifact
versions remain preserved by construction.

## Crash, concurrency, and authority semantics

- A crash before a conditional publish leaves the prior current receipt and its
  freshness window unchanged.
- A crash after S3 accepted a write but before the response is resolved through
  exact current-version readback.
- Concurrent writers cannot both advance one predecessor: ETag is used only as
  the provider compare-and-swap fence, while receipt successor rules establish
  the legal semantic ordering.
- Replaying an identical current receipt returns its existing observation
  without refreshing it. Only a legal successor under the exact current
  deployment context can write a new provider timestamp.
- Current-object response races, missing evidence, provider access failures,
  stale evidence, and contradictory evidence remain distinct missing, unknown,
  stale, or conflict results. None grants readiness or mutation authority.
- Final controller settlement requires a fresh `win3` observation after all
  actions settle. Artifact staging proves exact bytes are retained; service
  health separately proves those bytes are running and healthy on the exact
  node.

## Explicit limitations and next prerequisites

- The privileged host observer that reads systemd/ledger activation state and
  publishes every 15 seconds is not implemented, installed, or wired.
- That observer still needs a durable restart strategy for its per-session
  sequence so it never reuses or skips the exact successor expected by the
  current object.
- The real AWS capability driver and production inspection composition do not
  yet call this boundary against an EC2 node.
- The concrete runtime IAM policy must allow conditional current-object reads
  and writes only for its deployment key while denying object and version
  deletion. The provider specification currently pins only the policy digest
  and abstract access contract.
- The exact AWS provider-spec SSM public-parameter and EC2 image
  resolver/validator is still required before the fixed resource driver.
- Authority, retained table/bucket, store, artifact stager, health transport,
  driver, controller, and source/packaged operator commands are not yet one
  production composition root.
- No live-account S3 behavior or complete clean-account
  create/recover/update/reconcile/destroy lifecycle has been proven.
- Node replacement, retained-stage collection, retained-state purge/adoption,
  ingress, multiple nodes, and automatic coordinator fencing remain later
  work. Because lifecycle applies only to noncurrent versions, every retired
  incarnation/node key keeps one current receipt until that future explicit
  retained-state cleanup exists.

## Validation and artifact hygiene

Focused Jest is invoked directly with `--coverage=false`; the repository
`npm test` script still hard-codes coverage. On exact Node 24.13.1, the final
changed-boundary gate passes 13 suites and 291 tests. All four source, app,
test, and SEA-verifier typecheck targets pass; changed JavaScript passes ESLint;
and every changed JavaScript/Markdown file passes Prettier. `git diff --check`
is clean. No live AWS test is part of this checkpoint. The post-test artifact
scan found no coverage, cache, TypeScript-build, JUnit, core, or tarball output;
the repository remained 507 MiB with 214 MiB under `node_modules`.

## Preservation state

Before this slice, local and remote `agent/strict-manifest` both pointed to
`5972dafb59e83b2b6172531c88f83a64b6365211`, preserving the recovery-safe
artifact-staging checkpoint. The historical local stash remains untouched as
`stash@{0}: WIP on master: 3dee66b work prompt`. The commit containing this
checkpoint becomes the next restart point after it is pushed and its exact
remote tip is verified.

## Ordered next work

1. Implement the exact AWS provider-spec resolver and validator for the pinned
   SSM public parameter/version and complete EC2 image receipt.
2. Implement the fixed AWS driver as independently recoverable network,
   identity, retained-volume, managed-artifact, and resident-node capabilities
   with exact ownership and authoritative readback.
3. Compose authority, retained table/bucket, portable store, artifact stager,
   health transport, driver, and controller behind source and packaged
   deployment operator commands.
4. Install the privileged host observer and prove that its exact runtime
   identity can read staged bytes and conditionally publish only its current
   health object while the application UID cannot use provider credentials.
5. Prove clean-account create, interruption recovery, update/reconcile,
   ownership-safe destroy, retained-state reporting, and response-loss
   recovery through ordinary user credentials.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v24-provider-visible-service-health.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are fine, v1 is abandoned, and no downstream
> users exist. The strict provider-visible health receipt and conditional
> current S3 object now bind provider/deployment/node authority, stable
> non-destroy operation plus authorizing head lineage, exact release,
> service/session/lifecycle/owner and activation generations, PID, and positive
> per-session sequence. S3 VersionId and `LastModified` provide the provider
> observation; only a fresh complete `win3` receipt can grant final readiness.
> The provider/profile contract is version 3 and only noncurrent `health/v1/`
> versions become eligible for asynchronous expiration after one day. This is
> deterministic-mock proof only: no
> privileged host observer, real AWS driver, or live resource is wired. Next
> implement the exact SSM/EC2 provider-spec resolver/validator, then the
> independent-capability AWS driver and production composition. Preserve
> trusted single-node scope, one-recoverable-coordinator semantics,
> evidence-backed effects, ordinary credential chains, exact ownership checks,
> focused no-coverage testing, and immediate cleanup of generated artifacts.
