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
`runtime.logger` for structured logs. `runtime.signal` is reserved for host
cancellation; public source/SEA invocation does not yet expose cancellation
until the worker transport is framed. The initial Activity Protocol v1
execution path does not inject resource handles or managed effects.

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

To create a persisted local operation for an activity, use `wharfie ops`:

```bash
wharfie ops run --activity <activity-id> --dir ./path/to/app --input '{"who":"cli-user"}'
wharfie ops list --dir ./path/to/app
```

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
