import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  schemaVersion: 2,
  app: { id: 'context-override-demo' },
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
  resources: {
    db: {
      adapter: 'vanilla',
      options: { path: 'tmp/wharfie-examples/context-override' },
    },
  },
  activities: {
    'inspect-context': {
      entrypoint: {
        kind: 'node',
        path: './activity.js',
        export: 'inspectContext',
      },
    },
  },
});
