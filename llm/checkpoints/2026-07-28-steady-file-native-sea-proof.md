# Steady-file native and SEA proof checkpoint

- **Date:** 2026-07-28
- **Status:** **OBSERVED PASS ON DARWIN ARM64**
- **Branch:** `agent/strict-manifest`
- **Validated source commit:**
  `8067fc768ea37523ba8d740bae9fe72554aa2bb9`
- **Observation:**
  [steady-file native/SEA observation](../../llm_artifacts/steady-file-proof/8067fc768ea37523ba8d740bae9fe72554aa2bb9/observation.json)
- **Observation SHA-256:**
  `06564485be29d83e8e7c03a7ca07364c925cda6403db418d240310702c62ee80`

## Restart summary

The first product-outcome evidence gate is now materially smaller.

The authored `steady-file` application ran without an application-logic fork
through:

1. source `ops start`;
2. a real resident source worker over native LMDB;
3. the real activity/timer/activity workflow;
4. verified source `ops output`;
5. `app package` for one exact Darwin arm64 target;
6. the generated executable's ordinary developer argv;
7. the relocated executable's embedded `wharfie start`, resident worker,
   inspection, and verified output surfaces; and
8. graceful worker drain and complete owned-root cleanup.

The SEA ran with an empty runtime `PATH`, so Node was not available through the
command path. The independently measured executable was 155,523,792 bytes with
SHA-256
`f7910a3cae3fc68629a92ce3d7d04482ea5c1748353c808df869fe9c64145e6a`,
matching the package receipt.

No production source, dependency, lockfile, or application change was needed
to pass this gate.

## Exact environment

- macOS 15.7, build `24G222`
- Darwin kernel 24.6.0
- arm64
- Node 24.13.1
- npm 11.12.0
- locked `lmdb` 3.4.4
- owned proof root:
  `/private/tmp/wharfie-steady-native-sea-8067fc7`

Source commands shared these explicit storage bindings:

```text
WHARFIE_DB_ADAPTER=lmdb
WHARFIE_DB_PATH=<proof-root>/source-state/general
WHARFIE_CONTROL_ADAPTER=lmdb
WHARFIE_CONTROL_PATH=<proof-root>/source-state/control
WHARFIE_EXECUTION_LEDGER_TABLE=steady-file-native-source
WHARFIE_EXECUTION_PAYLOAD_PATH=<proof-root>/source-state/payloads
WHARFIE_LEDGER_SERVICE_SESSION_PATH=<proof-root>/source-state/sessions
WHARFIE_APPLICATION_STATE_ADAPTER=lmdb
WHARFIE_APPLICATION_STATE_PATH=<proof-root>/source-state/application-state
```

The SEA commands used the corresponding distinct `<proof-root>/sea-state`
paths and `WHARFIE_EXECUTION_LEDGER_TABLE=steady-file-native-sea`. Source,
package, and SEA execution also used distinct owned HOME, TMP, XDG, and npm
cache roots.

## Source resident observation

The source start argv, with only the owned proof root abbreviated, was:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
  ./bin/wharfie ops start
  --dir <proof-root>/app
  --workflow verify-stable
  --idempotency-key steady-file-source-native-8067fc7
  --input '{"path":"<proof-root>/artifact.bin"}'
  --json
```

It created:

- run
  `wfr_346o63XiYdX6QIhWpiUlwSSSKm_TVAz5UxX3zUJ7mFk`;
- revision
  `wrv1_xa82JkI2Ga3-xpqlA8POkfOuyCc-ZxcRNXp2t2kB77E`; and
- an initially runnable `baseline` activity.

The matching `ops worker --dir <proof-root>/app` resident then:

- claimed and completed `capture`;
- scheduled and fired the framework-owned `stability-window` timer;
- claimed and completed `verify`;
- reached run status `COMPLETED` at ledger version and sequence 8; and
- returned a verified schema-version 1 run-output document whose terminal
  result reported `stable: true`.

The worker handled `SIGINT`, drained, printed its normal stopped success
message, and exited zero.

## Package and SEA observation

The package argv, with only the owned proof root abbreviated, was:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
  ./bin/wharfie app package
  <proof-root>/app
  --output-dir <proof-root>/output
  --target node24.13.1-darwin-arm64
  --no-pretty
```

The package receipt recorded:

- artifact
  `waf1_95EKPK4_xoYpqSzj19BEgupcF0g1PICN-Gn-nGQUXmo`;
- the same authored revision as the source run;
- target Node 24.13.1 / Darwin / arm64;
- 155,523,792 bytes; and
- base64url SHA-256
  `95EKPK4_xoYpqSzj19BEgupcF0g1PICN-Gn-nGQUXmo`.

An independent `shasum -a 256` produced the hex digest recorded above. A copy
at `<proof-root>/relocated/steady-file-demo` produced the same digest.

With `PATH=<proof-root>/empty-path`, the relocated executable's ordinary argv:

```text
<proof-root>/relocated/steady-file-demo <proof-root>/artifact.bin
```

exited zero and reported the same stable 95,420-byte fixture and SHA-256 as the
source workflow.

Its embedded durable sequence, again abbreviating only the owned root, was:

```text
<relocated-sea> wharfie start
  --workflow verify-stable
  --idempotency-key steady-file-sea-native-8067fc7
  --input '{"path":"<proof-root>/artifact.bin"}'
  --json

<relocated-sea> wharfie worker

<relocated-sea> wharfie inspect
  --run-id wfr_7ZqeEtGJzABpnEQgxlAnmXt0muYL0-J0akaf7nZhiGU
  --json

<relocated-sea> wharfie output
  --run-id wfr_7ZqeEtGJzABpnEQgxlAnmXt0muYL0-J0akaf7nZhiGU
  --confirm-sensitive-output
  --json
```

That run completed the same two activities and real timer at version and
sequence 8. Its output document was integrity-verified and reported the same
stable logical result. The SEA worker also drained on `SIGINT` and exited zero.
No socket entries remained under the existing per-user Wharfie socket
directory.

## Native sandbox finding

The first in-sandbox LMDB attempts aborted in `ExtendedEnv::~ExtendedEnv`.
This initially resembled a Darwin native-binding incompatibility. A disposable
source build of the latest LMDB release reproduced it, as did disabling
overlapping sync.

The useful underlying diagnostic appeared only after patching the disposable
copy's failed-open cleanup:

```text
Operation not permitted: Attempting to setup locks
```

The restricted execution sandbox denied LMDB's native lock setup. LMDB's
failed-open cleanup then double-freed its extended environment and masked that
permission error. Outside the sandbox, locked LMDB 3.4.4 passed with its
default options under exact Node 24.13.1.

Therefore:

- this is not evidence of a Node 24, Darwin, published-prebuild, or
  `overlappingSync` incompatibility;
- no Wharfie adapter or dependency workaround is warranted;
- native LMDB gates on this host must use the approved outside-sandbox
  boundary and one owned data root; and
- older historical cautions that classified the allocator abort itself as the
  root cause are superseded by this observation, but remain unchanged as
  historical records.

## Receipt and cleanup

The committed JSON is explicitly non-authoritative:

```json
{
  "authority": "none",
  "authoritative": false
}
```

Its checksum detects later alteration but authenticates neither the runner nor
the truth of the observation.

Before removal, the entire owned proof root occupied 416 MiB by `du -sh`. It
contained the source and SEA LMDB state, authored revision snapshots, exact
Node/package caches, generated executable, relocated copy, and all disposable
proof-owned LMDB diagnostic builds and data. Both workers were reaped before
cleanup. Read-only sealed snapshot files were made owner-writable, the exact
owned root was removed, and its absence was positively checked.

The failed sandbox probes also caused macOS to write six bounded
`node-2026-07-28-14*.ips` diagnostic reports outside the owned root under
`~/Library/Logs/DiagnosticReports`. Those exact reports were removed and a
matching-file check was empty afterward. Host free space was about 11 GiB
afterward.

## Honest boundaries

This observation justifies that, on this Darwin arm64 host and validated
commit:

- the documented source command path used real native LMDB;
- the resident executed the real activity/timer/activity workflow;
- source inspection and retained output verified the completed ledger state;
- `app package` produced the recorded SEA bytes;
- those exact relocated bytes ran the application-owned CLI without Node in
  runtime `PATH`;
- the SEA's embedded operator surface independently ran the same durable
  workflow through native LMDB; and
- source and SEA returned matching verified logical results without an
  application-logic fork.

It does not establish:

- process replacement or restart recovery during this workflow;
- independence from the original package publication or build host;
- clean-host, Linux, x64, or AL2023 portability;
- systemd install, host reboot, service update, rollback, or uninstall;
- multi-node or coordinator replacement;
- cloud provisioning;
- physical exactly-once execution; or
- production readiness.

## Next work

Do not expand the roadmap. Work the demonstrated path:

1. reduce the confirmed handoff friction: workflow ID, idempotency key, JSON
   input translation, run-ID carrying, repeated app scope, and manual resident
   lifecycle;
2. then run the same application on a clean supported Linux host with a systemd
   user manager through install, converge, deliberate service replacement,
   host restart, history and output reads, update, rollback, uninstall, and
   cleanup; and
3. keep coordinator replacement and cloud-resource fulfillment separate until
   this local-to-service path is short and repeatable.

## Resume state

- Branch: `agent/strict-manifest`
- Validated implementation:
  `8067fc768ea37523ba8d740bae9fe72554aa2bb9`
- Historical stash remains untouched:
  `stash@{0}: WIP on master: 3dee66b work prompt`
- Exact validation Node:
  `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`
- Large proof root: removed and confirmed absent
- Next code slice: simplify only the friction demonstrated by the source and
  SEA walkthrough before attempting the clean-host service lifecycle
