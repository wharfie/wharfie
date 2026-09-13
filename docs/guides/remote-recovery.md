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

An interrupted update controller is a separate recovery case. Losing that local
process does not establish that the guest resident died or authorize coordinator
takeover. With a pending update, the target executable's `deployment recover`
continues that update; the currently committed executable's `deployment recover`
restores the committed release and clears the pending target. Once B is settled,
returning to A begins with A's `deployment update`. If that controller dies after
A becomes active on the guest but before its local journal settles, a fresh A
controller can recover the pending update. Replaying recovery after settlement
repairs A without switching back to B.

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

The [live deployment acceptance runner](live-deployment-acceptance.md) covers
fresh packaging and real AWS or Hetzner provisioning. Release A's steady-file
workflow captures a guest-local file fingerprint, waits on a fifteen-minute durable
timer, and verifies the retained fingerprint. The submitting controller exits
while that timer is waiting. An attempted B update must exit with status 1 and
leave a new `source-retained` activation outcome, a healthy ACTIVE A, and the
same unfinished work. A's packaged recovery must return `restore` and clear the
pending B release. The runner then kills the resident with `SIGKILL`, uses the
packaged inspection/takeover/recovery procedure above, and checks exact takeover
replay against the healthy replacement.

The same run also crosses a provider-requested host reboot. A changed Linux boot
ID establishes that the host rebooted; the receipt records whether ordinary
service startup recovered automatically or explicit packaged recovery was
needed. This requests a normal provider reboot and does not deliberately test
abrupt power loss or permanent disk loss.

Fresh controller processes must observe the original run completing with its
original timer and first committed activity intact. The proof checks one
completed attempt and one synchronized physical marker per activity, including
boot identities on opposite sides of the reboot. An interruption that occurs
after A's timer already finished fails the proof.

After A completes, a normal update selects B while preserving A's completed
history. B must produce its distinct `acceptanceRevision: "B"` CLI result and
complete a new durable run with a one-second timer. The runner then starts an
update back to A and pauses the owned submitting controller at its exact guest
convergence SSH call. It verifies guest A is active while the local journal still
records B with pending A, then kills and reaps the controller group. A fresh A
controller must settle the update through packaged recovery, retain both run
histories, and return `repair` on replay without changing the selected release.

The runner retains bounded private workflow, host, release, and recovery
receipts. The original A executable destroys the deployment, and an independent
provider audit verifies resource absence using the original provider authority
and the authorized A/B release pair. The runner's implementation alone is not
evidence that a live candidate passed.
