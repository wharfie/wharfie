# Wharfie checkpoint — real-process managed-effect crash matrix

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [V7 atomic managed-effect settlement](2026-07-18-v7-atomic-effect-settlement.md)
- **Authority:** [ADR 0016 — Atomic stopped-attempt managed-effect settlement](../../docs/architecture/decisions/0016-atomic-stopped-attempt-effect-settlement.md)
- **Parent remote tip before this milestone:**
  `f8744a00c7970e55919cda4e9b05439f3b403e42`
- **Implementation commit:**
  `97e7dbed40bd9d4e0f082ffd8e7a0e49e3ef6414`
- **Checkpoint receipt commit:** resolve with
  `git log -1 --format=%H -- llm/checkpoints/2026-07-18-real-process-managed-effect-crash-matrix.md`
- **Scope:** replace exception-only confidence with externally killed child
  processes around the current V7 managed-effect and stopped-settlement
  boundaries, plus one deliberately narrower packaged-operator response-loss
  proof

This is an immutable handoff. Update the live roadmap or add a later dated
checkpoint instead of rewriting it after publication. Wharfie still has no
known downstream users: breaking changes and fresh durable namespaces remain
acceptable when they shorten the path to the intended design. V1 and
V1-through-V6 execution compatibility remain abandoned.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-18-real-process-managed-effect-crash-matrix.md`.
> Read `PROJECT.md`, `ROADMAP.md`, ADRs 0001 through 0016, and this checkpoint
> before changing durable execution. Verify the implementation and checkpoint
> receipt commits on `origin/agent/strict-manifest`, refresh PR #125 and issue
> #129, and use Node 24.13.1. The source/core seven-boundary SIGKILL matrix,
> mixed-set three-boundary SIGKILL matrix, and relocated Node-absent packaged
> recovery response-loss proof are complete. Do not call that packaged durable
> activity crash parity: first build one shared packaged durable-run host, then
> repeat the full activity matrix through the moved SEA. Never split the
> application-state business mutation from its permanent receipt, never
> redispatch retained stopped-attempt work, and claim exactly-once only where a
> destination atomically enforces the stable effect identity with its business
> mutation.

## Product boundary retained

The project still aims to carry intent beyond a local coding session: author a
normal TypeScript CLI, package it as an approachable self-contained executable,
promote it to a durable resident service, and later place work across trusted
machines without requiring Node, containers, Kubernetes, or a hosted
orchestration service on the target.

This milestone does not add scheduling, automatic retries, compensation,
multi-host execution, coordinator replacement, provider fulfillment, or a
polyglot public API. It hardens only the current manual durable managed-effect
path and stopped-attempt operator recovery.

Wharfie promises one authoritative logical terminal, not one physical handler
execution. Arbitrary activity code and unmanaged SDK calls remain at-least-once
or ambiguous. The built-in `application-state` / `put-if-absent` operation may
support an exactly-once statement only because its LMDB destination commits the
stable destination effect ID, business value, and permanent receipt in one
atomic transaction. There is no valid business-only or receipt-only crash
window in that destination contract; describing those as two independent
commit boundaries would manufacture a state the implementation does not allow.

## Source/core durable-run SIGKILL matrix

`test/runtime/managed-effect-crash-subprocess.test.js` starts a real Node child
that owns the real LMDB durable-run session, executes the shared manual ledger
and managed-effect runtime, reports after reaching the durable boundary, then
blocks. The parent sends external `SIGKILL`, waits for the OS exit, reopens
state from disk, and invokes the ordinary operator recovery path. The fixture
uses a fsynced adapter-entry log written before adapter execution so destination
deduplication cannot conceal an accidental redispatch.

| Crash after                                                    | Durable truth recovered after restart                                                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| request payload publication                                    | the unreferenced content-addressed payload remains an orphan; no effect exists and the ordinary attempt becomes blocked uncertain |
| request ledger transaction                                     | the effect is `PENDING`; recovery makes it terminal `CANCELLED` without opening the destination                                   |
| `STARTED` ledger transaction                                   | no receipt exists; strict negative evidence makes the effect `UNCERTAIN` without redispatch                                       |
| destination business-and-receipt transaction                   | the exact permanent receipt recovers the retained `STARTED` effect as `COMPLETED`                                                 |
| outcome payload publication                                    | recovery reuses the already published content reference and commits `COMPLETED`                                                   |
| outcome ledger transaction                                     | the effect remains exactly terminal `COMPLETED`; only the arbitrary attempt becomes blocked uncertain                             |
| helper/host effect response before worker or user continuation | retained delivery evidence and the terminal effect remain exact; only the arbitrary attempt becomes blocked uncertain             |

The last row is intentionally scoped to the managed-effect helper/host return.
It does not claim that a real framed worker received the effect result, resumed
user code, or acknowledged a terminal transcript before the kill. That wider
delivery proof belongs in the future packaged durable-run host matrix.

Across all seven cases, recovery must not add adapter entries, change the
destination business row or receipt, invent a conflicting terminal effect, or
repeat the recovery transition. A second recovery returns `action: "none"` and
`changed: false`. Payload assertions distinguish a legitimate orphan request
payload from a recovered outcome payload that becomes reachable by its exact
existing content reference.

## Stopped mixed-set settlement SIGKILL matrix

`test/runtime/managed-effect-settlement-crash.test.js` seeds one active set with
a `PENDING` effect, a receipt-backed `STARTED` effect, a strict-absence
`STARTED` effect, and an already terminal sibling. A separate real child takes
the application-scoped owner and blocks at each boundary; the parent observes a
fsynced marker while that process is alive, sends `SIGKILL`, and recovers from
disk.

The three boundaries are:

1. recovered outcome payload publication before the compound ledger commit;
2. the one compound `attempt-became-uncertain` transaction after it commits;
3. the recovery helper response after settlement is available.

The pre-commit case exposes zero partial projection changes and reuses the one
published recovered-outcome payload when recovery retries. The post-commit and
post-helper cases replay the retained transaction without another event. All
changed siblings share the compound event sequence; the already terminal
sibling projection is exactly unchanged; application business state and
receipts remain unchanged; and the second operator recovery returns
`action: "none"` with `changed: false`.

## Relocated Node-absent SEA proof and its limit

The installed-package SEA verifier seeds a stopped mixed effect set, runs the
relocated application executable with Node removed from `PATH`, and invokes its
packaged `wharfie recover --json` operator. The response is deliberately made
larger than the unread stdout pipe can drain. The verifier observes the exact
compound event on disk, reads exactly the first response byte from paused
stdout, leaves the oversized remainder paused, proves the SEA is still alive
and mutation ownership has already been released, externally sends `SIGKILL`,
and then runs the same moved SEA recovery command again. Restart returns
`action: "none"` and `changed: false`; the exact run, sibling settlement,
terminal padding effects, and destination receipts do not change.

This proves packaged operator compound recovery across commit-with-lost-response
and process restart. It does **not** prove SEA-originated durable activity crash
parity. The current artifact packages inspect/recover/reconcile/cancel and the
private resident ledger service, while durable managed activity execution still
originates in source `wharfie ops run`. There is no honest way to drive the
seven activity boundaries through the moved SEA until both paths share a
packaged durable-run host.

## Verification status

All final gates passed under exact Node 24.13.1 with npm 11.12.0:

- **Focused real-process matrix:** 2 suites and all 10 tests passed: seven
  durable-run boundaries plus three mixed-set settlement boundaries.
- **Focused regression selection:** 13 managed-effect, durable-run, CLI, and
  worker suites and all 200 tests passed.
- **Static gates:** repository lint, TypeScript checking, child/verifier syntax,
  changed-Markdown formatting, and `git diff --check` passed.
- **Complete Jest/coverage gate:** 73 suites and all 970 enabled tests passed;
  one opt-in suite/test remained skipped.
- **Package-content verification:** all 117 expected files passed.
- **Installed exact-tree tarball and relocated SEA:** passed in 59.39 seconds,
  including the first-response-byte packaged recovery `SIGKILL`/restart leg,
  exact ownership release, locked LMDB, and Node absent from `PATH`. The moved
  Darwin artifact was 139,242,960 bytes.
- **Publication check:** after pushing the implementation and checkpoint
  commits, require
  `git rev-list --left-right --count HEAD...origin/agent/strict-manifest` to
  print `0 0`.

The earlier contended verifier attempt was interrupted after 705.55 seconds
without a result and is not counted. The fresh observed run above is the final
receipt.

## Issue #129 state and next work

This milestone closes the real-process proof for the shared source/core
managed-effect primitive and stopped mixed-set recovery, and it closes the
packaged operator response-loss/restart slice. Issue #129 should remain open
until its broader durable-activity and recovery requirements are either
implemented or explicitly split into follow-up issues.

The immediate prerequisite is one shared packaged durable-run host. It should
make source `ops run` and the generated application use the same durable
activity orchestration path without exposing a second state model. After that
exists, repeat all seven activity boundaries through the relocated SEA with
Node absent from `PATH`, including real framed-worker response delivery and user
continuation boundaries. Preserve the existing no-redispatch and exact receipt
assertions.

Then design destination-specific reconciliation and compensation for retained
`UNCERTAIN` effects before enabling retry. A retry or compensation must be new,
causally linked append-only work; it must not reopen the settled V7 history.
Automatic redelivery remains invalid until the destination exposes a typed
negative or terminal verifier and the claimed replay property is substantiated.

The dependency/audit cleanup remains separate. The known direct parser
declaration is still intentionally untouched pending explicit user approval;
this crash milestone must not smuggle package or lockfile changes into the
proof.
