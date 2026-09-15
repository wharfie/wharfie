# Run an operational soak

This opt-in checkout proof keeps one disposable host running periodic durable
work for 48 or 72 hours. Run it once for AWS and once for Hetzner. It records
completion, committed history, physical activity executions, and resource growth,
then destroys the deployment and independently verifies provider cleanup.
It creates billable resources. A passing short rehearsal is not a passing soak.

Use the controller prerequisites and narrow SSH access described in
[live deployment acceptance](./live-deployment-acceptance.md). AWS uses the
`wharfie` profile in the examples below. A Hetzner token must be available as
`HCLOUD_TOKEN`. Credentials stay on the controller.

## Rehearse, then run

Start with `--soak-hours 0.25` for a fifteen-minute rehearsal. After it passes,
use `48` or `72`. Each invocation provisions a new host; do not reuse a run
directory for another proof.

```sh
AWS_PROFILE=wharfie npm run verify:deployment:live -- \
  --provider aws --region us-east-2 --allow-ssh-from <publicIPv4/32> \
  --soak-hours 72 --output-dir /absolute/new/aws-soak --step

npm run verify:deployment:live -- \
  --provider hetzner --location fsn1 --allow-ssh-from <publicIPv4/32> \
  --soak-hours 72 --output-dir /absolute/new/hetzner-soak --step
```

`--step` completes one observation and exits with a `running` report, retaining
the host and its private controller workspace. Reconnect from a fresh process:

```sh
AWS_PROFILE=wharfie npm run verify:deployment:live -- \
  --resume /absolute/new/aws-soak

npm run verify:deployment:live -- --resume /absolute/new/hetzner-soak
```

Without `--step`, the observer continues through the fixed deadline and cleanup.
Every packaged operation also uses a fresh controller process. Resume uses the
saved deployment identity, executable digest, journal, SSH identity, and workload
checkpoint. It does not build or provision another host or extend the deadline.
To perform just one observation from a scheduler, add `--step` to `--resume`.

Keep the observing computer awake, online, and at the permitted public address,
or arrange periodic resume invocations from that same controller environment.
A gap exceeding two observation intervals fails the proof and triggers cleanup.
The application runs under the guest's resident service between observations;
the observing process is responsible for scheduling the next workflow.

To use an exact verified candidate instead of packing the checkout, add both
`--artifact-dir /absolute/private/candidate` and
`--expected-commit <40-character-source-commit>` to the initial invocation.
The directory must contain all six preview assets, including the exact core and
AWS companion tarballs, manifest, checksums, executable, and artifact record.
The builder validates them before installing and records their source identity.
Candidate assets alone do not establish that a version has been published.

## What the proof measures

The fixture captures a host-local file fingerprint, waits on a one-second durable
timer, and verifies the fingerprint. Full soaks schedule a run every fifteen
minutes; rehearsals use four-minute intervals. Each observation has a five-minute
budget for fresh controllers, cross-region SSH, history, workflow, and resource
checks. The schedule reserves a complete observation window before the deadline,
then takes a final resource and marker sample. A 72-hour run has 288 workflows;
the fifteen-minute rehearsal has three, with two minutes of admission slack for
the last workflow. Each submission has a persisted
idempotency key and retains the returned run ID, so an interrupted observer can
retry the same submission without starting another run.

Each observation verifies one committed attempt and one physical execution per
activity, expected workflow output, and the original and most recent retained
histories. The final observation audits every physical activity marker file. Samples track
resident identity, RSS, cumulative CPU ticks, application/state/payload disk use,
available disk space, and approximate user journal size. Reports are bounded and
contain no raw application payloads or environment dumps. Resource guards fail
the proof when fixed memory or disk limits are crossed; measured growth still needs
review even when the guards pass.

Failure reports distinguish observation deadlines, late admission, and named
resource guards. They retain only allowlisted numeric measurements and limits;
raw command output and exceptions are excluded. Older failed attempts retain
their original results and can be cleaned up, but cannot resume under the
revised observation budget.

The same resident and host boot must remain present throughout this soak.
Crash, reboot, and update recovery are separate scenarios in the existing live
acceptance run. A soak failure remains a failure after successful cleanup.

## Cleanup, cost, and state retention

The observer always attempts packaged destruction after completion, failure, or
handled cancellation, then independently inventories the owned resources. A
process killed without a handler, offline controller, or expired credentials
can interrupt that cleanup. Resume destruction explicitly:

```sh
AWS_PROFILE=wharfie npm run verify:deployment:live -- \
  --cleanup /absolute/new/aws-soak

npm run verify:deployment:live -- --cleanup /absolute/new/hetzner-soak
```

Refresh AWS SSO before cleanup if necessary. Keep the run directory private and
retain its workspace until cleanup is confirmed. It contains the deployment
journal and SSH identity needed to operate and destroy that exact deployment.
Successful cleanup removes the temporary workspace while preserving bounded
proof and cleanup receipts.

Cloud application/control data lives on the disposable host's root disk.
Destroying the host deletes that data. The deployment journal on the controller
is operator authority, not a backup of the host's application data. This proof
does not establish recovery from permanent machine or disk loss.

One small host per provider should cost only a few dollars for a single soak.
Check the actual selected machine and disk in the preview receipt. Reserve a
budget for setup and reruns; the fixed proof deadline is not a provider-enforced
spending cap. Resources continue billing until destruction is confirmed. No
additional paid monitoring service or continuously running third host is needed.

## Journal capacity

`node scripts/verify-deployment-journal-capacity.js --help` describes the separate
local capacity proof. It exercises the production filesystem journal and update,
recovery, and destruction coordinators with injected remote/provider operations.
It does not provision cloud resources or claim packaged cloud capacity evidence.

The current journal has a finite record limit and reserves records for recovery
and destruction. The proof checks that new updates refuse before remote mutation
when the update budget is exhausted, while interrupted recovery and destruction
can still finish. It records journal bytes and operation durations near the
limit. Retain those measurements when deciding whether rollover is necessary;
do not interpret a theoretical update count as a practical latency guarantee.
