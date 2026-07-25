# CLI

The shipped Wharfie source CLI lives here. Its top-level command groups are
`app`, `ops`, and the experimental `deployment`. Durable source workflow
creation is the flat command
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

The provider-backed `deployment` group has exactly five leaves: `plan`,
`apply`, `inspect`, `reconcile`, and `destroy`. Source plan and direct apply
accept a canonical DeploymentProfileV2 operator document separately from the
app manifest:

```text
wharfie deployment plan <deployment> --profile <canonical-profile.json> --control-policy <policy> [--dir <app-dir>] [--output-dir <package-dir>] [--json]
wharfie deployment apply <deployment> --profile <canonical-profile.json> [--dir <app-dir>] [--output-dir <package-dir>] [--control-policy <policy>] [--json]
wharfie deployment apply --plan <plan.json> [--control-policy <policy>] [--json]
wharfie deployment inspect <deployment-instance> --region <region> [--control-policy <policy>] [--json]
wharfie deployment reconcile <deployment-instance> --region <region> [--confirm-coordinator-stopped] [--control-policy <policy>] [--json]
wharfie deployment destroy <deployment-instance> --region <region> [--control-policy <policy>] [--json]
```

The same five leaves are mounted at `<app> wharfie deployment ...`; the
packaged parent accepts neither `--dir` nor `--output-dir`. Source plan and
direct apply package a selected SEA and durably pre-stage it. A later source
`apply --plan` and source reconcile validate exact durable staged evidence.
Packaged plan/apply and non-destroy reconcile instead prove the SEA running the
command; active destroy recovery remains durable-only.
Both modes use the operator's ordinary AWS credential chain; neither the
canonical profile nor the reusable plan contains credentials. This surface is
experimental and has focused mock evidence, not a clean-account deployment or
complete resident service-readiness proof.
Create canonical profiles with the narrow
`@wharfie/wharfie/deployment-profile` Node authoring API. Source plan JSON
includes durable staged-artifact evidence and is accepted only by source
`apply --plan`; packaged plan JSON is accepted only by an exact matching SEA.
The two exact plan envelopes are intentionally not interchangeable.
Plan requires an explicit control policy because source planning may package,
stage, and create bootstrap control state. Direct apply defaults to `bootstrap`;
prepared apply and the three located commands default to `require-active`.
Source `apply --plan` rejects `--dir` and `--output-dir`. Scalar selectors may
be supplied only once, and a returned active head is an incomplete nonzero
result rather than success.

Packaged Linux artifacts additionally expose
`<app> wharfie service install|converge|update|rollback|recover|start|stop|restart|status|uninstall`.
This is a
packaged-only systemd user-service boundary: it requires pre-enabled lingering,
rejects root and custom `XDG_CONFIG_HOME` topology, never accepts unit or
environment overrides, anchors packaged durable state to the operating-system
account instead of ambient `XDG_DATA_HOME` or `HOME`, verifies the live
manager's effective unit, and preserves state and immutable releases on
uninstall. Status schema V3 preserves the verified `managed`, `absent`,
`orphaned`, `conflicting`, or `unknown` disk/manager wiring view and adds one
required `desiredConvergence` V1 decision bound to the exact invoking SEA,
application, and unit. Its disposition is `authorized`, `conflict`, or
`unknown`; authorized decisions name exactly `physical-absence`,
`durable-install`, `durable-change`, or `durable-active`, while conflict and
unknown decisions carry a null basis. Human orphan status directs the operator
to `service uninstall`. There is no `service reconcile` verb: `uninstall`
returns `orphan-reconciled` after removing exact residual wiring. A missing
receipt, selector, or fixed unit is repaired only from the exact durable
activation record. Physical wiring with no activation authority is degraded
and never adopted by an execution-capable command.

Update and rollback use a single serialized local activation coordinator.
`service converge` is the retry-safe desired-artifact entrypoint for host
automation: it recovers a non-rollback transition before installing, repairing,
or making one ordinary update attempt toward the exact invoking SEA, and it
preserves non-fulfilled settlements for later retry. It can replace an
in-flight first install of another artifact and restart an exact receipt-backed
ACTIVE projection with stopped, failed, or degraded liveness after clearing
systemd failure/start-limit state when present. It refuses missing, corrupt, or
contradictory authority and never expresses or recovers rollback.
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
