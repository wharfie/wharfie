# Wharfie Application Structure

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

`schemaVersion`, `app`, and `cli` are required. `activities` and `targets` are
optional, although packaging requires a nonempty target list. All entrypoints
currently use `{ kind: 'node', path, export }`; both `path` and the named
`export` are required.

Logical IDs match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and contain at most 63
ASCII bytes. The compiler rejects aliases and unknown fields instead of
normalizing them. The v2 schema has no `ActorSystem`, `functions`,
`capabilities`, workflows, scheduler, or public packaging/signing section.

The schema does not accept application- or activity-level `resources`; those
are unknown fields. A property named `resources` inside caller metadata remains
ordinary cloned JSON and does not request injection. Managed capabilities and
effects will use separate durable contracts in a later milestone.

An activity may pin target-specific dependencies with exact published versions:

```js
externalPackages: [{ name: 'sharp', version: '0.34.4' }],
```

External package entries use lowercase npm registry names and must be unique
and sorted by name.

Activity exports use `(input, runtime)`, rather than the former `(event,
context)` convention. `runtime.caller.metadata` carries caller-supplied JSON
metadata separately from `input`, while `runtime.invocation` supplies immutable
revision, run, invocation, attempt, and fencing identities. The initial
Activity Protocol v1 path deliberately provides neither injected resource
handles nor managed effects.

Use `wharfie app manifest ./path/to/app` to inspect the compiled manifest,
`wharfie app run sync --dir ./path/to/app` to invoke an activity locally, and
`wharfie app package ./path/to/app` to create a portable executable.
