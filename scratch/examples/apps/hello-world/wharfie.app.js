import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  schemaVersion: 3,
  app: { id: 'hello-world-demo' },
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
    'echo-event': {
      entrypoint: {
        kind: 'node',
        path: './activities.js',
        export: 'echoEvent',
      },
    },
  },
  workflows: {
    'echo-twice': {
      steps: [
        {
          id: 'echo-first',
          kind: 'activity',
          activity: 'echo-event',
          input: { kind: 'workflow-input' },
        },
        {
          id: 'echo-second',
          kind: 'activity',
          activity: 'echo-event',
          input: { kind: 'step-output', step: 'echo-first' },
        },
      ],
    },
  },
  schedules: {
    'echo-hourly': {
      cron: '0 * * * *',
      workflow: 'echo-twice',
      input: { message: 'hello from the resident schedule' },
      missed: 'latest',
      overlap: 'allow',
    },
  },
});
