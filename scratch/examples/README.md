# Wharfie application demos

These small applications exercise the strict schemaVersion 2 authoring model:
a developer-owned CLI, named activities, portable resources, and exact package
targets. They intentionally do not expose Wharfie's internal `ActorSystem`
implementation as an authoring API.

## Included handlers

### `apps/hello-world/functions/echo-event.js`

The smallest activity handler. It accepts a JSON event, reads ordinary context,
and returns a JSON result.

### `apps/hello-world/functions/hello-resources.js`

A resource-backed handler that exercises
`context.resources.{db, queue, objectStorage}`.

### `apps/context-override/activity.js`

A handler that reports the context and resource overrides it receives.

## Included applications

### `apps/hello-world/wharfie.app.js`

The primary approachable example. It defines a normal CLI, two activities,
portable vanilla resources, and exact SEA targets.

### `apps/context-override/wharfie.app.js`

A minimal example showing that caller-provided resource values override the
application's base resources for one activity invocation.

### `apps/kitchen-sink/wharfie.app.js`

A heavier packaging fixture with multiple targets and an exact LMDB native
package pin. Use it to exercise a target-specific dependency; use
`hello-world` for the normal quick path.

## CLI usage

From the repository root:

```bash
node ./bin/wharfie app manifest ./scratch/examples/apps/hello-world

node ./bin/wharfie app run echo-event \
  --dir ./scratch/examples/apps/hello-world \
  --event '{"who":"wharfie"}'

node ./bin/wharfie app run hello-resources \
  --dir ./scratch/examples/apps/hello-world \
  --event '{"who":"wharfie"}'

node ./bin/wharfie app package ./scratch/examples/apps/hello-world

node ./bin/wharfie app manifest ./scratch/examples/apps/kitchen-sink

node ./bin/wharfie app run start \
  --dir ./scratch/examples/apps/kitchen-sink \
  --event '{"who":"wharfie","iterations":32}'
```

`app package` writes artifacts to `<app dir>/dist` by default. A packaged
artifact exposes its embedded canonical manifest through:

```bash
./dist/<artifact-name> wharfie manifest
```

The native-externals smoke test is opt-in so normal CI remains fast and
hermetic:

```bash
WHARFIE_RUN_NATIVE_EXTERNALS=1 TZ=UTC \
  node ./test/run-jest.js --runInBand \
  test/cli/app/kitchen-sink-native-externals.test.js
```
