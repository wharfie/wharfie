# Wharfie checkpoint — V8 destination-finalized effect reconciliation

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [relocated-SEA mixed-settlement SIGKILL matrix](2026-07-18-relocated-sea-mixed-settlement-sigkill-matrix.md)
- **Published branch tip before this slice:**
  `5414a25519ecb652886192b9afc36bf78c0c6483`
- **Preserved remote parent before the preceding implementation:**
  `6276e0513e9a4cab39ebb98c8a252af6a186f41c`
- **Implementation commit:**
  `a831b2e89c5d503f50c19d2d5737983901b21080`
- **Checkpoint receipt commit:** resolve after publication with
  `git log -1 --format=%H -- llm/checkpoints/2026-07-18-v8-destination-effect-reconciliation.md`
- **Scope:** give one retained `UNCERTAIN` managed effect a typed,
  destination-enforced final disposition without reopening the abandoned
  physical attempt, redispatching application code, or weakening the prior
  V7 stopped-attempt crash boundary

This is an immutable handoff. Update the live roadmap or add a later dated
checkpoint instead of rewriting it. Wharfie has no known downstream users:
breaking changes and fresh durable namespaces remain the preferred route to
the intended design. V1 compatibility remains abandoned. Package metadata was
intentionally left untouched.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-18-v8-destination-effect-reconciliation.md`. Read
> `PROJECT.md`, `ROADMAP.md`, ADRs 0001 through 0017, the parent checkpoint,
> and this checkpoint before changing durable execution. Verify the published
> implementation and checkpoint receipts on `origin/agent/strict-manifest`,
> then inspect draft PR #125, issue #129, and the current GitHub Actions run.
> Use exact Node 24.13.1 and npm 11.12.0. V8 now destination-finalizes one
> retained uncertain application-state effect as a receipt-backed terminal or
> permanent `NOT_APPLIED`, while its physical attempt remains `ABANDONED`, its
> invocation remains `UNCERTAIN`, and its run remains `BLOCKED`. Next define
> append-only, causally linked successor retry and forward-compensation work
> with fresh identities and no generic inverse; do not reopen V8 history or
> silently redispatch the abandoned attempt. Package metadata still requires
> explicit user approval before declaring `@typescript-eslint/parser`.

## Product boundary retained

Wharfie carries intent beyond a local coding session: a normal TypeScript CLI
can become one approachable portable SEA, then remain resident as a durable
service, and later coordinate work across trusted machines without requiring
Node, containers, Kubernetes, or a hosted orchestration service on the target.
The initial mesh trusts every enrolled node and may use one coordinator so long
as its durable truth can recover after that coordinator fails.

Wharfie is not general cloud infrastructure-as-code. A produced SEA may accept
the user's ordinary provider credentials and create the finite nodes and
resources required by Wharfie abstractions. Node/TypeScript remains the
control-plane and application model; explicit native bindings or WASM seams
may serve measured hot paths without promising general multi-language support.

Wharfie promises one authoritative logical terminal, not one guaranteed
physical handler execution. Arbitrary activity code and unmanaged SDK calls
remain at-least-once or ambiguous. Exactly-once-at-destination statements are
limited to finite adapters that atomically commit a stable destination effect
identity with their business mutation or a mutually exclusive permanent
negative closure.

## Fresh semantic namespaces

Destination-finalized reconciliation moves current execution authority to
ledger schema V8 under `ledger/v8/`, the default
`wharfie-execution-ledger-v8` table, and the V6 run-directory partition. Event,
transition, attempt, effect-key, destination-effect, manual-run, and directory
identity domains are fresh. V1 through V7 ledger records and V1 through V5
directory rows remain inert; there is no migration, reinterpretation, or
dual-write path. The completed V7 milestones remain historical proof of the
stopped-attempt settlement boundary that V8 supersedes rather than rewrites.

The built-in destination similarly moves to application-state V2. Its default
table is `wharfie-application-state-v2`; records use the
`application-state/v2/`, `identity/v2`, `value/v2`, `receipt/v2`, and
`resolution/v2` key and hash domains. The adapter and destination are version
2. Positive evidence uses `application-state-put-if-absent-receipt` version 2;
negative evidence uses `application-state-put-if-absent-not-applied` version 2.
V1 writers cannot mutate or substantiate V2 truth.

## Destination-finalized semantics

Receipt absence remains only a read-time observation and leaves a `STARTED`
effect `UNCERTAIN`. Application-state V2 instead makes two durable transactions
compete for the exact destination effect contract:

- normal `put-if-absent` atomically commits or substantiates the business
  outcome and a permanent positive receipt only while no negative resolution
  exists; or
- reconciliation atomically commits a permanent `not-applied` resolution only
  while no positive receipt exists.

The first valid decision wins. A receipt that wins yields its verified
`COMPLETED` or `FAILED` outcome. A negative resolution that wins permanently
bars this destination effect ID from applying and yields ledger status
`NOT_APPLIED`. The negative evidence binds the destination effect, contract
digest, resolution digest, exact `absent` or `present-other` business
observation, and fixed disposition. It does not claim that another effect or
unmanaged caller never touched the same application key.

One append-only `uncertain-effect-reconciled` event changes only the target
effect projection. The original physical attempt remains byte-identical
`ABANDONED` with its original uncertainty evidence; the invocation remains
`UNCERTAIN`; the run remains `BLOCKED`; sibling effects remain unchanged. Run
and invocation versions and sequences advance because the new event belongs to
their aggregate. Rebuild rehashes and synchronously verifies the immutable
positive or negative evidence without opening the destination.

## Operator boundary

The shared core boundary is mounted as source
`wharfie ops reconcile-effect` and packaged
`<app> wharfie reconcile-effect`. Both require `--run-id`, `--effect-id`, a
stable `--reconciliation-id`, and `--confirm-runner-stopped`; `--reason` and
`--json` are optional. The command holds the ordinary exclusive LMDB mutation
owner, validates the embedded application and exact retained store, and
reconstructs the complete Activity Protocol request from immutable ledger
semantics before consulting a reconciliation-only catalog.

That catalog can read or finalize only the retained destination contract. It
cannot load application source, resolve or execute the normal adapter,
redispatch activity code, or accept an operator-selected lifecycle result.
The JSON response includes the redacted run, invocation, attempt, effect, and
history lifecycle view. Its nested `effectReconciliation` metadata exposes
exactly the reconciliation ID, effect ID, resulting status, and whether this
invocation changed durable truth. It redacts request values, paths, store and
destination identities, receipts, negative resolutions and evidence, fences,
and the private reason.

Repeating the same reconciliation ID returns the retained, verified ledger
reconciliation and result. Once the ledger event is durable, replay
short-circuits without reopening the destination, including after later
attempt terminalization. A different reconciliation ID for that terminal
effect conflicts.

## Crash and race proof

The focused application-state, ledger, operator, and CLI tests exercise the
first-wins transaction, immutable evidence, append-only fold, ownership and
fencing rules, sibling preservation, response-loss replay, and source/packaged
command shape. Two deliberately stale-read interleavings close subtle races:

1. after a simulated pre-commit adapter error, the losing writer pauses on a
   stale business read while a concurrent writer commits the exact positive
   receipt; the first writer rereads authoritative destination truth and
   returns that receipt rather than inventing a conflict or negative result;
2. the finalizer pauses after a stale disposition/business read while a normal
   writer atomically commits the business value and receipt; the finalizer
   returns the receipt winner and does not retain a contradictory negative
   resolution.

The source-level operator proof also covers a late exact receipt becoming
`COMPLETED`, destination resolution committed before a simulated lost ledger
append, and ledger reconciliation committed before readback/output. In the
first response-loss case, retry reuses the permanent destination resolution
and appends one `NOT_APPLIED` event. In the second, same-ID retry returns
`changed: false` without another event or destination access. Stale execution
is fenced after a negative resolution, and altered contracts, evidence,
digests, uncertainty links, versions, owners, or verifier registrations fail
closed.

The relocated-SEA verifier now proves four uncertain sibling dispositions: one
late receipt, one real `SIGKILL` after destination finalization but before
payload publication, one real `SIGKILL` after the content-addressed evidence
payload is published but before the ledger append, and one real `SIGKILL`
after the ledger mutation but before operator output. The orphan-window replay
reuses the exact published payload rather than creating a second object. The
matrix guards against authored CLI/activity dispatch, the normal effect
adapter, and low-level normal destination execution, and checks exact
projection deltas, payload reachability, redaction, replay, Node absence, and
exclusive LMDB owner recovery.

## Verification snapshot

Verified before this handoff under exact Node 24.13.1:

- the complete Jest run passed 75 suites with one suite skipped and 1,006 tests
  with one test skipped;
- the combined application-state V2 effect/store run passed all 38 tests,
  including unrestricted LMDB reopen coverage;
- focused destination reconciliation passed across DynamoDB, vanilla, and
  LMDB adapters (3 of 3);
- the full execution-ledger operator integration run passed all 15 tests;
- the repository lint and typecheck gates passed;
- package-surface verification passed with 121 published files;
- `git diff --check` passed;
- the real relocated SEA passed the original eight-boundary managed-effect
  `SIGKILL` matrix, the three-boundary mixed-settlement matrix, and the new
  four-disposition effect-reconciliation matrix from the late receipt through
  destination, orphan-payload, and ledger-response crash windows; and
- the verified relocated Darwin SEA was 141,868,368 bytes and ran with Node
  unavailable on `PATH`.

The complete Jest run took 94.063 seconds.

`package.json` and `package-lock.json` remain untouched.

GitHub Actions run #476 successfully completed its prior SEA verifier legs; its
only remaining failure is lint being unable to load the undeclared direct
`@typescript-eslint/parser` dependency. This is a package-declaration blocker,
not evidence of a reconciliation or packaging failure. Per the explicit user
boundary, do not change `package.json` or `package-lock.json` until dependency
approval is granted.

## Remaining successor work

Reconciliation records what happened to the original effect; it does not
resume the abandoned invocation, retry the handler, compensate the business
mutation, or unblock the run. The next slice must define append-only, causally
linked successor retry and forward-compensation policy/work from the original
run, invocation, effect, uncertainty event, and reconciliation event.

Every physical successor receives fresh work, effect, and destination effect
identities and its own destination fence. Policy may authorize successors only
from verified dispositions and substantiated `pure`, `idempotent`, or
`transactional` properties; begun in-process handlers remain `unsafe` by
default. Application-state `put-if-absent` has no generic inverse, so
compensation must be an explicit finite forward effect with its own
preconditions, ownership semantics, transaction, and verifier. The runtime
must never delete a value speculatively or rewrite the original effect as
`COMPENSATED`.

After successor semantics, add workflow continuations, scheduling decisions,
durable outputs, and a truly persistent resident worker. Only after explicit
dependency approval should the parser declaration be repaired and PR #125 be
made green. Coordinator failover, provider fulfillment, and trusted multi-node
placement remain later milestones.
