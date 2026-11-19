# Candidate-bound unattended acceptance controller

This directory runs Wharfie's two-provider [operational soak](../../docs/guides/operational-soak.md) unattended from one disposable EC2 controller, so the proof does not depend on a laptop staying awake. Run every command below from this directory. Each campaign uses a new private state directory outside the repository; never reuse a failed campaign's state. All local AWS operations explicitly use profile `wharfie`, account `411430101559`, and region `us-east-2`. The controller uses its scoped, rotating instance role; laptop SSO credentials are never copied.

The candidate version and full commit are parameters. The same commit supplies both the acceptance harness and candidate package bytes. Prepare all six artifacts from the attested tag build, hold npm publication approval, and use the exact archived bytes for both rehearsals and both full soaks. Preparation rejects a manifest with a different commit, version, artifact set, size, or checksum.

The controller retains the tested sizing: Ubuntu 24.04 x64, `t3.large` (8 GiB), encrypted 40 GiB gp3, standard CPU credits, IMDSv2, no inbound security-group rules, SSM access, and one fixed Elastic IP. The service has `MemoryMax=7000M`; the earlier 4 GiB controller failed during native SEA packaging. Builds remain sequential/offset. Guest previews must still select exactly AWS `t3.small` with the pinned encrypted gp3 root disk and Hetzner `cpx12` in `fsn1`, with SSH restricted to the controller EIP `/32`.

No September dollar estimate is current price evidence. Before provisioning, query current Ohio EC2, gp3, and public IPv4 rates plus current Hetzner server/IP rates. The full soak length is a preparation parameter, `--soak-hours 48` or `--soak-hours 72`, recorded in `campaign.json`. Every deadline derives from it: the hard controller window is the soak length plus six hours from preparation (54 or 78 hours), launch must happen while at least the soak length plus three hours remain, and the supervisor's own deadline is the earlier of two hours before the controller stop and its start plus the soak length plus four hours. Budget controller compute, 40 GiB disk, its public IPv4, one AWS guest and one Hetzner guest for about the soak length plus one hour each, and bounded private S3 inputs/evidence. Standard credits prevent unlimited-credit surcharges. Disk, EIP, retained proofs, and any unrecovered guest continue billing after an emergency stop until audited teardown.

## Preparation and launch

Run the local-only checks. Hosted CI runs the unit tests on every pull request:

```sh
python3 -m unittest discover -s tests -v
bash -n bootstrap.sh
node --check gate.mjs
```

Use a fresh private state directory. `--preview` supplies the providerSpec selectors, which must match a fresh `wharfie` account/network/image preflight taken immediately before preparation; the packaged AWS apply gate independently validates its actual fresh preview before authorizing any guest mutation.

```sh
python3 ops.py prepare --state /absolute/private/new-campaign \
  --preview /absolute/verified-aws-preview.json \
  --assets /absolute/exact-six-candidate-assets \
  --commit FULL_TAGGED_SOURCE_COMMIT --version X.Y.Z --soak-hours 48 \
  --campaign wharfie-soak-YYYYMMDD-vXYZ
```

Inspect the frozen `campaign.json`, `cloudformation.json`, operations hashes, soak length, controller deadline, and source identity. `campaign.json` records a SHA-256 for every operations file. Every command except `prepare` and `status` refuses if any of them changed, so run every command from one checkout, preferably a worktree at the candidate's tagged commit, and keep it unchanged until teardown. A later `purge-proofs` needs a checkout at that same commit. `apply` checks the account and AMI, creates one exact CloudFormation stack, and persists its identity before creation. Lost responses reconcile that exact stack; they never recreate a campaign.

```sh
python3 ops.py apply --state /absolute/private/new-campaign
```

The six exact candidate inputs are uploaded with SSE-S3 and SHA-256 readback checks into the campaign's private bucket. The operations bundle is uploaded last. A short, digest-pinned userdata script waits for that bundle, verifies its bytes, and installs root-owned runtime code. This avoids the previous nearly exhausted 16 KiB userdata limit. A failed input upload can be resumed with `stage-inputs` using the same state. Bootstrap downloads no mutable GitHub release assets; only the immutable harness commit is fetched from GitHub. Node 24.13.1's Linux tarball digest and npm 11.12.0 remain pinned.

Deliver the existing `HETZNER_TOKEN` through private stdin to `ops.py token`; never put it in arguments, userdata, logs, or an environment file. The token is stored in one exact SSM SecureString. The supervisor reads it into memory and maps it to `HCLOUD_TOKEN` only for Hetzner child processes.

After SSM confirms successful cloud-init and `bootstrap-ready.json`, run `start`. It verifies the fixed EIP and external stop schedule before enabling the service. Keep `authorize` running during initial setup: it approves the two exact AWS deployment IDs only after checking the immutable preview, candidate/harness commit, account, placement, image, root disk, and SSH `/32`. The controller role has no IAM privileges, cannot approve its own gate, and starts with read-only EC2 permissions.

```sh
python3 ops.py start --state /absolute/private/new-campaign
python3 ops.py authorize --state /absolute/private/new-campaign
```

The two 15-minute rehearsals run sequentially and must both pass with verified cleanup before either full proof is accepted. Full builds are offset, then the AWS and Hetzner soaks overlap. Confirm both full runs' initial exports and fixed deadlines before leaving setup. Initial creation is limited to two hours, resumed observations to thirty minutes including runner cleanup, and explicit cleanup to twenty minutes, followed by a bounded TERM-to-KILL grace period. The acceptance runner retains its stricter five-minute observation limit. If setup leaves insufficient time for a complete full soak plus its final observation before the campaign deadline, the supervisor fails early and cleans up.

## Scheduling, diagnostics, and recovery

The supervisor now sleeps until the next anchored observation instead of repeatedly invoking `--resume --step` and reuploading unchanged reports. The wait is monotonic-bounded and rejects backwards wall time. Each actual observation still starts a fresh controller process; no existing run directory is recreated.

Every run attempts to retain fsynced lifecycle metadata: child start/exit, termination request, escalation, fixed deadline values, first signal/stop reason, and wall/monotonic timestamps. Raw exception strings and credential values are excluded. Small stdout chunks are drained immediately, even when log writes fail. Each successful observation and final settlement attempts to export a bounded diagnostic archive containing the current and previous 4 MiB log rotations plus lifecycle events, with SHA-256 readback verification. Diagnostic history is bounded, so rotation can discard older phase output; the last cancellation events are retained when storage is available. Numeric controller disk/cgroup OOM counters and deadline/stop metadata have an export attempted once per minute while a child is active. These health exports use one background daemon worker, with SDK timeouts, retries, and readback limits; a slow attempt suppresses additional attempts and never delays child deadline checks or shutdown. The controller journal is persistent with a seven-day/256 MiB cap.

Diagnostics are optional evidence. Logging/export failures cannot prevent child termination/reaping, required report/recovery exports, terminal summary export, collection, or audited teardown. Run manifests and collection receipts identify unavailable optional diagnostics. Present diagnostics are size/hash checked before inclusion; required proof or recovery failures still fail closed.

`status` reads only exported evidence. A missing export, partial proof, failed proof, or timed-out child is never a pass. Failed proofs remain failed after cleanup. Exact-run cleanup/export receives at most three automatic settlement attempts across restarts. If cleanup is uncertain, the exact executable, journal, SSH authority, and receipts are archived (bounded to 1 GiB uncompressed/512 MiB compressed), and the local recovery disk remains intact.

The independent EventBridge action stops only the exact controller at the fixed controller deadline. It cannot guarantee deletion of a guest if the entire controller fails. It preserves the encrypted disk and fixed EIP for exact-run recovery. Normal guest cleanup is automatic; full controller teardown remains an explicit audited operation. Do not add a timeout around the systemd supervisor or start it as a child of a short-lived SSM session.

For recovery, restart the same controller with its original EIP; stop the ordinary service, then use the existing `supervisor.py --repair-cleanup LABEL` command through SSM. This invokes only packaged cleanup for one of the four known labels and preserves the failed proof. Never rerun initial creation or widen guest ingress.

## Terminal collection and full owned cleanup

After all terminal exports, collect and verify their hashes. Independently recheck both providers' exact guest IDs and ownership inventories using the collected run identities before deleting controller authority. The packaged cleanup receipts already include an independent provider inventory; a fresh operator-side check provides the final external confirmation.

```sh
python3 ops.py collect --state /absolute/private/new-campaign
python3 ops.py teardown --state /absolute/private/new-campaign
```

A run that fails in `package`, `verify-executable`, `local-cli`, or `preview` never created a guest. The runner records `applyAttempted: false` and cleanup status `not-created`. A failure in `preview-next` also precedes any mutation, but the runner has already recorded a deployment identity by then, so it is not accepted as never-created. Packaged cleanup then reports `not-created`, never `absent`, so the run cannot settle, and `teardown` refuses. Recover it with a reviewed manual teardown after a fresh read-only inventory of both providers. The supervisor settles such a run without packaged cleanup and records `neverCreated: true`, distinct from `cleanupVerifiedAbsent`, because nothing was observed absent. The run stays failed, and a failed rehearsal still prevents both soaks from starting.

`teardown` refuses any run with unverified guest absence/export. It accepts a never-created run only from that run's collected, hash-listed `run.json`, `report.json`, `retirement.json`, and cleanup report, and only when they show the run's provider and run ID, no apply attempt, no deployment identity, a failure in one of those phases, and a removed workspace. Before `teardown`, still take a fresh read-only inventory of both providers' owned resources, as the packaged cleanup receipts recommend. It removes only the exact tagged stack, verifies the controller instance, original root volume IDs, Elastic IP, security group, IAM roles/profile, Scheduler schedule/group, and campaign token are absent, and restores/verifies the retained bucket's TLS-only policy. It retains the private candidate/proof archive by default. `purge-proofs` is a separate operation: it verifies local proof hashes, bucket ownership, and the finite allowed key set before deleting the archive. Do not purge the fresh candidate's acceptance evidence as part of routine controller cleanup.
