import { defineApp } from '@wharfie/wharfie/app';

import { STABILITY_WINDOW_MS } from './file-stability.js';

export default defineApp({
  schemaVersion: 3,
  app: { id: 'steady-file-demo' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './cli.js',
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
          delayMs: STABILITY_WINDOW_MS,
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
});
