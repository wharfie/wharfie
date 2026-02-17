# Wharfie v2

**Status:** Draft (actively iterating)  
**Last updated:** 2026-02-15  
**Audience:** contributors implementing the rewrite; optimized for LLM context + direct code navigation.

- Back to docs index: [`docs/README.md`](../README.md)
- Repo example to align with: [`scratch/test.js`](../../scratch/test.js)
- Existing workflow graph code: [`lambdas/lib/graph/index.js`](../../lambdas/lib/graph/index.js)

---

## One sentence

**Wharfie v2 is a provider-neutral, single-executable framework for writing serverless-style applications (Queue + Cron → Actors) and higher-level Workflow DAGs (Operations → Actions) that run locally (macOS/Windows/Linux) and can deploy themselves anywhere — cloud providers are adapters, not dependencies.**

---

## Why v2 exists

v1 Wharfie centered around “table-oriented data apps on AWS Athena”. v2 changes the product into:

- **serverless-style application composition** (actors + queues + cron),
- **workflow DAGs** for orchestrating multi-step operations using actors,
- **immutable artifacts** (single executable output; content-addressed),
- **local-first parity** (run locally without cloud),
- **deploy-anywhere** (SSH + optional provisioning),
- **provider neutrality** (no AWS coupling in core).

Breaking changes are explicitly allowed.

---

## Vocabulary (important: “resource” is overloaded)

This repository uses “resource” in two different systems. v2 must keep them conceptually separate.

### IaC Resource (reconcilable entity)

A concrete entity managed by the reconciliation engine (`Reconcilable`, `BaseResource`).

Examples:
- `NodeBinary`, `SeaBuild`, `MacOSBinarySignature`
- `SQSQueue`, `DynamoTable`
- `HetznerVPS`, `HetznerSSHKey`
- `Node` / `systemd` installation units

See:
- [`lambdas/lib/actor/resources/reconcilable.js`](../../lambdas/lib/actor/resources/reconcilable.js)
- [`lambdas/lib/actor/resources/base-resource.js`](../../lambdas/lib/actor/resources/base-resource.js)

### Capability (runtime interface exposed to actors)

A pluggable runtime interface usable from an actor execution context, typically behind a gRPC service.

Examples:
- `Queue`
- `DB`
- `ObjectStorage` (later)
- `Logger` (later)

See current capability wiring:
- [`lambdas/lib/actor/runtime/resources.js`](../../lambdas/lib/actor/runtime/resources.js)

### Adapter (built-in only for now)

A concrete implementation of a capability.

**MVP constraint:** no user-defined adapters yet; only built-ins shipped in this repo.

Examples (existing):
- Queue: `vanilla`, `lmdb`, `sqs`  
  [`lambdas/lib/queue/adapters`](../../lambdas/lib/queue/adapters)
- DB: `vanilla`, `lmdb`, `dynamodb`  
  [`lambdas/lib/db/adapters`](../../lambdas/lib/db/adapters)

### Workflow / Operation graph (new first-class concept in v2)

A **DAG** of steps that the system runs to accomplish a higher-level task.

- **Operation**: a single run/instance of a workflow DAG
- **Action**: a node/step in the DAG (typically maps to an actor invocation)
- **Edge**: dependency (Action B depends on Action A)
- **State**: persisted in the DB capability so operations can resume across restarts

Existing code:
- Graph model: [`lambdas/lib/graph/*`](../../lambdas/lib/graph/index.js)
- Persistence adapter: [`lambdas/lib/db/tables/operations.js`](../../lambdas/lib/db/tables/operations.js)

---

## Locked decisions (do not re-litigate)

- **Artifact includes full deploy UX** (deploy/status/logs/rollback/infra apply are inside the built executable)
- **Triggers in MVP:** Queue + Cron only
- **Cron timezone:** UTC
- **Cron misfires:** skipped by default (no catch-up)
- **Infra model:** IaC reconciliation using `Reconcilable` / `BaseResource`
- **Multi-node scaling (MVP):** “more pollers” (no membership/leader election yet)
- **Core types:** provider-neutral (no provider SDK request/response types in core)
- **Naming:** enforce `{app}-{env}-{logicalName}` prefixing unless explicitly overridden

---

## Product principles

- **Release = file:** a release is a content-addressed executable. Rollback is selecting a previous `artifactId`.
- **No accidental cloud usage:** no `inAWS()` auto-selection in core; cloud adapters must be explicitly selected.
- **Parity:** local run uses the same process topology as “production”.
- **Isolation:** adapter clients live out-of-process behind gRPC; actor code never owns/keeps raw clients.
- **Convergent infra:** deploy converges desired state and can be re-run safely.
- **Recoverable workflows:** operation DAG state is persisted in DB so operations can resume after crashes/restarts.

---

## UX and CLI surface

### Two modes: installed CLI vs artifact CLI

One CLI codebase, two contexts:

- **Project mode** (`wharfie` installed): create apps, run dev, build artifacts.
- **Artifact mode** (built executable): run/deploy/status/logs/rollback/infra.

### Command surface (proposed)

Project mode:
- `wharfie init`
- `wharfie dev`
- `wharfie build --target <os-arch>`

Artifact mode (also usable in project mode):
- `<artifact> run --env <env>`
- `<artifact> deploy --env <env>`
- `<artifact> infra plan|apply|destroy --env <env>`
- `<artifact> status --env <env>`
- `<artifact> logs --env <env> [--follow]`
- `<artifact> rollback --env <env> [--to <artifactId>]`
- `<artifact> actor invoke <name> --event <json>`

Workflow operations (v2):
- `<artifact> op start <workflowName> --input <json> [--scope <id>]`
- `<artifact> op status <operationId>`
- `<artifact> op cancel <operationId>`
- `<artifact> op logs <operationId>`

> These `op *` commands are optional for the first MVP cut, but the workflow concept must exist in the design and data model.

### Repo reality: internal artifact CLI already exists

The SEA artifacts today boot into an internal CLI:

- [`lambdas/lib/actor/resources/builds/actor-system-cli/index.js`](../../lambdas/lib/actor/resources/builds/actor-system-cli/index.js)

It already contains plumbing for:
- starting node-agent (`ctl state start`)
- serving queue/db/lambda services (`ctl state serve ...`)
- invoking a function (`func run`)

v2 should extend this CLI rather than inventing a parallel one.

---

## App definition: **code**, not YAML

Wharfie v2 apps are defined in code (JS/TS), not in `wharfie.yaml`.

- This keeps composition programmable and keeps Wharfie itself honest (dogfooding).
- Apps built with Wharfie can still define YAML-based DSLs for their own domain use-cases, but Wharfie core should not require YAML.

### Recommended layout (MVP)

```
my-app/
  wharfie.app.js        # app spec entrypoint (code)
  actors/
    worker.js
    nightly.js
  dist/
  .wharfie/             # local mutable state (dev only)
```

### App spec: minimal “compile to manifest” contract

The CLI needs to load an app spec and derive a normalized manifest that is embedded into the artifact:

- actors (name, entrypoint, externals)
- triggers (queue polling config, cron schedules)
- capabilities config (DB + Queue are first-class)
- workflows (operation graphs)
- deployments (nodes, roles, service manager)
- targets (mac/windows/linux builds)

This manifest is embedded into the SEA artifact as an asset.

---

## Capabilities + adapters (DB is as important as Queue)

### Why DB is first-class in v2

DB is not “nice to have”. DB is required for:

1) **Workflow operation DAG state** (Operation/Action status + outputs)
2) **IaC reconciliation state** (`BaseResource.stateDB`)
3) (optional) application state used by actors

If Queue is “how work gets distributed”, DB is “how the system remembers what happened”.

### Repo reality: DB + Queue adapters already exist

- Queue adapters: [`lambdas/lib/queue/adapters`](../../lambdas/lib/queue/adapters)
  - `vanilla`, `lmdb`, `sqs`
- DB adapters: [`lambdas/lib/db/adapters`](../../lambdas/lib/db/adapters)
  - `vanilla`, `lmdb`, `dynamodb`

**MVP constraint:** no user-defined adapters yet.

### Provider neutrality constraints (practical)

- Capability interfaces/types must not import provider SDK request/response types.
- Provider SDK types live only inside provider adapters.

Concrete refactors required (existing coupling):
- Queue typedefs import AWS SDK types:  
  [`lambdas/lib/queue/base.js`](../../lambdas/lib/queue/base.js)
- Capability selection auto-detects AWS:  
  [`lambdas/lib/actor/runtime/resources.js`](../../lambdas/lib/actor/runtime/resources.js)
- State store auto-selects DynamoDB when AWS env vars exist:  
  [`lambdas/lib/db/state/store.js`](../../lambdas/lib/db/state/store.js)

v2 policy:
- explicit adapter selection only (defaults may exist, but never based on AWS env vars)

---

## Workflow DAGs: Operations → Actions (graph)

This section formalizes the DAG concept as a v2 feature.

### What problem the graph solves

Queue + cron gives you triggers, but complex operations usually need:

- sequencing (“do A then B then C”)
- fan-out/fan-in
- retries and idempotency per step
- long-running state and recovery
- a clear, inspectable execution record

The graph gives you this without turning Wharfie into a monolithic “platform”.

### Data model (existing code, generalized for v2)

Wharfie already has a graph model:

- `Operation`: contains actions + dependency edges + operation metadata  
  [`lambdas/lib/graph/operation.js`](../../lambdas/lib/graph/operation.js)
- `Action`: step record with status + outputs  
  [`lambdas/lib/graph/action.js`](../../lambdas/lib/graph/action.js)

v2 generalization:
- An **Action** maps to an **actor invocation** (instead of Athena-specific action types).
- Store actor name as:
  - `action.type = "ACTOR:<name>"` (minimal change), or
  - add `action.actor = "<name>"` (cleaner; requires schema change)

### Persistence: DB “operations table”

Graph state is stored in DB via:

- [`lambdas/lib/db/tables/operations.js`](../../lambdas/lib/db/tables/operations.js)

This table stores:
- operation record (includes `serialized_action_graph`)
- action records (status + outputs)
- (optional) “attempt”/execution records (today called `Query`)

v2 must treat this table as a **core subsystem**, not legacy.

### Execution model (how DAGs run)

#### Core idea

- DB stores ground truth for operation state.
- Queue is used to distribute **ready** actions to workers.
- Workers execute the actor, then update DB and schedule downstream actions.

#### Scheduling algorithm (push + reconcile)

**Push scheduling (fast path):**
1) Create operation + action records in DB.
2) Enqueue all actions with no prerequisites.
3) When an action completes:
   - mark it COMPLETED in DB (and store outputs if provided),
   - for each downstream action, check prerequisites and enqueue if now ready.

**Reconcile scheduling (repair path):**
- A periodic reconciler scans for actions that are PENDING but not enqueued (or stuck) and re-enqueues them if prerequisites are satisfied.

This makes DAG execution robust against:
- worker crashes between “complete” and “enqueue downstream”
- transient queue/send failures

#### Where the scheduler runs

MVP options (both valid):
- **Embedded library in executor-service** (recommended): executor already polls queues and invokes actors; it can also perform the graph bookkeeping.
- **Dedicated graph-service**: separate process for workflow orchestration. Cleaner separation, but more plumbing.

v2 spec should not block either; start with “embedded” to ship.

### Status + inspection

A workflow must be inspectable without reading logs:

- operation status: PENDING/RUNNING/COMPLETED/FAILED/CANCELLED
- per-action status + timestamps
- action outputs (small JSON only; large outputs go to object storage later)

The CLI `op status` should query the operations table and render a compact view.

### Cancellation semantics (MVP)

- Cancelling an operation sets operation status to CANCELLED.
- Workers should check operation status before running a dequeued action.
- Already-running actions are not forcibly killed in MVP.

---

## Artifact build system (SEA) + dogfooding

### Repo reality: SEA already works

The current build system already supports:
- downloading target Node binaries: [`NodeBinary`](../../lambdas/lib/actor/resources/builds/node-binary.js)
- building a SEA blob + injecting it: [`SeaBuild`](../../lambdas/lib/actor/resources/builds/sea-build.js)
- bundling function code + externals tar: [`FunctionResource`](../../lambdas/lib/actor/resources/builds/function-resource.js)
- executing function bundles in worker sandboxes: [`worker.js`](../../lambdas/lib/code-execution/worker.js)

The existing `ActorSystem` composes this graph:
- [`lambdas/lib/actor/resources/builds/actor-system.js`](../../lambdas/lib/actor/resources/builds/actor-system.js)

### What v2 adds

- an **App Manifest asset** embedded into SEA (not just function bundles)
- workflows in the manifest (DAG definitions)
- deploy UX exposed from the artifact CLI

---

## Runtime architecture (node services + gRPC)

### Repo reality: node-agent + gRPC services already exist

- node-agent supervisor: [`node-agent.js`](../../lambdas/lib/actor/runtime/services/node-agent.js)
- queue-service (ResourceRpc): [`queue-service.js`](../../lambdas/lib/actor/runtime/services/queue-service.js)
- db-service (ResourceRpc): [`db-service.js`](../../lambdas/lib/actor/runtime/services/db-service.js)
- lambda-service (Invoke + poll loops): [`lambda-service.js`](../../lambdas/lib/actor/runtime/services/lambda-service.js)
- JSON-over-gRPC plumbing: [`rpc-grpc.js`](../../lambdas/lib/actor/runtime/services/rpc-grpc.js)

### v2 topology (recommended MVP)

- **node-agent**: supervises services; exposes `/health`
- **queue-service**: hosts queue adapter client behind ResourceRpc
- **db-service**: hosts DB adapter client behind ResourceRpc (**first-class**)
- **executor-service**: existing lambda-service (Invoke + queue pollers)
- **scheduler-service**: new (Cron UTC) → invokes executor-service (leader-only)

ASCII sketch:

```
           HTTP /health
+-------------------------+
|        node-agent       |
|  supervise + readiness  |
+-----------+-------------+
            |
            | spawn self (same artifact)
            v
+------------------+     gRPC      +-------------------+
|  queue-service   |<------------->|  executor-service |
|  adapter client  |               | worker sandboxes  |
+------------------+               | queue pollers     |
+------------------+               | workflow DAG exec |
|   db-service     |<------------->|  (optional here)  |
|  adapter client  |               +---------+---------+
+------------------+                         ^
                                             | gRPC Invoke
                                   +---------+---------+
                                   | scheduler-service |
                                   | cron (UTC)        |
                                   +-------------------+
```

### Queue polling format (repo reality)

The lambda-service poll loop expects message bodies shaped like:

```json
{ "functionName": "my-function", "event": { ... }, "context": { ... } }
```

See:
- [`lambdas/lib/actor/runtime/services/lambda-service.js`](../../lambdas/lib/actor/runtime/services/lambda-service.js)

This is good for v2:
- queue is a generic dispatch plane
- messages are self-describing (which actor to run)

Workflows can reuse this by enqueueing action steps as `{ functionName: actorName, context: { operationId, actionId, ... } }`.

---

## Triggers

### Queue trigger (MVP)

MVP behavior:
- executor-service runs poll loops against one or more configured queue URLs
- each message specifies which actor to invoke (`functionName`)
- on success: delete/ack
- on failure: do not delete; message retries after visibility timeout

### Cron trigger (UTC)

- evaluated in **UTC**
- misfires are **skipped**
- cron runs only on leader nodes (MVP “exactly once” policy without membership)

---

## IaC reconciliation engine (Reconcilable/BaseResource) + naming

### Repo reality: IaC engine exists and is good

- engine:
  - [`reconcilable.js`](../../lambdas/lib/actor/resources/reconcilable.js)
  - [`base-resource.js`](../../lambdas/lib/actor/resources/base-resource.js)
- AWS queue IaC:
  - [`lambdas/lib/actor/resources/aws/queue.js`](../../lambdas/lib/actor/resources/aws/queue.js)
- nodes / systemd:
  - [`lambdas/lib/actor/resources/node.js`](../../lambdas/lib/actor/resources/node.js)
- Hetzner provisioning:
  - [`lambdas/lib/actor/resources/hetzner`](../../lambdas/lib/actor/resources/hetzner)

### Naming rule

Default physical names are derived as:

```
physicalName = "{app}-{env}-{logicalName}"
```

Override exists (explicit only). No hidden naming magic.

### Shared DB: IaC state store uses the same DB capability

`BaseResource.stateDB` is set to a DB-backed state store:

- [`lambdas/lib/db/state/store.js`](../../lambdas/lib/db/state/store.js)

v2 requirement:
- remove AWS auto-selection
- state backend must be explicit

---

## Deployments (SSH + optional provisioning) + rollback

### Deployment shape

MVP deploy uses:
- static SSH nodes (host/user/key)
- Linux service manager = systemd
- artifact copied to `/opt/wharfie/apps/<app>/releases/<artifactId>/...`
- `current` symlink
- systemd unit points to `current`

Rollback = switch `current` to prior artifactId and restart.

### Cross-platform note

- Runtime + artifacts should support macOS/Windows/Linux.
- Server deployment automation is Linux-first (systemd).
- Non-technical UX goal: artifacts should run with sensible defaults and minimal required flags.

---

## Multi-node scaling now vs future cluster membership

### MVP scaling

- Run N nodes to scale queue throughput → N independent pollers.
- Cron runs only on leader nodes.
- Workflows distribute actions via the queue and persist state via DB; adding nodes increases action throughput.

### Future

- Cluster membership + leader election (cron exact-once guarantees)
- Distributed locks for workflows (if/when required)
- Secure inter-node gRPC (mTLS) if remote service calls are introduced

---

## Proposed public JS API (compile-to-graph, built on today’s primitives)

The repo already supports “define in code” through `ActorSystem` + `Function` + `Reconcilable`.

v2 adds a thin layer that:
1) makes app definition ergonomic,
2) compiles to a normalized manifest asset,
3) composes the existing build graph.

### App + workflows DSL (proposed)

```js
// wharfie.app.js
import {
  defineApp,
  actor,
  workflow,
  step,
  queue,
  cron,
  deployment,
} from "wharfie/app";

export default defineApp({
  name: "my-app",

  targets: [
    { nodeVersion: "24", platform: "darwin", architecture: "arm64" },
    { nodeVersion: "24", platform: "linux", architecture: "x64" },
    { nodeVersion: "24", platform: "win32", architecture: "x64" },
  ],

  capabilities: {
    // built-in adapters only (MVP)
    queue: { adapter: "vanilla", options: { path: ".wharfie" } },
    db:    { adapter: "vanilla", options: { path: ".wharfie" } },
  },

  actors: {
    worker: actor({ entry: "./actors/worker.js#handler" }),
    nightly: actor({ entry: "./actors/nightly.js#handler" }),
    fetch: actor({ entry: "./actors/fetch.js#handler" }),
    transform: actor({ entry: "./actors/transform.js#handler" }),
    load: actor({ entry: "./actors/load.js#handler" }),
  },

  triggers: [
    cron("0 2 * * *", { tz: "UTC", actor: "nightly" }),
    // Queue trigger in v2 is “poll these queue URLs”; messages self-describe the functionName.
    // queuePoll("jobsQueueUrl") ...
  ],

  workflows: {
    ingest: workflow({
      steps: {
        fetch: step({ actor: "fetch" }),
        transform: step({ actor: "transform", dependsOn: ["fetch"] }),
        load: step({ actor: "load", dependsOn: ["transform"] }),
      },
    }),
  },

  deployments: {
    prod: deployment({
      env: "prod",
      nodes: [
        { host: "1.2.3.4", user: "root", sshKey: "~/.ssh/id_ed25519", role: "leader" },
        { host: "1.2.3.5", user: "root", sshKey: "~/.ssh/id_ed25519", role: "worker" },
      ],
      service: { manager: "systemd", name: "my-app" },
    }),
  },
});
```

### Compilation mapping (how this fits the repo)

The DSL compiles into two things:

1) **Existing build graph** (what produces the SEA artifact):
   - `Function` per actor (`lambdas/lib/actor/resources/builds/function.js`)
   - `ActorSystem` as the top-level build group (`lambdas/lib/actor/resources/builds/actor-system.js`)
   - `NodeBinary` + `SeaBuild` under the hood

2) **A normalized App Manifest embedded as a SEA asset**:
   - includes workflows + triggers + deployments
   - read at runtime to configure pollers/scheduler/workflow behaviors

---

## Implementation checklist (mapped to concrete files)

This section is intentionally “actionable”. Each checkbox should translate into a PR with obvious diffs.

### A) Replace YAML-era project init with v2 skeleton

- [ ] Update `wharfie init` to generate `wharfie.app.js` + `actors/` instead of `wharfie.yaml` + `sources/` + `models/`  
  Files:
  - [`cli/cmds/project_cmds/init.js`](../../cli/cmds/project_cmds/init.js)

- [ ] Update / remove YAML environment loader (v1)  
  Files:
  - [`cli/project/load-environment.js`](../../cli/project/load-environment.js)

### B) App spec loader + manifest compiler (new v2 module)

- [ ] Create `cli/app/load-app.js` that:
  - loads `wharfie.app.js` (ESM),
  - executes it to produce an app spec,
  - validates required fields,
  - outputs a normalized manifest object.

- [ ] Add a manifest serializer:
  - stable JSON ordering
  - no timestamps/UUIDs in output
  - suitable for artifactId hashing

### C) Embed manifest into SEA artifacts

- [ ] Modify `ActorSystem` to include `manifest.json` as a SEA asset  
  Files:
  - [`lambdas/lib/actor/resources/builds/actor-system.js`](../../lambdas/lib/actor/resources/builds/actor-system.js)
  - [`lambdas/lib/actor/resources/builds/sea-build.js`](../../lambdas/lib/actor/resources/builds/sea-build.js)

### D) Cron runtime (UTC) — scheduler-service + leader-only

- [ ] Add new service: `scheduler-service.js` (Cron UTC, skip misfires)  
  New file:
  - `lambdas/lib/actor/runtime/services/scheduler-service.js`

- [ ] Update node-agent to spawn scheduler-service when role is `leader` (or `all`)  
  Files:
  - [`lambdas/lib/actor/runtime/services/node-agent.js`](../../lambdas/lib/actor/runtime/services/node-agent.js)

### E) Make DB capability explicit and first-class

- [ ] Ensure node-agent always starts db-service and passes address to workers  
  Files:
  - [`lambdas/lib/actor/runtime/services/node-agent.js`](../../lambdas/lib/actor/runtime/services/node-agent.js)
  - [`lambdas/lib/actor/runtime/services/db-service.js`](../../lambdas/lib/actor/runtime/services/db-service.js)

- [ ] Remove AWS auto-selection in state store  
  File:
  - [`lambdas/lib/db/state/store.js`](../../lambdas/lib/db/state/store.js)

### F) Workflow DAGs: make graph explicit (manifest + persistence + execution)

- [ ] **Manifest:** allow workflows to be defined in `wharfie.app.js` and embed workflow definitions  
  Files:
  - new manifest compiler module (`cli/app/*`)

- [ ] **Persistence:** standardize Operations table usage (DB adapter + tableName selection)  
  Files:
  - [`lambdas/lib/db/tables/operations.js`](../../lambdas/lib/db/tables/operations.js)
  - (optionally) a new wrapper module `lambdas/lib/workflows/*`

- [ ] **Execution:** implement push + reconcile scheduling  
  Option A (recommended): embed in executor-service:
  - [`lambdas/lib/actor/runtime/services/lambda-service.js`](../../lambdas/lib/actor/runtime/services/lambda-service.js)
  Option B: graph-service (new process)

- [ ] **CLI:** add `op start/status/cancel` commands (optional for MVP, but should exist soon)  
  Files:
  - [`lambdas/lib/actor/resources/builds/actor-system-cli/index.js`](../../lambdas/lib/actor/resources/builds/actor-system-cli/index.js)

### G) Provider neutrality: remove AWS SDK typedef imports + remove AWS auto-selection

- [ ] Replace AWS SDK typedef imports in queue base with local/provider-neutral typedefs  
  File:
  - [`lambdas/lib/queue/base.js`](../../lambdas/lib/queue/base.js)

- [ ] Remove `inAWS()` / `defaultAdapter()` auto-selection in capability wiring  
  File:
  - [`lambdas/lib/actor/runtime/resources.js`](../../lambdas/lib/actor/runtime/resources.js)

### H) Deploy UX inside artifact

- [ ] Implement `deploy/status/logs/rollback` commands in the artifact CLI  
  Files:
  - [`lambdas/lib/actor/resources/builds/actor-system-cli/index.js`](../../lambdas/lib/actor/resources/builds/actor-system-cli/index.js)
  - [`lambdas/lib/actor/resources/builds/actor-system-cli/infrastructure.js`](../../lambdas/lib/actor/resources/builds/actor-system-cli/infrastructure.js)

- [ ] Reuse existing SSH + systemd logic  
  File:
  - [`lambdas/lib/actor/resources/node.js`](../../lambdas/lib/actor/resources/node.js)

### I) IaC queue reconcile + naming prefix enforcement

- [ ] Ensure queue IaC resources derive names using `{app}-{env}-{logicalName}` unless overridden  
  File:
  - [`lambdas/lib/actor/resources/aws/queue.js`](../../lambdas/lib/actor/resources/aws/queue.js)

- [ ] Implement `infra plan/apply/destroy` command surface that builds the desired-state graph from the manifest and runs reconcile.

### J) Tests (adapt existing tests)

- [ ] Extend existing poll tests to cover v2 message envelope + workflow context fields  
  File:
  - [`test/actor/runtime/lambda-service-poll.test.js`](../../test/actor/runtime/lambda-service-poll.test.js)

- [ ] Add scheduler-service tests:
  - cron evaluated in UTC
  - misfires skipped
  - leader-only behavior

- [ ] Add workflow DAG tests:
  - operation persists in DB
  - ready actions are scheduled
  - downstream actions only schedule after prerequisites complete
  - reconcile re-enqueues missing work

---

## Appendix: pointers for fast navigation

- Graph model:  
  [`lambdas/lib/graph/index.js`](../../lambdas/lib/graph/index.js)

- Operations table (graph persistence):  
  [`lambdas/lib/db/tables/operations.js`](../../lambdas/lib/db/tables/operations.js)

- ActorSystem SEA composition:  
  [`lambdas/lib/actor/resources/builds/actor-system.js`](../../lambdas/lib/actor/resources/builds/actor-system.js)

- Function asset loading in SEA:  
  [`lambdas/lib/actor/resources/builds/function.js`](../../lambdas/lib/actor/resources/builds/function.js)

- node-agent service supervisor:  
  [`lambdas/lib/actor/runtime/services/node-agent.js`](../../lambdas/lib/actor/runtime/services/node-agent.js)

- Queue poll message decode:  
  [`lambdas/lib/actor/runtime/services/lambda-service.js`](../../lambdas/lib/actor/runtime/services/lambda-service.js)

- Capability wiring and current AWS auto-selection:  
  [`lambdas/lib/actor/runtime/resources.js`](../../lambdas/lib/actor/runtime/resources.js)

- State store AWS auto-selection (to remove):  
  [`lambdas/lib/db/state/store.js`](../../lambdas/lib/db/state/store.js)

- v1 project init (to rewrite):  
  [`cli/cmds/project_cmds/init.js`](../../cli/cmds/project_cmds/init.js)
