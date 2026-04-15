/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import operationsStoreFactory from '../../../src/core/lib/graph/operations-store.js';
import Action, {
  Status as ActionStatus,
} from '../../../src/core/lib/graph/action.js';
import Operation, {
  Status as OperationStatus,
  Type as OperationType,
} from '../../../src/core/lib/graph/operation.js';

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

const actorSystemUrl = pathToFileURL(
  path.join(repoRoot, 'src', 'core', 'resources', 'builds', 'actor-system.js'),
).href;
const functionUrl = pathToFileURL(
  path.join(repoRoot, 'src', 'core', 'resources', 'builds', 'function.js'),
).href;

/**
 * @returns {Promise<string>} - Result.
 */
async function createWorkflowAppDir() {
  const dir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-workflow-app-'),
  );
  const handlerPath = path.join(dir, 'workflow-handler.js');

  await fsp.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ type: 'module' }),
    'utf8',
  );
  await fsp.writeFile(
    handlerPath,
    [
      'export async function inspectWorkflow(event = {}, context = {}) {',
      '  return {',
      '    ok: true,',
      '    event,',
      '    workflow: context.workflow || null,',
      '  };',
      '}',
      '',
      'export async function failWorkflow() {',
      "  throw new Error('workflow boom');",
      '}',
    ].join('\n'),
    'utf8',
  );
  await fsp.writeFile(
    path.join(dir, 'wharfie.app.js'),
    `
      import ActorSystem from ${JSON.stringify(actorSystemUrl)};
      import Function from ${JSON.stringify(functionUrl)};

      export default new ActorSystem({
        name: 'ops-workflow-demo',
        functions: [
          new Function({
            name: 'inspect-workflow',
            entrypoint: {
              path: ${JSON.stringify(handlerPath)},
              export: 'inspectWorkflow',
            },
          }),
          new Function({
            name: 'fail-workflow',
            entrypoint: {
              path: ${JSON.stringify(handlerPath)},
              export: 'failWorkflow',
            },
          }),
        ],
        properties: {
          targets: [],
          resources: {},
          workflows: {
            happyPath: {
              actions: [
                { id: 'start-workflow', type: 'START' },
                {
                  id: 'invoke-workflow',
                  type: 'INVOKE_FUNCTION',
                  functionName: 'inspect-workflow',
                  inputs: { who: 'workflow-user' },
                  placement: { mode: 'local' },
                  retry: { max_attempts: 1 },
                  dependsOn: ['start-workflow'],
                },
                {
                  id: 'finish-workflow',
                  type: 'FINISH',
                  dependsOn: ['invoke-workflow'],
                },
              ],
            },
            failingPath: {
              actions: [
                { id: 'start-failing-workflow', type: 'START' },
                {
                  id: 'invoke-failing-workflow',
                  type: 'INVOKE_FUNCTION',
                  functionName: 'fail-workflow',
                  placement: { mode: 'local' },
                  retry: { max_attempts: 1 },
                  dependsOn: ['start-failing-workflow'],
                },
              ],
            },
            blockedPath: {
              actions: [
                {
                  id: 'blocked-action',
                  type: 'INVOKE_FUNCTION',
                  functionName: 'inspect-workflow',
                  placement: { mode: 'local' },
                  dependsOn: ['missing-action'],
                },
              ],
            },
          },
        },
      });
    `,
    'utf8',
  );

  return dir;
}

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

  it('runs an app-defined workflow by name and injects workflow metadata into the function context', async () => {
    const appDir = await createWorkflowAppDir();
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-workflow-'));
    const tableName = 'operations-workflow-test';
    const resourceId = 'app:ops-workflow-demo';
    const operationId = 'workflow-op';
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
    let inspectDb;

    try {
      const result = runCli(
        [
          'ops',
          'run',
          '--workflow',
          'happyPath',
          '--operation-id',
          operationId,
          '--dir',
          appDir,
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
      expect(result.stdout).toContain('invoke-workflow');
      expect(result.stdout).toContain('Executed 3 actions.');

      inspectDb = createVanillaDB({ path: dbPath });
      const inspectStore = operationsStoreFactory({
        db: inspectDb,
        tableName,
      });

      const storedAction = await inspectStore.getAction(
        resourceId,
        operationId,
        'invoke-workflow',
      );
      const storedOperation = await inspectStore.getOperation(
        resourceId,
        operationId,
      );

      expect(storedAction).not.toBeNull();
      expect(storedOperation).not.toBeNull();
      if (!storedAction || !storedOperation) {
        throw new Error('Expected stored workflow records to exist');
      }

      expect(storedAction.status).toBe(ActionStatus.COMPLETED);
      expect(storedAction.outputs).toEqual({
        ok: true,
        event: { who: 'workflow-user' },
        workflow: {
          resourceId,
          operationId,
          actionId: 'invoke-workflow',
          actionType: Action.Type.INVOKE_FUNCTION,
          attemptCount: 1,
          placement: { mode: 'local' },
        },
      });
      expect(storedOperation.status).toBe(OperationStatus.COMPLETED);
    } finally {
      await inspectDb?.close?.();
      rmSync(appDir, { recursive: true, force: true });
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 15000);

  it('fails with a helpful error when an app-defined workflow does not exist', async () => {
    const appDir = await createWorkflowAppDir();
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-workflow-missing-'),
    );

    try {
      const result = runCli(
        ['ops', 'run', '--workflow', 'missingPath', '--dir', appDir],
        {
          ...process.env,
          NODE_ENV: 'development',
          OPERATIONS_TABLE: 'operations-workflow-test',
          WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
          WHARFIE_DB_ADAPTER: 'vanilla',
          WHARFIE_DB_PATH: dbPath,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Workflow 'missingPath' was not found");
      expect(result.stderr).toContain('happyPath');
      expect(result.stderr).toContain('failingPath');
      expect(result.stderr).toContain('blockedPath');
    } finally {
      rmSync(appDir, { recursive: true, force: true });
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 15000);

  it('persists FAILED workflow operations when a workflow function throws', async () => {
    const appDir = await createWorkflowAppDir();
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-workflow-failing-'),
    );
    const tableName = 'operations-workflow-test';
    const resourceId = 'app:ops-workflow-demo';
    const operationId = 'workflow-failing';
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
    let inspectDb;

    try {
      const result = runCli(
        [
          'ops',
          'run',
          '--workflow',
          'failingPath',
          '--operation-id',
          operationId,
          '--dir',
          appDir,
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

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('status FAILED');
      expect(result.stdout).toContain('invoke-failing-workflow');

      inspectDb = createVanillaDB({ path: dbPath });
      const inspectStore = operationsStoreFactory({
        db: inspectDb,
        tableName,
      });

      const storedAction = await inspectStore.getAction(
        resourceId,
        operationId,
        'invoke-failing-workflow',
      );
      const storedOperation = await inspectStore.getOperation(
        resourceId,
        operationId,
      );

      expect(storedAction).not.toBeNull();
      expect(storedOperation).not.toBeNull();
      if (!storedAction || !storedOperation) {
        throw new Error('Expected stored failing workflow records to exist');
      }

      expect(storedAction.status).toBe(ActionStatus.FAILED);
      expect(storedAction.attempt_count).toBe(1);
      expect(storedAction.error).toEqual(
        expect.objectContaining({ message: 'workflow boom' }),
      );
      expect(storedOperation.status).toBe(OperationStatus.FAILED);
    } finally {
      await inspectDb?.close?.();
      rmSync(appDir, { recursive: true, force: true });
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 15000);

  it('persists BLOCKED workflow operations when prerequisites can never be satisfied', async () => {
    const appDir = await createWorkflowAppDir();
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-workflow-blocked-'),
    );
    const tableName = 'operations-workflow-test';
    const resourceId = 'app:ops-workflow-demo';
    const operationId = 'workflow-blocked';
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
    let inspectDb;

    try {
      const result = runCli(
        [
          'ops',
          'run',
          '--workflow',
          'blockedPath',
          '--operation-id',
          operationId,
          '--dir',
          appDir,
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

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('status BLOCKED');
      expect(result.stderr).toContain('blocked=blocked-action');

      inspectDb = createVanillaDB({ path: dbPath });
      const inspectStore = operationsStoreFactory({
        db: inspectDb,
        tableName,
      });

      const storedAction = await inspectStore.getAction(
        resourceId,
        operationId,
        'blocked-action',
      );
      const storedOperation = await inspectStore.getOperation(
        resourceId,
        operationId,
      );

      expect(storedAction).not.toBeNull();
      expect(storedOperation).not.toBeNull();
      if (!storedAction || !storedOperation) {
        throw new Error('Expected stored blocked workflow records to exist');
      }

      expect(storedAction.status).toBe(ActionStatus.PENDING);
      expect(storedOperation.status).toBe(OperationStatus.BLOCKED);
    } finally {
      await inspectDb?.close?.();
      rmSync(appDir, { recursive: true, force: true });
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 15000);
});
