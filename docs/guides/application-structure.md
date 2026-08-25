# Wharfie Application Structure Guide

A Wharfie application is a normal TypeScript or JavaScript CLI plus a small
`wharfie.app.js` manifest. Wharfie does not impose a generated project tree.
Inside an ESM npm project where `@wharfie/wharfie` is installed, the smallest
application-specific surface is two files:

```text
my-app/
├── hello.js
└── wharfie.app.js
```

`hello.js` is ordinary application code:

```js
export function main(argv = process.argv) {
  process.stdout.write(`Hello, ${argv[2] || 'world'}!\n`);
}
```

The manifest points at that developer-owned CLI:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  id: 'hello-world',
  main: './hello.js',
});
```

`defineApp()` expands only the mechanical v4 fields. No second Wharfie-only
entrypoint, target matrix, activity, workflow, or schedule is required.

The compact form follows explicit conventions instead of inventing hidden
behavior:

- `main` is the module path and that module exports `main` for ordinary argv;
- optional `durable: '<workflow-id>'` selects the default workflow and uses the
  conventional `toDurableInput` export from the same CLI module;
- optional `activityModule` supplies a fallback module path for activities that
  omit `path`; every activity may still override `path`, and an omitted
  `export` defaults to the activity ID only when that ID is a valid JavaScript
  export name;
- shorthand activity entries use only `path`, `export`, and
  `externalPackages`; `defineApp()` expands them into the full Node entrypoint
  shape; and
- `workflows`, `schedules`, and `targets` keep the same strict data contracts as
  the expanded manifest. `activityModule` requires a nonempty `activities` map,
  but it remains valid when every declared activity supplies its own `path`.

Omitting `targets` means the package command selects this exact compatible
host. `--target` filters only an explicitly declared target matrix; it does not
turn a targetless manifest into a cross-build request.

## Expanded application

When work needs to be durable, the same manifest can name activities,
workflows, schedules, and package targets:

```js
export default {
  schemaVersion: 4,
  app: { id: 'my-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.js',
      export: 'main',
    },
    durable: {
      workflow: 'scheduled-sync',
      export: 'toDurableInput',
    },
  },
  activities: {
    sync: {
      entrypoint: {
        kind: 'node',
        path: './src/activities/sync.js',
        export: 'sync',
      },
    },
  },
  workflows: {
    'scheduled-sync': {
      steps: [
        {
          id: 'sync',
          kind: 'activity',
          activity: 'sync',
          input: { kind: 'workflow-input' },
        },
      ],
    },
  },
  schedules: {
    hourly: {
      cron: '0 * * * *',
      workflow: 'scheduled-sync',
      input: { source: 'hourly' },
      missed: 'latest',
      overlap: 'allow',
    },
  },
  targets: [
    {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
  ],
};
```

`schemaVersion`, `app`, and `cli` are required in the expanded v4 object;
the compact `defineApp({ id, main })` form supplies them mechanically.
`activities`, `workflows`, `schedules`, and `targets` are optional,
although every declared map and the packaging target list must be nonempty.
All entrypoints currently use
`{ kind: 'node', path, export }`; both `path` and the named `export` are
required.

`cli.durable` is optional. When present, it names one workflow from the same
manifest and one adapter export from the CLI entrypoint module. The adapter
receives a frozen, application-owned argument list—not Node argv—and returns
the JSON value used as workflow input:

```js
import path from 'node:path';

function parseInput(args) {
  if (args.length !== 1 || !args[0]) {
    throw new TypeError('Usage: my-app <source>');
  }
  return { source: path.resolve(args[0]) };
}

export function toDurableInput(args) {
  return parseInput(args);
}

export async function main(argv = process.argv) {
  const input = parseInput(argv.slice(2));
  // Run the ordinary local behavior with input.
}
```

Keep this projection pure: validate and translate arguments, but do not perform
the work or mutate external state. Sharing its parser with the ordinary CLI
keeps local and durable input semantics aligned.

Logical IDs match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and contain at most 63
ASCII bytes. The compiler rejects aliases and unknown fields instead of
normalizing them. The v4 schema has no `ActorSystem`, `functions`,
`capabilities`, application `resources`, or public packaging/signing section.

A workflow is plain revision-bound data: one to 64 uniquely named ordered
`activity`, `timer`, or `signal` steps. An activity names a declared activity
and selects its entire input from `{ kind: 'workflow-input' }`, a JSON
`literal`, or the output of one named earlier step. Timer delays are positive
integer milliseconds; a signal's name is its step ID. Branches, executable
deciders, loops, parallel steps, and early-signal buffering are not part of
this contract. The complete `workflows` map is limited to 1 MiB of exact UTF-8
JSON. The compiler and packager preserve these definitions now. The public
source `wharfie ops start --dir ./path/to/app -- <application-args>` and
packaged `<app> wharfie start -- <application-args>` commands use
`cli.durable` to select the workflow and project ordinary arguments into its
input. `--` ends operator option parsing. A new idempotency key is generated
when none is supplied and is included in the start receipt; provide
`--idempotency-key <stable-key>` when the same logical admission must be
retried after a lost response. Experts can bypass the adapter with
`--workflow <workflow-id> --input <json>`; those controls cannot be combined
with application arguments.

Both forms persist the complete finite activity/timer/signal plan and
atomically materialize its first activation. Starting work does not start or
daemonize the resident: run `wharfie ops worker --dir ./path/to/app` or
`<app> wharfie worker` separately. The exact-revision resident executes
activity steps and fires due timers as framework work; there is no public
timer-fire command. Deliver a signal with source
`wharfie ops signal --run-id <run-id> --signal <signal-step-id> --delivery-id <stable-delivery-id> --payload <json>`
or packaged `<app> wharfie signal ...`. A signal is accepted only for the
current declared wait. Exact accepted and rejected deliveries replay under the
same stable delivery ID; early, unexpected, and late deliveries are durably
classified as `early-signal`, `unexpected-signal`, or `late-signal` rather than
buffered in an early-signal inbox. Exact-run schema-v8 inspection, confirmed
recovery, and evidence-backed reconciliation are workflow-aware and redact
signal payloads and internal references. Run-level workflow cancellation
terminalizes unstarted work, persists before exact active-attempt delivery,
and fences uncertain work against continuation.

A schedule is also plain revision-bound data. It names one workflow from the
same manifest, supplies static JSON input, and uses a canonical five-field UTC
cron expression. The first policy surface is fixed to latest-only missed-run
catch-up and overlap-allowing workflow runs:

```js
{
  cron: '0 * * * *',
  workflow: 'scheduled-sync',
  input: { source: 'hourly' },
  missed: 'latest',
  overlap: 'allow',
}
```

Each cron field is only `*` or a strictly ascending comma-separated numeric
set. Ranges, steps, names, macros, seconds, timezones, and Sunday alias `7` are
not accepted. A manifest may declare at most 128 schedules in 1 MiB, each
static input is limited to 256 KiB, and the resident fails closed instead of
partially evaluating a catch-up window longer than 527,040 minutes (366 days).

The exact-revision resident observes schedules concurrently with its serial
physical execution loop. A due occurrence advances its durable cursor and
creates its ordinary workflow run in one owner- and activation-fenced
transaction. Restart resumes the retained cursor and performs latest-only
catch-up. Direct activity schedules, dynamic inputs, non-UTC timezones,
schedule pause/resume controls, and managed-effect workflow successors remain
later runtime slices.

The schema does not accept application- or activity-level `resources`; those
are unknown fields. A property named `resources` inside caller metadata remains
ordinary cloned JSON and does not request injection. Managed effects are a
separate finite API on `runtime.effects`; the first public request is
`application-state` / `put-if-absent` with the exact replay properties
`['idempotent', 'transactional']`. Durable `ops run` hosts fulfill it, while an
ephemeral `invokeActivity` request rejects catchably with
`effect-handler-unavailable`. After confirmed runner loss, the shared source/SEA
operator can recover one retained built-in `STARTED` request only through its
read-only permanent LMDB receipt; it never invokes the adapter or application
source again.

An activity may pin target-specific dependencies with exact published versions:

```js
externalPackages: [{ name: 'sharp', version: '0.34.4' }],
```

External package entries use lowercase npm registry names and must be unique
and sorted by name.

Wharfie seals the complete module graph into the application revision. Static
imports and exports plus `import('literal')` and `require('literal')` are
supported. Runtime-computed specifiers, native `require` aliases,
`require.resolve`, `module.require`, `import.meta.resolve`, and `createRequire`
are rejected because they could load host files that are absent from the
portable artifact. This is a portability rule, not a hostile-code sandbox.

Activity exports use `(input, runtime)`, rather than the former `(event,
context)` convention. `runtime.caller.metadata` carries caller-supplied JSON
metadata separately from `input`, while `runtime.invocation` supplies immutable
revision, run, invocation, attempt, and fencing identities. Activity Protocol
v1 deliberately provides no injected resource handles; host-mediated effects
remain available only through the closed `runtime.effects` contract.

Use `wharfie app manifest ./path/to/app` to inspect the compiled manifest,
`wharfie app run sync --dir ./path/to/app` to invoke an activity locally, and
`wharfie app package ./path/to/app` to create a portable executable. Packaging
prints a human handoff by default; automation requests the stable package
receipt with `--json` and compact JSON with `--json --no-pretty`.
