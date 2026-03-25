# Wharfie v2 — next work items from `scratch/test.js`

**Status:** current backlog  
**Last updated:** 2026-03-21  
**Primary reference:** [`scratch/test.js`](../../scratch/test.js)  
**Companion design doc:** [`wharfie-v2.md`](./wharfie-v2.md)

`scratch/test.js` is still the most honest “full-stack” usage example in the repo.
It exercises the raw `Function` + `ActorSystem` primitives, explicit runtime
resources, explicit state persistence, event emitters, cross-target packaging,
and heavyweight native externals. The smaller demos under
[`scratch/examples`](../../scratch/examples/README.md) are useful, but they are
intentionally much narrower.

This document narrows the backlog to the work that actually follows from that
example and from the code that already landed.

## What is already done

The next steps should start from repo reality, not from the older aspirational
checklist.

- Local app loading exists:
  [`src/cli/app/load-app.js`](../../src/cli/app/load-app.js)
- Local app CLI exists:
  [`wharfie app manifest|run|package`](../../src/cli/cmds/app.js)
- `ActorSystem.invoke()` and runtime resource injection exist:
  [`src/core/resources/builds/actor-system.js`](../../src/core/resources/builds/actor-system.js)
- Function-scoped resources and external normalization exist:
  [`src/core/resources/builds/function.js`](../../src/core/resources/builds/function.js),
  [`src/core/resources/builds/lib/resolve-externals.js`](../../src/core/resources/builds/lib/resolve-externals.js)
- Local workflow execution already exists for persisted DAGs:
  [`wharfie ops run`](../../src/cli/cmds/ops_cmds/run.js)
- Provider-neutral default adapter selection already landed:
  [`src/core/runtime/resources.js`](../../src/core/runtime/resources.js),
  [`src/core/lib/db/state/store.js`](../../src/core/lib/db/state/store.js)

That means the immediate work is no longer “make local app commands exist”. The
real gap is fidelity: `scratch/test.js` can express more than the manifest,
packaging path, and artifact runtime can currently preserve.

## What `scratch/test.js` still exposes

1. The current manifest compiler only keeps `name`, `targets`, and top-level
   capabilities. It throws away the most important parts of the example:
   functions, entrypoints, per-function externals, and per-function resources.
2. The packaging flow can build binaries, but the artifact does not boot from an
   embedded app manifest yet. The live JS definition still carries too much of
   the system contract.
3. Workflow execution exists beside the app model instead of inside it.
   `wharfie ops run` can execute a stored DAG, but `wharfie.app.js` still cannot
   define that DAG.
4. The example assumes multi-target builds with native externals are normal.
   Current active tests cover config normalization, not a real end-to-end
   “kitchen sink” package path.
5. The example still relies on low-level constructor injection for `stateDB` and
   `emitter`, which is a sign the public app surface is not finished.

## Prioritized next work items

### P0 — Promote `scratch/test.js` into a supported integration fixture

This is first because the repo still treats its strongest example as a scratch
spike.

Why this is next:

- `scratch/functions/start.js` is still half smoke-test, half placeholder. It
  comments out native imports while still referencing `usb` and
  `sodium-native` later in the file.
- Active Jest coverage exercises the small examples, not the full example shape
  that motivated the rewrite.
- Without a stable fixture, regressions in packaging, externals, and target
  handling will keep slipping through.

Acceptance:

- Move the example into a supported fixture or example directory.
- Split “toy demos” from “kitchen sink packaging/runtime demo”.
- Add active tests that validate the example shape, even if the heavy native
  build path stays behind an opt-in integration gate.

Likely files:

- `scratch/examples/**`
- `test/cli/app/**`
- `test/runtime/resources/**`
- `test/fixtures/apps/**`

### P0 — Expand the manifest compiler so it preserves the real app contract

The current manifest is too thin for the app that `scratch/test.js` describes.

Why this is next:

- `loadApp()` currently discards function definitions, entrypoints, externals,
  environment variables, and function-scoped resources.
- The artifact/runtime side cannot become manifest-driven until the manifest can
  faithfully represent the current low-level API.
- Building a higher-level DSL before this lands would be backwards.

Acceptance:

- Manifest output includes normalized actor/function definitions.
- Per-function `external` dependencies survive compilation.
- Top-level and function-scoped runtime resources survive compilation.
- Manifest serialization is stable enough to be hashed and embedded.

Likely files:

- `src/cli/app/load-app.js`
- `src/cli/app/local-app.js`
- new manifest serializer/helper module under `src/cli/app`
- `test/cli/app/load-app.test.js`
- `test/cli/app/app-commands.test.js`

### P1 — Embed the compiled manifest into SEA artifacts and boot from it

Right now `app package` produces binaries, but not a self-describing app
artifact.

Why this is next:

- `scratch/test.js` ends at `main.reconcile()`, which is the build graph side.
  The artifact still needs the app contract at runtime.
- The rewrite wants “release = file”. That only becomes true once the file
  carries the manifest that describes the app.
- The current artifact CLI already exists; it just needs the app manifest to be
  injected and consumed.

Acceptance:

- `ActorSystem` includes the compiled manifest as a SEA asset.
- The artifact CLI can read that asset at runtime.
- Local `app package` output is enough to inspect the manifest without the
  source tree.

Likely files:

- `src/core/resources/builds/actor-system.js`
- `src/core/resources/builds/sea-build.js`
- `src/core/resources/builds/actor-system-cli/index.js`

### P1 — Join app-defined workflows to the existing operations runtime

The graph runner is real. The app model still ignores it.

Why this is next:

- `wharfie ops run` already executes persisted DAGs against a local app.
- The missing step is authoring those workflows in `wharfie.app.js` and
  compiling them into the manifest.
- Until that happens, workflows remain an internal subsystem instead of a
  first-class v2 feature.

Acceptance:

- `wharfie.app.js` can define workflows using current graph concepts.
- Manifest output includes those workflow definitions.
- CLI can start a workflow by name instead of requiring a pre-seeded operation
  record.
- Workflow action execution keeps passing the existing workflow context fields
  into actor invocations.

Likely files:

- `src/cli/app/**`
- `src/core/lib/graph**`
- `src/cli/cmds/ops_cmds/*.js`
- `src/core/resources/builds/actor-system-cli**`
- `test/graph/**`
- `test/cli/cmds/**`

### P1 — Add target selection UX and end-to-end native externals coverage

`scratch/test.js` defines multiple targets on purpose. The current packaging UX
still assumes tiny demo apps.

Why this is next:

- `app package` currently packages every target in the app with no filtering.
- Native externals are one of the hardest parts of the example, yet active tests
  stop at normalization and light integration coverage.
- A real app needs a way to say “build just linux-x64” without editing source.

Acceptance:

- Add a CLI target filter (`--target`, or equivalent platform/arch flags).
- Add active end-to-end tests for at least one native external package path.
- Keep the heaviest cross-target cases optional if sandbox limits make them too
  expensive for the default suite.

Likely files:

- `src/cli/cmds/app_cmds/package.js`
- `src/cli/app/local-app.js`
- `src/core/resources/builds/lib/install-deps.js`
- `test/cli/app/**`
- `test/runtime/resources/**`

### P2 — Make the runtime services reflect the packaged app manifest

The build graph is ahead of the runtime supervisor.

Why this is next:

- The repo already has `node-agent`, `queue-service`, `db-service`, and the
  function executor service.
- What is missing is automatic runtime wiring from the packaged app definition.
- Until the runtime is manifest-driven, the artifact is still closer to a build
  output than a full deployable product.

Acceptance:

- Runtime service startup reads manifest-defined capabilities.
- Queue pollers and DB service startup are driven by the packaged app, not by
  repo-local assumptions.
- Scheduler service exists and is wired for leader-only cron handling.

Likely files:

- `src/core/runtime/services/node-agent.js`
- `src/core/runtime/services/queue-service.js`
- `src/core/runtime/services/db-service.js`
- `src/core/runtime/services/lambda-service.js`
- new `src/core/runtime/services/scheduler-service.js`

### P2 — Replace ad-hoc `stateDB` and `emitter` injection with first-class configuration

`scratch/test.js` still has to hand-wire internals that should become product
surface.

Why this is next:

- Passing `stateDB` and a raw `EventEmitter` directly into `ActorSystem` is fine
  for spikes, but it is not a finished application contract.
- The reconciliation/build/runtime paths need a stable story for telemetry,
  progress reporting, and persisted state.
- This is the missing bridge between low-level primitives and the eventual
  artifact-side UX (`status`, `logs`, `deploy`, `rollback`).

Acceptance:

- Telemetry has a stable interface instead of ad-hoc emitter wiring.
- State store configuration flows from the same manifest/resource model as the
  rest of the runtime.
- CLI output can subscribe to structured build/runtime events without depending
  on constructor-time custom wiring.

Likely files:

- `src/core/resources/builds/actor-system.js`
- `src/core/resources/reconcilable.js`
- `src/cli/output/**`
- `src/core/lib/db/state/store.js`

### P3 — Finish artifact-side deploy/status/logs/rollback UX

This is still part of the plan, but it is not the next blocker.

Why this is later:

- Shipping deploy UX before the manifest/runtime contract is finished would hard
  code the wrong abstractions.
- The artifact CLI already has the right direction; it just should not outrun
  the manifest work.

Acceptance:

- Artifact can deploy itself using packaged manifest data.
- `status`, `logs`, and `rollback` operate on artifact-defined releases.
- Linux/systemd remains the first deployment target without blocking
  macOS/Windows local development.

Likely files:

- `src/core/resources/builds/actor-system-cli**`
- `src/core/resources/node.js`
- `src/core/lib/hetzner**`

## Recommended execution order

1. Stabilize the `scratch/test.js` example as a supported fixture.
2. Make the manifest faithfully represent the current low-level API.
3. Embed that manifest into SEA artifacts.
4. Hang workflow authoring and runtime startup off the manifest.
5. Add target filtering and heavier packaging coverage.
6. Only then finish artifact-side deployment UX.

## One explicit non-goal

Do not start with a prettier DSL.

The blocker is not syntax. The blocker is that the current build and runtime
path still lose information that `scratch/test.js` already knows. Preserve that
information first, then decide how much nicer the authoring surface should be.
