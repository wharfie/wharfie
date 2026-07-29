# Single-host developer preview

This is Wharfie's shortest supported preview path: create a verified npm
tarball, install it into a clean builder workspace, copy the packaged starter,
build one application SEA, and let that executable install and operate its own
Linux service.

The tarball handoff, clean builder/target acceptance harness, and Linux
lifecycle are implemented and accepted. The
[checksummed checkpoint](../../llm/checkpoints/2026-07-29-single-host-developer-preview.md)
proves that a later process observes the same unfinished work before systemd
completes it.

## Run the acceptance proof

On macOS with Lima installed, an exact Node 24.13.1 executable active, at least
15 GiB free, and a clean committed worktree:

```bash
npm run verify:steady-file:systemd:lima
```

The proof creates a builder VM, installs the repository tarball into a clean
consumer, packages revisions A and B, and copies an exact checksummed six-file
handoff to the host. It deletes the builder before creating a separate target
VM with no Node, npm, repository mount, or container runtime. Two distinct host
controller processes then prepare unfinished durable work and return to
observe and complete it before exercising update, rollback, uninstall, prune,
and purge.

Builder and target VMs run sequentially. The proof keeps its Lima home and
cache inside one owned temporary directory and removes the VMs, cache, package
workspace, input, and SEA handoff on success or failure. A successful run
retains only bounded `builder.json`, `prepare.json`, `final.json`,
`cleanup.json`, and `SHA256SUMS` under
`llm_artifacts/steady-file-systemd-proof/<commit>/`. The disk preflight occurs
before Lima creates a VM or downloads an image.

The accepted commit is `39be8d604fedb99ee798c64dcf50a74c456606c4`;
its [receipt directory](../../llm_artifacts/steady-file-systemd-proof/39be8d604fedb99ee798c64dcf50a74c456606c4/)
and [checkpoint](../../llm/checkpoints/2026-07-29-single-host-developer-preview.md)
are retained. The command remains a reusable regression gate for later
commits.

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
<steady-file> wharfie service purge \
  --confirm-data-loss steady-file-demo \
  --json
```

Uninstall removes systemd wiring but deliberately preserves durable state and
immutable releases. Purge is the separate irreversible boundary: it requires
the exact embedded app ID, an uninstalled service, no live runtime owner, and
only terminal durable runs. It removes that app's releases, ledger, payloads,
and application state while preserving sibling apps, shared Wharfie/systemd
directories, and the invoking SEA.

Run no other command from the application concurrently with purge. The preview
rechecks ownership and quiescence immediately before isolating the app root,
but ordinary application commands do not yet share a persistent purge
admission fence. After purge, delete the transferred `<steady-file>` handoff
itself if the target should retain nothing; running it again may create fresh
application state.

For the full update, rollback, inspection, and evidence discussion, see the
[golden-path guide](./golden-path.md).
