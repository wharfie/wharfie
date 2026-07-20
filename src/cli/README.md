# CLI

The shipped Wharfie source CLI lives here. Its top-level command groups are
`app` and `ops`. Durable source workflow creation is the flat command
`wharfie ops start --workflow <workflow-id> --idempotency-key <stable-key>`;
the packaged equivalent is `<app> wharfie start ...` and deliberately has no
`--dir` override. A bounded linear plan may contain ordinary activity,
persisted timer, and current-wait signal steps. The exact-revision resident
executes activities and fires due timers as framework work; there is no public
timer-fire command.

Deliver a signal with
`wharfie ops signal --run-id <run-id> --signal <signal-step-id> --delivery-id <stable-delivery-id> --payload <json>`
or packaged `<app> wharfie signal ...`. All four values are required. Reuse the
same delivery ID and exact request after response loss. Only the signal named
by the current cursor is accepted; `early-signal`, `unexpected-signal`, and
`late-signal` are durable, exactly replayable rejections rather than entries in
an early-signal inbox. Reusing a delivery ID with changed contents conflicts.

Generic exact-run `inspect`, confirmed `recover`, evidence-backed `reconcile`,
and run-level `cancel` are workflow-aware. JSON inspection uses the schema-v7
redacted view with safe timer, signal-wait, and signal-delivery lifecycle state,
whose dedicated projection rows omit signal payloads, payload references,
digests, and actor fields. The existing event history retains its safe actor
metadata. Branches, schedules, and managed-effect workflow successors remain
unsupported.
