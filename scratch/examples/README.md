# Function + ActorSystem demos

These are small, drop-in examples for Wharfie's in-process `Function`,
`ActorSystem`, and `wharfie app` CLI APIs.

## Included demos

### `functions/echo-event.js`

The smallest possible `Function` handler.

- takes an input event
- reads a simple value from `context`
- returns normalized output

### `functions/hello-resources.js`

A resource-backed `Function` handler.

- writes and reads a DB record
- sends and receives a queue message
- writes and reads an object-storage object
- demonstrates `context.resources.{db, queue, objectStorage}`

### `functions/inspect-context.js`

A tiny `Function` handler that reports what arrived in `context`.

- useful for showing how `ActorSystem.createContext()` merges system resources
  with caller-provided overrides

### `actor-systems/hello-world/wharfie.app.js`

A complete `ActorSystem` app that wires together the function demos, vanilla
runtime resources, and a packageable target for the current Node/platform.

### `actor-systems/context-override/wharfie.app.js`

A minimal `ActorSystem` app that demonstrates how caller-provided
`context.resources` values are merged on top of system resources.

### `actor-systems/kitchen-sink/wharfie.app.js`

A supported parity fixture for the older `scratch/test.js` workflow.

- uses multiple build targets
- points at the real `scratch/functions/start.js` entrypoint
- defines top-level `ActorSystem` resources
- defines function-scoped runtime resources
- carries heavyweight/native externals metadata for packaging-oriented flows

Use this when you want a realistic inspection/load/invoke example. Keep using
`hello-world` and `context-override` when you want the smallest possible demo.

Packaged SEA artifacts now embed the compiled app manifest. Once you package an
app, inspect that embedded manifest from the artifact itself with:

```bash
./dist/<artifact-name> ctl manifest
```

Packaged artifacts can also manage Linux/systemd releases without the source
tree. The first-class artifact-side flow is:

```bash
./dist/<artifact-name> infra deploy --dry-run --json
./dist/<artifact-name> infra status --json
./dist/<artifact-name> infra logs --dry-run --json
./dist/<artifact-name> infra rollback --dry-run --json
```

## CLI usage

From the repo root:

```bash
node ./bin/wharfie app manifest ./scratch/examples/actor-systems/hello-world

node ./bin/wharfie app run echo-event \
  --dir ./scratch/examples/actor-systems/hello-world \
  --event '{"who":"wharfie"}'

node ./bin/wharfie app run hello-resources \
  --dir ./scratch/examples/actor-systems/hello-world \
  --event '{"who":"wharfie"}'

node ./bin/wharfie app package \
  ./scratch/examples/actor-systems/hello-world

node ./bin/wharfie app manifest \
  ./scratch/examples/actor-systems/kitchen-sink

node ./bin/wharfie app run start \
  --dir ./scratch/examples/actor-systems/kitchen-sink \
  --event '{"who":"wharfie","iterations":32}'
```

`app package` copies built artifacts into `<app dir>/dist` by default. The tiny
`hello-world` and `context-override` demos intentionally use a single host
target so they stay immediately packageable without editing app source. The
`kitchen-sink` fixture intentionally keeps multiple targets and heavyweight
external metadata so it mirrors `scratch/test.js` more closely.

## Optional test coverage

`test/cli/app/examples.test.js` exercises the demos through the existing
`Function`, `ActorSystem`, and `loadApp()` APIs. The heavier host-native
externals smoke test is opt-in so default CI stays fast and hermetic:

```bash
WHARFIE_RUN_NATIVE_EXTERNALS=1 TZ=UTC \
  node ./test/run-jest.js --runInBand \
  test/cli/app/kitchen-sink-native-externals.test.js
```
