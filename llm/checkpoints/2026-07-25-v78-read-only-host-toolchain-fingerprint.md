# V78 read-only host toolchain fingerprint checkpoint

Date: 2026-07-25

Parent:
[V77 authorized storage preparation command](./2026-07-25-v77-authorized-storage-preparation-command.md)
(`5fe2033071acd949e3baf3b0b288e7d2af6ebdb4`)

Implementation:
`78e4e2ef8144342ac8d46f2a1b7b11a41a6cbfbf` — add read-only
retained-storage host fingerprinting.

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be
packaged as one portable SEA, run locally, become a durable resident service,
and be projected into a trusted cloud node without requiring Node,
containers, Kubernetes, or a hosted orchestration service on that node. Its
larger purpose is to carry an author's intent beyond one interactive LLM
session while keeping the resulting service understandable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use the operator's ordinary cloud credentials to create the
specific resources they require. The public path remains Node-first; native
bindings or WASM remain available for measured hot paths. Exactly-once claims
remain abstraction-specific and require durable protocol evidence.

V77 integrated non-destructive application-storage preparation through the
real V66 activation and V69 persistence paths using synthetic physical
observations. It intentionally stopped before formatter code and required
disposable AL2023/real-EBS evidence.

V78 adds the first repository-native evidence collector for that boundary. It
is deliberately narrower than the future disposable-volume experiment: it
fingerprints only a root/Linux Amazon Linux 2023 host and fixed toolchain
files. It opens no block device, invokes no tool, calls no cloud or metadata
endpoint, writes no receipt, and grants no formatter authority.

## Closed read/digest-only collector

The production factory is:

```text
createAwsRetainedStorageHostPreflightCollector()
```

It accepts no options, requires real and effective root on Linux, closes over
two native read-only ports, and returns only a frozen `{ collect }` facade.
Production callers cannot inject paths, commands, devices, cloud clients, or
write capabilities.

The test-only factory is:

```text
createAwsRetainedStorageHostPreflightCollectorForTest({
  host,
  ports: { inspectPath, readText }
})
```

Both methods are captured once with their receivers. `collect()` accepts the
exact input:

```json
{
  "sourceCommit": "<lowercase 40-hex commit>",
  "expectedArchitecture": "x86_64 | arm64"
}
```

The source commit is explicitly caller-provided. The receipt does not inspect
or attest a Git worktree.

The collector reads only these fixed paths:

- `/etc/os-release`;
- `/proc/sys/kernel/random/boot_id`;
- `/etc/mke2fs.conf`;
- `/usr/bin/systemctl`;
- `/usr/bin/udevadm`; and
- fixed `/usr/sbin` candidates for `mke2fs`, `mkfs.ext4`, `dumpe2fs`,
  `tune2fs`, `debugfs`, `e2fsck`, and `blockdev`.

It does not inspect or execute `lsblk`, `blkid`, or `wipefs`. It never accepts
a device path.

Every present path is resolved through at most eight symlinks. Symlink and
terminal metadata must remain stable while read, every recorded path element
must be root-owned, and terminal files must not be group- or world-writable.
Tool candidates must be executable and remain within `/usr/bin` or
`/usr/sbin`. `/etc/os-release` may resolve only to itself or
`/usr/lib/os-release`; the boot ID and mke2fs configuration may not redirect.
Regular files are opened with read-only, no-follow, and nonblocking flags,
bounded, hashed through a stable descriptor, and rechecked.

Procfs reports the boot-ID file with size zero despite returning bytes. The
native reader handles only that one fixed virtual file specially and records
the bounded bytes actually read.

The complete file/text observation runs twice. Both snapshots, including
boot ID and all digests, must be identical before a receipt can be returned.
Amazon Linux must be exactly `ID=amzn`, `VERSION_ID=2023`; the Node and
provider architectures must agree; and real/effective UID must both be zero.

## Non-authoritative evidence receipt

The receipt is:

- exact-schema V1 and deeply frozen;
- classified `read-only-no-device`;
- explicitly `authority: "none"` and
  `authoritative: false`;
- bounded to 256 KiB at the serialized validation boundary;
- content-addressed as
  `whe1_<base64url-sha256>` in the
  `wharfie:aws-single-node:retained-storage-host-toolchain-preflight:v1`
  domain; and
- rejected if its exact nested schema, fixed file slots, AL2023/root/
  architecture facts, configuration correlation, fixed limitations, or
  recomputed ID differ.

The receipt includes:

- caller-provided source commit;
- AL2023 identity;
- kernel release, boot ID, root identity, Node version/architecture, and
  requested provider architecture;
- exact fixed-path state, symlink chain, owner/mode/size, terminal path, and
  SHA-256 for every present file; and
- the mke2fs configuration byte length and SHA-256.

It does not publish OS-release bytes, binary bytes, mke2fs configuration
bytes, tool output, environment variables, credentials, cloud topology, or
device data. The mke2fs fingerprint proves exact bytes were stable during
collection but does not reveal those bytes or qualify includes/defaults.

The pure
`validateAwsRetainedStorageHostPreflightReceipt()` boundary validates a
deserialized receipt, recomputes its ID, and returns a new canonical deeply
frozen value. That authenticates the exact evidence bytes, not their issuer
or truth.

## Path-free CLI

The one-shot CLI accepts only:

```text
collect-aws-host-retained-storage-preflight-linux.js \
  <source-commit> <x86_64|arm64>
```

The package script is:

```text
npm run verify:host:retained-storage:preflight -- \
  <source-commit> <x86_64|arm64>
```

The CLI validates both arguments before constructing the native collector and
emits one canonical JSON line to stdout. It accepts no request-file path,
device path, output path, endpoint, or arbitrary JSON. It performs no receipt
write. An outer disposable-host harness must capture stdout and bind delivery
to the committed source.

## Verification and disk hygiene

Validation used pinned Node **24.13.1**.

- the collector and CLI suites passed **30/30**;
- source, test, and SEA-verifier TypeScript configurations passed;
- targeted ESLint, Prettier, JavaScript syntax, and whitespace checks passed;
- focused Jest runs used `--runInBand --coverage=false --cache=false`; and
- two independent final safety reviews found no remaining production blocker.

No full-repository Jest gate, broad build, SEA/native package build, native
LMDB execution, host storage tool, child command, block-device operation,
live AWS call, or disposable AL2023/EBS proof was run. Native LMDB remains
excluded on this Mac because prior execution terminated the process with an
allocator double-free.

Every dedicated `/private/tmp/wharfie-v78-*` tree was removed and verified
absent. No generated build, coverage, cache, package, or TypeScript build-info
artifact remains. The repository measured about **531 MiB**, with about
**9.6 GiB** free on the host volume at checkpoint time.

## Honest boundaries

V78 is a host fingerprint, not live storage evidence:

- the collector has not run on AL2023;
- the CLI still requires the pinned Node runtime; a portable SEA delivery path
  for the disposable host is not yet implemented;
- package ownership, tool version/help output, full path ancestry, and
  included mke2fs configuration are not observed;
- the current production storage observer's `blkid --probe` path is not
  classified as provably inert; V78 deliberately does not invoke it;
- no AMI owner/parameter version, instance identity, volume ownership,
  encryption, snapshot origin, attachment, root-volume exclusion, or
  disposable grant is observed;
- no block device, NVMe identity, by-id path, rdev, holder, partition, mount,
  namespace, blank signature, or udev behavior is observed;
- no formatter dry run, format, profile readback, interruption, flush,
  reboot, power-loss, detach/reattach, or path-retarget experiment is run;
- the receipt cannot authorize formatting or advance the V75 journal;
- V77 still requires fresh controller authorization, a current local fence,
  prepared-journal reread, and immediate exact-media reobservation at the
  future mutation boundary; and
- production host assembly, selector delivery, mounting, control storage,
  health publication, deactivation, and clean-account lifecycle proof remain
  unfinished.

## Next slice

Do **not** implement formatter code yet.

Safe local work may now add:

1. a controller-side read-only provider-evidence schema over injected clients
   for pinned AMI, instance, disposable-volume, attachment, and root-volume
   exclusion facts; and
2. a portable, source-bound delivery path for this host collector so a
   pristine disposable AL2023 node does not require an ambient Node install.

Actual AWS calls or creation of a disposable host/volume still require
explicit user approval. When approved, create only new disposable resources,
bind them to an expiring exact grant, capture the provider and host
fingerprints first, and then separately qualify device inspection and tool
behavior. Destructive formatting, interruption, reboot, and detach/reattach
experiments remain a later explicitly authorized phase.

## Repository state and resume instructions

The V78 implementation tip is
`78e4e2ef8144342ac8d46f2a1b7b11a41a6cbfbf`. It was pushed to
`origin/agent/strict-manifest` before this checkpoint was finalized. The commit
containing this file is the V78 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from the V78 checkpoint commit, verify its implementation hash and
remote synchronization, and continue with the safe local provider-evidence or
portable-delivery work above. Before any live AWS experiment, obtain explicit
approval. Continue to pin Node 24.13.1, never run native LMDB on this Mac,
disable Jest cache and coverage for focused runs, never run block-device tools
locally, and remove every generated test or build artifact immediately.
