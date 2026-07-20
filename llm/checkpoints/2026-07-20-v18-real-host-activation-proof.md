# Wharfie checkpoint — real-host release activation proof

- **Date:** 2026-07-20
- **Status:** **TWO-RELEASE UPDATE, ROLLBACK, RESPONSE-LOSS, AND SOURCE RESTORATION PROVEN ON REAL SYSTEMD**
- **Branch:** `agent/strict-manifest`
- **Validated implementation/proof head:** `939e0f251db97189d9f003048570bd29cabc5165`
- **Path-permission fix:** `d790e34`
- **Deterministic proof implementation:** `48deb6c`
- **Evidence-hardening receipt:** `939e0f2`
- **Parent checkpoint:** [recoverable systemd release activation](2026-07-20-v17-recoverable-systemd-activation.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR
  0020](../../docs/architecture/decisions/0020-systemd-user-service-lifecycle.md)
- **Checksummed evidence:** [proof directory](../../llm_artifacts/systemd-proof/939e0f251db97189d9f003048570bd29cabc5165/)

Wharfie's single-node packaged service now has real-host evidence for its
complete durable release-activation state machine, not only fake-systemd and
coordinator tests. A fresh Ubuntu 24.04 arm64 Lima VM packed and installed
`@wharfie/wharfie@0.0.15`, built three distinct Linux Node 24.13.1 SEAs, ran
packaged commands with Node absent from `PATH`, force-cycled the machine, and
then exercised 15 exact crash/recovery boundaries through public SEA commands.

This remains a trusted single-user, single-coordinator design. The proof does
not claim multi-node failover, trustless execution, general cloud IaC, or
production readiness.

## What the proof establishes

The proof preserves the V16 lifecycle evidence and adds the missing activation
matrix:

1. Persist one workflow before service installation, install source release A,
   and prove exact fixed-unit, immutable-byte, resident PID, revision, ledger,
   and runtime health.
2. Kill the resident and require systemd to replace it with a higher durable
   generation.
3. Abruptly stop and restart the VM. Before any login session, require a new
   boot ID, automatic healthy startup, and the same durable workflow/timer.
4. Complete that workflow after reboot without repeated authored dispatch.
5. For update A → B, kill the public operator immediately after each committed
   activation write: `QUIESCING`, `QUIESCENT`, `SELECTED`, `ACTIVATING`, and
   `ACTIVE`. Recover every case through `service recover` and independently
   verify the durable record, selector, installation receipt, exact
   `/proc/<pid>/exe`, and systemd state.
6. Repeat all five boundaries for rollback B → A.
7. Treat the kill after committed `ACTIVE` as response loss. Require recovery
   to leave the durable record byte-equivalent, then refuse a stale rollback
   retry from the retained candidate without changing state.
8. Build failing release C with an exact source-bound resident fault that exits
   cleanly before `READY`. Prove the selected SEA embeds that exact injected
   source, systemd observes `ExecMainStatus=0` and `Result=success`, and Wharfie
   classifies the stopped target as failed activation.
9. Kill and recover source restoration at its five writes: restoration
   `QUIESCING`, `QUIESCENT`, source `SELECTED`, source `ACTIVATING`, and settled
   `ACTIVE`. Require A healthy again while the older valid rollback candidate
   B remains retained.
10. Exercise restart, stop/start, and uninstall; prove systemd wiring is absent
    while immutable releases and completed durable state remain byte-identical
    and inspectable.

The activation receipt records 15 expected and 15 observed crash cases: five
update, five rollback, and five source restoration. Every case recovered to an
independently healthy exact release.

## Deterministic crash boundary

The verifier no longer tries to catch fast phases with millisecond polling. It
starts the public SEA under Node's loopback-only inspector, binds a breakpoint
to the exact installed activation-store source through the SEA's embedded
source map, and pauses after the durable database write has committed. A
separate read-only LMDB client observes state without taking Wharfie's kernel
operation lock.

One original source statement maps to multiple generated bundle locations, so
the verifier does not equate raw debugger pauses with writes. It advances only
when the independently read durable `recordVersion` increments, rejects gaps or
overshoot, and kills the operator at the exact target version. Receipt evidence
retains both raw pause counts and the durable write number.

The clean-exit fault receives the same source-map binding. A cached or
tree-shaken build that omitted the injected resident line would fail before the
matrix. At restoration write 5, the verifier independently requires inactive/
dead systemd state, exit status zero, and successful manager result before it
accepts source restoration.

## Artifact and receipt evidence

The installed package tarball contains 147 files and has SHA-256
`9d5a73a4ee5f25b8e19312d20b954ff9de953f679da81eacfb7d4aea5efaf9a6`.
Each SEA is 145,624,192 bytes:

- source A: artifact
  `waf1_O42Q8s9_wa4tSuU1SargPSCbWtz7TMFOTh-Q_ZQWgR8`, revision
  `wrv1_37FNubGRfCODUnNoNCY0z31s9mGvhBIlP0r9UfC76TI`, SHA-256
  `3b8d90f2cf7fc1ae2d4ae53549aae03d209b5adcfb4cc14e4e1f90fd9416811f`;
- healthy target B: artifact
  `waf1_pAMWtzK8bIsFIi68Vow-IpteFRMKg1whZveAEACUdSk`, revision
  `wrv1_PYnzlNP_7Vfvzw4oiQlWaWQGxxTmMjI7lwmIRQVFdWk`, SHA-256
  `a40316b732bc6c8b05222ebc568c3e229b5e15130a835c2166f7801000947529`;
  and
- clean-exit target C: artifact
  `waf1_6F9IQfZYSWO2jMIzWgZCE7TzPivmD2Z-_T2REnQfbhM`, revision
  `wrv1_V15QpaGprQI8dDMYbhOH-IejSf-nf-UEO7i5CIIPFqQ`, SHA-256
  `e85f4841f6584963b68cc2335a064213b4f33e2be60f667efd3d9112741f6e13`.

The VM changed boot ID from `58335403-933e-4843-b6b8-31f44c7cef7a` to
`9c42b975-a2bb-48f4-8f95-f080cfb0c4e1`. Initial resident crash replacement
moved from PID/generation `8200/1` to `8356/2`.

Receipt integrity is recorded in
[`SHA256SUMS`](../../llm_artifacts/systemd-proof/939e0f251db97189d9f003048570bd29cabc5165/SHA256SUMS):

```text
2a112ee1d4261dffe42a7bd0010827dfc425267868c26dbebe3e3e64d0baf664  prepare.json
7d10bed21f5a64b8abd8492d27b607b38b54a988bff8844d129b8e4e554f8067  boot-receipt.json
10bdd234dbe76c3016dd087afc02e6e79a99451cda0e8ede3c8b4b56271b94c9  final.json
```

## Defects closed while obtaining proof

The disposable host exposed three proof or product defects:

- A fresh Ubuntu account had no `~/.config`. CLI startup recursively created
  it as group-writable `0775` under Ubuntu's user-private-group umask, while
  the service manager correctly rejected shared writable systemd ancestors.
  Commit `d790e34` creates every new Wharfie path component with mode `0700`
  without chmodding pre-existing user directories.
- The first failing-target fixture placed its fault in the authored manifest,
  which was compile-time input rather than resident runtime code; target C
  therefore became healthy. The final verifier injects the fault into the
  installed resident command source before building only C and proves those
  exact bytes through the embedded source map.
- Phase polling could miss fast durable transitions and did not cover committed
  response loss or restoration writes. Commits `48deb6c` and `939e0f2` replace
  it with exact post-commit breakpoints, durable-version accounting, physical
  host evidence, and explicit clean-exit proof.

## Local validation

Using the pinned Node 24.13.1 toolchain at proof head `939e0f2`:

- repository-wide ESLint and Prettier pass;
- all source, app, test, and SEA-verifier TypeScript checks pass;
- the full unrestricted serial suite passes 109 suites and 1,815 tests, with
  one suite and two tests intentionally skipped;
- the package verifier confirms 147 tarball files; and
- the checksummed disposable Ubuntu proof passes all lifecycle, reboot, and 15
  activation crash cases, then deletes its VM.

The first local parallel Jest attempt ran inside the restricted execution
sandbox and was not a product result: Unix sockets were denied with `EPERM`
and many child-process crash tests received simultaneous `SIGABRT`. The same
suite passed serially when its required local sockets and process controls were
allowed.

## Ordered next work

The real-host activation matrix is complete. The next safe sequence is:

1. bound and clean stale native-runtime extraction after abrupt termination;
2. define and build the smallest provider-backed single-node
   plan/apply/inspect/reconcile/destroy path through a user's ordinary
   credential chain; and
3. begin provider-backed coordinator replacement and fencing only after that
   single-node provisioning path is proven outside a developer session.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v18-real-host-activation-proof.md` on branch
> `agent/strict-manifest` at or after proof commit `939e0f2`. Use only the local
> git CLI; do not spend time on PRs or issues. Breaking changes are fine and
> there are no downstream users, so optimize for the ideal v2 state. The
> checksummed Ubuntu proof under
> `llm_artifacts/systemd-proof/939e0f251db97189d9f003048570bd29cabc5165/`
> proves reboot recovery, five update writes, five rollback writes, five
> clean-exit source-restoration writes, committed-response recovery, stale
> retry refusal, and state-preserving uninstall. Work on bounded stale native
> runtime extraction next, then the smallest provider-backed single-node path.
> Preserve the trusted-node, one-recoverable-coordinator, Node/TypeScript
> public-boundary, portable SEA, and evidence-backed exactly-once direction in
> `PROJECT.md`.
