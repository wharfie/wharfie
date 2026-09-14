# Build, share, and run a preview

This path starts with one verified Wharfie candidate and ends with the same
application running persistently on a Linux server. The builder needs Node;
the recipient runs the packaged executable. Start with the included steady-file
CLI, which checks a file twice with a durable timer between checks.

## Obtain one matching candidate

Choose a preview that includes `preview-release.json` and `SHA256SUMS` in its
[GitHub release](https://github.com/wharfie/wharfie/releases). Releases without
that manifest belong to the retired product. Before a matching preview is
published, use the verified tarball handoff from the
[developer-preview guide](developer-preview.md#create-the-wharfie-handoff).

Download the core tarball, matching AWS companion, manifest, and checksums from
the same release. Verify the files in that directory:

```bash
sha256sum --ignore-missing --check SHA256SUMS
```

On macOS, use `shasum -a 256 --ignore-missing --check SHA256SUMS`. The
[release guide](preview-release.md) also describes provenance verification.
Keep the exact version together: a companion from another version is rejected.
The companion is needed when building an AWS-capable application; it does not
add AWS support to an already packaged executable.

## Run and package the CLI

This example packages Linux x64 glibc with Node 24.13.1. Use the matching target
for another supported recipient platform. In a fresh project, install the
verified tarballs, substituting their absolute paths:

```bash
npm init -y
npm install --save-dev \
  /absolute/handoff/wharfie-wharfie-0.0.15.tgz \
  /absolute/handoff/wharfie-aws-0.0.15.tgz
cp -R node_modules/@wharfie/wharfie/examples/steady-file ./app
printf 'Wharfie preview recipient input.\n' > input.txt
node ./app/local.js ./input.txt

./node_modules/.bin/wharfie app package ./app \
  --self-deployable \
  --target node24.13.1-linux-x64-glibc \
  --output-dir ./dist
```

The ordinary command prints `stable: true`. The package command prints the
generated executable's path. Copy it and its adjacent `.artifact.json` file
into a new handoff directory as `steady-file` and `steady-file.artifact.json`.
From that directory, create transfer checksums:

```bash
sha256sum steady-file steady-file.artifact.json > SHA256SUMS
```

Transfer those three files to the recipient. Application input is separate:
create `input.txt` on the recipient or explicitly transfer the file being
checked. A path on the author's laptop does not automatically exist on a server.

## Run on the recipient and keep work alive

On the matching Linux recipient, verify the handoff and run ordinary arguments:

```bash
sha256sum --check SHA256SUMS
chmod +x ./steady-file
printf 'Wharfie preview recipient input.\n' > input.txt
./steady-file ./input.txt
```

For persistence, use a non-root account with a working systemd user manager.
The administrator must enable lingering for that account if the service should
remain running after logout (`loginctl enable-linger <account>`).

```bash
./steady-file wharfie start --json -- ./input.txt
./steady-file wharfie service install --json
```

Keep the returned run ID. The submitting command exits; the installed service
does the work. Close that shell. In a later shell, rediscover and inspect it:

```bash
./steady-file wharfie list --limit 10 --json
./steady-file wharfie inspect --run-id <run-id> --json
./steady-file wharfie output --run-id <run-id> \
  --confirm-sensitive-output --json
```

The timer lasts one minute. Before it fires, inspection reports the same
waiting run; afterward, output contains the file's retained stability result.
Output disclosure is explicit because application output can contain paths or
other sensitive values. Keep the application's data directory across CLI and
service updates. An abrupt resident failure needs explicit coordinator
inspection and recovery; see the
[local resident operations](../../README.md#submit-durable-work-and-run-a-local-resident).
Ordinary reconnect does not authorize replacing an active coordinator.

## Remove the service and its data

After the run completes:

```bash
./steady-file wharfie service uninstall --json
./steady-file wharfie service purge \
  --confirm-data-loss steady-file-demo --json
```

Uninstall stops the service and removes its wiring. Purge deletes this app's
durable state and releases; it requires terminal work and no active runtime.
Then remove the transferred executable, record, checksums, and sample input if
you no longer need them. Existing-server cleanup does not destroy the server.
Cloud `deployment destroy` removes its server and root-disk data; see the
[live deployment guide](live-deployment-acceptance.md).

## Maintainer acceptance

The checkout runner accepts an exact tag and source commit. On Linux x64 with
the pinned Node toolchain, this public-download check verifies all six release
files and runs the standalone Wharfie CLI with an empty `PATH`:

```bash
node scripts/verify-preview-recipient.js \
  --tag v0.0.15 --expected-commit <full-source-commit> \
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
