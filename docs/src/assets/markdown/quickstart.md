# ⚡️ Quickstart

Wharfie is in an experimental project reset. The commands below describe the
working local v2 surface, not a production deployment workflow.

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
manifest identifies the developer-owned CLI, named activities, and package
targets. Its default export must be a plain object using the exact v2
schema; unknown or malformed fields are errors. Wharfie does not require a
generated project tree. See [Application
Structure](./project-structure) for a minimal layout. The
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
  schemaVersion: 2,
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
});
```

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
of the v2 activity API.

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
durable `run_id`. Inspection is read-only. Recovery is an explicit durable
mutation to use only after every prior runner has stopped; it does not load an
app manifest, parse current input, compile source, or dispatch user code.
Cancellation is a separate request to an already active owner:

```bash
wharfie ops inspect --run-id <run-id>
wharfie ops recover --run-id <run-id> --confirm-runner-stopped
wharfie ops reconcile --run-id <run-id> --reconciliation-id <stable-id> \
  --evidence-file <host-transcript.json> --confirm-runner-stopped [--reason <text>]
wharfie ops cancel --run-id <run-id> --request-id <stable-request-id>
```

The packaged executable exposes the same exact-run operations directly under
its reserved operator namespace:

```bash
<app> wharfie inspect --run-id <run-id>
<app> wharfie recover --run-id <run-id> --confirm-runner-stopped
<app> wharfie reconcile --run-id <run-id> --reconciliation-id <stable-id> \
  --evidence-file <host-transcript.json> --confirm-runner-stopped [--reason <text>]
<app> wharfie cancel --run-id <run-id> --request-id <stable-request-id>
```

Packaged inspection, recovery, reconciliation, and cancellation are scoped to
the immutable app identity embedded in the artifact. They can operate an older
revision of that same app, but reject another app's run ID before output or
mutation. With `--json`, the source and packaged forms of `inspect` emit the
same schema-v3 redacted run view, including effect
identity/status/adapter-lifecycle rows but not requests, destinations,
receipts, evidence, values, paths, or fencing tokens. `recover` emits that view
plus recovery metadata, and `reconcile` wraps it with its stable reconciliation
ID and whether it was newly applied. `cancel` instead emits a redacted
schema-v1 cancellation result containing the request ID, outcome, delivery
state, and safe lifecycle statuses. Without `--json`, these commands use the
compact human-oriented table and message format shown above.

Inspection opens existing control state read-only and never creates missing
state. Recovery is deliberately explicit: use it only after confirming every
prior runner is gone. It can release a claim that never started; a begun
attempt becomes visibly blocked as `UNCERTAIN` instead of replaying code. When
that attempt retains exactly one unresolved built-in `STARTED`
`application-state` effect, recovery requires both LMDB stores and the held
local owner. It opens application state read-only and either commits the exact
permanent receipt into the ledger before blocking the arbitrary activity
attempt, or marks the effect itself `UNCERTAIN` only when the exact receipt is
absent. A missing, replacement, or corrupt store is an error, not proof of
absence. `PENDING` and multiple unresolved effects are refused unchanged.
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
in the operator response. A `cancelled` result still requires the matching
earlier durable cancellation request and host cancellation frame.

The V6 ledger supports cancellation by the foreground active owner. During
`wharfie ops run`, the first `SIGINT` or `SIGTERM` becomes a durable request
before the owner signals the physical attempt. While an LMDB-backed `ops run`
owns the exact `STARTED` attempt, source `wharfie ops cancel` or packaged
`<app> wharfie cancel` can reach that owner through a bounded, authenticated
same-principal local command endpoint. `--request-id` is required; reuse the
same value after a lost response. The owner persists durable intent before it
begins delivery. The command reports `delivery: "started"` only after that
handoff begins; a timeout, stale/moved owner, unavailable endpoint, inactive
run, wrong run, or merely resident lifecycle owner reports no delivery and
never falls back to a direct ledger write. The local transport is deliberately
unsupported on Windows.

The external command intentionally cannot directly cancel `RUNNABLE`,
`CLAIMED`, or otherwise unstarted work: only the active foreground owner's
`STARTED` attempt can accept it. Once that attempt is started, only matching
cancellation evidence can commit `CANCELLED`; a verified completion or failure
may still win, while unconfirmed post-cancellation termination becomes blocked
`UNCERTAIN` work; later reconciliation needs evidence rather than another
cancel request. There is still no public run-history/list: the verified bounded
V4 run directory paired with the V6 ledger is internal rather than the retired
`ops list` surface. The resident service currently owns only local lifecycle
and exclusion state; it does not schedule, claim, or execute work.

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

The v2 manifest does not expose workflows, schedules, arbitrary packaging
assets, signing credentials, or other build secrets. External activity packages
must be pinned as exact descriptors such as
`externalPackages: [{ name: 'sharp', version: '0.34.4' }]`; ranges, tags, URLs,
and ambient dependency resolution are not accepted. Multiple entries must use
lowercase npm registry names, be unique, and be sorted by name.

The shipped top-level CLI surface is `app` and `ops`.
