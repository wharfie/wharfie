# 0029 — Explicit bounded local release pruning

**Status:** Accepted · **Date:** 2026-07-27

## Context

Packaged Linux applications retain immutable content-addressed releases beneath
their app-scoped systemd user-service root. Update keeps the selected release
and one rollback candidate, while older releases remain as verified local
copies. Uninstall is intentionally state-preserving and also retains those
releases.

Unbounded retention eventually wastes local disk, but deleting a release is
more dangerous than deleting an ordinary cache entry. Durable activation,
installation receipts, the `current` selector, and a live resident must agree
on the executable bytes that can run or be restored. A crash during recursive
deletion must not leave a partially removed directory in the canonical
content-addressed namespace. A hard kill during release staging can likewise
leave a private temporary directory that must be distinguished from
caller-created or malformed content before deletion. An ambiguous command
response must not be described as exactly-once display.

This decision covers only the immutable releases and authenticated publication
or deletion residue inside one local packaged systemd user-service release
namespace. It does not define general application-revision or
content-addressed-payload garbage collection.

## Decision

### Pruning is an explicit packaged operation

The packaged operator exposes:

```sh
<selected-app> wharfie service prune
```

Canonical release pruning never runs as part of install, converge, update,
rollback, recovery, start, stop, restart, status, or uninstall. Ordinary
release staging does perform the narrower recovery step of removing
authenticated unpublished stage residue before it publishes new bytes; the
explicit prune command can perform the same cleanup and report it. The invoking
executable's observed artifact bytes and embedded revision must exactly match
the durable selected release before explicit pruning. A stale release, rollback
candidate, desired future artifact, or unrelated copy cannot request canonical
deletion.

The operation holds the existing app- and UID-scoped kernel operation lock
from its first durable and physical observations through namespace preflight,
deletion, and final verification.

### Only a settled coherent projection is eligible

The durable local activation record must exist, be in `ACTIVE`, and have an
exact selected release. No activation transition may be in flight. The
installation receipt must exist, its full current and previous release records
must exactly project the activation's selected and rollback references, and
every protected immutable release must pass record and byte verification. An
uninstall convergence marker refuses pruning.

Both intentional physical states are supported:

- an `installed` receipt requires the exact selected/rollback projection,
  verified `current` selector, fixed unit and manager wiring, and coherent
  resident ownership; or
- an `uninstalled` receipt requires managed retained state but no selector,
  unit file, loaded unit, active process, pending manager reload, or other live
  service projection.

Unknown, unavailable, orphaned, contradictory, or partially repaired state
fails closed. A stopped or failed installed service is not excluded merely for
being unhealthy, but its identities and physical ownership must still be
coherent.

An in-flight activation directs the operator to `service recover`. A missing
activation cannot be recovered by that command because there is no durable
transition to resume; the operator must instead retry `service install` or
`service converge` from the exact selected SEA. Pruning does not infer or
create activation authority from physical residue.

Because `ACTIVE` equates desired and selected and contains no transition, the
only retained release set is:

- the selected release; and
- the one rollback candidate, when present.

The installed or uninstalled receipt must name that same set. Runtime and
systemd observations are coherence checks; they cannot introduce an
unexplained third release and authorize pruning around it.

### The complete namespace is bounded and preflighted

Before the first mutation, Wharfie performs one complete deterministic census
of the release root. The root may contain at most 128 entries in total,
including recognized interrupted-prune tombstones and authenticated
interrupted-staging directories. The sum of logical artifact byte lengths
represented by canonical releases and prune tombstones may not exceed 64 GiB.
Unpublished staging residue can be partial and therefore has no trusted logical
artifact length; it occupies bounded entry slots and is removed before a new
artifact's length is reserved.

Every canonical entry must be an artifact-ID-named real directory owned by the
service user. It must contain exactly the single-link regular files `app` and
`release.json`. Its strict receipt, canonical path, application, revision,
target, digest, size, and executable bytes must all verify. Every recovery
entry must use either the deterministic schema-v1 prune-tombstone name or the
exact private staging-name grammar and one of the supported partial states
described below. Unknown names, symlinks, extra children, invalid canonical or
tombstone receipts, changed canonical bytes, ownership or boundary conflicts,
unsupported recovery states, and bound overflow abort the whole operation
before any recovery entry or canonical release is removed.

A historical unprotected release may retain a different valid packaged build
target from the invoking SEA. Its own sealed receipt and bytes must agree; only
the selected/rollback projection and reuse of an existing artifact ID are
required to match the invoking target. This permits a target-changing reinstall
to prune the now-unreferenced prior-target copy without treating it as current
authority.

Artifact identities must be globally unique across canonical release
directories and prune tombstones. The same artifact cannot be counted once as
retained authority and again as deletion residue.

Canonical entries are considered in sorted name order. Every unprotected
candidate is fully reverified against its preflight record immediately before
its rename.

Release staging enforces both bounds before publication. After a bounded census
and authenticated cleanup of prior stage temporaries, it accounts for every
existing canonical release and prune tombstone, reserves the temporary
directory entry required by a new publication, and includes the prospective
artifact's logical byte length. Staging refuses before copying new bytes when
publication would exceed either 128 entries or 64 GiB. It directs the operator
to the explicit prune boundary rather than silently collecting canonical
releases or exceeding the collector's finite namespace.

### Interrupted staging is authenticated before recovery

A staging directory is recoverable only when its basename exactly matches
Wharfie's private `.<artifactId>.<publication-token>.tmp` grammar. The artifact
identity and bounded publication token are parsed rather than accepted as an
arbitrary path. The directory must be a real, private, service-user-owned
direct child of the release root and may contain only the finite `app` and
`release.json` staging entries.

Any present child must be a real, service-user-owned, single-link regular file.
The private parent is the authentication boundary: `app` may be partially
copied or retain source-derived mode bits if the process died before chmod, and
`release.json` may be partially written. Those bytes are deliberately not
parsed, hashed, trusted, or promoted. The accepted shapes are the two named
children, `app` alone before receipt publication or after recovery removed that
receipt, and the empty directory after recovery removed the app. A receipt
without `app` is invalid because no supported write or cleanup order can
produce it. Malformed names, non-private directories, links, foreign ownership,
unsupported children, and every other partial shape fail the whole preflight.

After the complete namespace has passed preflight, both ordinary release
staging and explicit `service prune` remove each authenticated staging
directory in the fixed crash-safe order `release.json`, `app`, then the empty
directory, synchronizing the temporary directory after each child and the
release root after removing the directory. That order makes `app`-only and
empty the sole recovery partial states. A stage temporary never grants
activation or rollback authority and is never promoted by prune. Its sole
authority is bounded cleanup of an interrupted unpublished copy. A prune
receipt reports each cleanup performed by that invocation through
`recoveredStagingCount`; staging cleanup is an internal convergence step and
does not increment a later prune receipt.

### Deletion is rename-first and precisely recoverable

A canonical release directory is never recursively removed in place. For each
verified candidate Wharfie:

1. derives a deterministic same-directory tombstone name from the exact
   artifact ID, revision ID, and logical artifact byte length;
2. atomically renames the canonical directory to that tombstone and
   synchronizes the release root;
3. removes `app` and synchronizes the tombstone directory;
4. removes `release.json` and synchronizes the tombstone directory;
5. removes the now-empty tombstone directory; and
6. synchronizes the release root again.

The only recoverable tombstone contents are the complete verified two-file
release, `release.json` alone after `app` was durably removed, or an empty
directory after the receipt was durably removed. An `app` without its receipt,
an extra child, a mismatched deterministic name, or an invalid remaining
receipt fails closed.

A retry first preflights the entire namespace, completes authenticated staging
residue and prune tombstones in their respective fixed deletion orders, and
only then prunes new candidates. A crash before rename leaves the canonical
release intact. A crash after rename can leave only the strict tombstone states
above, never a partially deleted canonical release. A crash during
stage-residue cleanup leaves only authenticated `app`-only or empty state.
After all work, a second complete census must contain exactly the selected and
optional rollback releases, with no staging residue or prune tombstones.

### The schema-v1 receipt reports a bounded result

Success returns a strict recursively frozen JSON receipt with kind
`wharfie.service.release-prune`, `schemaVersion: 1`, action `prune`, and request
status `fulfilled`. It reports:

- the application and installed/uninstalled projection state;
- the exact selected and optional rollback references;
- scanned, retained, remaining, removed, resumed-prune, and
  `recoveredStagingCount` counts;
- a uniquely sorted allowlisted list of removed artifact/revision identities
  and their logical artifact byte lengths; and
- the summed removed artifact bytes.

The receipt exposes no filesystem paths, host identity, durable-store
coordinates, payloads, credentials, or private status snapshot. Its outcome is
`pruned` when it removed a canonical release or completed an interrupted
prune tombstone or authenticated staging directory, otherwise
`nothing-to-prune`.

Retry is convergent, not an exactly-once display protocol. If a response is
lost after deletion completed, the next invocation safely returns the current
`nothing-to-prune` state rather than reproducing the lost receipt. An
interruption after rename is reported as safe to retry; its eventual receipt
counts the recovered prune tombstone or staging directory but does not invent
a newly removed canonical release for the retry.

## Consequences

- Operators can bound retained local release copies without weakening the
  selected executable or one-step rollback contract.
- Intentional uninstall remains data-preserving. Pruning is a separate
  explicit action and still retains the selected and rollback releases needed
  for reinstall, update, and rollback.
- A malformed or unexpectedly large namespace can block staging and pruning
  until an operator investigates it. This is preferable to treating unknown
  bytes as disposable.
- A hard-killed stage no longer leaves a name-shaped directory that can be
  either trusted blindly or recovered only through manual recursive deletion.
  A later staging attempt or explicit prune authenticates and removes the
  finite residue; prune reports cleanup it performs.
- The same operation lock prevents install, converge, update, rollback,
  recovery, lifecycle mutation, uninstall, or another prune from changing the
  protected set during deletion.
- Hermetic filesystem, manager, and command tests cover the contract. This
  decision adds no claim that pruning has run on a real systemd host.

## Non-goals

- automatic, timer-driven, quota-driven, or uninstall-triggered pruning;
- garbage collection of application revisions, execution payloads, run or log
  history, schedules, deployment artifacts, provider objects, native runtime
  extractions, or remote host state;
- retaining more than the one rollback candidate already authorized by local
  activation;
- staged rollout, canary release retention, or multi-revision live execution;
- data destruction outside canonical local service releases and their
  authenticated staging or prune-recovery entries;
- exactly-once stdout delivery or replay of a lost receipt; and
- native SEA or disposable-real-host proof for this pruning slice.

## Rejected alternatives

### Prune automatically during update or uninstall

Rejected because it couples a destructive retention decision to operations
whose existing contracts preserve recovery state. An explicit command gives
the operator a reviewable boundary and keeps uninstall non-destructive.

### Keep only the selected release

Rejected because the durable activation contract promises one rollback
candidate. Removing it would make the receipt and activation state claim a
recovery path whose bytes no longer exist.

### Recursively remove canonical release directories

Rejected because a crash can leave a malformed directory under the canonical
artifact ID. Future staging would then encounter an ambiguous partial release
rather than either an intact release or an authenticated deletion residue.

### Delete valid candidates as they are discovered

Rejected because a later malformed or over-limit entry would be learned only
after earlier releases were already removed. Full bounded preflight makes
namespace acceptance an all-or-nothing decision before mutation begins.

### Treat every staging temporary as disposable

Rejected because a same-UID name alone is not enough reason for recursive
deletion. Recovery verifies the fixed name, private owned directory boundary,
and finite owned single-link child shape before removing only the two fixed
child names in a crash-safe order. It never treats partial staged bytes or a
partial receipt as release authority.

### Persist and replay the exact prior receipt

Rejected for this slice. Deterministic tombstones make filesystem convergence
safe, while exact response replay would require another durable operation
journal and atomicity contract. The public result therefore states current
convergence honestly.
