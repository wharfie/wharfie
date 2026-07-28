# Wharfie application demos

These small applications exercise the strict schemaVersion 3 authoring model:
a developer-owned CLI, named activities, finite workflows, revision-bound UTC
schedules, strict JSON input, and exact package targets. They intentionally do
not expose Wharfie's internal `ActorSystem` or legacy resource-injection
implementation as an authoring API.

## Included handlers

### `apps/hello-world/activities.js`

The smallest activity handler. It accepts JSON `input`, reads immutable caller
metadata from `runtime.caller.metadata`, and returns a JSON result.

## Included applications

### `apps/steady-file/wharfie.app.js`

The product golden path. Its normal CLI checks whether one regular file has
identical contents at two observations 250 milliseconds apart. Its durable
workflow captures the same fingerprint, waits through a framework-owned timer,
then compares fresh bytes and retains the logical matching/different result.
See the
[golden-path guide](../../docs/guides/golden-path.md).

### `apps/hello-world/wharfie.app.js`

The smallest manifest-syntax example. It defines a normal CLI, one named
activity, one finite workflow, an hourly workflow schedule, and exact SEA
targets.

### `apps/kitchen-sink/wharfie.app.js`

A heavier packaging fixture with multiple targets, a scheduled workflow, and
an exact LMDB native package pin. Use it to exercise a target-specific
dependency; use `hello-world` for the normal quick path.

## CLI usage

From the repository root:

```bash
node ./scratch/examples/apps/steady-file/local.js /absolute/path/to/artifact

node ./bin/wharfie app manifest ./scratch/examples/apps/steady-file

node ./bin/wharfie ops start \
  --dir ./scratch/examples/apps/steady-file \
  --workflow verify-stable \
  --idempotency-key artifact-build-42 \
  --input '{"path":"/absolute/path/to/artifact"}' \
  --json

node ./bin/wharfie app manifest ./scratch/examples/apps/hello-world

node ./bin/wharfie app run echo-event \
  --dir ./scratch/examples/apps/hello-world \
  --input '{"who":"wharfie"}'

node ./bin/wharfie app package ./scratch/examples/apps/hello-world

node ./bin/wharfie app manifest ./scratch/examples/apps/kitchen-sink

node ./bin/wharfie app run start \
  --dir ./scratch/examples/apps/kitchen-sink \
  --input '{"who":"wharfie","iterations":32}'
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
