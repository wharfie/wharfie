import { DURABLE_STABILITY_WINDOW_MS } from './file-stability.js';

export default {
  schemaVersion: 4,
  app: { id: 'steady-file-demo' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './cli.js',
      export: 'main',
    },
    durable: {
      workflow: 'verify-stable',
      export: 'toDurableInput',
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
      architecture: 'arm64',
      libc: 'glibc',
    },
    {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
  ],
  activities: {
    capture: {
      entrypoint: {
        kind: 'node',
        path: './activities.js',
        export: 'capture',
      },
    },
    verify: {
      entrypoint: {
        kind: 'node',
        path: './activities.js',
        export: 'verify',
      },
    },
  },
  workflows: {
    'verify-stable': {
      steps: [
        {
          id: 'baseline',
          kind: 'activity',
          activity: 'capture',
          input: { kind: 'workflow-input' },
        },
        {
          id: 'stability-window',
          kind: 'timer',
          delayMs: DURABLE_STABILITY_WINDOW_MS,
        },
        {
          id: 'comparison',
          kind: 'activity',
          activity: 'verify',
          input: { kind: 'step-output', step: 'baseline' },
        },
      ],
    },
  },
};
