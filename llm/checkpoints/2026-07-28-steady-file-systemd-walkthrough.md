# Steady-file Linux/systemd walkthrough checkpoint

- **Date:** 2026-07-28
- **Status:** **PROVED, CHECKSUMMED, AND CLEANED UP**
- **Branch:** `agent/strict-manifest`
- **Proof commit:**
  `08cc64fb8e9e1370d6488aa65ba12bc6c8866482`
- **Harness commit:** `d294f71` added the focused walkthrough.
- **Proof receipts:**
  [prepare](../../llm_artifacts/steady-file-systemd-proof/08cc64fb8e9e1370d6488aa65ba12bc6c8866482/prepare.json),
  [final](../../llm_artifacts/steady-file-systemd-proof/08cc64fb8e9e1370d6488aa65ba12bc6c8866482/final.json),
  [cleanup](../../llm_artifacts/steady-file-systemd-proof/08cc64fb8e9e1370d6488aa65ba12bc6c8866482/cleanup.json),
  and
  [checksums](../../llm_artifacts/steady-file-systemd-proof/08cc64fb8e9e1370d6488aa65ba12bc6c8866482/SHA256SUMS).

## Restart summary

The bounded Outcome 1 product journey is now concrete on one clean Linux arm64
host. A disposable Ubuntu 24.04 Lima VM installed the repository's npm
tarball, ran the literal `steady-file` source CLI, built two meaningful
Linux arm64/glibc SEAs, and ran both ordinary packaged CLIs with Node absent
from the packaged command `PATH`.

Revision A admitted the ordinary file argument through packaged
`wharfie start` before systemd existed. The same A executable installed a
healthy resident. The initiating verifier ended; a distinct process returned,
rediscovered the completed run through `list`, and read its verified
inspection and explicitly disclosed logical output. It then updated through
B, rolled back through the currently selected B executable to A, uninstalled
through restored A, and proved the same reads remained available. VM deletion
provided the final purge.

The focused run did not repeat the forced reboot, resident crash, or activation
recovery matrix. Those boundaries remain covered by the separate
[Linux/systemd lifecycle proof](2026-07-28-systemd-lifecycle-proof.md). The
focused walkthrough closes the literal single-host product composition, not
coordinator replacement by another machine.

## Exact proof invocation

The successful run used Node 24.13.1 and npm 11.12.0:

```bash
WHARFIE_SYSTEMD_PROOF_INSTANCE=wharfie-steady-file-proof-08cc64f \
WHARFIE_SYSTEMD_PROOF_KEEP_VM=0 \
PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:$PATH \
npm run verify:steady-file:systemd:lima
```

The installed package was `@wharfie/wharfie@0.0.15`, containing 284 files,
with tarball SHA-256
`b21eaf73c5cca91ef2aff55d42c5e6cc326066898a55ecbc2c0a6f0a5ef8b9b0`.
The proof built only the native guest target:
Node 24.13.1 / Linux / arm64 / glibc.

## Two real application revisions

Both generated SEAs were 161,352,832 bytes. A was:

- artifact
  `waf1_dn5HWo_Q2ddTkyHNYqvEZp17U1X1oSIjdegUmtwzbLI`;
- revision
  `wrv1_2DVc0_W6QppfFBYjXUsKyMrM4jJ_0qXWnJQQHNrb7dw`; and
- SHA-256
  `767e475a8fd0d9d7539321cd62abc4669d7b5355f5a1222375e8149adc336cb2`.

B was:

- artifact
  `waf1_JZIYtkbXQks8cP4-rCgySIwj7-kjhU-G-HK5UGkRcec`;
- revision
  `wrv1_cFRsZ6l4aDkVQQWVEXYHXP6TtnInl2PtiV0zLsTiU88`; and
- SHA-256
  `259218b646d7424b3c70fe3eac2832488c23efe923854f86f872b950691171e7`.

B was not a byte-only fixture. Its sole authored change was the immutable
`file-stability.js` window:

```text
export const STABILITY_WINDOW_MS = 250;
→
export const STABILITY_WINDOW_MS = 500;
```

The source CLI and both ordinary packaged CLIs returned the same stable
decision for the 43-byte input. No durable workflow was run under B; its
purpose here was meaningful release evolution and rollback.

## Durable and service evidence

Packaged A created run
`wfr_YUlf5nVBBR9HcwvC-EkZdC8vxaqWMuZidn6B7T9-mcc` as `RUNNING`, with
`baseline` runnable, while the systemd unit was absent. Before installation,
the proof independently checked all seven created storage paths—data,
applications, app, state, control, LMDB, and payload roots—as mode `0700`.

Installation selected A at resident PID 8288 and generation 1. Prepare
verifier PID 7882 ended, verify PID 8355 was distinct, and the later process
observed that same resident PID and generation before evolving the release.
The run was then `COMPLETED` at ledger version and sequence 8, with two
completed activities, one `FIRED` timer, integrity-verified history, and a
stable logical output.

Update selected B at PID 8474 / generation 2. Rollback was invoked through B
and restored A at PID 8619 / generation 3. Exact inspection, history, and
output documents were preserved across update, rollback, and uninstall.

Uninstall independently left systemd `LoadState=not-found`,
`ActiveState=inactive`, and no enabled unit while deliberately preserving
state and releases. Prune scanned two releases, retained both selected and
rollback references, and removed zero.

## Product defect found and fixed

The first focused run at `d294f71` failed immediately after packaged `start`.
Under the Lima user's `0002` umask, the writable LMDB adapter created a new
control hierarchy as group-writable. The fail-closed service status command
correctly rejected that root before installation could normalize it.

Commit `08cc64f` makes every newly created writable LMDB hierarchy explicitly
private with mode `0700`. Its regression test sets a permissive umask and
checks nested root modes. The successful Linux receipt checks the real
packaged start layout before service installation, which is the
platform-relevant proof of the fix.

## Checksums and cleanup

The retained files verify as:

```text
59f6a96b8f244128526f71f65b663ad26b204cd8f8ea74c95b17d431e7407cf8  prepare.json
789255ecd223e4bec79ea8b516a6c5cf264c049e5412eeb3d5d87528b4f5ecae  final.json
fd87d6e3e01602b68b328feff5871063147cdd0fb3e3a8bd87ab37b1ee3fe954  cleanup.json
```

The cleanup receipt names `wharfie-steady-file-proof-08cc64f`, reports
`instanceAbsent: true`, and reports `instanceRetained: false`. A separate Lima
listing found no matching instance. The failed run's empty receipt directory
and the exact approximately 586 MiB Lima image cache were removed. Only the
four small successful receipt/checksum files remain.

The checksums detect later file alteration; they do not authenticate the
runner. Retained history and output are explicitly non-authoritative local
observations.

## Honest boundaries

- The 250 millisecond workflow completed about 4.47 seconds before the prepare
  receipt was written. This proves later-process rediscovery, installed-service
  persistence, and retained reads, not unfinished work surviving the
  initiating process's death.
- Build and execution happened in the same disposable VM. Node was absent from
  the packaged command `PATH`, not absent from the machine.
- This run executed Linux arm64/glibc only. It does not claim Linux x64, musl,
  macOS, a clean second target host, or a production distribution path.
- B was activated and rolled back, but no B durable run or in-flight workflow
  migration was exercised.
- Uninstall is not purge. It preserves state and immutable releases; the
  disposable VM deletion supplied complete proof cleanup.
- The run does not establish exactly-once execution, crash/reboot recovery,
  another-machine coordinator replacement, multi-node scheduling, or cloud
  fulfillment.
- Source `ops start` and packaged `wharfie start` use distinct default control
  roots. Service install adopts work admitted by the packaged application; it
  does not adopt a default source-development run.

## Next work

1. Treat the literal single-host walkthrough as the Outcome 1 regression gate.
   Do not add more single-host abstractions unless a real application blocks.
2. Begin Outcome 2 with the smallest single-active coordinator state machine:
   identity, renewable lease, monotonic epoch, admission, assignment, and
   settlement.
3. Put its authority in one linearizable durable-store adapter and reject
   stale epochs at every authoritative commit before adding multi-node
   placement or cloud fulfillment.
