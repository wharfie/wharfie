# Wharfie checkpoint — real systemd crash and reboot proof

- **Date:** 2026-07-20
- **Status:** **SINGLE-NODE LINUX SERVICE RECOVERY PROVEN**
- **Branch:** `agent/strict-manifest`
- **Proof commit:** `0d92746384acae1aa111a271ff144f9bcf53d265`
- **Parent checkpoint:** [shared packaged application storage](2026-07-20-v15-shared-packaged-storage.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR
  0020](../../docs/architecture/decisions/0020-systemd-user-service-lifecycle.md)
- **Checksummed evidence:** [proof directory](../../llm_artifacts/systemd-proof/0d92746384acae1aa111a271ff144f9bcf53d265/)

Wharfie's packaged single-node service now has real machine-recovery evidence,
not only mocks or a container preflight. The repository driver created a fresh
Ubuntu 24.04 arm64 Lima VM, installed the exact Node 24.13.1/npm 11.12.0
contributor toolchain, packed and installed `@wharfie/wharfie@0.0.15` into a
clean consumer project, and built its Linux SEA. Every invocation of the
foreground packaged operator used a `PATH` without Node; the boot witness also
bound the resident's `/proc/<pid>/exe` directly to the immutable SEA release.

The proof passed from clean commit `0d927463` on 2026-07-20:

1. Start one workflow while no service is installed and prove its first
   activation is durably `ACTIVITY_RUNNABLE` in the app-scoped ledger.
2. Install the exact SEA as an enabled systemd user service without storage
   redirects. Require the effective `FragmentPath`, empty `DropInPaths`,
   immutable release bytes, systemd `MainPID`, durable resident ownership,
   local session, and revision identity to agree.
3. Let the resident complete step 0 and persist the exact 180-second timer.
4. Send `SIGKILL` to systemd's `MainPID`. Require a different PID and a higher
   durable generation, with no repeated activity dispatch and the same timer.
5. Install an independent root boot observer, synchronize the filesystem,
   abruptly stop the VM, and start it again.
6. Before any login session, require a changed kernel boot ID, automatic
   enabled service startup, generation takeover, the exact immutable
   executable in `/proc/<pid>/exe`, and the same waiting workflow/timer.
7. Let that timer fire after reboot, deliver the stable current-wait signal,
   and complete the same workflow. Activity marker 0 is bound to the old boot;
   marker 1 is bound to the new boot.
8. Prove graceful restart, stop, and start each converge with healthy
   PID/generation evidence.
9. Uninstall the service, independently prove the unit is absent and disabled,
   then prove immutable releases and completed durable state remain unchanged
   and inspectable.

## Evidence summary

The committed receipts record:

- npm tarball SHA-256
  `28af2fce479333958c44555ebf8396641c3b222406bd4fea835ca37d3c74eae2`
  with 144 packed files;
- SEA SHA-256
  `7784ec1842107dddd1f98163f9cbeb841a60965c961c5a018459c55c63035b01`
  and artifact ID
  `waf1_d4TsGEIQfd3R-YFj-cvrhBpgllyWHFoBhFnFXGMDWwE`;
- workflow run
  `wfr_q4sJgm_ddBXSC1bAxdpI5wgZFoTjsdEtHrW3OI5-cxk`;
- resident crash replacement from PID/generation `8112/1` to `8256/2`;
- kernel boot ID change from
  `c789ef14-ecaa-460a-90dc-88bf285a5352` to
  `0cc82b78-2c8e-4ed7-acfb-8f8f4b347ba1`;
- automatic pre-login boot health at PID/generation `810/3` with zero login
  sessions;
- graceful restart from PID/generation `810/3` to `1559/4`, followed by a
  stop/start generation of `1639/5`;
- timer `WAITING` before reboot and `FIRED` after its exact due time, accepted
  and consumed signal delivery, and final workflow disposition `COMPLETED`;
  and
- independent post-uninstall systemd state `not-found`, inactive, disabled,
  with byte-identical release and ledger evidence retained.

Receipt integrity is recorded in
[`SHA256SUMS`](../../llm_artifacts/systemd-proof/0d92746384acae1aa111a271ff144f9bcf53d265/SHA256SUMS):

```text
29db300a4de7f836a8823147254d28a26d2db0d71b5a958b5636db8bf5feb8f8  prepare.json
3d3a14e1ba04b85fb818e09ab383243866ffe48837c7e9e4e17a9ad71fbd98ab  boot-receipt.json
fd767bfb6232909d557c38e4fc55aab36c37f388c39372bde0384bab6ed0a869  final.json
```

## Defects closed by the proof

The real host exposed defects that mocks and relocated-SEA process tests did
not:

- foreground packaged commands and the resident originally selected different
  storage roots; commit `b5a5063e` gave them one app-scoped layout;
- Ubuntu's collaborative umask produced same-user Wharfie directories that the
  installer rejected; commits `e8c008b` and `2177801` safely tighten every
  real same-UID managed directory while still refusing symlinks and foreign
  ownership;
- status trusted unit-file bytes without checking systemd's effective source;
  commit `9792d2a` requires the expected `FragmentPath` and no drop-ins;
- systemd treated the quoted `WorkingDirectory` as a relative path and marked
  the unit `bad-setting`; commit `5edb3f9` renders path-valued syntax that
  Ubuntu's `systemd-analyze verify` accepts; and
- a fixed disposable VM name allowed concurrent or stale cleanup to collide;
  commit `0d927463` gives every proof an isolated instance and emits explicit
  phase markers.

## Remaining single-node work

This proof closes the roadmap's real-reboot item, but it does not make the
service lifecycle finished or production-ready. Next work should:

1. implement a race-free, quiescent, content-addressed update and rollback
   handoff;
2. inspect and safely converge orphan unit wiring when the Wharfie receipt is
   missing or tombstoned;
3. bound and garbage-collect stale extracted native runtimes after abrupt
   termination; and
4. add the smallest provider-backed path that can create, inspect, update, and
   remove one durable node through a user's normal credential chain.

Custom XDG configuration remains fail-closed through effective-unit
verification, but an earlier user-manager/shell configuration diagnostic would
improve failure messages. macOS launchd, Windows services, non-systemd Linux,
multi-host coordination, and public logs/run listing remain explicitly later
work.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v16-systemd-reboot-proof.md` on branch
> `agent/strict-manifest` at or after proof commit `0d927463`. Use only the
> local git CLI; do not spend time on PRs or issues. Breaking changes are fine
> and there are no downstream users, so optimize for the ideal v2 state. The
> real Ubuntu systemd proof is complete and its checksummed receipts are
> committed under `llm_artifacts/systemd-proof/0d927463.../`; do not rerun it
> unless service semantics change. Start with race-free quiescent
> content-addressed update/rollback, orphan unit reconciliation, and bounded
> stale native-runtime cleanup, then move to the smallest provider-backed
> single-node deployment path. Preserve the trusted-node,
> one-recoverable-coordinator, Node/TypeScript public-boundary, portable SEA,
> and evidence-backed exactly-once direction in `PROJECT.md`.
