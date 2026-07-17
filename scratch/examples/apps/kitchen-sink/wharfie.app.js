import { defineApp } from '@wharfie/wharfie/app';

import {
  kitchenSinkDefaultTargets,
  kitchenSinkExternalDependencies,
} from './config.js';

const createVanillaResources = (resourcePath) => ({
  db: { adapter: 'vanilla', options: { path: resourcePath } },
  queue: { adapter: 'vanilla', options: { path: resourcePath } },
  objectStorage: { adapter: 'vanilla', options: { path: resourcePath } },
});

export default defineApp({
  schemaVersion: 2,
  app: { id: 'kitchen-sink-demo' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './cli.js',
      export: 'main',
    },
  },
  targets: kitchenSinkDefaultTargets,
  resources: createVanillaResources('tmp/wharfie-examples/kitchen-sink/system'),
  activities: {
    start: {
      entrypoint: {
        kind: 'node',
        path: './activity.js',
        export: 'start',
      },
      externalPackages: kitchenSinkExternalDependencies,
      resources: createVanillaResources(
        'tmp/wharfie-examples/kitchen-sink/activity',
      ),
    },
  },
});
