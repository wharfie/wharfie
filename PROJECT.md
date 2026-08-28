# Wharfie project charter

**Status:** active project reset · **Last updated:** 2026-07-28

## One sentence

Wharfie is a local-first TypeScript application runtime that turns an ordinary CLI into a portable executable, then lets that same application become a durable, observable service across trusted machines without an architectural rewrite.

## Why Wharfie exists

LLMs make it cheap to express intent as working local software. They do not make that software durable, deployable, observable, or safe to evolve. A useful program often ends with the coding session that created it, or has to be rewritten around containers, infrastructure definitions, schedulers, and a hosted control plane before it can continue unattended.

Wharfie closes that authoring-to-operation gap. It carries an operator-approved program beyond a laptop or chat session by preserving concrete, inspectable state:

- immutable application revisions;
- declared activities, workflows, schedules, and runtime capabilities;
- durable run and invocation state;
- attempts and externally visible effects;
- deployment, ownership, and node state; and
- operator decisions such as approvals, retries, upgrades, and rollbacks.

Wharfie does not preserve an abstract "will" or a chat transcript. It preserves executable behavior and the legible history required to understand and evolve that behavior.

## North-star experience

A developer should be able to:

1. Write a normal TypeScript CLI and run it locally with ordinary argv, stdio, and exit semantics.
2. Mark named operations as durable activities and compose them into workflows or schedules.
3. Package the application as one approachable executable that does not require Node, a container runtime, Kubernetes, or a hosted orchestration service on the target machine.
4. Give that executable credentials through a provider's normal credential chain and preview the narrow runtime substrate it needs.
5. Deploy it as a persistent service, close the laptop, and let the declared work continue.
6. Return later with the same executable to inspect revisions, runs, attempts, effects, logs, and node health; intervene when necessary; and upgrade or roll back explicitly.
7. Add trusted nodes when placement, capacity, or recovery requires them.

Local and single-node operation require no external Wharfie control plane. The distributed design fences explicit coordinator replacement with a linearizable durable authority record. Automatic replacement additionally requires a provider-certified semantic lease with store-authoritative expiry. A later mesh milestone—not the initial product proof—will validate worker and coordinator recovery across two nodes.

## Product model

- **Application:** the developer-owned CLI plus its declared operational behavior.
- **Revision:** an immutable logical version of application behavior, configuration, and locked inputs. A revision owns target-specific artifacts, and runs pin the revision.
- **Artifact:** a content-addressed executable or component payload for one target that belongs to a revision. "One executable" means one file for the selected target, not one binary that runs on every platform.
- **Activity:** a named, serializable unit of work. This is the durable execution and placement boundary.
- **Workflow:** durable coordination of activity invocations.
- **Run:** one requested or triggered execution of application behavior.
- **Invocation:** one logical activity execution within a run, stable across retries.
- **Attempt:** one physical execution of an invocation under a lease and fencing token.
- **Effect:** an operation routed through Wharfie's managed effect API, recorded under a stable identity with declared and substantiated replay properties. It can be pure or externally visible.
- **Node:** a trusted machine enrolled in a deployment and authorized to run its permitted application revisions.
- **Coordinator:** the holder of the application's current durable epoch authority that schedules and reconciles work. Automatic replacement will additionally require a renewable semantic lease.
- **Capability:** a portable resource, property, or semantic guarantee that a node or deployment can provide and an application or activity can require, such as application state, fenced control state, artifact storage, ingress, identity, or a hardware feature. Placement constraints are predicates over advertised capabilities.
- **Deployment:** the binding between an application revision, a deployment profile, fulfilled capabilities, and enrolled nodes.

These are the public concepts. Existing build-resource abstractions and provider helpers are private implementation material to reuse only where they support this model cleanly.

## Scope

Wharfie should provide:

- a TypeScript/Node authoring and control-plane model;
- a normal local CLI experience before any deployment is required;
- portable application executables, currently built by the npm-distributed Node
  toolchain with Node SEA; a standalone self-hosting builder remains future work;
- durable single-node execution with an inspectable run, invocation, attempt, and effect ledger;
- schedules, workflows, retries, cancellation, intervention, and recovery;
- a trusted-node mesh with explicit enrollment, capability-aware placement, and fenced leases;
- one authoritative, epoch-fenced coordinator initially, with durable state outside its process, deliberate confirmed replacement, and a path to automatic recovery;
- capability fulfillment for the finite substrate required to run Wharfie applications;
- standard plan, deploy, inspect, upgrade, rollback, and destroy operations under an explicit reserved operator namespace that cannot silently take over developer CLI commands; and
- machine-readable CLI output so humans, scripts, and coding agents can operate the same system.

The packaged command contract reserves one top-level word: `<app> wharfie
<command>`. Wharfie strips that word and dispatches the remainder to its bundled
operator CLI. Every other argv sequence belongs to the developer CLI, including
the old internal names `ctl`, `func`, and `infra`. Environment-selected bootstrap
is internal service wiring and takes precedence over interactive argv.

## Deliberate boundaries

Wharfie is not:

- a continuation of the v1 Athena/table framework;
- a general cloud infrastructure-as-code system;
- a trustless, Byzantine, or internet-scale peer-to-peer mesh;
- a hosted orchestration service requirement;
- a general multi-language application framework or build system;
- an agent framework, prompt store, or chat-session persistence layer; or
- a promise that arbitrary user code physically executes exactly once.

Breaking changes are expected during the reset. There are no current downstream users to preserve, so the repository should optimize for a coherent eventual design and fast learning rather than compatibility with v1 or incidental internal APIs.

## Key semantics

### Trusted mesh and coordinator recovery

All enrolled nodes are trusted. The first distributed design has one coordinator that is authoritative at the durable-store boundary, not one irreplaceable coordinator machine. A partitioned process can continue believing it is leader and issuing messages, so correctness cannot depend on stopping stale processes. One durable authority record per application is co-located with its execution ledger. Initial acquisition and deliberate, caller-confirmed takeover are linearizable conditional transitions; takeover increments a monotonic epoch. The future operator path must own that confirmation, and the finished coordinator path must bind every authoritative writer to the current tuple. New physical assignments carry its epoch, while each attempt additionally carries a per-invocation generation; storage rejects stale fencing values.

The repository now binds the production resident, direct durable-submission fallback, foreground execution, and direct mutating operator paths to the explicit authority state machine and execution-ledger transaction fence. Schedule control consumes that exact ledger token, while application state uses its destination-local adoption barrier and control-store readiness protocol. New bound admissions retain the exact admitting authority as durable provenance without changing their logical epoch-zero event fence. This completes the explicit, operator-confirmed replacement boundary; it does not establish automatic failover.

Heartbeats are diagnostic evidence, not leases, and their age never authorizes takeover. The generic database contract has no store-authoritative clock or expiry predicate, so Wharfie does not infer expiry from coordinator timestamps or claim automatic failover from that contract. Automatic replacement requires a provider-certified semantic lease whose acquisition, renewal, expiry, and epoch transition are linearizable at the store. Local development may exercise explicit authority through LMDB, but a local-only store cannot provide automatic failover after loss of its host. A later peer-quorum store can remove the provider dependency without changing the public model.

### Committed outcomes and effects

An invocation has at most one authoritative terminal outcome; once resolved, it has exactly one. Retryable runnable work uses at-least-once dispatch and can have overlapping physical attempts around failures. Only the current fenced attempt can commit Wharfie-managed state.

Wharfie can make an external exactly-once claim only for operations routed through a managed effect adapter whose destination atomically enforces the effect identity with the business mutation. Managed operations declare substantiated properties such as `pure`, `idempotent`, or `transactional`; without a supported replay guarantee they are `unsafe`. These properties need not be mutually exclusive. Direct SDK calls from trusted in-process code are unmanaged. An in-process handler therefore defaults to `unsafe` after it begins unless its author opts into a substantiated replay-safe contract. An interrupted unsafe operation puts its invocation into a durable, blocked `uncertain` state; reconciliation must establish its result or create a distinct compensating invocation, never silently retry it or rewrite an already committed outcome.

### Capability fulfillment

Applications declare portable needs. Deployment profiles map those needs to AWS, another provider, SSH-accessible hosts, or local resources. Wharfie creates and reconciles only resources that implement first-class Wharfie capabilities. Provider-native application infrastructure remains application code or external IaC.

Provisioning must use normal credential chains, preview mutations, distinguish managed resources from external references, record ownership receipts, bootstrap narrowly scoped runtime identities, and destroy only resources Wharfie owns.

### Language boundary

TypeScript/Node is the only initial authoring and orchestration model. Activity handlers default to in-process JavaScript, which may use target-specific Node-API dependencies. A versioned serializable boundary leaves room for WASI/WASM and persistent subprocess workers. Component effects are host-mediated; components do not receive coordinator or provider credentials. Wharfie packages validated outputs; it does not compile arbitrary language ecosystems.

## Design principles

1. **Continuity over machinery.** The product is the smooth path from local CLI to durable service; SEA, cloud resources, and mesh coordination support that path.
2. **Local first, progressively durable.** A user should gain value before creating an account or deployment.
3. **One artifact, one operator surface.** The application executable should remain the primary way to run, deploy, inspect, and evolve itself.
4. **Explicit durable truth.** Revisions, authority epochs, leases, attempts, effects, ownership, and operator actions are data, not inference from logs or heartbeat age.
5. **Honest failure semantics.** Prefer `uncertain` and reconciliation to a false exactly-once claim.
6. **Narrow portable abstractions.** Keep provider and language details behind finite contracts.
7. **Delete migration scaffolding.** Reuse good v2 code, but do not preserve obsolete concepts merely because they already exist.
8. **Agent legibility.** Deterministic builds, schemas, JSON output, small public concepts, and auditable state should make the system easy for both humans and coding agents to understand.

## Success test

Wharfie is worth building while it can answer yes to this question:

> Can someone create a small CLI in a coding session, deploy it durably to a clean cloud account in minutes, close the session, return later to understand exactly what happened, and safely evolve it without learning a second application architecture?

See [ROADMAP.md](ROADMAP.md) for the delivery sequence and [the architecture decision log](docs/architecture/decisions/README.md) for the decisions that constrain it.
