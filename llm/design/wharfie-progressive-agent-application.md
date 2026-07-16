# Wharfie progressive agent application

**Status:** draft design note  
**Last updated:** 2026-03-27  
**Audience:** maintainers refining Wharfie’s app model and packaging contract

- Related design doc: [`wharfie-v2.md`](./wharfie-v2.md)
- Repo evidence for current app loading: [`src/cli/app/load-app.js`](../../src/cli/app/load-app.js)
- Repo evidence for current local run/package behavior: [`src/cli/app/local-app.js`](../../src/cli/app/local-app.js)
- Current runtime trigger surfaces: [`src/core/runtime/services/scheduler-service.js`](../../src/core/runtime/services/scheduler-service.js) and [`src/core/runtime/services/lambda-service.js`](../../src/core/runtime/services/lambda-service.js)
- Current node supervision: [`src/core/runtime/services/node-agent.js`](../../src/core/runtime/services/node-agent.js)
- Current packaged artifact CLI: [`src/core/resources/builds/actor-system-cli/index.js`](../../src/core/resources/builds/actor-system-cli/index.js)
- Current runtime capability wiring: [`src/core/runtime/resources.js`](../../src/core/runtime/resources.js)
- Current graph + operations persistence: [`src/core/lib/graph/index.js`](../../src/core/lib/graph/index.js) and [`src/core/lib/db/tables/operations.js`](../../src/core/lib/db/tables/operations.js)
- Current custom CLI proof case: [`scripts/verify-package-sea.js`](../../scripts/verify-package-sea.js)
- Current config-dir pathing: [`src/core/lib/paths.js`](../../src/core/lib/paths.js)

---

## One sentence

**Wharfie should package manifest-defined applications through `wharfie app package`, preserve the developer-owned CLI by default, expose named activities for schedules/events/workflows, and hide Wharfie runtime control behind an env-selected bootstrap path. Progressive agent applications are the lodestar workload for that contract.**

---

## The question this note is answering

> What is the minimum Wharfie app model that lets a normal Node CLI grow into a scheduled, event-triggered, and later distributed agent application without forcing a rewrite?

And related:

- Should Wharfie optimize for arbitrary executables?
- Should `ActorSystem` remain the root packageable primitive?
- How do we keep agentic apps as the product lodestar without making “agent” the first primitive every user has to learn?

---

## The repo reality today

The current repo already contains most of the runtime ingredients needed for the progression story, but they are exposed through the wrong center of gravity.

### What the repo already supports

- `loadApp()` can load either a plain object export or an `ActorSystem` export and compile a normalized manifest.
- `scheduler-service` already runs cron triggers in UTC.
- `lambda-service` already dispatches named units of work from queue payloads and direct invoke calls.
- `node-agent` already plans and supervises runtime services based on the manifest.
- the graph/operations store already persists `Operation` and `Action` state for longer-lived work.
- `scripts/verify-package-sea.js` proves Wharfie can package a developer-owned TypeScript CLI into a moved SEA artifact and run it without Node on `PATH`.

### What the repo still gets wrong for the product direction

- `runLocalApp()` assumes `invoke(functionName, event, context)`.
- `packageLocalApp()` still rejects anything that is not an `ActorSystem`.
- the packaged artifact surface is still Wharfie-owned: `func`, `ctl`, and `infra`.
- the runtime already wants named callable units, but the public app story is still split between plain manifests, `Function`, and `ActorSystem`.

That means Wharfie is close to the right model, but not there yet.

---

## The product correction

The wrong framing is:

- arbitrary executable vs `ActorSystem`

The right framing is:

- **one app with two surfaces**
  - a developer-owned **CLI surface** for humans
  - a Wharfie-addressable **activity surface** for schedules, queues, workflows, and later placement

That is the smooth progression model.

### Why arbitrary executable is not enough

A raw executable-only contract sounds flexible, but the runtime in this repo does not operationalize argv strings. It operationalizes named units of work:

- scheduler triggers target an `actor`
- lambda-service dispatches `functionName` / `actor`
- `ops run` maps graph actions onto `app.invoke(functionName, event, context)`

If Wharfie makes “arbitrary executable” the only root primitive, the first time a developer wants scheduling, queue triggers, or workflow execution they will need a second app model.

### Why CLI should not be the only primitive either

CLI is a user experience surface, not the runtime contract. Cron, queue polling, workflow execution, and multi-node placement should not depend on parser internals or hidden CLI subcommands.

The stable machine-facing contract should be **activities**.

---

## The design recommendation

### Public contract first

The public contract should be a manifest shape, not a new public class.

The next app model should be built around:

- `name`
- `cli.entrypoint`
- `activities`
- `resources`
- optional `scheduler`, `workflows`, and `targets`

The packaging funnel stays where it already exists:

- `wharfie app manifest`
- `wharfie app package`

Wharfie does not need a new top-level `wharfie build` command for this step.

### Public example

```js
export default {
  name: 'agent-tool',
  cli: {
    entrypoint: './src/cli.js',
  },
  activities: {
    runOnce: {
      entrypoint: './src/activities/run-once.js',
      export: 'run',
    },
    collect: {
      entrypoint: './src/activities/collect.js',
      export: 'run',
    },
  },
  resources: {
    db: { ref: 'default-db' },
    queue: { ref: 'agent-work' },
    objectStorage: { ref: 'default-objects' },
  },
  scheduler: {
    triggers: [{ activity: 'runOnce', cron: '*/15 * * * *' }],
  },
  targets: [{ nodeVersion: '24', platform: 'linux', architecture: 'x64' }],
};
```

### Internal compilation mapping

The public term should be **activities**.

The internal implementation can keep reusing the current runtime plumbing at first:

- `activities` compile onto the existing `manifest.functions` shape
- scheduler triggers can compile from public `activity` to current internal `actor`
- queue envelopes can continue to map onto current `functionName` / `actor` compatibility paths

That keeps the user-facing model cleaner without forcing a full runtime rewrite before the packaging gap is closed.

---

## The smooth progression model

Wharfie should optimize for the following progression.

### Stage 0 — developer-owned CLI

The app is primarily a CLI.

It should:

- preserve normal `process.argv`
- preserve stdio and exit codes
- work with any CLI library
- package through `wharfie app package`
- remain useful as a standalone tool

### Stage 1 — scheduled or event-triggered single-node app

The same app should add:

- cron-triggered activity execution
- queue-triggered activity execution
- persisted run records
- background runtime services on one trusted node

This is where “progressive agent application” becomes a real product use case instead of a slogan.

### Stage 2 — workflow-backed activity runs

The same app should add:

- operation graphs
- action-level persistence
- resumable multi-step work
- inspectable run history

The repo already has most of the substrate for this in the graph and operations store.

### Stage 3 — trusted multi-node placement

Only after the single-node path is coherent should Wharfie add:

- membership
- health
- placement
- work handoff
- upgrade/version skew rules

### Stage 4 — trustless mesh

This is separate from the near-term product roadmap.

Treat it as a later research and security program, not as the first justification for the app model.

---

## Hidden Wharfie bootstrap

Executable artifacts should hide Wharfie internals by default.

That means:

- normal execution enters the developer-owned CLI
- Wharfie lifecycle control is selected by **environment**, not by a public framework command tree
- the installed `wharfie` CLI can remain the authoring and operator tool
- packaged executable artifacts should not expose `func`, `ctl`, or `infra` as the public help surface

The concrete near-term choice is:

- **env-var selected bootstrap mode**

That keeps help output clean and works naturally with Linux/systemd deployment.

---

## Shared resources should be user-scoped references

Wharfie should support persistent resources that several Wharfie apps owned by the same user can share.

The first cut should be limited to the resource types the repo already models cleanly:

- `db`
- `queue`
- `objectStorage`

Those shared references should live in a **config-dir backed registry**, not in the app manifest itself.

The app manifest should only name the reference:

```js
resources: {
  db: { ref: 'default-db' },
  queue: { ref: 'agent-work' },
  objectStorage: { ref: 'default-objects' },
}
```

`lambda` should not be part of this shared resource registry in the first cut. In the current repo, lambda behaves as an execution service inferred from runnable functions, not as a durable user-owned capability.

---

## What should happen to `Function` and `ActorSystem`

### `Function`

`Function` remains a useful internal or advanced primitive for:

- callable units
- workflow nodes
- runtime composition
- packaging activity code and resource metadata

But it should not be the first primitive a user meets when they want to package a CLI.

### `ActorSystem`

`ActorSystem` should move up the stack.

It remains useful for:

- advanced composition
- richer runtime packaging
- internal build graph grouping
- legacy/current compatibility

But it should stop being the only supported packageable app export.

The public packaging contract should be broader than `ActorSystem`.

---

## The atomic unit should be a run, with agent runs as the lodestar

The repo does not yet have a first-class prompt/provider/model runtime. It does have:

- executable packaging
- named callable units
- cron scheduling
- queue dispatch
- node supervision
- persisted `Operation` / `Action` state

So the next operational abstraction should be a **run**.

For this design, **agent runs are the lodestar use case**, but the contract should stay more general than any single prompt/inference provider model.

A run is:

1. one invocation of an activity or workflow
2. created manually, by cron, or by an event source
3. persisted when Wharfie operationalizes it
4. inspectable through Wharfie tooling

That gives Wharfie a real “no rewrite” story:

- CLI commands call activities
- schedules call the same activities
- queue messages call the same activities
- workflow actions call the same activities
- later placement routes the same activities

---

## Immediate near-term cuts implied by this note

1. Add `cli.entrypoint` to the manifest contract.
2. Add public `activities` and compile them onto the existing function/runtime plumbing.
3. Make `wharfie app package` support CLI apps, not only `ActorSystem` exports.
4. Hide Wharfie runtime control behind an env-selected bootstrap path.
5. Generalize Linux/systemd deploy so executable artifacts do not need a public `ctl state start` surface.
6. Add config-dir backed shared resource refs for `db`, `queue`, and `objectStorage`.
7. Persist activity runs on top of the existing `Operation` / `Action` substrate.

### Explicit non-goals for the next implementation cycle

- a new top-level `wharfie build` command
- a public artifact command tree built around `func`, `ctl`, or `infra`
- arbitrary mesh design as the near-term product center of gravity
- trustless networking or reputation systems
- `lambda` as a shared resource registry entry

---

## Evidence from the repo

- [`src/cli/app/load-app.js`](../../src/cli/app/load-app.js) already normalizes plain object exports and `ActorSystem` exports into a manifest. That is the right place to add `cli.entrypoint`, `activities`, and resource refs.
- [`src/cli/app/local-app.js`](../../src/cli/app/local-app.js) shows the current product cliff directly: local execution assumes `invoke(functionName, event, context)` and packaging still rejects non-`ActorSystem` apps.
- [`src/core/runtime/services/scheduler-service.js`](../../src/core/runtime/services/scheduler-service.js) shows cron triggers are already real, UTC-based, and target a named unit of work.
- [`src/core/runtime/services/lambda-service.js`](../../src/core/runtime/services/lambda-service.js) already accepts both legacy `functionName` envelopes and a v2-style `actor` envelope, which is exactly the kind of compatibility bridge this direction needs.
- [`src/core/runtime/services/node-agent.js`](../../src/core/runtime/services/node-agent.js) already turns manifest content into a service plan. That is why hidden bootstrap and deploy generalization matter more than inventing another app abstraction.
- [`src/core/resources/builds/actor-system-cli/index.js`](../../src/core/resources/builds/actor-system-cli/index.js) shows the current packaged artifact surface is still Wharfie-owned (`func`, `infra`, `ctl`). That is the main UX coupling this design is trying to remove for CLI apps.
- [`src/core/runtime/resources.js`](../../src/core/runtime/resources.js) and [`src/core/lib/paths.js`](../../src/core/lib/paths.js) show why shared resource refs should start with `db`, `queue`, and `objectStorage`, and why a config-dir registry is the cleanest first backing store.
- [`src/core/lib/graph/index.js`](../../src/core/lib/graph/index.js) and [`src/core/lib/db/tables/operations.js`](../../src/core/lib/db/tables/operations.js) already provide the substrate for persisted activity runs and longer-lived workflow state.
- [`scripts/verify-package-sea.js`](../../scripts/verify-package-sea.js) is the executable proof that Wharfie packages a developer-owned CLI without taking over ordinary argv and invokes its activity from a moved SEA artifact.
