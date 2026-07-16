import {
  defineApp,
  invokeActivity,
  type AppResources,
  type JsonObject,
} from '@wharfie/wharfie/app';

const app = defineApp({
  schemaVersion: 2,
  app: { id: 'typed-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  targets: [
    {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'arm64',
      libc: 'glibc',
    },
  ],
  resources: {
    db: { adapter: 'dynamodb', options: { region: 'us-east-1' } },
  },
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/greet.ts',
        export: 'greet',
      },
      externalPackages: [{ name: 'example-package', version: '1.2.3' }],
      resources: {
        queue: { adapter: 'vanilla', options: { path: './data/queue' } },
      },
    },
  },
});

const schemaVersion: 2 = app.schemaVersion;
const appId: 'typed-app' = app.app.id;
const entrypointKind: 'node' = app.cli.entrypoint.kind;
const cliPath: './src/cli.ts' = app.cli.entrypoint.path;
const activityExport: 'greet' = app.activities.greet.entrypoint.export;
const databaseAdapter: 'dynamodb' = app.resources.db.adapter;
const externalPackageName: 'example-package' =
  app.activities.greet.externalPackages[0].name;
void schemaVersion;
void appId;
void entrypointKind;
void cliPath;
void activityExport;
void databaseAdapter;
void externalPackageName;

const hostOnlyResources = {
  db: { adapter: 'lmdb' },
} as const;
// @ts-expect-error Host-native adapters are not in the portable v2 manifest.
const invalidResources: AppResources = hostOnlyResources;
void invalidResources;

const legacyApp = {
  schemaVersion: 2,
  app: { id: 'legacy-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  workflows: {},
} as const;
// @ts-expect-error Workflows are not in the strict v2 authoring boundary.
defineApp(legacyApp);

const minimalApp = {
  schemaVersion: 2,
  app: { id: 'minimal-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
} as const;

const appWithExtraIdentityKey = {
  ...minimalApp,
  app: { ...minimalApp.app, displayName: 'Minimal app' },
} as const;
// @ts-expect-error App identity accepts only the canonical id.
defineApp(appWithExtraIdentityKey);

const appWithExtraCliKey = {
  ...minimalApp,
  cli: { ...minimalApp.cli, description: 'unsupported' },
} as const;
// @ts-expect-error The CLI definition accepts only its entrypoint.
defineApp(appWithExtraCliKey);

const appWithExtraCliEntrypointKey = {
  ...minimalApp,
  cli: {
    entrypoint: { ...minimalApp.cli.entrypoint, loader: 'tsx' },
  },
} as const;
// @ts-expect-error Node entrypoints reject compatibility metadata.
defineApp(appWithExtraCliEntrypointKey);

const appWithExtraTargetKey = {
  ...minimalApp,
  targets: [
    {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
      vendor: 'unsupported',
    },
  ],
} as const;
// @ts-expect-error Target records accept only exact portable target fields.
defineApp(appWithExtraTargetKey);

const appWithExtraResourceKind = {
  ...minimalApp,
  resources: {
    cache: { adapter: 'vanilla', options: { path: './data/cache' } },
  },
} as const;
// @ts-expect-error The v2 manifest has exactly three portable resource kinds.
defineApp(appWithExtraResourceKind);

const appWithExtraResourceSpecKey = {
  ...minimalApp,
  resources: {
    db: {
      adapter: 'dynamodb',
      options: { region: 'us-east-1' },
      tableName: 'unsupported',
    },
  },
} as const;
// @ts-expect-error Resource specs accept only adapter and options.
defineApp(appWithExtraResourceSpecKey);

const appWithExtraResourceOptionKey = {
  ...minimalApp,
  resources: {
    queue: {
      adapter: 'sqs',
      options: { region: 'us-east-1', endpoint: 'unsupported' },
    },
  },
} as const;
// @ts-expect-error Adapter options reject provider-specific escape hatches.
defineApp(appWithExtraResourceOptionKey);

const appWithExtraActivityKey = {
  ...minimalApp,
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/greet.ts',
        export: 'greet',
      },
      retry: { attempts: 3 },
    },
  },
} as const;
// @ts-expect-error Activity definitions reject undeclared runtime policies.
defineApp(appWithExtraActivityKey);

const appWithExtraActivityEntrypointKey = {
  ...minimalApp,
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/greet.ts',
        export: 'greet',
        format: 'esm',
      },
    },
  },
} as const;
// @ts-expect-error Activity entrypoints use the same exact node shape as CLI entrypoints.
defineApp(appWithExtraActivityEntrypointKey);

const appWithExtraExternalPackageKey = {
  ...minimalApp,
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/greet.ts',
        export: 'greet',
      },
      externalPackages: [
        {
          name: 'example-package',
          version: '1.2.3',
          integrity: 'unsupported',
        },
      ],
    },
  },
} as const;
// @ts-expect-error External package records accept only exact name and version.
defineApp(appWithExtraExternalPackageKey);

interface GreetResult extends JsonObject {
  message: string;
}

const result = await invokeActivity<GreetResult, { name: string }>('greet', {
  event: { name: 'typed-user' },
});

const message: string = result.message;
void message;
