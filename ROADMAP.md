# Wharfie roadmap

**Status:** product-outcome rebaseline

**Last updated:** 2026-07-28

Wharfie's roadmap now tracks three user-visible outcomes. Historical
implementation detail belongs in the
[checkpoints](llm/checkpoints/2026-07-27-v99-verified-sensitive-run-output.md)
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

- a TypeScript/Node application and operator model with strict manifests and
  immutable revisions;
- Node SEA packaging with content-addressed receipts and a reserved packaged
  operator namespace;
- a durable run, invocation, attempt, effect, workflow, timer, signal, and
  schedule ledger;
- an opt-in per-application coordinator-authority kernel co-located with that
  ledger, including monotonic epochs, stable-request receipts, deliberate
  confirmed takeover, diagnostic-only heartbeats, and a transaction-fence seam;
  production operator/resident assembly does not bind it yet;
- conservative cancellation, recovery, reconciliation, fencing, and managed
  effect semantics;
- source and packaged commands for durable submission, workers, history,
  redacted inspection, confirmed logs, and confirmed logical output;
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
  meaningful update, rollback, retained reads, uninstall, and host cleanup;
- a recoverable single-machine service lifecycle, now exercised by a
  [checksummed disposable-Ubuntu proof](llm/checkpoints/2026-07-28-systemd-lifecycle-proof.md)
  through install, automatic replacement, forced host restart, retained work,
  update, rollback, failed-target restoration, history/output reads,
  uninstall, prune, and host cleanup; and
- extensive AWS-shaped deployment contracts, resource drivers, and mock-based
  proofs.

That closes Outcome 1's bounded single-machine product proof. The focused
`steady-file` run did not repeat crash or reboot recovery; the separate
purpose-built service proof covers those substrate boundaries. The explicit
epoch-authority kernel proves that a bound ledger can reject stale writers, but
the production runtime does not bind it yet and neither run proves replacement
of a failed coordinator by another machine. The cloud deployment work has not
produced a successful clean-account end-to-end receipt.

## Outcome 1: a local CLI becomes a durable portable service

### User outcome

A developer writes and runs an ordinary TypeScript CLI. With small, explicit
Wharfie declarations, the same program can be packaged as one executable,
started as a persistent service, given durable work, restarted, inspected, and
updated without being rewritten around a hosted orchestrator, containers, or a
second application architecture.

### What is already concrete

- Authored argv remains application-owned; `<app> wharfie <command>` is the
  packaged operator surface.
- Manual activities, linear workflows, timers, signals, schedules, durable
  submission, cancellation, recovery, and selected managed effects exist.
- Source and packaged commands share durable receipts and read models.
- A manifest can name one default durable workflow and a pure CLI-argument
  adapter, so the happy path does not require a workflow ID or handwritten
  JSON input.
- Packaged artifacts can run without Node on the target command path.
- The local service lifecycle supports install, converge, restart, update,
  rollback, recover, status, prune, and uninstall.
- Operators can rediscover runs and explicitly disclose verified retained logs
  and logical outputs while ordinary inspection stays redacted.

### Work next

1. Keep the literal `steady-file` walkthrough as the regression gate for this
   outcome.
2. Carrying a returned run ID was visible friction but did not block the
   sequence. Change discovery or app-scope ergonomics only when real use
   demands it.
3. Add schedule, application state, broader workflow behavior, or more
   single-host service surface only when a concrete application needs it.

### Exit evidence

A checksummed clean Linux arm64 run now shows a developer can copy the example,
run it locally, package it, start it durably, install it, end the initiating
process, return in a different process to inspect exact history and logical
output, then update, roll back, uninstall, and clean up. The workflow happened
to complete before the initiating verifier ended, so this focused receipt does
not claim unfinished continuation across caller death; the installed service,
retained state, and later rediscovery did cross that process boundary.

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
- The execution-ledger integration is opt-in. Existing production operator and
  resident construction remains unbound, schedule-control has only its local
  owner fence, and application-state writes have no coordinator fence.
- Heartbeats are diagnostic only. No code infers authority expiry from process
  reachability, message silence, or a caller clock.
- Committed outcomes are distinct from physical dispatch. Managed effects can
  make stronger claims only when their destination enforces stable identity
  atomically with the mutation.
- Deployment and service activation have durable phase and recovery models.

### Work next

1. Bind the resident coordinator assembly to a freshly generated authority
   session, require its token for every authoritative execution-ledger writer,
   and expose deliberate takeover through an explicit operator path.
2. Close the same-table scheduling gaps: compose the authority fence into
   schedule-control mutations and carry the bound epoch in durable admission
   and scheduling history where that history claims coordinator provenance.
   Keep application-state writes outside the guarantee until they have a
   destination-local fence.
3. Define and implement a provider-certified semantic lease primitive with
   store-authoritative time and an atomic expiry predicate. Do not build
   automatic takeover from caller timestamps or diagnostic heartbeat age.
4. Use that primitive to add renewable authority and automatic epoch takeover
   without weakening the explicit same-table fence.
5. Rebuild runnable, in-flight, blocked, and terminal work from the ledger on
   replacement. Reassign only work whose replay contract permits it.
6. Add deterministic crash tests at lease acquisition, assignment, activity
   start, managed-effect settlement, and terminal commit.
7. Keep the mesh trusted and explicit: enroll nodes, authorize the application
   revisions each may run, advertise finite capabilities, place work only on a
   matching node, and fence every node lease.
8. After the local model is small and proved, run one two-node trusted recovery
   proof. Multi-active scheduling is not required.

### Exit evidence

Killing the coordinator at every durable boundary and starting a replacement
never creates two authoritative terminal outcomes, never lets a stale epoch
commit, never silently repeats unsafe work, and eventually resumes eligible
work. Only enrolled trusted nodes can accept permitted revisions under current
capability and lease authority. Loss of a worker or coordinator is visible and
operable from the same packaged CLI.

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
- Provider mutations are designed around explicit ownership, durable intent,
  conditional operations, readback, and conservative ambiguity recovery.
- Most evidence is currently mock-based. Some host and delivery proof harnesses
  exist, but no successful clean-account lifecycle is claimed.

### Work next

1. Cut the first public deployment profile to the minimum AWS resources needed
   to run the golden-path application on one node.
2. Expose one approachable sequence for credential check, plan, deploy, status,
   update, recovery, and destroy. Preview every mutation and distinguish owned
   resources from external references.
3. Bootstrap a narrowly scoped runtime identity and the exact packaged
   artifact; do not expose provider credentials to application components.
4. Connect node startup to the same durable service and operator experience
   proved locally.
5. Run a bounded clean-account proof, retain machine-readable receipts, and
   verify destroy removes only owned resources while honoring declared
   retention.
6. Delete or quarantine provider abstractions that do not help this one
   lifecycle before adding another provider or topology.

### Exit evidence

Given ordinary AWS credentials and a packaged golden-path application, a user
can preview and create one recoverable node, observe the application continue
there, inspect and update it through the executable, and destroy its owned
substrate without unexplained residue. The proof begins in a clean account and
ends with independently checked receipts.

## Immediate milestone: single-host developer preview

**Status:** in progress

This milestone productizes the already proved single-machine runtime. It does
not add another orchestration abstraction. An unfamiliar developer should be
able to start from a supported example, install a verified Wharfie package
tarball on a builder machine, produce one SEA, move only that application
artifact to a clean Linux host, and use the artifact itself to carry unfinished
work beyond the initiating shell.

### Exit evidence

One checksummed acceptance run must prove all of the following:

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

### Work

1. Promote `steady-file` from repository scratch space into the supported
   package, add the minimal starter metadata, and make package verification
   require it.
2. Replace contradictory reset-era onboarding with one short tarball → starter
   → SEA → service guide whose commands are checked against the mounted CLI.
3. Split the existing Linux walkthrough into builder and target boundaries and
   make unfinished work at initiating-process exit a required assertion.
4. Fix only friction or cleanup defects exposed by that literal journey, then
   cut the developer-preview artifact and receipt.

The supported starter, verified tarball handoff, canonical guide, unfinished
timer assertion, explicit app-data purge, and clean builder/target acceptance
harness are implemented. The remaining milestone gate is one successful
checksummed acceptance receipt with complete proof-owned cleanup.

The coordinator-authority kernel remains complete but intentionally unbound
while this milestone is active. Runtime-wide coordinator replacement,
provider-certified leases, multi-node placement, and cloud fulfillment resume
only after the single-host preview closes.

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
- additional providers, topology variants, or resource types before the first
  clean lifecycle works.

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
