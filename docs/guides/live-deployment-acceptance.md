# Run live deployment acceptance

This opt-in checkout command packages the hello-world application, provisions a
real AWS or Hetzner host, exercises the packaged deployment commands, and removes
the deployment. Each invocation targets one provider. It creates billable cloud
resources and destroys the disposable host's root-disk data during cleanup.

This is the first live-host acceptance slice: local application execution,
deployment, remote application execution, adoption from another controller
process, and verified destruction. Crash recovery, host reboot, durable timer
continuation, release updates, and rollback remain separate acceptance slices.
Adding this runner does not establish that a live run has passed.

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
the deployment lifecycle and provider inventory reads. Select a region with an
available default VPC and usable default subnet. The subnet must assign public
IPv4 addresses and have working internet routing, gateway, network ACLs, and
instance capacity. Wharfie uses that existing network; this run does not create
a VPC. See [installation](./installation.md) for the AWS companion boundary.

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
2. Builds a native, self-deployable hello-world controller executable through
   that installed candidate and checks ordinary local application arguments.
3. Uses the executable's `wharfie deployment preview`, `apply`, and `status`
   commands against the selected provider, then invokes ordinary application
   arguments through `wharfie deployment exec` on the real host.
4. Starts another controller process and repeats `apply` with the same exact
   deployment authority. It checks that the existing host and resource
   identities are adopted without replacement.
5. Calls packaged `wharfie deployment destroy`, then independently queries the
   provider for the recorded resource IDs and the run's ownership inventory.
   Success requires confirmed absence of the owned resources, rather than only
   a successful destroy response.

The runner attempts cleanup after a failed acceptance phase as well. A failed
phase remains a failure even if cleanup succeeds. Unit tests and CI do not
provision hosts or use live cloud credentials.

## Receipts and interrupted cleanup

The run directory retains bounded, redacted receipts and a private diagnostic
report containing the phase, duration, command, and exit status or signal. It
does not retain raw subprocess output or an environment dump. Successful cleanup
removes the disposable workspace, build installs, and caches.

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
directory and inspect the bounded report before retrying.

For the separate SSH/systemd crash-recovery proof, see
[recover a crashed deployment](./remote-recovery.md).
