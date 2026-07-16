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

`schemaVersion`, `app`, and `cli` are required. `activities`, `resources`, and
`targets` are optional, although packaging requires a nonempty target list. All
entrypoints currently use `{ kind: 'node', path, export }`; both `path` and the
named `export` are required.

Logical IDs match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and contain at most 63
ASCII bytes. The compiler rejects aliases and unknown fields instead of
normalizing them. The v2 schema has no `ActorSystem`, `functions`,
`capabilities`, workflows, scheduler, or public packaging/signing section.

Only these portable resource bindings are public today:

```js
resources: {
  db: { adapter: 'vanilla', options: { path: './data/db' } },
  queue: { adapter: 'sqs', options: { region: 'us-east-1' } },
  objectStorage: { adapter: 's3', options: { region: 'us-east-1' } },
},
```

Database adapters are `vanilla` or `dynamodb`, queue adapters are `vanilla` or
`sqs`, and object-storage adapters are `vanilla` or `s3`. Resource options are
limited to the documented `path` and `region` fields and must not contain
credentials or secrets. An activity may declare the same `resources` map and
may pin target-specific dependencies with exact published versions:

```js
externalPackages: [{ name: 'sharp', version: '0.34.4' }],
```

External package entries use lowercase npm registry names and must be unique
and sorted by name.

Use `wharfie app manifest ./path/to/app` to inspect the compiled manifest,
`wharfie app run sync --dir ./path/to/app` to invoke an activity locally, and
`wharfie app package ./path/to/app` to create a portable executable.
