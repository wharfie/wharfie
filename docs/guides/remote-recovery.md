# Recover a crashed deployment

A killed resident can leave its durable coordinator authority ACTIVE. Restarting
the service does not replace that authority automatically. Use the packaged
application's remote coordinator commands to inspect it and explicitly authorize
replacement, then reconverge the deployment.

This procedure applies to an existing deployment with a settled release. Finish
or restore an interrupted deployment update before using it. Keep the original
controller's deployment data and SSH identity; use the same `--data-root` passed
to apply. The commands derive the host and installed executable from that local
deployment record.

First use deployment status to diagnose the service and establish whether the
previous resident was killed or must be replaced. Heartbeat age alone does not
establish process death. Ordinary `deployment exec` requires a healthy resident;
the dedicated coordinator commands remain usable while the resident is unhealthy.

```sh
app=/absolute/path/to/your-packaged-app
deployment_id=<deployment-instance-id>
data_root=/absolute/path/to/controller-data

"$app" wharfie deployment status \
  --deployment-instance "$deployment_id" --data-root "$data_root" --json
```

Inspect once and retain the complete document. Generate the following IDs once
for this recovery attempt, and save them alongside the inspection. If a command's
response is lost, reuse these exact values and this file.

```sh
umask 077
"$app" wharfie deployment coordinator inspect \
  --deployment-instance "$deployment_id" --data-root "$data_root" --json \
  > coordinator-inspection.json

request_id="$(uuidgen)"
coordinator_id="recovery-$request_id"
printf 'request_id=%s\ncoordinator_id=%s\n' "$request_id" "$coordinator_id" \
  > coordinator-recovery-ids.txt
```

After inspecting the predecessor and deciding to replace it, run:

```sh
"$app" wharfie deployment coordinator takeover \
  --deployment-instance "$deployment_id" --data-root "$data_root" \
  --inspection-file coordinator-inspection.json \
  --coordinator-id "$coordinator_id" --request-id "$request_id" \
  --confirm-authority-replacement --json

"$app" wharfie deployment recover \
  --deployment-instance "$deployment_id" --data-root "$data_root" --json
```

The inspection file stays on the controller. Wharfie sends its validated contents
over the pinned SSH connection. Takeover fences the exact inspected predecessor
and releases its temporary successor; `recover` then restores the selected service
to readiness. Keep both command results: a failure to restart does not mean that
the preceding takeover failed.

Retry an uncertain takeover with the original inspection and IDs. Exact replay
does not stop or replace a newer healthy resident. A definite predecessor or
request conflict requires investigation; do not silently refresh the inspection
inside a retry loop. A newly chosen replacement requires a new inspection and
explicit decision.

Confirm readiness with `deployment status`, then inspect the original run through
`deployment exec`. Durable timers and committed workflow steps remain part of
that run. This operation does not resolve an uncertain external effect: use its
specific inspection and reconciliation procedure before authorizing repetition.

## Reproduce the recovery proof

From the pinned development checkout on macOS with Lima installed:

```sh
npm run verify:remote-recovery:systemd:lima -- --snapshot
```

The proof creates and deletes a disposable Linux VM, packages an installed
candidate, and uses real SSH and systemd to kill and recover a resident during a
durable timer. It checks the original run/timer, one execution of each activity,
and exact takeover replay after the replacement is healthy. On Apple Silicon it
uses Rosetta to run the x64 deployment payload. Native x64 GitHub CI runs the same
proof without emulation.

The provider inventory and initial deployment journal are synthetic. This proves
the shared packaged recovery path; live AWS and Hetzner provisioning and lifecycle
acceptance remain separate checks. Lima retains checksummed proof receipts and
cleanup evidence; CI retains the bounded, explicitly selected JSON receipts.
