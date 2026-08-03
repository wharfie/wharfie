# V41 exact EC2 node-launch contract checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`d50d5b4a69c5a72a6a5658cc2b3869c5c315c608`

This checkpoint follows the
[V40 recoverable managed-artifact checkpoint](./2026-07-21-v40-recoverable-managed-artifact.md).
It closes the prerequisites for implementing the fixed graph's substrate node:
ProviderSpec V6 now owns every launch choice, the exact EC2 user-data bytes are
code-owned, and the invocation authority exposes only the node operations the
recoverable driver will need.

## Product direction remains unchanged

Wharfie is a Node-first framework for turning approachable TypeScript CLI
programs with named activities into portable Node SEA executables that can run
locally, remain resident as durable workers, and coordinate work across trusted
machines without requiring Node, containers, Kubernetes, or a hosted
orchestration service at the destination.

The executable may use the operator's ordinary provider credentials to create
the resources required by Wharfie's fixed abstractions. This is not general
cloud IaC, v1 compatibility is abandoned, and there are no known downstream
users. Breaking internal APIs are allowed when they shorten the path to the
intended design. One coordinator is acceptable initially if its durable state
and fencing permit robust recovery after coordinator loss.

## Why V5 could not launch a node honestly

ProviderSpec V5 selected an AMI and pinned a few instance properties, but it did
not authorize one exact `RunInstances` request. It omitted the AMI root-device
receipt and left multiple EC2 defaults implicit: purchase and tenancy,
monitoring, burst credits, protections, shutdown behavior, maintenance,
private DNS, the primary ENI, and the launched root volume. Its bootstrap digest
was also caller-selected, so the same Wharfie build did not own the bytes that a
node would execute as root.

V41 moves those choices into the content-addressed provider specification before
introducing a mutation driver. Existing V5 identities remain historical only;
there is no compatibility bridge or reinterpretation.

## Code-owned bootstrap bytes

`deployment-aws-node-bootstrap-contract.js` owns one immutable raw EC2 user-data
body:

```text
contract version: 1
digest domain:    wharfie:aws-single-node-bootstrap:v1
raw bytes:        1,561
base64 chars:     2,084
SHA-256 digest:   BvhiqCgVW8yJ5wjDbk9cSGcXgPklpEg2UeEJ4YLm3hs
raw limit:        16 KiB
```

The accessor returns a fresh buffer and a deterministic standard-base64 form.
The digest is SHA-256 over the versioned domain, a NUL separator, and the exact
raw bytes. The contract is canonical LF-terminated UTF-8 shell text with no NUL,
CR, template placeholder, credential-like material, deployment identity,
artifact location, or application bytes.

The script:

- creates and reasserts a locked `wharfie-runtime` system account with
  `/usr/sbin/nologin` and `/var/lib/wharfie-runtime`;
- creates fixed root-owned host/application directories and private runtime
  state/configuration directories;
- resolves and validates the account's numeric UID;
- installs a root-owned `IPAddressDeny=169.254.169.254/32` drop-in on the exact
  `user@<UID>.service` system unit;
- reloads systemd, enables lingering, and restarts that user manager so future
  application-service descendants enter the restricted cgroup;
- enables and starts the Amazon SSM agent; and
- deliberately does not download the artifact, write deployment configuration,
  or start the Wharfie application before later attachment/configuration effects
  settle.

The earlier draft used `/usr/sbin/iptables`; review caught that the standard
AL2023 AMI does not install that executable by default. V41 has no package-manager
or host-firewall-tool dependency. AL2023 uses cgroup v2 and systemd supports
unit-level IP filtering, but systemd documents that `IPAddressDeny` has no
effect where cgroup-BPF support is unavailable. Unit tests prove exact bytes,
base64, shell syntax, and structure, not enforcement on the selected AMI. A
pinned-AMI smoke test must prove both successful bootstrap and denied runtime
user-manager access to IMDS before Wharfie makes a production security claim.
See the [AL2023 cgroup-v2 contract](https://docs.aws.amazon.com/linux/al2023/ug/cgroupv2.html)
and the [systemd 252 resource-control source](https://github.com/systemd/systemd/blob/v252/man/systemd.resource-control.xml).

## ProviderSpec V6 / `wap6`

The provider-spec schema advances from V5/`wap5` to V6/`wap6`, with digest
domain `wharfie:aws-single-node-provider-spec:v6`. The provider contract remains
version 3. Both factory and resolver reject a caller-supplied `bootstrapDigest`;
the V6 node embeds the code-owned bootstrap version and digest.

The resolved AMI receipt now requires exactly one block-device mapping at one
canonical root device. It must be EBS-backed by one canonical snapshot, `gp3`,
8-64 GiB, unencrypted at the public image source, and delete-on-termination.
Virtual and `NoDevice` mappings are rejected. The launched root volume is then
derived exactly from that receipt and the resolved account/Region default EBS
KMS key:

```text
storage:             ebs-volume
volume type:         gp3
size:                source AMI root size
IOPS:                3,000
throughput:           125 MiB/s
encrypted:           true
multi-attach:         false
delete on termination:true
lifecycle:           purge
```

The node contract additionally fixes:

- default tenancy and on-demand purchase;
- architecture-derived `t3.small` or `t4g.small`;
- EBS optimization enabled and detailed monitoring disabled;
- standard CPU credits and no capacity reservation;
- guest shutdown stops the instance;
- termination and stop protection disabled;
- hibernation and enclaves disabled;
- default maintenance auto-recovery;
- IMDS endpoint enabled, tokens required, hop limit one, IPv6 disabled, and
  metadata tags disabled;
- private hostname type `ip-name`, with resource-name A and AAAA records
  disabled; and
- one device-index-zero/network-card-zero `interface` ENI in the fixed subnet,
  with the fixed security group, one public IPv4 association, delete on
  termination, source/destination checking, and no secondary IPv4 or IPv6
  addresses.

Validation recomputes the canonical `wap6_` identity and rejects any drift in
these fields, including a valid digest from different bootstrap bytes. All
downstream fixtures now resolve the exact AMI root receipt and consume V6; the
chronological ADR still retains V4/V5 descriptions as history.

## Narrow recoverable node authority

`createAwsDeploymentAuthority().createNodeResourceClient()` creates a separate,
caller-owned EC2 client from the invocation's frozen credential snapshot and
explicit Region. Its SDK transport has exactly one attempt so hidden retries do
not multiply an ambiguous mutation. Its frozen public surface contains only:

- `runInstances`;
- `startInstances`;
- `describeInstances`;
- `describeInstanceAttribute`;
- `describeVolumes`;
- `terminateInstances`; and
- idempotent `close`.

`StartInstances` is deliberate. V6 uses stop-on-guest-shutdown so a coordinator
that is merely stopped can be recovered in place rather than left as an
operator-only blocked state. The future driver must still re-prove ownership and
exact state before starting, use one-attempt mutation, and settle only from
fresh readback.

The boundary preserves only the provider classifications required for recovery:
`IdempotentParameterMismatch`, both documented instance-not-found spellings,
`InvalidVolume.NotFound`, `IncorrectInstanceState`, and
`OperationNotPermitted`, plus a bounded integer 400-599 HTTP status. Every
other failure is one fixed node-operation error. Raw SDK messages, request IDs,
causes, access details, credentials, and credential-bearing configuration never
cross the boundary. Creation failure, close failure, use after close, frozen
surface, single credential snapshot, caller ownership, and cross-client
isolation all have focused coverage.

## What this slice does not claim

V41 does not create or adopt an EC2 instance. It supplies deterministic desired
state and narrow authority for the next resource effect. In particular:

- no `RunInstances`, `StartInstances`, or `TerminateInstances` response is a
  durable receipt;
- no API-call exactly-once claim is made;
- no live AMI, boot, cloud-init, SSM, systemd, cgroup-BPF, IMDS-denial, or
  reboot proof is claimed;
- no substrate desired-state digest, atomic ownership-tag envelope,
  dependency-lineage proof, instance receipt, root-volume proof, response-loss
  recovery, or terminal-state deletion evidence exists yet;
- no retained-volume attachment, guest format/mount, managed-artifact install,
  or resident-service activation exists in the provider path; and
- implemented graph effects are not yet composed behind complete provider
  inspection, deterministic planning, routing, or deployment commands.

EC2 may continue returning a terminated instance for a period after termination.
The next driver must treat exact `terminated` state as terminal deletion evidence
instead of waiting indefinitely for physical disappearance, while continuing to
reject a live or foreign occupant. AWS documents this observation window in
[`DescribeInstances`](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html).

## Verification commands and disk hygiene

Use pinned Node 24.13.1, serial Jest, no coverage, and no Jest cache:

```sh
TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-node-bootstrap-contract.test.js test/runtime/deployment-aws-authority.test.js

TZ=UTC /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node ./test/run-jest.js --runInBand --coverage=false --no-cache test/runtime/deployment-aws-provider-spec.test.js test/runtime/deployment-aws-provider-spec-resolver.test.js

env PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/local/bin:/usr/bin:/bin /Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run typecheck

/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node /Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js run lint:js

git diff --check

find . -path './node_modules' -prune -o \( -name coverage -o -name dist -o -name build -o -name .cache -o -name '*.tsbuildinfo' -o -name '*.tgz' \) -print
```

Final focused bootstrap/authority gate: **107/107 tests**. Final focused
provider-spec/resolver gate: **178/178 tests**. Final diff-scoped aggregate
regression gate: **1,425/1,425 tests** across all 24 touched runtime suites.

All four source, application, test, and SEA-verifier TypeScript configurations
pass. Repository JavaScript lint, Prettier, diff integrity, and the final
generated-artifact scan also pass. Do not run the repository's
coverage-producing default test command while preserving disk hygiene.

## Ordered next work

1. Implement the controller-compatible substrate EC2 resource. Its desired
   state must bind ProviderSpec V6 plus all eight fixed graph dependencies:
   artifact, subnet, default route, subnet/route-table association, security
   group, runtime policy, instance profile, and role/profile association.
2. Build one exact `RunInstances` request with a stable 64-hex client token,
   atomic complete ownership tags on both instance and root volume, exact
   instance profile/subnet/security-group/ENI/root/user-data fields, and no
   implicit launch defaults.
3. Recover fresh create, lost response, no-op, stopped-node restart, and destroy
   through bounded logical discovery plus exact-ID instance, user-data,
   protection, and root-volume readback. Treat exact terminated state as
   terminal deletion evidence rather than waiting for EC2's tombstone to vanish.
4. Implement the application-state and control-state retained-volume attachment
   effects with exact node/volume dependency lineage, guest devices,
   `DeleteOnTermination=false`, bidirectional provider evidence, and detach
   recovery.
5. Compose implemented resource effects into graph-wide inspection,
   deterministic planning, provider routing, and controller ports; then project
   storage, install the exact managed artifact, and activate the resident
   service.
6. Add a pinned-AMI smoke proof for bootstrap completion, systemd cgroup-BPF
   IMDS denial, SSM availability, stop/start recovery, reboot, and the later
   complete single-node lifecycle.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v41-exact-node-launch-contract.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; do not spend time on PRs
> or issues. Breaking changes are allowed, v1 compatibility is abandoned, and
> the historical stash must remain untouched. ProviderSpec V6/`wap6` owns the
> exact AMI root receipt, launch behavior, ENI, encrypted root volume, metadata,
> private DNS, and the exact code-owned bootstrap digest. Preserve the 1,561
> raw bootstrap bytes and their pinned digest unless deliberately advancing the
> contract. The systemd `IPAddressDeny` drop-in covers the runtime user-manager
> subtree; do not claim pinned-AMI enforcement until it is exercised. The node
> authority is single-attempt and exposes only run, start, exact reads,
> terminate, and close. Next implement the recoverable substrate driver with all
> eight dependency bindings, stable client token, atomic instance/root tags,
> exact readback, stopped-node recovery, response-loss recovery, and terminated-
> state deletion evidence. Then implement both retained-volume attachments and
> compose the graph-wide provider. Run focused pinned-Node tests with coverage
> and caches disabled, remove generated artifacts, commit and push checkpoints,
> and preserve the historical stash.
