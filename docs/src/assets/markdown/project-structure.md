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
  name: 'my-app',
  cli: {
    entrypoint: './src/cli.js',
  },
  activities: {
    sync: {
      entrypoint: {
        path: './src/activities/sync.js',
        export: 'sync',
      },
    },
  },
  targets: [
    {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
    },
  ],
};
```

Use `wharfie app manifest ./path/to/app` to inspect the compiled manifest,
`wharfie app run sync --dir ./path/to/app` to invoke an activity locally, and
`wharfie app package ./path/to/app` to create a portable executable.
