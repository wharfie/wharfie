<h1 align="center">
  <img src="./docs/assets/beanie.svg" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
  <br>
  <br>
</h1>

<p align="center">
  <a href="https://github.com/wharfie/wharfie/actions/workflows/ci.yml"><img src="https://github.com/wharfie/wharfie/actions/workflows/ci.yml/badge.svg" alt="Wharfie CI"></a>
</p>

> **Project reset:** Wharfie's v1 Athena/table implementation has been removed. Wharfie remains experimental, and breaking changes are expected while the new application model is made coherent.

Wharfie is a local-first TypeScript application runtime that turns an ordinary CLI into a portable executable, then lets that same application become a durable, observable service across trusted machines without an architectural rewrite.

The product goal is continuity:

1. Write and run a normal CLI locally.
2. Mark named operations as durable activities.
3. Package the application as one approachable executable.
4. Promote it to a persistent service on one machine.
5. Add schedules, workflows, retries, and durable state.
6. Enroll more trusted nodes when placement or resilience requires them.
7. Inspect, intervene in, update, and roll back the application through the same executable.

No separate service rewrite, preinstalled Node runtime, Dockerfile, Kubernetes cluster, or hosted orchestration service should be required on the target machine.

Inside a packaged application, normal argv belongs to the application. Wharfie
reserves only `<app> wharfie <command>` for operator commands; internal service
startup uses a private environment-selected runtime command instead of
consuming public commands.

Local and single-node use should require no external Wharfie control plane. The initial automatic coordinator-failover design does depend on a linearizable durable store.

The abandoned v1 source and dependency graph have been deleted. The strict v2
manifest and the append-only V10 run → invocation → attempt → effect ledger
are now defined; the superseded mutable Operation/Action snapshot store is
gone. The manifest can declare a bounded plain-data linear workflow, and the
internal ledger can atomically create a workflow run headed by an activity,
timer, or signal wait with its immutable plan and start payloads, stable cursor
and activation identities, run-directory entry, and any cursor-bound
ready-work row. The resident claims, starts, and executes exact manifest-bound
ordinary workflow activities and fires exact due timers as framework work,
atomically persisting each output and next activation or terminal cursor. The
ledger's redacted per-service history directory is transactionally bound to
every run transition. Its exact-revision ready-work projection is bound to each
relevant manual activity, workflow activity, recovery, and timer transition,
while
revision-backed source and SEA activities consume
one frozen target dependency closure instead of ambient `node_modules` or a
newly resolved npm tree. Exact-run inspection, confirmed recovery, and
authenticated current-owner cancellation use one shared source/SEA operator
layer; packaged commands bind authority to their embedded application identity.
Source `wharfie ops run` and packaged `<app> wharfie run` now also use one
durable activity host. The source adapter supplies a sealed prepared revision;
the packaged adapter accepts only its cross-checked embedded manifest and
revision/runtime pair and exposes no source-directory override. Operator and
private runtime dispatch choose their path before authored CLI code is loaded.

That host now supports durable submission separately from execution. Source
`wharfie ops submit` and packaged `<app> wharfie submit` persist an exact
app/revision activity request even when no worker is running. If the matching
resident is live, submission reaches it through the authenticated local-owner
command endpoint; otherwise a short-lived exclusive owner appends the same
`RUNNABLE` invocation and exits. Source `wharfie ops worker` and packaged
`<app> wharfie worker` run the first single-node resident activity worker, and
the hidden packaged service runtime delegates to that same implementation. The
worker accepts only its exact app and revision, executes one physical attempt
at a time, and consumes the bounded ready-work projection only as a locator
before rebuilding and claiming from authoritative ledger state. On restart it
can release and
reschedule a stale `CLAIMED` attempt that never started; a stale `STARTED`
attempt becomes blocked `UNCERTAIN` work and is never silently redispatched.
If that stopped attempt retains unresolved managed effects, the resident uses
the same source-free compound recovery boundary: `PENDING` siblings are
cancelled, `STARTED` application-state siblings are probed read-only for their
permanent receipts, and the exact set settles atomically before the run blocks.

Foreground durable `ops run` and resident execution share an authenticated
current-owner cancellation path. Source `wharfie ops cancel` and packaged
`<app> wharfie cancel` can reach only the exact live, same-principal LMDB owner
of a `STARTED` manual attempt. The required stable `--request-id` is reused
after a lost response. That owner persists intent before beginning physical
delivery; an inactive, stale, unreachable, or resident owner that is not
running the exact attempt never triggers a direct-write fallback. A verified
completion or failure may still win the ledger race, while ambiguous
post-cancellation termination becomes blocked `UNCERTAIN` work. Blocked work
can now be resolved only through an explicit, evidence-backed reconciliation
event: a complete bounded Activity Protocol
transcript proves one retained abandoned attempt's terminal outcome, while the
physical attempt itself stays `ABANDONED`. The local command transport is not
yet supported on Windows. V10 carries forward verifier-backed managed effects
through the framed source/SEA worker boundary and exposes one finite public
operation: `application-state` / `put-if-absent`. Its LMDB destination
atomically commits the business value with a permanent effect receipt.
Confirmed source/SEA operator recovery and resident restart recovery now settle
the complete active-effect set—at most 16 unresolved effects—for one stopped
attempt under the held LMDB owner. A retained `PENDING`
request becomes `CANCELLED` without opening application state; every `STARTED`
sibling is probed read-only, with an exact receipt becoming `COMPLETED` or
`FAILED` and strict absence becoming `UNCERTAIN`. One append-only transaction
applies all sibling dispositions and blocks the arbitrary stopped activity
attempt. Unsupported, missing, or corrupt destination evidence leaves the whole
set unchanged. Recovery never reruns application or adapter code. Destination-
finalized reconciliation can now resolve one retained `UNCERTAIN` built-in
effect without resolving the abandoned activity. One narrow public successor
policy can authorize a fresh application-state V2 `put-if-absent` target only
after the exact source effect is permanently `NOT_APPLIED`. Its dedicated
effect-only lifecycle starts fresh target identities and never redispatches the
abandoned authored activity. The source stays `BLOCKED` / `UNCERTAIN`.

The public packaged command's Node-absent relocated-SEA crash/recovery matrix
passes across every successor publication and transaction boundary, including
redaction and response-loss replay. Generic handler retries, compensation,
scheduled workflow starts, and wider exactly-once claims remain unfinished.
Earlier V8 real-child coverage exercises seven source/core durable-run
`SIGKILL` boundaries and three mixed-set recovery
boundaries. A relocated SEA with Node absent from `PATH` proves the complete
eight-boundary managed-effect matrix, three-boundary mixed-settlement matrix,
and four-disposition effect-reconciliation matrix, including exact orphan-
payload reuse and LMDB owner recovery. Those paths never dispatch authored
app/CLI/activity code or the normal adapter. The resident activity vertical now
persists offline submissions, executes serially, recovers conservative restart
states, and drains gracefully through the transactional ready-work index. The
internal linear workflow path is durable and rebuildable; the resident now
executes exact manifest-bound activities, fires persisted due timers without
Activity Protocol dispatch, persists outputs, advances the cursor atomically,
releases unstarted claims after restart, and blocks lost started attempts
without redispatch. Source `wharfie ops start` and packaged
`<app> wharfie start` persist activity-, timer-, or signal-headed manifest
workflows. Source `wharfie ops signal` and packaged `<app> wharfie signal`
deliver one stable, current-wait-only signal decision through the same local
owner boundary. The shared exact-run inspection, recovery, cancellation, and
evidence-reconciliation commands understand the activation-aware cursor and
schema-v7 redacted timer/signal lifecycle state. Managed-effect workflow
successors and schedules remain unfinished. Packaged Linux artifacts now have
a recoverable systemd user-service
install/update/rollback/recover/start/stop/restart/status/uninstall lifecycle.
A single local coordinator serializes release changes, closes durable work
admission, requires every existing source run to be terminal during update or
rollback, and retains one exact rollback candidate before it changes the
executable selection. First install separately admits already queued work for
the exact target revision. Interrupted activation is resumed explicitly from
durable phase state. In addition to focused repository tests, a checksummed
Ubuntu proof builds three distinct SEAs from the installed npm tarball and
covers exact-unit startup, resident `SIGKILL` replacement, abrupt VM power
loss, pre-login recovery, durable workflow continuation, all five post-commit
update and rollback boundaries, all five failed-target source-restoration
boundaries, ambiguous-response recovery, and state-preserving uninstall.
Multi-host leases and heartbeats and public run history/listing are still later
work. The npm package remains deliberately private. It is not ready for
production use.

The first provider deployment authority is now defined. A strict AWS-shaped
one-node profile now resolves one schema-V3, `wap3` content-addressed provider
specification that pins the exact regional AMI and parameter version, a stable
standard Availability Zone ID that offers the fixed instance type, the exact
regional/account default EBS KMS key ARN, bootstrap and identity policy
digests, instance shape, metadata controls, explicit retained-volume
performance and attachment contracts, network, service-health timing, and the
content ID of one fixed 15-role physical-resource graph. DeploymentPlanV3
expands the small portable capability model into one independently recoverable
action per graph role, while DeploymentInspectionV4 binds present ownership to
exact BindingV2 dependency lineage and distinguishes authoritative absence from
access failure. Apply and reconcile use one canonical topological order;
destroy reverses it, retaining state volumes while purging their attachments.
Dependent creates re-prove earlier settled dependency authority, destroy
re-proves prior purges at every later frontier, and finalization requires each
role's exact planned state or absence.
The provider/profile contract remains version 3. Only a fresh incarnation resolves mutable
provider prerequisites; converge, resume, and resident update/destroy reuse
the pinned document. Running-SEA deployment identity, exact provider scope and
ownership bindings, and a CAS deployment head support crash-resumable
convergence against a deterministic fake. The AWS boundary also resolves one
ordinary credential-chain snapshot for an explicit region and bootstraps the
fixed retained DynamoDB control table. These AWS calls are proven under
focused mocks, not a live account. That credential snapshot now also exposes a
narrow SSM/EC2 provider-spec read capability. Only a new incarnation resolves
the architecture-specific AL2023 latest parameter; converge validates the
pinned parameter version and exact Amazon-owned, public, available,
Linux/EBS/HVM/ENA image association, exact pinned zone/instance offering, and
exact default EBS key without selecting a newer default or replacement zone.
Frozen-candidate bounded retries distinguish missing, contradictory, and
unresolved provider evidence. The same snapshot also exposes narrow
caller-owned S3 and EBS-volume capabilities. Wharfie can bootstrap one retained,
versioned control bucket with no bucket policy, wait through S3's documented
first-enable propagation interval, persist an immutable stage intent before
streaming the running SEA through a held descriptor, and accept only exact
checksum, encryption, metadata, and non-`null` object-version readback. The
held bytes are also cross-checked against the SEA's embedded app, revision, and
runtime target. Converge requires that receipt and regenerates provider
authority after staging before accepting a plan; resume revalidates the
retained version without historical local bytes, while destroy deliberately
does not require it. A host-owned provider-visible health receipt now binds the
exact deployment/node, operation/head lineage, running release, service
session, durable generations, process, and heartbeat sequence. Its conditional
current S3 object supplies version and `LastModified` freshness evidence, and
only a fresh context-bound receipt can make Inspection V4 converged. The exact
`health/v2/` bucket lifecycle makes noncurrent health versions eligible for
asynchronous expiration after one day without collecting the current receipt
or staged artifacts. This boundary is
proved under deterministic mocks. The first controller-compatible resource
module can create one exact retained `gp3` volume with a stable EC2
`ClientToken` and atomic ownership tags, recover an ambiguous response through
controller replay or bounded tagged discovery plus strict `DescribeVolumes`
readback, and make retention an explicit no-op.
It does not yet attach, format, mount, or fulfill the volume capability. The
privileged host observer, network/identity/node/attachment resource drivers,
complete AWS driver/router/inspection/`createPlan`, operator
commands, production composition, and clean-account proof remain unfinished.

## Start here

- [Project charter](PROJECT.md) — the canonical problem, scope, public concepts, boundaries, and success test.
- [Documentation](docs/README.md) — source-first installation, quickstart, application structure, design decisions, and project-reset history.
- [Architecture decisions](docs/architecture/decisions/README.md) — accepted constraints on trusted nodes, coordination, provisioning, effects, and language boundaries.
- [Roadmap](ROADMAP.md) — the live ordered cleanup and implementation plan.
- [Multi-effect resource graph checkpoint](llm/checkpoints/2026-07-21-v27-multi-effect-resource-graph.md) — the current handoff for the fixed 15-role graph, strict role/dependency/lifecycle contracts, and recoverable multi-effect controller frontier.
- [Retained EBS volume resource checkpoint](llm/checkpoints/2026-07-21-v26-retained-ebs-volume-resource.md) — the preceding handoff for provider-spec V2 placement and encryption pinning plus the first controller-compatible, response-loss-safe retained resource capability.
- [Exact AWS provider-spec resolution checkpoint](llm/checkpoints/2026-07-21-v25-exact-aws-provider-spec-resolution.md) — the preceding handoff for frozen latest resolution, exact-version validation, strict SSM/EC2 image evidence, and typed bounded failure handling.
- [Provider-visible service-health checkpoint](llm/checkpoints/2026-07-21-v24-provider-visible-service-health.md) — the preceding handoff for strict health receipts, conditional S3 publication, provider-owned freshness, final Inspection V3 readiness, and bounded noncurrent-version retention.
- [Recovery-safe artifact-staging checkpoint](llm/checkpoints/2026-07-20-v23-recovery-safe-artifact-staging.md) — the preceding handoff for the retained versioned control bucket, held-source upload, and exact object-version recovery evidence.
- [Pinned AWS provider-spec checkpoint](llm/checkpoints/2026-07-20-v22-pinned-aws-provider-spec.md) — the preceding handoff for immutable regional prerequisites and recovery-stable Plan/Inspection V2 authority.
- [AWS deployment-control checkpoint](llm/checkpoints/2026-07-20-v21-aws-deployment-control.md) — the preceding handoff for credential-bound AWS scope, retained DynamoDB bootstrap, and the durable deployment store.
- [Recoverable deployment-controller checkpoint](llm/checkpoints/2026-07-20-v20-recoverable-deployment-controller.md) — the preceding handoff for strict single-node deployment identity, planning, ownership, and provider-neutral crash recovery.
- [Bounded runtime extraction checkpoint](llm/checkpoints/2026-07-20-v19-bounded-runtime-extraction.md) — the preceding handoff for crash-safe packaged native extraction cleanup and the provider-backed next vertical.
- [Real-host activation proof checkpoint](llm/checkpoints/2026-07-20-v18-real-host-activation-proof.md) — the preceding handoff for checksummed two-release update, rollback, response-loss, and failed-target source-restoration evidence.
- [Recoverable systemd activation checkpoint](llm/checkpoints/2026-07-20-v17-recoverable-systemd-activation.md) — the preceding handoff for durable single-node release activation and manager/CLI integration.
- [Systemd reboot-proof checkpoint](llm/checkpoints/2026-07-20-v16-systemd-reboot-proof.md) — the preceding handoff for checksummed real-VM crash, boot, workflow-continuation, lifecycle, and uninstall evidence.
- [Shared packaged-storage checkpoint](llm/checkpoints/2026-07-20-v15-shared-packaged-storage.md) — the preceding handoff that unified foreground and resident durable state.
- [Systemd user-service checkpoint](llm/checkpoints/2026-07-20-v14-systemd-user-service-foundation.md) — the implementation foundation for packaged Linux service lifecycle, immutable releases, and PID-bound health.
- [Workflow timers and signals checkpoint](llm/checkpoints/2026-07-20-v13-workflow-timers-signals.md) — the preceding handoff for persisted timers, current-wait signals, exact replay, and source/SEA crash proof.
- [Workflow cancellation checkpoint](llm/checkpoints/2026-07-19-v12-workflow-cancellation.md) — the preceding handoff for durable run-level cancellation, active delivery, replay, and cancelled-evidence reconciliation.
- [Workflow crash-recovery checkpoint](llm/checkpoints/2026-07-19-v11-workflow-crash-recovery.md) — the preceding handoff for public source and relocated-SEA process-death recovery.
- [Public workflow operator checkpoint](llm/checkpoints/2026-07-19-v10-public-workflow-operator-surface.md) — the earlier handoff for shared source/package start, schema-v6 inspection, confirmed recovery, and event-anchored evidence reconciliation.
- [Resident workflow activity checkpoint](llm/checkpoints/2026-07-19-v9-resident-workflow-activities.md) — the preceding handoff for exact manifest-bound dispatch and conservative restart recovery.
- [Activity-headed workflow-start checkpoint](llm/checkpoints/2026-07-19-v5-activity-headed-workflow-start.md) — the historical handoff for immutable workflow inputs, stable cursor identities, atomic initial materialization, and ready-work V2.
- [V10 ready-work checkpoint](llm/checkpoints/2026-07-19-v4-v10-ready-work.md) — the preceding implementation handoff for the exact-revision transactional scheduler locator and strict workflow authoring contract.
- [Resident activity worker checkpoint](llm/checkpoints/2026-07-19-v3-resident-activity-worker.md) — the preceding fully validated handoff for offline submission, serial resident execution, and conservative restart recovery.
- [V2 foundation stabilization checkpoint](llm/checkpoints/2026-07-19-v2-foundation-stabilized.md) — the preceding clean-install restart point after repository cleanup, the portable module gate, and the public V9 successor proof.
- [V9 managed-effect successor checkpoint](llm/checkpoints/2026-07-19-v9-managed-effect-successors.md) — the historical pre-mount restart point for the first causally linked fresh-identity retry policy and its internal relocated-SEA proof.
- [V8 destination-effect reconciliation checkpoint](llm/checkpoints/2026-07-18-v8-destination-effect-reconciliation.md) — the preceding restart point after destination-finalized uncertain-effect reconciliation and its relocated-SEA crash matrix.
- [Relocated-SEA mixed-settlement checkpoint](llm/checkpoints/2026-07-18-relocated-sea-mixed-settlement-sigkill-matrix.md) — the preceding restart point after proving packaged stopped-attempt settlement across mixed sibling dispositions.
- [Relocated-SEA managed-effect checkpoint](llm/checkpoints/2026-07-18-relocated-sea-managed-effect-sigkill-matrix.md) — the preceding restart point after repeating managed-effect crash recovery through the moved SEA.
- [Shared packaged durable-run checkpoint](llm/checkpoints/2026-07-18-shared-packaged-durable-run-host.md) — the historical point that unified source and packaged foreground durable execution and proved a moved-SEA managed effect with exact replay.
- [Real-process managed-effect crash checkpoint](llm/checkpoints/2026-07-18-real-process-managed-effect-crash-matrix.md) — the preceding restart point after proving the source/core and compound-recovery `SIGKILL` matrices and the narrower packaged-operator response-loss boundary.
- [V7 atomic effect-settlement checkpoint](llm/checkpoints/2026-07-18-v7-atomic-effect-settlement.md) — the preceding restart point after closing stopped-attempt sibling sets in one bounded transaction.
- [Public effects and receipt-recovery checkpoint](llm/checkpoints/2026-07-18-public-effects-and-receipt-recovery.md) — the preceding restart point after exposing finite application state and closing its first singular stopped-runner recovery window.
- [July 2026 checkpoint](llm/checkpoints/2026-07-16-project-reset.md) — immutable historical evidence of the pre-reset state and conversation handoff.
- [Packaging salvage checkpoint](llm/checkpoints/2026-07-16-packaging-salvage.md) — historical first implementation proof and the release blockers that existed before v1 deletion.
- [V1 deletion checkpoint](llm/checkpoints/2026-07-16-v1-deletion.md) — historical deletion boundary and evidence.
- [Strict v2 manifest checkpoint](llm/checkpoints/2026-07-16-strict-v2-manifest.md) — historical strict public-boundary handoff.
- [Atomic operation-store checkpoint](llm/checkpoints/2026-07-16-atomic-operation-store.md) — historical atomic snapshot and fencing boundary.
- [Immutable identity-spine checkpoint](llm/checkpoints/2026-07-17-immutable-identity-spine.md) — historical identity and artifact boundary.
- [Mutable Operation/Action retirement checkpoint](llm/checkpoints/2026-07-17-mutable-operation-retirement.md) — historical deletion boundary after making the append-only V3 ledger the only writable durable run model.
- [V5 managed-effect foundation checkpoint](llm/checkpoints/2026-07-18-v5-managed-effect-foundation.md) — historical internal persisted-effect boundary before destination binding and public application state.
- [Evidence-backed uncertain-reconciliation checkpoint](llm/checkpoints/2026-07-18-evidence-backed-uncertain-reconciliation.md) — historical predecessor for the V4 terminal-resolution event, shared source/SEA operator command, and final local branch cleanup.
- [Authenticated current-owner cancellation checkpoint](llm/checkpoints/2026-07-18-authenticated-current-owner-cancellation.md) — parent checkpoint for the narrow external cancellation contract.
- [V4 durable-cancellation checkpoint](llm/checkpoints/2026-07-17-durable-cancellation-v4.md) — historical foreground durable-before-signal boundary.
- [Shared source/SEA ledger-operator checkpoint](llm/checkpoints/2026-07-17-shared-source-sea-ledger-operator.md) — historical boundary after unifying exact-run inspection/recovery and binding packaged operators to embedded app identity.
- [Resource-injection retirement checkpoint](llm/checkpoints/2026-07-17-resource-injection-retirement.md) — historical boundary after narrowing activities to the framed protocol and deleting the unusable injected-resource/runtime-RPC island.
- [Obsolete runtime retirement checkpoint](llm/checkpoints/2026-07-17-obsolete-runtime-retirement.md) — historical deletion boundary for the disconnected NodeAgent/systemd/private-gRPC runtime island.
- [Atomic run-directory checkpoint](llm/checkpoints/2026-07-17-run-directory-index.md) — historical hosted SEA evidence, verified V3 history index, and the cleanup boundary that preceded the runtime deletion.

The charter and accepted decisions are authoritative; the roadmap is expected
to evolve, and dated checkpoints and project-reset records are historical
snapshots. The repository-native guides under `docs/guides/` track the current
public command surface. Older material under `llm/design/` can be stale.

## Current application contract

A source application is a default-exported plain object in `wharfie.app.js`.
The v2 boundary is deliberately small and strict:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  schemaVersion: 2,
  app: { id: 'my-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.js',
      export: 'main',
    },
  },
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/activities/greet.js',
        export: 'greet',
      },
    },
  },
  workflows: {
    greet: {
      steps: [
        {
          id: 'greet',
          kind: 'activity',
          activity: 'greet',
          input: { kind: 'workflow-input' },
        },
      ],
    },
  },
});
```

Application and activity IDs are lowercase kebab identifiers matching
`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, with a maximum of 63 ASCII bytes. Wharfie
does not trim or rewrite them. The CLI is required; activities and package
targets and workflows are optional. A workflow is one to 64 ordered plain-data
activity, timer, or signal steps; activity inputs explicitly select the
workflow input, a JSON literal, or one earlier step's persisted output. The
manifest compiler and packager bind that definition to the revision. The
shared source and packaged `start` commands accept the complete finite
activity/timer/signal plan and atomically materialize its first activation. The
resident executes activity steps and fires persisted due timers; a signal step
advances only through an explicit current-wait delivery. Exact-run `inspect`,
confirmed `recover`, and evidence-backed `reconcile` are workflow-aware.
Generic `cancel` is run-level for workflows:
it terminalizes unstarted work, durably records intent before signaling an
exact active attempt, and fences a blocked uncertain activation against later
continuation. Stable request IDs make response-loss retries idempotent.
Application- and activity-level `resources` are not part
of the schema and are rejected as unknown fields. A caller-metadata object may
contain a property named `resources`, but it is ordinary inert JSON—not an
injection request. Managed effects are a separate finite API on
`runtime.effects`; the first exact request is `application-state` /
`put-if-absent` with `['idempotent', 'transactional']` replay properties.
Durable `ops run` fulfills that request, while ephemeral invocation rejects it
with `effect-handler-unavailable`. Schedules remain outside this schema. Build
credentials, signing material, and extra asset configuration are also outside
the public manifest. Branches, loops, parallel steps, a durable early-signal
inbox, and managed-effect workflow successors remain unsupported.

See the [quickstart](docs/guides/quickstart.md) and [application
structure](docs/guides/application-structure.md) for the complete
authoring rules.

## Submit durable work and run a local resident

The source submission, start, and worker commands prepare and pin the
application revision from `--dir`; `signal` resolves app scope from the
existing run:

```bash
wharfie ops submit --dir ./path/to/app --activity greet \
  --idempotency-key <stable-key> --input '{"name":"Ada"}'
wharfie ops start --workflow greet --dir ./path/to/app \
  --idempotency-key <stable-workflow-key> --input '{"name":"Ada"}'
wharfie ops worker --dir ./path/to/app
wharfie ops signal --run-id <run-id> --signal <signal-step-id> \
  --delivery-id <stable-delivery-id> --payload '{"approved":true}'
```

A packaged application exposes the same operations without a source-directory
override:

```bash
<app> wharfie submit --activity greet \
  --idempotency-key <stable-key> --input '{"name":"Ada"}'
<app> wharfie start --workflow greet \
  --idempotency-key <stable-workflow-key> --input '{"name":"Ada"}'
<app> wharfie worker
<app> wharfie signal --run-id <run-id> --signal <signal-step-id> \
  --delivery-id <stable-delivery-id> --payload '{"approved":true}'
```

`submit` and `start` are durable and do not require a live worker. Reusing the
same idempotency key with the identical activity or workflow request returns
the retained run; changing the request conflicts. A matching resident wakes
immediately when it accepts the authenticated request, while offline work
remains `RUNNABLE` until that exact app/revision worker starts. The workflow
start output includes the derived run ID, immutable revision, workflow,
current cursor position, and activation kind without exposing inputs or
payload references. `signal` requires a caller-stable delivery ID and a JSON
payload. It accepts only the signal named by the current wait: an early,
unexpected, or late delivery is durably rejected as `early-signal`,
`unexpected-signal`, or `late-signal`, with no early-signal inbox. Repeating
the exact delivery returns the retained accepted or rejected decision;
changing a reused delivery ID conflicts. The shared `inspect --json` surface
emits a schema-v7 redacted manual/workflow view, including safe cursor, timer,
signal-wait, and signal-delivery lifecycle fields but no signal payload,
payload reference, digest, or actor. Confirmed `recover` and evidence-backed
`reconcile` return the same safe view around their result. The worker is
deliberately serial. On
`SIGINT` or `SIGTERM` it stops admitting commands and claims, records
`STOPPING`, allows the active attempt up to 30 seconds to finish naturally,
then retains ownership until the attempt and admitted command handlers settle.
A manual attempt receives cooperative durable cancellation; a workflow attempt
receives physical drain cancellation and becomes durably uncertain unless it
still returns a supported terminal. That shutdown path remains physical-only;
an operator `cancel` request is the separate durable run-level decision.

On Linux with a usable systemd user manager and administrator-enabled user
lingering, the packaged artifact can manage that same resident as a fixed user
service:

```bash
<app> wharfie service install
<app> wharfie service status --json
<next-app> wharfie service update
<next-app> wharfie service rollback
<next-app> wharfie service recover
<app> wharfie service stop
<app> wharfie service start
<app> wharfie service restart
<app> wharfie service uninstall
```

These commands reject root, never invoke `sudo`, and preserve durable state and
immutable releases on uninstall. `service update` is invoked through the new
artifact and activates it only after closing run admission and proving every
durable run terminal. A fresh `service rollback` must be invoked through the
currently selected artifact—`<next-app>` immediately after an update—and
selects the one retained prior release. If its response is ambiguous, run
`service recover`; do not issue a new rollback and risk requesting the reverse
transition. A rollback request from the prior/candidate SEA is rejected because
it cannot be distinguished from a false fresh request.

The coordinator persists every activation phase. It enables the exact unit
without starting it, then permits `systemctl start` only after the durable
state reaches `ACTIVATING`. A first install has no source: queued work for the
target revision is admitted, while nonterminal work for another revision
leaves the request `pending` and fenced. During update or rollback, the exact
selected source has a narrow `QUIESCING` start exception so it can finish
draining or be retained safely. Results separate request status
(`fulfilled`, `refused`, `failed`, or `pending`) from outcome
(`target-active`, `source-retained`, `source-restored`, `in-flight`, or
`absent`).

Durable activation state is the authority for repairing a missing receipt,
selector, or fixed unit. Physical wiring without that authority is reported
as degraded and is never adopted by install, start, update, rollback, or
recovery; the existing exact orphan checks remain available only for cleanup
through `service uninstall`.
Uninstall preserves immutable releases and durable state, retains the `ACTIVE`
selection and same-revision run admission, and writes an installation
tombstone while removing physical wiring. Running `service install` from that
same selected release rehydrates the service without changing activation
record version or selection generation. That tombstone also gives a new
artifact narrow authority to reproject the exact retained source, prove it
healthy, and then perform the ordinary durable update under the same operation
lock; `service install` from the new artifact is treated as that update. If
retained-source repair is interrupted before an activation transition begins,
run `service install` from the exact selected SEA to resume it. The unit
location is fixed to the service account's
`~/.config/systemd/user`; custom `XDG_CONFIG_HOME` topology is rejected, and
unit-name mutations require an exact, non-stale effective fragment without
drop-ins.
The repository's disposable Ubuntu proof builds the app from the installed npm
tarball, removes Node from the packaged command `PATH`, force-cycles the VM,
requires automatic healthy startup before a login session, and completes the
same persisted workflow after the kernel boot ID changes. It builds distinct
source, target, and clean-exit target SEAs; exact source-mapped breakpoints then
kill update, rollback, and restoration operators after each durable write and
require public recovery plus independent selector, receipt, process, systemd,
and immutable-byte evidence. Run it with
`npm run verify:service:systemd:lima`. A due timer remains persisted until the
exact-revision resident observes and fires it; there is deliberately no public
timer-fire command. Wharfie does not yet provide schedules, managed-effect
workflow successors, multi-host reassignment, or public run-history/listing
commands.

## Reconcile one uncertain managed effect

The source and packaged operator surfaces can resolve one retained
`UNCERTAIN` application-state effect from a permanent destination decision:

```bash
wharfie ops reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped
<app> wharfie reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped
```

All four options are required. Reuse the same `--reconciliation-id` and exact
request after a lost response; an exact replay returns the retained decision
without another destination or ledger transition. Both forms are trusted local
mutations: they require the held app-scoped LMDB local-owner protocol, refuse
to race a live resident session or prior runner, and do not provide remote
operator routing. The packaged form additionally binds the run to the app
identity embedded in the artifact.

The command can retain a late verifier-backed positive receipt or atomically
finalize the exact destination effect as permanently `NOT_APPLIED`. It never
loads application source, redispatches the effect, or unblocks the enclosing
`UNCERTAIN` invocation. Human and `--json` output are redacted: they expose the
stable reconciliation/effect identities, resulting effect status, replay
state, and safe lifecycle view, but not request values, destination/store
details, receipts, finalizations, evidence, private reason text, or fences.

## Managed-effect successor retry

After an exact application-state V2 effect has been verified permanently
`NOT_APPLIED`, a trusted local operator can authorize and run its one finite
causally linked successor:

```sh
wharfie ops retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped
```

The packaged equivalent is:

```sh
<app> wharfie retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped
```

Both forms accept an optional private `--reason <text>` and redacted `--json`
output. Reuse the exact source run, effect, successor ID, actor, and reason
after a lost response. Exact replay returns or advances the one retained target;
it cannot authorize a sibling or enter an already-started adapter again.

The successor receives fresh run, invocation, attempt, effect, destination,
and fence identities through a dedicated effect-only lifecycle. It never
redispatches the abandoned authored activity, and the source remains `BLOCKED`
/ `UNCERTAIN` even when the target completes. This is only the finite
application-state V2 `put-if-absent` retry policy; it is not generic handler
retry or compensation.

## Current external dependency boundary

An activity can declare exact npm package names and versions that are direct
production or optional dependencies in its application's local npm lock v3.
Wharfie derives the complete target closure from that sealed lock without ideal-
tree resolution, extracts exact credential-free HTTPS tarballs under canonical
SHA-512 integrity, and binds semantic closure plus archive receipts to the
application revision and artifact provenance. Revision-backed source execution
uses the same closure rather than the author's ambient install.

The frozen-lock contract deliberately ignores package lifecycle scripts,
creates no package `bin` links, and treats failure of a selected optional
package as fatal. It rejects aliases, links, bundled dependencies, unsupported
targets, and non-registry edges. Private-registry authentication, workspace-lock
selection, musl Linux, and reproducible builds are not yet supported. Published native
packages must already contain usable locked target bytes. Windows SEA targets
are deliberately deferred until private runtime extraction has a tested ACL and
reparse-point design. Moved Darwin SEAs and the clean hosted-Linux verifier
exercise a real LMDB dependency with Node absent from `PATH`.

Packaged core native dependencies are always extracted into a fresh private
root; they are never reused as a mutable cache. Normal exit removes that root.
After `SIGKILL`, a successor verifies the same UID/host/boot/process authority
and removes only roots whose owner is positively dead, with fixed inspection
and removal budgets. Foreign or uncertain claims are retained, and a large
backlog converges through retries instead of making startup cleanup unbounded.

Prepared revisions also fail closed when reachable JavaScript or TypeScript
uses a runtime-computed native module path or aliases a native loader. Portable
code must use literal module specifiers so the frozen dependency closure and
artifact provenance describe everything the application can load.

## Current development checks

Use the Node version in `engines` and the contributor npm version in
`packageManager` (currently Node 24.13.1 and npm 11.12.0), install dependencies,
and run:

```bash
npm ci
npm run test:ci
```

`npm run test:ci` covers lint, source and test type checks, the full unit and
integration suite, package-tarball verification, and the production dependency
audit. The parser used by the portable-module audit is a direct runtime
dependency, and clean-install validation no longer relies on the unused
TypeScript ESLint import preset or resolver. Native LMDB and generated-SEA
proofs are available through `npm run test:native` and the SEA verifier.
The destructive, disposable real-machine service gate is
`npm run verify:service:systemd:lima`; it requires Lima on macOS and creates,
force-cycles, verifies, and deletes an isolated Ubuntu VM.

Current source is organized as follows:

- `src/cli/` — the current developer and operator CLI implementation.
- `src/core/` — activity runtime, durable ledger, provider, and packaging foundations.
- `docs/` — the small repository-native guide and accepted architecture decisions.
- `llm/` — design notes, prompt templates, and dated project checkpoints.
