# Wharfie checkpoint — V7 atomic managed-effect settlement

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [public application state and receipt-backed recovery](2026-07-18-public-effects-and-receipt-recovery.md)
- **Authority:** [ADR 0016 — Atomic stopped-attempt managed-effect settlement](../../docs/architecture/decisions/0016-atomic-stopped-attempt-effect-settlement.md)
- **Parent remote tip before this milestone:** `99699ee2ef79391f78828a67fbd6ca553a746494`
- **Final implementation commit:**
  `9b9131d04065829c055c01b020f3b78651777458`
- **Checkpoint receipt commit:** resolve with
  `git log -1 --format=%H -- llm/checkpoints/2026-07-18-v7-atomic-effect-settlement.md`
- **Scope:** replace V6 singular stopped-effect recovery with one fresh V7
  state-machine namespace that atomically settles the exact bounded active
  effect set for a confirmed stopped attempt

This is the current restart point for the Wharfie reset conversation. It is a
new immutable handoff; the earlier checkpoints remain historical evidence and
must not be rewritten. The repository still has no downstream users, so
breaking changes are welcome when they move the implementation faster toward a
coherent ideal state. There is no v1 or V1-through-V6 compatibility obligation.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-18-v7-atomic-effect-settlement.md`. Read `PROJECT.md`,
> `ROADMAP.md`, ADRs 0001 through 0016, and this checkpoint before changing the
> execution state machine. Verify `origin/agent/strict-manifest` contains
> `9b9131d04065829c055c01b020f3b78651777458`, refresh the live
> PR/issue/branch state, and use Node
> 24.13.1. V7 is a fresh namespace: do not migrate, reinterpret, or dual-write
> V1-through-V6 data. Start with the real subprocess and relocated-SEA crash
> matrix, then design destination-specific reconciliation and compensation.
> Never redispatch retained stopped-attempt work, and never broaden the
> exactly-once claim beyond a destination that atomically enforces the stable
> effect identity with its business mutation and exposes a verified permanent
> receipt.

## Product and project scope

The motivating idea remains continuity of intent:

> LLMs make it easy to express and act on intent inside a local coding session,
> but that intent is hard to carry into the cloud or beyond the end of the
> session. Wharfie should turn it into something durable that a person or coding
> agent can inspect, follow, and evolve.

The concrete product is a local-first TypeScript runtime that turns a normal
CLI with named activities into an approachable portable SEA, then lets the same
application remain resident as a durable service and coordinate work across
trusted machines without requiring Node, containers, Kubernetes, or a hosted
orchestration service on the target.

The project boundaries agreed in the reset are still authoritative:

- The mesh contains trusted nodes only. Trustless and Byzantine coordination
  are out of scope.
- TypeScript/Node is the one public authoring and orchestration model for now.
  Serializable activity and effect boundaries may later host Node-API bindings,
  native subprocesses, WASM, or WASI for generated hot paths; Wharfie is not a
  polyglot SDK or general multi-language build system.
- Produced SEAs may use a user's normal provider credentials through finite,
  owned Wharfie capability abstractions to create nodes, state, artifacts,
  identity, networking, or ingress. Wharfie is not general cloud IaC.
- The developer-owned CLI is the primary interface. A web UI and a public run
  scan/list are not current priorities.
- One authoritative coordinator is sufficient initially only if durable truth
  survives its loss, stale owners are fenced, and a replacement can rebuild
  from the ledger. This milestone remains local and single-owner; it does not
  implement automatic coordinator failover, distributed leases, or scheduling.
- Wharfie promises at most one authoritative logical terminal, not one physical
  execution. Arbitrary activity code and unmanaged SDK calls are not exactly
  once. A narrow destination effect may be described that way only when the
  destination atomically binds its business mutation to the stable effect ID
  and a deterministic verifier proves the matching permanent receipt.

## V7 durable namespace

V7 is deliberately isolated from every earlier execution-ledger meaning:

```text
execution-ledger schema: 7
record-key namespace:     ledger/v7/
run-directory schema:     5
default table:            wharfie-execution-ledger-v7
operator view schema:     4
```

V1-through-V6 histories and V1-through-V4 run-directory rows remain inert.
There is no migration, compatibility reader, fallback, or dual-write path. The
namespace break is required because V7 adds a new terminal effect lifecycle, a
compound event that changes several effect projections, mandatory plural
uncertainty snapshots, and new fold invariants that V6 cannot interpret.

## Atomic stopped-attempt settlement

The recovery command still requires explicit confirmation that every prior
runner stopped and the applicable app-scoped LMDB mutation owner is held. It
then rebuilds the exact current `STARTED` attempt and selects every active
sibling belonging to that attempt. Active means `PENDING` or `STARTED`; terminal
siblings are omitted and remain unchanged. The active set is unique, sorted
lexically by effect ID, and capped at 16 entries.

V7 adds the append-only terminal:

```text
PENDING -> CANCELLED
```

A verified `PENDING` projection proves that the logical request committed but
the atomic `effect-started` dispatch authorization did not. Recovery therefore
cancels it with the bounded `before-durable-effect-start` reason without
opening or probing a destination. It has no `startedBy`, terminal outcome,
outcome reference, or uncertainty, and it never reopens. `PENDING` and a
concurrent start compete through the same run head, attempt fence, effect
version, and transaction; whichever commits first invalidates the other's
snapshot.

Every `STARTED` sibling is handled through its recovery-only destination
catalog before the ledger can change:

- an exact verifier-backed permanent receipt becomes `COMPLETED` or `FAILED`;
- strict receipt absence becomes `UNCERTAIN`; and
- an unsupported contract, missing or replacement store, path alias, thrown
  probe, corrupt receipt or linked business row, or verifier failure aborts the
  whole operation with zero control-ledger mutation.

Strict `null` is not cancellation. It proves only that this recovery found no
matching permanent receipt for an already authorized adapter start. All probes
are read-only. Recovery cannot reach application source, the adapter executable,
a general catalog resolver, or another physical delivery.

After all probes settle, the runtime rereads the ledger and requires the same
run, invocation, attempt, fence, complete active effect set, versions, starts,
destinations, immutable requests, adapters, and verifier contracts. A changed
contract is a conflict, not a partially valid batch.

`settleStoppedAttemptManagedEffects` then emits exactly one
`attempt-became-uncertain` event. Its `effects` array is the complete canonical
active set. The same provider-neutral transaction applies every effect
disposition and changes the aggregate state:

```text
PENDING          -> CANCELLED
STARTED+receipt  -> COMPLETED | FAILED
STARTED+absence  -> UNCERTAIN
attempt          -> ABANDONED
invocation       -> UNCERTAIN
run              -> BLOCKED
```

Every changed projection receives one shared run sequence. The array order is
canonical serialization, not causal ordering among siblings. Rebuild can never
observe a settled first sibling next to an active sibling from the same batch.
The aggregate remains uncertain even if every managed effect has a verified
terminal because destination receipts cannot establish what arbitrary activity
code did before, after, or between effects.

In V7, every `attempt-became-uncertain` event carries an `effects` array. The
ordinary effect-free stopped-attempt path uses `[]`; compound recovery uses the
exact complete active set. Reducers reject missing, extra, duplicated,
unsorted, stale, or incompatible effect snapshots and reject disagreement
between append-only history, projections, payload references, or registered
verifiers.

## Bounds and closure invariants

The public unresolved-effect cap is
`EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS = 16`. The portable transaction
ceiling remains 100 distinct items, each inline projection is bounded to 64
KiB, and the encoded event payload is bounded to 256 KiB. Settlement and
per-effect cancellation/uncertainty reasons are bounded to 2 KiB.

Count alone is not sufficient. Before a new request is published, a pending
effect is started, or cancellation changes the live attempt, V7 synthesizes the
worst supported future closure: maximum safe-integer sequence/version/time
widths, maximum-sized aggregate and per-effect reasons, and maximum referenced
payload metadata. Admission fails before physical dispatch or payload
publication if the run, invocation, attempt, any effect projection, or compound
event could exceed its encoded limit. A corrupt historical over-limit set is
refused unchanged.

The direct singular `markManagedEffectUncertain` path is now legal only when
that effect is the sole unresolved sibling. This closes the old hole where one
uncertainty transition could block the attempt and strand other active effects.

Recovered outcomes are all normalized and verified before any outcome payload
is published. Their content-addressed references may be written only after the
live expected version, exact set, statuses, and fences pass. A later control
store race can leave unreachable content-addressed payloads for future garbage
collection, but it cannot expose a partial control-ledger settlement.

The existing complete-transcript reconciliation path understands a durably
`CANCELLED` pre-start effect only for a `cancelled`, `failed`, or
`protocol-failed` attempt transcript that includes the exact retained effect
request and omits its result. A successful `completed` transcript cannot omit
the result and cannot reinterpret the cancelled effect as completed. The
physical attempt remains `ABANDONED` after reconciliation.

## Determinism and response loss

The compound transition identity and immutable request digest bind the run,
invocation, attempt, actor, exact retained contract, expected versions, and all
canonical dispositions. Reusing that transition identity with different
contents is a conflict.

If the settlement call throws after the transaction may have committed, the
runtime rebuilds the verified event stream. It reports `changed: true` only if
it proves that this exact transition ID, actor, attempt, aggregate state, effect
IDs, and effect statuses were retained. If that proof is unavailable, the
original error wins. A normal call that replays the existing exact transition
receipt reports `changed: false`; a competing terminal or block is
authoritative but is never attributed to this caller.

Response-loss handling may repeat read-only ledger and destination-receipt
reads. It never invokes an adapter, mutates application state, or turns a stale
`PENDING` snapshot into dispatch authority.

## Source, operator, and SEA behavior

Source and packaged operators share the same selector, recovery helper,
transition contract, redaction, and messages. The schema-v4 recovery member is:

```json
{
  "action": "settled-managed-effect-set",
  "changed": true,
  "managedEffects": [
    {
      "effectId": "remember-a",
      "action": "cancelled-before-start",
      "status": "CANCELLED"
    },
    {
      "effectId": "remember-b",
      "action": "outcome-recovered",
      "status": "COMPLETED"
    },
    {
      "effectId": "remember-c",
      "action": "outcome-uncertain",
      "status": "UNCERTAIN"
    }
  ]
}
```

Rows are sorted by effect ID. They expose no logical request, input value,
destination, store identity, path, receipt, linked business record, evidence,
payload reference, fencing token, or cancellation/uncertainty reason. Operator
messages report only counts. `mayExecute` remains false.

A batch containing only `PENDING` effects does not open application state and
can use the generic no-dispatch proof. If any effect is `STARTED`, this operator
requires the exact built-in LMDB `application-state` / `put-if-absent` adapter,
destination namespace, verifier, and replay-property contract, and opens the
separate application-state store read-only. Unknown destinations fail instead
of being converted into generic uncertainty.

The installed-tarball SEA verifier now seeds mixed source and relocated-SEA
batches containing a `PENDING` effect, a receipt-present `STARTED` effect, a
strict-absence `STARTED` effect, and an already terminal sibling. Its intended
proof is exact source/SEA inspection parity, one compound event, one shared
sequence for changed siblings, no change to the terminal sibling, exact actor
identity, redaction, refusal while the resident owner is active, unchanged
application-state receipts, and execution of the moved SEA with Node absent
from `PATH`. The final result is recorded below rather than inferred from the
fixture design.

## Implementation map

The milestone changes the repository at these conceptual seams:

- execution-ledger contracts, record-key domains, default DB configuration,
  run-directory partitioning, and deterministic identity vectors move to V7;
- the execution-ledger fold and transition writer gain `CANCELLED`, plural
  event snapshots, exact-set atomic settlement, admission bounds, payload
  verification, idempotent replay, and cancelled-effect reconciliation rules;
- managed-effect runtime recovery classifies the complete active set, probes
  every begun destination, closes the probe race, and publishes one redacted
  plural result;
- source and SEA operator selection, lifecycle ownership, schema-v4 views, and
  human messages consume the same compound recovery result;
- the package SEA verifier and focused ledger, managed-effect, operator, CLI,
  DB-configuration, record-key, run-directory, and reconciliation suites cover
  the new namespace and semantic boundary; and
- README, roadmap, quickstart, decision index, ADR 0015 supersession note, and
  ADR 0016 describe the V7 contract and remaining release-blocking crash work.

## Final verification receipt

All final gates used Node 24.13.1 and ran after the implementation and
documentation were fixed:

- **Typecheck/lint/format/diff:** `npm run typecheck -- --pretty false`,
  `npm run lint`, Prettier over every changed Markdown file,
  `node --check scripts/verify-package-sea.js`, and `git diff --check` all
  exited 0. A deliberately broader Markdown-only check also identified seven
  untouched historical files outside the repository lint command; this
  milestone did not rewrite them.
- **Package-content verification:** `npm run verify:package` exited 0 and
  verified 117 files in `wharfie-wharfie-0.0.15.tgz`.
- **Focused V7 recovery matrix:** the six-suite core matrix passed 254/254
  tests across DynamoDB, vanilla, and LMDB. The final operator suite passed
  12/12; the 75/75 managed-effect suite is included in the 254-test core
  count. Typecheck and scoped lint/format checks also passed around those
  focused runs.
- **Complete Jest gate:** `npm test` exited 0 with 71 passing suites and one
  skipped suite, 960 passing tests and one skipped test, and no snapshots.
- **Installed exact-tree tarball and relocated SEA:**
  `npm run verify:package:sea` exited 0. It installed the packed 0.0.15 tree,
  built and moved the Darwin SEA, removed Node from `PATH`, and verified
  source/generated argv, stdio, exit, activity, exact-run operator,
  cancellation, reconciliation, durable ledger-service crash recovery, and
  mixed `PENDING`/receipt/absence atomic settlement semantics. The executable
  was 139,242,960 bytes.
- **Publication check:** after pushing the checkpoint receipt commit, require
  `git rev-list --left-right --count HEAD...origin/agent/strict-manifest` to
  print `0 0`. Resolve the receipt commit with the command in the header rather
  than embedding a self-referential hash in this file.

## Repository and external state

The pre-reset remote was backed up before cleanup by the verified
`archive/2026-07-16/remote/...` tags documented in the project-reset checkpoint.
The parent tip `99699ee2ef79391f78828a67fbd6ca553a746494` remains in this branch's
history. At the last authenticated refresh during this milestone:

- the only live remote branches were `master` and `agent/strict-manifest`;
- the only open pull request was mergeable draft PR #125, with head `99699ee`
  against `master` at `f31595a`; and
- the only open issues were #126 through #132.

Refresh those objects before relying on them. The connected GitHub app worked,
and ordinary Git SSH push authentication worked, but the local `gh` token was
stale.

GitHub reported 130 dependency vulnerabilities: 6 critical, 53 high, 54
moderate, and 17 low. The known clean-install lint defect is still the missing
direct `@typescript-eslint/parser` declaration. This milestone deliberately
does not change `package.json` or the lockfile. Obtain explicit user approval
before making that dependency-only repair.

## Next work

1. Add a real subprocess and relocated installed-tarball SEA crash matrix at
   request publication, durable effect start, destination business commit,
   receipt commit, outcome payload publication, ledger outcome/compound
   settlement, and response delivery. Include mixed siblings, competing starts
   and recovery, process termination rather than injected exceptions, restart
   from disk, exact source/SEA parity, and Node-absent moved-artifact execution.
2. Design destination-specific reconciliation and compensation for
   `UNCERTAIN` effects and blocked sets. Keep automatic redelivery disabled
   until the destination supplies a typed negative/terminal verifier and each
   claimed replay property is substantiated. Compensation or retry must create
   new causally linked work; it must not reopen append-only history.
3. With explicit dependency approval, add the missing parser declaration,
   repair the reported dependency surface deliberately, run clean-install CI,
   and make draft PR #125 green before reviewing the reset stack for merge.
4. Turn the resident lifecycle owner into a real durable worker, then add
   scheduling, linearizable leases/heartbeats, fenced coordinator epochs, and
   recoverable single-coordinator failover.
5. Only after the durable single-node path is adversarially proven, add finite
   cloud capability fulfillment and trusted-node placement. Do not begin with a
   consensus layer, general IaC, a web UI, an agent framework, or a polyglot
   public API.

When resuming, preserve the strongest negative guarantee in this milestone:
probe, contract, store, verifier, race, or over-limit failures leave the entire
active effect set unchanged, and recovery never performs another destination
mutation.
