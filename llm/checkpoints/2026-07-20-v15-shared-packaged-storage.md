# Wharfie checkpoint — shared packaged application storage

- **Date:** 2026-07-20
- **Status:** **PACKAGED/RESIDENT SPLIT-LEDGER BUG FIXED — real Linux reboot proof remains in flight**
- **Branch:** `agent/strict-manifest`
- **Implementation receipt:** `b5a5063e`
- **Parent checkpoint:** [packaged systemd user-service foundation](2026-07-20-v14-systemd-user-service-foundation.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR
  0020](../../docs/architecture/decisions/0020-systemd-user-service-lifecycle.md)

The systemd foundation originally put its resident ledger below
`<data>/services/<appId>/state`, while ordinary packaged `start`, `submit`,
`signal`, `inspect`, and other operators still used the old global
`<data>/control` defaults. A successful install could therefore supervise one
empty ledger while interactive commands wrote another. Existing SEA matrices
hid the error by supplying matching `WHARFIE_*` paths.

Implementation receipt `b5a5063e` removes that split. Every packaged process
now derives one immutable application layout from its embedded identity before
developer code, public operators, or the hidden resident runs:

```text
<wharfie-data>/applications/<appId>/
  releases/<artifactId>/
  current -> releases/<artifactId>
  installation.json
  state/
    control/
      execution-payloads/
      ledger-service-sessions/
    application-state/
```

The layout is carried through Node async context for the entire packaged
bootstrap. DB resolvers use it as the durable local default, including under
`NODE_ENV=test`, without mutating the process environment. Explicit foreground
overrides still take precedence, but every systemd service operation now
requires the packaged context and rejects an adapter, path, table, session, or
payload-store identity that would differ from the fixed resident unit. Service
installation is therefore supervision of existing app state rather than a
second storage selection.

This is intentionally a breaking v2 reset. The repository has no downstream
users, so there is no migration from the abandoned global `<data>/control` and
`<data>/application-state` defaults. Moving old payloads naively would also
change their path-derived store identity.

## Exact validation

Using Node 24.13.1/npm 11.12.0:

- all four TypeScript lanes passed: source, app implementation, tests, and SEA
  verifier;
- ESLint and Prettier passed for every changed JavaScript file;
- the storage/layout/systemd/package matrix passed 4 suites and 75 tests, with
  one Linux-only abstract-socket test skipped on macOS;
- the packaged command/runtime matrix passed 7 suites and 77 tests; and
- package-content verification accepted 144 files.

The first package-content attempt inherited Node 23.11.1 in a spawned npm
process and correctly failed the exact `devEngines` check. Re-running with the
required Node 24.13.1 directory first on `PATH` passed; this was a host-shell
selection issue, not a repository failure.

## Worktree handoff

At checkpoint creation, a separate, uncommitted draft of the disposable Linux
proof exists in these paths and must be audited rather than assumed complete:

```text
scripts/run-systemd-user-service-lima.sh
scripts/verify-systemd-user-service-linux.js
test/fixtures/apps/systemd-service/
test/systemd/
package.json
tsconfig.sea-verifier.json
```

The intended proof uses normal packaged commands with no `WHARFIE_*` storage
overrides, kills systemd's exact `MainPID`, requires a new PID and durable
generation, changes the kernel boot ID in a disposable VM, proves linger-based
startup before a login session, completes the same workflow exactly once at
the logical boundary, and verifies uninstall preserves state. Docker may be a
useful PID-1 preflight but cannot establish a real machine reboot because its
kernel boot ID does not change.

Before calling the service milestone complete, also close or explicitly record
the audit's remaining service gaps: verify systemd's effective `FragmentPath`
and absence of drop-ins, bind the shell/user-manager XDG unit location, inspect
or converge orphan units when receipts are absent/tombstoned, and bound stale
native-runtime extraction after repeated `SIGKILL` recovery.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-20-v15-shared-packaged-storage.md` on branch
> `agent/strict-manifest` at or after `b5a5063e`. Use only the local git CLI;
> do not spend time on PRs or issues. Breaking changes are fine and there are
> no downstream users, so optimize for the ideal v2 state. First inspect and
> audit the uncommitted Lima/systemd proof files listed in the checkpoint.
> Preserve useful work but do not assume it is correct. Make the proof use
> normal packaged commands with no storage redirects, then run every safe
> local check possible. Do not claim machine-reboot evidence unless the kernel
> boot ID actually changes in a disposable Linux VM. Continue to preserve the
> trusted-node, one-recoverable-coordinator, Node/TypeScript public-boundary,
> SEA portability, and evidence-backed exactly-once direction in PROJECT.md.
