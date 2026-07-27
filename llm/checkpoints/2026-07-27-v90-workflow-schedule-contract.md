# V90 workflow-schedule contract checkpoint

- **Date:** 2026-07-27
- **Status:** **COMMITTED, PUSHED, AND LOCALLY VERIFIED; MANIFEST V3 AND
  RESIDENT SCHEDULING REMAIN GATED**
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint commit:**
  `4a7f6bf09ab758136311c5f831e8461596f97719`
- **Schedule contract and identity commit:**
  `4ba6026e7fed29bf870963e3a62276e5d5187160`
- **Workflow-run cause commit:**
  `7cdc1c3785d9f1d5d368b2eb48a8c3ad3b327930`
- **Remote implementation tip before this checkpoint:**
  `7cdc1c3785d9f1d5d368b2eb48a8c3ad3b327930`
- **Parent checkpoint:** [V89 sensitive activity-log inspection](./2026-07-27-v89-sensitive-activity-log-inspection.md)

## Restart summary

Wharfie's target remains a normal TypeScript/Node CLI that can become one
approachable portable executable, run locally, remain resident as a durable
service, and coordinate work across trusted machines without requiring Node,
containers, Kubernetes, or a hosted orchestration service on those machines.

The public authoring path is still strict manifest schema V2. This checkpoint
does **not** accept, package, or execute schedules. It settles the first
schedule semantics and the ledger provenance needed by the eventual executable
vertical while preserving V2's rejection of schedule fields.

Breaking changes remain acceptable. Work locally with Git CLI, exact Node
24.13.1 and npm 11.12.0, focused disposable tests, and immediate temp cleanup.
Do not run native LMDB, native SEA construction on this Mac, block-device
tools, Docker, or live cloud/resource mutation without the required explicit
authority.

## What V90 closes

### One deliberately small schedule language

ADR 0024 accepts the first revision-bound workflow-schedule contract:

- one named workflow in the same immutable application revision;
- static bounded JSON input;
- exactly five canonical UTC cron fields;
- each field is `*` or a strictly ascending comma-separated numeric set;
- no ranges, steps, names, aliases, seconds, timezone, DST policy, or Sunday
  alias `7`;
- standard restricted day-of-month/day-of-week OR semantics;
- `missed: "latest"` bounded catch-up;
- `overlap: "allow"` independent workflow runs; and
- no exactly-once application-effect claim.

The pure definition codec enforces a 128-schedule count bound, 1 MiB schedule
map bound, 256 KiB static-input bound, unreachable selected day/month
rejection, and a caller-declared minute scan bounded by a hard 527,040-minute
ceiling. The evaluator returns at most the newest matching minute plus exact
skipped count/first/last metadata and refuses a window it cannot completely
prove.

### Stable occurrence identity and revision-bound definition identity

A schedule occurrence ID hashes exactly application ID, schedule ID, and the
canonical UTC minute. Revision, observation time, retry count, and coordinator
identity do not create a second logical occurrence.

A separate definition ID binds the application, exact revision, schedule ID,
sealed workflow plan, canonical schedule definition, policy, and static input.
The authoritative schedule cause carried by a workflow run contains both
identities and recomputes the occurrence against the enclosing application.

### Scheduled provenance fits the existing workflow ledger

The execution ledger still records `trigger.kind: "workflow"`. It now permits
one strict nested schedule cause and makes that cause part of creation,
rebuild, request identity, and exact replay. Reusing the same workflow run
without the cause, with another definition, or with a moved schedule identity
conflicts.

The redacted operator view advances to schema V8 and exposes only the safe
schedule provenance: schedule ID, definition ID, occurrence ID, and scheduled
minute. It does not add workflow input, payload references, storage authority,
or a schedule mutation command.

Documentation was also corrected to describe the already-shipped
explicit-confirmation historical activity-log reader instead of continuing to
claim that all public log retrieval is absent. Live tail, search, and
redaction remain absent.

## The design deliberately rejected before public V3

The first control-store experiment durably selected an occurrence, called the
ordinary workflow-start transaction, and then cleared the pending selection.
Review found a release-cutover liveness and correctness hole:

1. the old resident can select an occurrence;
2. activation can move from `ACTIVE` to `QUIESCING`, closing run creation;
3. the workflow start then fails admission;
4. current quiescence sees no run;
5. ownership can transfer; and
6. the new revision cannot execute the old revision/plan-bound request.

Dropping the pending row loses work. Retaining it strands work after ownership
transfer. Merely rejecting replacement can force rollback but is not a valid
normal cutover design. The two-transaction implementation and tests were
therefore discarded rather than committed.

Manifest V3 remains gated exactly as ADR 0024 requires. The attempted compiler
surface was reverted; strict V2 still rejects `schedules`.

## Exact next implementation

Add one specialized atomic scheduled-workflow-admission path. Its single
control-store transaction must include:

1. the exact `ACTIVE` selected-revision admission fence;
2. the exact current resident-owner fence;
3. an exact schedule cursor activation/revision/definition/version CAS;
4. horizon advancement and immutable complete skip/occurrence evidence; and
5. the ordinary workflow run event, projections, initial workflow activation,
   transition receipt, and ready-work locator.

Payload blobs may be prepared before the transaction because unreferenced
content-addressed blobs are harmless. A lost response must reconcile by
reading both the exact schedule occurrence receipt and exact workflow
run/cause; both exist or neither exists.

This serializes correctly with release activation:

- if scheduled admission wins, the workflow run already exists and normal
  quiescence sees it;
- if `QUIESCING` wins, admission and cursor advancement both fail; and
- no durable selected-but-unstarted state crosses ownership.

After that kernel has response-loss and cutover-race tests, integrate exact
manifest/revision binding, resident observation, source and packaged restart
proof, and only then replace public schema V2 with V3.

## Verification completed

All checks used:

```text
/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node
Node 24.13.1
npm 11.12.0
```

Completed:

- four TypeScript projects with `--noEmit`;
- scoped ESLint with zero warnings;
- scoped Prettier;
- `git diff --check`;
- 49 pure schedule definition/identity tests;
- two focused vanilla ledger/operator tests for scheduled cause replay and
  safe projection; and
- 10 documentation command-surface tests.

Every Jest invocation used an exact owned `/private/tmp/wharfie-v90-*` root,
was measured, and was deleted immediately. The largest successful root was
11 MiB. No owned V90 root remains.

One broader CLI selection exited 134 before producing Jest results, matching
the already-recorded local failure class. Its 9.1 MiB temp root was measured
and deleted. It was not retried, is not counted as passing, and this is not a
full-suite or native-adapter claim.
