# Wharfie roadmap

**Status:** product-outcome rebaseline

**Last updated:** 2026-08-28

Wharfie's roadmap now tracks three user-visible outcomes. Historical
implementation detail belongs in the
[checkpoints](llm/checkpoints/2026-08-26-coordinator-readiness-systemd-proof.md)
and [architecture decisions](docs/architecture/decisions/README.md), not in an
ever-growing sequence of numbered tranches.

The product thesis remains:

> A normal TypeScript CLI can become a portable, durable service that carries
> its author's intent beyond a laptop or coding session, while remaining easy
> to inspect and evolve.

The [project charter](PROJECT.md) defines the product model and boundaries.
Breaking changes are expected. There are no downstream users to preserve, so
we should delete accidental complexity whenever it obstructs the shortest path
to the intended experience.

## Current truth

The repository has substantial foundations:

- a TypeScript/Node application and operator model with strict manifests,
  immutable revisions, and a compact `defineApp({ id, main })` authoring path;
- Node SEA packaging with content-addressed receipts and a reserved packaged
  operator namespace;
- exact compatible-host inference for targetless manifests, with a human-first
  package handoff by default and the unchanged v1 receipt behind `--json`;
- a durable run, invocation, attempt, effect, workflow, timer, signal, and
  schedule ledger;
- a per-application coordinator-authority kernel co-located with that ledger,
  including monotonic epochs, stable-request receipts, deliberate confirmed
  takeover, diagnostic-only heartbeats, and transaction fencing now bound into
  the local resident, direct durable-submission fallback, foreground
  durable-activity paths, standalone mutating ledger operators, and resident
  schedule-control writes; source and packaged operators can inspect an exact
  predecessor and explicitly fence-and-release it for a fresh resident;
- an accepted single-Region, non-global DynamoDB replacement profile in
  [ADR 0037](docs/architecture/decisions/0037-single-region-dynamodb-rvn-coordinator-replacement.md):
  receiptless exact RVN renewal, strong observation across a local monotonic
  window, exact-CAS epoch takeover, and the existing same-transaction stable
  tuple fence; its exact-client topology guard, internal resident supervisor,
  deterministic races, and disposable-table provider proof pass;
- per-application high-water barriers in the separate application-state store,
  adopted by writable runtime catalogs and checked in each effect transaction;
  a resumable control-side primary-store pin now gates resident scheduling,
  commands, and READY on exact destination adoption; protection still starts
  at destination adoption, not control-store takeover;
- conservative cancellation, recovery, reconciliation, fencing, and managed
  effect semantics;
- source and packaged commands for durable submission, workers, history,
  redacted inspection, confirmed logs, and confirmed logical output;
- a named packaged foreground workflow command that can be gracefully
  interrupted and resumed by repeating the same invocation. After abrupt
  process death, an exact retained coordinator inspection and explicit
  confirmed takeover-and-release must come before that same invocation can
  reopen the run; direct packaged activity execution lives under `activity run`;
- one `WHARFIE_DATA_ROOT` for every packaged durable store and lazy native
  runtime preparation that keeps ordinary application argv on the light path;
- the `steady-file` golden-path application and a hermetic proof of ordinary
  CLI execution, sealed source preparation, durable activity/timer/activity
  continuation across a control-store reopen, and verified retained output,
  with a schema-v4 default that maps the ordinary file argument into durable
  workflow input,
  plus a
  [checksummed Darwin observation](llm/checkpoints/2026-07-28-steady-file-native-sea-proof.md)
  of the real source LMDB resident and generated relocated SEA with Node absent
  from runtime `PATH`, and a
  [checksummed disposable-Ubuntu walkthrough](llm/checkpoints/2026-07-28-steady-file-systemd-walkthrough.md)
  of the literal packaged start, systemd install, later-process rediscovery,
  meaningful update, rollback, retained reads, uninstall, and host cleanup,
  now superseded as the acceptance gate by the
  [split builder/clean-target developer preview](llm/checkpoints/2026-07-29-single-host-developer-preview.md),
  which proves unfinished work across controller exit, explicit app-data
  purge, and complete proof-owned cleanup;
- a recoverable single-machine service lifecycle, now exercised by a
  [checksummed current-policy Ubuntu proof](llm/checkpoints/2026-08-26-coordinator-readiness-systemd-proof.md)
  through install, fail-closed automatic startup after process and VM loss,
  explicit takeover-and-release, destination-adoption readiness, retained
  work, all fifteen update/rollback/source-restoration crash cases,
  history/output reads, uninstall, prune, and complete owned-host cleanup;
  two additional actual packaged-resident kills prove both partial-handoff
  stages with the fixed systemd unit stopped; and
- packaged AWS and Hetzner single-node read-only preview and status plus
  apply/update/recover/exec/destroy commands, recoverable provider mutations,
  automated recovery proofs, and live packaged
  apply/activate/adopt/restart/destroy proofs with independent owned-resource
  cleanup. Journal-bound `exec` reaches only the exact active remote application
  through pinned SSH, although that command has not yet received a new
  live-provider proof.

That closes Outcome 1's bounded single-machine product proof. The split
`steady-file` run carried the same waiting durable timer across two controller
processes; it did not repeat crash or reboot recovery. The separate current
service proof verifies explicit recovery after actual process loss and a forced
VM reboot; the earlier automatic-recovery proof is historical. The epoch-authority
path now fences the selected production local execution-ledger writers, stamps new
physical assignments with the bound epoch, and leaves a crashed active
authority unavailable until an operator performs an exact inspected takeover.
The operator immediately releases its temporary successor so a fresh resident
session can acquire normally. Standalone mutating ledger operators and resident
schedule-control writes now share this fence. Application-state writes use a
separate destination-local barrier; atomic handoff across the two stores and
automatic resident takeover remain unsupported. The accepted DynamoDB RVN
profile now supplies a validated bounded path to automatic epoch replacement
and an internal resident authority lifecycle, but has no product activation,
reconstruction, or multi-node recovery proof. A
local resident now adopts its one
configured, history-verified application-state destination before replacement
readiness, with durable interrupted-handoff progress and exact publication
fences. This does not prove recovery after loss of either volume.
These local proofs do not establish replacement by another machine.
The cloud deployment work now proves a bounded
credentialed lifecycle through healthy guest service and independently
verified owned-resource cleanup on AWS and Hetzner. The broader ADR 0035
acceptance artifact remains partial.

Historical validation on this host included two complete two-worker coverage
runs that exceeded different unchanged five-second fixture deadlines; both
failed suites passed alone. A later complete serial coverage run passed all
7,508 active tests under unchanged deadlines and normal thresholds. Those
observations remain useful history, but they are superseded for the current
tree: `npm run test:ci` passed 328 active suites and 7,578 active tests in
755.272 seconds, with 1 suite and 5 tests skipped under the existing policy.
Coverage passed at 84.06% statements, 80.89% branches, 91.45% functions, and
84.79% lines; the package verifier accepted 364 package files and the production
audit reported 0 vulnerabilities. The isolated same-token race regression
passed all 15 tests. The locally packed magnetic proof passed explicit inspected
takeover, and Darwin SEA verification passed at 155,538,992 bytes with SHA-256
`1e085d1f20b43e6bdfef481beef54d26fff4f236b97fc7d9e7ba2ac385265cf2`.

## Outcome 1: a local CLI becomes a durable portable service

### User outcome

A developer writes and runs an ordinary TypeScript CLI. With small, explicit
Wharfie declarations, the same program can be packaged as one executable,
started as a persistent service, given durable work, restarted, inspected, and
updated without being rewritten around a hosted orchestrator, containers, or a
second application architecture.

### Experience quality bar

The implemented surface in the
[magnetic first-run experience](docs/product/magnetic-first-run.md) defines the
teaching sequence for this outcome. A deliberately tiny canonical application
answers "What is a Wharfie application?" A separate polished showcase answers
"Why Wharfie?" by packaging ordinary JavaScript, interrupting durable work after
one committed step, retaining an exact coordinator inspection after the abrupt
exit, explicitly confirming takeover-and-release, and then resuming from the
standalone artifact without repeating that step or its original timer. The
versioned copied-starter gate hides its disposable builder, then exercises
relocation, Node-absent execution, abrupt process death, the operator safety
step, exact-command resumption, and a later-process verified output read against
Wharfie's packed npm tarball. A bare repeat never replaces an ACTIVE resident.
The locally packed candidate gate now passes that exact inspection/takeover
journey. Release acceptance remains open until the same gate passes against the
published preview. The target remains one obvious journey that finishes in
under two minutes after prerequisites, with experimental machinery outside the
beginner path.

### What is already concrete

- Authored argv remains application-owned; `<app> wharfie <command>` is the
  packaged operator surface.
- Manual activities, linear workflows, timers, signals, schedules, durable
  submission, cancellation, recovery, and selected managed effects exist.
- Source and packaged commands share durable receipts and read models.
- A manifest can name one default durable workflow and a pure CLI-argument
  adapter, so the happy path does not require a workflow ID or handwritten
  JSON input.
- `defineApp({ id, main })` expands the smallest ordinary CLI into the strict v4
  manifest while the explicit form remains available.
- A targetless package request selects one exact host artifact and defaults to
  a human phase/target/path/size/`Next:` handoff; scripts opt into `--json`.
- Packaged `wharfie run --name <name> -- <args>` starts or reopens the default
  durable workflow, hosts or follows it in the foreground, and drains without
  cancellation on interruption. Direct activity execution is `activity run`.
- Packaged storage derives from one `WHARFIE_DATA_ROOT`, and ordinary argv
  avoids native durable-runtime preparation.
- Packaged artifacts can run without Node on the target command path.
- The local service lifecycle supports install, converge, restart, update,
  rollback, recover, status, prune, and uninstall.
- Operators can rediscover runs and explicitly disclose verified retained logs
  and logical outputs while ordinary inspection stays redacted.

### Work next

1. Run the versioned magnetic copied-starter gate against the published
   preview package.
2. Reduce the beginner-path weight: the versioned gate currently installs 205
   npm packages and produces a 148.5 MiB Darwin arm64 artifact.
3. Keep the split builder/clean-target `steady-file` acceptance proof as the
   regression gate for this outcome.
4. Preserve the irreducible canonical hello-world app and keep failure probes,
   provenance mechanics, and experiments in the labeled playground.
5. Add schedule, application state, broader workflow behavior, or more
   single-host service surface only when a concrete application needs it.

### Exit evidence

A checksummed clean Linux arm64 run now shows a developer can install the
starter from a tarball on one builder, run it locally, package it, transfer
only the SEA handoff to a clean no-Node target, start it durably, and install
it. The initiating controller exits while the workflow timer is still waiting;
a different controller observes that same timer, then inspects exact history
and logical output after service completion. The same run updates, rolls back,
uninstalls, purges app data, preserves the external SEAs, and removes all
proof-owned VMs and caches.

## Outcome 2: a failed coordinator can be safely replaced

### User outcome

The initial system has one authoritative coordinator at a time. That process
or machine may disappear. A replacement can reconstruct durable truth, acquire
a newer epoch, resume safe work, and leave ambiguous external work blocked for
explicit reconciliation. Stale coordinators cannot commit after replacement.

### What is already concrete

- Run and effect truth is append-only and reconstructable outside an individual
  activity process.
- Local ownership, generations, fences, conservative restart recovery, durable
  cancellation, and reconciliation already protect single-machine execution.
- One current coordinator-authority record per application is co-located with
  the execution ledger. Exact conditional transitions protect initial
  acquisition, heartbeat, release, and deliberate confirmed takeover;
  takeover increments the epoch and stale authority tokens cannot commit
  mutations through an authority-bound ledger.
- Local resident construction, direct durable-submission fallback, and
  foreground durable-activity execution acquire a fresh authority and bind the
  execution ledger for their lifetime. Manual, workflow, and managed-effect
  successor assignments carry the bound epoch.
- All five direct mutating execution-ledger operator scopes acquire fresh
  authority after any required local ownership. Read-only preflight and
  cancellation routed to a live owner do not acquire competing authority.
- Resident schedule activation, cursor-only advancement, and occurrence/run
  admission use the exact ledger token. Prepared admissions cannot cross to
  an unbound or differently bound ledger; combined transactions contain one
  authority check, alongside the existing local-owner and activation fences.
  The observer checks currentness even on no-work passes, while transactional
  fencing remains the safety boundary; low-level unbound store construction
  remains available.
- Writable application-state catalogs explicitly adopt the exact ledger token
  in their separate destination. Fresh identity/bootstrap and every new value,
  receipt, and negative resolution are locally fenced. This implementation's
  unbound writers cannot mutate an adopted namespace. Exact retained
  dispositions remain read-only across epochs. Operator reconciliation and
  successor retry pin the retained destination identity before adoption.
  This is not an atomic control/destination handoff or retroactive fencing of
  old binaries; upgrade cutover requires stopped legacy writers.
- Local resident startup inventories all verified run history, including
  terminal effects and authorization-only successor targets, and pins one
  configured application-state/primary identity. Genuine first use and
  interrupted pre-adoption recovery may retain PREPARING before ADOPTED. Once
  ADOPTED exists, it remains the confirmed floor: the resident advances the
  destination first and then transitions exact ADOPTED directly to ADOPTED,
  never back through PREPARING. Scheduling and command handling start only
  after adoption; READY atomically compares the exact ADOPTED record and
  current coordinator alongside its lifecycle fence. Cleanup never rolls back
  a destination barrier. Foreground and operator writable bindings reject
  PREPARING and carry the ADOPTED floor. The floor check accepts the exact floor
  or a structurally valid strictly higher current barrier. Known missing,
  rolled-back, or replaced foreground stores fail read-only before durable
  STARTED.
- Source `ops coordinator` and packaged `wharfie coordinator` commands expose
  non-authoritative exact inspection plus explicitly confirmed
  takeover-and-release. Takeover compares the complete inspected ACTIVE
  snapshot; the temporary successor is released with a deterministic request
  identity so a normal fresh resident can acquire afterward.
- Actual SIGKILL at both partial destination-handoff boundaries preserves the
  immutable primary pin and retained history. The current single-host VM
  proof also observes automatic crash/reboot startup failing closed before
  explicit takeover, then exact adopted readiness under a fresh coordinator.
  Both stores and one trusted control lineage survive; no volume-loss or
  automatic multi-node recovery is implied.
- Heartbeat timestamps are diagnostic only. No code infers authority expiry
  from process reachability, message silence, or a caller clock. A committed
  heartbeat RVN advance does restart ADR 0037's exact-snapshot observation.
- [ADR 0037](docs/architecture/decisions/0037-single-region-dynamodb-rvn-coordinator-replacement.md)
  defines the first provider-specific automatic-replacement profile. It is
  limited to one single-Region, non-global DynamoDB transaction domain. An
  unchanged exact RVN across a local monotonic window is only a failure
  detector; exact-CAS epoch takeover and the stable-tuple condition in every
  protected transaction are the safety boundary. Implementation validation
  and the live proof pass. An explicit internal resident supervisor now binds
  topology proof to the exact immutable data client, pins all traffic to its
  full table ARN and TableId, requires one provisioning-retained opaque
  resource identity across participants, renews through drain, performs
  observation-backed takeover, and fails closed on authority loss. Product
  activation and reconstruction remain pending.
- Committed outcomes are distinct from physical dispatch. Managed effects can
  make stronger claims only when their destination enforces stable identity
  atomically with the mutation.
- Deployment and service activation have durable phase and recovery models.

### Work next

Durable coordinator admission provenance is now decided and implemented by
[ADR 0036](docs/architecture/decisions/0036-durable-coordinator-admission-provenance.md).
New bound manual, workflow, scheduled-workflow, and managed-effect-successor
admissions retain their stable authority token; legacy and unbound history
remains explicitly unattributed. Version 10 admission epochs remain zero.

ADR 0037's provider primitive, deterministic race matrix, and live disposable-
table proof are complete. The proof retained exact topology, race, fencing,
successor-commit, checksum, and cleanup evidence in the
[August 27 checkpoint](llm/checkpoints/2026-08-27-dynamodb-rvn-coordinator-replacement.md).
The follow-on
[August 28 resident-supervisor checkpoint](llm/checkpoints/2026-08-28-resident-dynamodb-authority-supervisor.md)
retains the exact-client construction, lifecycle race, live two-supervisor,
checksum, and cleanup evidence.

The bounded internal lifecycle slice is complete. It deliberately did not
lift the current LMDB-only resident and submission gates.

1. Rebuild runnable, in-flight, blocked, and terminal work from the ledger on
   replacement. Reassign only work whose replay contract permits it.
2. Integrate the supervisor around that reconstructed dispatcher, durably
   retain and distribute the provisioned DynamoDB `tableResourceId`, decide
   the separate application-state handoff boundary, and only then lift the
   explicitly configured DynamoDB resident gate.
3. Add deterministic crash tests at renewal, takeover, assignment, activity
   start, managed-effect settlement, and terminal commit.
4. Keep the mesh trusted and explicit: enroll nodes, authorize the application
   revisions each may run, advertise finite capabilities, place work only on a
   matching node, and fence every node lease.
5. After the provider and reconstruction models are small and proved, run one
   two-node trusted recovery proof. Multi-active scheduling is not required.

### Exit evidence

Killing the coordinator at every durable boundary and starting a replacement
never creates two authoritative terminal outcomes, never lets a stale epoch
commit, never silently repeats unsafe work, and eventually resumes eligible
work. A deliberately premature DynamoDB suspicion may replace a live process,
but its delayed fenced transaction is rejected after the exact epoch takeover.
Only enrolled trusted nodes can accept permitted revisions under current
capability and authority-renewal policy. Loss of a worker or coordinator is
visible and operable from the same packaged CLI.

## Outcome 3: Wharfie can fulfill the narrow cloud substrate it needs

### User outcome

A packaged application can use credentials supplied through a provider's
normal credential chain to preview, create, inspect, update, and destroy the
nodes and resources required by Wharfie abstractions. The user does not first
write a separate infrastructure project.

This is capability fulfillment, not general cloud infrastructure as code.
Application-specific databases, networks, and provider services remain in
application code or external IaC unless they become a deliberate Wharfie
capability.

### What is already concrete

- AWS-shaped specifications, ownership bindings, plans, inspections, actions,
  resource drivers, retained storage, artifacts, runtime identity, node
  bootstrap, and service-health contracts exist.
- A self-deployable SEA can apply or recover the bounded single-node substrate
  on AWS or Hetzner, then destroy it from exact durable local authority.
  Credentials come only from the ordinary AWS chain or ambient
  `HCLOUD_TOKEN`; they are not CLI arguments.
- The same SEA can first perform a zero-write, point-in-time preview that
  validates ambient access and separates selected external references from
  managed resource roles and semantic apply steps. The
  [packaged preview checkpoint](llm/checkpoints/2026-07-30-packaged-deployment-preview.md)
  records both live provider proofs and cleanup.
- The same SEA can read one existing deployment with
  `<app> wharfie deployment status --deployment-instance <id> [--data-root <absolute>] [--json]`.
  Status derives the provider from durable journal authority and joins that
  journal with an exact provider observation and pinned guest service status.
  It creates and mutates nothing, and its app-scoped read is not bound to the
  outer SEA's current revision. The
  [packaged status checkpoint](llm/checkpoints/2026-07-30-packaged-deployment-status.md)
  records the receipt and no-write boundaries.
- The same SEA can execute ordinary application or packaged operator argv on
  the exact active guest artifact with `deployment exec`. The command re-proves
  journal, SSH, bootstrap, artifact, and service authority without provider
  credentials or a generic remote shell. The
  [packaged exec checkpoint](llm/checkpoints/2026-07-31-packaged-deployment-exec.md)
  records the boundary and automated evidence.
- A new SEA can update an active deployment to its authenticated embedded Linux
  release without revisiting provider state. Journal schema v3 keeps committed
  current release authority until target activation is fully proven, retains
  one rollback release, and records one crash-recoverable install or update
  transition. `deployment recover` resumes the exact journal-selected apply,
  update, repair, or destroy action without accepting a provider or mode
  selector; the committed-current SEA can reconverge current and abandon a
  permanently failed target. Remote wrapper storage is bounded to current,
  rollback, and target. The
  [packaged update/recovery checkpoint](llm/checkpoints/2026-07-31-packaged-deployment-update-recovery.md)
  records the contract and automated crash-boundary evidence.
- AWS reuses a qualifying default-VPC public-network path; Hetzner uses its
  public network. The current node root disk holds application and control
  data, so destroy is deliberately data-destructive.
- Provider mutations are designed around explicit ownership, durable intent,
  conditional operations, readback, and conservative ambiguity recovery.
- Both provider paths have focused automated ambiguity/recovery coverage and
  one live packaged apply/activate/adopt/restart/destroy proof with independent
  owned-resource cleanup. The
  [two-provider checkpoint](llm/checkpoints/2026-07-29-two-provider-self-deployment-scope.md)
  records both the result and the remaining ADR 0035 evidence gap.
- Repeated default packaging now reproduces the exact self-deployable operator
  SEA bytes on the pinned builder. The
  [reproducibility checkpoint](llm/checkpoints/2026-07-30-sea-packaging-reproducibility.md)
  records the failure, fixes, final nested-artifact proof, and signing boundary.

### Work next

1. Complete the remaining ADR 0035 evidence in one repeatable, redacted
   two-provider harness, including live packaged preview, packaged remote
   durable work, guest audit, reboot, fault injection, and bounded proof
   receipts.
2. Add authenticated journal checkpoint/epoch rollover before treating one
   coordinator as indefinitely evolving; v3 currently reserves terminal
   records for recovery and destruction, then refuses further updates.
3. Decide and implement an explicit retained-data capability before making any
   durability claim beyond the current root-disk lifecycle.
4. Delete or quarantine provider abstractions that do not help this one
   lifecycle before adding another provider or topology.

### Exit evidence

Given ordinary AWS credentials or a Hetzner token and a packaged golden-path
application, a user can preview and create one recoverable node, observe the
application continue there, inspect and update it through the executable, and
destroy its owned substrate without unexplained residue. The proof begins in a
clean provider scope and ends with independently checked receipts.

## Immediate milestone: single-host developer preview

**Status:** complete — 2026-07-29, proof commit `39be8d6`

This milestone productizes the already proved single-machine runtime. It does
not add another orchestration abstraction. An unfamiliar developer should be
able to start from a supported example, install a verified Wharfie package
tarball on a builder machine, produce one SEA per application revision, move
only the packaged application handoff to a clean Linux host, and use the
artifacts themselves to carry unfinished work beyond the initiating shell.

### Accepted exit evidence

The [checksummed acceptance run](llm/checkpoints/2026-07-29-single-host-developer-preview.md)
proves all of the following:

1. the Wharfie npm tarball contains a supported starter application and is
   installed into a clean builder workspace without using a repository
   checkout as runtime authority;
2. the starter runs as an ordinary CLI and packages as one SEA on the builder;
3. only the packaged application handoff is copied to a separate clean Linux
   target where its command and installed service do not depend on Node;
4. the packaged application admits useful durable work, installs its systemd
   user service, and the initiating process exits while that work is still
   nonterminal;
5. the service finishes eligible work, and a later process rediscovers the run
   and reads its verified logical output;
6. a meaningful second revision updates the service, rollback restores the
   first revision, and retained reads survive both;
7. uninstall plus an explicit documented cleanup path removes all
   preview-owned service state and immutable artifacts; and
8. the proof removes its builder, target, caches, package tarballs, and SEA
   build output while retaining only small checksummed receipts.

### Completed work

1. Promoted `steady-file` from repository scratch space into the supported
   package, added the minimal starter metadata, and made package verification
   require it.
2. Replaced contradictory reset-era onboarding with one short tarball →
   starter → SEA → service guide whose commands are checked against the
   mounted CLI.
3. Split the existing Linux walkthrough into builder and target boundaries and
   made unfinished work at initiating-process exit a required assertion.
4. Fixed the friction and cleanup defects exposed by that literal journey and
   cut the developer-preview receipt.

The supported starter, verified tarball handoff, canonical guide, unfinished
timer assertion, explicit app-data purge, and clean builder/target acceptance
harness are implemented and accepted at commit `39be8d6`. The retained
builder, prepare, final, cleanup, and checksum receipts prove the complete
sequence and proof-owned cleanup.

The single-host preview is closed. The coordinator-authority kernel and its
bounded local runtime, direct operator, and resident scheduling adoption are
complete. Application state now has its own destination-local barrier and
ordered, resumable adoption before READY, with actual partial-handoff process
kills and explicit single-host crash/reboot recovery proved. Admission
provenance is now retained for new bound logical admissions without changing
version 10 attempt fencing or public history. ADR 0037 selects a bounded
single-Region DynamoDB RVN replacement primitive; its validation and live
proof pass. Its internal resident supervisor now passes, while reconstruction,
product activation, and multi-node replacement are the active Outcome 2 work.
Cross-store atomicity, multi-Region DynamoDB, and
arbitrary destination sets remain outside the supported primary-store protocol.
Outcome 3 has a bounded
two-provider lifecycle proof, while its complete redacted acceptance harness,
retained-data capability, and journal epoch rollover remain open.

## Explicitly not now

- compatibility with Wharfie v1 or incidental reset-era APIs;
- a general cloud IaC engine;
- trustless or Byzantine mesh behavior;
- zero-interruption or multi-active coordinator HA beyond single-active
  replacement;
- a web UI before the CLI contract is excellent;
- a public multi-language application framework;
- a hosted Wharfie control plane requirement;
- arbitrary physical exactly-once execution; or
- additional providers, topology variants, or resource types without an
  explicit capability decision after the bounded two-provider proof.

TypeScript/Node remains the public authoring and orchestration boundary.
Target-specific Node bindings, Node-API modules, WASI/WASM, or persistent
subprocess workers may serve measured hot paths behind a versioned boundary.
That escape hatch should not make Wharfie responsible for compiling arbitrary
language ecosystems.

Wharfie does require one authoritative committed outcome per invocation and
strong managed-effect semantics where a destination can substantiate them.
When physical execution is ambiguous, the honest abstraction is durable
uncertainty plus reconciliation—not a blanket exactly-once claim.

## Roadmap discipline

- Each outcome advances through an executable user-visible proof.
- New abstractions must remove a demonstrated blocker in one of the three
  outcomes.
- Historical receipts and implementation details go in checkpoints, ADRs, and
  tests.
- Privileged, native, Docker, systemd, block-device, or cloud proofs remain
  explicit gates and must clean their exact temporary or remote resources.
- A failed proof should shrink or correct the design before the roadmap grows.
