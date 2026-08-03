# Wharfie checkpoint — ledger-v2 immutable payload references

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Published parent:** `22b8697` (`Add source-free ledger operator commands`)
- **Scope:** replace the first ledger vertical's inline request/evidence bytes
  with a strict, local immutable content boundary before adding any resident
  service or coordinator behavior.

Read this after [the source-independent operator checkpoint](2026-07-17-source-independent-ledger-ops.md).
It is a continuation, not a replacement: trusted nodes, a recoverable single
coordinator, no v1 compatibility, and destination-side-only exactly-once
claims remain the project decisions.

## What changed

- The execution ledger is now **schema v2**. Its default table is
  `wharfie-execution-ledger-v2`, its sort-key prefix is `ledger/v2/`, and its
  event, transition, attempt, and manual-run identity domains are v2. V1
  records are intentionally unsupported; there is no ambiguous migration.
- `src/core/runtime/execution-payload.js` defines a strict JSON payload
  reference: canonical compact JSON bytes, a domain-separated `wlp_...`
  identity, independent raw SHA-256 digest, exact byte size, media type,
  versioned payload schema, and a content-derived local storage key.
- `src/core/lib/payload-store/local.js` implements the initial immutable local
  store. It writes a private temporary file, fsyncs it, publishes with a
  create-if-absent hard link, fsyncs the directory, and read-back rehashes and
  canonicalizes before a reference can be returned. Reads are bounded by the
  declared exact size and return raw bytes; the ledger itself rehashes and
  decodes those bytes before it uses them. Existing content is reused only
  when it verifies exactly. There is deliberately no delete or
  garbage-collection API.
- A manual run persists one canonical
  `wharfie.execution.manual-request.v1` envelope `{input, callerMetadata}`.
  Run and invocation snapshots retain only the same `requestRef`.
- A terminal transition validates complete Activity Protocol evidence first,
  stores it as `wharfie.execution.activity-evidence.v1`, and retains only an
  `evidenceRef` plus `{type, attemptId}` terminal summary. Large results no
  longer inflate ledger records.
- Every fold, inspection, recovery decision, mutation pre-read, and start
  frame reconstruction rehashes the referenced request/evidence in the ledger
  itself. Missing, malformed, wrong-store, substituted, or altered bytes fail
  closed before another transition can be authorized. Normal stale,
  conflicting, and idempotent calls preflight the ledger before publication;
  a crash or concurrent append race after publication may still leave an
  unreachable content orphan.
- CLI ledger access resolves a local content root beside
  `WHARFIE_CONTROL_PATH` by default. It can be set explicitly with
  `WHARFIE_EXECUTION_PAYLOAD_PATH`; an optional
  `WHARFIE_EXECUTION_PAYLOAD_STORE_ID` pins the portable local-store identity.

## Deliberate limits

- This is a **local** content-store provider, not shared distributed artifact
  storage. A process on another machine without the same retained content
  fails closed; do not describe it as a mesh-ready payload provider.
- Referenced JSON is capped at 16 MiB in this first vertical and protocol
  evidence remains capped at 512 frames. The old 64 KiB inline cap applies
  only to compact lifecycle/projection fields.
- There is no reachability index, deletion, or GC. Design durable roots and
  retention before adding any cleanup.
- There is still no resident service lifecycle, local ownership session,
  lease, heartbeat, scheduling loop, global run directory, cancellation
  decision, or automatic coordinator recovery.

## Verification at this handoff

- `npm run typecheck`
- `npm run lint`
- New strict payload-reference and local immutable-store suites.
- DynamoDB and vanilla execution-ledger contract suites, including large
  request/evidence externalization, provider-byte substitution, pre-publication
  rejection ordering, and post-append tampering that blocks inspection and
  mutation. LMDB remains excluded in this sandbox because its native test path
  aborts with exit 134.
- Manual runner, source-independent operator, and CLI `ops run` focused
  suites with a shared payload root across child-process inspections.

## Next work

1. Build a new hidden `ledger-service` SEA runtime, not the legacy
   NodeAgent/Lambda/systemd `state-start` paths.
2. Give that service a narrow local lifecycle (`STARTING`, `READY`,
   `STOPPING`, `STOPPED`) and process-held exclusivity session. Do not call it
   a distributed coordinator lease.
3. Add a typed, atomic per-service ready directory in the same ledger table
   before scheduling or a public run-history list. Service-bound runs must not
   use generic manual transitions.
4. Only then design shared content providers, coordinator epochs, leases,
   cancellation/reconciliation, and a global history index.
