# Golden path: carry a file check beyond the shell

The `steady-file` example asks one useful local question:

> Did this build or download artifact have identical contents at two
> observations 250 milliseconds apart?

Its normal CLI fingerprints one regular file, waits 250 milliseconds,
fingerprints it again, and exits with a JSON `stable` decision:

```bash
node ./scratch/examples/apps/steady-file/local.js \
  /absolute/path/to/artifact.tar
```

Here `stable` means size and modification time matched before and after each
read, and the two byte counts and SHA-256 fingerprints matched. It cannot
detect a change whose bytes and metadata are completely restored between or
during observations. Exit status is `0` for matching observations, `2` for
different observations or metadata that differs around a read, and `1` for
invalid input or an observation failure. This is application behavior, not an
operator command.

The same source also declares two activities and one finite workflow:

```text
capture baseline → wait on a durable framework timer → compare fresh bytes
```

Both local and durable paths use the same fingerprint and comparison
functions. The workflow retains the baseline, timer observation, comparison,
and final matching/different result.

## Run the durable source path

First inspect the exact authored manifest:

```bash
node ./bin/wharfie app manifest \
  ./scratch/examples/apps/steady-file
```

Use an absolute path because durable activity code observes the worker
machine's filesystem, not the shell that submitted the request:

```bash
node ./bin/wharfie ops start \
  --dir ./scratch/examples/apps/steady-file \
  --workflow verify-stable \
  --idempotency-key artifact-build-42 \
  --input '{"path":"/absolute/path/to/artifact.tar"}' \
  --json
```

Keep the returned `runId`. In another terminal, run the matching source
resident:

```bash
node ./bin/wharfie ops worker \
  --dir ./scratch/examples/apps/steady-file
```

The redacted lifecycle and explicitly confirmed logical result are separate:

```bash
node ./bin/wharfie ops inspect --run-id <run-id> --json

node ./bin/wharfie ops output \
  --app-id steady-file-demo \
  --run-id <run-id> \
  --confirm-sensitive-output \
  --json
```

`output` is deliberately unredacted. The file path and fingerprints are raw
application values. Wait until `inspect` reports `COMPLETED`, or poll `output`
until its `terminal` field is non-null. Stop the foreground worker with
`SIGINT` or `SIGTERM`; it drains before exiting.

These source durable commands are the native local path. `ops start` opens the
native LMDB control adapter; `ops worker` opens both the LMDB control and
application-state adapters. There is no separate enable flag: invoking either
command is the opt-in. Neither command is executed by the hermetic proof below.

## Package the same application

Package only the target you intend to run. For Apple silicon macOS:

```bash
node ./bin/wharfie app package \
  ./scratch/examples/apps/steady-file \
  --target node24.13.1-darwin-arm64 \
  --json
```

For glibc x64 Linux, use the same command with
`--target node24.13.1-linux-x64-glibc`.

The receipt contains the immediate executable and sidecar paths. Normal argv
still belongs to the application:

```bash
<steady-file-artifact> /absolute/path/to/artifact.tar
```

The reserved operator namespace carries the durable form without `--dir` or
`--app-id`:

```bash
<steady-file-artifact> wharfie start \
  --workflow verify-stable \
  --idempotency-key artifact-build-42 \
  --input '{"path":"/absolute/path/to/artifact.tar"}' \
  --json

<steady-file-artifact> wharfie worker

<steady-file-artifact> wharfie output \
  --run-id <run-id> \
  --confirm-sensitive-output \
  --json
```

SEA construction may download or build target runtimes and can consume
substantial temporary disk. The golden-path test does not perform that build
or execute a generated SEA.

## What the hermetic proof covers

`test/cli/app/steady-file-golden-path.test.js` uses one owned temporary root
and the portable vanilla test store. It:

1. runs the ordinary CLI and observes two matching file fingerprints;
2. prepares and seals the real authored revision;
3. starts the workflow through the shared source/packaged command contract;
4. executes the real baseline activity;
5. closes and reopens the control store while the durable timer is waiting;
6. changes the observed file;
7. fires the due framework timer and executes the real comparison activity;
8. reads the complete verified schema-version 1
   `wharfie.execution-ledger.run-output` document; and
9. removes the entire owned temporary fixture root, including its authored
   copy, revision, control store, and payloads.

It does not use native LMDB, construct or execute an SEA, start systemd,
create a container, touch a block device, or call a cloud provider.

## Classified findings

The walkthrough produced a short, prioritized list:

1. **Closed evidence gate:** a
   [checksummed Darwin arm64 observation](../../llm/checkpoints/2026-07-28-steady-file-native-sea-proof.md)
   ran the displayed source commands through a real LMDB resident, packaged
   this exact application, ran a relocated generated SEA with Node absent from
   runtime `PATH`, and returned matching verified output without changing
   application logic. This is one same-host observation, not clean-host or
   service-lifecycle proof.
2. **P1 — interface friction:** the ordinary CLI accepts one path, while the
   durable form asks the user to choose a workflow ID, invent an idempotency
   key, and translate the path into JSON. The framework has not yet earned a
   new abstraction, but this handoff should become markedly smaller.
3. **P1 — interface friction:** the user must carry the returned `runId` into
   inspection and output, then repeat `steady-file-demo` for source `output`.
   Explicit app scope preserves read isolation, but the happy path has enough
   context to make this feel redundant.
4. **P2 — interface friction:** `ops worker` is resident and has no
   development-only `--once` or `--until-idle` mode. A shell walkthrough must
   own a background process and graceful shutdown.
5. **Expected design:** source development runs the developer-owned CLI
   directly through `local.js`; Wharfie does not consume ordinary argv. The
   packaged executable invokes the manifest CLI entrypoint.
6. **Deliberate boundary:** workflow timer durations are immutable revision
   data. Two observations do not justify dynamic delays, general scheduling,
   filesystem watching, or a new workflow language.

The native/SEA evidence gate is closed for one Darwin run. Reduce the
demonstrated P1 handoffs next; the remaining evidence gate is a clean supported
Linux/systemd service lifecycle with install, converge, deliberate replacement,
host restart, history and output reads, update, rollback, uninstall, and
cleanup.
