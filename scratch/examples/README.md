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
```

`app package` copies built artifacts into `<app dir>/dist` by default. The demo
apps use the current host Node version, platform, and architecture as their
single target so the command is immediately packageable without editing the app
source.

## Optional test coverage

`test/cli/app/examples.test.js` exercises the demos through the existing
`Function`, `ActorSystem`, and `loadApp()` APIs.