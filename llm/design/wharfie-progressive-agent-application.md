# Wharfie progressive agent application

**Status:** draft design note  
**Last updated:** 2026-03-26  
**Audience:** maintainers refining Wharfie’s app model and packaging contract

- Related design doc: [`wharfie-v2.md`](./wharfie-v2.md)
- Repo evidence for current app loading: [`src/cli/app/load-app.js`](../../src/cli/app/load-app.js)
- Repo evidence for current local run/package behavior: [`src/cli/app/local-app.js`](../../src/cli/app/local-app.js)
- Current `Function` primitive: [`src/core/resources/builds/function.js`](../../src/core/resources/builds/function.js)
- Current `ActorSystem` primitive: [`src/core/resources/builds/actor-system.js`](../../src/core/resources/builds/actor-system.js)
- Current packaged artifact CLI: [`src/core/resources/builds/actor-system-cli/index.js`](../../src/core/resources/builds/actor-system-cli/index.js)
- Current custom CLI proof case: [`apps/wharfie-v1/wharfie.app.js`](../../apps/wharfie-v1/wharfie.app.js)
- Current graph + operations persistence: [`src/core/lib/graph/index.js`](../../src/core/lib/graph/index.js) and [`src/core/lib/db/tables/operations.js`](../../src/core/lib/db/tables/operations.js)
- Current scheduler service: [`src/core/runtime/services/scheduler-service.js`](../../src/core/runtime/services/scheduler-service.js)
- Current node supervisor: [`src/core/runtime/services/node-agent.js`](../../src/core/runtime/services/node-agent.js)

---

## One sentence

**A Wharfie app should fundamentally be one executable artifact per target that starts as a short-lived agentic CLI, grows into a stateful scheduled or event-triggered agent application, and only later expands into trusted or trustless mesh participation — without forcing the developer to adopt a Wharfie-owned end-user CLI surface.**

---

## The question this note is answering

> What is the minimum contract for a normal Node CLI to become a Wharfie executable without adopting any Wharfie-owned command surface at all?

And related:

- Is `Function` the right first primitive?
- Does `ActorSystem` currently sit too low in the stack?
- What kinds of applications actually fit the “same binary grows into a mesh” model?

---

## The answer in plain English

Not quite: **today the closest primitive is `Function`, but that is not the right long-term minimum contract**.

It is the closest thing because it already points at code via:

```js
const start = new Function({
  name: 'start',
  entrypoint: {
    path: path.resolve(scratchDir, 'functions', 'start.js'),
    export: 'start',
  },
});
```

But that is still modeling a **callable handler symbol**, not a **normal executable program entrypoint**.

For a normal Node CLI, the minimum contract should be smaller and less opinionated:

- where the executable starts
- what the executable is called
- which targets to build
- optionally, which progressive runtime capabilities it opts into

That means the first-class root primitive should probably be **`Executable`** or **`Program`**, not `Function` and not `ActorSystem`.

`Function` can remain valuable, but as an **optional advanced primitive** for actor invocation, workflows, graph execution, and RPC-style callable units.

---

## Repo reality today

### What works already

The current repo already supports a surprising amount of this story:

- `loadApp()` can load a plain object export or an `ActorSystem` export and compile a manifest from it.
- `Function` already provides a way to point Wharfie at code and invoke it in-process or from a packaged bundle.
- SEA packaging is real and already produces a single artifact per target.
- the runtime already has scheduling, services, persisted operation DAGs, and node-agent groundwork.
- `apps/wharfie-v1/wharfie.app.js` proves Wharfie can package a custom CLI into a single binary.

### What is still too opinionated

There are three places where the current framework still collapses toward a more opinionated function-host model:

1. **`Function` is the smallest current code primitive**  
   It assumes a named callable unit, optional exported symbol, and `event/context` invocation semantics.

2. **local run assumes `invoke(functionName, event, context)`**  
   `src/cli/app/local-app.js` treats “runnable app” as something exposing `invoke(...)`.

3. **packaging only supports `ActorSystem` exports**  
   `packageLocalApp()` explicitly rejects anything that is not an `ActorSystem`.

So the current truth is:

- **yes**, Wharfie can already point at code
- **no**, a normal Node CLI is not yet a first-class minimal Wharfie app
- **no**, `Function` by itself is not enough to “become a Wharfie executable” through the supported packaging path

That last point matters. Right now, a developer who wants a custom CLI executable either:

- wraps things in `ActorSystem`, or
- writes a bespoke build driver like `apps/wharfie-v1/wharfie.app.js`

That is a useful proof case, but not yet the desired product contract.

---

## Why `Function` is close, but not the right first primitive

`Function` is not wrong. It is just a level too high and too specific for step 1.

### What `Function` is good at

`Function` is a good primitive when Wharfie is doing any of the following:

- invoking a named handler
- routing work through a scheduler or queue
- representing a node in a workflow graph
- packaging a callable unit with resource metadata
- exposing a consistent `event/context` invocation model

That makes it a strong primitive for **actors**, **workflows**, and **internal callable units**.

### Why it is confusing as the first thing a user meets

For a developer trying to package a normal CLI, `Function` is awkward because:

- the name collides with the JavaScript built-in `Function`
- it implies serverless/handler semantics rather than “this is my program”
- it pushes users toward `event/context` mental models too early
- it requires `export` selection when a normal CLI often just needs module execution
- it nudges Wharfie toward a function-host identity instead of an executable-first identity

### Recommendation on naming

- Keep `Function` as an internal/advanced primitive for actor and workflow composition.
- Do **not** make `Function` the public foundational primitive for the first “package my Node CLI” step.
- Introduce a lower-level primitive such as:
  - `Executable`
  - `Program`
  - `Entry`

Of those, **`Executable`** is the clearest user-facing name.

---

## The minimum contract

A normal Node CLI should be able to become a Wharfie executable with this minimum contract:

### Required

1. **app identity**
   - `name`
   - default source: `package.json.name`

2. **entrypoint**
   - path to the module that should become the process root
   - for a CLI, this should usually mean **module execution**, not “call export X with event/context”

3. **target set**
   - one or more target triples
   - if omitted, the current host target is a reasonable default for the baby-step path

### Optional

4. **packaging metadata**
   - external dependencies
   - assets
   - environment variables

5. **runtime capabilities**
   - local state
   - scheduler
   - graph execution
   - services/resources

6. **agent capabilities**
   - single-node service mode
   - trusted mesh participation
   - trustless mesh participation

### Explicitly not required for step 1

A developer should **not** need any of the following just to package a CLI:

- `ActorSystem`
- `Function`
- `invoke(functionName, event, context)`
- workflows
- queues
- databases
- a Wharfie-owned command tree inside the artifact

---

## The atomic unit should be an agent run

For the next product cut, Wharfie should optimize for the lifecycle of a single **agent run**, not a resident node.

A run is the smallest end-to-end unit of useful agent work:

1. fetch or derive context
2. build the prompt or model request
3. submit inference
4. optionally block for the response
5. render, persist, or forward the result
6. exit with a normal process status

That flow is still just a normal executable. It fits the developer-owned CLI story on day one, and it maps cleanly onto the repo’s existing `Operation`/`Action` persistence model once Wharfie starts operationalizing the same flow.

This framing also gives Wharfie a much cleaner progression story:

- a **run** is one unit of agent work
- a **schedule** creates runs automatically
- an **event trigger** creates runs from external stimuli
- a **service** keeps the executable warm so it can launch runs continuously
- a **mesh** is only a later placement and coordination strategy for runs

That is the priority correction this design note needed: **mesh is not the first proof point**. The first proof point is that Wharfie can help developers build and operationalize useful one-shot agent runs.

---

## The right progression model

The product concept here is not “app framework with optional deployment.”

The better model is:

### Progressive agent application

A **progressive agent application** is a single executable artifact per target whose operational envelope expands in stages.

### Stage 0 — short-lived agentic CLI

The binary:

- runs locally
- owns its own CLI UX
- fetches or builds context
- submits inference
- can block and wait for a response
- exits normally

Wharfie provides only:

- packaging
- artifact metadata
- target builds
- optional local dev helpers
- a tiny executable app contract

### Stage 1 — operationalized single-node agent

The same binary can also:

- persist run history and local state
- collect, catalog, archive, and re-use context data
- schedule recurring runs
- supervise lightweight background collection jobs
- expose inspectable run records

Wharfie adds:

- state store
- operations/run persistence
- scheduler
- context catalog primitives
- deployment helpers for a resident single-node process

### Stage 2 — event-triggered / agent-triggered application

The same binary can also:

- respond to queues, webhooks, file changes, or other event sources
- accept work from other agents or orchestrators
- apply idempotency and dedup rules to incoming runs
- preserve provenance for who or what triggered a run
- keep the developer’s public CLI separate from Wharfie’s operational plumbing

Wharfie adds:

- trigger normalization
- ingress/auth hooks
- run envelopes and provenance metadata
- concurrency / dedup controls
- internal control-plane plumbing

### Stage 3 — trusted multi-node mesh

Only after stages 0-2 are solid should the same binary also:

- discover peers
- advertise capabilities
- assign or rebalance work
- recover from node loss
- replicate or redistribute selected state

Wharfie then adds:

- membership
- health
- routing
- placement
- work handoff
- upgrade/version skew rules

### Stage 4 — trustless mesh

Only after trusted mesh is proven should the same binary also:

- operate across partially trusted or untrusted peers
- validate peer identity
- sign protocol messages
- protect against abuse and replay
- tolerate hostile network conditions

Wharfie then adds:

- identity
- trust bootstrap
- authorization policy
- signed protocols
- reputation/quarantine or similar safety mechanics

The key idea is that **these are modes of the same artifact**, but the delivery order matters: short-lived runs first, operationalization second, evented flows third, mesh later.

---

## The interface should be mode-based, not framework-command-based

If the goal is “no Wharfie-owned command surface in the artifact,” then Wharfie should avoid shipping artifacts that are primarily entered through framework commands like `func`, `ctl`, or `infra`.

Instead:

- the user-facing CLI belongs to the developer
- the executable’s default behavior stays user-owned
- Wharfie-specific lifecycle behavior is selected through **mode** or **environment**, not by taking over the visible CLI surface

That means the important interface is not:

- “what commands does this Wharfie app expose?”

It is:

- “what process lifecycle can this executable participate in?”
- “what kinds of triggers can create new runs?”

### Two axes matter more than one mode list

#### Process lifecycle

- `exec` — run once and exit
- `service` — stay resident on one trusted node
- `mesh` — join a trusted mesh
- `mesh-trustless` — join a trustless mesh

#### Run activation

- `manual` — user or script starts a run directly
- `schedule` — cron or interval creates runs automatically
- `event` — external events create runs
- `agent` — another agent or orchestrator creates runs

For the next roadmap cut, Wharfie should prioritize these combinations in order:

1. `exec + manual`
2. `exec/service + schedule`
3. `service + event/agent`
4. `mesh + schedule/event/agent`

These do **not** need to be end-user commands. They can be runtime launch modes or trigger sources selected by:

- config
- environment variables
- deployment profile
- internal bootstrap flags
- an external Wharfie management tool

That keeps the developer’s CLI intact while giving Wharfie a real operational model behind the scenes.

---

## What the minimum UX should probably look like

There should be two onboarding paths.

### Path A — zero-code packaging path

A normal Node CLI should be buildable directly from its entrypoint without first writing a Wharfie app object.

Example direction:

```bash
wharfie build --entrypoint ./src/cli.js --name my-tool
```

Or, even lower friction:

```bash
wharfie build
```

with resolution order:

1. explicit `--entrypoint`
2. `package.json.bin`
3. `package.json.main`

This is the fastest baby step.

### Path B — tiny manifest path

When users want reproducible targets and optional capabilities, they can add a very small `wharfie.app.js`.

Example:

```js
export default {
  name: 'my-tool',
  executable: {
    entrypoint: './src/cli.js',
  },
  targets: [
    { nodeVersion: '24', platform: 'linux', architecture: 'x64' },
  ],
};
```

That should be enough to:

- inspect the manifest
- package a single executable per target
- embed metadata into the artifact
- leave the user’s CLI completely untouched

No `Function`. No `ActorSystem`. No framework-owned command surface.

---

## What should happen to `ActorSystem`

`ActorSystem` should move **up** the stack.

Today it acts like the main packageable unit. That feels too opinionated for the product direction emerging here.

### Proposed role change

`ActorSystem` should become an **optional advanced runtime layer** built on top of the lower-level executable primitive.

In that model:

- `Executable` is the default packaging unit
- `ActorSystem` is one higher-level composition model
- workflows/graphs are optional
- resource-backed actor invocation is optional
- deployment and mesh features can exist without forcing every app into a function catalog

### Practical implication

`packageLocalApp()` should eventually package any valid executable app, not only `ActorSystem` instances.

That is probably the most important implementation change implied by this note.

---

## What should happen to the current artifact CLI

The current packaged artifact path is still centered around Wharfie-owned internal CLI commands.

That is useful infrastructure, but it is the wrong default if the product is trying to be:

- executable-first
- user-CLI-preserving
- viral/progressive

### Recommendation

Wharfie operational control should move toward one of these patterns:

1. **out-of-band management**
   - the installed `wharfie` CLI manages artifacts and running nodes externally

2. **internal control plane, not user surface**
   - a local socket / localhost RPC / control endpoint reserved for Wharfie internals

3. **reserved hidden bootstrap flags**
   - only for launching service/mesh modes, not as part of the app’s public UX

The important rule is:

**Wharfie can own operational plumbing without owning the application’s end-user command surface.**

---

## What kinds of applications fit this model best

The best fit is not “all apps.”

The strongest fit is:

**portable tools that are useful alone, more useful when resident, and even more useful when many copies cooperate.**

### Strong fits

- sync / backup / replication tools
- automation agents
- crawlers / collectors / indexers
- build, test, or execution workers
- local-first collaboration backends
- edge cache / mirror / distribution tools
- log / event / telemetry collectors
- developer tools that can later become shared infrastructure

### Weak fits

- plain CRUD web apps whose center of gravity is a central database
- systems requiring heavy, globally consistent transactions from day one
- purely UI-first products where the executable is secondary
- apps that never benefit from residency or peer cooperation

This matters because the product promise should match the kinds of software that actually get better as they move from:

- local
- to resident
- to mesh

---

## Stress tests for this direction

### Stress test 1 — can a normal CLI stay totally normal?

It should.

A Wharfie executable should be able to preserve:

- normal `process.argv`
- normal stdio
- normal exit codes
- whatever CLI library the developer wants

If Wharfie requires wrapping the whole app in framework-specific subcommands, the design is too opinionated.

### Stress test 2 — can service/mesh behavior be added without rewriting the app model?

It should.

The same artifact should be able to gain:

- local state
- scheduler
- internal services
- peer membership

without the developer having to throw away the original CLI shape.

### Stress test 3 — does the developer need to think in “handlers” too early?

They should not.

If the first baby step requires `event/context`, named handlers, or workflow nodes, Wharfie is introducing advanced runtime abstractions too early.

### Stress test 4 — can Wharfie still support workflows and graph execution?

Yes, as an optional layer.

This direction does **not** reject functions, actors, workflows, services, or resources. It just says those should be optional capabilities layered on top of an executable-first base.

### Stress test 5 — does the mesh story get ahead of itself?

This is the biggest risk.

“Many trusted nodes” and “many trustless nodes” are radically different problems.

Wharfie should treat these as separate maturity levels:

1. local self-supervision
2. trusted clustered nodes
3. trustless p2p mesh

If those are blurred together, the design will overpromise.

---

## Recommended terminology

### Good design umbrella term

**Progressive agent application** is a good design phrase.

It captures:

- same artifact
- staged growth
- local-to-mesh progression
- agent-like behavior when always-on or networked

### Good API-level terms

Use shorter, more mechanical names in code:

- `Executable` for the base packageable primitive
- `Agent` or `AgentRuntime` for service/mesh capabilities
- keep `Function` only for callable units inside higher-level actor/workflow systems

### Terms to avoid as the first concept users meet

- `Function` as the root packaging primitive
- `ActorSystem` as the default app identity
- “serverless” as the central framing

Those terms are still useful internally, but they are not the cleanest starting point for the product direction described here.

---

## Concrete product recommendation

Wharfie should define its app model in four layers.

### Layer 1 — executable

The smallest buildable unit.

Needs only:

- `name`
- `entrypoint`
- `targets`

This is the baby step for a normal Node CLI.

### Layer 2 — agent run

Optional but near-term application semantics for the same executable.

Adds:

- context acquisition or derivation
- prompt/request construction
- inference submission
- blocking or streaming response handling
- a normalized run record shape

This is the actual first wedge for agentic application development.

### Layer 3 — operational agent runtime

Optional runtime behaviors for the same executable.

Adds:

- local state
- context cataloging and archival
- run persistence
- scheduling
- event/agent triggers
- self-supervision and deployment/runtime bootstrap

### Layer 4 — distributed agent

Optional networked behaviors for the same executable.

Adds:

- trusted mesh
- later trustless mesh
- routing, membership, placement, healing
- work and state distribution

### Optional composition layers above that

Built on top, not beneath:

- `Function`
- `ActorSystem`
- graph/workflow execution
- persistent services/resources
- deploy/status/logs/rollback tooling

That stack feels aligned with the repo’s deeper direction while keeping the first-user experience much simpler and much more obviously useful for agentic application development.

---

## Immediate design conclusion

If the question is:

> What is the minimum contract for a normal Node CLI to become a Wharfie executable without adopting any Wharfie-owned command surface at all?

Then the answer should be:

**A name, an executable entrypoint, and a target set — with `Function` and `ActorSystem` moved up into optional advanced layers rather than being the first thing every app must become.**

And if the question is:

> Is `Function` the right term or primitive for the first step?

Then the answer is:

**It is useful, but not as the first primitive.** It models a callable handler, not a whole executable program.

And if the question is:

> What product concept are we circling around?

Then the answer is:

**Wharfie as a framework for progressive agent applications: single executables that start as useful agent runs, then become persistent scheduled or event-triggered agent systems, and only later become self-healing networked applications.**

---

## Prioritized future work

### Milestone 1 — short-lived agentic executable

Ship a plain CLI packaging story that supports one-shot runs first.

Wharfie work:

1. **Add a lower-level executable app shape**
   - support `executable.entrypoint` in `wharfie.app.js`
   - package it without requiring `ActorSystem`

2. **Add a zero-code build path**
   - let `wharfie build` target a normal Node CLI entrypoint directly
   - infer from `package.json.bin` when possible

3. **Define a minimal agent run contract**
   - treat “context → prompt/request → inference → output” as a first-class design pattern
   - keep model/provider specifics outside the root app primitive

4. **Preserve the developer’s CLI surface**
   - do not inject Wharfie-owned public commands into every artifact by default

Explicit non-goals for this milestone:

- background daemons
- scheduling
- event ingress
- mesh participation

### Milestone 2 — operationalized runs

Take the same executable and make repeated runs inspectable, durable, and schedulable.

Wharfie work:

1. **Persist run records using the existing operations/graph substrate**
   - map agent runs onto `Operation`/`Action` records where it helps
   - capture trigger metadata, status, outputs, and references to archived context

2. **Add context cataloging and archival primitives**
   - support active collection jobs
   - store snapshots/artifacts that later runs can reference
   - make retention and rehydration explicit

3. **Operationalize scheduling**
   - use the existing scheduler service as the first trigger engine
   - schedule runs, not bespoke long-lived handlers

4. **Treat `ActorSystem` as optional**
   - keep it for function catalogs, workflows, and runtime composition
   - stop treating it as the root packaging contract

Explicit non-goals for this milestone:

- peer discovery
- distributed placement
- trustless protocols

### Milestone 3 — event-triggered and agent-triggered runs

Support agents invoking agents and event-driven execution without changing the artifact identity.

Wharfie work:

1. **Define trigger ingress contracts**
   - queue, webhook, file, or other event sources should all create normalized runs

2. **Define agent-to-agent invocation envelopes**
   - preserve provenance, auth hooks, and structured payloads

3. **Add idempotency and concurrency controls**
   - dedup runs
   - limit fan-out
   - guard against replay or overlapping execution

4. **Use resident service mode only as needed**
   - keep service residency in service of evented runs
   - do not let “daemon mode” become the whole product story

### Milestone 4 — trusted mesh

Only after the first three milestones are solid should Wharfie invest in distributed placement for runs.

Wharfie work:

- membership
- health
- routing
- placement
- work handoff
- version-skew management

### Milestone 5 — trustless mesh

Treat this as a separate research and security program, not a near-term product milestone.

Wharfie work:

- identity bootstrap
- signed protocols
- authorization policy
- abuse resistance
- quarantine/reputation mechanics

That sequence preserves the current repo’s strengths while finally putting the near-term product energy where the repo is most likely to win: short-lived agentic executables first, operationalized agent runtimes second, evented flows third, distributed mesh much later.
