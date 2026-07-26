# V82 real Linux SEA build and execution proof checkpoint

- **Date:** 2026-07-26
- **Status:** **NON-AUTHORITATIVE TRUSTED-RUNNER LINUX/X64 SEA BUILD AND EXECUTION EVIDENCE**
- **Branch:** `agent/strict-manifest`
- **Validated source implementation:** `b53aac82b8edc405851ca4b8e9b1a8940be39fda`
- **V81 restart marker before proof:** `a3cabad06bd29811d48ce0581388849f03a9d5ed`
- **Parent checkpoint:** [V81 exact-source SEA publication](./2026-07-26-v81-exact-source-sea-publication.md)
- **Checksummed evidence:** [proof directory](../../llm_artifacts/sea-linux-proof/b53aac82b8edc405851ca4b8e9b1a8940be39fda/)

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that becomes one
portable SEA, can run locally or remain resident, and can be projected onto
trusted cloud nodes without installing Node, containers, Kubernetes, or a
hosted orchestration service on those nodes.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC. Its finite
abstractions may use ordinary operator credentials to create only their
required resources. Node/TypeScript remains the public path, with native/WASM
reserved for measured hot paths. Exactly-once claims require durable
abstraction-specific proof.

The standing workflow remains local Git CLI work, not PR/issue/tracker work.
Focused commits and pushes are authorized. Build/test artifacts must be
isolated and removed immediately because the host disk is constrained.

V80 defined the zero-argument host-preflight SEA runtime. V81 closed
exact-commit source capture, verified runtime bundling, same-generation build
evidence, artifact records, crash-recoverable publication, and the packaging
command. V82 supplies trusted-runner evidence that the path produced and
executed a real Linux/x64 SEA.

## Disposable proof environment

The proof reused an already-present local Docker image with pulls disabled:

```text
image:
  node@sha256:de951ccb5f52277af681a421e3328760fc4d22fbf20c391d78ef85af58430df6
platform:
  linux/amd64
base image Node:
  24.11.0
kernel host:
  Docker Desktop LinuxKit on Apple arm64
execution:
  x86_64 emulation
```

No VM or container image was downloaded. The base image's Node was not used
as the builder because the SEA contract requires exact Node 24.13.1. The image
identifier recorded in the receipt was supplied by the host-side runner; it
was not independently introspected or attested inside the container.

Inside one `--rm --pull=never --platform=linux/amd64` container, the proof:

1. cloned a complete local Git bundle;
2. detached at exact commit
   `b53aac82b8edc405851ca4b8e9b1a8940be39fda`;
3. downloaded `node-v24.13.1-linux-x64.tar.gz` and the official
   `SHASUMS256.txt`;
4. required archive SHA-256
   `7ad28fb172a9ab0593f86c1a39e5c268d0d8fc3d6cb0167f455b5655a7a6e2fd`;
5. installed exact npm 11.12.0;
6. ran locked `npm ci` with `--ignore-scripts --no-audit --no-fund`;
7. invoked the production V81 packaging command under exact Node 24.13.1;
8. regenerated the selected entry bundle, rehashed final artifact bytes, and
   checked the published record for self-consistency using the V81
   implementation under test;
9. executed the SEA through four controlled cases;
10. removed the artifact, sidecar, relocated copy, bootstrap Node,
    dependencies, repository clone, logs, and all other work bytes; and
11. emitted only a 2,964-byte non-authoritative JSON receipt and its checksum.

Lifecycle scripts were disabled deliberately. No LMDB native test or
application runtime was invoked.

Before deletion, the one-off proof inputs had these operator-observed SHA-256
digests:

```text
repo.bundle:
  8bd4409c6edac3f336aa266fd7d3a0b922ee13f6a3efbeefcae4a1efb12eec9b
run-proof.sh:
  978814b84c4f416e5b1b5c220091be177128503f3b7fa6ec62c226a5ff06043c
verify-proof.mjs:
  bfb472747165951cc1520a79738cc7aaae76ab9869319199a634af3d4c4efcfc
```

These values preserve an audit breadcrumb, but the receipt does not bind them
or the exact Docker invocation. The scripts were intentionally not promoted
as reusable tooling in this slice.

A separate post-proof audit reproduced the source archive from the clean,
detached exact commit and matched the receipt's recorded size and digest. That
operator audit did not prove that the retained final executable incorporated
the whole archive.

## Produced artifact evidence

The temporary immutable pair identified:

```text
proof:
  whlp1_uAl23aSzvDFxOLClUu7H0aNvnyTYPB1kmx6H4xMN9eQ
artifact:
  waf1_VW4X_-JA5Es72LMQylZnEaeCM5tXuGogNRwHtuEtddY
record:
  whp1_sCEIGLoC2d6yLCgc5AG8GmXaAB6sXvP2C_DzDVG7NlM
```

The final SEA was 122,752,192 bytes with SHA-256/base64url
`VW4X_-JA5Es72LMQylZnEaeCM5tXuGogNRwHtuEtddY`.

Its record binds:

- source archive: 17,233,920 bytes,
  `r0xPkFVa9d7jH3ffchmh5Qj-Bm2hfPSOVSq2CTHqARs`;
- exact entry bundle: 35,186 bytes,
  `Srmd-5w7speEUv942QCzlIlOSipAkt-5Jk8K25VIaL0`;
- generated runtime bundle: 130,907 bytes,
  `7dC8uINOE08b8lQSwfHqn00X6ssJJ-5tiC-0alv7d90`;
- generated SEA blob: 131,662 bytes,
  `j2a0Lfny3ysiXtdbZ9PQ26lPi13IXTfOOneaTT6Z-M4`;
- official pre-injection Node binary: 122,523,096 bytes,
  `2V3lLMt2-yxXdb8XbynzAl5LGTUsCSqtUc5dkwcXNZ8`;
- official Node archive:
  `node-v24.13.1-linux-x64.tar.gz`,
  `etKPsXKpqwWT-GwaOeXCaNDY_D1ssBZ_RVtWVaem4v0`;
- target: Node 24.13.1, Linux, x64, glibc; and
- signing: explicitly unsigned.

The Node archive digest in the post-build record is the base64url form of the
independently bootstrapped official archive's hexadecimal SHA-256.

## Execution matrix

Every execution used an explicit minimal environment with:

```text
PATH=/usr/bin:/bin
HOME=/tmp
TMPDIR=/tmp
LANG=C
LC_ALL=C
```

The proof first required `command -v node` to fail under that `PATH`. The base
image still contained Node elsewhere on its filesystem, and the bootstrapped
builder Node tree still existed outside that `PATH` during the runtime cases.
This proves the SEA did not need Node discoverable through the runtime command
path, not that no Node bytes existed anywhere in the container.

The matrix executed:

1. the original published SEA with zero user arguments;
2. a copied/renamed SEA from another directory with zero user arguments;
3. the relocated SEA with one unexpected argument; and
4. the relocated SEA with
   `NODE_OPTIONS=--require=<controlled-preload>`.

All four exited with status 1, empty stdout, and the same fixed 57-byte
redacted stderr:

```text
AWS retained-storage host preflight SEA delivery failed.
```

The stderr SHA-256/base64url is
`ZivTFMztiLh0VvgJtzIU9TWYgnAXuzeIZ7uA4pExZLs`. Empty stdout has the standard
SHA-256/base64url
`47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU`.

The controlled `NODE_OPTIONS` preload would have created a sentinel file. No
sentinel was created. This proves the packaged execution did not extend itself
with that inherited preload.

The unexpected-argument case is retained as an observation, not an isolated
runtime proof of argument closure. Because the zero-argument execution already
fails on this unsupported host and all runtime failures collapse to the same
fixed error, broken argument validation could produce the same observed
status/output. The V80 unit contract and source inspection establish the
argument check; a successful supported-host baseline is still needed to prove
the packaged rejection independently.

The zero-argument failure is expected on the Debian Bullseye proof image. The
collector is intended for the exact AL2023 host contract and every delivery or
collector failure is deliberately collapsed to the same fixed error. This
proof therefore establishes safe startup, embedded execution, launch of a
copied executable from a different pathname, specific preload non-extension,
and failure redaction. The copied executable remained in the same container
while the original publication and sidecar still existed, so this is not proof
of independence from the original publication or runtime environment. It also
does not establish a successful AL2023 host fingerprint or independently
isolate argument rejection.

## Receipt and cleanup evidence

The committed receipt is explicitly:

```json
{
  "authority": "none",
  "authoritative": false
}
```

Its checksum is:

```text
a0d20326994efd6f15063e14c80496d9fcf7f57fc4ba8c168dfc7df84fd85f48  proof.json
```

The receipt contains no host path, temp path, credential, token, secret,
package log, Node download body, raw tool output, or executable bytes.

After container exit:

- `docker ps -a` found no proof container;
- Docker reported zero containers and zero local volumes;
- image count/size remained 241 / 218.3 GB;
- build-cache count/size remained 798 / 746.4 MB;
- no image pull or Docker build occurred;
- the unrelated 218.3 GB of reclaimable local images was not pruned or
  modified; and
- host free space was about 9.8 GiB.

The temporary host proof root was only 7 MiB before final removal: one Git
bundle, the ephemeral runner/verifier, and the copied 8 KiB receipt. All large
build, Node, dependency, SEA, and sidecar bytes lived only in the auto-removed
container layer. The receipt records removal of its artifact/work subtree; the
later container exit and host-root removal were separately observed by the
operator and are not receipt-bound.

## Honest boundaries

V82 is a real Linux SEA build/execution proof with important limits:

- Docker executed Linux/x64 under emulation on an arm64 Mac; this is not
  physical x86_64 hardware or an AL2023 kernel/userspace;
- the exact base image is content-identified but is not signed or attested by
  Wharfie, and its receipt field was supplied by the host-side runner rather
  than independently measured in-container;
- the proof used external nodejs.org and npm registry responses;
- package-lock integrity and the official Node checksum protect downloaded
  bytes, but no transparency-log or signature verification was performed;
- the artifact and artifact record are unsigned;
- the receipt's `whlp1` ID was produced by an ephemeral proof verifier, not a
  committed Wharfie proof schema or validator;
- the ephemeral runner/verifier source is not bound into the receipt;
- content hashes expose later alteration but authenticate neither the runner
  nor the execution;
- the verifier imported validation, bundling, and canonicalization code from
  the exact implementation under test and reconstructed much of the
  generation evidence from the record itself;
- the verifier independently regenerated the entry bundle and rehashed final
  SEA bytes, and a separate audit regenerated the source archive, but it did
  not extract and hash the embedded runtime bundle or SEA blob from the final
  executable;
- runtime-bundle, SEA-blob, and pre-injection Node-source digests therefore
  remain honest-builder evidence, and the proof does not independently bind
  the whole claimed source archive to the final executable;
- the durable receipt omits the full artifact record, repository bundle,
  runner/verifier source, artifact bytes, and exact invocation, so after
  cleanup it preserves results and integrity identifiers rather than a
  self-contained rerunnable proof;
- the copied executable was launched from a sibling path in the same container
  while the original executable and sidecar remained present;
- the base image and bootstrap tree still contained Node outside the
  restricted runtime `PATH`;
- fixed redaction intentionally prevents the receipt from distinguishing
  argument rejection or embedded-manifest failure from host/collector
  failure;
- the receipt is historical engineering evidence, not authorization or policy
  evidence, and it does not demonstrate successful AL2023 execution;
- the executable and sidecar were removed after proof and cannot be
  independently rerun from this checkpoint;
- no systemd residency, reboot, interruption, or crash-recovery case was
  exercised for this specific host-preflight SEA;
- no live AWS API, IAM credential, EC2 instance, EBS volume, device, udev,
  filesystem, flush, detach/reattach, or path-retarget evidence exists;
- no formatting or block-device mutation occurred;
- V79 provider evidence and V78 host evidence are not yet joined on one live
  host; and
- exactly-once work execution and recoverable coordinator authority are
  unchanged.

## Next safe work

Before any live AWS experiment, close the local proof reproducibility gap:

1. promote the ephemeral Linux runner into a committed, bounded,
   pull-disabled proof driver;
2. define and test a strict transported artifact-record validator that can
   distinguish independently verified final bytes from honest-builder
   intermediate evidence;
3. define a stable non-authoritative Linux proof receipt schema and validator;
4. bind the runner/verifier revision and exact environment contract into that
   receipt; and
5. retain only checksummed JSON evidence while continuing to delete all
   executable/build bytes.

Only after explicit user approval should Wharfie create a disposable AL2023
host and EBS volume. That experiment must use newly created, expiring,
purge-tagged resources, collect V79 provider evidence and V78/V80 read-only
host evidence first, and keep formatting or any other block-device mutation
behind a separate explicit authorization.

## Repository state and resume instructions

The validated implementation is
`b53aac82b8edc405851ca4b8e9b1a8940be39fda`; the proof ran from an exact
detached checkout of that commit. The pre-proof V81 checkpoint marker is
`a3cabad06bd29811d48ce0581388849f03a9d5ed`. The commit containing this file
and the checksummed receipt is the V82 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from the V82 checkpoint commit. Use only local Git CLI work unless the
user reopens tracker scope. Breaking changes remain acceptable. Pin Node
24.13.1, disable test cache/coverage, use disposable roots, remove generated
artifacts immediately, never run native LMDB on the Mac, never run local
block-device tools, and obtain explicit approval before live AWS or
purge-intended resource work.
