# V81 exact-source SEA publication checkpoint

Date: 2026-07-26

Parent:
[V79 read-only provider evidence](./2026-07-26-v79-read-only-provider-evidence.md)
(`c7ff2c2` is the corrected V79 checkpoint marker).

V80 implementation:
`0e13485a201282bbac0689b5a7ca6f4473f04b04` — add the source-bound,
zero-argument host-preflight SEA delivery contract.

V81 implementation:
`b53aac82b8edc405851ca4b8e9b1a8940be39fda` — add exact-commit
source capture, verified bundling, same-generation SEA evidence, immutable
artifact records, crash-recoverable publication, and the packaging command.

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be
packaged as one portable SEA, run locally, become a durable resident service,
and be projected onto trusted cloud nodes without requiring Node, containers,
Kubernetes, or a hosted orchestration service on those nodes. The larger
purpose is to carry an author's intent beyond one interactive LLM session
while keeping the resulting service understandable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use an operator's ordinary cloud credentials to create the
specific resources they require. The public path remains Node/TypeScript
first. Native bindings or WASM remain available for measured hot paths.
Exactly-once claims remain abstraction-specific and require durable proof.

The user's standing workflow is local repository and Git CLI work, not
PR/issue/tracker cleanup unless that scope is explicitly reopened. Focused
commits and pushes to the existing work branch are authorized. Tests and
builds must use isolated temporary roots and be removed immediately so they do
not consume the host's limited disk.

V79 stopped at strict read-only provider evidence for a future
purge-intended retained-storage qualification experiment. V80 then closed the
runtime contract for a zero-argument Linux SEA that reads and validates one
embedded delivery manifest before running the read-only V78 host/toolchain
collector.

V81 closes the local packaging contract around that runtime. A caller can now
select one exact Git commit and target architecture, prove the runtime graph
matches the live packager, build through the existing low-level NodeBinary and
SeaBuild boundaries, produce a post-build evidence record, and publish one
immutable content-addressed binary/sidecar pair.

The command surface is:

```text
npm run package:host:retained-storage:preflight:sea -- \
  <40-lowercase-hex-commit> \
  <x86_64|arm64> \
  <canonical-absolute-output-directory>
```

This command is designed to download the official target Node archive and
perform a native SEA build. That native path remains unproved and the command
was not invoked on this Mac.

## V80 zero-argument delivery

The V80 delivery manifest binds:

- one caller-selected lowercase 40-hex source commit;
- the fixed read-only host-preflight collector entrypoint;
- a zero-argument invocation contract;
- one provider architecture (`x86_64` or `arm64`);
- Node 24.13.1 on Linux/glibc; and
- explicit non-authority (`authority: "none"`,
  `authoritative: false`).

The manifest is canonical, bounded, content-addressed, secret-scanned, and
embedded at the fixed SEA asset name
`<WHARFIE_HOST_PREFLIGHT>/delivery.json`. Runtime startup requires a real SEA,
no extra user arguments, the exact target host shape, and a valid embedded
manifest before it runs the collector.

The delivery identity authenticates neither its author nor its truth. It
identifies exact content.

## Exact Git source capability

`aws-host-retained-storage-host-preflight-sea-source.js` creates a temporary
private source snapshot capability for one exact commit.

Its production Git boundary:

- invokes fixed shell-free Git argv;
- removes ambient `GIT_*` influence and disables replacement objects;
- isolates global/system configuration and attributes;
- resolves the exact commit object;
- requires the repository object format to agree with the requested ID;
- reads a bounded `git ls-tree -r -z --full-tree`;
- creates a deterministic `git archive` with a fixed tar umask; and
- confirms the archive's embedded commit ID.

The archive is limited to 32 MiB in memory, 32 MiB expanded, 2 MiB per file,
and 4,096 entries. Only canonical regular Git blobs with mode `100644` or
`100755` are accepted. Symlinks, gitlinks, special entries, duplicate paths,
implicit parents, traversal, and entries below files fail closed.

Every tar file's Git blob hash, mode, and exact path set must match the
selected commit tree before extraction. After extraction, every file is read
through a bounded stable file handle and rehashed against the selected Git
blob. Files are normalized to mode 0600 and directories/root to 0700. The
returned frozen capability contains only:

```text
{ sourceCommit, root, archive, close }
```

`close()` coalesces concurrent calls, is idempotent after success, and permits
a later retry after a transient removal failure.

## Snapshot-only runtime bundle

`aws-host-retained-storage-host-preflight-sea-bundle.js` uses real esbuild to
produce one CommonJS Node 24 bundle from the selected snapshot. It generates
the fixed entry source from the selected commit and architecture.

The esbuild metafile is treated as evidence, not decoration:

- every input must resolve beneath the exact snapshot root;
- every input is re-lstatted and realpathed and cannot traverse a symlink;
- malformed or ambiguous import paths and malformed `external` flags fail
  closed;
- only `node:`-prefixed specifiers may remain external;
- `node_modules`, packages, and non-Node externals are rejected;
- the generated entry and sole output must be exact; and
- the final bundle is bounded to 8 MiB.

Packaging bundles both the exact snapshot and the live checkout with the same
commit/architecture declaration and requires byte equality. This deliberately
prevents attributing a changed live runtime graph to an older selected commit.

The packager also dynamically imports the delivery module from the exact
trusted snapshot and compares both its serialized manifest bytes and fixed
asset name with the already-loaded packager protocol before bundling or
building. This closes the loaded-module/snapshot split for the embedded
delivery contract.

## Same-generation SEA evidence

The low-level `SeaBuild` resource now records exact digest/size evidence for:

- the UTF-8 entry code handed to esbuild;
- the generated `esbundle.js` handed to Node's SEA blob generator;
- the generated SEA blob handed to postject;
- every embedded asset and function asset;
- the pre-injection Node source binary and, when applicable, its NodeBinary
  archive receipt; and
- the final SEA bytes.

Entry code is captured once. The JavaScript bundle is stable-read before and
after blob generation. The blob is stable-read before injection, its evidence
is captured first, postject receives a copy, and mutation of that copy is
rejected. A declared NodeBinary dependency with a missing receipt now fails
instead of silently degrading provenance. General SeaBuild still permits a
null archive when no NodeBinary dependency exists; the specialized V81
adapter requires a non-null archive receipt.

The generated SEA configuration sets:

```json
{
  "execArgv": [],
  "execArgvExtension": "none"
}
```

This prevents `NODE_OPTIONS` or inherited runtime flags from extending the
packaged program's execution arguments. Esbuild failures throw rather than
terminating the process, so owned cleanup remains reachable.

The narrow build adapter uses four dedicated one-shot static directories for
NodeBinary binaries/temp and SeaBuild binaries/builds. It restores every
process-global static independently even when another restoration fails, and
removes its private root after success or failure. This adapter is not a
general concurrent build service.

## Artifact record and immutable publication

The V1 artifact record binds distinct evidence for:

- the exact Git source archive;
- the entry bundle;
- the second-stage runtime bundle;
- the SEA blob;
- the final executable;
- the embedded delivery manifest;
- the target Node version/archive/source binary;
- the target platform, architecture, and libc;
- signing mode; and
- both artifact and record content IDs.

The artifact ID is derived from final executable bytes. The record is
canonical, bounded, exact-key validated, secret-scanned, and deeply frozen.
The current signing mode is explicitly `unsigned`.

Publication stages mode-0755 binary bytes and a mode-0600 canonical sidecar in
a unique private directory, fsyncs both files and their directory, validates
the pair, then hard-links the binary first and the sidecar last. The sidecar
is the durable commit marker.

Final links are create-if-absent and never rolled back:

- exact concurrent publishers converge on one immutable pair;
- a conflicting file is rejected without overwrite;
- destination size is checked against the exact expected size before any
  content allocation/read;
- a sidecar without its artifact is rejected; and
- a matching binary left by interruption is safely completed on the next
  run.

Removing the global publication lock was intentional. A process killed while
holding such a lock could permanently block recovery.

## Packaging orchestration

The production pipeline performs, in order:

1. output-directory preflight;
2. exact source snapshot creation;
3. snapshot/loaded-packager delivery protocol equality;
4. snapshot-only runtime bundling;
5. live-runtime bundle equality;
6. low-level SEA build;
7. post-build artifact-record creation and validation;
8. immutable binary/sidecar publication; and
9. source capability cleanup.

Primary and cleanup failures are retained together. All injected test ports
are captured once with their receivers and must expose only the exact
orchestration surface.

## Verification and disk hygiene

Validation used pinned Node **24.13.1**.

- ten focused suites passed **183/183** tests;
- source, app-implementation, test, and SEA-verifier TypeScript
  configurations passed;
- targeted ESLint, Prettier, JavaScript syntax, and staged-whitespace checks
  passed;
- three independent final reviews found no release blocker after the
  loaded/snapshot protocol, stale publication lock, unbounded destination
  read, post-extraction rehash, blob mutation, retryable snapshot-close, and
  process-exit cleanup-bypass findings were closed;
- Jest ran with
  `--runInBand --coverage=false --cache=false`; and
- no coverage or cache tree was produced.

A real non-native smoke against
`0e13485a201282bbac0689b5a7ca6f4473f04b04` proved:

```text
source archive sha256:
  UjaDQ-ypRG1VwnwXUrkzNw0FQOGKgBHlmDAjdJmf3g0
source archive size:
  16988160
snapshot/loaded-packager delivery protocol:
  exact match
snapshot runtime bundle sha256:
  iEtjSHA8f9OkKcBYpQYMabfqKZHJhsZjl1Re6uiXlzE
snapshot runtime bundle size:
  35186
snapshot/live runtime bundle:
  exact match
```

No native SEA build, official Node archive download, full-repository Jest
gate, coverage run, broad application build, npm install/pack, native LMDB
execution, host storage tool, block-device operation, live AWS call, resource
creation, or purge-intended AL2023/EBS proof was run.

The dedicated `/private/tmp/wharfie-v81-*` roots were removed and verified
absent immediately after validation. The host volume had about **7.8 GiB**
free at checkpoint time. Commit hooks reported that Husky was absent; the
manual focused test, type, lint, format, syntax, and diff gates above were run
directly.

## Honest boundaries

V81 is a local packaging contract, not a completed Linux or cloud proof:

- the implementation commit was built only through mocks and non-native
  source/bundle/protocol smokes on macOS;
- no final Linux executable exists yet;
- no produced artifact has been executed, relocated, rebooted, or exercised
  under systemd;
- content IDs authenticate neither the source author, build host, nor issuer;
- NodeBinary's receipt and upstream checksum are evidence supplied by an
  honest builder, not signature or transparency-log attestation;
- the artifact record is unsigned;
- selected repository code is trusted and its delivery module graph is
  executed by the protocol probe before the esbuild closure audit;
- the current public commit interface is intentionally SHA-1-shaped at 40
  lowercase hex characters, even though lower-level object-format parsing
  recognizes SHA-256;
- a selected historical commit must contain the delivery graph/protocol and
  produce the same runtime bytes as the live checkout, or the operator should
  check out that commit before packaging;
- snapshot path hardening assumes no hostile same-UID process is racing the
  single-process trusted builder;
- a hard crash before final linking can leave an abandoned private
  `.wharfie-host-preflight-*` staging directory; final publication remains
  recoverable, but later safe scavenging is unfinished;
- the dedicated static-directory adapter is one-shot and not safe as a
  general concurrent in-process builder;
- the output pair is unsigned and create-if-absent only prevents the publisher
  from overwriting an existing path; owner-writable files remain vulnerable to
  deliberate in-place mutation, replacement, deletion, or permission changes;
- the V79 provider receipt is still not embedded or collected by this local
  packaging step;
- no host identity, AWS instance, EBS volume, Linux device, filesystem, flush,
  interruption, reboot, detach/reattach, or path-retarget evidence exists;
- no formatting authority is granted and the V75 format journal cannot
  advance; and
- exactly-once work execution and coordinator recovery are not changed by
  V80/V81.

## Next slice

The next safe slice is a disposable **Linux-native packaging proof**, still
without live AWS or block-device work:

1. use a clean checkout at the selected implementation/source commit;
2. run the packaging command under Linux with Node 24.13.1;
3. download and verify the official target Node archive through NodeBinary;
4. preserve the exact generated artifact and sidecar long enough to validate
   every recorded digest and target field;
5. execute the SEA with zero arguments from more than one filesystem
   location and prove it does not require an installed Node runtime;
6. exercise invalid arguments and inherited execution-option non-extension;
7. confirm the read-only collector fails safely when not on the expected
   AL2023 host; and
8. remove every build, cache, archive, and temporary artifact immediately
   after recording the proof.

Do not run this native build on the current Mac. Prefer an already-available
disposable Linux environment; obtain approval before downloading a large VM
image or creating paid/external infrastructure.

Only after explicit user approval should the project move to the disposable
AL2023/EBS proof. That experiment must use newly created, expiring,
purge-tagged resources, collect V79 provider evidence and the read-only
host/toolchain fingerprint first, and keep formatting or other block-device
mutation under a separate explicit authorization boundary.

## Repository state and resume instructions

The V81 implementation tip is
`b53aac82b8edc405851ca4b8e9b1a8940be39fda`. It was pushed to
`origin/agent/strict-manifest` before this checkpoint was written. The commit
containing this file is the V81 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from the V81 checkpoint commit. Verify the implementation hash and
remote synchronization, then perform the Linux-native proof above. Continue
to pin Node 24.13.1, never run native LMDB on this Mac, disable Jest cache and
coverage for focused runs, never run block-device tools locally, remove every
generated artifact immediately, and obtain explicit approval before any live
AWS or purge-intended resource work.
