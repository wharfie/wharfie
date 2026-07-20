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

`install` publishes the release and fixed unit, reloads the user manager, and
uses `enable --now` so the successful result means both boot-enabled and
started. `start`, `stop`, and `restart` delegate process lifecycle to systemd.
`stop` does not disable boot startup. `uninstall` uses `disable --now`, removes
the unit and installed executable selection, reloads the user manager, and
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

The layout uses Wharfie's existing `env-paths` data root (the current Linux
default is below `$XDG_DATA_HOME/wharfie-nodejs`, or
`$HOME/.local/share/wharfie-nodejs` when that variable is absent):

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
release, current link, fixed unit, and installation receipt; it never edits an
artifact in place.

Installing a different artifact over an existing installation is refused.
Although the release layout and atomic link are suitable primitives for later
evolution, public update and rollback are explicitly deferred. Runs are pinned
to revisions, offline operator commands can create work while a service is
stopped, and a stop/scan/symlink/start sequence therefore has a quiescence
race. Update and rollback require a race-free maintenance barrier and an exact
handoff between the old resident, durable work state, executable selection,
and the new resident before either command can be offered.

Lifecycle mutations are serialized with a per-UID, per-installation abstract
Linux Unix socket. Kernel bind is the cross-process exclusion primitive and
the address disappears automatically when the process exits, avoiding stale
lock deletion, PID reuse, and concurrent stale-recovery races.

### Fixed unit and stable durable paths

Wharfie renders one versioned, fixed unit template. Callers cannot supply
arbitrary unit sections, dependencies, commands, environment variables,
environment files, credentials, or restart settings. The template starts only
the installed `current/app` with the existing hidden bootstrap:

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

### Uninstall preserves durable data

Uninstall stops and disables the user unit, durably records that prerequisite,
removes the unit and executable selector, reloads the user manager, and retains
an `uninstalled` identity tombstone. A private phase marker lets retries resume
after interruption. A retry restores the deterministic unit if an earlier
attempt removed it, then reconverges through disable-and-stop before removing
the wiring again. The complete `state/` subtree and immutable releases remain
untouched. It never interprets absence of a unit as authority to delete control
history, payloads, application state, or session namespace.
Its result reports the retained state root so a human can make a separate,
explicit backup or deletion decision. Reinstallation of the same application
identity reattaches to that state and must fail closed if its durable schemas
or revision rules are incompatible.

## Consequences

- A packaged application can be configured as a boot-persistent resident
  without Node, containers, a root daemon, or a second Wharfie supervisor. A
  disposable Ubuntu VM proof now verifies the installed tarball and SEA across
  process death and an abrupt machine stop/start with a changed kernel boot ID.
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
  the same effective-unit boundary, so manager configuration cannot redirect a
  destructive lifecycle command.
- Update and rollback remain unavailable even though releases are immutable.
  Atomic byte selection is not sufficient without a race-free maintenance and
  quiescence protocol for revision-pinned durable work.

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
  and preservation of `state/` on uninstall; and
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
