# Wharfie checkpoint — resident activity worker vertical

- **Date:** 2026-07-19
- **Status:** **COMPLETE — implementation and full source/native/package/SEA
  validation are recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `98fc5809363128b2c7973d6c4155d8b3849bf07a`
- **Implementation receipt:** `PENDING_FINAL_COMMIT`
- **Full validation receipt:** `npm run test:full` — exit 0 on 2026-07-19
- **Parent checkpoint:** [v2 foundation
  stabilized](2026-07-19-v2-foundation-stabilized.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), and [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md)

This checkpoint records the first end-to-end resident activity vertical. A
normal source application or its packaged artifact can submit a durable manual
activity independently of physical execution, then run an exact-revision
single-node worker that survives the submitting process and recovers
conservatively after worker restart.

This remains narrower than the intended durable workflow service. It does not
add workflow continuations, persisted workflow outputs, timers, schedules,
startup-on-boot installation, multi-host leases/heartbeats, or coordinator
failover.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v3-resident-activity-worker.md`. Work on branch
> `agent/strict-manifest`, whose starting parent for this tranche is
> `98fc580`. Read `PROJECT.md`, `ROADMAP.md`, ADR 0011, and this checkpoint.
> Inspect the worktree before editing and use Node 24.13.1/npm 11.12.0.
> Preserve the exact-revision, serial-dispatch, managed-effect recovery, and
> uncertainty boundaries below. Work locally with the git CLI; do not spend
> time reconciling pull requests or issues. The next product step is a minimal
> explicit persisted workflow state machine, not a broader retry claim or a
> second run store.

## Public commands

Source applications prepare and seal the revision selected by `--dir`:

```bash
wharfie ops submit --dir ./path/to/app --activity <activity-id> \
  --idempotency-key <stable-key> [--input <json>] \
  [--caller-metadata <json>] [--json]
wharfie ops worker --dir ./path/to/app
```

Packaged applications bind directly to their cross-checked embedded manifest
and revision/runtime pair and expose no source-directory override:

```bash
<app> wharfie submit --activity <activity-id> \
  --idempotency-key <stable-key> [--input <json>] \
  [--caller-metadata <json>] [--json]
<app> wharfie worker
```

The private environment-selected packaged `ledger-service` runtime now starts
the same resident activity service as the public worker command. This wiring is
not an OS service installer. The moved-SEA suite does prove this runtime with
Node unavailable on `PATH`, including owner recovery after a killed service.

## Durable submission contract

- Submission and execution are separate. `submit` appends the manual run and
  `RUNNABLE` invocation without creating or claiming a physical attempt.
- The caller supplies a required stable idempotency key. Repeating the exact
  app, revision, activity, input, and caller metadata returns the retained run;
  changing the request conflicts.
- The accepted receipt is compact and redacted: stable request/run/revision/
  activity identities, run and invocation statuses, attempt summary, and reuse
  state. It does not expose inputs, metadata, fences, or terminal evidence.
- If an exact app/revision resident owns the local LMDB scope, submission uses
  its HMAC-authenticated same-principal owner-command endpoint. The resident
  validates app and revision before mutation and wakes its worker after append.
  That endpoint alone accepts a request envelope large enough for the ledger's
  16 MiB referenced-payload contract; other owner commands retain 64 KiB by
  default.
- If no resident is active, submission acquires a short-lived exclusive local
  owner, appends the same request, releases ownership, and exits. The request
  remains durable and `RUNNABLE` until its exact-revision worker starts.
- A stale, mismatched, or racing owner never authorizes an unauthenticated
  direct-write fallback.

## Resident execution and restart contract

- One resident lifecycle/ownership generation opens one execution ledger and
  runs at most one physical activity attempt at a time.
- The worker accepts only the app and immutable revision supplied by its sealed
  source preparation or embedded artifact. A different revision cannot execute
  the retained request.
- The bounded, fully paginated run-history directory is used only to locate
  candidates. Every row is checked by rebuilding the run, and the ordinary
  ledger claim remains the sole authority to dispatch.
- A stale current `CLAIMED` attempt has not crossed the durable handler-start
  boundary. Recovery abandons/releases it, returns the invocation to
  `RUNNABLE`, and permits a higher generation.
- A stale current `STARTED` attempt may have executed arbitrary authored code.
  With no recoverable managed-effect evidence, recovery abandons the physical
  attempt and blocks the invocation/run as `UNCERTAIN`; it never silently
  redispatches it. When the exact retained attempt instead has unresolved
  built-in application-state effects, the worker uses the source-free compound
  recovery boundary: `PENDING` siblings cancel without destination access,
  `STARTED` siblings receive read-only receipt probes, and one fenced
  transaction settles the whole effect set and attempt.
- Authenticated cancellation routing now recognizes either the foreground
  manual owner or a resident owner, but only the exact resident `STARTED`
  attempt is active. Idle residents and residents executing another run report
  no delivery.

## Shutdown contract

The first `SIGINT` or `SIGTERM` requests a graceful drain:

1. stop admitting owner commands and stop beginning new claims;
2. persist resident lifecycle `STOPPING` while retaining local ownership;
3. await every submission/cancellation callback admitted before shutdown;
4. give the active physical attempt 30 seconds to finish naturally;
5. after that allowance, request cooperative cancellation through the existing
   durable attempt-cancellation path; and
6. retain ownership until the attempt and callbacks settle, close the command
   server, record `STOPPED`, and release the session.

An unexpected worker return without a shutdown request is a failure rather than
a false clean service exit. The hidden packaged service registers signal
handling before asynchronous startup and waits for this same drain sequence.
Lifecycle stays `STARTING` until the authenticated owner-command socket is
bound. If shutdown wins first, it advances directly to `STOPPING`; it never
publishes a transient false `READY` state.

## Implementation seams

- `execution-ledger.readManualRunRequest` rebuilds and verifies the exact run,
  invocation, immutable request payload, and creation actor needed for later
  execution.
- `submitManualLedgerActivity` and `submitDurableManifestActivity` persist a
  request without claiming it.
- `runPersistedDurableManifestActivity` loads the retained request and creation
  actor, revalidates exact app/revision/activity authority, and enters the
  existing durable activity kernel.
- `runResidentActivityWorker` owns serial scan/recovery/dispatch and the
  authenticated submit/cancel command endpoint.
- `recoverResidentManagedEffects` admits only the built-in source-free
  application-state recovery catalog, fences the exact attempt and canonical
  unresolved effect set before destination access, rechecks them before atomic
  settlement, and never invokes authored code or the normal adapter.
- `runLocalResidentActivityService` composes one LMDB ledger scope, resident
  ownership/lifecycle, the worker, and graceful shutdown.
- `submitLocalDurableManifestActivity` chooses authenticated resident routing
  or offline short-lived ownership while preserving one stable run identity.
- Source and packaged submit/worker command factories share those core seams;
  the hidden SEA service command uses the same high-level service runner.

## Validation state

The authoritative `npm run test:full` completed successfully under Node
24.13.1/npm 11.12.0 on 2026-07-19:

- ESLint, Prettier, and all four TypeScript checking lanes passed;
- Jest passed 81 suites and 1,098 tests, with one suite/test intentionally
  skipped; coverage was 78.24% statements, 73.29% branches, 83.20% functions,
  and 79.21% lines;
- the package-content gate accepted 124 files and the production dependency
  audit reported zero vulnerabilities;
- native LMDB validation passed its one suite/test; and
- the clean installed-package/relocated-SEA proof passed with a 142,479,312
  byte executable and Node unavailable on `PATH`.

The relocated executable proof includes offline and live-resident submission,
exact-revision serial execution, owner/service crash recovery, all preceding
managed-effect crash/replay matrices, atomic mixed `PENDING`/`STARTED` recovery
for a current-revision resident without authored redispatch, continued resident
availability, and compound-recovery response-loss restart. Focused
managed-effect/operator/resident tests also passed 106/106, including exact
attempt/effect-set fencing and canonical effect-order checks.

Native LMDB and SEA validation ran outside the restricted macOS semaphore
sandbox; LMDB locking remained enabled.

## Known limits and immediate follow-up

1. Run history is a verified locator, not the ideal scheduler index. Add a
   transactionally maintained ready-work projection before general workflows
   or high-volume scheduling.
2. Define the smallest explicit persisted workflow state machine: immutable
   revision, continuation position, durable outputs, timers/signals, and
   cancellation. Do not replay arbitrary handler code.
3. Run that state machine through this resident worker and add adversarial
   process/reboot proof at each attempt/effect ambiguity boundary.
4. Only then add OS service installation, status/history/log operators,
   scheduled starts, provider-backed deployment, and multi-host coordination.
