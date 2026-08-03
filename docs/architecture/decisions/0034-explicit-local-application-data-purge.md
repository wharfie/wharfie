# 0034 — Explicit local application-data purge

**Status:** Accepted

## Context

Systemd service uninstall is intentionally reversible. It removes resident
wiring while preserving the selected and rollback releases, execution ledger,
payloads, and application state. Release pruning is also nondestructive with
respect to selected authority and durable work.

The single-host developer preview needs a distinct final cleanup operation.
Deleting account data paths by hand is too easy to aim at the wrong
application, while making uninstall destructive would erase the state needed
for recovery and reinstall.

## Decision

A packaged application exposes:

```bash
<app> wharfie service purge --confirm-data-loss <app-id>
```

The confirmation value must exactly equal the application ID embedded in the
invoking SEA. Confirmation is required on every attempt, including retries and
an already-absent result.

Purge never performs uninstall. Before deleting data it holds the existing
app-scoped service-operation lock and proves:

- the fixed unit, enablement link, and effective systemd unit are absent;
- the installation receipt is coherently `uninstalled`;
- no uninstall marker or executable selector remains;
- activation is absent or settled `ACTIVE`, never in transition;
- the local resident/manual owner is absent or definitively stopped;
- every durable run is terminal; and
- the data root, applications root, app root, state root, and releases root are
  owned real directories at their derived locations.

The only deletion boundary is:

```text
<stable-data-root>/applications/<app-id>
```

The invoking SEA, shared data/config directories, systemd directories, and
sibling applications are outside that boundary.

Before isolation, Wharfie writes and synchronizes a private marker inside the
app root. It then renames the exact app root to a deterministic direct-child
tombstone, compares filesystem identity across the rename, and synchronizes
the applications directory. Removal never follows symbolic links, refuses
foreign-owned or cross-filesystem concrete descendants, and keeps the marker
until every other supported top-level entry is gone. A retry may resume only
an exact marker-authenticated tombstone.

The schema-version 1 `wharfie.service.result` outcome is `purged` when an app
root or authenticated retry tombstone was removed and `already-purged` when
both were already absent. Both outcomes independently require external
systemd-wiring absence.

Purge is serialized with service lifecycle operations. The developer-preview
contract also requires that the operator not invoke another ordinary command
from the same SEA concurrently with purge. Ordinary run admission does not
currently share the service-operation lock, so this implementation performs a
second owner/quiescence check immediately before rename but does not claim a
cross-command admission fence. A future stronger boundary requires a sibling
sentinel checked by every packaged storage writer and a durable
admission-closing transition that survives app-root isolation.

## Consequences

- Uninstall remains reversible and safe by default.
- Complete local cleanup is explicit, typed, app-scoped, retryable, and
  independently testable.
- Corrupt, ambiguous, active, or nonquiescent state fails closed rather than
  broadening deletion authority.
- Purge is not secure erasure and does not remove external handoff artifacts,
  remote resources, provider state, or shared account directories.
- The preview has an honest concurrency limit instead of claiming that an
  operation lock covers ordinary packaged commands when it does not.
