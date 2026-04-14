/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { jest } from '@jest/globals';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import operationsStoreFactory from '../../../src/core/lib/graph/operations-store.js';
import Action, {
  Status as ActionStatus,
} from '../../../src/core/lib/graph/action.js';
import { Status as OperationStatus } from '../../../src/core/lib/graph/operation.js';
import NodeAgent from '../../../src/core/runtime/services/node-agent.js';

describe('NodeAgent scheduler wiring', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts scheduler-service in leader mode, persists cron runs, and invokes cron triggers', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-18T00:00:30.000Z'));

    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-node-agent-scheduler-'),
    );
    const tableName = 'node-agent-scheduler-test';
    const invoke = jest.fn(async () => {});
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
    let inspectDb;

    try {
      await withEnv(
        {
          NODE_ENV: 'development',
          OPERATIONS_TABLE: tableName,
          WHARFIE_DB_ADAPTER: 'vanilla',
          WHARFIE_DB_PATH: dbPath,
        },
        async () => {
          const agent = new NodeAgent({
            nodeId: 'test-node',
            role: 'leader',
            resourcesSpec: {},
            manifest: {
              app: { name: 'scheduler-demo' },
              functions: [
                {
                  name: 'alpha',
                  entrypoint: {
                    path: '/artifact/functions/alpha.js',
                    export: 'alpha',
                  },
                },
              ],
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
        },
      );

      inspectDb = createVanillaDB({ path: dbPath });
      const inspectStore = operationsStoreFactory({ db: inspectDb, tableName });
      const operations = await inspectStore.getOperations('app:scheduler-demo');

      expect(operations).toHaveLength(1);
      expect(operations[0]).toEqual(
        expect.objectContaining({
          status: OperationStatus.COMPLETED,
          operation_config: {
            source: 'scheduler',
            app_name: 'scheduler-demo',
            activity_name: 'alpha',
            trigger: {
              source: 'cron',
              cron: '* * * * *',
              scheduledTime: '2026-02-18T00:01:00.000Z',
            },
          },
          operation_inputs: {
            cron: '* * * * *',
            scheduledTime: '2026-02-18T00:01:00.000Z',
          },
        }),
      );

      const actions = await inspectStore.getActions(operations[0]);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual(
        expect.objectContaining({
          id: 'invoke',
          type: Action.Type.INVOKE_FUNCTION,
          status: ActionStatus.COMPLETED,
          function_name: 'alpha',
          inputs: {
            cron: '* * * * *',
            scheduledTime: '2026-02-18T00:01:00.000Z',
          },
          attempt_count: 1,
        }),
      );
    } finally {
      await inspectDb?.close?.();
      rmSync(dbPath, { recursive: true, force: true });
    }
  });

  it('requires remote state addresses for worker nodes when the packaged manifest declares them', async () => {
    const agent = new NodeAgent({
      nodeId: 'test-node',
      role: 'worker',
      resourcesSpec: {},
      manifest: {
        app: { name: 'worker-demo' },
        resources: {
          db: { adapter: 'vanilla' },
          queue: { adapter: 'vanilla' },
        },
        functions: [
          {
            name: 'alpha',
            entrypoint: {
              path: '/artifact/functions/alpha.js',
              export: 'alpha',
            },
          },
        ],
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
    });

    await expect(agent.start()).rejects.toThrow(/requires --db-address/);
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

/**
 * @template T
 * @param {Record<string, string | undefined>} overrides - overrides.
 * @param {() => Promise<T>} fn - fn.
 * @returns {Promise<T>} - Result.
 */
async function withEnv(overrides, fn) {
  /** @type {Record<string, string | undefined>} */
  const previous = {};

  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
