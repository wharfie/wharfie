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
  from runtime `PATH`;
- a recoverable single-machine service lifecycle, now exercised by a
  [checksummed disposable-Ubuntu proof](llm/checkpoints/2026-07-28-systemd-lifecycle-proof.md)
  through install, automatic replacement, forced host restart, retained work,
  update, rollback, failed-target restoration, history/output reads,
  uninstall, prune, and host cleanup; and
- extensive AWS-shaped deployment contracts, resource drivers, and mock-based
  proofs.

That closes the single-host service-substrate gate, but it is not yet the
complete product proof. The purpose-built systemd fixture must now give way to
one literal `steady-file` walkthrough through the default durable handoff and
the proven service lifecycle. Automatic replacement of a failed coordinator
by another machine is not proved. The cloud deployment work has not produced a
successful clean-account end-to-end receipt.

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

1. Run one literal `steady-file` walkthrough through the proven service
   substrate: ordinary CLI, default durable start, package, install, close the
   initiating shell, return for history and output, update, rollback,
   uninstall, and cleanup. Add no abstraction unless this sequence exposes a
   real blocker.
2. Reduce the remaining returned-run and app-scope friction only when the
   walkthrough demonstrates that it blocks the obvious command sequence.
3. Add schedule, application state, or broader workflow behavior only when the
   golden application has a real need for it.

### Exit evidence

From a fresh checkout, a developer can author or copy the example, run it
locally, package it, start it durably, close the initiating shell, return later
to inspect its exact history and logical result, then update and roll it back.
The documented happy path is short enough to understand without reading the
ledger or deployment internals.

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
- Committed outcomes are distinct from physical dispatch. Managed effects can
  make stronger claims only when their destination enforces stable identity
  atomically with the mutation.
- Deployment and service activation have durable phase and recovery models.

### Work next

1. Define the smallest coordinator state machine: identity, renewable lease,
   monotonic epoch, admission decision, assignment, and settlement.
2. Put coordinator authority in one linearizable durable-store adapter. Do not
   infer authority from process liveness or messages.
3. Carry epoch and invocation generation through every coordinator-issued
   assignment and authoritative commit; reject stale values at storage.
4. Rebuild runnable, in-flight, blocked, and terminal work from the ledger on
   replacement. Reassign only work whose replay contract permits it.
5. Add deterministic crash tests at lease acquisition, assignment, activity
   start, managed-effect settlement, and terminal commit.
6. Keep the mesh trusted and explicit: enroll nodes, authorize the application
   revisions each may run, advertise finite capabilities, place work only on a
   matching node, and fence every node lease.
7. After the local model is small and proved, run one two-node trusted recovery
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

## Immediate slice status

Do not add another numbered roadmap tranche. The portable golden path, one real
Darwin native/SEA observation, and the disposable Linux/systemd service
substrate are concrete. The remaining slice is to join them into one literal
user-facing `steady-file` walkthrough:

1. `steady-file` compares two file observations for a useful local shell
   decision;
2. its durable workflow exposes a retained result after a delayed continuation;
3. its hermetic proof closes and reopens portable control storage at the timer
   boundary;
4. the exact source and packaged operator sequences completed through native
   LMDB and a relocated SEA in the separate checksummed Darwin observation;
5. schema v4 now maps its ordinary file argument through a pure declared
   adapter, selects the durable workflow, and generates a unique start identity
   by default;
6. a checksummed disposable Ubuntu run now proves deliberate replacement,
   forced reboot, automatic pre-login startup, durable continuation, update,
   rollback, failed-target restoration, uninstall, prune, and cleanup; and
7. the literal golden application must traverse that substrate before more
   coordinator or provider machinery is added.

The preferred result is less framework surface and one compelling
demonstration, not another broad layer of abstractions.

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
