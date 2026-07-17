import { defineApp } from '@wharfie/wharfie/app';

import {
  kitchenSinkDefaultTargets,
  kitchenSinkExternalDependencies,
} from './config.js';

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
  activities: {
    start: {
      entrypoint: {
        kind: 'node',
        path: './activity.js',
        export: 'start',
      },
      externalPackages: kitchenSinkExternalDependencies,
    },
  },
});
