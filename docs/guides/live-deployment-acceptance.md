# Run live deployment acceptance

This opt-in checkout command packages two releases of the steady-file application,
provisions a real AWS or Hetzner host, and checks durable recovery, release updates,
and restoration of the previous release. It then removes the deployment and
independently verifies cleanup. Each invocation targets one provider. It creates
billable cloud resources and destroys the disposable host's root-disk data during
cleanup.

Release A captures a file fingerprint, waits on a fifteen-minute durable timer,
and compares the retained fingerprint with a second observation. Release B has a
one-second timer and adds `acceptanceRevision: "B"` to its ordinary CLI result.
These differences let the runner verify which release executes new work. The
runner creates a small input file on the guest; the workflow does not depend on a
file remaining accessible from the controller's laptop.

The host interruption uses the provider's reboot API to request a normal reboot.
It does not deliberately simulate abrupt power loss or loss of the host's disk.
Availability of this runner does not establish that a particular candidate has
passed a live run.

## Prepare the controller

Use a development checkout with `npm ci` completed, the exact Node version in
`.nvmrc`, and the npm version in `package.json#packageManager`. The controller
needs OpenSSH client tools and outbound access to the package/build downloads,
the selected provider API, and the host's SSH port. Use a stable public IPv4
address for the duration of the run; supply that address explicitly as `/32`.
The runner does not discover your public address through an external service.

For Hetzner, provide a read/write `HCLOUD_TOKEN` through the ambient environment
and select a location with available capacity. Use a dedicated project because
the token grants project-wide access. The runner does not read `HETZNER_TOKEN`;
if that is your local variable name, map it to `HCLOUD_TOKEN` before invoking
the command.

For AWS, configure the ordinary AWS credential chain for an account that permits
the deployment lifecycle, instance reboot, and provider inventory reads. Select
a region with an available default VPC and usable default subnet. The subnet must
assign public IPv4 addresses and have working internet routing, gateway, network
ACLs, and instance capacity. Wharfie uses that existing network; this run does not
create a VPC. See [installation](./installation.md) for the AWS companion boundary.

To select a named AWS profile, set `AWS_PROFILE=<profile>` for both acceptance
and cleanup commands. For an SSO profile, refresh its session first with
`aws sso login --profile <profile>`.

Credentials are not command arguments and are not copied into the application
or guest. Keep the same provider authority available until cleanup is confirmed.

## Run one provider

From the checkout, substitute your controller's public IPv4 `/32`:

```sh
npm run verify:deployment:live -- \
  --provider hetzner --location fsn1 \
  --allow-ssh-from <publicIPv4/32>
```

For AWS:

```sh
npm run verify:deployment:live -- \
  --provider aws --region us-east-2 \
  --allow-ssh-from <publicIPv4/32>
```

Use `--location` only with Hetzner and `--region` only with AWS. Both commands
require `--allow-ssh-from`; the runner does not broaden SSH access automatically.
An ordinary run creates a unique directory under `.wharfie/live-deployment/`.
Use `--output-dir /absolute/path/to/new-run-directory` to choose a new directory
explicitly. Keep each run's output separate so its cleanup authority cannot be
confused with another deployment.

The run:

1. Packs the current core npm candidate and installs it in a fresh workspace
   outside the checkout. AWS runs also pack and install the matching AWS
   companion; Hetzner runs use core alone.
2. Builds native, self-deployable steady-file controller executables for releases
   A and B through that installed candidate and checks ordinary local application
   arguments. The installed starter retains its file comparison behavior;
   acceptance adapts the timers, adds synchronized physical activity markers,
   and gives B a distinct CLI result.
3. Uses A's `wharfie deployment preview`, `apply`, and `status`
   commands against the selected provider.
4. Starts another controller process and repeats `apply` with the same exact
   deployment authority. It checks that the existing host and resource
   identities are adopted without replacement.
5. Stages the guest input and checks ordinary application arguments through
   `wharfie deployment exec`, then starts the default durable workflow through
   packaged `deployment exec` and `wharfie start`. The submitting controller
   process exits. A fresh controller inspects the run while its original timer
   is waiting and its first activity is committed.
6. Attempts an update to B while A's first activity is committed and its timer is
   waiting. The update must exit with status 1. The runner verifies a new guest
   activation outcome of `source-retained`, a healthy ACTIVE A, and the same
   unfinished run. A failed upload alone cannot satisfy this check. A fresh A
   controller runs `deployment recover`; its `restore` result must clear pending
   B while preserving A and its work.
7. Sends `SIGKILL` to the exact observed systemd resident, checks that it became
   unhealthy without a host reboot, and inspects the still-waiting run. Packaged
   coordinator `inspect`, `takeover`, and deployment `recover` replace its stale
   authority and restore readiness. Replaying the exact takeover request must
   leave the healthy replacement unchanged.
8. Rechecks unfinished work, verifies provider ownership, and requests a reboot
   of the same host. Success requires observing a different Linux boot ID over
   the pinned SSH connection. The runner records whether the service recovered
   automatically or needed explicit packaged recovery.
9. Reconnects through fresh packaged controller processes until the original A run
   completes. The timer must retain its identity and scheduled deadline, then
   fire. Each activity must have one completed attempt and one physical marker;
   the first committed activity must be unchanged. The two markers bind the
   activities to opposite sides of the reboot, and the final file comparison
   must match the known input bytes.
10. Performs a normal A-to-B update after A's work completes. It checks B's
    selected artifact, distinct ordinary CLI result, and unchanged A run history,
    output, and physical activity markers on the same host.
11. Starts a new durable run under B and verifies completion with B's one-second
    timer and one physical marker per activity.
12. Starts an update from B back to A, then pauses that owned controller when its
    exact guest `service status` SSH child starts after successful convergence.
    The guest must be running A while the controller journal still records
    current B and pending A. After independently observing both states, the
    runner kills and reaps the owned
    controller process group.
13. Uses a fresh A controller's `deployment recover` to settle A. Both completed
    run histories, outputs, and activity markers must survive. Replaying recovery
    must return `repair` and keep A selected.
14. Uses the original A executable's packaged `wharfie deployment destroy`, then
    independently queries the provider for the recorded resource IDs and the
    run's ownership inventory. Cleanup accepts the recorded A/B release pair
    while keeping the original provider authority fixed. Success requires
    confirmed absence of the owned resources, rather than only a successful
    destroy response.

The refused B update, resident crash, and reboot must happen while A's same durable
timer is still waiting.
If the run finishes too early, the proof fails rather than counting that result
as successful recovery. The supervising acceptance runner remains alive to
observe faults and own cleanup; the process that submitted the application work
has exited.

The runner attempts cleanup after a failed acceptance phase as well. A failed
phase remains a failure even if cleanup succeeds. Unit tests and CI do not
provision hosts or use live cloud credentials.

For the separate bounded 48–72-hour workload and resource-growth proof, see
[run an operational soak](./operational-soak.md).

## Receipts and interrupted cleanup

The run directory retains bounded, redacted receipts and a private diagnostic
report containing the phase, duration, command, and exit status or signal. It
does not retain raw subprocess output or an environment dump. Successful cleanup
removes the disposable workspace, build installs, and caches.
Interruption failures also identify the fixed failing step and failure category.
`restore-target-observation.json` overwrites the latest bounded guest observation
result, including its attempt count and any fixed host verification failure.

In addition to package, deployment, and cleanup receipts, the directory retains
the workflow start, controller-exit and completion observations, activity markers,
and host observations around each interruption. Recovery receipts preserve the
controller-local coordinator inspection and exact replacement IDs before
takeover, followed by takeover, repair, healthy-service, and exact-replay results.
The reboot evidence includes `provider-reboot-request.json`, the changed boot
identity, and an `automatic` or `explicit` result in `reboot-recovery.json`.
Release receipts also retain the unfinished-work refusal, restored A, settled B,
B's completed run, and the interrupted return to A. The interruption proof binds
the observed guest A to a still-unsettled controller journal and records confirmed
exit of the owned controller group before fresh recovery and replay. These
documents contain run, deployment, and coordinator identifiers; keep the directory
private.

After cloud cleanup is confirmed, the runner saves a durable receipt before
removing the workspace. If removal is interrupted, `--cleanup` uses that receipt
to finish local cleanup even when the executable or journal is already gone.

If destruction or its independent verification is ambiguous, the runner
preserves the workspace, controller executable, deployment journal, and SSH
identity. These files are the authority needed to continue cleanup. Keep that
directory private and do not remove it while cloud cleanup is unconfirmed.

With the original provider credentials available, resume cleanup using the
same run directory:

```sh
npm run verify:deployment:live -- \
  --cleanup /absolute/path/to/existing-run-directory
```

Cleanup uses the retained deployment authority; it does not create a new
deployment or require a new provider, placement, or SSH selector. It repeats
packaged destruction as needed and independently checks resource absence before
removing the retained workspace. If cleanup is still unconfirmed, retain the
directory and inspect the bounded report before retrying. `--cleanup` resumes
destruction; it does not resume or rerun the durable acceptance scenario.

For the separate SSH/systemd crash-recovery proof, see
[recover a crashed deployment](./remote-recovery.md).
