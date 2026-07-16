import { defineApp } from '../../../../src/app.js';

const resources = {
  db: {
    adapter: 'vanilla',
    options: { path: 'tmp/wharfie-examples/hello-world' },
  },
  queue: {
    adapter: 'vanilla',
    options: { path: 'tmp/wharfie-examples/hello-world' },
  },
  objectStorage: {
    adapter: 'vanilla',
    options: { path: 'tmp/wharfie-examples/hello-world' },
  },
};

export default defineApp({
  schemaVersion: 2,
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
  resources,
  activities: {
    'echo-event': {
      entrypoint: {
        kind: 'node',
        path: './activities.js',
        export: 'echoEvent',
      },
    },
    'hello-resources': {
      entrypoint: {
        kind: 'node',
        path: './activities.js',
        export: 'helloResources',
      },
    },
  },
});
