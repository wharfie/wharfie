/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';

import NodeAgent from '../../../lambdas/lib/actor/runtime/services/node-agent.js';

describe('NodeAgent scheduler wiring', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts scheduler-service in leader mode and invokes cron triggers', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-18T00:00:30.000Z'));

    const invoke = jest.fn(async () => {});

    const agent = new NodeAgent({
      nodeId: 'test-node',
      role: 'leader',
      resourcesSpec: {
        scheduler: {
          triggers: [{ actor: 'alpha', cron: '* * * * *' }],
        },
      },
      cmd: process.execPath,
      prefixArgs: [],
      lambdaHost: '127.0.0.1',
      lambdaPort: 8787,
      dbHost: '127.0.0.1',
      dbPort: 8788,
      queueHost: '127.0.0.1',
      queuePort: 8789,
      controlHost: '127.0.0.1',
      controlPort: 0,
      dbAddressOverride: null,
      queueAddressOverride: null,
      pollQueueUrls: [],
      spawnServices: false,
      schedulerInvoke: invoke,
    });

    try {
      await agent.start();

      expect(invoke).toHaveBeenCalledTimes(0);

      // Next match after 00:00:30Z for "* * * * *" is 00:01:00Z.
      await jest.advanceTimersByTimeAsync(30_000);

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith('alpha', {
        cron: '* * * * *',
        scheduledTime: '2026-02-18T00:01:00.000Z',
      });
    } finally {
      const stopPromise = agent.stop('SIGTERM');
      await jest.advanceTimersByTimeAsync(2000);
      await stopPromise;
    }
  });

  it('is a no-op when no cron triggers are configured', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-18T00:00:30.000Z'));

    const invoke = jest.fn(async () => {});

    const agent = new NodeAgent({
      nodeId: 'test-node',
      role: 'leader',
      resourcesSpec: {},
      cmd: process.execPath,
      prefixArgs: [],
      lambdaHost: '127.0.0.1',
      lambdaPort: 8787,
      dbHost: '127.0.0.1',
      dbPort: 8788,
      queueHost: '127.0.0.1',
      queuePort: 8789,
      controlHost: '127.0.0.1',
      controlPort: 0,
      dbAddressOverride: null,
      queueAddressOverride: null,
      pollQueueUrls: [],
      spawnServices: false,
      schedulerInvoke: invoke,
    });

    try {
      await agent.start();

      await jest.advanceTimersByTimeAsync(5 * 60_000);
      expect(invoke).toHaveBeenCalledTimes(0);
    } finally {
      const stopPromise = agent.stop('SIGTERM');
      await jest.advanceTimersByTimeAsync(2000);
      await stopPromise;
    }
  });
});
