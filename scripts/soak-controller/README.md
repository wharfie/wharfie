# Candidate-bound unattended acceptance controller

This directory runs Wharfie's two-provider [operational soak](../../docs/guides/operational-soak.md) unattended from one disposable EC2 controller, so the proof does not depend on a laptop staying awake. Run every command below from this directory. Each campaign uses a new private state directory outside the repository; never reuse a failed campaign's state. All local AWS operations explicitly use profile `wharfie`, account `411430101559`, and region `us-east-2`. The controller uses its scoped, rotating instance role; laptop SSO credentials are never copied.

The candidate version and full commit are parameters. The same commit supplies both the acceptance harness and candidate package bytes. Prepare all six artifacts from the attested tag build, hold npm publication approval, and use the exact archived bytes for both rehearsals and both full soaks. Preparation rejects a manifest with a different commit, version, artifact set, size, or checksum.

The controller retains the tested sizing: Ubuntu 24.04 x64, `t3.large` (8 GiB), encrypted 40 GiB gp3, standard CPU credits, IMDSv2, no inbound security-group rules, SSM access, and one fixed Elastic IP. The service has `MemoryMax=7000M`; the earlier 4 GiB controller failed during native SEA packaging. Builds remain sequential/offset. AWS guest previews must select exactly `t3.small` with the pinned encrypted gp3 root disk, enforced by the operator gate and the guest IAM policy. Hetzner guests are requested in `fsn1` (`--location fsn1`). Their server type is whatever the packaged Hetzner planner selects; nothing in this controller pins or checks it (on 2026-11-19 it selected `cx23`), so read it from the exported `preview.json`. Both runners restrict SSH to the controller EIP `/32`; see [Security limits](#security-limits) for what enforces that.

No September dollar estimate is current price evidence. Before provisioning, query current Ohio EC2, gp3, and public IPv4 rates plus current Hetzner server/IP rates. The full soak length is a preparation parameter, `--soak-hours 48` or `--soak-hours 72`, recorded in `campaign.json`. Every deadline derives from it: the hard controller window is the soak length plus six hours from preparation (54 or 78 hours), the supervisor's own deadline is the earlier of two hours before the controller stop and its start plus the soak length plus four hours, and `apply` and `start` must run by the start deadline described under [Launch window](#launch-window). Budget controller compute, 40 GiB disk, its public IPv4, one AWS guest and one Hetzner guest for about the soak length plus one hour each, and bounded private S3 inputs/evidence. Standard credits prevent unlimited-credit surcharges. Disk, EIP, retained proofs, and any unrecovered guest continue billing after an emergency stop until audited teardown.

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

Inspect the frozen `campaign.json`, `cloudformation.json`, operations hashes, soak length, controller deadline, and source identity. `campaign.json` records a SHA-256 for every operations file. Every command except `prepare` and `status` refuses if any of them changed, so run every command from one checkout, preferably a worktree at the candidate's tagged commit, and keep it unchanged until teardown. A later `purge-proofs` needs a checkout at that same commit. `apply` checks the account and AMI, records the create attempt before calling CloudFormation, and creates one exact CloudFormation stack. Lost responses reconcile that exact stack; they never recreate a campaign. If the create genuinely failed, `apply` exits with `campaign-stack-create-failed-rerun-apply`; fix the cause and rerun `apply` with the same state. A rerun first looks up the campaign stack by name and reconciles it if it exists. It creates again, with the same request token, only when CloudFormation reports that no stack has that name. Any other lookup failure or a foreign stack refuses. A rerun also refuses with `campaign-bucket-exists-without-stack-prepare-new-campaign` when no stack has the name but the campaign's fixed-name proof bucket exists. That means an earlier create got that far and its stack was deleted outside this tool; another create would fail on the bucket after launching a billed controller. If a create may still be in flight, wait a minute and rerun `apply`, which then adopts the stack. Otherwise take a read-only inventory, review and remove the retained bucket by hand, and prepare a new campaign. Only a `head-bucket` 404 counts as absence. Any other failure, such as a 403 or a network error, refuses with `campaign-bucket-absence-unverified-rerun-apply`; the bucket's absence could not be verified, so rerun `apply`. If that error persists, inventory the bucket name before doing anything else.

```sh
python3 ops.py apply --state /absolute/private/new-campaign
```

`ops.py` writes no transcript files. A shell redirection creates them with the shell's umask, so during the November campaign `apply.log` and `start.log` were world-readable (0644) until fixed by hand. To keep a transcript, run the command under a private umask instead of a plain redirection:

```sh
(umask 077; python3 ops.py apply --state /absolute/private/new-campaign > /absolute/private/new-campaign/apply.log 2>&1)
```

The six exact candidate inputs are uploaded with SSE-S3 and SHA-256 readback checks into the campaign's private bucket. The operations bundle is uploaded last. A short, digest-pinned userdata script waits for that bundle, verifies its bytes, and installs root-owned runtime code. This avoids the previous nearly exhausted 16 KiB userdata limit. A failed input upload can be resumed with `stage-inputs` using the same state. Bootstrap downloads no mutable GitHub release assets; only the immutable harness commit is fetched from GitHub. Node 24.13.1's Linux tarball digest and npm 11.12.0 remain pinned.

Deliver the existing `HETZNER_TOKEN` through private stdin to `ops.py token`; never put it in arguments, userdata, logs, or an environment file. `token` passes it to the AWS CLI through a pipe (`--value file:///dev/stdin`), so neither `ops.py` nor the request file writes it to disk, and it never appears in argv. The AWS CLI itself writes request and response bodies, including the secret, to `~/.aws/cli/history/history.db` when the `wharfie` profile sets `cli_history = enabled`, and no option turns that off for one command. `token` therefore refuses, before reading stdin, unless `aws configure get cli_history --profile wharfie` reports the setting unset or `disabled`. The parameter is then read back. It is stored in one exact SSM SecureString under the AWS-managed `alias/aws/ssm` key and never overwritten. If the put fails, `token` exits with `campaign-token-not-stored-rerun-token`; rerun it with the same token. A rerun accepts an existing parameter only when it holds the same SecureString value under `alias/aws/ssm`. The supervisor reads it into memory and maps it to `HCLOUD_TOKEN` only for Hetzner child processes.

After SSM confirms successful cloud-init and `bootstrap-ready.json`, run `start`. It verifies the fixed EIP and external stop schedule before enabling the service. Keep `authorize` running during initial setup: it approves the two exact AWS deployment IDs only after checking the immutable preview, candidate/harness commit, account, placement, image, root disk, and SSH `/32`. The controller role has no IAM privileges, cannot approve its own gate, and starts with read-only EC2 permissions. A failed or timed-out watch read is logged to stderr as `watch-read-failed` and retried on the next five-second cycle. It never counts as absence or approval. `authorize` stops after ten consecutive cycles with a failed read, after 15 minutes without a fully successful cycle, or at its two-hour limit, which it checks before every read; rerun it with the same state. An approval failure is never retried.

```sh
python3 ops.py start --state /absolute/private/new-campaign
python3 ops.py authorize --state /absolute/private/new-campaign
```

The two 15-minute rehearsals run sequentially and must both pass with verified cleanup before either full proof is accepted. Full builds are offset, then the AWS and Hetzner soaks overlap. Confirm both full runs' initial exports and fixed deadlines before leaving setup. Initial creation is limited to two hours, resumed observations to thirty minutes including runner cleanup, and explicit cleanup to twenty minutes, followed by a bounded TERM-to-KILL grace period. The acceptance runner retains its stricter five-minute observation limit. Every child except explicit cleanup is also capped at the supervisor deadline. A full soak must therefore end at least 45 minutes before that deadline: the 30-minute resumed-observation budget, five minutes of scheduling slack, and ten minutes for export retries before the final observation. Its final observation and runner teardown are then never terminated. The supervisor checks this before launching a full soak and again once the runner fixes the soak's end. If the time is insufficient, it fails the run early with a recorded `failureReason` and cleans up. A failed observation export is retried up to three times, after 15, 30, and 60 seconds, and no retry starts more than ten minutes after the first attempt. If it still fails, the run fails.

## Launch window

`start` launches the supervisor, and the setup after it has a fixed budget of two hours: both rehearsals, their gate approvals, and both full builds until the later full soak has started. This is the same two-hour window `authorize` watches. Measured setup was 57 minutes on 2026-11-19 (`start` returned 22:11:14Z, the Hetzner soak began 23:07:43Z, including a 37-minute gap partly caused by an `authorize` crash). On 2026-11-05 one rehearsal took 22 minutes from supervisor start to export. The budget leaves about one hour of headroom over the slowest measured setup.

After setup, the supervisor deadline must still hold the full soak and its 45-minute final-observation margin. With the deadline two hours before the external stop, `apply` and `start` therefore refuse with `campaign-start-window-passed-prepare-new-campaign` once less than the soak length plus 4 hours 45 minutes remains before the stop. That is 75 minutes after `prepare`, which prints the deadline as `startByUtc`. `prepare` applies the same rule and refuses with `campaign-window-cannot-hold-setup-and-full-soak` unless at least one hour remains for `apply`, bootstrap, `token`, and `start`. Measured: 9 minutes on 2026-11-05 and 46 minutes on 2026-11-19. Run `apply` well before `startByUtc`, because bootstrap must finish before `start`. An `apply` begun in roughly the last 11 minutes before `startByUtc` still creates a billed stack that `start` can no longer use (`apply` to `start` measured 10 m 55 s on 2026-11-19). The constants live in `supervisor.py` and `ops.py` imports them, so the operator and supervisor rules cannot drift.

## Security limits

Guest SSH ingress is limited to the controller EIP `/32` by the runner (`--allow-ssh-from`) and by the operator's gate check of the AWS preview (`allowedIpv4`). The guest IAM policy cannot enforce it. The EC2 service authorization reference lists no condition key for the CIDR, port, or protocol of `ec2:AuthorizeSecurityGroupIngress`; it offers only `ec2:Region`, resource tags, `ec2:SecurityGroupID`, and `ec2:Vpc`. The policy therefore limits ingress changes to the campaign's tagged guest security groups only. Code running with the controller role after guest authorization could add wider ingress to those groups. For Hetzner guests only the runner enforces the `/32`: there is no operator gate, and AWS IAM does not govern the Hetzner token.

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
