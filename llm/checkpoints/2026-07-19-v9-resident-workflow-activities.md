# Wharfie checkpoint — resident workflow activity dispatch

- **Date:** 2026-07-19
- **Status:** **COMPLETE — implementation and exact post-change validation are
  recorded below**
- **Branch:** `agent/strict-manifest`
- **Starting parent:** `a498e2d5c6ba8391a91552451f40d0345db615e2`
- **Implementation receipt:** `a8a3496e73679d60e68a62086271f681b466a0b6`
- **Parent checkpoint:** [workflow activity failure
  terminals](2026-07-19-v8-workflow-activity-failures.md)
- **Design authority:** [project charter](../../PROJECT.md),
  [roadmap](../../ROADMAP.md), [ADR
  0011](../../docs/architecture/decisions/0011-persisted-state-machine-execution-ledger.md),
  and [ADR
  0019](../../docs/architecture/decisions/0019-persisted-linear-workflow-continuations.md)

This checkpoint mounts the persisted workflow activity state machine in the
resident worker. Exact manifest-bound `ACTIVITY` rows can now execute authored
activities, and `RECOVERY` rows settle interrupted claims or starts without
silently redispatching uncertain physical work.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-19-v9-resident-workflow-activities.md`. Work on branch
> `agent/strict-manifest` at or after implementation receipt `a8a3496`. Read
> `PROJECT.md`, `ROADMAP.md`, ADR 0011, ADR 0019, and this checkpoint before
> editing. Inspect the worktree first and use exactly Node 24.13.1/npm 11.12.0.
> Work locally with the git CLI; do not spend time on pull requests or issue
> bookkeeping. Preserve the V10 append-only event authority, exact run-head and
> cursor CAS, immutable payload rehashing, receipt-event-anchored replay,
> generation/fence guards, exact manifest/revision binding, transactionally
> maintained ready-work V2 rows, and the rule that uncertain physical work is
> never silently redispatched or rewritten. The next tranche is the shared
> source/packaged public workflow surface: start exact manifest workflows,
> inspect exact runs, and reconcile only evidence-backed uncertain activity
> attempts. Then prove that path through source and relocated-SEA process-kill
> recovery. Keep cancellation, deadlines, timers, signals, general cloud IaC,
> trustless mesh semantics, arbitrary workflow-code replay, and backward
> compatibility outside that tranche.

## Product direction retained

Wharfie remains a local-first framework for turning a normal TypeScript CLI
with named activities into a self-contained executable that can remain
resident as a durable service and later coordinate work across trusted
machines. One recoverable coordinator is sufficient initially. Node/TypeScript
remains the primary boundary, while native bindings, subprocess protocols, and
WASM remain available for measured hot paths. Exactly-once language applies
only to evidence-backed logical decisions and destination protocols, never to
arbitrary physical user-code execution.

## Resident dispatch now implemented

The resident worker now discriminates manual and workflow ready-work instead
of treating every row as a manual invocation. A workflow descriptor is
accepted only when all persisted authority agrees: application, immutable
revision, workflow, plan, run head, runnable cursor, invocation, activity,
generation, attempt, cursor version, continuation, step id, and step index.

Stale head, cursor, generation, revision, or plan rows are parked without
crashing the service. Repairing durable authority permits a later exact row to
run; the stale row itself never grants dispatch authority.

`isWorkflowActivityDispatchSupported(...)` is now one shared ledger/host
predicate. The current step must be a normal authored activity and its
successor must be either absent or another normal authored activity. Timer,
signal, and framework-owned managed-effect successor boundaries remain
non-dispatchable so user code cannot strand a cursor at an unimplemented
continuation.

## Exact manifest host boundary

`resolveManifestWorkflowActivityBinding(...)` re-derives the immutable workflow
plan from the sealed application manifest. The host rejects a mismatched plan,
cursor, workflow, invocation, activity, application, or revision before
claiming ledger work.

`runPersistedDurableManifestWorkflowActivity(...)` snapshots every caller-owned
scalar, capability reference, actor, and cursor before the asynchronous
prepared-revision verification boundary. Mutation of the caller's request or
prepared source during that wait cannot retarget the ledger, activity, actor,
or cursor. The exact activity is invoked through the shared framed activity
host with no managed-effect handler.

## Claim, start, terminal, and response-loss behavior

`runWorkflowLedgerActivity(...)` owns the physical workflow attempt lifecycle:

- only a newly applied exact claim may advance toward execution;
- only an exact durable start returning `dispatchAuthorized: true` may invoke
  user code;
- claim response loss retains `CLAIMED` plus a `RECOVERY` row and performs no
  physical dispatch;
- start response loss or replay is treated as started uncertainty and performs
  no dispatch;
- an executor throw or unsupported `cancelled`/`deadline-exceeded` terminal is
  converted to visible uncertainty, never a fabricated workflow terminal;
- only verified `completed`, `failed`, or `protocol-failed` evidence reaches
  `commitVerifiedWorkflowActivityTerminal(...)`; and
- terminal response loss re-reads authoritative state and never redispatches
  the physical attempt.

Activity-to-activity continuations consume the persisted prior output and
produce the next exact runnable activation. A final completed activity
atomically completes the workflow. Failure terminals retain the earlier output
prefix and create no successor.

## Recovery and graceful drain

`recoverWorkflowLedgerActivity(...)` settles recovery rows from durable state:

- an exact unstarted `CLAIMED` attempt is released and may yield a fresh exact
  activity descriptor; and
- an exact lost `STARTED` attempt becomes `ACTIVITY_UNCERTAIN`/blocked and is
  never physically redispatched.

Recovery is source-independent and runs before manifest dispatch filtering.
Consequently a missing or mismatched local manifest cannot prevent durable
recovery from settling an interrupted attempt. Any activity made runnable by a
release remains parked until an exact supported manifest is available.

Resident shutdown now separates admission from physical drain. The root signal
immediately stops admission and lets an unstarted claim release cleanly. An
already started attempt keeps its physical signal until the bounded drain
timeout; a forced workflow abort becomes uncertainty rather than logical
cancellation. The existing manual cancellation-port behavior remains intact,
and workflow attempts do not register that manual-only port.

## Exact post-change validation

Implementation receipt `a8a3496` was validated under Node 24.13.1/npm 11.12.0:

- ESLint and repository-wide JavaScript/JSON Prettier checks passed;
- all four TypeScript lanes passed: source, app implementation, tests, and SEA
  verifier;
- 91 focused lifecycle, recovery, response-loss, manifest-binding, shutdown,
  and manual-regression tests passed across four suites;
- the full Jest coverage run passed 92 suites and 1,452 tests with one
  intentional suite/test skip;
- package-content verification accepted 129 files;
- the native external integration test passed;
- the production dependency audit found zero vulnerabilities;
- the installed and relocated SEA proof passed with Node absent from `PATH`;
  the executable was 143,222,352 bytes; and
- staged and unstaged `git diff --check` checks were clean.

The final host regression mutates the caller-owned request during asynchronous
prepared-source verification and proves the original exact authority is used.
The final resident regression proves recovery cannot retarget a manual row to a
different run, application, revision, invocation, activity, or generation.

## Explicitly unsupported

The following remain intentionally unimplemented:

- public source/package/SEA workflow start, inspect, and reconciliation
  commands;
- automatic resolution when a lost started attempt has no trustworthy terminal
  transcript;
- direct or reconciled `cancelled` or `deadline-exceeded` workflow activity
  outcomes and run-level cursor-aware cancellation;
- timer and signal cursor decisions and ready rows;
- workflow activity steps using the framework-owned managed-effect successor;
- retry/backoff policy, schedules, branches, loops, parallel steps, child
  workflows, or workflow migration;
- garbage collection for unreachable content-addressed payloads;
- OS service installation and provider-backed node fulfillment;
- multi-node leases, heartbeats, placement, and coordinator failover; and
- any claim that arbitrary user code physically executes exactly once.

## Ordered next tranche

1. Mount one shared source/packaged command path to start an exact embedded or
   sealed-manifest workflow.
2. Add exact run inspection and evidence-backed reconciliation for uncertain
   workflow activities without creating a generic mutation surface.
3. Prove source and relocated-SEA real-process kill/restart behavior at claim,
   start, terminal, and recovery-response boundaries.
4. Add run-level cursor-aware cancellation and its races with success and
   uncertainty before accepting cancelled or deadline terminals.
5. Add persisted timers and current-wait signals on the existing cursor/run-head
   boundary.
6. Install the SEA as an OS-managed service before beginning the smallest
   provider-backed single-node fulfillment path.

## Restart commands

```sh
git status --short --branch
git log -5 --oneline --decorate
. $HOME/.nvm/nvm.sh && nvm use 24.13.1
npm run lint
npm run typecheck
TZ=UTC node ./test/run-jest.js --silent --runInBand \
  test/runtime/manual-ledger-run.test.js \
  test/runtime/workflow-ledger-run.test.js \
  test/runtime/durable-workflow-host.test.js \
  test/runtime/services/resident-activity-worker.test.js
```

The full suite's Unix-socket/LMDB and child-process cases, the native external
test, registry audit, and SEA verifier may need to run outside a restricted
filesystem or network sandbox.
