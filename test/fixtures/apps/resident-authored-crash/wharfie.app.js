// eslint-disable-next-line import/no-unresolved -- resolved through the package self-reference or isolated-fixture bridge.
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  schemaVersion: 4,
  app: { id: 'resident-authored-crash' },
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
    'crash-task': {
      entrypoint: {
        kind: 'node',
        path: './activity.js',
        export: 'crashTask',
      },
    },
  },
});
