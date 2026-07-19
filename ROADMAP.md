# Wharfie roadmap

**Status:** V10 ready-work foundation and workflow authoring contract implemented; durable workflow execution and service installation next · **Last updated:** 2026-07-19

This roadmap orders work by the shortest path to the experience in [PROJECT.md](PROJECT.md). It is intentionally willing to remove v1 behavior and break internal APIs. Each milestone should end in an executable proof, not only new abstractions.

## Working rules

- Optimize for the intended design; there are no known downstream users or compatibility requirements.
- Keep `master` recoverable and tests meaningful while deleting obsolete code aggressively.
- Prefer a narrow end-to-end path over parallel partial frameworks.
- Treat Node SEA as the first packaging backend, not the permanent public abstraction.
- Require explicit durable semantics at every network or side-effect boundary.
- Preserve repository checkpoints before a major public-model rewrite.

## Milestone 0 — preserve and reset

**Goal:** make the new direction durable before removing old work.

- [x] Inventory local and remote refs, pull requests, issues, tests, release wiring, and major implementation paths.
- [x] Preserve every live remote branch tip under annotated `archive/2026-07-16/remote/...` tags on GitHub.
- [x] Preserve the unpublished local `master` tip and old stash with local archive tags.
- [x] Write the project charter and non-goals.
- [x] Record the initial architecture decisions.
- [x] Store a dated restart checkpoint in the repository.
- [x] Validate the reset implementation from a clean install and preserve its restart point.

**Exit:** a fresh maintainer or coding session can explain what Wharfie is, what it is not, what state was preserved, and what work comes next.

## Milestone 1 — remove ambiguity and loose ends

**Goal:** leave one honest codebase, package boundary, and validation path.

### Repository cleanup

- [x] Classify every legacy non-default branch and PR as keep, absorb, supersede, or delete; see the [cleanup inventory](docs/project-reset/2026-07-16-cleanup-inventory.md).
- [x] Reconcile the three unpublished local `master` commits and `jvd/pr4` against the new charter.
- [x] Close stale PRs with a short preservation and supersession note.
- [x] Classify every open issue as roadmap work, useful research, or obsolete; see the [cleanup inventory](docs/project-reset/2026-07-16-cleanup-inventory.md).
- [x] Create replacement issues #126–#132, assign roadmap milestones, and close the old issues with preservation/supersession notes. The post-V9 audit added the missing explicit roadmap items #133–#137 for dynamic module paths, clean-install/audit hygiene, a persistent durable workflow worker, recoverable trusted-mesh coordination, and retirement of the stale v1 documentation site.
- [x] Verify every superseded branch against its archive tag, then remove all 16 staging and legacy branches from the live remote namespace.
- [x] Confirm that no live project-board URL, configuration, or promise remains.
- [x] Retire the stale v1 documentation site, deployer, generated assets, and
      repository wrapper; retain only the repository-native v2 guides and ADRs.
- [x] Remove release automation while the package is private rather than imply
      that publishing is supported.
- [ ] Make the eventual npm package and Wharfie SEA release one validated
      artifact flow.

### Codebase

- [x] Delete the v1 Athena/table application, legacy-only tests, documentation, dependencies, and compatibility paths.
- [x] Keep npm publication disabled, remove the misleading post-release
      publisher, and retain v1 regression checks in the package gate.
- [x] Choose one app-manifest compiler and one canonical version 2 schema; delete the compatibility alternatives.
- [x] Choose one persisted-run implementation and delete the alternatives.
- [x] Make package metadata, version reporting, license metadata, tarball contents, release commands, environment names, and artifact names agree.
- [x] Remove the abandoned direct dependency graph and test-only packages from the runtime package.
- [x] Resolve the production dependency audit and make it a clean-install CI gate.
- [x] Expand CI to validate the package tarball, build a real generated-app SEA, invoke its activity and embedded operator manifest from a clean directory, and prove Node is unavailable on `PATH`.
- [x] Remove misleading lint exclusions and split source, application,
      repository-tool, and test type-check boundaries explicitly.

**Exit:** the README, shipped package, package gate, validation commands, and
current source describe the same v2 product; no Athena/v1 surface remains.

## Milestone 2 — one portable application

**Goal:** prove a normal CLI can become one self-contained application artifact without changing its programming model.

- [x] Define the minimal TypeScript application manifest around a developer-owned CLI and named activities.
- [x] Define the strict application/activity logical-ID contract plus exact target and external-package descriptors.
- [x] Define schemas and stable identifiers for immutable logical revisions, target-specific artifacts, and deployment profiles.
- [x] Compile one target-independent revision from the strict contract, dependency lock, Wharfie runtime, source, and behavior assets; consume a sealed application snapshot and audit the static bundled-module graph.
- [x] Keep build-only settings outside the runtime manifest and reject ActorSystem and scheduler public authoring until their contracts are designed. The strict v2 manifest now accepts only the bounded plain-data linear workflow contract from ADR 0019.
- [x] Preserve normal argv, stdio, exit codes, and CLI-library choice in local and packaged execution; the real relocated-SEA verifier compares difficult argv, raw stdin, independent stdout/stderr, and an application-selected nonzero exit code against source execution.
- [x] Content-address each final SEA executable, pair it with an immutable artifact-record sidecar, record exact Node/toolchain/target-closure/signing provenance, and expose embedded revision/runtime metadata through the operator CLI.
- [x] Make target packaging and revision-backed source execution consume and fail-check one frozen complete transitive external dependency closure, with semantic, archive, SEA-asset, and revision receipts that cannot drift independently.
- [x] Prove the frozen-closure artifact on a clean hosted Linux target: Ubuntu 24.04 packed the published tarball, generated and ran the Linux SEA with locked LMDB, and confirmed that Node was unavailable on `PATH`; reproducible builds are a later hardening goal.
- [x] Define a reserved, non-colliding dispatch mechanism for Wharfie operator commands inside an application-owned executable: `<app> wharfie <command>`.
- [x] Define and harden the versioned activity protocol, including strict serialization, cancellation, deadline, ordered-log, structured-error, host-effect, termination, and delivery-uncertainty boundaries, without requiring a second language implementation yet.
- [x] Route source and packaged SEA activity execution through that protocol with immutable revision identity, fresh local attempt identity, and revalidated bundle evidence. Both paths use a host-owned framed per-attempt worker transport with authenticated runner lifecycle messages, bounded cancellation/deadline termination, and late-frame rejection.
- [x] Delete manifest resource declarations, Function/ActorSystem runtime-injection lifecycle, the generic worker `exec`/RPC bridge, the shared-resource registry, and orphan queue/object-storage adapter layers. Caller metadata is inert JSON; public durable capability and effect APIs remain explicit separate contracts.
- [x] Reject runtime-computed native module paths and native-loader aliases at
      the prepared-revision boundary when the static bundle graph cannot prove
      their target.
- [x] Build one executable example and an end-to-end test from authored TypeScript through a clean generated-SEA execution.
- [x] Prove one real target-specific Node-API activity dependency from a moved Darwin SEA by opening, writing, and reading LMDB with Node absent from `PATH`; repeat the portable proof on hosted Linux above.
- [ ] Add signed Windows and Developer-ID-signed, notarized macOS release targets after the Linux release path is stable.

**Exit:** a TypeScript CLI runs locally, produces a content-addressed artifact, and runs on a clean machine without a preinstalled Node runtime.

## Milestone 3 — one durable node

**Goal:** let the packaged application remain resident and recover work after process or machine restart.

- [x] Decide and record that durable workflows use explicitly persisted state machines and continuations rather than replaying arbitrary application code, including timers, signals, cancellation, side effects, and revision changes.
- [x] Define the first finite workflow authoring contract in ADR 0019 and the
      strict v2 manifest: at most 64 ordered activity, timer, or signal steps;
      explicit workflow-input, earlier-step-output, or literal activity input;
      exact declared activity references; and no executable decider.
- [x] Define the append-only run → invocation → attempt → effect ledger, rebuildable projections, and state machines in ADR 0011.
- [x] Bind persisted manual runs, invocations, attempts, and terminal commits
      to one immutable revision; persist stable caller metadata separately from
      volatile physical-attempt evidence.
- [x] Build and prove the first isolated append-only ledger vertical: one manual
      activity with atomic event/head/projection/receipt writes, internally derived
      attempt identities, a durable `STARTED` boundary, full Protocol-v1 evidence
      validation, revision/fence checks, and conservative `UNCERTAIN` recovery.
- [x] Route one local manual `ops run` activity through that ledger, with an
      exact post-`STARTED` host frame, terminal evidence commits, idempotent
      request keys, and explicit operator-confirmed recovery only.
- [x] Add source-independent exact-run inspection and explicitly confirmed
      recovery, with redacted JSON output; remove the misleading mutable CLI
      `ops list` and direct-write `ops cancel` surfaces rather than
      dual-writing them.
- [x] Move the manual request envelope and complete terminal evidence to
      immutable, canonical local content references; rehash them before every
      ledger replay/read and fail closed on missing or altered content. V1
      ledger records are intentionally unsupported.
- [x] Build the source-level resident `ledger-service` lifecycle foundation:
      a stable per-app identity, scope/principal-bound durable local ownership
      CAS paired with fresh process-held session endpoints, fenced durable
      `STARTING` → `READY` → `STOPPING` → `STOPPED` records, and local-LMDB
      exclusion for mutating manual `ops run`/`ops recover`. That lifecycle
      foundation by itself deliberately did not schedule, claim, or execute
      work; the resident activity vertical below now composes it with one
      worker.
- [x] Prove Wharfie-owned, target-specific LMDB bytes in the durable local
      control store on hosted Linux. GitHub Actions run 29621495162 packed the
      installed tarball, started hidden `ledger-service` from a relocated SEA,
      preserved `READY` after `SIGKILL`, recovered a higher generation, and
      proved graceful `STOPPED` on `SIGTERM` with Node absent from `PATH`.
      Windows targets remain explicitly deferred pending a hardened
      private-extraction design.
- [x] Add a typed, redacted,
      atomically maintained per-service run-history directory and a bounded
      portable pagination primitive. Its internal API verifies every directory
      row against a rebuilt run projection; it deliberately does not create a
      ready-work queue or expose a source-only `ops list` command.
- [x] Separate durable activity submission from physical execution. Source
      `wharfie ops submit --dir ...` and packaged `<app> wharfie submit`
      append one exact app/revision-pinned manual request without claiming it.
      Submission uses the authenticated matching resident when available and a
      short-lived local owner when offline, so the same idempotent request can
      remain durably `RUNNABLE` until a worker starts.
- [x] Add the first single-node resident activity worker behind source
      `wharfie ops worker --dir ...`, packaged `<app> wharfie worker`, and the
      hidden packaged service runtime. It executes one attempt at a time,
      accepts only its exact app and immutable revision, and consumes the
      exact-revision ready-work projection only as a bounded locator: rebuilt
      ledger state plus the ordinary fenced claim remains execution authority.
      Restart
      recovery releases and reschedules a retained `CLAIMED` attempt that never
      started; a retained `STARTED` attempt becomes `UNCERTAIN` and is never
      redispatched automatically. When that attempt has unresolved managed
      effects, the resident reuses the source-free compound recovery path:
      `PENDING` siblings cancel without destination access, `STARTED` built-in
      application-state siblings are probed read-only, and the complete set
      settles atomically before the attempt blocks.
- [x] Extend the resident owner-command endpoint to authenticated exact-revision
      submission and exact-active-attempt cancellation. Graceful shutdown stops
      admission and new claims, durably enters `STOPPING`, waits for admitted
      handlers and gives an active attempt 30 seconds to finish naturally, then
      requests cooperative durable cancellation and retains ownership until
      it settles before recording `STOPPED`.
- [x] Split resident startup readiness so lifecycle remains `STARTING` until
      the authenticated owner-command socket is bound; a concurrent shutdown
      moves directly to `STOPPING` without publishing false readiness. Routed
      submission also raises only that authenticated endpoint's request bound
      to the ledger's 16 MiB payload ceiling while other commands retain the
      64 KiB default.
- [x] Replace the bounded run-history scan with a transactionally maintained
      exact app/revision ready-work index. V10 atomically creates, replaces, or
      removes `ACTIVITY` and `RECOVERY` rows with the ledger event, head, run,
      invocation, attempt, and directory projections. The resident rebuilds
      and verifies the named version/sequence/invocation/generation/attempt;
      the row never grants execution authority. The codec reserves `TIMER` and
      framework-only `CONTINUATION` rows for the workflow state machine.
- [x] Delete the superseded mutable Operation/Action graph, operation table,
      queue-run bridge, and second writable run model. Manual durable execution
      established the distinction between a caller idempotency key and the
      derived manual-run identity while writing only the then-current
      append-only V7 ledger. The current V10 authority retains that single
      append-only model in its fresh namespace.
- [x] Delete the disconnected pre-reset NodeAgent, state-command, systemd
      release, and private DB/queue/Lambda gRPC runtime island. Packaged apps
      now have one narrow private runtime-command selector, which starts the
      same resident activity service as the public worker command; future OS
      service installation will be rebuilt around that durable runtime rather
      than the removed supervisor.
- [x] Move exact-run inspection, confirmed recovery, and authenticated
      current-owner cancellation into one shared core operator layer. The source
      CLI mounts `wharfie ops inspect|recover|cancel`; a packaged artifact
      mounts `<app> wharfie inspect|recover|cancel`, lazily binds authority to
      its embedded app identity, rejects cross-app run IDs, and preserves
      redacted JSON. Inspection is read-only; recovery remains explicitly
      confirmed after a runner stops. Cancellation is an HMAC-authenticated,
      same-principal LMDB command to the exact live foreground or resident
      owner, never a direct-write fallback or a list/history scan.
- [x] Add the V4 durable cancellation boundary for foreground and authenticated
      external current owners. `ops run` persists intent before signalling its
      attempt; the external command requires a stable request ID and is fenced
      to the exact live session and `STARTED` attempt. It cannot directly cancel
      unstarted, inactive, stale, idle-resident, or different-active-run work.
      A started attempt requires matching terminal evidence, completion or
      failure can still win, and an unconfirmed post-cancellation termination
      becomes blocked `UNCERTAIN` work.
- [x] Add evidence-backed resolution for blocked `UNCERTAIN` manual attempts.
      One append-only V4 reconciliation event retains the physical attempt as
      `ABANDONED`, binds a fixed Activity Protocol verifier to the exact prior
      uncertainty event and immutable transcript, and establishes only the
      transcript-proven logical terminal. Source `wharfie ops reconcile` and
      packaged `<app> wharfie reconcile` require a stable reconciliation ID, a
      bounded evidence file, and explicit confirmation that every prior runner
      has stopped; they are source-free, app-scoped, fenced, and redacted.
- [x] Establish the internal V5 managed-effect truth boundary. A fresh ledger
      namespace persists invocation-scoped request, start, verifier-backed
      outcome, and blocked uncertainty transitions; immutable request/outcome
      references are rehashed on every fold, exact versioned destination
      verifiers run synchronously during every fold, response-loss retries never
      redispatch a retained `STARTED` effect, and attempt terminals cannot omit
      or invent effect state. V4 records and its V2 directory remain inert.
- [ ] Extend the manual ledger to workflow continuations, scheduling decisions,
      durable outputs, and the remaining operator actions.
- [ ] Implement leases, monotonic fencing tokens, heartbeats, retry policy,
      broader recovery, and multi-host authenticated current-owner command
      routing.
- [x] Connect the managed-effect driver to the framed source and SEA Activity
      Protocol worker boundary through one finite capability/adapter catalog.
      The first public request, `application-state` / `put-if-absent`, atomically
      commits its LMDB value and permanent receipt; source and packaged hosts
      share the same exact request and unavailable-host behavior.
- [x] Recover one retained built-in `STARTED` application-state effect under
      the held source/SEA LMDB owner without loading source or redispatching the
      adapter. An exact read-only receipt commits through the original effect
      fence before the stopped attempt becomes `UNCERTAIN`; strict receipt
      absence atomically makes the effect uncertain. Missing/corrupt stores,
      `PENDING`, and concurrent unresolved effects fail unchanged.
- [x] Advance the effect ledger to the fresh V7 namespace and atomically settle
      the complete bounded active-effect set for a confirmed stopped attempt.
      `PENDING` requests become terminal `CANCELLED` work without a destination
      probe; every `STARTED` sibling is probed read-only before one
      `attempt-became-uncertain` event commits all receipt-backed terminals,
      strict-absence uncertainty, and the aggregate block. Any unsupported,
      missing, corrupt, or over-limit set fails unchanged, and no recovery path
      can reach application or adapter execution code.
- [x] Exercise the V7 managed-effect path with externally delivered `SIGKILL`
      in real child processes and recovery from disk. The source/core durable
      run matrix covers request-payload publication, request-ledger commit,
      `STARTED` commit, the atomic destination business-and-receipt commit,
      outcome-payload publication, outcome-ledger commit, and the helper/host
      response before worker or user continuation. A separate mixed-set matrix
      covers recovered-outcome publication, the compound settlement commit,
      and the recovery-helper return before operator readback. The same eight
      single-effect and three mixed-set boundaries now run through the actual
      relocated SEA with Node absent from `PATH`. A separate oversized-response
      leg proves that committed packaged recovery remains idempotent when its
      output is blocked and the operator is killed and restarted.
- [x] Advance destination-finalized uncertain-effect reconciliation to the
      fresh V8 execution-ledger namespace, V6 run directory, and
      application-state V2 destination. A late verified receipt can append a
      `COMPLETED` or `FAILED` terminal, while an atomic destination-side
      negative closure can append `NOT_APPLIED`; the original physical attempt
      remains byte-identical `ABANDONED`, its invocation remains `UNCERTAIN`,
      and its run remains `BLOCKED`.
- [x] Expose that boundary through source `wharfie ops reconcile-effect` and
      packaged `<app> wharfie reconcile-effect`. Both commands require a
      stable reconciliation ID and explicit stopped-runner confirmation, use a
      reconciliation-only finite catalog, preserve app/store/ownership fences,
      and return only redacted lifecycle state. Response-loss replay never
      dispatches application code or the normal adapter.
- [x] Prove reconciliation through a relocated Darwin SEA with Node absent
      from `PATH`: a late receipt plus destination-finalized, orphan-payload,
      and ledger-response `SIGKILL` boundaries replay exactly, reuse the
      content-addressed orphan, recover the LMDB owner, and never dispatch the
      authored app/CLI/activity or normal adapter.
- [x] Define the V9 causally linked successor contract in ADR 0018: source
      authorization, framework-owned effect-only target creation, one
      stable application-scoped caller-supplied successor ID, and one causal retry slot
      commit atomically while the source attempt and effect remain unchanged.
- [x] Validate the internal hidden-fixture V9 successor matrix. The
      implementation accepts
      only an exact application-state V2 `put-if-absent` request after verified
      `NOT_APPLIED`, gives the target fresh run, invocation, effect,
      destination, attempt, and fence identities, and never loads or reruns the
      authored source handler. Its dedicated atomic start creates the sole
      attempt and effect together; generic claim, attempt, effect, terminal, and
      cancellation transitions reject the target. The Node-absent relocated-SEA
      matrix covers authorization, target-request payload, atomic start,
      destination commit, terminal-payload, and atomic-terminal SIGKILL/replay
      boundaries through a hidden test fixture using the real packaged command
      body, with no authored app, activity, or adapter dispatch. Exact final
      commands and exits are recorded in the V9 checkpoint and bound to
      `ab4e3ca6c2032a6207fb0b1f91cf07e8a0ba4ab8` and
      `a2a0618c05fefbc8968b0856cc176a2f47cb09c1`, including a separate-writer
      `already-present` receipt through terminal crash/replay.
- [x] Mount the exact source `wharfie ops retry-effect` and packaged
      `<app> wharfie retry-effect` surface. Source/package parity,
      response-loss replay, redaction, and the Node-absent relocated-SEA crash
      matrix prove the finite application-state V2 successor policy publicly.
- [ ] Decide the authority model for explicit, versioned forward-compensation
      plans—predeclared in an application revision only, or strict finite plans
      submitted after an incident by a trusted operator/LLM—before implementing
      or exposing compensation. Do not infer authority from replay-property
      labels, invent a generic inverse, delete application state, or rewrite the
      source effect as `COMPENSATED`.
- [ ] Provide transactional inbox/outbox behavior for Wharfie-managed state and queues, with destination-side deduplication committed atomically with consumer mutations where exactly-once processing is claimed.
- [ ] Support manual, cron, and workflow-triggered runs through one execution path.
- [ ] Install/uninstall the artifact as an OS-managed resident service, initially systemd, with startup on boot, health reporting, graceful shutdown/restart, and reboot recovery.
- [ ] Make service status, logs, run history, retry, cancel, approve, and effect reconciliation available as human-readable and JSON operations in the reserved operator namespace.
- [x] Build one shared source/packaged foreground durable-run host. Source
      `wharfie ops run` supplies a sealed prepared revision. The packaged
      command `<app> wharfie run` binds only its embedded manifest/revision/
      runtime identity and proved parity through the then-current V7 ledger,
      ownership, cancellation, application-state, managed-effect, and
      framed-worker path. The current source and packaged commands share the V10
      authority. A moved SEA with Node absent from `PATH` completed one managed
      effect, proved worker/user continuation after delivery, and replayed the
      exact key without changing its run, effect, or permanent receipt.
- [x] Repeat the complete activity crash matrix through the moved SEA with Node
      absent from `PATH`. Eight isolated single-effect cases cover request
      payload, request transaction, start transaction, atomic destination
      transaction, outcome payload, outcome transaction, host response, and
      authored continuation. Three isolated mixed-set cases cover recovered
      outcome payload, atomic aggregate settlement, and recovery-helper return.
      Every case uses real OS `SIGKILL`, exact payload/destination/ownership
      evidence, and guarded first/repeated packaged recovery with no adapter
      dispatch or low-level application-state write.

**Exit:** kill and restart the application at adversarial points; it reconstructs durable truth, never commits conflicting terminal outcomes, and exposes every ambiguous effect as blocked `uncertain` work.

## Milestone 4 — self-deployment and capability fulfillment

**Goal:** let an application create only the substrate it needs and operate itself on one remote node.

- [ ] Define only the minimum finite capability model needed by the golden path: nodes, application state, control state, artifact storage, runtime identity/secret references, networking, and optional ingress.
- [ ] Require control-state implementations to provide linearizable conditional writes, transactions, authoritative lease expiry, and fencing validation.
- [ ] Define the provider contract for `plan`, `apply`, `inspect`, `reconcile`, and `destroy`.
- [ ] Separate portable requirements from provider-specific deployment profiles.
- [ ] Implement local/external-host fulfillment and one cloud provider golden path.
- [ ] Use provider credential chains without embedding operator credentials.
- [ ] Record managed/external ownership, resource receipts, and narrowly scoped node identities.
- [ ] Make reconciliation and destroy idempotent and ownership-safe.
- [ ] Expose plan, deploy, inspect, destroy, and a quiescent single-node upgrade/rollback that refuses in-flight work in the reserved operator namespace; prove them in a clean account. In-flight and staged evolution remains Milestone 6 work.

**Exit:** one executable previews and creates a single-node durable service, survives the end of the authoring session, and later removes only what it owns.

## Milestone 5 — trusted mesh and coordinator recovery

**Goal:** distribute work across trusted nodes without making one machine irreplaceable.

- [ ] Define one-time enrollment, per-deployment authorization, authenticated/encrypted transport, replay protection, and node identity rotation/revocation.
- [ ] Advertise node capabilities and implement explicit placement constraints.
- [ ] Store coordination truth in a provider-backed linearizable durable store.
- [ ] Implement lease acquisition, renewal, and epoch increment as one linearizable conditional operation using store-authoritative expiry.
- [ ] Fence every scheduling decision and commit with the coordinator epoch, and every attempt with that epoch plus a per-invocation generation, so stale processes cannot have control-state mutations accepted.
- [ ] Reconstruct schedules and unfinished work from the ledger after coordinator replacement.
- [ ] Define worker-loss detection and safe attempt reassignment.
- [ ] Prove the two-node north-star workflow under worker loss, coordinator loss, partition/rejoin, and stale-leader attempts.

**Exit:** coordination and eligible work continue after any individual node loss while durable state and suitable remaining capacity exist; capability-constrained work pauses visibly, and stale coordinators or attempts cannot have Wharfie-managed or control-state commits accepted after replacement. Unmanaged external effects remain governed by the explicit ambiguity rules.

## Milestone 6 — safe evolution

**Goal:** make unattended software straightforward to understand and change across many coding sessions.

- [ ] Pin every run to an immutable revision and define explicit behavior for in-flight work during upgrades.
- [x] Make build-input and dependency-lock digests, target matrices, embedded revision/runtime metadata, and exact artifact provenance inspectable through package results, the operator metadata command, and canonical sidecars.
- [ ] Make builds reproducible where the selected packaging toolchain supports it, while always content-addressing the produced artifacts.
- [ ] Support staged rollout, health gates, rollback, and garbage collection of unreferenced revisions.
- [ ] Add schema/version migration contracts for durable application and control state.
- [ ] Expose a stable JSON protocol suitable for coding-agent operation and verification.
- [ ] Evaluate peer-quorum control state only after provider-backed failover is proven.

**Exit:** a later coding session can inspect why the service is in its current state, publish a new immutable revision, observe its rollout, and safely return to the prior revision.

## Immediate queue

Completed foundation: offline revision-pinned activity submission, a serial
resident worker, authenticated submit/cancel routing, conservative
`CLAIMED`/`STARTED` restart recovery, bounded graceful drain, and a
transactional exact-revision ready-work locator now share one source, packaged,
and hidden-service runtime. The public manifest also accepts the bounded linear
workflow definition from ADR 0019. This is not yet a durable workflow engine or
an installed operating-system service.

1. Define and implement one minimal durable workflow state machine: explicit
   continuations, persisted outputs, timers/signals, and revision-pinned resume.
2. Run that workflow through the resident worker's existing ready-work path,
   then install it startup-on-boot with health and reboot recovery.
3. Route manual and scheduled starts through the workflow execution path, then
   expose resident status, run history, logs, cancellation, and recovery through
   the reserved human/JSON operator surface.
4. Prove the resident workflow under adversarial process and machine restarts,
   including every managed-effect ambiguity boundary, before adding remote-node
   placement or coordinator failover.
5. Add the smallest provider-backed deployment path that can create, inspect,
   update, and remove one durable node using the operator's credential chain.

The current restart point is the [V10 ready-work checkpoint](llm/checkpoints/2026-07-19-v4-v10-ready-work.md). The preceding fully validated handoff is the [resident activity worker checkpoint](llm/checkpoints/2026-07-19-v3-resident-activity-worker.md). The preceding clean-install baseline is the [v2 foundation stabilization checkpoint](llm/checkpoints/2026-07-19-v2-foundation-stabilized.md). Accepted ADR [0018](docs/architecture/decisions/0018-causally-linked-managed-effect-successors.md) is the authority for the now-public V9 causally linked managed-effect successor. The [V9 managed-effect successor checkpoint](llm/checkpoints/2026-07-19-v9-managed-effect-successors.md) remains the historical pre-mount restart point. The preceding handoff is [V8 destination-finalized effect reconciliation](llm/checkpoints/2026-07-18-v8-destination-effect-reconciliation.md). Its parent [relocated-SEA mixed-settlement SIGKILL checkpoint](llm/checkpoints/2026-07-18-relocated-sea-mixed-settlement-sigkill-matrix.md) records the complete V7 packaged settlement crash surface; the [relocated-SEA managed-effect SIGKILL checkpoint](llm/checkpoints/2026-07-18-relocated-sea-managed-effect-sigkill-matrix.md) records the preceding eight packaged single-effect boundaries; the [shared packaged durable-run host checkpoint](llm/checkpoints/2026-07-18-shared-packaged-durable-run-host.md) records packaged activity origination; the [real-process managed-effect crash checkpoint](llm/checkpoints/2026-07-18-real-process-managed-effect-crash-matrix.md) records the source/core and compound-settlement crash matrices before packaged parity; the [V7 atomic effect-settlement checkpoint](llm/checkpoints/2026-07-18-v7-atomic-effect-settlement.md) records the historical compound-settlement state machine before real process-crash coverage; the [public application-state and receipt-recovery checkpoint](llm/checkpoints/2026-07-18-public-effects-and-receipt-recovery.md) records the finite public effect and first singular recovery boundary; the [V5 managed-effect foundation checkpoint](llm/checkpoints/2026-07-18-v5-managed-effect-foundation.md), [evidence-backed reconciliation checkpoint](llm/checkpoints/2026-07-18-evidence-backed-uncertain-reconciliation.md), [authenticated current-owner cancellation checkpoint](llm/checkpoints/2026-07-18-authenticated-current-owner-cancellation.md), [V4 durable-cancellation checkpoint](llm/checkpoints/2026-07-17-durable-cancellation-v4.md), [shared source/SEA ledger-operator checkpoint](llm/checkpoints/2026-07-17-shared-source-sea-ledger-operator.md), [resource-injection retirement checkpoint](llm/checkpoints/2026-07-17-resource-injection-retirement.md), [mutable Operation/Action retirement checkpoint](llm/checkpoints/2026-07-17-mutable-operation-retirement.md), [obsolete runtime checkpoint](llm/checkpoints/2026-07-17-obsolete-runtime-retirement.md), [V3 run-directory checkpoint](llm/checkpoints/2026-07-17-run-directory-index.md), [portable core control-store checkpoint](llm/checkpoints/2026-07-17-core-control-store-closure.md), [ledger-service lifecycle checkpoint](llm/checkpoints/2026-07-17-ledger-service-lifecycle.md), [ledger-v2 payload checkpoint](llm/checkpoints/2026-07-17-ledger-v2-payload-references.md), [source-independent operator checkpoint](llm/checkpoints/2026-07-17-source-independent-ledger-ops.md), [ledger-backed `ops run` handoff](llm/checkpoints/2026-07-17-ledger-backed-ops-run.md), and [hardening checkpoint](llm/checkpoints/2026-07-17-execution-ledger-hardening.md) record the work beneath it.
