# Wharfie Application Structure Guide

A Wharfie application is a normal TypeScript or JavaScript CLI plus a small
`wharfie.app.js` manifest. Wharfie does not impose a generated project tree.
A minimal application can look like this:

```text
my-app/
├── package.json
├── wharfie.app.js
└── src/
    ├── cli.js
    └── activities/
        └── sync.js
```

The manifest points at the developer-owned CLI and names any work that should
be available as a durable activity:

```js
export default {
  schemaVersion: 2,
  app: { id: 'my-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.js',
      export: 'main',
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
    'sync-on-approval': {
      steps: [
        { id: 'approval', kind: 'signal' },
        {
          id: 'sync',
          kind: 'activity',
          activity: 'sync',
          input: { kind: 'step-output', step: 'approval' },
        },
      ],
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

`schemaVersion`, `app`, and `cli` are required. `activities`, `workflows`, and
`targets` are optional, although packaging requires a nonempty target list. All
entrypoints currently use `{ kind: 'node', path, export }`; both `path` and the
named `export` are required.

Logical IDs match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and contain at most 63
ASCII bytes. The compiler rejects aliases and unknown fields instead of
normalizing them. The v2 schema has no `ActorSystem`, `functions`,
`capabilities`, scheduler, or public packaging/signing section.

A workflow is plain revision-bound data: one to 64 uniquely named ordered
`activity`, `timer`, or `signal` steps. An activity names a declared activity
and selects its entire input from `{ kind: 'workflow-input' }`, a JSON
`literal`, or the output of one named earlier step. Timer delays are positive
integer milliseconds; a signal's name is its step ID. Branches, executable
deciders, loops, parallel steps, and early-signal buffering are not part of
this contract. The complete `workflows` map is limited to 1 MiB of exact UTF-8
JSON. The compiler and packager preserve these definitions now. The public
source `wharfie ops start --workflow <workflow-id>` and packaged
`<app> wharfie start --workflow <workflow-id>` commands can persist a plan
composed entirely of ordinary activity steps. A timer, signal, or
managed-effect successor step is rejected before durable run state is created.
Exact-run inspection, confirmed recovery, and evidence-backed reconciliation
are also workflow-aware. Run-level workflow cancellation terminalizes
unstarted work, persists before exact active-attempt delivery, and fences
uncertain work against continuation. Timer/signal execution and schedules
remain later runtime slices.

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
`wharfie app package ./path/to/app` to create a portable executable.
