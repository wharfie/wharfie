# Wharfie checkpoint — source-independent ledger operations

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Base:** `10c82a6` (`Route manual ops through execution ledger`)
- **Scope:** complete the first manual ledger slice's operator boundary without
  pretending legacy mutable OperationsStore commands can observe ledger runs.

This follows [the ledger-backed `ops run` handoff](2026-07-17-ledger-backed-ops-run.md).
Keep both checkpoints: this record narrows the operator contract without
claiming resident execution, scheduling, cancellation, leases, or mesh
coordination.

## What changed

- `wharfie ops inspect --run-id <run-id>` reads one exact ledger partition with
  `rebuildRun`, which folds events and verifies receipts, head, and
  projections before exposing a view. It never loads `wharfie.app.js`.
- `wharfie ops recover --run-id <run-id> --confirm-runner-stopped` is the only
  operator recovery command. It also never loads source or dispatches code.
  The confirmation is a required acknowledgement that every prior runner has
  stopped; it is not a lease.
- A `CLAIMED` current attempt may be released back to `RUNNABLE`; a `STARTED`
  current attempt becomes `UNCERTAIN` / run `BLOCKED`. Terminal, blocked, and
  already runnable runs are read-only recoveries. Missing runs fail closed and
  never create work.
- If a claimed attempt crosses the durable `STARTED` boundary while recovery
  is releasing it, recovery rereads that exact attempt and marks it uncertain
  in the same command. It never mutates a newer generation.
- `--json` emits a compact redacted operator view with stable
  `schemaVersion: 1`, lifecycle identities/statuses, and sanitized event
  history. It deliberately omits inputs, caller metadata, terminal results,
  evidence, event payloads, and fencing tokens pending an explicit disclosure
  policy.
- `ops run` no longer has a source-bound `--recover` path. It only makes an
  execution decision; recovery is a separate source-free operator action.
- Removed CLI-only `ops list` and `ops cancel`, their OperationsStore wrapper,
  and operation-row formatting. They could not observe or affect ledger-backed
  runs. Core OperationsStore remains only for unported legacy Lambda/graph
  paths and is not part of the new `ops` surface.

## Important limits

- There is no global/app-wide ledger list. The portable DB contract requires
  exact primary-key lookup and the ledger is partitioned only by opaque
  `run_id`. A real list/history command needs an atomically maintained,
  paginated run-directory index; do not add a scan-based substitute.
- There is no durable cancellation request/decision transition. Do not restore
  an `ops cancel` command until it can bind cancellation to a persisted state
  machine and activity protocol boundary.
- Recovery is an operator assertion, not ownership. A resident coordinator,
  leases, heartbeats, and fencing remain required before unattended recovery.
- This first ledger covers a single manual invocation. It is not an
  exactly-once claim for unmanaged external effects; only destination-side
  atomic deduplication can provide that guarantee.

## Verification at this handoff

- `npm run lint`
- `npm run typecheck`
- Focused ledger/operator suite, including source-free child-process recovery,
  terminal-evidence redaction, missing-run and missing-confirmation failures,
  repeated recovery, legacy-command removal, `CLAIMED` → `STARTED` recovery
  races, and DynamoDB/vanilla ledger contract validation. The LMDB contract
  is excluded in this sandbox because its native path aborts (exit 134).

## Next work

1. Add a durable local resident-service lifecycle and ownership rule before
   automatic recovery.
2. Move payloads/results/logs to immutable content-addressed references.
3. Design an atomic run directory before any global history/list command.
4. Design cancellation, reconciliation, and compensation before reintroducing
   cancellation.
