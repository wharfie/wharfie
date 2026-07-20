import { defineApp } from '../../../../src/app.js';

export default defineApp({
  schemaVersion: 2,
  app: { id: 'workflow-crash-source' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './activity.js',
      export: 'main',
    },
  },
  targets: [
    {
      nodeVersion: '24.13.1',
      platform: 'darwin',
      architecture: 'arm64',
    },
    {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
  ],
  activities: {
    'crash-step': {
      entrypoint: {
        kind: 'node',
        path: './activity.js',
        export: 'crashStep',
      },
    },
  },
  workflows: {
    'crash-chain': {
      steps: [
        {
          id: 'first',
          kind: 'activity',
          activity: 'crash-step',
          input: { kind: 'workflow-input' },
        },
        {
          id: 'second',
          kind: 'activity',
          activity: 'crash-step',
          input: { kind: 'step-output', step: 'first' },
        },
      ],
    },
  },
});
