# Wharfie roadmap

**Status:** project reset in progress · **Last updated:** 2026-07-17

This roadmap orders work by the shortest path to the experience in [PROJECT.md](PROJECT.md). It is intentionally willing to remove v1 behavior and break internal APIs. Each milestone should end in an executable proof, not only new abstractions.

## Working rules

- Optimize for the intended design; there are no known downstream users or compatibility requirements.
- Keep `master` recoverable and tests meaningful while deleting obsolete code aggressively.
- Prefer a narrow end-to-end path over parallel partial frameworks.
- Treat Node SEA as the first packaging backend, not the permanent public abstraction.
- Require explicit durable semantics at every network or side-effect boundary.
- Pause for review before broad destructive GitHub cleanup or a major public-model rewrite.

## Milestone 0 — preserve and reset

**Goal:** make the new direction durable before removing old work.

- [x] Inventory local and remote refs, pull requests, issues, tests, release wiring, and major implementation paths.
- [x] Preserve every live remote branch tip under annotated `archive/2026-07-16/remote/...` tags on GitHub.
- [x] Preserve the unpublished local `master` tip and old stash with local archive tags.
- [x] Write the project charter and non-goals.
- [x] Record the initial architecture decisions.
- [x] Store a dated restart checkpoint in the repository.
- [ ] Review and merge the reset documentation.

**Exit:** a fresh maintainer or coding session can explain what Wharfie is, what it is not, what state was preserved, and what work comes next.

## Milestone 1 — remove ambiguity and loose ends

**Goal:** leave one honest codebase and one honest tracker.

### Repository and tracker

- [x] Classify every legacy non-default branch and PR as keep, absorb, supersede, or delete; see the [cleanup inventory](docs/project-reset/2026-07-16-cleanup-inventory.md).
- [x] Reconcile the three unpublished local `master` commits and `jvd/pr4` against the new charter.
- [ ] Close stale PRs with a short preservation and supersession note.
- [x] Classify every open issue as roadmap work, useful research, or obsolete; see the [cleanup inventory](docs/project-reset/2026-07-16-cleanup-inventory.md).
- [ ] Create the proposed replacement issues, assign roadmap milestones, and close the old issues with preservation/supersession notes.
- [ ] Remove stale project-board, release, and documentation promises.

### Codebase

- [x] Delete the v1 Athena/table application, legacy-only tests, documentation, dependencies, and compatibility paths.
- [x] Keep npm publication disabled and retain v1 regression checks in the release gate.
- [x] Choose one app-manifest compiler and one canonical version 2 schema; delete the compatibility alternatives.
- [x] Choose one persisted-run implementation and delete the alternatives.
- [x] Make package metadata, version reporting, license metadata, tarball contents, release commands, environment names, and artifact names agree.
- [x] Remove the abandoned direct dependency graph and test-only packages from the runtime package.
- [ ] Resolve the current production audit findings and add an appropriate audit gate.
- [x] Expand CI to validate the package tarball, build a real generated-app SEA, invoke its activity and embedded operator manifest from a clean directory, and prove Node is unavailable on `PATH`.
- [ ] Make the remaining test, type-check, and lint exclusions explicit and temporary or remove them.

**Exit:** the README, shipped package, release workflow, CI, current source, and GitHub tracker all describe the same v2 product; no Athena/v1 surface remains.

## Milestone 2 — one portable application

**Goal:** prove a normal CLI can become one self-contained application artifact without changing its programming model.

- [x] Define the minimal TypeScript application manifest around a developer-owned CLI and named activities.
- [x] Define the strict application/activity logical-ID contract plus exact target and portable-resource descriptors.
- [x] Define schemas and stable identifiers for immutable logical revisions, target-specific artifacts, and deployment profiles.
- [x] Compile one target-independent revision from the strict contract, dependency lock, Wharfie runtime, source, and behavior assets; consume a sealed application snapshot and audit the static bundled-module graph.
- [x] Keep build-only settings outside the runtime manifest and reject ActorSystem, workflow, and scheduler public authoring until their contracts are designed.
- [ ] Preserve normal argv, stdio, exit codes, and CLI-library choice in local and packaged execution.
- [x] Content-address each final SEA executable, pair it with an immutable artifact-record sidecar, record exact Node/toolchain/target-closure/signing provenance, and expose embedded revision/runtime metadata through the operator CLI.
- [ ] Make target packaging consume and fail-check one frozen complete transitive external dependency closure, then prove the resulting artifact on a clean Linux target; reproducible builds are a later hardening goal.
- [x] Define a reserved, non-colliding dispatch mechanism for Wharfie operator commands inside an application-owned executable: `<app> wharfie <command>`.
- [ ] Define the versioned activity protocol and test its serialization, cancellation, deadline, log, error, and host-effect boundaries without requiring a second language implementation yet.
- [ ] Define an explicit declaration or rejection rule for runtime-computed module paths that cannot be proven by the static bundle graph.
- [x] Build one executable example and an end-to-end test from authored TypeScript through a clean generated-SEA execution.
- [ ] Prove one real target-specific Node-API activity dependency from a moved SEA; do not treat text fixtures with a `.node` suffix as native-addon evidence.
- [ ] Add signed Windows and Developer-ID-signed, notarized macOS release targets after the Linux release path is stable.

**Exit:** a TypeScript CLI runs locally, produces a content-addressed artifact, and runs on a clean machine without a preinstalled Node runtime.

## Milestone 3 — one durable node

**Goal:** let the packaged application remain resident and recover work after process or machine restart.

- [ ] Decide and record whether durable workflows use deterministic replay or an explicitly persisted state-machine/continuation model, including timers, signals, cancellation, side effects, and revision changes.
- [ ] Define the run → invocation → attempt → effect ledger and state machines.
- [x] Bind current persisted operation snapshots, claims, retries, cancellation, and result commits to one immutable revision; persist stable user activity context separately from volatile delivery-attempt metadata.
- [ ] Persist immutable revision bindings, inputs, outputs, scheduling decisions, attempts, and operator actions in the full append-only ledger.
- [ ] Implement leases, monotonic fencing tokens, heartbeats, cancellation, retry policy, and recovery.
- [ ] Implement substantiated `pure`, `idempotent`, and `transactional` replay properties, make begun in-process handlers `unsafe` by default, and add a durable blocked `uncertain` state with explicit reconciliation/compensation paths.
- [ ] Provide transactional inbox/outbox behavior for Wharfie-managed state and queues, with destination-side deduplication committed atomically with consumer mutations where exactly-once processing is claimed.
- [ ] Support manual, cron, and workflow-triggered runs through one execution path.
- [ ] Install/uninstall the artifact as an OS-managed resident service, initially systemd, with startup on boot, health reporting, graceful shutdown/restart, and reboot recovery.
- [ ] Make service status, logs, run history, retry, cancel, approve, and effect reconciliation available as human-readable and JSON operations in the reserved operator namespace.
- [ ] Prove recovery with deterministic crash tests at each commit boundary.

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

1. Publish the reconciled cleanup inventory, open the umbrella draft PR, and execute the archived PR/branch/issue cleanup decisions.
2. Make SEA external installation consume and fail-check one frozen complete transitive dependency closure.
3. Run the current content-addressed stack through the clean Linux SEA proof in hosted CI, then prove argv/stdio/exit behavior and one real target-specific Node-API dependency.
4. Decide the durable workflow model and define the run → invocation → attempt → effect ledger before adding schedules or workflows.

The latest dated handoff at [llm/checkpoints/2026-07-17-immutable-identity-spine.md](llm/checkpoints/2026-07-17-immutable-identity-spine.md) contains exact repository state and restart instructions.
