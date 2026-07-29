# Single-host developer preview

This is Wharfie's shortest supported preview path: create a verified npm
tarball, install it into a clean builder workspace, copy the packaged starter,
build one application SEA, and let that executable install and operate its own
Linux service.

The tarball handoff and same-host Linux lifecycle are implemented. The current
milestone is not closed until one checksummed run builds on a separate machine
and proves that a later process observes unfinished work before systemd
completes it.

## Create the Wharfie handoff

The preview remains intentionally unpublished. From a Wharfie source checkout
using the exact Node and npm versions in `package.json`:

```bash
npm ci
npm run verify:package
mkdir -p /absolute/path/to/wharfie-handoff
npm pack --ignore-scripts \
  --pack-destination /absolute/path/to/wharfie-handoff
```

`verify:package` creates and removes its own temporary tarball and npm cache.
The final `npm pack` command creates the intentional handoff artifact only in
the explicit directory.

## Build from the installed starter

In a clean builder workspace:

```bash
npm init -y
npm install --no-audit --no-fund \
  /absolute/path/to/wharfie-handoff/wharfie-wharfie-0.0.15.tgz

cp -R node_modules/@wharfie/wharfie/examples/steady-file ./steady-file

node ./steady-file/local.js /absolute/path/to/artifact.tar

./node_modules/.bin/wharfie app manifest ./steady-file

./node_modules/.bin/wharfie app package ./steady-file \
  --target node24.13.1-linux-x64-glibc \
  --output-dir ./dist \
  --json
```

Use `node24.13.1-linux-arm64-glibc` for an arm64 target. The package receipt
names the generated executable and its content-addressed verification record.
Transfer that packaged handoff to the target; do not copy the builder's
`node_modules`, source checkout, npm cache, or Wharfie control state.

## Carry work beyond the shell

On a non-root Linux target with a usable systemd user manager, call the
generated executable `<steady-file>`:

```bash
<steady-file> /absolute/path/to/artifact.tar

<steady-file> wharfie start \
  --json \
  -- /absolute/path/to/artifact.tar

<steady-file> wharfie service install --json

<steady-file> wharfie inspect --run-id <run-id> --json
```

The ordinary command observes the file for 250 milliseconds. The durable
workflow uses a one-minute framework timer. Close the initiating shell while
`inspect` reports `RUNNING` with a `TIMER_WAITING` cursor.

In a later shell:

```bash
<steady-file> wharfie list --limit 10 --json

<steady-file> wharfie inspect --run-id <run-id> --json

<steady-file> wharfie output \
  --run-id <run-id> \
  --confirm-sensitive-output \
  --json
```

`list` rediscovers app-scoped runs. `inspect` is redacted. `output` explicitly
discloses application values, including the file path and fingerprints.

## Stop the preview service

```bash
<steady-file> wharfie service uninstall --json
```

Uninstall removes systemd wiring but deliberately preserves durable state and
immutable releases. A safe, explicitly confirmed purge operation is still an
open exit condition for this preview milestone. Until it lands, use a
disposable target for complete cleanup; deleting arbitrary Wharfie data paths
by hand is not part of this guide.

For the full update, rollback, inspection, and evidence discussion, see the
[golden-path guide](./golden-path.md).
