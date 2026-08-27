# Application-state destination authority checkpoint

- **Date:** 2026-08-26
- **Status:** **IMPLEMENTED AND LOCALLY VALIDATED**
- **Branch:** `agent/coordinator-authority`
- **Preceding slice:** [Operator and schedule authority](2026-08-26-operator-schedule-authority.md)

## Bounded contract

Application state deliberately lives in a different physical store from the
execution ledger. A current-control-authority read cannot atomically fence a
write in that destination. This slice adds a persistent, destination-local
high-water barrier per application namespace. Its committed adoption is the
fencing boundary; control-store takeover alone is not that boundary.

The barrier pins the verified application-state store identity and the complete
stable coordinator token. An identical token is an idempotent adoption. Only a
strictly higher epoch can replace an existing token, using an exact destination
compare-and-set. Lower epochs and different tokens at the same epoch fail
closed. No clock, heartbeat, process-liveness decision, automatic takeover,
release, or reset is part of this record.

Fresh bound-store initialization atomically creates the global immutable
identity and the initial namespace barrier. An existing identity read does not
adopt authority implicitly. Explicit adoption of an existing store compares its
identity in the same destination transaction.

Every new business-value/receipt pair, already-present receipt, and permanent
not-applied resolution compares the exact destination barrier in its own
transaction. An unbound writer running this implementation instead requires
the namespace barrier to be absent in that transaction. It cannot bypass an
adopted namespace or win a delayed write after adoption.

## Runtime boundary

Writable built-in catalog construction snapshots the exact token from the
bound execution ledger and explicitly adopts it. The production seams are
foreground/resident manual activity execution, effect reconciliation, and
effect-successor retry. A missing binding fails closed. A current-control
probe before construction rejects already-known stale authority; it is only
a diagnostic read, not a distributed transaction.

Reconciliation and effect-successor retry also pass the retained destination's
expected store identity into writable catalog construction. That check precedes
bootstrap or barrier adoption, so a store replaced between read-only preflight
and writable reopening cannot receive a new barrier for the old delivery.

Normal execution still opens the application-state handle before dispatch and
initializes the catalog only after durable STARTED authorization. Read-only
operator preflight and receipt recovery neither initialize a store nor install
a barrier. Per-attempt destination handles close before their enclosing
coordinator/local-owner lifetime ends. Closing one handle does not release the
persistent barrier shared by other attempts under the same coordinator.

## Replay and cutover

The v2 logical destination, effect-contract, business-record, receipt, and
resolution formats do not acquire physical coordinator fields. Exact permanent
dispositions remain valid across epochs. An already-held old catalog can read
its exact committed result without another destination write, including after
an ambiguous response and later adoption. A newly constructed writable catalog
whose token is stale against the destination fails adoption; historical
recovery uses the read-only catalog.

Adoption readback proves only an exact token still retained at the destination.
It does not promise historical adoption receipts or restore a superseded token.
A successful effect accepted before the barrier remains committed; it is not
undone when a newer barrier arrives.

This is a cooperative new-binary cutover, not retroactive fencing of old
binaries that ignore the new row. Old writers must be stopped before adopting
an existing store. The ordering also assumes one trusted, retained
control-authority lineage. Tokens do not identify a control-store lineage, so
arbitrary foreign higher-epoch tokens are not detected by this protocol.
Rolling back either durable store, deleting the barrier, or resetting control
epochs is unsupported; no automatic migration or reset escape hatch is added.

## Validation

Validation uses the pinned Node `v24.13.1` and npm `11.12.0`:

- The destination kernel passes 68 semantic tests over vanilla and mocked
  DynamoDB. They cover atomic bootstrap, orphan-barrier refusal, monotonic
  adoption and lost-response readback, exact predecessor conflicts, both
  bound and unbound delayed writes, positive/negative replay, immutable
  request capture, namespace/store isolation, and corrupt metadata. Negative
  resolution races include absent and present-other business observations.
- Four real-LMDB tests use distinct control and application-state roots. They
  prove destination-barrier ordering, a paused old transaction losing after
  adoption, barrier persistence through writable/read-only reopen, and exact
  positive/negative result recovery after response loss and later adoption.
  They explicitly demonstrate that control takeover alone does not change
  the destination barrier.
- A combined `--detectOpenHandles` run passes 213 tests across eight affected
  suites, exits normally, and reports no retained handles. This includes
  catalog binding/pinning, production host/operator wiring, cleanup, and
  resident regressions.
- Source, application, test, and SEA-verifier typechecks pass. The final full
  ESLint and JavaScript/JSON Prettier checks also pass.
- Package-content verification passes for all 362 packed files.
- The final full-coverage run passes 317 suites and 7,159 tests; one suite
  and five tests are skipped. Coverage is 83.99% statements, 80.81% branches,
  91.37% functions, and 84.72% lines, exceeding every configured threshold.
  It exits normally in 765.226 seconds with two workers, unchanged five-second
  default test limits, and no reported open-handle or cleanup warning.
- The packaged proof's fixture writers now acquire and release fresh authority
  rather than bypass an adopted namespace. Historical batches are prepared
  before the resident starts, preserving their deliberate epoch-zero history.
  Retained writes pin their expected destination identity. A native fixture
  smoke test verifies all three writers and refusal of a live ACTIVE owner;
  71 focused proof-harness tests pass. Crash anchors remain intact.
- The full generated/relocated Darwin SEA gate passes, including real SIGKILL,
  explicit public takeover-and-release, receipt replay, destination settlement,
  and effect-successor recovery. The artifact is 155,407,664 bytes with SHA-256
  `7c0213be568a344a862fe20af7faaef1056b81a60873523ec9ff74aa21278cab`.
  The Linux-only real schedule/restart proof remains gated and was not run.

The first full coverage run completed with 316 passing suites and three
failures confined to one older successor crash-fixture suite; one suite and
five tests were skipped. Its coverage exceeded all configured thresholds, but
the run did not pass. Those fixtures still used unbound destination writers
after production reconciliation adopted their namespace. The corrected suite
passes all four real SIGKILL boundaries with fresh authority lifetimes and an
explicit known-stopped handoff that compares the complete retained child
snapshot. Both takeover and release receipts replay without changing the
released authority. The proof preserves actual authorization/executor replay
assertions, epoch-zero source history, and the child epoch on already-started
work. It also proves that control handoff leaves the destination barrier
unchanged until a fresh writable catalog adopts.

The subsequent broad run passed those crash cases but timed out seven existing
admission tests at their unchanged five-second limit. It reported 316 passing
suites and 7,152 passing tests, with coverage above every configured threshold,
but exited unsuccessfully. All 15 admission tests then passed both in an isolated
open-handle check (2.904 seconds) and an isolated coverage-instrumented run
(26.15 seconds), without changing assertions or time limits. The latter is a
diagnostic subset, not a global coverage-threshold gate. Read-only review found
no lock cycle or leaked handle; transient load or filesystem contention remains
the leading hypothesis, not a reproduced root cause. The final full run above
passed with normal thresholds and two workers, without concurrent heavy
validation jobs or any test changes. Earlier slice results are retained in the
preceding checkpoint and are not evidence for this change.

Review caught and fixed two ordering defects before handoff: an exact retained
negative resolution must win response-loss readback before stale diagnosis,
and writable operator catalogs must pin the expected store before adopting a
barrier. Both have deterministic regression coverage.

## Remaining work

- A successor does not eagerly adopt every destination before resident READY.
  Control takeover/release and destination adoption are separate commits; an
  old destination writer can still commit in the intervening window.
- End-to-end replacement needs an explicit destination-adoption/readiness
  phase and recoverable partial-handoff semantics before claiming immediate
  revocation across both stores.
- Provider-certified semantic leases, store-time expiry, automatic failover,
  replacement reconstruction, and a trusted two-node recovery proof remain
  separate work.
- Local LMDB evidence does not establish recovery after host or volume loss.
