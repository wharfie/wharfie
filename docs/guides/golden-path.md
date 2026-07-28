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
  --json \
  -- /absolute/path/to/artifact.tar
```

The manifest's `cli.durable` declaration selects `verify-stable` and names the
pure `toDurableInput(args)` export. Wharfie passes only the arguments after
`--` to that adapter, which produces the same `{ path }` input used by the
ordinary CLI. The separator keeps application arguments distinct from
Wharfie operator options.

Omitting `--idempotency-key` creates a new `manual-<uuid>` identity and returns
it in the receipt. Supply a stable key when a caller needs to retry the same
admission after a lost response:

```bash
node ./bin/wharfie ops start \
  --dir ./scratch/examples/apps/steady-file \
  --idempotency-key artifact-build-42 \
  --json \
  -- /absolute/path/to/artifact.tar
```

The workflow and JSON controls remain available as an expert path that
bypasses the CLI adapter. They cannot be combined with application arguments:

```bash
node ./bin/wharfie ops start \
  --dir ./scratch/examples/apps/steady-file \
  --workflow verify-stable \
  --input '{"path":"/absolute/path/to/artifact.tar"}' \
  --idempotency-key artifact-build-42 \
  --json
```

Keep the returned `runId`. Starting durable work does not daemonize the
application. In another terminal, run the matching source resident:

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

Source durable commands and packaged commands intentionally have different
default storage roots. Packaging preserves the application contract, not a
source development run's local control database. The service walkthrough below
therefore starts a new packaged run. Service installation adopts work already
started by that packaged executable; it does not discover or adopt a default
source `ops start` run.

## Package the same application

Package only the target you intend to run. For Apple silicon macOS:

```bash
node ./bin/wharfie app package \
  ./scratch/examples/apps/steady-file \
  --target node24.13.1-darwin-arm64 \
  --json
```

For glibc Linux, use the same command with
`--target node24.13.1-linux-x64-glibc` or
`--target node24.13.1-linux-arm64-glibc`.

The receipt contains the immediate executable and sidecar paths. Normal argv
still belongs to the application:

```bash
<steady-file-artifact> /absolute/path/to/artifact.tar
```

The reserved operator namespace carries the durable form without `--dir` or
`--app-id`:

```bash
<steady-file-artifact> wharfie start \
  --json \
  -- /absolute/path/to/artifact.tar

<steady-file-artifact> wharfie worker

<steady-file-artifact> wharfie output \
  --run-id <run-id> \
  --confirm-sensitive-output \
  --json
```

`wharfie worker` is the foreground packaged resident. On Linux with a systemd
user manager, the persistent path is shorter and does not require keeping that
command's terminal open.

## Promote the packaged application to a Linux service

Call the first packaged revision `<steady-file-a>`. Verify its ordinary CLI,
then admit the same argument through the manifest's default durable workflow:

```bash
<steady-file-a> /absolute/path/to/artifact.tar

<steady-file-a> wharfie start \
  --json \
  -- /absolute/path/to/artifact.tar
```

Keep the returned `runId`. `start` persists the run but does not install a
service. The run is visible while the unit is still absent:

```bash
<steady-file-a> wharfie list --limit 10 --json
<steady-file-a> wharfie inspect --run-id <run-id> --json
<steady-file-a> wharfie service status --json
```

Install the exact packaged revision and wait for the receipt to report
`health: "healthy"`:

```bash
<steady-file-a> wharfie service install --json
```

The terminal that performed `start` and `install` can now close. Later, a new
shell can rediscover the run without an in-memory handle:

```bash
<steady-file-a> wharfie list --limit 10 --json
<steady-file-a> wharfie inspect --run-id <run-id> --json
<steady-file-a> wharfie output \
  --run-id <run-id> \
  --confirm-sensitive-output \
  --json
```

`list` is the rediscovery surface. `inspect` is redacted; `output` deliberately
discloses the raw path and fingerprints after explicit confirmation. This
example has no watch command, so poll until `inspect` reports `COMPLETED` or
`output.terminal` is non-null.

To exercise evolution, make an intentional application change and package it
as `<steady-file-b>` while retaining A. For example, changing the workflow's
immutable stability window from 250 to 500 milliseconds creates a distinct
revision. Run the ordinary B CLI before activation, then update through B:

```bash
<steady-file-b> /absolute/path/to/artifact.tar
<steady-file-b> wharfie service update --json
```

The retained run remains readable through B. Rollback is also invoked through
the currently selected B executable and selects A again:

```bash
<steady-file-b> wharfie inspect --run-id <run-id> --json
<steady-file-b> wharfie service rollback --json
<steady-file-a> wharfie output \
  --run-id <run-id> \
  --confirm-sensitive-output \
  --json
```

Finally, uninstall through the restored A executable:

```bash
<steady-file-a> wharfie service uninstall --json
<steady-file-a> wharfie inspect --run-id <run-id> --json
<steady-file-a> wharfie service prune --json
```

Uninstall removes the systemd wiring but deliberately preserves durable state
and immutable releases. With only selected and rollback releases present,
`prune` retains both. Wharfie does not currently expose a purge command; the
bounded proof obtains full cleanup by deleting its disposable VM.

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

## What the Linux service proof covers

`npm run verify:steady-file:systemd:lima` performs the displayed product
journey in one disposable Ubuntu VM. The checksummed commit-bound run:

1. installs the repository's npm tarball in a clean guest;
2. runs the source CLI and distinct A and B packaged CLIs with Node absent from
   the packaged command `PATH`;
3. starts one packaged A workflow before systemd exists and verifies every
   created application-state directory is mode `0700`;
4. installs A, records a healthy resident, and ends the initiating verifier;
5. returns in a different process, rediscovers the completed run, and reads
   integrity-verified history, inspection, and logical output;
6. updates to meaningful revision B, rolls back through B to A, and proves the
   reads are byte-for-byte preserved;
7. uninstalls through A, independently verifies the unit is absent, proves the
   reads remain, and confirms prune retains both referenced releases; and
8. deletes the VM and retains only small checksummed JSON receipts.

The workflow completed before the initiating verifier ended. This run proves
separate-process rediscovery and persistence of the installed service and its
retained state; it does not claim that unfinished work survived the caller's
death. The separate service-substrate proof covers crash and reboot recovery.
Neither proof establishes replacement by another coordinator machine.

## Classified findings

The walkthrough produced a short, prioritized list:

1. **Closed integrated evidence gate:** the
   [checksummed Linux arm64 walkthrough](../../llm/checkpoints/2026-07-28-steady-file-systemd-walkthrough.md)
   joins ordinary source execution, two generated application revisions,
   default durable admission, systemd installation, later-process
   rediscovery, update, rollback, retained reads, uninstall, prune, and host
   cleanup without adding a new framework abstraction.
2. **Closed native/SEA evidence gate:** a
   [checksummed Darwin arm64 observation](../../llm/checkpoints/2026-07-28-steady-file-native-sea-proof.md)
   ran the displayed source commands through a real LMDB resident, packaged
   this exact application, ran a relocated generated SEA with Node absent from
   runtime `PATH`, and returned matching verified output without changing
   application logic. This is one same-host observation, not clean-host or
   service-lifecycle proof.
2. **Closed interface friction:** schema v4 lets this application declare one
   default durable workflow and a pure argv-to-input adapter. The happy path
   now accepts the ordinary file argument, while explicit workflow, JSON, and
   stable idempotency controls remain available when needed.
4. **Closed product defect:** the integrated walkthrough exposed packaged
   LMDB roots created under a permissive host umask. Writable roots are now
   explicitly private, and the Linux proof checks every created path is mode
   `0700` before installation.
5. **P2 — interface friction:** the user must carry the returned `runId` into
   inspection and output, then repeat `steady-file-demo` for source `output`.
   `list` makes rediscovery possible and the walkthrough completed, so this is
   polish rather than a blocker.
6. **P2 — source-development friction:** `ops worker` is resident and has no
   development-only `--once` or `--until-idle` mode. A shell walkthrough must
   own a background process and graceful shutdown; the installed packaged
   path does not.
7. **Expected design:** source development still runs the developer-owned CLI
   directly through `local.js`. Durable start loads the sealed CLI module only
   to call the declared pure adapter; the packaged executable invokes the same
   manifest CLI entrypoint for ordinary execution.
8. **Deliberate boundary:** workflow timer durations are immutable revision
   data. Two observations do not justify dynamic delays, general scheduling,
   filesystem watching, or a new workflow language.

The current single-host product baseline is closed for one Darwin source/SEA
observation and one clean Linux arm64 service walkthrough. The next product
slice is replacement of a failed coordinator by another trusted machine, not
more single-host framework surface.
