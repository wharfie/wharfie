# ⚡️ Quickstart

Wharfie is in an experimental project reset. The commands below describe the
working local v3 surface and the newly mounted experimental deployment
lifecycle, not a production-ready service.

## Run from source

```bash
git clone https://github.com/wharfie/wharfie.git
cd wharfie
npm ci
node ./bin/wharfie --help
```

Use the exact Node version in `package.json#engines` and the npm version in
`package.json#packageManager`. There is no release-ready binary installer during
the project reset. The examples below use `wharfie` as shorthand for
`node ./bin/wharfie` from the repository root.

## Create an app

Create a `wharfie.app.js` beside your TypeScript or JavaScript sources. The
manifest identifies the developer-owned CLI, named activities, workflows,
schedules, and package targets. Its default export must be a plain object using
the exact v3 schema; unknown or malformed fields are errors. Wharfie does not
require a generated project tree. See [Application
Structure](./application-structure.md) for a minimal layout. The
`@wharfie/wharfie/app` subpath ships TypeScript declarations for the manifest
helper and activity invocation API.

Activity definitions do not accept `environmentVariables`. Current local
execution has no per-activity environment boundary, and portable artifacts must
not embed per-activity environment values in manifests. Supply runtime
configuration to the process environment until Wharfie has first-class portable
configuration and secret references.

Every Node entrypoint declares its export explicitly:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  schemaVersion: 3,
  app: { id: 'my-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'launch',
    },
  },
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/activities/greet.ts',
        export: 'greet',
      },
    },
  },
  workflows: {
    greet: {
      steps: [
        {
          id: 'greet',
          kind: 'activity',
          activity: 'greet',
          input: { kind: 'workflow-input' },
        },
      ],
    },
  },
  schedules: {
    hourly: {
      cron: '0 * * * *',
      workflow: 'greet',
      input: { name: 'scheduled user' },
      missed: 'latest',
      overlap: 'allow',
    },
  },
});
```

The v3 manifest keeps `workflows` and `schedules` optional so an ordinary CLI
can become durable progressively; either map must be nonempty when declared. A
workflow contains one to 64 ordered `activity`, `timer`, or `signal` steps.
Activity input is exactly the workflow input, a JSON literal, or one named
earlier step's output. A schedule names one workflow in the same immutable
revision, carries static JSON input, and uses a canonical five-field UTC cron
expression. Its initial policies are fixed to `missed: 'latest'` and
`overlap: 'allow'`. Each cron field is only `*` or a strictly ascending
comma-separated numeric set; ranges, steps, names, macros, seconds, timezones,
and Sunday alias `7` are rejected. A manifest may declare at most 128 schedules
in 1 MiB, each static input is limited to 256 KiB, and the resident fails closed
instead of partially evaluating a catch-up window longer than 527,040 minutes
(366 days). The source and packaged residents observe schedules while
executing physical work serially; each due occurrence advances its cursor and
admits its ordinary workflow run atomically. Branches and managed-effect
workflow successors remain unsupported. See
[Application Structure](./application-structure.md) for the exact shape.

The application ID, activity keys, and other logical IDs use lowercase kebab
case: `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, with at most 63 ASCII bytes. Wharfie
rejects whitespace, uppercase letters, underscores, dots, and leading digits;
it never trims or case-folds an ID.

An activity export has the `(input, runtime)` ABI. `input` is the strict JSON
value supplied by its caller; `runtime.caller.metadata` is separate trusted
caller metadata; and `runtime.invocation` identifies the immutable revision,
run, invocation, physical attempt, and fencing token. Activity code should use
`runtime.logger` for structured logs. `runtime.signal` receives host
cancellation and deadline interruption through the framed worker attempt
transport. The currently shipped source/SEA invocation API does not expose an
interactive caller-cancellation control yet. The initial Activity Protocol v1
execution path always supplies `runtime.effects`. Foreground durable `ops run`
hosts fulfill Wharfie's finite managed-effect catalog, currently the
`application-state` / `put-if-absent` request. Ephemeral `invokeActivity` hosts
do not open application state: `runtime.effects.request(...)` rejects with the
catchable error name `ActivityEffectUnavailableError` and code
`effect-handler-unavailable`. Durable `ops run` handles process-signal
cancellation separately, as described below. The app schema rejects
application- and activity-level `resources`; a caller-metadata property with
that name is ordinary inert JSON.

```ts
import type { ActivityHandler } from '@wharfie/wharfie/app';

type Greeting = { name: string };
type GreetingResult = { message: string };
type CallerMetadata = { requestId: string };

export const greet: ActivityHandler<
  Greeting,
  GreetingResult,
  CallerMetadata
> = async (input, runtime) => {
  runtime.logger.info('Greeting requested', {
    requestId: runtime.caller.metadata.requestId,
    invocationId: runtime.invocation.invocationId,
  });
  return { message: `Hello, ${input.name}!` };
};
```

From the developer-owned CLI, invoke the same named activity locally and in the
packaged executable:

```ts
import { invokeActivity } from '@wharfie/wharfie/app';
import { randomUUID } from 'node:crypto';

export async function launch(argv: string[] = process.argv) {
  const result = await invokeActivity<
    { message: string },
    { name: string },
    { requestId: string }
  >('greet', {
    input: { name: argv[2] ?? 'world' },
    callerMetadata: { requestId: randomUUID() },
    deadlineUnixMs: Date.now() + 30_000,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
```

`input` and `callerMetadata` must be JSON values (with metadata specifically a
JSON object). `deadlineUnixMs`, when supplied, is a positive safe Unix epoch
millisecond value. The former `event` and `context` option names are not part
of the current activity API.

## Inspect the app manifest

Pass the directory containing `wharfie.app.js`:

```bash
wharfie app manifest ./path/to/app
```

## Run a local activity

```bash
wharfie app run <activity-id> --dir ./path/to/app --input '{"who":"cli-user"}'
```

To create one durable local manual run for an activity, use `wharfie ops` with
an operator-chosen idempotency identity:

```bash
wharfie ops run --activity <activity-id> --dir ./path/to/app \
  --idempotency-key <stable-key> --input '{"who":"cli-user"}'
```

The first run writes an append-only run → invocation → attempt ledger. Reusing
the same `--idempotency-key` with identical app revision, activity, input, and
caller metadata returns its durable terminal without running the activity
again. A changed request with that key fails rather than silently deduplicating.
The result table includes the operator-provided `idempotency_key` and derived
durable `run_id`.

To persist the request without claiming or running it, use `submit`:

```bash
wharfie ops submit --activity <activity-id> --dir ./path/to/app \
  --idempotency-key <stable-key> --input '{"who":"cli-user"}'
```

`submit` does not require a live worker. It either sends the request to the
matching resident through its authenticated same-principal command endpoint or
briefly acquires the local owner and appends the same `RUNNABLE` invocation
while offline. The receipt contains the exact app revision and derived run ID;
reuse the idempotency key only with the identical activity, input, and caller
metadata. It does not imply that physical execution has begun.

## Start a durable workflow

Persist a bounded linear workflow from its source manifest with a stable start
identity:

```bash
wharfie ops start --workflow <workflow-id> --dir ./path/to/app \
  --idempotency-key <stable-key> --input '{"who":"cli-user"}'
```

The packaged form is bound to its embedded app and revision and has no `--dir`
override:

```bash
<app> wharfie start --workflow <workflow-id> \
  --idempotency-key <stable-key> --input '{"who":"cli-user"}'
```

`start` uses the same authenticated resident-or-short-lived-owner boundary as
`submit`. It atomically persists the immutable plan, workflow input, initial
cursor, exact activity/timer/signal activation, and any runnable work row. An
exact retry of the same stable key and request returns the retained run with
`reused: true`; changing the workflow, input, caller metadata, or immutable app
revision conflicts. Output contains only safe run, revision, workflow, cursor,
activation kind, and activation lifecycle fields. It does not echo inputs or
internal payload references. Run-level cancellation is available after the
workflow has been created.

## Deliver the current workflow signal

When inspection shows that the cursor is waiting for a signal step, deliver
one required JSON payload with a caller-stable delivery ID:

```bash
wharfie ops signal --run-id <run-id> --signal <signal-step-id> \
  --delivery-id <stable-delivery-id> --payload '{"approved":true}'

<app> wharfie signal --run-id <run-id> --signal <signal-step-id> \
  --delivery-id <stable-delivery-id> --payload '{"approved":true}'
```

The source command resolves app scope from the existing run; the packaged
command also enforces the app identity embedded in the artifact. Signal
delivery routes to the authenticated resident when it owns the local control
store or acquires a short-lived app owner when no resident is active. Only the
signal named by the current wait can advance the cursor. An early, unexpected,
or late request is durably rejected as `early-signal`, `unexpected-signal`, or
`late-signal`; Wharfie does not keep an early-signal inbox. Retry the exact
run, signal, delivery ID, and payload after response loss to receive the
retained accepted or rejected decision. Reusing the delivery ID with changed
contents conflicts. An unknown run is refused without creating durable state.

Add `--json` to `run`, `submit`, `start`, or `signal` when another program or
agent will retain the decision. Source and packaged forms emit byte-equivalent
schema-v1 receipts for the same immutable result. Their kinds are:

- `wharfie.execution-ledger.activity-run`;
- `wharfie.execution-ledger.activity-submit`;
- `wharfie.execution-ledger.workflow-start`; and
- `wharfie.execution-ledger.signal`.

The activity and start receipts use camelCase and bind `appId`, `revisionId`,
`runId`, and the public idempotency/activity/workflow identity. Run additionally
reports `disposition`, `reused`, lifecycle statuses, and an attempt summary or
`null`; submit reports accepted lifecycle and replay state without inventing an
attempt. Start reports the current cursor and either the next activation
kind/status or `null` after terminalization. Signal returns its retained
accepted/rejected delivery receipt or an explicit unpersisted unknown-run
refusal. None of these documents includes inputs, metadata, signal payloads,
results, errors, actors, private activation IDs, payload references, evidence,
or fences.

The JSON receipt reports durable truth rather than process success. A
failed/blocked/in-progress run, rejected signal, or unknown-run refusal writes
its valid receipt and then exits nonzero. Loading, validation, or service
failure before a durable decision or explicit absence writes no JSON. Human
output is derived separately and its snake_case table columns are not a
machine contract.

Run the matching source revision as a foreground resident in another terminal:

```bash
wharfie ops worker --dir ./path/to/app
```

The first worker processes one physical attempt at a time. It accepts and
executes only runs pinned to its exact application and immutable revision. Its
transactional exact-revision ready-work index is only a locator: the worker
rebuilds each named run/version/invocation or recovery attempt, and the ordinary
ledger claim remains the authority to execute. On restart a
stale `CLAIMED` attempt that never crossed the handler-start boundary is
released and rescheduled. A stale `STARTED` attempt becomes blocked
`UNCERTAIN`; Wharfie does not silently redispatch code that may already have
run. If that attempt has unresolved managed effects, the resident first settles
the exact sibling set through the source-free recovery path: `PENDING` requests
are cancelled without destination access and `STARTED` application-state
requests are checked read-only for permanent receipts. The whole set and the
blocked attempt advance in one ledger event; authored activity and normal
adapter code are not rerun.

The packaged artifact exposes the same activity submission, workflow start,
and worker commands without any source-directory override:

```bash
<app> wharfie submit --activity <activity-id> \
  --idempotency-key <stable-key> --input '{"who":"cli-user"}'
<app> wharfie start --workflow <workflow-id> \
  --idempotency-key <stable-workflow-key> --input '{"who":"cli-user"}'
<app> wharfie worker
```

The private environment-selected packaged service runtime starts the same
resident activity implementation. On Linux, a packaged artifact can install
that runtime as a systemd user service when the invoking non-root user's
systemd manager is available and an administrator has already enabled
lingering:

```bash
<app> wharfie service install
<app> wharfie service status --json
<desired-app> wharfie service converge
<next-app> wharfie service update
<next-app> wharfie service rollback
<next-app> wharfie service recover
<app> wharfie service stop
<app> wharfie service start
<app> wharfie service restart
<app> wharfie service uninstall
```

Use `service converge` when automation owns one exact desired artifact and may
have lost an earlier response. It recovers a non-rollback durable transition
first, except that an in-flight first install of a different artifact is
replaced through the coordinator's explicit replacement path. It then makes at
most one install, repair, or ordinary update attempt toward the invoking
artifact. Convergence can repair an exact receipt-backed ACTIVE source before
updating, including restarting an exact projection whose liveness is stopped,
failed, or degraded and clearing systemd failure/start-limit state. Missing,
corrupt, or contradictory source authority still fails closed. A pending,
refused, or failed settlement exits unsuccessfully and can be retried after its
blocker changes. Convergence never expresses or recovers rollback; after an
ambiguous rollback, use `service recover`.

The commands never invoke `sudo` or accept arbitrary unit/environment input.
The unit location is fixed to the account's `~/.config/systemd/user`; custom
`XDG_CONFIG_HOME` topology is rejected, installation verifies the live
manager's search path, and unit-name mutations require an exact, non-stale
effective fragment without drop-ins. Packaged durable state is likewise fixed
to the operating-system account's data root rather than ambient
`XDG_DATA_HOME` or `HOME`. Uninstall disables the unit and removes the
executable selector while preserving immutable releases, ledger data, payloads,
and application state. It retains both an installation identity tombstone and
the durable `ACTIVE` selection, rollback candidate, and same-revision run
admission. Run `service install` again from that same selected SEA to rehydrate
the service without changing activation record version or selection generation.
When the tombstone proves an intentional uninstall, `service install` or
`service update` from a new target SEA automatically reprojects and proves the
exact retained source before entering the ordinary durable update. If the
receipt disappears without that tombstone, the operation fails closed and the
exact selected SEA must run `service install` to repair it.

Status schema V3 reports `wiring.state` as `managed`, `absent`, `orphaned`,
`conflicting`, or `unknown`; `wiring.selection` separately reports the redacted
immutable-selector state. It also requires one `desiredConvergence` V1
decision whose application, unit, artifact, and revision identify the exact
SEA that ran status. The disposition is `authorized`, `conflict`, or `unknown`.
An authorized decision has exactly one basis: `physical-absence`,
`durable-install`, `durable-change`, or `durable-active`. Conflict and unknown
decisions have a null basis. The decision is read-only: it reports whether
retrying `service converge` from that SEA is authorized without itself
repairing or adopting host state.

If wiring is `orphaned`, run `service uninstall`: that existing command is the
explicit cleanup path and returns `outcome: orphan-reconciled`. There is no
separate `service reconcile` command. A missing receipt, selector, or unit is
repairable only when the durable activation record names the exact projection.
Physical wiring with no activation record is degraded and is not adopted by
install, converge, start, update, rollback, or recovery; uninstall's exact
orphan checks are cleanup authority, not activation authority.

First install requires physical absence and records a transition with no
source. Existing queued work is compatible when every nonterminal run has the
target revision; the new resident may start and process it. Foreign-revision
nonterminal work leaves install `pending` in `QUIESCING`, with no selected
service and admission fenced. Wharfie enables the exact fixed unit without
starting it, records `ACTIVATING`, and only then admits the separate systemd
start. During an update or rollback, the selected source alone has a narrow
`QUIESCING` start exception so it can drain or be retained safely.

Run `service update` from the new packaged artifact. One local coordinator
serializes the change, closes both durable-run and service-start admission,
and scans the verified run directory before and after stopping the resident.
Every existing run must be terminal; otherwise the request is refused and the
source release is kept healthy. A successful switch retains exactly one prior
release. Invoke a fresh rollback from the currently selected SEA—`<next-app>`
immediately after the example update. If its response is ambiguous, run
`service recover`; do not send a new rollback that could request the reverse
transition. A rollback invocation from the prior/candidate SEA is rejected
because it cannot be distinguished from a stale retry. If target activation
definitively fails, Wharfie restores the source.

Activation receipts separate `requestStatus` (`fulfilled`, `refused`,
`failed`, or `pending`) from `outcome` (`target-active`, `source-retained`,
`source-restored`, `in-flight`, or `absent`). Non-fulfilled receipts use a
nonzero exit code even in `--json` mode. The repository's disposable Ubuntu
proof covers crash replacement, abrupt reboot, pre-login recovery, workflow
continuation, and state-preserving uninstall. Its current three-SEA matrix also
kills update and rollback after each durable phase write, recovers a lost
committed response, refuses a stale reverse request, and restores the source
across every phase after a clean target exit before readiness.

The current worker executes exact workflow
`ACTIVITY` rows, conservatively handles `RECOVERY` rows, and fires due `TIMER`
rows as framework-owned continuations without Activity Protocol or authored
code dispatch. A timer's persisted deadline is not recomputed after restart;
if no matching resident is running, it remains waiting until one resumes.
There is no public timer-fire command. Schedules, managed-effect workflow
successors, multi-host leases, and heartbeats remain unsupported. The reserved
framework-only `CONTINUATION` row remains fail-closed repair authority, not a
signal queue or user-code dispatch request.

Inspection is read-only. Recovery is an explicit durable mutation to use only
after every prior runner has stopped; it does not load an app manifest, parse
current input, compile source, or dispatch user code. Cancellation is a
separate request. A manual run requires its already active foreground or
resident owner; a workflow run can instead route through a resident or acquire
short-lived local ownership for an activation that needs no physical delivery:

```bash
wharfie ops list --dir ./path/to/app --limit 50 --json
wharfie ops list [--dir <app-dir>] [--limit <1..100>] [--cursor <opaque>] [--json]
wharfie ops logs --app-id <app-id> --run-id <run-id> --attempt-id <attempt-id> \
  --confirm-sensitive-output [--limit <1..100>] [--cursor <opaque>] [--json]
wharfie ops inspect --run-id <run-id>
wharfie ops recover --run-id <run-id> --confirm-runner-stopped
wharfie ops reconcile --run-id <run-id> --reconciliation-id <stable-id> \
  --evidence-file <host-transcript.json> --confirm-runner-stopped [--reason <text>]
wharfie ops reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped
wharfie ops cancel --run-id <run-id> --request-id <stable-request-id>
```

The packaged executable exposes the same listing and exact-run operations
directly under its reserved operator namespace:

```bash
<app> wharfie list --limit 50 --json
<app> wharfie list [--limit <1..100>] [--cursor <opaque>] [--json]
<app> wharfie logs --run-id <run-id> --attempt-id <attempt-id> \
  --confirm-sensitive-output [--limit <1..100>] [--cursor <opaque>] [--json]
<app> wharfie inspect --run-id <run-id>
<app> wharfie recover --run-id <run-id> --confirm-runner-stopped
<app> wharfie reconcile --run-id <run-id> --reconciliation-id <stable-id> \
  --evidence-file <host-transcript.json> --confirm-runner-stopped [--reason <text>]
<app> wharfie reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped
<app> wharfie cancel --run-id <run-id> --request-id <stable-request-id>
```

Source `list` resolves app scope from the selected application directory; the
packaged form uses the immutable app identity embedded in the artifact. Both
list runs across that app's revisions in newest-first creation order. The
default page contains at most 50 rows; `--limit` accepts 1 through 100, and an
opaque `--cursor` continues only within the same app scope. Listing is read-only.
It does not create an absent control store, which is reported as an honest empty
page, and it verifies every directory row against the rebuilt run before
returning it.

With `--json`, `list` emits schema v1 with kind
`wharfie.execution-ledger.run-page`. Its authority is `none`: the page is
non-authoritative discovery data and cannot schedule, cancel, or otherwise
mutate a run. The document reports verified integrity and includes its `scope`,
redacted `items`, and a `nextCursor` that is either an opaque string or `null`.
Human and JSON listing omit payloads, evidence, fencing tokens, and filesystem
paths.

`inspect` identifies every historical physical attempt without revealing its
fence. Pass the exact app/run/attempt IDs to source `logs`, or the run/attempt
IDs to the packaged command. Source log inspection does not load current app
source; the packaged command uses its embedded app identity. Both require
`--confirm-sensitive-output` before opening storage because messages and fields
are raw application-controlled data that may contain secrets.

Log pages are read-only, ascending, limited to 50 entries by default and 100
maximum, and frozen to the complete verified prefix seen by the first page.
Every continuation re-verifies the run, historical attempt, entire retained
hash chain, and every payload, while ignoring logs appended after that frozen
prefix. Start a fresh no-cursor read to observe later entries. JSON kind
`wharfie.execution-ledger.activity-log-page` declares authority `none`,
verified integrity, and disclosure
`application-sensitive-unredacted`. Human output renders messages and fields
as terminal-inert JSON, and serialized JSON escapes the same terminal controls
without changing its parsed raw values. Outside raw messages and fields—which
may themselves contain any secret or internal-looking value—neither form adds
Wharfie-owned fencing tokens, auxiliary keys, hashes, or payload references.
This is historical diagnostic inspection, not tailing, search, redaction, or
exactly-once display.

Packaged inspection, recovery, reconciliation, effect reconciliation,
cancellation, and signal delivery are also scoped to the embedded app identity.
They can operate an older revision of that same app, but reject another app's
run ID before output or mutation. With `--json`, the source and packaged forms
of `inspect` emit the same schema-v8 redacted run view, including
the safe manual/workflow trigger, activation-aware cursor, timer timing and
status, signal-wait status, signal-delivery outcome/rejection, and effect
identity/status/adapter-lifecycle rows. They do not expose requests,
destinations, receipts, evidence, values, signal payloads, paths, payload
references, digests, or fencing tokens. Dedicated signal-delivery lifecycle
rows also omit their actor field; event history retains safe actor metadata.
`recover` emits that view plus recovery action `settled-managed-effect-set` and
one sorted `managedEffects` result for the atomically settled active set;
`reconcile` wraps the view with its stable reconciliation ID and whether it was
newly applied. `cancel` instead emits a redacted schema-v1 cancellation result
containing the request ID, outcome, delivery state, and safe lifecycle statuses.
Without `--json`, these commands use the compact human-oriented table and
message format shown above.

`reconcile-effect` is distinct from transcript-backed `reconcile`. It requires
the exact `--run-id`, `--effect-id`, a stable `--reconciliation-id`, and
`--confirm-runner-stopped`. Reuse the same reconciliation ID and exact request
after a lost response; exact replay returns the retained status with
`changed: false` instead of repeating destination or ledger work. Both source
and packaged forms require the held app-scoped LMDB local-owner protocol and
refuse to race a live resident session or prior runner. This is a trusted local
operator boundary, not remote coordinator routing.

The finite reconciliation catalog either recovers a late verifier-backed
positive receipt or atomically installs a permanent `NOT_APPLIED` destination
finalization that fences the original destination effect ID. It does not accept
an operator-selected status, load application source, or redispatch the effect.
The enclosing run and invocation remain `BLOCKED` / `UNCERTAIN`, and the
abandoned physical attempt remains unchanged. Human and `--json` output are
redacted to safe lifecycle state plus the reconciliation ID, effect ID,
resulting status, and `changed` flag; requests, values, destinations, store
identity, receipts, finalizations, evidence, private reason text, and fencing
material remain hidden.

After an exact application-state V2 effect has been verified permanently
`NOT_APPLIED`, a trusted local operator can authorize and run its one finite
causally linked successor:

```sh
wharfie ops retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped
```

The packaged equivalent is:

```sh
<app> wharfie retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped
```

Both forms accept an optional private `--reason <text>` and redacted `--json`
output. Reuse the exact source run, effect, successor ID, actor, and reason
after a lost response. Exact replay returns or advances the one retained target;
it cannot authorize a sibling or enter an already-started adapter again.

The successor receives fresh run, invocation, attempt, effect, destination,
and fence identities through a dedicated effect-only lifecycle. It never
redispatches the abandoned authored activity, and the source remains `BLOCKED`
/ `UNCERTAIN` even when the target completes. This is only the finite
application-state V2 `put-if-absent` retry policy; it is not generic handler
retry or compensation.

Inspection opens existing control state read-only and never creates missing
state. Recovery is deliberately explicit: use it only after confirming every
prior runner is gone. For a manual or workflow run, it can release a current
claim that never started; a begun attempt becomes visibly blocked as
`UNCERTAIN` instead of replaying code. Workflow recovery conditions on the
exact retained cursor, continuation, invocation, generation, attempt, and
fence. The successor lifecycle instead uses the
dedicated behavior above and has no generic claim. V10 retains V9's recovery of
the complete active-effect set, bounded to 16 unresolved effects, for an
ordinary stopped attempt under the held local owner. Every `PENDING` request
becomes `CANCELLED` without a destination probe because its durable start
authorization never committed.

When any sibling is `STARTED`, recovery also opens application state read-only
and probes each exact destination receipt before changing the control ledger.
A verified receipt makes that effect `COMPLETED` or `FAILED`; strict absence
makes it `UNCERTAIN`. One compound event then applies every sibling disposition,
abandons the stopped physical attempt, makes its invocation `UNCERTAIN`, and
blocks the run. A missing or replacement store, unsupported contract, corrupt
receipt or business row, thrown probe, or verifier failure leaves the entire
set unchanged. Recovery never invokes the application or adapter executable.
Packaged recovery requires the LMDB local-ownership protocol and refuses to
race a live resident service. The same local exclusion applies to packaged
reconciliation; source effect-free recovery and reconciliation retain their
configured adapter's documented manual/diagnostic behavior.

Reconciliation is not a retry or an operator-selected status. It can address
only a blocked `UNCERTAIN` run whose retained current attempt is `ABANDONED`.
The command requires a stable `--reconciliation-id` for response-loss retries,
a bounded UTF-8 JSON file containing the complete host Activity Protocol
transcript, and `--confirm-runner-stopped`. Wharfie revalidates that transcript
against the retained revision, input, caller metadata, attempt identity,
fencing token, and exact earlier uncertainty event. It appends one terminal
resolution only when the evidence proves it; the abandoned physical attempt is
never rewritten, and the transcript, result, reason, and fence are never echoed
in the operator response. For a workflow, verified `completed` evidence
atomically creates the exact next activity, timer, or signal wait or completes
the run; verified `failed` or `protocol-failed` evidence terminalizes it
without a successor.
Exact reconciliation replay remains bound to the original uncertainty event
even after its cursor has advanced. A `cancelled` result for either a manual or
workflow attempt requires the matching earlier durable cancellation request
on that exact attempt and the corresponding host cancellation frame and
reason. A cancellation recorded only after a workflow attempt became uncertain
prevents continuation but cannot authorize a historical cancelled transcript.
`deadline-exceeded` evidence remains unsupported until a persisted deadline
decision exists.

The V10 ledger carries forward cancellation by the active local owner. During
`wharfie ops run`, the first `SIGINT` or `SIGTERM` becomes a durable request
before the owner signals the physical attempt. An LMDB-backed foreground run
or resident worker that owns the exact `STARTED` attempt can also receive
source `wharfie ops cancel` or packaged `<app> wharfie cancel` through its
bounded, authenticated same-principal local command endpoint:

```bash
wharfie ops cancel --run-id <run-id> --request-id <stable-request-id>
<app> wharfie cancel --run-id <run-id> --request-id <stable-request-id>
```

Reuse the same request ID after a lost response. For a manual run, the owner
persists durable intent before delivery and reports `delivery: "started"` only
after that handoff begins. A timeout, stale or moved owner, unavailable
endpoint, inactive or wrong run, idle resident, or resident executing another
manual run reports no delivery and never falls back to a direct ledger write.
The local transport is deliberately unsupported on Windows.

That active-attempt-only restriction remains deliberate for manual runs. A
workflow cancellation is instead a cursor-aware run decision. `RUNNABLE` or
`CLAIMED` work becomes `CANCELLED` without authored dispatch. An exact live
`STARTED` attempt records the request before receiving its protocol cancel
frame. A blocked `ACTIVITY_UNCERTAIN` cursor retains its physical uncertainty
but gains a durable no-continuation fence. The same request replays without a
second transition or signal. Verified completion or failure evidence remains
authoritative, but a non-final completion observed after cancellation cannot
create a successor; unconfirmed termination remains blocked uncertainty.

The public run-history surface exposes the verified bounded V8 directory paired
with the V10 ledger only as read-only, non-authoritative discovery data. The
resident submits, claims, and executes exact-revision manual activities
serially and consumes exact manifest-bound workflow activity and timer
continuations created through public `start`; public `signal` consumes only the
current declared signal wait. Public `inspect`, confirmed `recover`, and
evidence-backed `reconcile` understand those workflow runs. Exact-attempt
historical log retrieval is available through `logs`; the same resident
observes exact-revision schedules and performs latest-only catch-up after a
restart. Managed-effect workflow successors and schedule pause/resume
inspection remain unsupported. Live log tail, search, and redaction remain
absent. The manual bounded
recovery and reconciliation paths have prior real subprocess and relocated-SEA
crash coverage across request, start, destination commit, payload publication,
ledger settlement, and response-delivery boundaries. The manual resident
dispatch and shutdown surface has a complete source, package, and moved-SEA
validation receipt, including exact-revision dispatch, graceful drain tests,
current-revision managed-effect recovery, and service crash/restart with Node
unavailable on `PATH`. Source-process and relocated-SEA matrices also prove
public workflow start, persisted timer restart, current-wait signal delivery,
recovery, reconciliation, offline cancellation, and active
persist-before-signal response-loss behavior. Wharfie remains a single-process
worker rather than a production workflow service. A disposable Ubuntu systemd
proof now covers abrupt reboot and pre-login recovery; multi-host coordination
is still intentionally absent.

On `SIGINT` or `SIGTERM`, the resident stops admitting submissions and new
claims, writes lifecycle `STOPPING`, and waits for admitted command callbacks.
An active attempt receives 30 seconds to finish naturally. After that, a manual
attempt uses its existing cooperative durable-cancellation path; a workflow
attempt receives only physical drain cancellation and becomes durably uncertain
unless it still produces a supported terminal. Generic shutdown is not an
operator cancellation request and deliberately creates no run-level workflow
authority. The worker keeps local ownership until the attempt settles. Only
then does graceful shutdown write `STOPPED` and release ownership. Lifecycle
remains `STARTING` until the
owner-command socket is bound, so durable `READY` means that authenticated
submission, cancellation, and workflow-signal ingress is actually available.
The resident endpoint
accepts the ledger's bounded referenced-payload size; unrelated local-owner
commands keep their smaller request default.

## Package the app

Packaging requires at least one target. Targets use a complete Node version
and one supported platform/architecture pair:

```js
targets: [
  {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  },
],
```

```bash
wharfie app package ./path/to/app
```

Packaging creates target-specific Node SEA executables. Target machines do not
need a preinstalled Node runtime, container runtime, or hosted Wharfie service.

## Try the experimental deployment lifecycle

Provider-backed deployment is now mounted, but it is still an experimental
operator surface with focused automated evidence. It has not completed a
clean-account lifecycle proof and does not yet establish that the deployed
resident service is ready. The command tree has exactly five leaves: `plan`,
`apply`, `inspect`, `reconcile`, and `destroy`.

Plan and direct apply take a canonical DeploymentProfileV2 (`wpr2`) JSON
document. The profile binds the app, Linux target, fixed single-node mode, AWS
region, and fixed capability fulfillment. It is operator input outside
`wharfie.app.js`; it contains no credentials and is not a general resource
graph. The commands resolve the operator's ordinary AWS credential chain for
the profile's region.

Create that canonical document with the supported Node authoring API:

```js
// make-deployment-profile.mjs
import {
  DEPLOYMENT_MODE,
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '@wharfie/wharfie/deployment-profile';

const profile = createDeploymentProfile({
  profile: { id: 'production' },
  appId: 'my-app',
  target: {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  },
  mode: DEPLOYMENT_MODE,
  provider: createAwsSingleNodeProvider('us-east-1'),
});

process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
```

```bash
node ./make-deployment-profile.mjs > deployment-profile.json
```

The helper validates the finite profile contract and computes its
content-addressed `wpr2` identity; do not invent or copy a
`profileRevisionId`.

The exact source grammar is:

```text
wharfie deployment plan <deployment> --profile <canonical-profile.json> --control-policy <policy> [--dir <app-dir>] [--output-dir <package-dir>] [--json]
wharfie deployment apply <deployment> --profile <canonical-profile.json> [--dir <app-dir>] [--output-dir <package-dir>] [--control-policy <policy>] [--json]
wharfie deployment apply --plan <plan.json> [--control-policy <policy>] [--json]
wharfie deployment inspect <deployment-instance> --region <region> [--control-policy <policy>] [--json]
wharfie deployment reconcile <deployment-instance> --region <region> [--confirm-coordinator-stopped] [--control-policy <policy>] [--json]
wharfie deployment destroy <deployment-instance> --region <region> [--control-policy <policy>] [--json]
```

`--control-policy` accepts `require-active`, `reconcile-existing`, or
`bootstrap`. Plan requires an explicit policy because source planning may
package, stage, and create bootstrap control state. Direct apply defaults to
`bootstrap`; prepared apply, inspect, reconcile, and destroy default to
`require-active`. Use `plan --json` to retain the complete reusable document;
pass that document alone to `apply --plan` on the same command surface. Source
plan JSON contains exact durable staged-artifact evidence and is accepted only
by source `apply --plan`. Packaged plan JSON omits that evidence, is accepted
only by an exact matching SEA's `apply --plan`, and cannot be moved to the
source surface. The prepared-plan form cannot be combined with a positional
deployment, `--profile`, `--dir`, or `--output-dir`. Supply scalar selectors
such as profile, plan, region, policy, and source paths at most once.

Source plan and direct apply freshly package the selected target and durably
pre-stage its exact SEA before returning. Source `apply --plan` later validates
the portable staged evidence rather than rebuilding or using the Node process
that happens to run the CLI. Source reconcile likewise reloads and validates
the exact durable stage instead of treating that Node process as artifact
authority.

The packaged executable exposes the same five leaves. Its direct grammar omits
the source-only directory options:

```text
<app> wharfie deployment plan <deployment> --profile <canonical-profile.json> --control-policy <policy> [--json]
<app> wharfie deployment apply <deployment> --profile <canonical-profile.json> [--control-policy <policy>] [--json]
<app> wharfie deployment apply --plan <plan.json> [--control-policy <policy>] [--json]
<app> wharfie deployment inspect <deployment-instance> --region <region> [--control-policy <policy>] [--json]
<app> wharfie deployment reconcile <deployment-instance> --region <region> [--confirm-coordinator-stopped] [--control-policy <policy>] [--json]
<app> wharfie deployment destroy <deployment-instance> --region <region> [--control-policy <policy>] [--json]
```

Packaged plan, both apply forms, and non-destroy reconcile validate the SEA that
is actually running the command; no artifact-path override is accepted.
Inspection and destroy use durable deployment identity and provider evidence
instead of historical local artifact bytes, so recovery of an active destroy
also remains executable-independent. `reconcile` does not silently take over
ambiguous in-flight work: use `--confirm-coordinator-stopped` only when the
prior coordinator is known unable to continue. A valid returned head that
still carries an active operation is reported as an incomplete nonzero result;
inspect it before deciding whether confirmed recovery is safe.

The v3 manifest exposes the bounded plain-data workflow and UTC schedule
definitions above. Its public start and operator commands handle activity,
persisted timer, and current-wait signal continuations, while the exact-revision
resident admits due scheduled workflow runs. Branches, an early-signal inbox,
managed-effect workflow successors, schedule pause/resume controls, arbitrary
packaging assets, signing credentials, and other build secrets remain
unsupported.
External activity packages must be pinned as exact descriptors such as
`externalPackages: [{ name: 'sharp', version: '0.34.4' }]`; ranges, tags, URLs,
and ambient dependency resolution are not accepted. Multiple entries must use
lowercase npm registry names, be unique, and be sorted by name.

The shipped source top-level CLI surface is `app`, `ops`, and experimental
`deployment`.
