// This repository fixture loads the authoring helper from the checkout. Its
// portable CLI and activity still use only package/public or snapshotted edges.
import { defineApp } from '../../../../src/app.js';

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
