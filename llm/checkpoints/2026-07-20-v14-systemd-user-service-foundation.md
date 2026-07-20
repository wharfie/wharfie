# Wharfie checkpoint — packaged systemd user-service foundation

- **Date:** 2026-07-20
- **Status:** **IMPLEMENTATION SLICE COMPLETE — disposable-Linux boot/reboot
  proof remains required**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `fe9bb39c40c4f5ada4c65c0b566fc8138ced31a6`
- **Implementation receipt:** `18acb9eb3b5dffb8a9f4d3050ab929c1083b919c`
- **Parent checkpoint:** [durable workflow timers and
  signals](2026-07-20-v13-workflow-timers-signals.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR
  0020](../../docs/architecture/decisions/0020-systemd-user-service-lifecycle.md)

This checkpoint moves the existing packaged resident across the first real
operating-system boundary. A Linux SEA can now install and operate itself as a
fixed systemd user service without Node on the target `PATH`, a container,
`sudo`, a root daemon, or a second Wharfie supervisor. The implementation is
deliberately narrower than the older deleted service graph: one non-root local
UID, one installed artifact selection, one systemd user manager, and the
existing durable ledger-service runtime.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v14-systemd-user-service-foundation.md`. Work on
> branch `agent/strict-manifest` at or after implementation receipt `18acb9e`.
> Read `PROJECT.md`, `ROADMAP.md`, ADR 0020, and this checkpoint before editing.
> Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0. Work
> locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Breaking changes are acceptable: optimize for speed toward the
> ideal v2 state and do not restore v1. The immediate next proof is a
> disposable Linux systemd environment that installs the SEA, verifies
> enabled startup before login, kills and replaces the resident, reboots the
> machine, observes the same durable workflow state, and uninstalls without
> deleting it. After that, design a race-free maintenance/quiescence handoff
> before exposing update or rollback, then build the smallest provider-backed
> one-node fulfillment path. Preserve trusted-node-only scope, one coordinator
> with explicit recovery, Node/TypeScript as the public boundary, optional
> native/WASM/subprocess hot paths, and evidence-backed logical exactly-once
> decisions rather than physical exactly-once claims.

## Product direction retained

Wharfie remains a local-first framework for turning an approachable
TypeScript/JavaScript CLI with named activities into a portable SEA that can
remain resident and carry a user's intent beyond an interactive LLM session.
The longer path is trusted multi-node placement and coordinator recovery, not
general cloud IaC or a trustless mesh. A produced SEA may eventually use the
operator's credentials to create nodes and resources through bounded Wharfie
abstractions, but infrastructure provisioning is not part of this slice.

## Packaged operator surface

Only packaged applications expose this namespace:

```sh
<app> wharfie service install
<app> wharfie service start
<app> wharfie service stop
<app> wharfie service restart
<app> wharfie service status
<app> wharfie service uninstall
```

Every operation also accepts `--json`. Help is side-effect free and loads the
host manager lazily. The source CLI has no service-management command. Callers
cannot supply an application ID, executable path, unit name, unit fragment,
environment override, shell command, or credentials. Update, rollback, logs,
and data destruction are intentionally absent.

The command boundary accepts only versioned success/status objects, emits one
versioned safe error object for `--json`, and sets a failing exit code on any
manager, platform, or receipt error. The production SEA verifier now asserts
that relocated packaged help includes `service` and invokes isolated
`service status --json` with Node absent from `PATH`.

## Host and persistence boundary

The manager supports Linux only and requires one matching non-root
real/effective UID. It checks `loginctl ... Linger=yes` and a reachable
`systemctl --user` manager before install publishes service state. It never
enables lingering, changes users, invokes `sudo`, or installs a system unit.
Status reports lingering, persistent unit enablement, and their combined boot
configuration separately from process and ledger readiness.

All host commands use exact argv arrays with no shell, bounded output, and a
hard process timeout. Readiness/stop polling also uses a monotonic deadline and
caps supervisor observations to the remaining time. Lifecycle mutations are
serialized across processes with a per-UID/per-service Linux abstract Unix
socket; kernel bind supplies atomic ownership and automatically releases it if
the operator process crashes.

The deterministic unit uses `Type=exec`, `Restart=on-failure`, a five-second
restart delay, `SIGTERM`, `KillMode=mixed`, a 45-second stop timeout, a private
umask, and `NoNewPrivileges=true`. It starts only `current/app`. All control,
payload, application-state, session, runtime-command, runtime-argument, and
payload-store-identity settings are fixed so ambient user-manager values
cannot redirect the resident bootstrap. Authored application code still runs
with the invoking user's ordinary authority; this is not an application
sandbox.

## Immutable artifact and managed-path boundary

On Linux, installation reads `/proc/self/exe`, so identity and copying remain
bound to the executable inode already running even if its launch pathname is
replaced. A shared byte inspector hashes one opened regular-file descriptor and
rejects changes during observation. Install copies and rehashes those exact
bytes into an immutable content-addressed release, synchronizes staged files
and directories, and atomically selects the release with the sole `current`
symlink. Reusing a release requires exact receipt and byte verification.

Managed data/config roots are created and checked component by component.
Receipts, unit files, release records, and uninstall markers are bounded,
owner-checked, non-group/world-writable regular files read through no-follow
descriptors. Managed directories must be real, owned, and non-group/world
writable. Start and restart rehash the selected artifact and require the fixed
unit's exact bytes and persistent enablement before asking systemd to execute
it. A changed selector, artifact, receipt, unit, owner, mode, or managed symlink
fails closed.

The current default layout is:

```text
<wharfie-data>/services/<appId>/
  releases/<artifactId>/
    app
    release.json
  current -> releases/<artifactId>
  installation.json
  .uninstalling.json  # transient convergence marker
  state/
    control/
      execution-payloads/
      ledger-service-sessions/
    application-state/

<xdg-config>/systemd/user/wharfie-<appId>.service
```

## Process health and durable readiness

The existing process-held local session now emits one bounded versioned
identity frame containing its PID. A probe still treats a connected older or
malformed endpoint as live, but without a usable PID. Systemd health is
`healthy` only when all of these agree:

- immutable selection and fixed-unit integrity are verified;
- lingering and persistent unit enablement are intact;
- systemd reports the unit loaded, active, running, and a positive `MainPID`;
- the durable lifecycle is `READY` for the installed revision;
- the durable owner is the current resident session; and
- the live session PID is exactly systemd's `MainPID`.

Supervisor failure takes precedence over stale durable `STARTING` state.
Missing sessions, stale ownership, wrong revisions, wrong PIDs, lost boot
enablement, unreadable control state, and integrity drift remain degraded
rather than being reported healthy. Stop waits for systemd inactivity even
when stale durable `READY` state cannot converge, then reports that durable
degradation separately.

## Retry-safe, data-preserving uninstall

Uninstall disables and stops the unit, waits for supervisor inactivity, writes
a private phase marker, removes only manager wiring and the `current`
selection, reloads systemd, and writes an `uninstalled` identity tombstone.
Immutable releases and the complete state tree remain in place.

If a crash occurs after the marker, retry restores the deterministic unit when
necessary, reloads it, and reconverges through `disable --now` and confirmed
inactivity. It therefore cannot declare success while a worker restarted
between attempts is still running. A crash after the final tombstone is
already converged and only needs marker cleanup. Reinstalling the same artifact
reattaches to retained state and remains valid across wall-clock rollback;
installing a different artifact is refused until the maintenance/update
protocol exists.

## Exact post-change validation

Implementation receipt `18acb9e` was validated under Node 24.13.1/npm 11.12.0:

- repository-wide ESLint and JavaScript/JSON Prettier checks passed;
- all four TypeScript lanes passed: source, application implementation, tests,
  and SEA verifier;
- the final service, packaged-command, packaged-runtime, metadata, artifact,
  and documentation matrix passed 7 suites and 79 tests, with one Linux-only
  abstract-socket test skipped on macOS;
- the narrower service contract/manager/command/artifact matrix passed 46
  tests with that same one platform skip;
- package-content verification accepted 141 files;
- a production-style one-file bundle smoke retained the lazy manager and
  returned the expected safe non-Linux `service status --json` error; and
- staged and unstaged diff checks were clean before the implementation commit.

Two environment limits are intentionally not converted into false proof:

- the new real Unix-session identity-frame assertions could not bind their
  `/tmp` sockets in this restricted sandbox (`EPERM`); the implementation and
  test types pass, but those two assertions still need a normal host rerun; and
- a broad repository test run excluding that one socket suite exited 134 in
  the sandbox's native path without a Jest assertion failure. The earlier
  stable-tree full suite passed before this handshake change, but it is not a
  substitute for a post-change full run.

The full relocated-SEA verifier and a real systemd user manager were not run in
this environment. Most importantly, no claim is made yet that the unit starts
before login or that durable recovery survives a machine reboot.

## Explicitly unsupported

- real startup/recovery proof across a Linux machine reboot;
- update, rollback, release garbage collection, or a maintenance barrier;
- source-side service management, system units, root, dedicated accounts, or
  cross-principal administration;
- macOS launchd, Windows services, or non-systemd Linux supervision;
- public service logs, run-history/listing, or destructive uninstall;
- provider-backed node provisioning or credential/runtime-identity design;
- multi-node leases, heartbeats, placement, coordinator failover, or a
  trustless mesh; and
- any claim that arbitrary authored physical work runs exactly once.

## Ordered next tranche

1. Run the exact SEA in a disposable Linux systemd environment: enable
   lingering, install, verify startup before login, force process failure,
   verify systemd replacement and generation takeover, persist workflow work,
   reboot, verify recovery and PID-bound health, then uninstall and prove state
   preservation.
2. Design a durable maintenance/quiescence handoff that closes offline-submit,
   revision-pinning, selector-swap, and resident-generation races before adding
   update or rollback.
3. Add the smallest provider-backed path that can create, inspect, update, and
   remove one durable node through the operator's credential chain.
4. Begin recoverable single-coordinator placement only after the single-node
   service and control-store fencing are proven outside a developer session.

## Restart commands

```sh
git status --short --branch
git log -5 --oneline --decorate
PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/bin:/bin npm run lint
PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/bin:/bin npm run typecheck
PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/bin:/bin npm test -- --runInBand --coverage=false \
  test/cli/docs-command-surface.test.js \
  test/runtime/services/actor-system-cli-metadata.test.js \
  test/runtime/services/actor-system-cli-runtime.test.js \
  test/runtime/systemd-user-service-command.test.js \
  test/runtime/services/systemd-user-service.test.js \
  test/runtime/services/systemd-user-service-manager.test.js \
  test/runtime/packaged-artifact.test.js
PATH=/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin:/usr/bin:/bin npm run verify:package
```

The Unix-socket handshake test, full native suite, native external test,
production dependency audit, full SEA verifier, and real systemd proof may need
their normal host/network environment rather than the restricted sandbox.
