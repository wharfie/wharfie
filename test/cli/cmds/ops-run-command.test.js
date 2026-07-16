/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import operationsStoreFactory from '../../../src/core/lib/graph/operations-store.js';
import { Status as ActionStatus } from '../../../src/core/lib/graph/action.js';
import { Status as OperationStatus } from '../../../src/core/lib/graph/operation.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const helloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'apps',
  'hello-world',
);

/**
 * @param {string[]} args - args.
 * @param {Record<string, string | undefined>} env - env.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} - Result.
 */
function runCli(args, env) {
  return /** @type {import('node:child_process').SpawnSyncReturns<string>} */ (
    spawnSync(process.execPath, [binPath, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
    })
  );
}

describe('wharfie ops run', () => {
  it('executes an app activity as a persisted run and stores outputs', async () => {
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-run-'));
    const tableName = 'operations-test';
    const resourceId = 'app:hello-world-demo';
    const operationId = 'op-1';
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
    let inspectDb;

    try {
      const result = runCli(
        [
          'ops',
          'run',
          '--activity',
          'echo-event',
          '--operation-id',
          operationId,
          '--dir',
          helloWorldDir,
          '--event',
          '{"who":"ops-run"}',
        ],
        {
          ...process.env,
          NODE_ENV: 'development',
          OPERATIONS_TABLE: tableName,
          WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
          WHARFIE_DB_ADAPTER: 'vanilla',
          WHARFIE_DB_PATH: dbPath,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('INVOKE_FUNCTION:echo-event');
      expect(result.stdout).toContain('Executed 3 actions.');

      inspectDb = createVanillaDB({ path: dbPath });
      const inspectStore = operationsStoreFactory({ db: inspectDb, tableName });

      const storedAction = await inspectStore.getAction(
        resourceId,
        operationId,
        'invoke',
      );
      const storedOperation = await inspectStore.getOperation(
        resourceId,
        operationId,
      );

      expect(storedAction).not.toBeNull();
      expect(storedOperation).not.toBeNull();
      if (!storedAction || !storedOperation) {
        throw new Error('Expected stored action and operation to exist');
      }

      expect(storedAction.status).toBe(ActionStatus.COMPLETED);
      expect(storedAction.function_name).toBe('echo-event');
      expect(storedAction.inputs).toEqual({ who: 'ops-run' });
      expect(storedAction.attempt_count).toBe(1);
      expect(storedAction.error).toBeUndefined();
      expect(storedAction.outputs).toEqual({
        ok: true,
        who: 'ops-run',
        message: 'hello ops-run',
        requestId: null,
      });
      expect(storedOperation.status).toBe(OperationStatus.COMPLETED);
    } finally {
      await inspectDb?.close?.();
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 15000);
});
