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

With `--json`, source and packaged durable operations emit the same
schema-versioned camelCase receipt for the same immutable decision:
`wharfie.execution-ledger.activity-run`,
`wharfie.execution-ledger.activity-submit`,
`wharfie.execution-ledger.workflow-start`, or the existing
`wharfie.execution-ledger.signal`. Activity and start receipts bind app,
revision, run, and public request identity, then expose only safe lifecycle and
replay state. Signal receipts retain accepted and rejected outcomes; an
unknown-run receipt is an explicit unpersisted absence refusal without invented
app scope. Human tables are a separate snake_case view, not a machine schema.
Failed/blocked/in-progress runs, rejected signals, and unknown-run refusals
still emit their receipt before exiting nonzero; failures before a durable
decision or explicit absence emit no JSON document.

Source `wharfie app package` also has a stable machine boundary. Success emits
exactly one schema-version 1 `wharfie.application.package` JSON receipt, pretty
by default or compact with `--no-pretty`. It binds the application and revision
to a canonical target-sorted artifact list containing content identity,
target, digest, size, and immediate local executable/sidecar paths. It does not
serialize the complete internal revision or artifact records and does not
grant deployment authority. The receipt is a projection of the package
operation's prior final-byte and canonical sidecar/owning-revision record
association; it is not independent verification, and its paths are local
discovery conveniences. Packaged and selected-artifact consumer boundaries
separately verify the executable's embedded revision/runtime metadata.

During packaging, ordinary manifest/build writes and Wharfie-owned build-tool
output are routed to stderr so stdout remains the receipt. Authored code is
trusted rather than sandboxed; deliberately writing directly to file
descriptor 1 or leaving stdout-producing work unawaited violates this command
contract.

Discover retained durable runs with
`wharfie ops list [--dir <app-dir>] [--limit <1..100>] [--cursor <opaque>] [--json]`
or packaged
`<app> wharfie list [--limit <1..100>] [--cursor <opaque>] [--json]`.
The source command derives app scope from the selected application directory;
the packaged command uses its embedded app identity. Both list that app's runs
across revisions in newest-first creation order. Pages default to 50 rows and
are capped at 100. Cursors are opaque and app-scope-bound. Listing opens the
control store read-only, reports a missing store as an honest empty page without
creating it, and verifies every directory row against its rebuilt run.

Schema-v1 JSON has kind `wharfie.execution-ledger.run-page`, authority `none`,
non-authoritative discovery semantics, verified integrity, `scope`, redacted
`items`, and a string-or-null `nextCursor`. Human and JSON output omit payloads,
evidence, fences, and filesystem paths. The listing grants no scheduling,
cancellation, or mutation authority.

Read one exact physical attempt's retained logs with
`wharfie ops logs --app-id <app-id> --run-id <run-id> --attempt-id <attempt-id> --confirm-sensitive-output [--limit <1..100>] [--cursor <opaque>] [--json]`
or packaged
`<app> wharfie logs --run-id <run-id> --attempt-id <attempt-id> --confirm-sensitive-output [--limit <1..100>] [--cursor <opaque>] [--json]`.
Source mode takes the application ID directly and does not load current
application source. Packaged mode binds the app ID to the executable. Operating
system access controls local stores; a configured provider-backed control
adapter additionally uses its ordinary credentials and IAM. These are the
authorization boundaries; `--confirm-sensitive-output` is mandatory disclosure
consent, not authentication, and Wharfie adds no served log API.

Each page re-verifies the exact run and historical attempt, the complete
hash-linked retained log chain, and every content-addressed payload before
emitting anything. Pages are ascending, default to 50 entries, cap at 100, and
freeze the first request's verified prefix; later appends require a fresh
no-cursor request. Schema-v1 JSON kind
`wharfie.execution-ledger.activity-log-page` is explicitly
`application-sensitive-unredacted`, non-authoritative diagnostic evidence.
Serialized JSON and human message/field values are terminal-inert JSON text
without changing parsed raw values. Outside raw messages and fields—which may
themselves contain any secret or internal-looking value—the page adds no
Wharfie-owned fences, storage IDs, hashes, or payload references.

Read one run's verified logical output snapshot with
`wharfie ops output --app-id <app-id> --run-id <run-id> --confirm-sensitive-output [--json]`
or packaged
`<app> wharfie output --run-id <run-id> --confirm-sensitive-output [--json]`.
Source mode takes the exact app ID without loading current authored source;
packaged mode binds the embedded app ID and can inspect older revisions of
that app. The confirmation is disclosure consent, not authentication or
execution authority. The read-only default does not create a missing local
control store.

Schema-version 1 kind `wharfie.execution-ledger.run-output` is explicitly
`application-sensitive-unredacted`, declares authority `none`, and contains
the exact app/revision/run scope, polling status/version/last-sequence state,
the complete verified workflow output prefix, and a nullable aggregate
terminal. Running and blocked runs have no terminal; terminal runs disclose a
completed result or structured error. The whole document is reverified,
bounded to 64 MiB, recursively frozen, and rendered terminal-safely before
output. Failure emits one fixed diagnostic and no partial snapshot. Outside
raw application-controlled values—which may themselves contain any secret or
internal-looking value—Wharfie adds no private framework metadata such as
payload references, evidence, fences, actors, physical attempt identities, or
storage paths. Poll by rerunning the command. There is no paging, watch,
export, redaction, atomic-display, or exactly-once-display claim, and ordinary
`inspect` remains redacted.

Generic exact-run `inspect`, confirmed `recover`, evidence-backed `reconcile`,
and run-level `cancel` are workflow-aware. JSON inspection uses the schema-v8
redacted view with safe timer, signal-wait, and signal-delivery lifecycle state,
whose dedicated projection rows omit signal payloads, payload references,
digests, and actor fields. The existing event history retains its safe actor
metadata. Branches, schedules, managed-effect workflow successors, and public
log tail/search remain unsupported.

The legacy source `deployment` group still has five AWS-oriented leaves:
`plan`, `apply`, `inspect`, `reconcile`, and `destroy`. Source plan and direct
apply accept a canonical DeploymentProfileV2 operator document separately
from the app manifest:

```text
wharfie deployment plan <deployment> --profile <canonical-profile.json> --control-policy <policy> [--dir <app-dir>] [--output-dir <package-dir>] [--json]
wharfie deployment apply <deployment> --profile <canonical-profile.json> [--dir <app-dir>] [--output-dir <package-dir>] [--control-policy <policy>] [--json]
wharfie deployment apply --plan <plan.json> [--control-policy <policy>] [--json]
wharfie deployment inspect <deployment-instance> --region <region> [--control-policy <policy>] [--json]
wharfie deployment reconcile <deployment-instance> --region <region> [--confirm-coordinator-stopped] [--control-policy <policy>] [--json]
wharfie deployment destroy <deployment-instance> --region <region> [--control-policy <policy>] [--json]
```

Package a cloud-capable operator SEA with `wharfie app package
--self-deployable`. Its packaged deployment surface deliberately has only
AWS and Hetzner preview, apply, status, and destroy:

```text
<app> wharfie deployment preview --deployment <logical-id> --provider aws --region <region> --allow-ssh-from <ipv4/32>... [--data-root <absolute>] [--json]
<app> wharfie deployment preview --deployment <logical-id> --provider hetzner --location <name> --allow-ssh-from <ipv4/32>... [--data-root <absolute>] [--json]
<app> wharfie deployment apply --deployment <logical-id> --provider aws --region <region> --allow-ssh-from <ipv4/32>... [--data-root <absolute>] [--json]
<app> wharfie deployment apply --deployment <logical-id> --provider hetzner --location <name> --allow-ssh-from <ipv4/32>... [--data-root <absolute>] [--json]
<app> wharfie deployment status --deployment-instance <id> [--data-root <absolute>] [--json]
<app> wharfie deployment destroy --deployment-instance <instance-id> --provider aws [--data-root <absolute>] [--json]
<app> wharfie deployment destroy --deployment-instance <instance-id> --provider hetzner [--data-root <absolute>] [--json]
```

The SEA reads the authenticated embedded Linux payload and application
revision, creates the fixed small single-node systemd-user intent, and applies
or recovers it through durable local authority. Repeat `--allow-ssh-from` for
each operator address. AWS preview/apply requires exactly `--region`; Hetzner
preview/apply requires exactly `--location`. AWS uses the ordinary credential
chain and Hetzner reads `HCLOUD_TOKEN` from the ambient process. There is no
credential option and result output contains no credential data. Use a
dedicated Hetzner project for this preview because its token is project-wide.

Preview validates the embedded authority and performs only provider identity,
describe, and list reads plus a side-effect-free local journal read. It does
not create local state or cloud resources. Its point-in-time receipt separates
referenced infrastructure from managed resource roles and reports the semantic
steps a later apply would evaluate. Apply re-plans before generating and
persisting its exact resource identities, SSH material, and cloud-init.

Status reads the exact local journal, derives its provider and scope, and joins
that evidence with an exact provider observation and the pinned guest's
packaged `service status`. It accepts no provider or placement selector,
creates no local or provider state, and mutates neither provider nor guest.
The read is bound to the executable's embedded app identity but not to the
outer SEA's current revision, so it can inspect an older deployment of the
same app.

Destroy authenticates only the embedded app identity, then uses the exact
deployment instance and durable local authority without decoding the embedded
Linux payload. Its journal supplies the bound AWS region or Hetzner location,
so destroy accepts neither `--region` nor `--location`; a non-default
`--data-root` must match apply.

AWS requires an existing usable default-VPC public-network path. Hetzner uses
its public network; Wharfie creates no private network. AWS owns one security
group, instance, and encrypted root volume. Hetzner owns one firewall, primary
IPv4, and server. Destroy deletes those resources and the application/control
data currently held on the node's root disk.

Packaged `deployment inspect` and `deployment reconcile` are not exposed yet.
AWS has completed a live packaged apply/activate/adopt/restart/destroy slice
with independently verified cleanup. Hetzner completed the equivalent live
slice in `fsn1`, including second-process adoption without replacement.

Source plan and direct apply package a selected SEA and durably pre-stage it.
A later source `apply --plan` and source reconcile validate exact durable
staged evidence. The source mode uses the operator's ordinary AWS credential
chain; neither the canonical profile nor the reusable plan contains
credentials. Both deployment surfaces remain experimental.
Create canonical profiles with the narrow
`@wharfie/wharfie/deployment-profile` Node authoring API. Source plan JSON
includes durable staged-artifact evidence and is accepted only by source
`apply --plan`.
Plan requires an explicit control policy because source planning may package,
stage, and create bootstrap control state. Direct apply defaults to `bootstrap`;
prepared apply and the three located commands default to `require-active`.
Source `apply --plan` rejects `--dir` and `--output-dir`. Scalar selectors may
be supplied only once, and a returned active head is an incomplete nonzero
result rather than success.

Packaged Linux artifacts additionally expose
`<app> wharfie service install|converge|update|rollback|recover|prune|purge|start|stop|restart|status|uninstall`.
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

`service purge --confirm-data-loss <app-id>` is the separate irreversible
cleanup path after uninstall. It requires the exact embedded app ID, absent
systemd wiring, no live local owner, settled activation, and terminal durable
runs. It removes only the derived app root through a marker-authenticated
rename-first tombstone; shared roots, sibling apps, and the invoking SEA remain.
The preview contract requires no concurrent ordinary SEA invocation during
purge because those commands do not yet share its service-operation lock.
Source-side service management remains intentionally absent.
