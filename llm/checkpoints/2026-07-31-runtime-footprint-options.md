# SEA and Node runtime footprint options checkpoint

- **Date:** 2026-07-31
- **Status:** measurements and optimization order recorded; no new artifact
  format or custom runtime profile accepted
- **Branch:** `agent/two-provider-deploy`
- **Starting commit:** `6f75adf53937a590dd194f934e2dae4609e4957c`
- **Implementation commit:** the commit containing this checkpoint
- **Related decisions:**
  [TypeScript control plane with a component boundary](../../docs/architecture/decisions/0005-typescript-and-component-boundary.md)
  and
  [two-provider single-node self-deployment](../../docs/architecture/decisions/0035-two-provider-single-node-self-deployment.md)
- **Related checkpoint:**
  [SEA packaging reproducibility](2026-07-30-sea-packaging-reproducibility.md)

## Why this note exists

Wharfie's approachable distribution promise is valuable: one application SEA
can run locally without a Node installation and can carry the exact Linux SEA
needed to create and activate a cloud node. The present implementation proves
that shape, but pays for it by placing nearly two complete Node runtimes in the
self-deployable artifact.

The goal is to reduce download, transfer, storage, and update costs without
weakening these properties:

- ordinary TypeScript and Node remain the default application model;
- the first local artifact remains portable and approachable;
- a clean managed node does not depend on an ambient or unverified Node;
- raw executable identity remains content-addressed and exactly verifiable;
- interrupted install, update, rollback, and recovery remain conservative;
  and
- WASM, Node-API modules, and bounded subprocess workers remain available for
  measured hot paths under ADR 0005.

This is a measurement-backed engineering direction, not an accepted artifact
format. Exact formats and schemas require a separate decision when their
acceptance evidence exists.

## Current measured footprint

The following measurements came from the Node 24.13.1 toolchain and the
`infra-smoke` v2 artifacts built from the starting commit:

| Item                                           |       Bytes |    MiB |
| ---------------------------------------------- | ----------: | -----: |
| Official Node 24.13.1 Darwin arm64 `bin/node`  | 119,127,632 | 113.61 |
| Official Node 24.13.1 Linux x64 `bin/node`     | 122,523,096 | 116.85 |
| `infra-smoke` Linux x64 application SEA        | 133,696,704 | 127.50 |
| `infra-smoke` Darwin arm64 self-deployable SEA | 258,615,056 | 246.63 |

The Linux Node executable alone is about 91.6% of the Linux application SEA.
The Darwin operator contains its own runtime plus the complete 127.5 MiB Linux
guest artifact. The duplicated target runtimes, not Wharfie's application
logic, dominate the portable artifact.

The measured outer artifact was
`waf1_qJyRJzFDpT-LGByN0204-qZq9jtPU6uEgSpVA8b4jqE`. Its canonical byte digest was
`a89c91273143a53f8b181c8dd36d38faa66af63b4f53ab84812a5503c6f88ea1`.
The deployed Linux artifact was 133,696,704 bytes. These values are useful for
comparison, but the content identities are not compatibility promises for a
future encoding.

## Optimization order

### 1. Reuse exact remote artifacts — implemented

Commit `6f75adf53937a590dd194f934e2dae4609e4957c` made the existing remote release
path a verified cache. Before an activation reuses a published artifact,
Wharfie validates its exact entry type, size, mode, owner, link count,
executable bit, and SHA-256 digest. A valid hit skips the byte upload but still
runs normal service convergence and health proof. A miss retains exclusive
temporary publication, digest verification, and atomic final selection.

This removes repeated transfer of the same release during update recovery,
rollback, repair, and later return to a retained release. It does not reduce
the first upload or the portable artifact's download size.

### 2. Compress the embedded guest and remote transport — next

Exploratory local `gzip -9` ratio probes used two older retained Darwin SEAs,
not the current Linux artifact. They reduced 124,676,912 bytes to 40,371,654
bytes (67.6% smaller) and 307,021,392 bytes to 103,154,939 bytes (66.4%
smaller). Those probes did not request a deterministic gzip header. Applying
the observed range to the current 133.7 MB Linux guest suggests an encoded
payload around 45–50 MB and a current-shape self-deployable artifact around
170–175 MB before stripping. These are planning estimates, not an accepted
size claim; the implementation must repeat and retain a deterministic
benchmark for every supported target.

Compression must be an encoding of an authoritative raw artifact, not a new
meaning for its `waf1` identity. A safe record should bind at least:

- the raw artifact ID, digest, size, and executable target;
- the encoding name and version plus deterministic encoder options;
- the encoded byte digest and size; and
- the decoder/toolchain identity needed for reproducibility.

Publication must verify the encoded temporary file, decode into a separate
exclusive temporary file, verify the original raw digest and size, set the
expected metadata, and only then atomically publish the executable. Neither a
successful decoder exit nor an encoded digest alone proves executable
identity. Interrupted encoded and decoded temporaries need the same bounded,
authenticated cleanup treatment as current uploads.

The encoding must also be deterministic: timestamps, original filenames,
platform-private metadata, and unpinned encoder behavior cannot enter the
bytes. `gzip` is an available baseline through Node's standard library and
common Linux images; another codec may be justified only with an exact decoder
distribution and provenance story.

### 3. Evaluate symbol stripping before SEA injection

One controlled Darwin runtime measurement removed the existing signature from
the 118,184,760-byte Node executable and ran `strip -x`, producing a
94,293,216-byte executable: 23,891,544 fewer bytes, or about 20.2%. A separate
probe injected an available 6,477,232-byte hello-world blob into that stripped
runtime and applied a new ad-hoc signature; the resulting 100,994,768-byte SEA
remained runnable. A retained unstripped 124,676,912-byte SEA provides useful
scale, but it used different revision and signing inputs, so these observations
do not constitute a controlled 19% before-and-after comparison of one SEA.

The Linux Node binary also exposed roughly 17.8 MB of debug and symbol
sections, but that is only an opportunity estimate until a stripped Linux SEA
passes the full packaged runtime and deployment suites.

Stripping belongs in the pinned target toolchain, before final injection and
signing. Provenance must include the input runtime digest, stripped-runtime
digest, stripping tool identity and flags, final artifact digest, and signing
mode. Acceptance must cover:

- application execution and every packaged operator command;
- `worker_threads`, `async_hooks`, crypto/TLS, child processes, and streams;
- the native LMDB dependency and representative Node-API activity modules;
- useful JavaScript exceptions and retained external crash symbols;
- Linux target reproducibility;
- Darwin ad-hoc and Developer ID signing plus notarization; and
- update, rollback, recovery, and content-addressed cache reuse.

Unstripped symbols may be retained as separately addressed build evidence for
diagnostics. They do not need to ship inside every application artifact.

### 4. Separate the portable bootstrap from managed-node runtime capsules

The best eventual shape is not "whatever Node happens to be installed." It is
an exact Wharfie runtime capsule cached once per target node and addressed by
platform, architecture, libc, Node version, feature profile, and byte digest.

The first self-deployable artifact can still carry a compressed verified Linux
runtime for offline bootstrap. After installation, a node retains that exact
runtime independently of any application revision. Later releases transfer a
small application capsule containing the bundled program, assets, immutable
revision records, and the runtime-capsule reference. With today's footprint,
the bytes above the official Linux Node executable are about 11.2 MB raw and
would likely be only a few megabytes compressed.

Runtime reuse needs explicit durable authority:

- an application cannot silently select the system `node` or a merely
  version-matching binary;
- activation verifies both runtime and application capsule digests;
- journals bind the exact runtime profile used by current, rollback, and
  target releases;
- garbage collection retains every runtime reachable from those releases;
- corruption causes exact repair or a fail-closed result, never fallback;
- bootstrap and recovery work without a hosted Wharfie service; and
- runtime security updates are explicit release transitions, not mutable
  replacement beneath an existing revision.

A later small native launcher could hold compressed target runtime capsules,
verify and materialize them, then invoke the Node control plane. That can
preserve a one-file download while decoupling distribution shape from managed
node storage. It should be considered only after compression and runtime-cache
contracts are proven in the existing SEA implementation.

### 5. Keep custom/pruned Node optional

A custom Node build can remove features such as the inspector and replace full
ICU with small or no ICU. The examined official Linux binary's symbol table
reports a 33,107,248-byte `icudt78_dat` object. That bounds an ICU-related
footprint opportunity, but no small-ICU or no-ICU runtime was built; actual
artifact savings remain unmeasured.

It should not become the default merely to improve a headline artifact size.
Doing so creates a permanent cross-platform Node build, patch, CVE, signing,
notarization, provenance, and compatibility pipeline. It can also make normal
TypeScript applications fail unexpectedly when they use `Intl`, diagnostics,
native dependencies, or other assumed Node behavior.

The default should remain an official, fully compatible Node runtime until
measurements show that compression, stripping, and per-node runtime reuse are
insufficient. A pruned profile may later be explicit in the manifest and
artifact identity, with capability validation and a full behavior matrix.

## Why not replace Node now

Wharfie's control plane currently relies on Node SEA, `worker_threads`,
`async_hooks`, Node-API LMDB, `child_process`, crypto/TLS, and Node streams.
Bun, Deno, QuickJS, or an immediate native rewrite would exchange a measured
distribution cost for broad runtime-compatibility and maintenance risk.

ADR 0005 already provides the useful escape hatches: Node-API dependencies for
in-process hot paths, WASI/WASM for portable components, and bounded persistent
subprocess workers for other native implementations. Keeping Node at the
orchestration boundary does not require CPU-heavy activity implementations to
remain JavaScript.

The intended direction is therefore:

1. avoid retransmitting exact bytes;
2. compress bytes that must travel;
3. remove runtime bytes proven unnecessary for supported targets;
4. cache one exact runtime per managed node and ship small application
   capsules; and
5. introduce a custom runtime profile only when a measured application needs
   it.

## Acceptance gates for future work

Compression is complete only when deterministic encoded records, raw identity
verification, interrupted decode recovery, update/rollback/recovery behavior,
and live remote cleanup are proved.

Stripping is complete only when the supported API/native-module matrix,
reproducibility, final signing/notarization, diagnostics, and deployment
recovery all pass for every target.

Runtime capsules are complete only when a clean no-Node host bootstraps from
one portable artifact, later releases reuse the exact runtime without
transferring it, runtime corruption repairs or fails closed, mixed-runtime
rollback works, and bounded garbage collection preserves all journal-reachable
bytes.

No optimization may weaken content identity, allow ambient runtime selection,
make credentials durable, or leave cloud and local build resources behind.

## Experiment cleanup

The stripped runtime probes and compression outputs used for these estimates
were removed from temporary storage. The live `infra-smoke` exercise removed
its 493 MiB generated operator artifacts, disposable checkout, local deployment
data, and every owned Hetzner server, Primary IP, and firewall. Only bounded
JSON evidence was retained outside this repository.
