# V79 read-only retained-storage provider evidence checkpoint

Date: 2026-07-26

Parent:
[V78 read-only host toolchain fingerprint](./2026-07-25-v78-read-only-host-toolchain-fingerprint.md)
(`40c0fca33445e0922af760986908144050e7b066`)

Implementation:
`b6240ab5f63f9b00dd62eace7154bda350f21f4d` — add read-only
retained-storage provider evidence.

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

V78 added a bounded, command-free, device-free AL2023 host/toolchain
fingerprint. It still requires an ambient Node runtime and has not run on a
live AL2023 host.

V79 adds the controller-side half of the future purge-intended storage
experiment. It can double-read a pinned public AMI, one selected
experiment-tagged instance, its root volume, and one attached
experiment-tagged evidence volume through injected SSM/EC2 read facades. It
emits a strict non-authoritative receipt only when the normalized observations
agree. It cannot create, modify, format, detach, or delete anything.

## Evidence-only experiment contract

The V1 experiment descriptor is content-addressed as
`wre1_<base64url-sha256>` in the
`wharfie:aws-single-node:retained-storage-provider-experiment:v1` domain.
It binds:

- one caller-asserted lowercase 40-hex source commit;
- one exact `wps1` provider scope;
- one exact `wap6` provider specification;
- either the application-state or control-state volume role; and
- one canonical positive half-open UTC window no longer than six hours.

The descriptor has purpose
`"retained-storage-provider-qualification"` and `authority: "none"`.
Creation and deserialized validation are both bounded to 64 KiB. The
validator recomputes the exact semantic ID and returns a new deeply frozen
canonical value.

The experiment derives three exact tag sets for the selected instance, root
volume, and evidence volume. They bind the experiment ID, purpose, source
commit, expiration, resource kind, and evidence-volume role where applicable.
Every resource is deliberately tagged with purge intent through
`wharfie:retention=purge`; the tag sets contain no production binding,
ownership nonce, action ID, or formatter authority.

## Read-only provider collector

The production factory is:

```text
createAwsSingleNodeRetainedStorageProviderEvidenceCollector({
  providerScope,
  clients: {
    ssm: { getParameter },
    ec2: { describeImages, describeInstances, describeVolumes }
  },
  now
})
```

The factory accepts only those exact plain own-data method surfaces, captures
the methods once with their receivers, owns no client lifecycle, and exposes
only a frozen `{ collect }` facade. It has no mutation client or close method.
Provider failures are translated to fixed redacted evidence errors.

Every provider response is copied through a 1 MiB, depth-bounded, recursive
own-data snapshot before decoding. Accessors, symbols, cycles, exotic
prototypes, invalid dates, non-finite values, and oversized responses fail
closed without invoking response accessors. Valid SDK `Date` values are
isolated and preserved for the existing strict decoders.

`collect()` accepts only:

```json
{
  "experiment": "<exact V1 experiment>",
  "providerSpec": "<exact AWS single-node provider spec>",
  "instanceId": "i-...",
  "volumeId": "vol-..."
}
```

The input is bounded to 256 KiB before exact-key validation. The experiment,
provider scope, provider spec, and selected role must agree.

Each of two complete passes performs only:

1. version-qualified `GetParameter` with decryption disabled;
2. exact-ID `DescribeImages` constrained to Amazon, including the pinned
   disabled/deprecated views needed to reject them explicitly;
3. exact-ID `DescribeInstances`;
4. exact-ID `DescribeVolumes` for the evidence volume; and
5. exact-ID `DescribeVolumes` for the root volume derived from the instance
   mapping.

There are no discovery scans or tag-filter queries. The experiment window is
checked before the first pass, before the second pass, and again before
publication.

The collector requires:

- the pinned versioned public SSM parameter and exact Amazon-owned,
  public, available AL2023 image evidence;
- one account-owned running instance with the expected image, architecture,
  instance type, EBS/ENA/virtualization, tenancy, stable AZ ID, root device,
  exact experiment tags, and exactly two block mappings;
- a root volume distinct from the evidence volume and a root device distinct
  from the selected evidence device;
- an exact root-volume read matching the provider specification and root
  experiment tags;
- an exact evidence-volume read matching the selected retained capability's
  physical AZ/KMS/type/size/IOPS/throughput/multi-attach/encryption profile;
- no snapshot, source-volume, Outpost, fast-restore, or initialization-rate
  origin for the evidence volume;
- exact evidence tags and an in-use lifecycle; and
- agreeing instance and volume attachment views in `attached` state with
  `DeleteOnTermination=false` on both views.

The two normalized full observations must be identical. A changed
observation has a distinct typed unstable result rather than being published.

## Non-authoritative receipt

The V1 receipt is content-addressed as
`wpe1_<base64url-sha256>` in the
`wharfie:aws-single-node:retained-storage-provider-evidence:v1` domain. It is:

- classified `read-only-provider-no-host`;
- explicitly `authority: "none"` and `authoritative: false`;
- bounded to 256 KiB at collection and deserialized validation boundaries;
- exact-key validated at every receipt-owned nested structure;
- correlated to the complete provider scope, provider spec, experiment, and
  exact tag contract;
- secret-scanned before publication; and
- returned as a new canonical deeply frozen value after its semantic ID is
  recomputed.

The receipt records only the normalized machine-image, instance/storage,
root-volume, evidence-volume, attachment, and root-exclusion facts. It does
not contain raw SDK responses, credentials, client tokens, provider errors,
tool output, host paths, or device data.

Content addressing binds and identifies the exact receipt content; it does not
authenticate the issuer or truth, because an attacker can alter unsigned
content and recompute its hash. The conclusion is intentionally narrow: it
reports two stable provider-side observations and an instance **storage
projection** matching the provider spec. It does not claim the complete
instance matches every production resource contract.

## Shared machine-image evidence

The strict SSM parameter and EC2 image decoders previously private to the
provider-spec resolver now live in
`deployment-aws-machine-image-evidence.js`. The resolver delegates to those
pure decoders and translates their conflict, transient, and unknown results
back to its existing public error and retry contract. Focused resolver
regressions passed unchanged.

## Verification and disk hygiene

Validation used pinned Node **24.13.1**.

- six focused suites passed **143/143** tests;
- source, test, and SEA-verifier TypeScript configurations passed;
- targeted ESLint, Prettier, JavaScript syntax, staged-whitespace, and
  response-boundary adversarial checks passed;
- the focused Jest run used
  `--runInBand --coverage=false --cache=false`; and
- an independent safety review found and closed the unbounded creator-input
  and accessor-backed provider-response gaps before commit.

No full-repository Jest gate, coverage run, broad build, SEA/native package
build, npm install/pack, native LMDB execution, host storage tool, block-device
operation, live AWS call, resource creation, or purge-intended AL2023/EBS
proof was run.

The dedicated `/private/tmp/wharfie-v79-final` tree was removed immediately
after the focused run and verified absent. No generated build, coverage,
cache, package, or TypeScript build-info artifact remains. The host volume had
about **9.2 GiB** free at checkpoint time.

## Honest boundaries

V79 is provider-side read evidence from injected clients, not a complete
storage qualification:

- no live AWS response has qualified the current SDK/API field assumptions;
- the injected clients are assumed to use the recorded credential scope; the
  receipt does not independently attest their credentials;
- the experiment's source commit is caller-asserted and is not tied to the
  running collector or deployed bytes;
- the receipt is not signed and does not authenticate its issuer;
- AWS reads are not an atomic snapshot; two identical normalized passes only
  reduce, rather than eliminate, observation races;
- the selected experiment-host shape requires exactly two block mappings;
- the evidence volume has purge-intent tags while its physical profile is
  compared with the retained production capability;
- no provider mutation authority, resource creation/deletion path, or
  production provider assembly integration is added;
- no host identity binds this receipt to the V78 host fingerprint;
- no Linux device identity, blank-media, filesystem, tool, udev, flush,
  interruption, reboot, detach/reattach, or path-retarget evidence exists;
- the receipt cannot authorize formatting or advance the V75 journal; and
- formatting, mounting, control storage, health publication, selector
  delivery, deactivation, and clean-account lifecycle proof remain unfinished.

## Next slice

Do **not** implement formatter code or run live AWS yet.

The next safe local slice is a portable, source-bound, zero-argument SEA
delivery for the V78 host collector:

1. source it from an exact caller-selected Git commit through `git archive`,
   not the mutable worktree;
2. bake the source commit and provider architecture into the entry bundle;
3. embed and validate an independent content-addressed delivery manifest;
4. build through the existing low-level `NodeBinary` and `SeaBuild`
   boundaries without pulling in application/LMDB machinery;
5. publish only immutable content-addressed binary and sidecar artifacts; and
6. verify the schema and orchestration with injected build ports under pinned
   Node 24.13.1, without performing a native build on this Mac.

Actual AWS calls or creation of a purge-intended host/volume still require
explicit user approval. When approved, create only new expiring purge-tagged
resources, collect the V79 provider receipt and V78 host fingerprint first,
and qualify device/tool behavior separately before any destructive formatting
experiment.

## Repository state and resume instructions

The V79 implementation tip is
`b6240ab5f63f9b00dd62eace7154bda350f21f4d`. It was pushed to
`origin/agent/strict-manifest` before this checkpoint was finalized. The commit
containing this file is the V79 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from the V79 checkpoint commit, verify its implementation hash and
remote synchronization, and continue with the portable source-bound
zero-argument SEA delivery above. Before any live AWS experiment, obtain
explicit approval. Continue to pin Node 24.13.1, never run native LMDB on this
Mac, disable Jest cache and coverage for focused runs, never run block-device
tools locally, and remove every generated test or build artifact immediately.
