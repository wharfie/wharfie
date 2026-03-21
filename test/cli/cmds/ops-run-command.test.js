/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import createVanillaDB from '../../../lambdas/lib/db/adapters/vanilla.js';
import operationsStoreFactory from '../../../lambdas/lib/graph/operations-store.js';
import Action, {
  Status as ActionStatus,
} from '../../../lambdas/lib/graph/action.js';
import Operation, {
  Status as OperationStatus,
  Type as OperationType,
} from '../../../lambdas/lib/graph/operation.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const helloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'actor-systems',
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
  it('executes INVOKE_FUNCTION actions against a local app and persists outputs', async () => {
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-run-'));
    const tableName = 'operations-test';
    const resourceId = 'resource-1';
    /** @type {import('../../../lambdas/lib/db/base.js').DBClient | undefined} */
    let inspectDb;

    /** @type {import('../../../lambdas/lib/graph/operation.js').default} */
    let operation;
    /** @type {import('../../../lambdas/lib/graph/action.js').default} */
    let invokeAction;

    try {
      const db = createVanillaDB({ path: dbPath });
      const store = operationsStoreFactory({ db, tableName });

      operation = new Operation({
        id: 'op-1',
        resource_id: resourceId,
        resource_version: 1,
        type: OperationType.PIPELINE,
        started_at: 1,
        last_updated_at: 1,
      });

      const startAction = operation.createAction({
        id: 'start-1',
        type: Action.Type.START,
      });
      invokeAction = operation.createAction({
        id: 'invoke-1',
        type: Action.Type.INVOKE_FUNCTION,
        function_name: 'echo-event',
        inputs: { who: 'ops-run' },
        placement: { mode: 'local' },
        retry: { max_attempts: 1 },
        dependsOn: [startAction],
      });
      operation.createAction({
        id: 'finish-1',
        type: Action.Type.FINISH,
        dependsOn: [invokeAction],
      });

      await store.putOperation(operation);
      await db.close();

      const result = runCli(
        ['ops', 'run', resourceId, operation.id, '--dir', helloWorldDir],
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
      expect(result.stdout).toContain('invoke-1');
      expect(result.stdout).toContain('Executed 3 actions.');

      inspectDb = createVanillaDB({ path: dbPath });
      const inspectStore = operationsStoreFactory({ db: inspectDb, tableName });

      const storedAction = await inspectStore.getAction(
        resourceId,
        operation.id,
        invokeAction.id,
      );
      const storedOperation = await inspectStore.getOperation(
        resourceId,
        operation.id,
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
