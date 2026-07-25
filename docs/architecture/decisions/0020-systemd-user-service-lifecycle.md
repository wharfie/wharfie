# 0020 — Linux systemd user-service lifecycle

**Status:** Accepted · **Date:** 2026-07-20

## Context

Wharfie can already package an application as one target-specific Node SEA and
run that artifact as a foreground resident. The artifact has a hidden
`ledger-service` bootstrap that binds the embedded application and revision,
owns the local execution ledger, publishes durable lifecycle state, recovers
stopped work conservatively, and drains on `SIGTERM`. What is missing is the
narrow operating-system layer that keeps that same process resident after the
interactive session ends and starts it again after a machine reboot.

The previously deleted NodeAgent, private service graph, and system-level
systemd release machinery are not a foundation to restore. They predated the
current artifact, ledger, ownership, and reserved-operator contracts and would
introduce a second supervisor and runtime model.

The local ownership protocol is intentionally scoped to one operating-system
principal. Its durable owner records and private Unix sockets identify the
current UID. Running the service under a different account would therefore
require a designed cross-principal authorization and command bridge. No such
bridge exists, and silently introducing `sudo`, a setuid helper, shared socket
permissions, or root-owned runtime state would weaken the current boundary.

Systemd user services normally start only while their user's manager is
running. Enabling a user unit is therefore not, by itself, proof that it will
start at machine boot before login. Boot persistence is honest only when the
host has enabled lingering for that user.

## Decision

### One Linux systemd user service under the resident UID

The first OS-managed service target is Linux with systemd. Wharfie installs a
user unit and invokes systemd only through `systemctl --user`. The installer,
resident, and later operator commands run under the same invoking non-root
real/effective UID. Wharfie
does not elevate privileges, call `sudo`, create users or groups, install a
system unit, or provide a cross-principal command bridge in this slice.

Installation requires all of the following:

- Linux and a usable systemd user manager;
- canonical absolute XDG data/config locations chosen by the invoking UID;
- the exact packaged SEA being installed to match the host target; and
- systemd lingering already enabled for the invoking UID.

Wharfie checks the manager and the user's `Linger=yes` state before publishing
an installation. If either cannot be established, installation refuses with a
safe diagnostic. It does not enable lingering itself because that is a host
administrator decision outside an unprivileged application artifact. This
makes “enabled at boot” a verified precondition rather than an implication of
`systemctl --user enable`.

The initial packaged operator surface is:

```text
<app> wharfie service install
<desired-app> wharfie service converge
<next-app> wharfie service update
<next-app> wharfie service rollback
<next-app> wharfie service recover
<app> wharfie service start
<app> wharfie service stop
<app> wharfie service restart
<app> wharfie service status
<app> wharfie service uninstall
```

Each command supports the repository's human-readable output convention and a
single machine-readable `--json` success or error response. Install, start,
stop, and uninstall converge when their requested state is already satisfied;
restart deliberately starts a new process generation. An installation is bound
to the embedded application identity; commands never accept a unit name,
executable path, shell fragment, or another application ID from the caller.

`service converge` is the target-enforcing desired-state operation for a host
agent or other automation that owns an exact desired SEA. It first resumes a
non-rollback durable activation, except that an in-flight first install of a
different artifact uses the coordinator's explicit replacement transition
instead. An in-flight rollback is refused and must be settled with
`service recover`. If other recovery remains non-fulfilled, convergence returns
that finite result without beginning another transition. Otherwise it makes at
most one exact-target attempt: repair an already selected invoking release,
install it when no activation exists, or enter the ordinary update path when
another release is active. Before that update, convergence may repair an exact
receipt-backed ACTIVE source projection. An exact projection whose only defect
is stopped, failed, or degraded liveness is stopped, has systemd failure and
start-limit state cleared when present, and is restarted before settlement or
update. Missing, corrupt, or contradictory source authority still fails
closed. Repeating the same desired artifact after a lost install or update
response cannot request a reverse transition.
Interactive `update` and `rollback` remain explicit directional operations,
and `recover` remains the direction-neutral command when no desired artifact
is being asserted.

`install` publishes the release and fixed unit, reloads the user manager, and
enables the unit without starting it. Once the exact selection is durable and
verified, the coordinator records `ACTIVATING`; only then does its exact
service-start fence permit a separate `systemctl --user start`. Wharfie never
uses `enable --now` because that would combine a persistent wiring mutation
with process activation before durable start authority exists. `start`,
`stop`, and `restart` otherwise delegate process lifecycle to systemd. `stop`
does not disable boot startup. `uninstall` uses `disable --now`, removes the
unit and installed executable selection, reloads the user manager, and
preserves all durable application and control data.

### Immutable releases and one atomic executable selection

Every packaged application derives one immutable, app-scoped local-storage
layout from its embedded `appId` before developer code, public operators, or a
hidden runtime can execute. The layout is carried as process-local async
bootstrap context rather than hidden environment mutation. Installing a
service adds supervision and immutable releases around those same state paths;
it does not move, copy, or select a second ledger. Explicit foreground storage
overrides remain available, but service management refuses them unless every
durable route exactly matches the fixed resident layout.

The packaged layout uses an account-stable data root that does not move with
invocation-specific `XDG_DATA_HOME` or `HOME`. On Linux it is fixed below the
service account's `~/.local/share/wharfie-nodejs`, using the home directory
recorded for that operating-system account:

```text
<wharfie-data>/applications/<appId>/
  releases/<artifactId>/app
  current -> releases/<artifactId>
  installation.json
  .uninstalling.json  # present only while uninstall is converging
  state/
    control/
      execution-payloads/
      ledger-service-sessions/
    application-state/
```

The unit is written below the service account's stable home directory, not an
invocation-specific `XDG_CONFIG_HOME`:

```text
<account-home>/.config/systemd/user/wharfie-<appId>.service
```

Before staging a release or durable state, Wharfie queries the running user
manager's authoritative `UnitPath`, creates only that fixed private unit
directory when necessary, reloads once, and refuses installation unless the
manager actually searches it. All paths are canonical absolute paths derived
once during installation. The application ID already satisfies Wharfie's
portable logical-ID grammar and is safe as the bounded unit-name component.
Managed service roots, state paths, release paths, receipts, selectors, and
unit entries must have their expected concrete file type; Wharfie refuses
managed symlinks except for the exact `current` selector and refuses
conflicting content at an existing artifact identity. The invoking user's
parent home layout remains part of the trusted same-UID host boundary rather
than an isolation boundary against that user.

The SEA's final-byte `artifactId` names an immutable release directory. On
Linux, Wharfie reads `/proc/self/exe`, binding installation to the executable
inode already running even if its launch pathname is replaced. It copies those
bytes through a private staging file, verifies the bytes and embedded
app/revision/target identity, makes the installed file
executable but not writable, and publishes the directory without overwriting
an existing release. Reinstalling the exact release reuses it only after exact
verification.

The `current` symbolic link is the sole executable selection consumed by the
unit. Wharfie creates a sibling link and atomically renames it over `current`,
then synchronizes the parent directory before treating the selection as
published. A failed install can be retried and reconciled from the immutable
release and durable activation state; it never edits an artifact in place.
That durable record—not a symlink, receipt, unit file, systemd cache, or live
process—is the authority for the physical projection. If an authorized
transition or settled `ACTIVE` selection has lost its receipt, selector, or
fixed unit, convergence may reconstruct only the exact current/previous
projection named by that record and must rehash both immutable releases.

Conversely, physical wiring with no durable activation record is not an
installable service. Status reports it degraded, and install, start, update,
rollback, and recovery refuse rather than infer a generation or adopt it.
`service uninstall` remains the narrow cleanup boundary for an exact orphan;
it may remove verified residual wiring under its independent uninstall marker
rules, but it does not turn that wiring into activation authority. Active,
conflicting, cached-only, foreign, or otherwise unverifiable state remains
fail-closed.

Installing a different artifact through `service install` while a resident is
installed is refused; `service update` is the explicit online evolution path
and is invoked from the target artifact. An intentionally uninstalled
tombstone has a separate offline path described below. One local activation
coordinator holds the existing app-scoped
operation lock and persists an exact state machine through `QUIESCING`,
`QUIESCENT`, `SELECTED`, `ACTIVATING`, and `ACTIVE`. The transition binds the
source, target, selector generation, and one retained rollback candidate.
`service rollback` uses only that candidate, never a caller-selected path. A
fresh rollback must be invoked through the exact currently selected SEA, so
the command immediately following `<next-app> service update` is `<next-app>
service rollback`.

Rollback is a direction-changing request, not an idempotency key. If the
caller cannot tell whether a rollback response was delivered, it must run
`service recover`, which resumes or verifies the already durable transition
and cannot begin the opposite rollback. It must not issue a new rollback based
on a guessed current selection. A rollback invocation from the retained
candidate/prior SEA is rejected: it is indistinguishable from a stale retry
after response loss and cannot safely express a fresh direction change.
Direction-neutral recovery is the only public ambiguity contract after a
rollback request.

Beginning a change closes new-run admission in the same control-store
transaction that records `QUIESCING`. Service-start admission is also fenced
by the durable phase and exact artifact/revision. `ACTIVE` admits its selected
release; `ACTIVATING` admits only the selected destination. One narrow
draining-source exception admits the exact selected source during a non-install
`QUIESCING` transition so a refused change can drain, restart, and prove that
source healthy before admission reopens. `QUIESCENT` and `SELECTED` remain
closed, and first install has no source eligible for that exception.

The coordinator reads the verified complete run directory before stopping the
resident and again after systemd proves it inactive; every run must be
terminal. A blocker refuses the request and keeps or reactivates the exact
source before reopening admission. First install is different because its
transition source is `null`: an already queued nonterminal run is compatible
only when its revision equals the target revision. Exact target-revision work
is allowed to remain queued and the new resident may be activated to process
it. Any foreign-revision nonterminal work leaves install `pending` in
`QUIESCING`, with no selected or running service and admission still fenced.

After crossing `QUIESCENT`, the coordinator repeats the stop proof before
selecting the immutable target. Selection convergence writes or repairs the
authorized receipt, selector, and fixed unit, then enables the unit without
starting it. `SELECTED` repeats the inactive proof and only then records
`ACTIVATING`; the start fence can now authorize the exact selected release.
The coordinator commits `ACTIVE` only after exact health verification.

Every physical effect is idempotent relative to the durable phase, so
`service recover` can continue after process death at any boundary. A failed
target enters durable source restoration and reopens admission only after the
source is healthy. Receipts separate request status—`fulfilled`, `refused`,
`failed`, or `pending`—from settled outcome—`target-active`,
`source-retained`, `source-restored`, `in-flight`, or `absent`. `absent` is the
finite recovery result when no durable activation and no physical projection
exist. Refused, failed, and pending requests use a nonzero command exit,
including in JSON mode. This is deliberately one recoverable local coordinator,
not multi-node rollout or coordinator failover.

`service converge` composes those same effects rather than introducing another
activation state machine. One invocation may recover a prior transition and
then make one attempt to request the invoking release, but it never reports
success unless that exact release is independently healthy. A non-fulfilled
receipt remains a nonzero command result and is safe for a durable host
reconciler to retry after the reported blocker changes. Convergence never
expresses or recovers rollback; an ambiguous rollback still requires
`service recover`.

Lifecycle mutations are serialized with a per-UID, per-installation abstract
Linux Unix socket. Kernel bind is the cross-process exclusion primitive and
the address disappears automatically when the process exits, avoiding stale
lock deletion, PID reuse, and concurrent stale-recovery races.

That lock serializes Wharfie operations, not arbitrary commands from another
process running as the same UID. Systemd's destructive unit operations are
addressed by name and provide no compare-and-swap fence on `FragmentPath`.
Wharfie therefore verifies immediately before mutation and again after reload,
but a same-UID actor that concurrently rewrites and reloads the unit between
those points is inside the trusted service-user boundary and unsupported.
Protecting against that actor requires a distinct service principal or
privileged broker and is not claimed by this user-service design.

### Fixed unit and stable durable paths

Wharfie renders one versioned, fixed unit template. Callers cannot supply
arbitrary unit sections, dependencies, commands, environment variables,
environment files, credentials, or restart settings. The template starts only
the installed `current/app` with the existing hidden bootstrap:

Wharfie owns the unit file and its app-scoped data tree, not the account's
shared `~/.config`, `systemd`, or `systemd/user` directory policy. Existing
shared ancestors must be real, owned by the service user, and not writable by
group or other users, but install never chmods away their read/execute bits.
Directories Wharfie creates itself use private permissions.

```ini
[Unit]
Description=Wharfie application <appId>
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
ExecStart=<wharfie-data>/applications/<appId>/current/app
WorkingDirectory=<wharfie-data>/applications/<appId>/state
Environment=WHARFIE_RUNTIME_COMMAND=ledger-service
Environment=WHARFIE_RUNTIME_ARGS=[]
Environment=WHARFIE_CONTROL_ADAPTER=lmdb
Environment=WHARFIE_CONTROL_PATH=<wharfie-data>/applications/<appId>/state/control
Environment=WHARFIE_EXECUTION_PAYLOAD_PATH=<wharfie-data>/applications/<appId>/state/control/execution-payloads
Environment=WHARFIE_EXECUTION_PAYLOAD_STORE_ID=
Environment=WHARFIE_EXECUTION_LEDGER_TABLE=wharfie-execution-ledger-v10
Environment=WHARFIE_APPLICATION_STATE_ADAPTER=lmdb
Environment=WHARFIE_APPLICATION_STATE_PATH=<wharfie-data>/applications/<appId>/state/application-state
Environment=WHARFIE_LEDGER_SERVICE_SESSION_PATH=<wharfie-data>/applications/<appId>/state/control/ledger-service-sessions
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=45s
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
```

The rendered unit uses systemd argument semantics directly; Wharfie never
constructs a shell command. The installer does not persist credentials or
caller-supplied environment values. Runtime dispatch arguments and the local
payload-store identity are explicitly reset so ambient user-manager values
cannot redirect the resident bootstrap. Other ambient environment remains an
operating-system property, and authored code runs with the invoking user's
ordinary authority. A future deployment/runtime-identity contract may narrow
that authority, but this user-service slice does not pretend to provide that
isolation.

The explicit LMDB control, payload, application-state, and logical session
paths remain stable across service restarts, artifact reinstallation, and
uninstallation/reinstallation. They do not depend on the service process's
working directory or on mutable ambient path defaults. The process working
directory is the private `state/` root.

### Systemd liveness and ledger readiness remain distinct

Systemd owns process start, stop, signal delivery, failure restart, boot
activation, and journal capture. Wharfie does not add an intermediate daemon,
PID file, watchdog process, or second restart loop.

The existing ledger-service lifecycle and ownership records remain the durable
authority for resident generation, revision binding, readiness, stopping, and
same-principal exclusion. A systemd unit being `active` proves only that its
process is running; it does not replace the ledger's `STARTING`, `READY`,
`STOPPING`, or `STOPPED` state. Conversely, a retained durable `READY` record
does not prove that systemd still has a live process.

`service status` combines a bounded set of machine-readable `systemctl --user
show` properties with the verified durable lifecycle and ownership view. The
session endpoint returns a bounded process-identity frame. Status reports
healthy only when the rehashed installed selection and fixed unit are intact,
lingering and the unit's enablement still establish boot configuration,
systemd is running a positive `MainPID`, that exact PID owns the live current
session, and its durable generation is `READY` for the installed revision.
Mismatch, missing state, startup, stopped state, and failed state remain
distinguishable. JSON output is versioned, contains no application inputs,
payloads, credentials, raw environment, private socket paths, or systemd
journal text, and does not parse the human `systemctl status` rendering.
Status schema V2 also joins durable installation intent with the immutable
executable selection, fixed unit's verified bytes, and live manager's effective
selection in a `wiring` view. Its state is `managed`, `absent`, `orphaned`,
`conflicting`, or `unknown`, and its redacted `selection` field distinguishes
an exact selected release from absence or conflicting metadata;
`orphaned` means Wharfie can see exact residual wiring without a live installed
receipt, while `unknown` means the manager could not establish absence. Human
status includes this state and directs an orphan to `service uninstall`.

### Uninstall preserves durable data

Uninstall stops and disables the user unit, durably records that prerequisite,
removes the unit and executable selector, reloads the user manager, and retains
an `uninstalled` identity tombstone whenever a receipt or verified release
identity exists. It deliberately does not delete or rewrite a settled
activation record: the exact selection, rollback candidate, record version,
selection generation, `ACTIVE` phase, and same-revision run admission remain
durable while no resident is installed. Commands may therefore queue work for
that revision while the service is absent.

Running `service install` from the same selected SEA rehydrates the receipt,
selector, fixed unit, enablement, and resident without incrementing activation
record version or selection generation. The tombstone is also narrow authority
for `service install` or `service update` from a different SEA to reproject the
exact retained source, prove it healthy, and then enter the ordinary durable
update under the same operation lock. `service install` from that different SEA
is treated as an update. This path never changes selection without the ordinary
durable barrier. If projection state disappears without the tombstone, the new
SEA fails closed and the exact selected SEA must run `service install` to repair
it. A physical repair interrupted before any activation transition leaves
durable state `ACTIVE` and is resumed with `service install` from that selected
SEA, not `service recover`.

A wiring-only orphan without either identity is removed
without inventing a tombstone only when the app root contains no managed data;
otherwise cleanup refuses rather than let a later artifact bypass the deferred
update fence. A standalone private phase marker binds the
exact layout, deterministic unit digest, principal, receipt state, and optional
release identity so retries can resume after interruption even when the
receipt is absent. A retry restores the deterministic unit only when a receipt
or marker authorizes cached exact manager state, then reconverges through
disable-and-stop before removing the wiring again. That authority decision
happens before `daemon-reload`: an authorized missing file is restored first so
a still-running cached service remains addressable, while a cached-only orphan
without receipt or marker is refused without erasing manager evidence. Under
the operation lock, a private regular temp left by an interrupted atomic marker
publication is recognized as reserved Wharfie residue, removed, and retried;
every other app-root entry remains potential durable application data.

`service uninstall` is therefore the explicit orphan reconciler and returns
`outcome: orphan-reconciled` when no installed receipt remained. It mutates a
unit name only after verifying the fixed unit bytes, a fresh exact effective
fragment with no drop-ins, and the absence of another same-name file anywhere
in the manager's search path. Cached-only bytes without receipt or marker,
conflicting content, foreign fragments, and lower-priority claims fail closed.
After removal and reload, a newly exposed unit also leaves the marker in place
and reports incomplete cleanup. The complete `state/` subtree and immutable
releases remain untouched. Absence of a unit is never authority to delete
control history, payloads, application state, or session namespace.
Its result reports the retained state root so a human can make a separate,
explicit backup or deletion decision. Reinstallation of the same application
identity reattaches to that state and must fail closed if its durable schemas
or revision rules are incompatible.

## Consequences

- A packaged application can be configured as a boot-persistent resident
  without Node, containers, a root daemon, or a second Wharfie supervisor. A
  disposable Ubuntu VM proof now verifies the installed tarball and three SEAs
  across process death, an abrupt machine stop/start with a changed kernel boot
  ID, all five post-commit update and rollback boundaries, and all five source
  restoration boundaries after a clean target exit.
- Service and interactive operators share the same UID, matching the current
  authenticated local-owner protocol without widening private socket access.
- UID 0 and mismatched real/effective UIDs are rejected; this slice never turns
  authored application code into a root user service.
- Running as the invoking user also means authored activity code has that
  user's filesystem access and may observe ambient user-manager environment.
  This is a trusted single-user boundary, not application sandboxing or a
  narrowly scoped cloud runtime identity.
- Hosts without systemd user managers or pre-enabled lingering cannot claim
  this service mode. macOS, Windows, system units, dedicated service accounts,
  and cross-principal administration require separate decisions.
- `Restart=on-failure` can replace a failed process, while durable ledger
  recovery still decides what work is safe to resume. Systemd restart never
  turns ambiguous begun activity into safe replay.
- Journald owns process stdout/stderr retention for this slice. A stable public
  logs protocol remains future work.
- Uninstall is intentionally not destroy. Durable data survives until an
  explicit future data-destruction contract or direct operator action removes
  it.
- Install verifies the live manager's exact unit search path before staging
  service state and verifies the loaded effective fragment, empty drop-ins,
  and a non-stale manager cache before enablement. Stop and uninstall enforce
  the same effective-unit boundary, so observed foreign manager configuration
  is refused rather than used for a destructive lifecycle command. The trusted
  same-UID concurrency limitation above still applies.
- Update and rollback are conservative stop-the-world changes. They refuse any
  nonterminal durable run and retain only one rollback candidate; staged,
  canary, or in-flight multi-revision evolution remains future work.

## Testing expectations

Ordinary repository tests must not install a real unit, change lingering, or
mutate the developer/CI host's user manager. The implementation separates
filesystem planning, artifact verification, unit rendering, process execution,
and systemd observation behind injected boundaries so tests can use:

- a temporary synthetic account-home root for release, link, receipt, unit, and
  preserved-state behavior;
- fake `loginctl` and `systemctl --user` runners that assert exact argv arrays,
  exit handling, bounded `show` properties, and the absence of shell use;
- injected UID, clock, operation-lock, and failure points around artifact
  publication, link replacement, unit publication, enable/start, stop,
  disable, and daemon reload;
- pure contract, manager, and packaged-command tests for convergence, identity
  mismatch, disabled lingering, adversarial filesystem entries, redacted JSON,
  preservation of `state/` on uninstall, admission fencing, quiescence races,
  target failure restoration, and recovery at every durable activation phase;
  and
- a real child-process resident using temporary explicit LMDB paths to prove
  `SIGTERM` drain, systemd-like failure restart, generation takeover, and
  durable work recovery without registering a host unit.

A real startup-on-boot and machine-reboot proof runs only in a disposable Linux
VM or equivalent ephemeral systemd environment where enabling linger, writing
the user unit, and rebooting cannot affect a contributor's host. The pinned
Lima proof is available through `npm run verify:service:systemd:lima`; it is an
explicit heavyweight validation and is not part of the default local test
suite. Its proof contract and checksummed receipts are recorded in the
[systemd reboot-proof checkpoint](../../../llm/checkpoints/2026-07-20-v16-systemd-reboot-proof.md).
Focused coordinator and packaged-manager tests cover update, rollback, source
restoration, first-install compatibility, durable phase recovery, and
uninstall/reinstall retention. A disposable-host two-release activation matrix
is still required; the current handoff is the [recoverable activation
checkpoint](../../../llm/checkpoints/2026-07-20-v17-recoverable-systemd-activation.md).
