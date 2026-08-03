import { defineApp } from '../../../../src/app.js';

export default defineApp({
  schemaVersion: 4,
  app: { id: 'systemd-service-proof' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './activity.js',
      export: 'main',
    },
    durable: {
      workflow: 'reboot-chain',
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
    {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
  ],
  activities: {
    'record-step': {
      entrypoint: {
        kind: 'node',
        path: './activity.js',
        export: 'recordStep',
      },
    },
  },
  workflows: {
    'reboot-chain': {
      steps: [
        {
          id: 'before-reboot',
          kind: 'activity',
          activity: 'record-step',
          input: { kind: 'workflow-input' },
        },
        {
          id: 'cross-reboot-delay',
          kind: 'timer',
          delayMs: 180_000,
        },
        {
          id: 'resume-after-reboot',
          kind: 'signal',
        },
        {
          id: 'after-reboot',
          kind: 'activity',
          activity: 'record-step',
          input: { kind: 'step-output', step: 'resume-after-reboot' },
        },
      ],
    },
  },
});
