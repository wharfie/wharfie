import {
  defineApp,
  invokeActivity,
  type ActivityRuntime,
  type ApplicationStatePutIfAbsentEffectRequest,
  type JsonObject,
} from '@wharfie/wharfie/app';

const cliOnlyApp = defineApp({
  schemaVersion: 4,
  app: { id: 'cli-only-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
});
const cliOnlySchemaVersion: 4 = cliOnlyApp.schemaVersion;
void cliOnlySchemaVersion;

const emptyWorkflowMapApp = {
  schemaVersion: 4,
  app: { id: 'empty-workflow-map' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  workflows: {},
} as const;
// @ts-expect-error A declared workflow map must be nonempty.
defineApp(emptyWorkflowMapApp);

const emptyScheduleMapApp = {
  schemaVersion: 4,
  app: { id: 'empty-schedule-map' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  schedules: {},
} as const;
// @ts-expect-error A declared schedule map must be nonempty.
defineApp(emptyScheduleMapApp);

const scheduleWithoutDeclaredWorkflow = {
  schemaVersion: 4,
  app: { id: 'missing-schedule-workflow' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  workflows: {
    present: {
      steps: [{ id: 'wait', kind: 'signal' }],
    },
  },
  schedules: {
    nightly: {
      cron: '0 0 * * *',
      workflow: 'missing',
      input: {},
      missed: 'latest',
      overlap: 'allow',
    },
  },
} as const;
// @ts-expect-error Every schedule must reference a workflow in the same manifest.
defineApp(scheduleWithoutDeclaredWorkflow);

const durableCliWithoutDeclaredWorkflow = {
  schemaVersion: 4,
  app: { id: 'missing-durable-cli-workflow' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
    durable: {
      workflow: 'missing',
      export: 'toDurableInput',
    },
  },
  workflows: {
    present: {
      steps: [{ id: 'wait', kind: 'signal' }],
    },
  },
} as const;
// @ts-expect-error A durable CLI handoff must reference a workflow in the same manifest.
defineApp(durableCliWithoutDeclaredWorkflow);

const durableCliWithoutWorkflows = {
  schemaVersion: 4,
  app: { id: 'durable-cli-without-workflows' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
    durable: {
      workflow: 'missing',
      export: 'toDurableInput',
    },
  },
} as const;
// @ts-expect-error A durable CLI handoff requires a declared workflow map.
defineApp(durableCliWithoutWorkflows);

const app = defineApp({
  schemaVersion: 4,
  app: { id: 'typed-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
    durable: {
      workflow: 'greet-later',
      export: 'toDurableInput',
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
  schedules: {
    nightly: {
      cron: '0 0 * * *',
      workflow: 'greet-later',
      input: { source: 'typed-schedule' },
      missed: 'latest',
      overlap: 'allow',
    },
  },
});

const schemaVersion: 4 = app.schemaVersion;
const appId: 'typed-app' = app.app.id;
const entrypointKind: 'node' = app.cli.entrypoint.kind;
const cliPath: './src/cli.ts' = app.cli.entrypoint.path;
const durableWorkflow: 'greet-later' = app.cli.durable.workflow;
const durableExport: 'toDurableInput' = app.cli.durable.export;
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
void durableWorkflow;
void durableExport;
void activityExport;
void externalPackageName;
void workflowStepKind;
void workflowLiteral;

const scheduledApp = defineApp({
  schemaVersion: 4,
  app: { id: 'scheduled-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  workflows: {
    refresh: {
      steps: [{ id: 'approval', kind: 'signal' }],
    },
  },
  schedules: {
    nightly: {
      cron: '0 0 * * *',
      workflow: 'refresh',
      input: { source: 'schedule' },
      missed: 'latest',
      overlap: 'allow',
    },
  },
});

const scheduleSchemaVersion: 4 = scheduledApp.schemaVersion;
const scheduleCron: '0 0 * * *' = scheduledApp.schedules.nightly.cron;
const scheduleInput: 'schedule' = scheduledApp.schedules.nightly.input.source;
void scheduleSchemaVersion;
void scheduleCron;
void scheduleInput;

const v3WithSchedule = {
  schemaVersion: 3,
  app: { id: 'invalid-v3-schedule' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  schedules: {
    nightly: {
      cron: '0 0 * * *',
      workflow: 'refresh',
      input: {},
      missed: 'latest',
      overlap: 'allow',
    },
  },
} as const;
// @ts-expect-error Schedules require the exact schemaVersion 4 manifest shape.
defineApp(v3WithSchedule);

const legacyApp = {
  schemaVersion: 4,
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
  schedules: {
    legacy: {
      cron: '0 0 * * *',
      workflow: 'legacy',
      input: {},
      missed: 'latest',
      overlap: 'allow',
    },
  },
} as const;
// @ts-expect-error Workflows are strict data definitions, not code entrypoints.
defineApp(legacyApp);

const minimalApp = {
  schemaVersion: 4,
  app: { id: 'minimal-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  workflows: {
    wait: {
      steps: [{ id: 'ready', kind: 'signal' }],
    },
  },
  schedules: {
    wait: {
      cron: '0 0 * * *',
      workflow: 'wait',
      input: {},
      missed: 'latest',
      overlap: 'allow',
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
// @ts-expect-error The CLI definition accepts only its exact supported fields.
defineApp(appWithExtraCliKey);

const appWithExtraDurableCliKey = {
  ...minimalApp,
  cli: {
    ...minimalApp.cli,
    durable: {
      workflow: 'wait',
      export: 'toDurableInput',
      input: {},
    },
  },
} as const;
// @ts-expect-error Durable CLI handoffs accept only workflow and export.
defineApp(appWithExtraDurableCliKey);

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
// @ts-expect-error Resources are not part of the v4 manifest authoring boundary.
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
// @ts-expect-error Activity resources are not part of the v4 authoring boundary.
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
