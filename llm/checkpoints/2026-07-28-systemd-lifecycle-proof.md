# Linux/systemd lifecycle proof checkpoint

- **Date:** 2026-07-28
- **Status:** **PROVED, CHECKSUMMED, AND CLEANED UP**
- **Branch:** `agent/strict-manifest`
- **Proof commit:**
  `e9da1e93637fac9567103604dabbae8a82cbab00`
- **Supporting commits:** `fbb7824` hardened package handoffs, `b265265`
  repaired resident readiness, and `e9da1e9` restored explicit SEA inspection.
- **Proof receipts:** [prepare](../../llm_artifacts/systemd-proof/e9da1e93637fac9567103604dabbae8a82cbab00/prepare.json),
  [boot](../../llm_artifacts/systemd-proof/e9da1e93637fac9567103604dabbae8a82cbab00/boot-receipt.json),
  [final](../../llm_artifacts/systemd-proof/e9da1e93637fac9567103604dabbae8a82cbab00/final.json),
  [cleanup](../../llm_artifacts/systemd-proof/e9da1e93637fac9567103604dabbae8a82cbab00/cleanup.json),
  and
  [checksums](../../llm_artifacts/systemd-proof/e9da1e93637fac9567103604dabbae8a82cbab00/SHA256SUMS).

## Restart summary

The bounded single-machine Linux service substrate is now proved. From the
installed `@wharfie/wharfie` tarball, one disposable Ubuntu VM built three
Linux arm64/glibc Node SEAs, ran the packaged command with Node absent from its
`PATH`, persisted work before installation, installed and converged the
service, replaced a killed resident, survived a forced VM stop/start, resumed
the workflow automatically before a login session, and retained verified
history and logical output.

The same run exercised every persisted update, rollback, and failed-target
source-restoration boundary, then proved graceful restart, stop/start,
uninstall retention, release pruning, and VM deletion. This closes the
systemd-substrate item that the previous
[default durable CLI checkpoint](2026-07-28-default-durable-cli-handoff.md)
left open.

It does not yet prove the complete product walkthrough. The fixture is a
purpose-built `systemd-service` application rather than the literal
`steady-file` example. The next work is to drive that golden application
through the now-proven substrate without growing another framework layer.

## Exact proof invocation

The successful run used Node 24.13.1 and npm 11.12.0:

```bash
WHARFIE_SYSTEMD_PROOF_INSTANCE=wharfie-systemd-proof-e9da1e9 \
WHARFIE_SYSTEMD_PROOF_KEEP_VM=0 \
PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:$PATH \
npm run verify:service:systemd:lima
```

The package was `@wharfie/wharfie@0.0.15`, containing 284 files, with tarball
SHA-256
`97e36c5061cc57c283a32fb4c0e696799969eb9c3d30b8a2f3958a85faf24fbd`.
All three generated SEAs were 161,221,760 bytes and targeted Node 24.13.1 on
Linux arm64/glibc.

## Evidence retained

The proof established:

- ordinary packaged application argv behavior before service installation;
- durable work admitted before installation and then consumed after converge;
- a waiting durable timer before the host cycle;
- automatic systemd replacement after `SIGKILL`, advancing resident generation
  1 to 2;
- a forced VM stop/start with a changed kernel boot ID, followed by automatic
  healthy startup before any login session at generation 3;
- a completed workflow whose timer was `FIRED` and signal was `CONSUMED`, with
  activity evidence on both sides of the boot boundary;
- verified history and logical output, preserved across activation and still
  inspectable after uninstall;
- five post-commit crash/recovery points for update;
- five post-commit crash/recovery points for rollback;
- five failed-target source-restoration crash/recovery points;
- ambiguous committed rollback recovery plus refusal of a stale retry;
- ordinary failed-target restoration to the healthy source;
- graceful restart from generation 27 to 28 and stop/start at generation 29;
- uninstall with systemd `LoadState=not-found` and `ActiveState=inactive`,
  while retaining durable state and immutable releases;
- pruning of the one unreferenced failing release, retaining the selected
  release and rollback candidate; and
- deletion of the exact disposable Lima instance.

The source release was:

- artifact
  `waf1_qWCYVXOr2unWOHl4nppiB0_z5m9gKp7hF3lLg557Vik`;
- revision
  `wrv1_O80KNKOAkfdYAmK7SySwmCgXJDvmZ7cOsDmZl4G7BMA`; and
- SHA-256
  `a960985573abdae9d63879789e9a62074ff3e66f602a9ee117794b839e7b5629`.

The healthy target artifact was
`waf1_m7u9wrg6HDjUpr-c20I0lzxHGNbTdCP5QPZiR-oxEAM`. The deliberately failing
target was
`waf1_B6q-THxs-JojaedkVj0-8hBD9CRnWNJCpCTTaAWeeBw`; prune removed that one
161,221,760-byte logical artifact and retained the other two releases.

The retained files verify as:

```text
b1647576b4a85e18c53b58e067caee3a6f6493d57c9a97df99a802a886968939  prepare.json
28d16e6555ef093f58bf52d32a6ddb6f3a37a99cd4f35ad786e4c1468fd49f79  boot-receipt.json
e80b1ae4316f71ee3f60ec5f5b4c0780391deba3e0c91226f4b3b621bd58dbd1  final.json
0d0142dc8fbf8714344319a86489c30a20db16957a84de2becb743ab7dcf3195  cleanup.json
```

`cleanup.json` names
`wharfie-systemd-proof-e9da1e9`, reports `instanceAbsent: true`, and reports
`instanceRetained: false`.

## Product defects found and fixed

The heavyweight proof exposed two real bugs rather than merely exercising the
harness.

### Managed resident readiness cycle

The coordinator persisted `ACTIVATING` and waited for the resident to become
ready. The resident waited for its schedule observer's first observation. The
observer required the run-creation fence, which in turn required `ACTIVE`.
systemd therefore kept replacing a resident that could never report ready.

Commit `b265265` permits only the exact service-start authority
`(appId, revisionId, artifactId)` to defer schedule writes during bootstrap.
The exception is restricted to the selected target in `ACTIVATING` or the
exact draining source in `QUIESCING`, applies only before the observer's first
successful initialization, and still verifies the prepared source. A
same-revision wrong artifact remains unable to claim readiness.

### Explicit SEA inspection

SEA construction intentionally used `execArgvExtension: "none"` so inherited
`NODE_OPTIONS` could not mutate packaged behavior, but the activation proof
still attempted to inject `--inspect-brk` through `NODE_OPTIONS`. The target
operator therefore completed normally and exited zero before the debugger
could attach.

Commit `e9da1e9` changes the SEA contract to
`execArgvExtension: "cli"` and makes the trusted local inspector prepend the
explicit carrier
`--node-options=--inspect-brk=127.0.0.1:0 --inspect-publish-uid=stderr`.
Ordinary application argv is preserved, inherited `NODE_OPTIONS` remains
ignored, and caller-supplied `--node-options=` is rejected by the inspector.
New tests and the package verifier cover all three behaviors.

Before the heavyweight rerun, the affected readiness suites passed 97 focused
tests. The inspector and packaging group passed 24 focused tests. ESLint,
Prettier, all relevant TypeScript projects, Node syntax checks, and a small
actual Darwin SEA inspection smoke all passed.

## Cleanup and disk state

The proof deleted its VM. A separate Lima listing confirmed that the instance
was absent. Failed proof receipt directories, the approximately 586 MiB
downloaded Lima image cache, and temporary approximately 100 MiB Darwin SEA
smoke artifacts were removed. The successful checksummed receipts occupy only
about 340 KiB and are retained in the repository.

No repository `.wharfie`, `dist`, or `coverage` output remains from the run.
The historical Git stash was not changed.

## Honest boundaries

- Build and execution happened inside the same disposable Ubuntu VM. Node was
  absent from the packaged command `PATH`, but this run does not prove a
  separate build-host-to-target-host transfer.
- The fixture proves single-machine coordinator recovery across resident and
  host restart plus every activation phase. It does not prove replacement of a
  failed coordinator machine by a different machine.
- The proof pins Node 24.13.1. It does not establish an automatic Node patch
  upgrade policy.
- Explicit `--node-options=` is now a reserved trusted-caller channel used by
  the local proof inspector. Untrusted or remote values must never be
  forwarded into raw SEA argv.
- A debugger bind failure can still make Node continue without pausing. The
  disposable proof detects missing attachment and fails, but the harness does
  not transparently retry or provide a preload/file-descriptor gate.
- The separate relocated-SEA schedule/restart native Linux proof described by
  ADR 0027 remains open. This lifecycle run proves durable timer and signal
  continuation, not that separate scheduled-occurrence contract.

## Next work

1. Run one literal `steady-file` sequence through this substrate: ordinary
   CLI, default durable start, package, install, close/return, history/output,
   update, rollback, uninstall, and cleanup.
2. Fix returned-run-ID or repeated app-scope friction only if that walkthrough
   demonstrates it.
3. Once the local product story is short and convincing, move to replacement
   of a failed coordinator by another trusted machine. Keep cloud fulfillment
   as the later third outcome.
