# Wharfie checkpoint — recoverable systemd release activation

- **Date:** 2026-07-20
- **Status:** **DURABLE ACTIVATION, PACKAGED MANAGER, CLI, AND EDGE HARDENING LANDED — REAL-HOST TWO-RELEASE PROOF REMAINS**
- **Branch:** `agent/strict-manifest`
- **Validated implementation/test head:** `d1b937e`
- **Coordinator receipts:** `04414e5` through `cef45c3`
- **Manager integration receipt:** `510f7be`
- **Public CLI receipt:** `bd55e99`
- **Activation edge-hardening receipt:** `48a4e8f`
- **Recovery UX refinement receipt:** `a4a35c6`
- **ACTIVE repair hardening receipt:** `df2edb1`
- **Stale-draft corrective receipt:** `cdf97c3`
- **Documentation receipt:** `a17991d`
- **Full-gate stability receipt:** `d1b937e`
- **Parent checkpoint:** [real systemd crash and reboot proof](2026-07-20-v16-systemd-reboot-proof.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR
  0020](../../docs/architecture/decisions/0020-systemd-user-service-lifecycle.md)

Wharfie's packaged Linux service now has one durable local release-activation
state machine rather than an unsafe stop/symlink/start sequence. The state
machine is integrated with the real packaged service manager at `510f7be`,
exposed through the packaged CLI at `bd55e99`, and hardened at `48a4e8f`.
Recovery guidance and the final regression matrix were refined at `a4a35c6`;
ACTIVE projection repair and its retry boundary were hardened at `df2edb1`.
Documentation and this restart checkpoint describe that remote-backed
implementation.

This is a single trusted-node design. One app-scoped kernel operation lock
serializes the activation database, execution-ledger quiescence checks, and
systemd/filesystem effects. The durable control record—not a unit file,
symlink, receipt, systemd cache, or live process—is the authority from which a
crashed command resumes.

## Fixed activation contract

The durable phases are:

```text
QUIESCING -> QUIESCENT -> SELECTED -> ACTIVATING -> ACTIVE
```

Each transition records exact source, target, selected release, desired
release, retained rollback candidate, transition ID, record version, and
selection generation. Every release reference is an immutable
artifact/revision pair and is reverified before it is used.

Run creation and service start use the same durable record as a transaction
fence:

- `ACTIVE` admits runs for the selected revision and service start for the
  exact selected artifact/revision.
- Beginning update or rollback atomically enters `QUIESCING` and closes new-run
  admission.
- `QUIESCING` has one narrow non-install exception: the exact selected source
  may start so it can finish draining or be proven healthy before a refusal
  reopens admission.
- `QUIESCENT` and `SELECTED` admit no service start.
- `ACTIVATING` admits only the exact selected destination release.

The coordinator proves the complete durable run directory quiescent before it
stops an existing source and again after systemd proves the source inactive.
It repeats the inactive proof after `QUIESCENT` and `SELECTED`, so a racing or
stale source start cannot survive selector mutation.

## Install, update, rollback, and recovery

First install has no source release. It requires physical service absence
before creating activation authority, but immutable target bytes may already
be staged. Existing nonterminal work is compatible only when every run has the
target revision: that queued work remains admitted for the first resident to
process. Foreign-revision nonterminal work leaves install `pending` in
`QUIESCING`, with `selected: null`, no running service, and admission fenced.

`service update` is invoked from the new target SEA. It stages and verifies
that exact invoking artifact before closing admission, then retains the old
selection as the single rollback candidate.

A fresh `service rollback` is invoked from the currently selected SEA and can
select only the retained candidate. Rollback is direction-changing, so an
ambiguous response must be handled with `service recover`, not by guessing the
current release and starting another rollback. Recovery resumes or verifies
the already durable transition and cannot toggle it. A rollback invocation
from the retained prior/candidate SEA is rejected because it is
indistinguishable from a stale response-loss retry; explicit `service recover`
is the only ambiguity path.

If a target reports a definitive failed activation, durable state changes
direction and restores the exact source. Admission reopens only after the
source selection and resident health are independently verified. A thrown,
timed-out, or otherwise ambiguous host effect remains recoverable rather than
being interpreted as failure or success.

## Physical convergence and systemd ordering

Selector, installation receipt, fixed unit, manager fragment, enabled state,
lingering, immutable bytes, resident artifact/revision, PID ownership, and
ledger readiness must agree before a selection is healthy.

A missing selector, receipt, or fixed unit may be reconstructed only when the
durable activation record authorizes the exact current/previous projection.
Physical wiring with no activation record is degraded and is never adopted by
install, start, update, rollback, or recovery. Exact orphan cleanup remains an
uninstall-only authority and does not synthesize activation history.

Wharfie deliberately does not call `systemctl enable --now`. Selection
convergence publishes and verifies the authorized projection, reloads systemd,
and enables the fixed unit without starting it. The coordinator then repeats
the inactive proof, records `ACTIVATING`, checks the exact durable start fence,
and calls `systemctl start` separately.

## Uninstall and reinstall

Uninstall is still state-preserving. It disables/stops the unit, removes the
unit and `current` selector, and retains immutable releases, application state,
ledger state, payloads, and an `uninstalled` installation tombstone.

It also deliberately retains the settled `ACTIVE` activation record, selected
release, rollback candidate, record version, selection generation, and
same-revision run admission. Work for that selected revision may therefore be
queued while the resident is absent. Running `service install` from the same
selected SEA rehydrates physical wiring and starts the resident without
changing activation record version or selection generation. The tombstone also
authorizes a new target SEA to reproject and prove the exact retained source,
then enter the ordinary durable update under the same operation lock. Install
from that new SEA is treated as an update. Unexplained missing projection state
still fails closed and requires `service install` from the exact selected SEA.
An interrupted ACTIVE physical repair is replayed through that same command,
not activation recovery.

## Public result contract

Activation receipts keep request disposition separate from converged state:

```text
requestStatus: fulfilled | refused | failed | pending
outcome:       target-active | source-retained | source-restored | in-flight | absent
```

`absent` is a finite outcome when recovery finds neither durable activation nor
a physical projection. Refused, failed, and pending command results use a
nonzero exit code in both human and JSON modes. A pending interrupted
transition directs the operator to `service recover`; incompatible
first-install work instead directs the operator to settle that work or install
its matching revision because recovery alone cannot change revision identity.

## Commit receipts

The durable coordinator was built and hardened in these remote-backed commits:

- `04414e5` — add durable local application activation state;
- `3b5a510` — fence local application work during activation;
- `33f709a` — refuse activation while durable work remains;
- `96c15eb` — reconcile orphaned systemd service wiring;
- `add873c` — require exact resident artifact health;
- `e5d4e29` — verify retained systemd releases by reference;
- `5ca84a4` — require proven target selection before restoration;
- `cb0ee59` — add crash-recoverable systemd activation convergence;
- `5254e3f` — harden activation crash recovery;
- `e695e33` — allow queued work on first service install;
- `e5ad95f` — admit only compatible work on first install; and
- `cef45c3` — make ambiguous rollback recovery explicit.

Commit `510f7be` integrates that coordinator with the real packaged systemd
manager, immutable release layout, execution ledger, application-state
evidence verifiers, systemd driver, status view, activation-aware lifecycle
operations, and manager tests. Commit `bd55e99` exposes and validates the
public update/rollback/recover command contract. Commit `48a4e8f` removes
ambiguous rollback authority, degrades in-flight status, refuses manual stop
during a transition, classifies clean target exit as failure, scopes recovery
guidance, preflights repair before stopping, preserves shared config-directory
modes, repairs uninstall/reinstall dead ends, and updates the Linux verifier's
status and install expectations. Commit `a4a35c6` adds sanitized human
failures, prioritizes activation recovery
guidance, tightens receipt validation, and expands reinstall/build-target
regressions. Commit `df2edb1` preflights ACTIVE source projection before an
update, adds a distinct retry contract for interrupted physical repair, keeps
intentional-uninstall rehydration automatic, and expands status and repair
regressions. A delayed stale draft was accidentally committed as `53332b8` and
immediately neutralized by `cdf97c3`; it does not define the product contract.
The implementation and runtime-test files at `cdf97c3` are byte-for-byte the
`df2edb1` versions. Commit `a17991d` records the aligned public documentation
and this checkpoint. Commit `d1b937e` raises one transaction-heavy ledger
contract's per-test budget from 5 to 15 seconds after it exceeded the default
only under the full suite's parallel load; isolated adapter cases complete in
roughly 1.6–1.9 seconds. At checkpoint finalization,
`origin/agent/strict-manifest` points at or after `d1b937e`, so the complete
repository state is remotely backed up.

## Validation and evidence boundary

Using the repository's pinned Node 24 toolchain:

- the three focused activation/coordinator, packaged-manager, and command
  suites pass 168 tests with one intentional platform skip;
- the full repository suite passes 108 suites and 1,814 tests, with one suite
  and two tests intentionally skipped;
- all source, app, test, and SEA-verifier TypeScript checks pass;
- repository-wide ESLint and Prettier checks pass; and
- package contents verify across 147 tarball files;
- the native external/LMDB integration test passes;
- the production dependency audit reports zero vulnerabilities; and
- the installed-package/generated-SEA verifier passes with Node unavailable on
  the packaged command path. Its final Darwin SEA is 146,854,992 bytes with
  SHA-256
  `ebe0074d188019bf07d00f8a84b4a6a511946bb876e59a32b329f105ec7d229c`.

The checksummed V16 disposable Ubuntu proof remains valid for the lifecycle it
actually ran: install, status, restart, stop/start, uninstall, resident
`SIGKILL` replacement, abrupt VM restart, pre-login recovery, and continuation
of one durable workflow. It is bound to commit `0d927463` and predates this
activation implementation. There is **no disposable real-host two-release
update/rollback crash proof yet**. Do not describe focused fake-systemd or
manager tests as that proof.

## Worktree handoff

The implementation through `cdf97c3`, documentation at `a17991d`, and
full-gate stability adjustment at validated head `d1b937e` are committed,
pushed, and validated. This checkpoint-only finalization commit follows that
head, and the worktree is clean at handoff.

The next safe sequence is:

1. extend the disposable Linux proof to two distinct SEA releases and crash at
   every durable activation phase, including source restoration and ambiguous
   rollback response recovery;
2. bound stale native-runtime extraction after abrupt termination; and
3. begin the smallest provider-backed single-node plan/deploy/inspect/destroy
   path through a user's normal credential chain.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v17-recoverable-systemd-activation.md` on branch
> `agent/strict-manifest` at or after `d1b937e`. Use only the local git CLI; do
> not spend time on PRs or issues. Breaking changes are fine and there are no
> downstream users, so optimize for the ideal v2 state. The durable activation
> coordinator through `cef45c3`, packaged manager integration at `510f7be`,
> public CLI at `bd55e99`, edge hardening at `48a4e8f`, and recovery UX at
> `a4a35c6`, plus ACTIVE repair hardening at `df2edb1` and its corrective HEAD
> at `cdf97c3`, documentation at `a17991d`, and the fully validated branch head
> at `d1b937e` are remotely backed up. Build the disposable-host two-release
> crash matrix next;
> V16 proves reboot recovery for the old lifecycle but does not prove update or
> rollback. Preserve the trusted-node, one-recoverable-coordinator,
> Node/TypeScript public-boundary, portable SEA, and evidence-backed
> exactly-once direction in `PROJECT.md`.
