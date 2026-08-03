# V92 resident workflow-schedules checkpoint

- **Date:** 2026-07-27
- **Status:** **COMMITTED, PUSHED, AND LOCALLY VERIFIED; AN ACTUAL RELOCATED
  LINUX SEA SCHEDULE/RESTART PROOF REMAINS**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `8339ce3cc5cec5be371a60993950ad94d989dbac`
- **Resident scheduling implementation commit:**
  `bb09157c435af7900f7a2d40d8497dd8a7ff71fe`
- **Parent checkpoint:** [V91 atomic schedule admission](./2026-07-27-v91-atomic-schedule-admission.md)

## Restart summary

Wharfie's target remains a normal TypeScript/Node CLI that can become one
approachable portable executable, run locally, remain resident as a durable
service, and coordinate work across trusted machines without requiring Node,
containers, Kubernetes, or a hosted orchestration service on those machines.

V92 opens the first executable workflow-schedule vertical. Strict manifest V3
is now the only accepted application contract. It keeps workflows and
schedules optional so a CLI can become durable progressively, but each map is
nonempty when declared and every schedule targets a workflow in the same
manifest.

One exact-revision observer now runs beside the resident's serial physical-work
loop. It resumes durable cursors, performs latest-only UTC catch-up, and uses
V91's atomic transaction to commit a due occurrence, cursor advancement,
ordinary workflow run, and ready-work row together. Initial reconciliation
gates service readiness and owner commands. Internal observer failure requests
durable `STOPPING` before bounded activity drain.

Breaking changes remain acceptable. Continue with Git CLI, exact Node 24.13.1
and npm 11.12.0, focused disposable tests, and immediate temp cleanup. Do not
run native LMDB, native SEA construction on this Mac, block-device tools,
Docker, or live cloud/resource mutation without the required explicit
authority.

## What V92 closes

### One strict, progressively adoptable manifest V3

The source compiler, runtime validator, public TypeScript declarations,
revision compiler, embedded manifest, packager, fixtures, and examples now use
only `schemaVersion: 3`. Version 2 has no loader alias or compatibility path.

`workflows` and `schedules` are optional; declared maps cannot be empty.
Author-time types and runtime validation both reject a schedule that names a
workflow outside the same manifest. CLI-only, activity-only, workflow, and
scheduled-workflow applications therefore remain deliberate steps rather than
requiring inert recurrence.

The schedule language stays deliberately narrow:

- one same-revision workflow with static bounded JSON input;
- canonical five-field UTC cron;
- `missed: "latest"` and `overlap: "allow"`;
- at most 128 definitions in a 1 MiB map;
- at most 256 KiB of static input per schedule; and
- a complete evaluation bound of 527,040 minutes.

### Exact source and embedded revision binding

`resolveManifestScheduleBindings` accepts only a validated
`ManifestActivityExecution`. It derives canonical schedule order and binds
each schedule to the exact app, revision, definition, workflow, normalized
plan ID, and sealed plan payload.

The observer uses the same binding path for prepared-source and embedded
execution. Prepared source is verified before activation and before schedule
authority advances into another observed minute. The real vanilla
observer/worker integration now admits and dispatches the same scheduled
workflow through both execution modes.

Package tests prove schedule parity across the authored manifest, embedded
manifest, revision contract, revision asset, and returned package revision.
The relocated-SEA verifier also requires the V3 schedule to survive embedding.
Its leap-day fixture intentionally proves serialization only; it does not
claim a due occurrence.

### Concurrent observation over the ordinary workflow engine

`runResidentScheduleObserver` probes the exact resident owner and selected
revision, activates or resumes every definition, evaluates one injected
wall-clock horizon, and either advances a no-due cursor or admits the selected
latest occurrence through V91.

The observer runs concurrently with the existing ready-work loop, so a long
activity cannot suppress logical schedule observation. The physical worker is
still serial. Scheduled workflows enter the ordinary workflow creation,
activity, timer, signal, cancellation, recovery, inspection, and ready-work
paths; V92 does not create a second execution engine.

A local wake callback is only a latency optimization. Losing it cannot lose
work because the ready-work row commits in the same transaction as the
occurrence and workflow run.

### Readiness and failure share the resident lifecycle

The worker creates its command endpoint but rejects owner work until the
schedule observer has completed its first exact authority probe, definition
activation, and catch-up observation. A manifest with no schedules takes the
same authority path and becomes ready without inventing cursor state.

Ownership loss, activation closure, source drift, cursor replacement, invalid
observation time, or another observer failure aborts worker admission and
invokes one `onStopping` hook. The local service wires that hook to its
idempotent `beginStopping()` transition. Tests prove the STOPPING notification
occurs while a prolonged active activity is still draining, and callback
failure is retained alongside observer and cleanup failure without an
unhandled promise.

Observer cleanup and the active attempt retain bounded drain behavior.
Commands close as soon as the combined external or internal signal aborts.

### Restart, cutover, and clock races fail conservatively

Exact-definition restart preserves activation boundary, horizon, and cursor
version. A changed definition under a backward wall clock starts no earlier
than the prior cursor's durable `updatedAt`; durable authority never rewinds.

A workflow and occurrence atomically committed before activation becomes
`QUIESCING` remain an exact replay after cutover. If `QUIESCING` wins before
the transaction, the admission fence creates neither side and does not advance
the cursor.

Every cursor accepted into an observer cache must still match its exact app,
schedule, revision, and definition. A same-owner observer for another
source-mode revision can replace durable cursor state, but the displaced
observer detects the post-admission reread mismatch and stops instead of
advancing the foreign definition.

No-due response-loss reconciliation also rechecks the current activation,
owner, and exact cursor before reporting another writer's advancement as a
replay.

### Exact JSON decoding retains manifest workflow arrays

The privileged host runtime's strict JSON decoder previously rejected standard
dense JSON arrays because their non-enumerable `length` descriptor was treated
as an unexpected property. V3 workflow steps exposed that unrelated latent
bug. The decoder now accepts only the exact dense JSON array shape and still
rejects sparse, accessor, symbolic, or extended values.

## Verification completed

All checks used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
Node 24.13.1
npm 11.12.0
```

Completed:

- all four TypeScript projects with `--noEmit`;
- repository ESLint with zero warnings;
- full configured JavaScript/JSON Prettier, changed-Markdown Prettier, and
  `git diff --check`;
- 14 resident-schedule observer tests, including exact cursor replacement and
  real embedded/prepared-source worker composition;
- 36 resident-worker tests, including concurrent admission, readiness,
  STOPPING-before-drain, bounded observer shutdown, and failure aggregation;
- 15 schedule-control and activation-cutover tests;
- 16 focused V3 manifest/compiler/binding tests;
- 32 local package tests;
- 73 existing compiler, loader, example, and embedded-manifest tests;
- 58 strict host-runtime command/JSON decoder tests; and
- 10 documentation command-surface tests.

The final focused matrix is 254 passing tests across 14 suites. Every
final-matrix Jest invocation used
`/private/tmp/wharfie-v92-final-tests`, disabled coverage and cache, ran in
band, and was measured before cleanup. The root was 0 bytes and was deleted.
No root-owned `/private/tmp/wharfie-v92-*` directory remains.

This is not a full-suite, native-adapter, native SEA, Docker, block-device, or
live-cloud claim. Known broad local combinations can still exit 134; the
focused vanilla matrix avoids the native LMDB path that previously reproduced
that failure.

## What remains deliberately open

- No actual relocated Linux SEA has yet observed a due schedule, restarted,
  resumed its cursor, and proved no duplicate logical workflow run with Node
  absent from `PATH`.
- No schedule `list`, `inspect`, `pause`, or `resume` command exists. Manual
  fire, tail, search, dynamic input, direct activity targets, timezones,
  catch-up-all, and singleton policies remain explicitly outside this slice.
- Schedule occurrence identity provides one authoritative logical workflow
  decision. Application code and unmanaged external effects remain subject to
  existing at-least-once, fencing, evidence, uncertainty, and reconciliation
  boundaries; V92 makes no physical exactly-once claim.
- One active coordinator remains the initial model. Provider-backed
  replacement and multi-node worker reassignment are later milestones.

## Exact next work

1. In an explicitly approved disposable Linux environment, extend or reuse the
   bounded SEA proof tooling to run a schedule that is actually due, terminate
   the resident after durable progress, restart the moved artifact with Node
   absent from `PATH`, and prove the exact cursor, occurrence, workflow run,
   and single dispatch survive.
2. After that evidence, add only the source/packaged schedule `list`,
   `inspect`, `pause`, and `resume` surface. Keep manual fire, tail, and search
   out.
3. Continue the separate privileged-host path with its already-recorded
   explicit-approval gates; do not let schedule work silently authorize
   Docker, block-device, or live AWS mutation.
4. Begin provider-backed coordinator recovery only after the single-node
   service/control-store fencing and external restart proofs are complete.

## Resume state

- Branch: `agent/strict-manifest`
- Implementation: `bb09157c435af7900f7a2d40d8497dd8a7ff71fe`
- Parent checkpoint: `8339ce3cc5cec5be371a60993950ad94d989dbac`
- Historical stash to leave untouched:
  `stash@{0}: WIP on master: 3dee66b work prompt`
- Exact Node:
  `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`
- Continue at the relocated-SEA schedule/restart proof, then the narrow
  operator surface. Do not reopen V1/V2 compatibility, general cloud IaC,
  trustless mesh, or a second public execution engine.
