# Wharfie roadmap

**Status:** The strict single-node deployment protocol now has an exact
credential-bound AWS authority, retained DynamoDB/control-bucket lifecycles,
portable control records, recovery-safe executable staging, and
freshness-bounded provider-visible service health under focused mocks. Its
exact SSM/EC2 provider-spec resolver now freezes and validates one admissible,
available AL2023 image; the fixed driver, commands, and clean-account proof are next ·
**Last updated:** 2026-07-21

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
- [x] Bound stale packaged-core native extraction after abrupt termination.
      The private parent scopes UID/host authority and versioned roots carry
      boot/namespace/PID/process-start claims; live or uncertain owners are
      preserved, positively dead roots are removed eight at a time before new
      extraction, and oversized scans fail closed for inspection rather than
      doing unbounded startup work.
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
      exact app/revision ready-work index. Ready-work V2 atomically creates, replaces, or
      removes `ACTIVITY` and `RECOVERY` rows with the ledger event, head, run,
      invocation, attempt, and directory projections. The resident rebuilds
      and verifies the named version/sequence/invocation/generation/attempt;
      the row never grants execution authority. The codec reserves `TIMER` and
      framework-only `CONTINUATION` rows for the workflow state machine.
- [x] Add the first activity-headed workflow-run boundary: immutable plan and
      start payloads, stable run/plan/continuation/invocation identities, one
      rebuildable `ACTIVITY_RUNNABLE` cursor, and one atomic
      `workflow-run-created` transaction containing the event, receipt, head,
      run, cursor, invocation, directory entry, and cursor-bound ready-work V2
      row. Exact replay, conflicting races, failed transactions, projection
      corruption, repair, and native LMDB reopen fail or converge explicitly.
- [x] Add cursor-guarded workflow activity claim/start and one compound verified
      success transition. A complete Activity Protocol transcript is the only
      source of logical output; the V10 transaction terminalizes the current
      attempt/invocation, advances the output-bearing cursor, and creates one
      exact runnable activity successor or completes the run while replacing
      or removing ready work. Replay is receipt-event anchored, and adapter
      matrices prove stale authority, conditional races, payload/write failure,
      ready-row corruption, output tampering, and real LMDB reopen behavior.
- [x] Add cursor-guarded workflow activity recovery. A retained `CLAIMED`
      attempt that never started remains as abandoned physical history while
      its logical activation returns to `ACTIVITY_RUNNABLE`; a retained
      `STARTED` attempt becomes `ACTIVITY_UNCERTAIN`, blocks the run, and loses
      all ready-work authority. Exact completed evidence can reconcile that
      blocked activation without rewriting its `ABANDONED` attempt, atomically
      creating one activity successor or completing the workflow. Adapter
      races, payload/transaction failures, projection and payload tampering,
      replay, and native LMDB close/reopen are covered.
- [x] Route exact workflow `ACTIVITY` and `RECOVERY` rows through the resident
      worker. The host re-derives the plan from the immutable embedded
      manifest before claiming, persists `STARTED` before invoking the exact
      activity frame, and commits only verified `completed`, `failed`, or
      `protocol-failed` terminals. Restart releases only an unstarted claim;
      a retained or interrupted started attempt becomes blocked uncertainty
      and is never redispatched. Shutdown stops admission immediately, retains
      a bounded physical drain, and does not expose manual cancellation or
      managed-effect authority to workflow attempts.
- [x] Mount shared source `wharfie ops start` and packaged `<app> wharfie start`
      commands for bounded activity, timer, and signal plans. Stable
      idempotency keys converge across resident-routed and offline short-owner
      starts, including activity-, timer-, and signal-headed materialization.
      Extend generic exact-run inspection, confirmed recovery, and evidence
      reconciliation to workflow trigger/cursor state; preserve response-loss
      replay against the original uncertainty event.
- [x] Prove the public workflow path across real process death. Five source
      `SIGKILL` cases cover offline start-response loss, a committed `CLAIMED`
      attempt, `STARTED` before authored dispatch, the compound first-step
      terminal/successor commit, recovery-response loss, and
      reconciliation-response loss. The relocated SEA repeats the required
      claim/start/terminal/recovery/reconciliation boundaries through public
      packaged commands with Node absent from `PATH`, and additionally proves
      that a source-created workflow is byte-identically replayed and completed
      by the moved artifact. Only the logical activation recovered from an
      unstarted claim may be redispatched in a fresh generation; started work
      blocks, and the completed evidence in this matrix advances one successor
      without rewriting or redispatching the abandoned attempt.
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
- [x] Add cursor-aware run-level workflow cancellation. Runnable and claimed
      activations terminalize without authored dispatch; a started activation
      persists intent before exact-owner delivery; uncertain work retains a
      no-continuation fence without claiming a physical outcome. Verified
      `cancelled` evidence requires that exact prior authority, while success and
      failure races preserve their proven terminal evidence and never create a
      successor after cancellation wins.
- [x] Extend the workflow ledger from ordinary activity continuations to
      persisted timer and current-wait signal decisions. The resident fires
      exact due `TIMER` rows as framework work without Activity Protocol
      dispatch. Shared source `wharfie ops signal` and packaged
      `<app> wharfie signal` require stable delivery IDs, accept only the
      current declared wait, retain exact accepted/rejected replay, and record
      explicit `early-signal`, `unexpected-signal`, or `late-signal`
      rejections without an early-signal inbox. Schema-v7 inspection exposes
      redacted timer, signal-wait, and signal-delivery lifecycle state.
      Branches, scheduled starts, and managed-effect workflow successors remain
      unsupported.
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
- [x] Implement packaged Linux systemd user-service install/update/rollback/recover/start/stop/restart/status/uninstall with fixed-unit rendering, immutable releases, PID-bound durable health, graceful drain, retry-safe uninstall, and preserved state.
- [x] Give every packaged application one immutable app-scoped local-storage
      layout under `<wharfie-data>/applications/<appId>` before any developer,
      operator, or hidden-runtime entrypoint runs. Foreground commands and the
      systemd resident now share that exact ledger, payload, session, and
      application-state authority. The packaged data root is anchored to the
      operating-system account instead of ambient `XDG_DATA_HOME` or `HOME`,
      and service management rejects explicit overrides that would split it.
- [x] Fix the systemd integration point to the service account's
      `~/.config/systemd/user`, reject invocation-specific XDG topology, and
      verify the live manager's `UnitPath` plus exact effective fragment before
      enable, stop, or uninstall can act on a unit name.
- [x] Reconcile exact orphaned systemd wiring explicitly: status joins receipt
      intent with verified disk and live-manager state. A missing receipt,
      selector, or fixed unit is repaired only from exact durable activation
      authority; physical wiring without that authority is degraded and never
      adopted for execution. Uninstall remains the narrow cleanup path for
      exact orphans, tombstones, and interrupted cleanup while refusing
      cached-only, conflicting, foreign, or lower-priority unit claims.
- [x] Add one crash-recoverable local activation coordinator. Update and
      rollback close admission transactionally, prove every durable run
      terminal on both sides of the resident stop, switch only exact immutable
      releases, retain one rollback candidate, restore a failed target's
      source, and resume interrupted durable phases with `service recover`.
      First install has no source: queued target-revision work is
      admitted, while foreign-revision nonterminal work leaves activation
      pending and fenced. The fixed unit is enabled without starting, and only
      the durable `ACTIVATING` target—or the narrow draining-source exception
      in `QUIESCING`—may cross the service-start fence.
- [x] Integrate activation with the packaged manager and operator receipts.
      Update runs from the new target SEA; a fresh rollback runs from the
      currently selected SEA. An ambiguous rollback is resolved with
      `service recover`, not a new reverse transition. Results separate
      fulfilled/refused/failed/pending request status from target-active,
      source-retained, source-restored, in-flight, and absent outcomes.
- [x] Preserve the durable `ACTIVE` selection, rollback reference, and
      same-revision run admission across state-preserving uninstall. The
      installation tombstone and immutable releases remain; installing the
      same selected release rehydrates physical service wiring without
      changing activation record version or selection generation. The
      intentional-uninstall tombstone also authorizes a new artifact to
      reproject and prove the exact retained source before performing the
      normal durable update under the same operation lock. Unexplained missing
      projection state remains fail-closed and requires repair from the exact
      selected SEA.
- [x] Prove enabled startup, crash replacement, and durable recovery across a
      real machine reboot in a disposable Linux systemd environment. The
      checksummed [V16 proof receipts](llm_artifacts/systemd-proof/0d92746384acae1aa111a271ff144f9bcf53d265/final.json)
      bind an installed-package Linux arm64 SEA to commit `0d927463`, replace
      its systemd `MainPID` after `SIGKILL`, force-stop and restart the VM,
      observe a new kernel boot ID and generation before any login session,
      complete the same persisted timer/signal workflow, exercise graceful
      restart and stop/start, and prove uninstall preserves inspectable state.
      These receipts predate public update/rollback and do not prove activation
      crash recovery on a real systemd host.
- [x] Prove two-release activation and failed-target source restoration on a
      real disposable systemd host. The checksummed [V18 proof
      receipts](llm_artifacts/systemd-proof/939e0f251db97189d9f003048570bd29cabc5165/final.json)
      bind three distinct installed-package Linux arm64 SEAs to commit
      `939e0f2`. Exact source-mapped post-commit breakpoints cover update and
      rollback at `QUIESCING`, `QUIESCENT`, `SELECTED`, `ACTIVATING`, and
      committed `ACTIVE`, plus all five source-restoration writes after a
      target exits cleanly before readiness. Every killed operator recovers
      through the public SEA command; stale ambiguous rollback retry is
      refused, exact source bytes and health are restored, and durable state
      remains preserved through uninstall.
- [x] Make service status available as human-readable and JSON operations in the reserved packaged operator namespace.
- [ ] Add logs, run history/listing, and any remaining operator surfaces that are still deliberately absent.
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

- [x] Establish the strict V2 single-node AWS profile, deployment revision,
      credential-derived provider scope, owned-resource binding, inspection,
      deterministic plan, durable head, and provider-neutral crash-resumable
      controller contracts. A deterministic fake proves stale-plan refusal,
      CAS races, response-loss recovery, and exact final inspection without
      claiming that cloud resources exist.
- [x] Bind exact deployment-head, plan, and profile envelopes to an explicit
      portable DB table with one String partition key, strong reads,
      conditional immutable inserts, and full-record head CAS writes.
- [x] Resolve one immutable ordinary-chain AWS credential snapshot for an
      explicit region, verify its partition and account through STS, and issue
      narrow data/control capabilities from that same non-serialized snapshot.
- [x] Add read-only admission and explicit bootstrap for the fixed retained
      DynamoDB control table: exact scope/schema/tags, on-demand standard class,
      deletion protection, AWS-owned encryption, disabled TTL, and 35-day
      point-in-time recovery. Focused mocks prove transitional reads and lost
      create/update response recovery; a live-account proof remains open.
- [x] Introduce the fresh provider contract and plan/inspection namespaces that
      pin the exact regional AMI receipt, bootstrap and runtime-policy digests,
      instance/metadata shape, storage, network, and health timing. Only a new
      incarnation resolves mutable prerequisites; converge and recovery use the
      content-addressed provider specification already embedded in the plan.
- [x] Add the retained, versioned S3 control bucket and immutable artifact-stage
      intent/object-version receipt protocol. Converge hashes and streams the
      running SEA through one held descriptor only after persisting intent,
      requires exact SHA-256/SSE/metadata/version readback before accepting the
      plan, and recovery revalidates that exact retained version without local
      historical bytes. Bucket bootstrap rejects bucket policies, waits the
      documented first-enable propagation interval, then proves versioned
      object-write readiness before staging.
- [x] Add the host-owned provider-visible service-health receipt and conditional
      current S3 object protocol. The receipt binds provider/deployment/node,
      operation/head lineage, exact release, resident session and generations,
      process, and positive per-session sequence; only a fresh S3
      `LastModified` observation may make `win3` healthy or finally converged.
      The exact `health/v1/` lifecycle makes only noncurrent versions eligible
      for asynchronous expiration after one day. Deterministic mocks prove
      this boundary, not a privileged host observer, real driver, or live
      resource.
- [x] Implement the credential-bound AWS provider-spec resolver and validator.
      Only a new incarnation may resolve the architecture-specific AL2023
      public parameter's latest value. Converge validates the pinned positive
      parameter version and exact AMI again without selecting a newer default;
      bounded retries retain one frozen candidate and strict SSM/EC2 evidence
      classifies missing, contradictory, and unresolved reads separately.

- [x] Define only the minimum finite capability model needed by the golden path: nodes, application state, control state, artifact storage, a narrow runtime identity, networking, and no ingress or application-secret surface.
- [ ] Require control-state implementations to provide linearizable conditional writes, transactions, authoritative lease expiry, and fencing validation.
- [ ] Define the provider contract for `plan`, `apply`, `inspect`, `reconcile`, and `destroy`.
- [ ] Separate portable requirements from provider-specific deployment profiles.
- [ ] Implement local/external-host fulfillment and one cloud provider golden path.
- [x] Use provider credential chains without embedding operator credentials.
- [ ] Record managed/external ownership, resource receipts, and narrowly scoped node identities.
- [ ] Make reconciliation and destroy idempotent and ownership-safe.
- [ ] Expose provider-backed plan, deploy, inspect, and destroy in the reserved
      operator namespace and prove them in a clean account. In-flight and
      staged multi-node evolution remains Milestone 6 work.

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

- [x] Pin every run to an immutable revision and refuse local release changes
      while any run is nonterminal; in-flight evolution remains future work.
- [x] Make build-input and dependency-lock digests, target matrices, embedded revision/runtime metadata, and exact artifact provenance inspectable through package results, the operator metadata command, and canonical sidecars.
- [ ] Make builds reproducible where the selected packaging toolchain supports it, while always content-addressing the produced artifacts.
- [ ] Support staged rollout, health gates, rollback, and garbage collection of unreferenced revisions.
- [ ] Add schema/version migration contracts for durable application and control state.
- [ ] Expose a stable JSON protocol suitable for coding-agent operation and verification.
- [ ] Evaluate peer-quorum control state only after provider-backed failover is proven.

**Exit:** a later coding session can inspect why the service is in its current state, publish a new immutable revision, observe its rollout, and safely return to the prior revision.

## Immediate queue

Completed foundation: offline revision-pinned manual activity submission, a
serial resident worker, authenticated submit/cancel routing, conservative
`CLAIMED`/`STARTED` restart recovery, bounded graceful drain, and a
transactional exact-revision ready-work locator share one source, packaged, and
hidden-service runtime. The public manifest accepts ADR 0019's bounded linear
workflow. The core ledger now materializes and atomically advances activity,
timer, and current-wait signal activations on one workflow cursor and run head.
Direct and reconciled `failed` and `protocol-failed` activity terminals
preserve the prior output prefix and create no output, successor, or ready row.
The resident dispatches exact manifest-bound `ACTIVITY` rows, recovers
`RECOVERY` rows without redispatching lost started work, and fires due `TIMER`
rows as framework work without entering Activity Protocol. Shared source and
packaged `start` commands persist the complete finite plan. Shared source and
packaged `signal` commands require stable delivery IDs and accept only the
current declared wait; exact accepted or rejected requests replay, while
early, unexpected, and late signals are durably rejected without an inbox.
Generic schema-v7 `inspect`, confirmed `recover`, and evidence-backed
`reconcile` expose or mutate the exact workflow cursor without leaking signal
payloads or internal references. Generic `cancel` accepts workflow runs with a
stable request identity: it terminalizes unstarted work, records intent before
signaling an exact active attempt, or fences blocked uncertainty against later
continuation. Matching cancelled evidence can reconcile only when the retained
attempt itself carries that prior request; deadline evidence remains
unsupported.

Real source-process and relocated-SEA crash matrices now prove that the public
workflow path preserves those rules across process death, lost command
responses, resident generation takeover, persisted timer firing, current-wait
signal consumption, and evidence-backed continuation. The moved artifact
completes the linear workflow proof with Node unavailable on `PATH`.

The packaged Linux service path is also proven outside the developer session.
An installed npm tarball built three application SEAs in a fresh Ubuntu 24.04
VM, persisted workflow work before service installation, verified the exact
effective unit and immutable executable, recovered from resident `SIGKILL`
and an abrupt VM power cycle, and then exercised 15 exact durable activation
crash boundaries. Update, rollback, committed-response loss, clean target
exit, source restoration, and stale retry refusal all converged through public
packaged commands before uninstall preserved the completed ledger. The current
checksummed receipts are bound to commit `939e0f2`; the earlier V16 reboot-only
receipts remain bound to `0d927463`.

The regional provider specification now has a concrete credential-bound
SSM/EC2 resolver and exact-version validator. Together with the retained
artifact-stage version and host-owned freshness-bounded health protocol, its
complete pre-driver authority is pinned or durably evidenced under
deterministic mocks.

1. Implement the fixed AWS driver as independently recoverable resource
   capabilities, then compose it, the retained table/bucket, artifact stager,
   health boundary, and strict controller recovery protocol. Mount source and
   packaged `plan`, `apply`, `inspect`, `reconcile`, and `destroy` commands,
   requiring apply and reconcile to re-observe the currently running SEA.
2. Install and wire the privileged host observer outside the application UID,
   then prove the complete lifecycle in a clean account through the user's
   ordinary credential chain, including interruption and response-loss
   recovery.
3. Begin provider-backed coordinator recovery only after the single-node
   service lifecycle and control-store fencing are proven outside a developer
   session.

The current restart point is the [exact AWS provider-spec resolution
checkpoint](llm/checkpoints/2026-07-21-v25-exact-aws-provider-spec-resolution.md).
Its parent is the [provider-visible service-health
checkpoint](llm/checkpoints/2026-07-21-v24-provider-visible-service-health.md),
whose parent is the [recovery-safe artifact-staging
checkpoint](llm/checkpoints/2026-07-20-v23-recovery-safe-artifact-staging.md),
whose parent is the [pinned AWS provider-spec
checkpoint](llm/checkpoints/2026-07-20-v22-pinned-aws-provider-spec.md), whose
parent is the [AWS deployment-control
checkpoint](llm/checkpoints/2026-07-20-v21-aws-deployment-control.md), whose
parent is the [recoverable deployment-controller
checkpoint](llm/checkpoints/2026-07-20-v20-recoverable-deployment-controller.md),
whose parent is the [bounded packaged-runtime extraction
checkpoint](llm/checkpoints/2026-07-20-v19-bounded-runtime-extraction.md), whose
parent is the [real-host activation proof
checkpoint](llm/checkpoints/2026-07-20-v18-real-host-activation-proof.md), whose
parent is the [recoverable systemd activation
checkpoint](llm/checkpoints/2026-07-20-v17-recoverable-systemd-activation.md),
whose parent is the [systemd reboot-proof
checkpoint](llm/checkpoints/2026-07-20-v16-systemd-reboot-proof.md), whose parent
is the [shared packaged-storage
checkpoint](llm/checkpoints/2026-07-20-v15-shared-packaged-storage.md), whose
parent is the [systemd user-service foundation
checkpoint](llm/checkpoints/2026-07-20-v14-systemd-user-service-foundation.md),
whose parent is the [workflow timers and signals
checkpoint](llm/checkpoints/2026-07-20-v13-workflow-timers-signals.md), whose
parent is the [workflow cancellation
checkpoint](llm/checkpoints/2026-07-19-v12-workflow-cancellation.md), whose
parent is the [workflow crash-recovery
checkpoint](llm/checkpoints/2026-07-19-v11-workflow-crash-recovery.md), whose
parent is the [public workflow operator
checkpoint](llm/checkpoints/2026-07-19-v10-public-workflow-operator-surface.md),
whose parent is the [resident workflow activity dispatch
checkpoint](llm/checkpoints/2026-07-19-v9-resident-workflow-activities.md), whose
parent is the [workflow activity failure
checkpoint](llm/checkpoints/2026-07-19-v8-workflow-activity-failures.md), whose
parent is the [workflow activity recovery
checkpoint](llm/checkpoints/2026-07-19-v7-workflow-activity-recovery.md). The
earlier workflow lineage continues through the [activity continuation
checkpoint](llm/checkpoints/2026-07-19-v6-workflow-activity-continuations.md),
[activity-headed workflow-start
checkpoint](llm/checkpoints/2026-07-19-v5-activity-headed-workflow-start.md),
[V10 ready-work checkpoint](llm/checkpoints/2026-07-19-v4-v10-ready-work.md),
[resident activity worker
checkpoint](llm/checkpoints/2026-07-19-v3-resident-activity-worker.md), and [v2
foundation stabilization
checkpoint](llm/checkpoints/2026-07-19-v2-foundation-stabilized.md).

Accepted ADR [0018](docs/architecture/decisions/0018-causally-linked-managed-effect-successors.md)
is the authority for the public V9 causally linked managed-effect successor.
Its history begins at the [V9 managed-effect successor
checkpoint](llm/checkpoints/2026-07-19-v9-managed-effect-successors.md) and links
back through the effect, SEA crash-recovery, ledger, operator, and control-store
checkpoints recorded there.
