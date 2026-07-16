# Wharfie v2

**Status:** Draft (actively iterating)  
**Last updated:** 2026-03-27  
**Audience:** contributors implementing the rewrite; optimized for LLM context + direct code navigation.

- Back to design index: [`README.md`](./README.md)
- Related design note: [`wharfie-progressive-agent-application.md`](./wharfie-progressive-agent-application.md)
- Existing workflow graph code: [`src/core/lib/graph/index.js`](../../src/core/lib/graph/index.js)

---

## One sentence

**Wharfie v2 is a manifest-first, provider-neutral framework for packaging developer-owned CLIs and named activities into single executable artifacts, then progressively operationalizing them with queue/cron triggers, workflow DAGs, shared runtime resources, and later multi-node placement. Progressive agent applications are the lodestar workload.**

---

## Why v2 exists

v1 Wharfie centered around table-oriented data apps on AWS Athena. v2 moves Wharfie toward:

- packaging useful Node applications into single executable artifacts,
- preserving the developer’s own CLI by default,
- exposing named activities that schedules, queues, and workflows can call,
- running locally first and deploying to Linux without changing the app model,
- keeping cloud providers as adapters rather than core dependencies.

The key product promise is smooth progression:

- a CLI should not need to be rewritten to become a scheduled service,
- a scheduled service should not need to be rewritten to become workflow-backed,
- a workflow-backed app should have a path to later multi-node placement.

Breaking changes are explicitly allowed.

---

## Locked decisions (do not re-litigate)

- **Public contract:** manifest-first app definition in code
- **Public app model:** developer-owned `cli` + named `activities`
- **Packaging funnel:** `wharfie app manifest` and `wharfie app package`
- **Artifact UX:** packaged apps preserve the developer-owned CLI by default
- **Wharfie internals:** runtime control is hidden behind an env-selected bootstrap path, not a public artifact command tree
- **Shared resource refs:** stored in a config-dir backed registry
- **Shared resource kinds (first cut):** `db`, `queue`, `objectStorage`
- **Triggers in MVP:** Queue + Cron only
- **Cron timezone:** UTC
- **Cron misfires:** skipped by default (no catch-up)
- **Infra model:** IaC reconciliation using `Reconcilable` / `BaseResource`
- **Multi-node scaling (MVP):** “more pollers” (no membership/leader election yet)
- **Core types:** provider-neutral (no provider SDK request/response types in core)
- **Naming:** enforce `{app}-{env}-{logicalName}` prefixing unless explicitly overridden

---

## Product principles

- **CLI stays yours:** packaged apps should keep the developer’s own command surface, argv shape, stdio, and exit codes.
- **Activities are the machine contract:** schedules, queues, workflows, and later placement target named activities, not parser internals.
- **Release = file:** a release is a content-addressed executable artifact.
- **No accidental cloud usage:** core never infers cloud providers from ambient environment.
- **Parity:** local run and deployed runtime should use the same app model.
- **Recoverable workflows:** operation DAG state is persisted in DB so work can resume after crashes/restarts.
- **Progression without rewrite:** CLI → scheduled/evented app → workflow-backed app → distributed placement should reuse the same activity catalog.

---

## Vocabulary (important: “resource” is overloaded)

This repository uses “resource” in two different systems. v2 must keep them conceptually separate.

### IaC Resource (reconcilable entity)

A concrete entity managed by the reconciliation engine (`Reconcilable`, `BaseResource`).

Examples:
- `NodeBinary`, `SeaBuild`, `MacOSBinarySignature`
- `SQSQueue`, `DynamoTable`
- `HetznerVPS`, `HetznerSSHKey`
- `Node` / systemd installation units

See:
- [`src/core/resources/reconcilable.js`](../../src/core/resources/reconcilable.js)
- [`src/core/resources/base-resource.js`](../../src/core/resources/base-resource.js)

### Capability (runtime interface exposed to activities)

A pluggable runtime interface usable from activity execution context, typically behind a service boundary.

Examples:
- `Queue`
- `DB`
- `ObjectStorage`

See current capability wiring:
- [`src/core/runtime/resources.js`](../../src/core/runtime/resources.js)

### Adapter (built-in only for now)

A concrete implementation of a capability.

**MVP constraint:** no user-defined adapters yet; only built-ins shipped in this repo.

Examples (existing):
- Queue: `vanilla`, `lmdb`, `sqs`
- DB: `vanilla`, `lmdb`, `dynamodb`
- Object storage: `vanilla`, `s3`, `r2`, `b2`

### Activity (public machine-facing unit)

A named unit of work that Wharfie can invoke from:

- the developer CLI,
- scheduler triggers,
- queue messages,
- workflow actions,
- later placement/routing logic.

Near-term implementation detail: activities can compile onto the repo’s existing internal `functions` shape and current `actor` / `functionName` invocation plumbing.

### Workflow / Operation graph

A DAG of steps that the system runs to accomplish a higher-level task.

- **Operation**: a single run/instance of a workflow DAG
- **Action**: a node/step in the DAG
- **Edge**: dependency between actions
- **State**: persisted in the DB capability so operations can resume across restarts

Existing code:
- Graph model: [`src/core/lib/graph/index.js`](../../src/core/lib/graph/index.js)
- Persistence adapter: [`src/core/lib/db/tables/operations.js`](../../src/core/lib/db/tables/operations.js)

---

## UX and CLI surface

### Installed Wharfie CLI vs packaged app CLI

There are two separate command surfaces.

#### Installed Wharfie CLI

This is the authoring and operator tool.

Near-term commands stay in the existing app lane:

- `wharfie app manifest`
- `wharfie app package`
- `wharfie app run`

This is where build/package/deploy workflows should continue to live.

#### Packaged app CLI

This belongs to the developer.

The default artifact experience should:

- enter the developer’s `cli.entrypoint`,
- preserve normal `process.argv`, stdio, and exit codes,
- avoid exposing Wharfie-owned `func`, `ctl`, or `infra` commands as the public help surface.

### Hidden bootstrap for runtime mode

Wharfie still needs a way to launch runtime services for scheduling, queue polling, and deployment-managed residency.

The locked choice is:

- **env-var selected bootstrap mode**

That keeps runtime control available for Linux/systemd and internal orchestration without taking over the app’s public UX.

---

## App definition: code, compiled to a manifest

Wharfie v2 apps are defined in code (`wharfie.app.js`), not in YAML.

The public contract should stay small and mechanical.

### Recommended minimal shape

```js
export default {
  name: 'my-app',
  cli: {
    entrypoint: './src/cli.js',
  },
  activities: {
    collect: {
      entrypoint: './src/activities/collect.js',
      export: 'run',
    },
    sync: {
      entrypoint: './src/activities/sync.js',
      export: 'run',
    },
  },
  resources: {
    db: { ref: 'default-db' },
    queue: { ref: 'agent-work' },
    objectStorage: { ref: 'default-objects' },
  },
  scheduler: {
    triggers: [{ activity: 'collect', cron: '0 * * * *' }],
  },
  workflows: {
    nightly: {
      actions: [
        { id: 'collect', type: 'ACTIVITY', activity: 'collect' },
        { id: 'sync', type: 'ACTIVITY', activity: 'sync', dependsOn: ['collect'] },
      ],
    },
  },
  targets: [{ nodeVersion: '24', platform: 'linux', architecture: 'x64' }],
};
```

### Compilation mapping

The manifest compiler should map this public contract onto the repo’s current runtime/build substrate:

- `cli.entrypoint` becomes the default process root for packaged artifacts
- `activities` compile onto the current `functions` representation
- scheduler triggers compile from public `activity` to current internal `actor`
- workflow actions compile onto current graph/action structures
- the manifest is embedded into the SEA artifact as an asset

This keeps the public model stable while implementation continues to reuse existing internals.

---

## Capabilities + adapters (DB matters as much as Queue)

### Why DB is first-class in v2

DB is required for:

1. workflow operation DAG state,
2. IaC reconciliation state,
3. optional application state used by activities.

If Queue is how work gets distributed, DB is how the system remembers what happened.

### Repo reality

The repo already has built-in capability adapters:

- Queue adapters: `vanilla`, `lmdb`, `sqs`
- DB adapters: `vanilla`, `lmdb`, `dynamodb`
- Object storage adapters: `vanilla`, `s3`, `r2`, `b2`

### Shared resource references

Multiple Wharfie apps owned by the same user should be able to share persistent resources.

The first cut should use a **config-dir backed registry** and support refs for:

- `db`
- `queue`
- `objectStorage`

Example:

```js
resources: {
  db: { ref: 'default-db' },
  queue: { ref: 'agent-work' },
  objectStorage: { ref: 'default-objects' },
}
```

`lambda` is not part of this shared resource registry in the first cut. In the current repo it is an execution service, not a durable shared capability.

### Provider neutrality constraints

- capability interfaces/types must not import provider SDK request/response types,
- provider SDK types live only inside provider adapters,
- adapter selection must stay explicit.

The repo has already moved in this direction in runtime resource resolution.

---

## Workflow DAGs: Operations → Actions

The workflow graph remains a first-class v2 concept.

### What problem the graph solves

Queue + cron give Wharfie triggers. The graph adds:

- sequencing,
- fan-out/fan-in,
- retries and idempotency per step,
- durable state and recovery,
- a clear execution record.

### Repo reality

Wharfie already has:

- `Operation`: a run containing actions + dependency edges
- `Action`: a step record with status + outputs
- DB persistence for serialized graphs and action status

That means v2 does not need a new workflow substrate. It needs a better public app model and better mapping from activities into the existing graph runtime.

### Near-term conclusion

The atomic operational unit should be a **run**, with **agent runs** as the lodestar use case.

That means:

- CLI commands can invoke activities directly,
- cron can create activity runs,
- queue messages can create activity runs,
- workflows can orchestrate the same activity catalog.

---

## Runtime architecture (node services + supervision)

### Repo reality

The runtime already contains the right service-level pieces:

- `node-agent` for supervision and service planning,
- `queue-service` for queue capability hosting,
- `db-service` for DB capability hosting,
- `lambda-service` for invoke + poll execution,
- `scheduler-service` for cron.

### v2 direction

The near-term runtime should stay close to the repo’s current shape:

- **developer CLI mode**: packaged app starts the developer CLI
- **hidden runtime mode**: env-selected bootstrap starts queue/db/scheduler/execution services as needed
- **activity execution**: continues to reuse current function/invoke plumbing until the public activity layer is in place

This is why the next work is mostly about manifest shape, packaging, and bootstrap, not inventing an entirely new runtime.

---

## Triggers

### Queue trigger (MVP)

MVP behavior remains:

- executor-service runs poll loops against configured queues,
- each message identifies which activity to invoke,
- success deletes/acks the message,
- failure leaves the message for retry.

Repo reality: `lambda-service` already accepts both legacy `functionName` envelopes and a v2-style `actor` envelope. That is enough compatibility space for the activity layer to compile onto.

### Cron trigger (UTC)

Locked behavior remains:

- evaluated in UTC,
- misfires skipped,
- cron runs on leader nodes only in the current multi-node model.

---

## Deployments (Linux/systemd first)

### Current direction

MVP deploy remains Linux/systemd first.

The repo already has:

- SSH/SCP-backed node deployment,
- systemd release installation,
- content-addressed artifact release structure.

### v2 correction

The deployed runtime should not depend on a public artifact command tree like `ctl state start`.

Instead:

- the installed `wharfie` CLI can remain the operator tool,
- the packaged app stays user-facing by default,
- hidden bootstrap mode is what systemd and deployment wiring should target.

Rollback remains “switch to prior artifact and restart.”

---

## Multi-node scaling now vs later

### MVP scaling

The near-term multi-node model stays simple:

- more nodes = more pollers,
- cron runs on leader nodes only,
- workflows distribute action execution through queue + DB.

### Later

Only after the single-node progression is coherent should Wharfie add:

- membership,
- leader election,
- distributed locks when required,
- secure inter-node RPC,
- trusted placement,
- later trustless mesh research.

Progressive agent applications remain the lodestar, but trusted/trustless mesh is not the near-term center of gravity.

---

## What happens to `Function` and `ActorSystem`

### `Function`

Keep it as an internal or advanced primitive for:

- activity packaging,
- runtime invocation,
- workflow steps,
- resource-scoped callable units.

Do not make it the first primitive a CLI author has to learn.

### `ActorSystem`

Keep it as an advanced composition/build primitive.

Do not keep it as the only supported packageable app export.

The public app contract should be broader than `ActorSystem`, and `wharfie app package` should eventually support CLI apps directly.

---

## Implementation checklist (next coherent cuts)

This checklist is intentionally aligned to the repo’s real bottlenecks.

### A) Recenter the public app contract

- [ ] Add `cli.entrypoint` to the manifest compiler in [`src/cli/app/load-app.js`](../../src/cli/app/load-app.js)
- [ ] Add public `activities` and compile them onto the current internal `functions` representation
- [ ] Support public trigger references to activities while preserving internal compatibility with current `actor` fields

### B) Make the existing packaging lane support CLI apps

- [ ] Extend [`src/cli/app/local-app.js`](../../src/cli/app/local-app.js) so `wharfie app package` supports manifest-defined CLI apps, not only `ActorSystem` exports
- [ ] Preserve manifest embedding in the SEA artifact
- [ ] Keep the developer CLI as the default process root for packaged artifacts

### C) Hide Wharfie internals behind bootstrap mode

- [ ] Introduce env-var selected bootstrap for runtime service mode
- [ ] Generalize deployment/systemd startup away from public `ctl state start` assumptions
- [ ] Keep `func` / `ctl` / `infra` as internal plumbing or installed-CLI behavior, not the packaged app’s public UX

### D) Add shared resource refs

- [ ] Add config-dir backed registry support for user-scoped shared `db`, `queue`, and `objectStorage` refs
- [ ] Resolve refs during manifest/runtime preparation without forcing app manifests to inline backend details

### E) Operationalize runs

- [ ] Persist activity runs on top of the existing `Operation` / `Action` substrate
- [ ] Capture trigger provenance (`manual`, `cron`, `event`)
- [ ] Reuse scheduler and lambda execution paths to create those runs

### F) Defer the right things

- [ ] Do not add a new top-level `wharfie build` command yet
- [ ] Do not make trustless mesh part of the near-term implementation roadmap
- [ ] Do not add `lambda` to the shared resource registry in the first cut

---

## Evidence from the repo

- [`src/cli/app/load-app.js`](../../src/cli/app/load-app.js) already compiles plain object and `ActorSystem` exports into a manifest; this is the right place to make `cli` and `activities` public.
- [`src/cli/app/local-app.js`](../../src/cli/app/local-app.js) is the exact packaging bottleneck: local run assumes `invoke(functionName, event, context)` and packaging still rejects non-`ActorSystem` apps.
- [`src/core/runtime/services/scheduler-service.js`](../../src/core/runtime/services/scheduler-service.js) and [`src/core/runtime/services/lambda-service.js`](../../src/core/runtime/services/lambda-service.js) prove the runtime already wants named machine-invocable units.
- [`src/core/runtime/services/node-agent.js`](../../src/core/runtime/services/node-agent.js) already plans services from the manifest, which is why hidden bootstrap is more urgent than inventing another runtime abstraction.
- [`src/core/resources/builds/actor-system-cli/index.js`](../../src/core/resources/builds/actor-system-cli/index.js) shows the current artifact UX is still Wharfie-owned; v2 needs to stop making that the default for packaged CLI apps.
- [`src/core/runtime/resources.js`](../../src/core/runtime/resources.js) and [`src/core/lib/paths.js`](../../src/core/lib/paths.js) show why config-dir backed shared refs are a clean next step for `db`, `queue`, and `objectStorage`.
- [`src/core/lib/graph/index.js`](../../src/core/lib/graph/index.js) and [`src/core/lib/db/tables/operations.js`](../../src/core/lib/db/tables/operations.js) already provide the durable workflow/run substrate that the progressive app model should build on.
- [`scripts/verify-package-sea.js`](../../scripts/verify-package-sea.js) proves that the supported package can turn a developer-owned TypeScript CLI and activity into a moved SEA artifact that runs without Node on `PATH`.
