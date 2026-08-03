# V95 versioned durable-operation receipts checkpoint

- **Date:** 2026-07-27
- **Status:** **IMPLEMENTED, COMMITTED, AND LOCALLY VERIFIED**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `c0001fd88f3e6a9d457efaacb932306dfa5532c5`
- **V95 implementation commit:**
  `005b282d7ab38dee185541b538a9d96b11ff4260`
- **Parent checkpoint:** [V94 owned test workspace](./2026-07-27-v94-owned-test-workspace.md)

## Restart summary

Wharfie's target remains a normal TypeScript/Node CLI that can become one
approachable portable executable, run locally, remain resident as a durable
service, and coordinate work across trusted machines without requiring Node,
containers, Kubernetes, or a hosted orchestration service on those machines.

V95 closes the first stable machine-readable operator protocol slice. Source
and packaged durable activity `run` and `submit` plus workflow `start` and
`signal` now return strict schema-version 1 JSON documents from shared
source/packaged operator implementations. Human output remains a separate
rendering contract.

V95 does not claim physical exactly-once execution, add a hosted API, or provide
the still-missing native V93 relocated Linux schedule/restart evidence.
Breaking changes remain acceptable. Continue with Git CLI, exact Node 24.13.1
and npm 11.12.0, focused disposable tests, and immediate measurement and
cleanup of test roots.

## What V95 closes

### Stable receipt families

The stable operator protocol owns four explicit document kinds:

- `wharfie.execution-ledger.activity-run`;
- `wharfie.execution-ledger.activity-submit`;
- `wharfie.execution-ledger.workflow-start`; and
- `wharfie.execution-ledger.signal`.

Every document has `schemaVersion: 1`. Machine fields use camel case; human rows
use snake case and are formatted independently.

The activity-run receipt exposes the bound app, revision, run, activity,
idempotency key, durable disposition, replay state, run and invocation status,
and the retained attempt generation/status when one exists.

The activity-submit receipt exposes the same stable identity and replay
surface without inventing an execution attempt.

The workflow-start receipt exposes the manifest-bound workflow plus redacted
durable cursor and next-activation summaries. Terminal replay retains the
terminal cursor summary and returns `nextActivation: null`.

The signal receipt preserves its accepted/rejected durable decision and
current-wait delivery identity. Durable negative decisions are printed before
the command exits nonzero. A read-time unknown-run absence has no durable
decision, but emits an explicit schema-version 1 unpersisted absence receipt
before the command exits nonzero.

### Fail-closed construction

Receipt constructors:

1. validate caller-known app, revision, run, operation, and idempotency
   identities against the returned ledger state;
2. validate run, invocation, attempt, workflow-plan, cursor, activation, and
   signal-delivery linkage appropriate to the command;
3. accept the ledger's real blocked manual-run shape
   (`BLOCKED` / `UNCERTAIN` / retained `ABANDONED` attempt);
4. accept exact terminal workflow-start replay while rejecting impossible
   cursor/activation combinations;
5. copy only an explicit output allowlist;
6. recursively freeze the returned JSON value; and
7. use fixed, secret-safe validation errors.

The old submit-only `outcome`/`accepted` compatibility shape was removed.
Breaking compatibility is intentional for this unused experimental repository.

### Source, package, and proof parity

The source and packaged commands now delegate receipt construction to shared
operator implementations. Run, submit, and start use the durable-operation
receipt module; signal owns its constructor beside the shared signal command.
Existing package, systemd-service, resident, CLI, and workflow `SIGKILL` proof
consumers were migrated from ad hoc command result shapes to the versioned
documents.

Package response-loss replay no longer requires byte-identical output because
the stable `reused` field truthfully changes from `false` to `true`. The
workflow `SIGKILL` helper likewise asserts the replay state expected at each
call site.

ADR 0028 records the public protocol boundary, versioning rule, refusal
semantics, human/machine separation, and non-goals. The quickstart and CLI
reference document the four receipts.

## Verification completed

All checks used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
Node 24.13.1
npm 11.12.0
```

Completed locally:

- all four TypeScript projects with `--noEmit`;
- full-repository ESLint with zero warnings;
- full JavaScript/JSON Prettier plus modified-Markdown Prettier;
- JavaScript syntax checks and `git diff --check`;
- 104 focused tests across five runtime suites;
- 13 focused CLI integration tests; and
- a static audit of package, systemd-service, and crash-proof consumers for
  obsolete machine-output fields.

Three independent reviews covered the shared receipt contract, command
integration, and remaining consumer scope. Their findings led to stricter
attempt linkage, real blocked-run support, terminal workflow-start replay,
manifest-plan validation, signal lifecycle/linkage validation, and migration
of stale proof consumers. The final reviews found no remaining behavioral
blocker in this slice.

The final consolidated Jest invocation used an exact
`/private/tmp/wharfie-v95-*` root, disabled coverage and cache, and ran in band.
The test root finished at 0 bytes; the static-check root contained 2.8 MiB.
Both exact roots were deleted. Independent focused reviewers also removed their
disposable roots. No checkout-local `.wharfie` directory exists. The actual
macOS Wharfie data directory remained 12 KiB and was deliberately left
untouched.

Not run locally:

- the full Jest suite;
- native SEA construction;
- native LMDB execution;
- the actual relocated Linux due-occurrence/`SIGKILL`/restart proof;
- Docker;
- block-device operations; or
- live cloud/resource mutation.

## Boundaries that remain

- These receipts are local command documents, not a served protocol or hosted
  control plane.
- Schema version 1 covers only durable `run`, `submit`, `start`, and `signal`.
  Other operator commands retain their current contracts.
- The receipts report durable ledger state or an explicit unpersisted read-time
  absence, plus the applicable replay disposition. They do not turn unmanaged
  external effects into physical exactly-once execution.
- `schemaVersion` permits explicit future evolution, but V95 does not define
  durable database migration machinery.
- Human output is intentionally separate and may evolve independently.
- V95 does not add schedule operator commands or satisfy the V93 native proof.

## Exact next work

1. Run the committed V93 verifier in an explicitly authorized disposable
   Linux environment and retain its exact result.
2. Only after that proof passes, add the narrow source/packaged schedule
   `list`, `inspect`, `pause`, and `resume` surface.
3. Run V84 against one already-present immutable local Linux/amd64 image. If
   its read-only report is attemptable, run V83 only with explicit approval and
   retain only its checksummed `whlp2` receipt.
4. Keep native LMDB/SEA, Docker, block-device, and live-cloud work behind their
   existing explicit approval boundaries.

## Resume state

- Branch: `agent/strict-manifest`
- V95 implementation:
  `005b282d7ab38dee185541b538a9d96b11ff4260`
- Parent checkpoint:
  `c0001fd88f3e6a9d457efaacb932306dfa5532c5`
- Historical stash to leave untouched:
  `stash@{0}: WIP on master: 3dee66b work prompt`
- Exact Node:
  `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`
- Continue with the authorized V93 relocated Linux proof if that environment
  becomes available. Otherwise choose the next ungated roadmap slice without
  weakening the existing proof boundaries.
