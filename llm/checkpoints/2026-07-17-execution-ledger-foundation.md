# Wharfie checkpoint — execution ledger foundation

- **Date:** 2026-07-17
- **Branch:** `agent/strict-manifest`
- **Published parent:** `354e9c1` (`Record hosted Linux SEA proof`)
- **Status:** an uncommitted, adapter-tested first append-only ledger foundation
  is ready for review. It has deliberately not yet replaced the legacy
  operation runner or changed the public CLI.

This is a historical handoff. Preserve prior checkpoints; update the live
roadmap or create another dated checkpoint for later work.

## Resume instructions

Read `PROJECT.md`, `ROADMAP.md`, ADRs 0010 and 0011, this checkpoint, and the
preceding `2026-07-17-hosted-linux-sea-proof.md`. Inspect the worktree and the
draft PR before changing code. Breaking changes remain authorized because
there are no known downstream users.

The user authorized commits and pushes, but did **not** authorize changing
`package.json` or `package-lock.json` to repair the direct
`@typescript-eslint/parser` declaration. Do not make that dependency change
without explicit approval.

## What exists now

New isolated foundation:

- `src/core/lib/ledger/record-key.js` defines typed, base64url-safe ledger keys
  and lexically ordered fixed-width event sequences.
- `src/core/lib/db/tables/execution-ledger.js` provides one manual,
  single-activity `run → invocation → attempt` state machine over the existing
  transactional DB abstraction. It does not extend the transitional
  `Operation` store.
- Each accepted transition atomically writes an immutable content-bound event,
  run head, affected projection(s), and idempotency receipt. Folding validates
  every event, receipt, projection, sequence, revision binding, generation,
  and fence before authorizing a later mutation.
- Attempt IDs are internally derived from run, invocation, and generation;
  callers cannot supply them. `CLAIMED → STARTED` is durable before a runtime
  adapter may receive a start frame.
- A terminal commit requires complete host-collected Protocol-v1 evidence, not
  a bare terminal frame. The ledger rebuilds and validates the transcript,
  including start identity, ordering, cancellation/deadline rules, effect
  correlation, terminal identity, and transcript summary. This first manual
  path accepts only `completed`, `failed`, and `protocol-failed` logical
  terminals; it deliberately rejects `cancelled` until cancellation itself is
  a durable ledger decision.
- A lost `CLAIMED` attempt may be abandoned back to `RUNNABLE`; a lost
  `STARTED` attempt becomes `ABANDONED`/`UNCERTAIN` and blocks the run. There
  is no automatic retry after `STARTED`.

Focused tests cover DynamoDB's in-memory contract double, vanilla persistence,
and LMDB. They exercise receipts, races/fences, terminal outcomes, malformed
protocol evidence, corruption/rebuild failure, pre-start recovery, post-start
uncertainty, and the inline payload boundary.

## Important scope boundary

This is not yet an end-to-end durable service:

- `ops run`, queues, services, and the legacy mutable graph runner are still
  untouched. Do not claim durable CLI execution until one manual command is
  routed through this ledger and calls `markAttemptStarted` immediately before
  the existing framed runtime adapter.
- There is no local ledger configuration/singleton, resident-service lifecycle,
  lease, heartbeat, coordinator replacement, timer, queue, effect, retry,
  cancellation, operator intervention, or multi-node behavior yet.
- Inline projections/evidence currently cap at 64 KiB; event payloads have a
  separate 256 KiB bound so normal duplicated snapshots remain possible. A
  Protocol-v1 frame can be larger than this. If a received terminal cannot fit
  durably, the terminal commit rejects and the coordinator must record the
  attempt as `UNCERTAIN`; it must never invent success. Immutable
  content-addressed payload references are required before treating large
  activity outputs as a supported durable path.

## Verification completed locally

- `npm run typecheck`
- focused ESLint for the new source
- `node test/run-jest.js --runInBand test/runtime/execution-ledger-record-key.test.js test/runtime/execution-ledger.test.js`

The established full CI remains independently red only for the user-deferred
clean-install parser declaration. The hosted Linux SEA proof remains recorded
in the preceding checkpoint.

## Next work

1. Review this foundation, then commit and push it to draft PR #125.
2. Add a separate local ledger store/path and route exactly one manual activity
   through it, retaining the protocol evidence and marking delivery/storage
   failures after `STARTED` as `UNCERTAIN`.
3. Design immutable payload references before broadening activity result/input
   support; do not hide the current inline cap with a retry.
4. Only then consider resident-service lifecycle and explicit local recovery.
