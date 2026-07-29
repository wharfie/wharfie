# Single-host developer preview acceptance checkpoint

- **Date:** 2026-07-29
- **Status:** **PROVED, CHECKSUMMED, AND CLEANED UP**
- **Branch:** `agent/strict-manifest`
- **Proof commit:**
  `39be8d604fedb99ee798c64dcf50a74c456606c4`
- **Proof receipts:**
  [builder](../../llm_artifacts/steady-file-systemd-proof/39be8d604fedb99ee798c64dcf50a74c456606c4/builder.json),
  [prepare](../../llm_artifacts/steady-file-systemd-proof/39be8d604fedb99ee798c64dcf50a74c456606c4/prepare.json),
  [final](../../llm_artifacts/steady-file-systemd-proof/39be8d604fedb99ee798c64dcf50a74c456606c4/final.json),
  [cleanup](../../llm_artifacts/steady-file-systemd-proof/39be8d604fedb99ee798c64dcf50a74c456606c4/cleanup.json),
  and
  [checksums](../../llm_artifacts/steady-file-systemd-proof/39be8d604fedb99ee798c64dcf50a74c456606c4/SHA256SUMS).

## Restart summary

The single-host developer preview milestone is closed. A fresh Ubuntu 24.04
arm64 builder installed the repository's npm tarball in a clean consumer
workspace, ran the supported `steady-file` starter as an ordinary CLI, and
built two meaningful Linux arm64/glibc Node 24.13.1 SEAs. It emitted an exact
checksummed handoff and was deleted before a distinct clean target was created.

The target had no Node or npm and received only the packaged handoff plus one
literal input. Packaged revision A admitted a durable workflow and installed a
healthy persistent systemd user service. The prepare controller exited while
the workflow's one-minute timer was still waiting. A different controller
observed the same unfinished timer, waited for the service to complete the
workflow, rediscovered its history, and read its verified logical output.

The later controller then updated the service to revision B, rolled back
through B to A, and proved the exact reads survived both transitions and
uninstall. It independently established absent systemd wiring, retained both
referenced releases during prune, purged the application root in one attempt,
and verified that the two external SEA files were unchanged. The harness
deleted the target, its isolated Lima home and cache, the tarball workspace,
input, and SEA handoff. Only the five bounded receipt files remain.

## Exact proof invocation

The successful run used the exact Node 24.13.1 executable and npm 11.12.0 CLI:

```bash
PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin \
TMPDIR=/private/tmp \
WHARFIE_STEADY_FILE_PREVIEW_NODE=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node \
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node \
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/lib/node_modules/npm/bin/npm-cli.js \
run verify:steady-file:systemd:lima
```

## Builder and target boundary

The builder receipt records:

- machine ID `c68b1b4800e642d68ecc86f0a13b04c8`;
- Node 24.13.1 and npm 11.12.0;
- `ordinaryEquivalent: true`; and
- handoff SHA-256
  `df84b5bdf46703d33a26d0a58cf9ed4e6c7a715f493071bbaee37ab17916d2cd`.

The source SEA was 161,483,904 bytes with SHA-256
`d19d7a50b391ba6c0782cda40606a370e93109a7666d3f487bb5b10591d26388`.
The meaningful B SEA was also 161,483,904 bytes, with SHA-256
`ee24addb90950addd4c00d5664978518282dfd67c604fbbfde1902a7a2eedfa0`.

The target machine ID was `ad9ccd0b8b644a2eb936210c0f496012`,
distinct from the builder. Its process identity was UID/GID 1001, lingering
was enabled, and both Node and npm were absent. The target reverified the exact
builder handoff before executing either artifact.

## Durable process boundary

Run `wfr_IfJDBvVAaHkGyl-M1ZhPxt7_mQwFTTaNYBrMjyI64MM` was still `RUNNING`
when prepare controller PID 29059 exited. Timer
`wft_xfjpd-a5MpLf48Z2FbrX6dmU6wda_i01otsUJANAVfU` had 53,774 milliseconds
remaining in the prepare observation and 52,241 milliseconds remaining when
verify controller PID 29277 independently observed it after the first process
had ended.

The service fired that same timer and completed the workflow at ledger version
and sequence 8. Its integrity-verified history was `COMPLETED`; the explicitly
disclosed terminal output reported the same 43-byte SHA-256 fingerprint before
and after the durable wait and `stable: true`.

## Service evolution and cleanup

- Install selected A as a healthy resident.
- Update selected meaningful revision B and retained A as rollback authority.
- Rollback through B restored A and retained B as rollback authority.
- Inspection, history, and output were identical across update, rollback, and
  uninstall.
- Uninstall returned `uninstalled`; independent systemd observations reported
  `LoadState=not-found`, inactive, and not enabled.
- Prune scanned and retained the two referenced releases.
- Purge returned `purged` on its first attempt with no recovery, established
  application-root absence, and preserved both external SEA hashes.
- `cleanup.json` records builder `wfp-28307-b`, target `wfp-28307-t`, temporary
  root, and isolated Lima home all absent.

## Defects exposed and fixed

The acceptance work found real product and proof defects:

- `44c8bbb` bounded the macOS Lima socket paths before VM creation.
- `51ceffe` made handoff comparisons honor JSON value semantics rather than
  JavaScript object prototypes.
- `5b7f045` changed recursive purge to close bounded directory snapshots before
  deleting their entries, avoiding mutation under a live directory cursor.
- A bounded target diagnostic then showed that native LMDB's `data.mdb` and
  `lock.mdb` were created as mode `0664` under the target's permissive umask.
  Purge correctly refused those group-writable durable files.
- `39be8d6` narrows the process umask to `0077` only around LMDB's synchronous
  native open and restores it in `finally`. The successful Linux run proves
  that the unchanged fail-closed purge now converges in one attempt.

## Checksums and cleanup

The retained files verify as:

```text
9fa7ee1effbb6fd22d8cf1c33bf5fd7fa87548a2494a48505ff4f80b507bb216  builder.json
c5e141e347053941921706ef8d2b26867d20ffd15a66796071e44eb17acbec82  prepare.json
004ee985706dee6ee9b0c76537f9ece75db286d5c506c1be0c2a419272ead930  final.json
96901b511578811f89f9f172b9a2ae5ad189e71fd5e3de44c2fe147657e1a57b  cleanup.json
```

`shasum -a 256 -c SHA256SUMS` verified all four JSON receipts. A separate host
check found no `wfp.*` temporary root. Disk space returned after VM deletion;
the retained receipt directory is approximately 48 KiB.

The checksums detect later file alteration; they do not authenticate the
runner.

## Honest boundaries

- Builder and target were distinct sequential Lima VMs on one macOS host, not
  independent physical machines.
- The run covered Ubuntu 24.04 arm64/glibc and Node 24.13.1 only.
- The first controller exited normally. This proves unfinished durable work
  outlived its initiating process, not recovery from that process being killed.
- The separate lifecycle proof covers resident crash and target reboot. This
  acceptance run did not repeat that matrix.
- Purge requires no concurrent ordinary command; it does not yet have a
  persistent admission fence shared by all application invocations.
- The retained history and output report `authority: "none"` and
  `authoritative: false`. Their checks prove local integrity and consistency,
  not externally anchored authority.
- The proof does not establish another-machine coordinator replacement,
  multi-node placement, cloud fulfillment, or blanket physical exactly-once
  execution.

## Next work

Outcome 1 now has its bounded regression gate. Resume Outcome 2 by binding the
existing coordinator-authority kernel into production resident assembly and
requiring its epoch token at every authoritative ledger mutation. Do not grow
more single-host framework surface without a concrete application blocker.
