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

Packaged Linux artifacts additionally expose
`<app> wharfie service install|update|rollback|recover|start|stop|restart|status|uninstall`.
This is a
packaged-only systemd user-service boundary: it requires pre-enabled lingering,
rejects root and custom `XDG_CONFIG_HOME` topology, never accepts unit or
environment overrides, anchors packaged durable state to the operating-system
account instead of ambient `XDG_DATA_HOME` or `HOME`, verifies the live
manager's effective unit, and preserves state and immutable releases on
uninstall. Status schema V2 exposes verified disk/manager wiring as `managed`,
`absent`, `orphaned`, `conflicting`, or `unknown`; human orphan status directs
the operator to `service uninstall`. There is no `service reconcile` verb:
`uninstall` returns `orphan-reconciled` after removing exact residual wiring.
A missing receipt, selector, or fixed unit is repaired only from the exact
durable activation record. Physical wiring with no activation authority is
degraded and never adopted by an execution-capable command.

Update and rollback use a single serialized local activation coordinator.
Update is invoked from the new target SEA; a fresh rollback is invoked from the
currently selected SEA and uses only its retained candidate. After an
ambiguous rollback response, use `service recover` instead of sending another
direction-changing request. A rollback request from the prior/candidate SEA is
rejected because it is indistinguishable from a stale response-loss retry. The
coordinator closes new-run and service-start admission, requires every durable
source run to be terminal, retains one exact prior release, and persists enough
phase state for recovery after a crash. It enables without `--now` and starts
only the exact `ACTIVATING` selection. The exact source has a narrow
`QUIESCING` start exception for safe draining or retention.

First install has no source. Already queued target-revision work is admitted;
foreign-revision nonterminal work leaves the install pending and fenced.
Receipts separate `fulfilled|refused|failed|pending` request status from
`target-active|source-retained|source-restored|in-flight|absent` outcome, and
non-fulfilled results exit unsuccessfully. Uninstall retains the `ACTIVE`
selection, same-revision admission, immutable releases, and tombstone. The same
selected SEA can reinstall without changing activation generation. The
intentional-uninstall tombstone also lets a new SEA automatically reproject and
prove that retained source, then enter the ordinary durable update. Missing
projection state without the tombstone fails closed and requires the exact
selected SEA to repair it.
Source-side service management remains intentionally absent.
