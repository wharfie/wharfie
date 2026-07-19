import {
  defineApp,
  invokeActivity,
  type ActivityRuntime,
  type ApplicationStatePutIfAbsentEffectRequest,
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
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/greet.ts',
        export: 'greet',
      },
      externalPackages: [{ name: 'example-package', version: '1.2.3' }],
    },
  },
  workflows: {
    'greet-later': {
      steps: [
        {
          id: 'greet',
          kind: 'activity',
          activity: 'greet',
          input: { kind: 'workflow-input' },
        },
        { id: 'pause', kind: 'timer', delayMs: 1_000 },
        { id: 'approved', kind: 'signal' },
        {
          id: 'greet-again',
          kind: 'activity',
          activity: 'greet',
          input: { kind: 'step-output', step: 'approved' },
        },
        {
          id: 'greet-literal',
          kind: 'activity',
          activity: 'greet',
          input: { kind: 'literal', value: { name: 'typed-workflow' } },
        },
      ],
    },
  },
});

const schemaVersion: 2 = app.schemaVersion;
const appId: 'typed-app' = app.app.id;
const entrypointKind: 'node' = app.cli.entrypoint.kind;
const cliPath: './src/cli.ts' = app.cli.entrypoint.path;
const activityExport: 'greet' = app.activities.greet.entrypoint.export;
const externalPackageName: 'example-package' =
  app.activities.greet.externalPackages[0].name;
const workflowStepKind: 'timer' = app.workflows['greet-later'].steps[1].kind;
const workflowLiteral: 'typed-workflow' =
  app.workflows['greet-later'].steps[4].input.value.name;
void schemaVersion;
void appId;
void entrypointKind;
void cliPath;
void activityExport;
void externalPackageName;
void workflowStepKind;
void workflowLiteral;

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
  workflows: {
    legacy: {
      entrypoint: './src/workflow.ts',
    },
  },
} as const;
// @ts-expect-error Workflows are strict data definitions, not code entrypoints.
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

const appWithRemovedTopLevelResources = {
  ...minimalApp,
  resources: {
    db: { adapter: 'vanilla' },
  },
} as const;
// @ts-expect-error Resources are not part of the v2 manifest authoring boundary.
defineApp(appWithRemovedTopLevelResources);

const appWithRemovedActivityResources = {
  ...minimalApp,
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/greet.ts',
        export: 'greet',
      },
      resources: { queue: { adapter: 'vanilla' } },
    },
  },
} as const;
// @ts-expect-error Activity resources are not part of the v2 authoring boundary.
defineApp(appWithRemovedActivityResources);

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

const appWithEmptyWorkflow = {
  ...minimalApp,
  workflows: {
    empty: { steps: [] },
  },
} as const;
// @ts-expect-error Workflow definitions require at least one step.
defineApp(appWithEmptyWorkflow);

const appWithExtraWorkflowKey = {
  ...minimalApp,
  workflows: {
    greet: {
      steps: [{ id: 'done', kind: 'signal' }],
      retry: { attempts: 2 },
    },
  },
} as const;
// @ts-expect-error Workflow definitions reject undeclared fields.
defineApp(appWithExtraWorkflowKey);

const appWithExtraWorkflowStepKey = {
  ...minimalApp,
  workflows: {
    greet: {
      steps: [{ id: 'done', kind: 'signal', name: 'done' }],
    },
  },
} as const;
// @ts-expect-error Workflow steps use exact discriminated shapes.
defineApp(appWithExtraWorkflowStepKey);

const appWithInvalidWorkflowInput = {
  ...minimalApp,
  workflows: {
    greet: {
      steps: [
        {
          id: 'greet',
          kind: 'activity',
          activity: 'greet',
          input: { kind: 'workflow-input', value: {} },
        },
      ],
    },
  },
} as const;
// @ts-expect-error Workflow input bindings reject undeclared fields.
defineApp(appWithInvalidWorkflowInput);

const appWithNonJsonWorkflowLiteral = {
  ...minimalApp,
  workflows: {
    greet: {
      steps: [
        {
          id: 'greet',
          kind: 'activity',
          activity: 'greet',
          input: { kind: 'literal', value: new Date() },
        },
      ],
    },
  },
} as const;
// @ts-expect-error Workflow literal inputs must be JSON values.
defineApp(appWithNonJsonWorkflowLiteral);

interface GreetResult extends JsonObject {
  message: string;
}

const result = await invokeActivity<GreetResult, { name: string }>('greet', {
  input: { name: 'typed-user' },
  callerMetadata: {
    resources: { note: 'ordinary metadata' },
  },
});

const message: string = result.message;
void message;

declare const runtime: ActivityRuntime;

const putIfAbsentRequest = {
  effectId: 'remember-greeting',
  capability: 'application-state',
  operation: 'put-if-absent',
  input: {
    key: 'greeting',
    value: {
      message: 'hello',
      attempts: 1,
      tags: ['friendly', 'durable'],
    },
  },
  requestedReplayProperties: ['idempotent', 'transactional'],
} as const satisfies ApplicationStatePutIfAbsentEffectRequest<{
  message: 'hello';
  attempts: 1;
  tags: readonly ['friendly', 'durable'];
}>;

const literalMessage: 'hello' = putIfAbsentRequest.input.value.message;
const literalTag: 'friendly' = putIfAbsentRequest.input.value.tags[0];
const putIfAbsentResult = await runtime.effects.request(putIfAbsentRequest);
const inserted: boolean = putIfAbsentResult.inserted;
void literalMessage;
void literalTag;
void inserted;

// @ts-expect-error Effect results expose only the exact inserted field.
putIfAbsentResult.created;

// @ts-expect-error Effect requests require an effectId.
runtime.effects.request({
  capability: 'application-state',
  operation: 'put-if-absent',
  input: { key: 'greeting', value: 'hello' },
  requestedReplayProperties: ['idempotent', 'transactional'],
});

runtime.effects.request({
  ...putIfAbsentRequest,
  // @ts-expect-error Effect requests reject undeclared top-level fields.
  timeoutMs: 1000,
});

runtime.effects.request({
  ...putIfAbsentRequest,
  // @ts-expect-error Effect input requires a value.
  input: { key: 'greeting' },
});

runtime.effects.request({
  ...putIfAbsentRequest,
  // @ts-expect-error Effect input rejects undeclared fields.
  input: { key: 'greeting', value: 'hello', namespace: 'extra' },
});

runtime.effects.request({
  ...putIfAbsentRequest,
  // @ts-expect-error The application-state capability is the only public capability.
  capability: 'queue',
});

runtime.effects.request({
  ...putIfAbsentRequest,
  // @ts-expect-error Put-if-absent is the only public application-state operation.
  operation: 'put',
});

runtime.effects.request({
  ...putIfAbsentRequest,
  // @ts-expect-error Replay properties must contain the exact supported tuple.
  requestedReplayProperties: ['unsafe', 'transactional'],
});

runtime.effects.request({
  ...putIfAbsentRequest,
  // @ts-expect-error Replay properties may not be reordered.
  requestedReplayProperties: ['transactional', 'idempotent'],
});

runtime.effects.request({
  ...putIfAbsentRequest,
  // @ts-expect-error Replay properties may not be a subset.
  requestedReplayProperties: ['idempotent'],
});

runtime.effects.request({
  ...putIfAbsentRequest,
  // @ts-expect-error Effect values must be JSON-safe.
  input: { key: 'greeting', value: Symbol('not-json') },
});

declare const invocation: ActivityRuntime['invocation'];
declare const caller: ActivityRuntime['caller'];
declare const signal: AbortSignal;
declare const logger: ActivityRuntime['logger'];

// @ts-expect-error Activity runtimes must expose durable effects.
const runtimeWithoutEffects: ActivityRuntime = {
  invocation,
  caller,
  signal,
  logger,
};
void runtimeWithoutEffects;
