# Application-state snapshot transport checkpoint

- **Date:** 2026-08-31
- **Status:** **INTERNAL COLD-CHECKPOINT TRANSPORT COMPLETE; PRODUCT GATES CLOSED**
- **Branch:** `agent/application-state-transport`
- **Source base:** `916a8f7`
- **Decision:** [ADR 0041](../../docs/architecture/decisions/0041-sealed-lmdb-application-state-snapshot-transport.md)

## Restart summary

This slice fills ADR 0040's application-state-byte gap without claiming an
atomic transaction across the execution ledger and LMDB. Receipt version 2 now
pins one immutable `lmdb-data-mdb-v1` snapshot to the exact destination,
transfer, settled application-state history checkpoint, closed source barrier,
source authority, distribution, byte size, and digest.

Publication writes an embedded checkpoint marker and durably seals the whole
physical application-state store before opening its bounded `data.mdb`. The
provider publication call is not accepted as evidence: an independent exact
readback and final authority-and-barrier-fenced central publication record are
both required. The source remains unwritable after publication unless it is the
centrally selected retained replica whose exact activation removes the seal; an
unselected predecessor remains sealed.

Replacement either validates the exact retained image or hydrates only when the
target `lmdb` directory is truly absent. Hydration privately stages and
synchronizes `data.mdb` and snapshot-scoped evidence, durably claims the store
root, creates `lmdb` exclusively, and hard-links data before the evidence link
logically commits hydration. Before local authority adoption, one central
create-or-exact-replay activation binds the exact transport,
current `CLOSED` replacement barrier and authority, domain-separated `wasr1`
physical replica, and `RETAINED` or `HYDRATED` status.

The internal wrapper composes transport after history reconstruction and before
ordinary application-state readiness. It reopens admission only after exact
transport readiness, exact `ADOPTED` destination readiness, and repeated strong
authority checks. There is still no production resident call site.

## Implemented pieces

- `application-state-history-checkpoint.js` inventories canonical complete
  application-state effects and successor authorizations and rejects unsettled
  `PENDING`, `STARTED`, or `UNCERTAIN` effects.
- `application-state-snapshot.js` defines the checkpoint marker, immutable
  snapshot reference and transport identities, bounded byte verification, and
  receipt-linked normalization.
- `application-state-snapshot-distribution.js` provides the provider-neutral
  immutable publication/read port and requires exact independent readback.
- `application-state-snapshot-control.js` retains final publication evidence
  and one exact physical-replica activation in the central transaction domain.
- `application-state-snapshot-lmdb.js` owns source sealing, bounded physical
  capture, retained-image verification, true-absence hydration, physical
  replica identity, local activation, bounded child-process inspection of
  changed active LMDB bytes, and exact transport readiness.
- The application-state table fences every ordinary write on absence of the
  physical-store retirement row. Reactivation removes that seal only on the
  centrally selected replica while atomically adopting destination authority
  and retaining local activation evidence.
- Resident replacement-input schema version 2 and the internal execution-ledger
  wrapper carry and validate the exact snapshot transport before readiness and
  admission reopen.

## Safety invariants

1. Snapshot bytes are not opened until the exact source authority, durable
   `CLOSED` barrier, settled history checkpoint, marker, and physical-store seal
   are retained.
2. Because the artifact is the complete `data.mdb`, the retirement key is
   physical-store-scoped: every ordinary namespace writer sharing that file is
   fenced. Deployments should still dedicate one LMDB application-state root to
   one application.
3. History, authority, and barrier are reread after byte capture. Any movement
   rejects publication before final central evidence.
4. Provider success is never inferred from a return value. The exact immutable
   object must read back with the receipt-pinned identity, size, and digest.
5. Only true absence permits hydration. Existing empty, malformed, symbolic,
   substituted, truncated, or corrupt targets fail closed without fallback.
6. A durable exact root claim and exclusive `lmdb` creation prevent target
   replacement. The owner hard-links data first; only the synchronized,
   snapshot-scoped evidence link commits `HYDRATED`. Evidence for an older
   snapshot cannot classify a later snapshot. An exact retry may complete the
   directory syncs and release the verified claim after the evidence link.
7. One exact central activation claim selects the writable physical replica.
   Replica, status, transport, replacement authority, and exact current closed
   barrier substitution fail before local activation.
8. Any transport, readiness, barrier, or authority failure before reopen leaves
   fresh admissions closed and does not invoke the resident handler.

## Validation status

Focused suites cover history settlement, strict snapshot/control records,
immutable distribution and readback, source-seal ordering and races, retained
and hydrated activation, interruption phases, concurrent hydration, replica
selection, receipt substitution, and wrapper sequencing. The stable
`test:replacement-input` script includes all four new application-state
snapshot suites.

Observed non-release validation on Node `24.13.1`:

- `npm run test:replacement-input`: 12 suites and 291 tests passed.
- The focused native LMDB snapshot suite: 37 tests passed.
- The readiness-handoff suite after the final replay-fence assertion revision:
  1 suite and 15 tests passed.
- ESLint, Prettier, and all four TypeScript projects passed. `git diff --check`
  was clean.
- One complete coverage traversal reached 353 of 354 suites (one skipped) and
  8,081 tests: 8,073 passed, 5 skipped, and only three stale readiness replay
  assertions failed. Those assertions counted a condition-only retirement
  fence as a mutation; after correcting them, all 15 readiness-handoff tests
  passed and an independent test review found no accidental-pass path.
- A repeated coverage attempt on a host with load averages above 9 produced
  unrelated five-second timeouts and resource exhaustion in previously passing
  suites. Every reported case was rerun by exact name at low concurrency: 5
  suites passed, with 9 selected tests passed and 280 unselected tests skipped
  in 30.196 seconds. No timeout policy was changed in this feature slice.
- `npm run verify:package` verified 382 files in the package tarball.
  `npm run verify:provider-boundary` reported `providerBoundary: ok`, 158
  provider-free dependency packages against a 170-package budget, and zero
  provider SDK graph inputs. `npm run audit:prod` found zero vulnerabilities.

The pull-request workflow is the authoritative clean-host merge gate. It runs
the complete `test:ci` chain plus preview-contract, packed-install, real Linux
SEA, magnetic-first-run, and preview-consumer verification. It does not publish
or activate a release.

## Honest boundary

- This is a deliberately quiesced cold checkpoint across separate transaction
  domains, not arbitrary crash-time consistency, continuous replication,
  multi-writer application state, or physical exactly-once execution.
- If the sealed snapshot and every valid physical copy are lost, this mechanism
  cannot manufacture recovery evidence.
- The provider-neutral distribution port is not a production provider adapter,
  credential contract, enrollment credential, or node-placement authority.
- A central physical-replica claim is not trusted-node enrollment or revision
  authorization. Those remain prerequisites for product activation.
- Deterministic interruption coverage is not a real process-kill, machine-loss,
  or two-node recovery proof.
- The wrapper remains internal. No resident/DynamoDB product gate was opened.
- No deployment, provider activation, package publication, promotion, release,
  merge, or tag-triggered workflow is part of this slice.

## Next handoff

Complete real process-kill and machine-loss coverage, trusted-node and revision
authorization, capability placement, and one bounded two-node recovery proof
before considering a production resident call site or public DynamoDB gate.
