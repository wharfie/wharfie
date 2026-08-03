import { defineApp } from '@wharfie/wharfie/app';

import {
  kitchenSinkDefaultTargets,
  kitchenSinkExternalDependencies,
} from './config.js';

export default defineApp({
  schemaVersion: 4,
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
  workflows: {
    'scheduled-start': {
      steps: [
        {
          id: 'start',
          kind: 'activity',
          activity: 'start',
          input: { kind: 'workflow-input' },
        },
      ],
    },
  },
  schedules: {
    daily: {
      cron: '0 0 * * *',
      workflow: 'scheduled-start',
      input: { source: 'daily-schedule' },
      missed: 'latest',
      overlap: 'allow',
    },
  },
});
