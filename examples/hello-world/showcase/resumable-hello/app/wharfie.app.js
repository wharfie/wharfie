import { defineApp } from '@wharfie/wharfie/app';

import { DURABLE_DELAY_MS } from './hello.js';

export default defineApp({
  id: 'resumable-hello',
  main: './hello.js',
  durable: 'hello-after-delay',
  activityModule: './hello.js',
  activities: {
    'prepare-greeting': {
      export: 'prepareGreeting',
    },
    'say-hello': {
      export: 'sayHello',
    },
  },
  workflows: {
    'hello-after-delay': {
      steps: [
        {
          id: 'prepare',
          kind: 'activity',
          activity: 'prepare-greeting',
          input: { kind: 'workflow-input' },
        },
        { id: 'wait', kind: 'timer', delayMs: DURABLE_DELAY_MS },
        {
          id: 'say-hello',
          kind: 'activity',
          activity: 'say-hello',
          input: { kind: 'step-output', step: 'prepare' },
        },
      ],
    },
  },
});
