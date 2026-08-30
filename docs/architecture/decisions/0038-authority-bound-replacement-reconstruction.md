# 0038 — Authority-bound replacement reconstruction

**Status:** Accepted; internal reconstruction slice implemented · **Date:** 2026-08-29

## Context

[ADR 0037](0037-single-region-dynamodb-rvn-coordinator-replacement.md)
certifies a narrow single-Region DynamoDB authority replacement primitive and
an internal resident supervisor. Advancing the coordinator epoch fences stale
ledger commits, but authority replacement alone does not decide which retained
work may be observed, recovered, or dispatched.

The ready-work table cannot answer that question. It is a replaceable liveness
index and deliberately omits terminal, blocked, signal-waiting, and framework-
owned successor runs. A replacement must start from the verified append-only
ledger history, remain source-free, and finish before schedules, dispatch, or
resident READY can admit work.

## Decision

### Inventory the complete verified history

A replacement inventories `listRuns` for the exact application and calls
`rebuildRun` for every directory item across every revision and run kind. It
rejects malformed pages, repeated runs or cursors, cross-application rows,
missing rebuilds, directory/view disagreement, unrecognized lifecycle shapes,
or authority loss.

The reconstruction implementation performs two passes with a bounded returned
report. The first validates all history before any repair. The second must
produce the same ordered SHA-256 fingerprint while it repairs each canonical
expected ready-work locator. Exact duplicate-run and cursor detection retains
sets proportional to the inspected history.
A changed fingerprint leaves startup closed. Reports contain only counts and a
fixed maximum of 50 redacted samples; retained requests, payloads, effects, and
authority identities are not disclosed.

### Encode replay policy explicitly

Every rebuilt run receives a finite classification and a separate startup
policy:

| Retained state | Policy |
| --- | --- |
| Current-revision manual/workflow `RUNNABLE` | `dispatchable-after-fresh-claim` |
| Current-revision `CLAIMED` attempt | `recover-pre-start-claim` |
| Current-revision `STARTED` attempt | `started-outcome-unknown` |
| Waiting workflow timer | `framework-timer-cas` |
| Waiting workflow signal | `wait-signal` |
| Blocked run | `blocked-reconciliation` |
| Terminal run | `terminal` |
| Nonterminal active/waiting manual or workflow work from a non-current revision | `parked-revision` |
| Runnable or started managed-effect successor | `effect-successor-operator-only` |

Classification grants no execution authority. In particular, reconstruction
does not load application source, invoke an activity, execute or probe a
managed effect, fire a timer, deliver a signal, or run a successor adapter.
Ordinary worker code must still rebuild the locator's run and win its normal
fenced claim or continuation transition.

### Repair expected locators, not authoritative history

For every manual and workflow run, reconstruction calls
`repairReadyWork` under the replacement's exact stable authority token. The
ledger independently rebuilds the run and condition-checks its head while
creating the canonical `ACTIVITY`, `RECOVERY`, or `TIMER` locator. Signal,
blocked, and terminal states have no expected locator. Managed-effect
successors remain operator-owned and are never projected as generic resident
work.

This history pass supplies no observed stale row, so it cannot discover an
extra obsolete locator at another ready-work key. The later worker still
rebuilds every observed locator and uses the same repair primitive to remove
that exact stale row without dispatching it.

The returned locator kind must agree with the validated inventory. A lifecycle
race therefore fails startup rather than silently changing policy. After both
passes, the bound ledger performs a final strongly consistent authority check.

### Preserve the separate application-state boundary

The internal startup composition is fixed as:

```text
topology proof → authority supervisor → reconstruction →
application-state preparation → resident dispatcher body
```

The supervisor renews authority across the whole sequence and shares one abort
signal. The ledger strongly reasserts the stable token again after application-
state preparation and immediately before dispatcher admission. Application-
state preparation remains a required, separate callback because it has its own
destination-local authority and cross-store handoff.
The reconstructed wrapper has no production call site. Existing resident,
submission, recovery, workflow, and application-state DynamoDB product gates
remain closed and LMDB-only.

## Consequences

- A replacement can recover complete, explicit knowledge of runnable,
  in-flight, waiting, blocked, terminal, old-revision, and successor work
  without trusting a queue projection.
- Missing or corrupt canonical current locators converge idempotently under
  the exact replacement authority while later dispatch still requires a fresh
  fenced transition.
- A full history walk is startup work and may be expensive. The internal helper
  assumes admissions and schedule mutation are already stopped; product
  activation must establish a durable quiescence barrier across both passes.
  The fingerprint detects inter-pass changes but is not a transactional global
  snapshot.
- Exact duplicate detection uses memory proportional to the number of runs and
  page cursors even though the returned report and sample list are bounded.
- DynamoDB history currently references a local execution-payload store. A
  different node cannot rebuild runs unless the exact retained payload volume
  or an equivalent certified payload distribution boundary is available.
- The implementation does not distribute `tableResourceId`, establish a
  cross-node service owner, authorize revisions on other nodes, or resolve the
  application-state handoff. Those remain prerequisites for product activation.
- Deterministic crash proofs at assignment, authored start, managed-effect
  settlement, and terminal commit remain required before a public replacement
  path can claim end-to-end recovery.

## Rejected alternatives

### Reconstruct from ready-work alone

Rejected because the index intentionally excludes states a replacement must
understand and is neither execution authority nor an integrity-complete
inventory.

### Recover or dispatch while discovering history

Rejected because a malformed later page could otherwise be discovered only
after new physical work had already been admitted.

### Automatically replay started authored work

Rejected because durable `STARTED` means physical execution may have begun.
Without exact terminal or destination evidence, replay could duplicate unsafe
work. The policy remains outcome-unknown and recovery-only.

### Treat application-state preparation as part of the ledger scan

Rejected because the application-state destination is a separate transactional
domain with its own retained identity and authority barrier.
