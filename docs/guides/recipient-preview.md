# Build, share, and run a preview

Build a CLI, share its executable, and leave a durable workflow running on an
existing Linux server after you disconnect. This guide uses the published
**v0.0.17** preview and its included `steady-file` example: two file checks
separated by a one-minute durable timer. It is an evaluation release; the
[release evidence below](#release-evidence) identifies what remains unproven.

## Before you start

| Role            | Requirements                                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Author/builder  | A Linux x64 glibc builder with a POSIX shell for this tested recipe, Node 24.13.1, npm 11.12.0, internet access for package/build downloads, and native build tools if npm needs to compile dependencies. The package supports Node `>=24.13.1 <25`. |
| Recipient       | A Linux x64 glibc machine for the target below. The executable includes Node; the recipient needs neither Node/npm nor the author's checkout or `node_modules`.                                                                                      |
| Persistent host | A non-root Linux account with a working systemd user manager and a retained writable home directory. An administrator must enable lingering for that account to keep the service running after logout.                                               |

The shell examples use POSIX commands such as `cp`, `printf`, and `chmod`.
macOS checksum alternatives are included for handling the downloads there;
the end-to-end recipe here uses Linux x64 for both builder and recipient.

Run the builder commands in a new project. Packaging needs substantially more
resources than running this small example: one measured 8 GiB acceptance
controller peaked near 6.7 GiB across its build workload. That observation is
not a tested minimum; record your platform and package timing in the
[worksheet](#completion-worksheet). Build a matching target for another
supported recipient architecture; these commands select Linux x64 glibc.

## Obtain the published preview

Use [v0.0.17](https://github.com/wharfie/wharfie/releases/tag/v0.0.17), whose
manifest source commit is
[`ea93520d91d9020d8a192fd1fa0fa5779d6e02ad`](https://github.com/wharfie/wharfie/commit/ea93520d91d9020d8a192fd1fa0fa5779d6e02ad).
Download these four files into one new directory:

- [Core package: wharfie-wharfie-0.0.17.tgz](https://github.com/wharfie/wharfie/releases/download/v0.0.17/wharfie-wharfie-0.0.17.tgz)
- [Matching AWS companion: wharfie-aws-0.0.17.tgz](https://github.com/wharfie/wharfie/releases/download/v0.0.17/wharfie-aws-0.0.17.tgz)
- [preview-release.json](https://github.com/wharfie/wharfie/releases/download/v0.0.17/preview-release.json)
- [SHA256SUMS](https://github.com/wharfie/wharfie/releases/download/v0.0.17/SHA256SUMS)

In that download directory, verify the files:

```bash
sha256sum --ignore-missing --check SHA256SUMS
```

On macOS, use `shasum -a 256 --ignore-missing --check SHA256SUMS`. Check that
both tarballs and `preview-release.json` report `OK`; `--ignore-missing`
permits the standalone Wharfie download files to be absent. Confirm the
manifest says version `0.0.17`, tag `v0.0.17`, and the source commit above.
The [release guide](preview-release.md) explains provenance verification.

The core is also published on npm at the exact version and the `preview`
channel. This recipe uses the verified tarballs to keep one matching handoff.
The AWS companion is distributed with the GitHub release, and must match core
exactly. It is required when building AWS support into the executable; placing
it beside an already packaged app cannot add that support.

## Run and package the CLI

In a separate new project, install the verified files using their absolute
paths:

```bash
mkdir wharfie-preview-demo
cd wharfie-preview-demo
npm init -y
npm install --save-dev \
  /absolute/handoff/wharfie-wharfie-0.0.17.tgz \
  /absolute/handoff/wharfie-aws-0.0.17.tgz
cp -R node_modules/@wharfie/wharfie/examples/steady-file ./app
printf 'Wharfie preview recipient input.\n' > input.txt
node ./app/local.js ./input.txt

./node_modules/.bin/wharfie app package ./app \
  --self-deployable \
  --target node24.13.1-linux-x64-glibc \
  --output-dir ./dist --json --no-pretty > package-receipt.json
```

The ordinary command prints JSON with `"stable": true`, matching file
fingerprints, and an absolute input path; its observation window is 250 ms.
Packaging takes longer and can be quiet in JSON mode: these flags suppress
phase progress while reserving stdout for the final receipt. Diagnostics may
still appear on stderr. Wait for the command to finish successfully before
continuing. On success, `package-receipt.json` names the application revision,
artifact ID, executable, record, target, and byte size. Keep this receipt for
your worksheet.

Select the one generated artifact from that receipt and prepare the shareable
files; this command runs only on the builder:

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
const receipt = JSON.parse(fs.readFileSync('package-receipt.json', 'utf8'));
assert.equal(receipt.kind, 'wharfie.application.package');
assert.equal(receipt.artifactCount, 1);
assert.equal(receipt.artifacts.length, 1);
const artifact = receipt.artifacts[0];
fs.mkdirSync('handoff', { mode: 0o700 });
fs.copyFileSync(artifact.path, 'handoff/steady-file');
fs.copyFileSync(artifact.recordPath, 'handoff/steady-file.artifact.json');
fs.chmodSync('handoff/steady-file', 0o700);
NODE

cd handoff
sha256sum steady-file steady-file.artifact.json > SHA256SUMS
```

On macOS, use `shasum -a 256 steady-file steady-file.artifact.json > SHA256SUMS`.
Transfer the three files in `handoff` to a directory owned by the recipient,
using your usual secure file transfer. Keep the executable and record together.
Application input is separate: a path on the author's laptop does not travel
with the executable.

## Run on the recipient and keep work alive

Log into the recipient's Linux account and change into the transferred handoff
directory. Verify the bytes and create input on that machine:

```bash
sha256sum --check SHA256SUMS
chmod +x ./steady-file
printf 'Wharfie preview recipient input.\n' > input.txt
./steady-file ./input.txt
```

Expect the same `"stable": true` result with the recipient's absolute file
path. For persistence, an administrator must first enable lingering for this
account with `loginctl enable-linger <account>`. Then, as that non-root account:

```bash
./steady-file wharfie start --json -- ./input.txt
./steady-file wharfie service install --json
```

Keep the `runId` from the start receipt. It identifies a `verify-stable` workflow
for `steady-file-demo`. The install receipt should report
`"requestStatus": "fulfilled"` and `"outcome": "target-active"`.
The submitting command exits; the systemd user service executes the work.
Inspect the run before disconnecting:

```bash
./steady-file wharfie inspect --run-id <run-id> --json
```

While the minute-long timer is pending, expect `run.status` to be `RUNNING` and
`workflowCursor.disposition` to be `TIMER_WAITING`. Close the shell at this
point. In a fresh shell, log into the **same recipient account**, return to the
same handoff directory, and reconnect to its retained state:

```bash
./steady-file wharfie list --limit 10 --json
./steady-file wharfie inspect --run-id <run-id> --json
./steady-file wharfie output --run-id <run-id> \
  --confirm-sensitive-output --json
```

The minute starts after the first activity commits, not when packaging or
service installation starts. If the run is still waiting, inspect it again
later. A completed inspection has `run.status: "COMPLETED"` and
`workflowCursor.disposition: "COMPLETED"`; output retains the stability result.
The run ID stays the same. In `invocations`, expect exactly one entry with
`activityId: "capture"` and one with `activityId: "verify"`, both with
`status: "COMPLETED"`. Each invocation should have exactly one matching entry
in `attempts` with the same `invocationId` and `status: "COMPLETED"`. These are
the committed activities; the separate `history` array records their event
sequence. Output disclosure is explicit because results can contain paths and
other sensitive values.

Keep the recipient's application data directory across CLI and service
updates. A fresh shell uses that existing state; a fresh empty machine has no
copy of the run. An abrupt resident crash or host reboot can require explicit
coordinator inspection and recovery; follow the
[local resident operations reference](../../README.md#submit-durable-work-and-run-a-local-resident).
Do not replace a healthy active coordinator just to reconnect. This single-host
preview requires retained storage: loss of the host's root disk is not a
supported automatic recovery path.

## Known issue: operator commands while the service writes

**Recorded 2026-11-24; affects v0.0.17 and earlier previews.** Each
operator command, such as `wharfie inspect`, `list`, `output`, `start`, or
`service status`, briefly opens and closes the application's local store on
the host. `deployment exec` runs those same commands on a cloud host. If the
resident service is writing at that moment, you may see either of these:

- A briefly stale result. A command can miss the most recent committed step.
  Running it again a second later shows it. In Wharfie's testing, the
  missing step always reappeared within a second.
- Rarely, the resident service exits with an error that mentions
  `MDB_PROBLEM` or "No transaction to renew". A command such as `start` can
  fail with the same error.

In stress tests that opened and closed the store read-only every 5
milliseconds next to a process that wrote continuously, the writer exited in
four of six two-to-three-minute runs. At intervals from 50 milliseconds to one second, only
stale results appeared. The 48-hour release soak opens the store this way about
60 to 130 times every fifteen minutes on each provider, and its resident ran
without a restart for the whole soak.

What to do:

- Do not poll in a tight loop. Run `inspect` by hand, or wait a few seconds
  between calls. If a result looks one step behind, run it again.
- If `start` fails, check `wharfie list` before submitting again, so you do not
  start a second run.
- The systemd user service restarts after a failure, about five seconds later.
  Check it with `wharfie service status --json`, or `deployment status` for a
  cloud host. If it does not return to health, or reports that the previous
  coordinator is still active, follow the coordinator recovery for a
  [local resident](../../README.md#submit-durable-work-and-run-a-local-resident)
  or a [cloud deployment](remote-recovery.md). Do not delete the data
  directory.
- Report it through the
  [preview feedback form](https://github.com/wharfie/wharfie/issues/new?template=preview-feedback.yml)
  with the bounded diagnostic.

The issue comes from LMDB, the store's database, when one process opens and
closes a store that another process writes
([lmdb-js #370](https://github.com/kriszyp/lmdb-js/issues/370)). It is not new
in v0.0.17. It is tracked in
[issue #183](https://github.com/wharfie/wharfie/issues/183). It is fixed on
`master` by [PR #181](https://github.com/wharfie/wharfie/pull/181) and
[PR #182](https://github.com/wharfie/wharfie/pull/182), which send operator
reads through the running service and keep each store open in one process at
a time. The fix ships in 0.0.18, which is not released yet; v0.0.17 does not
include it.

## Remove the service and its data

After the run is complete, run these commands as the same account:

```bash
./steady-file wharfie service uninstall --json
./steady-file wharfie service purge \
  --confirm-data-loss steady-file-demo --json
```

Uninstall stops the service and removes its wiring, preserving durable data.
Purge then removes this app's durable state and releases; it requires terminal
work and no active runtime. Expect a fulfilled purge with outcome `purged` or
`already-purged`. Run no other command for this app concurrently with purge.
If a command refuses or fails, retain its diagnostic and use the
[service cleanup reference](developer-preview.md#stop-the-preview-service)
instead of deleting its data directory by hand.

Remove the three handoff files and sample input when no longer needed. This
cleanup leaves the existing server and account in place. If lingering was
enabled solely for this test, the administrator can disable it afterward;
check that no other user service needs it first.

## Optional: provision an AWS or Hetzner host

The `--self-deployable` executable above also exposes the
[packaged AWS and Hetzner deployment commands](quickstart.md#try-the-experimental-deployment-lifecycle).
Follow that reference for read-only `preview`, provider credentials, placement,
SSH access, and `apply`; this route creates chargeable cloud resources. Invoke
the Linux executable from a matching Linux controller. AWS support was embedded
by installing the exact companion before packaging. Hetzner uses the same
packaged surface with its own token and location.

Retain the deployment instance ID and the **entire private controller data
root** chosen for apply: it contains the journal and SSH authority used for
status, recovery, and destruction. A later controller process needs those same
bytes and valid credentials; copying only the executable is insufficient.

Input paths refer to the guest. For a first remote check, use its readable
`/etc/hostname` rather than the author's `input.txt`:

```bash
./steady-file wharfie deployment exec \
  --deployment-instance <deployment-instance-id> \
  --data-root /absolute/controller-state -- /etc/hostname
```

Expect `"stable": true` and path `/etc/hostname`. To submit the same one-minute
durable workflow, the application arguments after `--` are
`wharfie start --json -- /etc/hostname`. Use the same `deployment exec` wrapper
for the `wharfie list`, `inspect`, and `output` commands above after reconnecting.
`deployment exec` runs application/operator commands, not an arbitrary shell.
When finished, use the reference's `deployment destroy` with the exact instance
ID and retained controller data root, then independently confirm that the
provider resources are absent. Destroy removes the provisioned host and its
root-disk data; it does not preserve workflow state.

## Completion worksheet

Record durations you actually observe; package/install time depends on the
machine, download cache, and native build. The only fixed wait in this example
is the one-minute durable timer.

| Record                                                                   | Your result                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| Wharfie version/source                                                   | `0.0.17` / `ea93520d91d9020d8a192fd1fa0fa5779d6e02ad` |
| Builder OS/architecture, Node/npm; recipient OS/architecture             |                                                       |
| Route: existing server, AWS, or Hetzner                                  |                                                       |
| Setup/install time; package time; ordinary CLI time                      |                                                       |
| Package target, revision/artifact ID, size; observed memory if available |                                                       |
| Run ID; time from submission to completed result                         |                                                       |
| Timer observed before disconnect; same run completed after reconnect     |                                                       |
| Cleanup result; last successful step if blocked                          |                                                       |
| Confusing step or wording; bounded failure diagnostic if provided        |                                                       |

Share this worksheet through the repository's
[preview feedback form](https://github.com/wharfie/wharfie/issues/new?template=preview-feedback.yml).
Do not
paste credentials, private SSH material, raw sensitive application output, or
a controller data directory. A human trial is separate from automated
acceptance evidence.

## Release evidence

Status recorded 2026-11-24:

| Version or check                                                                          | Evidence and limit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published v0.0.17, source `ea93520d91d9020d8a192fd1fa0fa5779d6e02ad`                      | Matching GitHub/npm bytes, release provenance, and the automated recipient service journey passed the [publication gates](https://github.com/wharfie/wharfie/actions/runs/44589053894).                                                                                                                                                                                                                                                                                                                                                                                             |
| 48-hour operational soak                                                                  | Passed for these exact release files in campaign `wharfie-soak-20261119-v017b`: AWS `t3.small` in `us-east-2` and Hetzner `cx23` in `fsn1`. Both fifteen-minute rehearsals passed. AWS completed 192 of 192 workflows and Hetzner 192 of 192, with the same resident and host boot throughout. Resident memory: AWS 193 → 235 MiB (peak 235 MiB); Hetzner 196 → 235 MiB (peak 241 MiB). Cleanup was verified on both providers. It ran 48 hours, not 72, and does not cover crash, reboot, or disk loss. Earlier campaigns did not pass; see the [soak guide](operational-soak.md). |
| Hetzner route                                                                             | Fixed in v0.0.17 by [PR #175](https://github.com/wharfie/wharfie/pull/175). Since Hetzner's 2026-11-02 API change, v0.0.15 fails `deployment preview` and a first `deployment apply` before creating anything. The rehearsal and soak above ran on Hetzner.                                                                                                                                                                                                                                                                                                                         |
| Operator commands while the service writes                                                | [Known issue](#known-issue-operator-commands-while-the-service-writes) in v0.0.17 and earlier: briefly stale results and, rarely, a resident exit. Not a regression. Fixed on `master` by #181 and #182; ships in 0.0.18, not yet released.                                                                                                                                                                                                                                                                                                                                         |
| Unfamiliar tester handoffs                                                                | Pending; this guide and worksheet make those trials repeatable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Journal performance change merged in [PR168](https://github.com/wharfie/wharfie/pull/168) | Included in v0.0.17, so the soak above ran with it. Journal rollover is not built; see the [capacity guide](deployment-journal-capacity.md).                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Maintainer acceptance

The checkout runner accepts an exact tag and source commit. On Linux x64 with
the pinned Node toolchain, this public-download check verifies all six release
files and runs the standalone Wharfie CLI with an empty `PATH`:

```bash
node scripts/verify-preview-recipient.js \
  --tag v0.0.17 \
  --expected-commit ea93520d91d9020d8a192fd1fa0fa5779d6e02ad \
  --download-only --report /absolute/new/public-recipient.json
```

The full proof uses the guarded disposable GitHub-hosted recipient account.
It installs only the verified core/AWS tarballs into a private builder, packages
the installed starter, deletes the builder, transfers the app and its record,
and runs prepare and reconnect in separate controller processes. It verifies
the same timer, resident identity, committed activities, output, and cleanup.
The source checkout and builder are unavailable to the recipient; Node/npm are
absent from both its command `PATH` and the resident's `PATH`. This is account
isolation on a disposable host; the test controller still uses Node elsewhere
on that host. The existing
[split-VM proof](developer-preview.md#run-the-acceptance-proof) provides the
separate machine boundary.

Ordinary CI uses `--artifact-dir` for a verified candidate set and labels that
evidence `candidate-directory`. Release CI uses `--tag --draft` with read-only
download credentials before finalization, then performs an anonymous
`--download-only` check afterward. Neither acceptance mode publishes a release
or provisions a cloud server. Failed phases retain a bounded report while the
runner removes its private workspaces; an always-run cleanup step independently
removes the proof-owned account, service, home, and linger entry.
