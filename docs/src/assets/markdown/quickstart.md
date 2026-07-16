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
manifest identifies the developer-owned CLI, named activities, runtime
resources, and package targets. Wharfie does not require a generated project
tree. See [Application Structure](./project-structure) for a minimal layout.
The `@wharfie/wharfie/app` subpath ships TypeScript declarations for the
manifest helper and activity invocation API.

Activity definitions do not accept `environmentVariables`. Current local
execution has no per-activity environment boundary, and portable artifacts must
not embed per-activity environment values in manifests. Supply runtime
configuration to the process environment until Wharfie has first-class portable
configuration and secret references.

If the CLI module uses a named export instead of `default` or `main`, select it
explicitly:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  name: 'my-app',
  cli: {
    entrypoint: './src/cli.ts',
    export: 'launch',
  },
  // Add activities and package targets here.
});
```

From the developer-owned CLI, invoke the same named activity locally and in the
packaged executable:

```ts
import { invokeActivity } from '@wharfie/wharfie/app';

export async function launch(argv: string[] = process.argv) {
  const result = await invokeActivity('greet', {
    event: { name: argv[2] ?? 'world' },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
```

## Inspect the app manifest

Pass the directory containing `wharfie.app.js`:

```bash
wharfie app manifest ./path/to/app
```

## Run a local activity

```bash
wharfie app run <activity_name> --dir ./path/to/app --event '{"who":"cli-user"}'
```

To create a persisted local operation for an activity or workflow, use
`wharfie ops`:

```bash
wharfie ops run --activity <activity_name> --dir ./path/to/app --event '{"who":"cli-user"}'
wharfie ops list --dir ./path/to/app
```

## Package the app

```bash
wharfie app package ./path/to/app
```

Packaging creates target-specific Node SEA executables. Target machines do not
need a preinstalled Node runtime, container runtime, or hosted Wharfie service.

The shipped top-level CLI surface is `app` and `ops`.
