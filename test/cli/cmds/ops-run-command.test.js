/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileApplicationRevision } from '../../../src/cli/app/compile-application-revision.js';
import { loadApp } from '../../../src/cli/app/load-app.js';
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
      const loadedApp = await loadApp({ dir: helloWorldDir });
      const expectedRevision = await compileApplicationRevision({
        appDir: loadedApp.appDir,
        manifest: loadedApp.manifest,
      });
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
          WHARFIE_OPERATIONS_TABLE: tableName,
          WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
          WHARFIE_DB_ADAPTER: 'vanilla',
          WHARFIE_DB_PATH: dbPath,
          WHARFIE_CONTROL_ADAPTER: 'vanilla',
          WHARFIE_CONTROL_PATH: dbPath,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(
        `${resourceId}#${operationId}@${expectedRevision.revisionId}`,
      );
      expect(result.stdout).toContain('INVOKE_FUNCTION:echo-event');
      expect(result.stdout).toContain('Executed 1 action');

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
      expect(storedOperation.revision_id).toBe(expectedRevision.revisionId);
    } finally {
      await inspectDb?.close?.();
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 15000);

  it('rejects reusing an operation id after source behavior changes', async () => {
    const appDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-revision-app-'),
    );
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-revision-db-'),
    );
    const tableName = 'revision-fence-operations';
    const appId = 'revision-fence-cli';
    const resourceId = `app:${appId}`;
    const operationId = 'stable-provider-operation';
    const appApiUrl = pathToFileURL(path.join(repoRoot, 'src', 'app.js')).href;
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
    let inspectDb;

    /** @param {string} marker - Behavior marker. */
    const writeActivity = (marker) => {
      writeFileSync(
        path.join(appDir, 'activity.js'),
        `export async function work(event, context) {
          return {
            marker: ${JSON.stringify(marker)},
            revisionId: context.operation.revisionId,
            value: event.value,
          };
        }\n`,
      );
    };

    try {
      writeFileSync(
        path.join(appDir, 'package.json'),
        `${JSON.stringify({ private: true, type: 'module' })}\n`,
      );
      writeFileSync(
        path.join(appDir, 'wharfie.app.js'),
        `import { defineApp } from ${JSON.stringify(appApiUrl)};
         export default defineApp({
           schemaVersion: 2,
           app: { id: ${JSON.stringify(appId)} },
           cli: {
             entrypoint: {
               kind: 'node',
               path: './activity.js',
               export: 'work',
             },
           },
           targets: [{
             nodeVersion: '24.13.1',
             platform: 'linux',
             architecture: 'x64',
             libc: 'glibc',
           }],
           activities: {
             work: {
               entrypoint: {
                 kind: 'node',
                 path: './activity.js',
                 export: 'work',
               },
             },
           },
         });\n`,
      );
      writeActivity('v1');

      const firstLoadedApp = await loadApp({ dir: appDir });
      const firstRevision = await compileApplicationRevision({
        appDir: firstLoadedApp.appDir,
        manifest: firstLoadedApp.manifest,
      });
      const env = {
        ...process.env,
        NODE_ENV: 'development',
        WHARFIE_OPERATIONS_TABLE: tableName,
        WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
        WHARFIE_DB_ADAPTER: 'vanilla',
        WHARFIE_DB_PATH: dbPath,
        WHARFIE_CONTROL_ADAPTER: 'vanilla',
        WHARFIE_CONTROL_PATH: dbPath,
      };
      const args = [
        'ops',
        'run',
        '--activity',
        'work',
        '--operation-id',
        operationId,
        '--dir',
        appDir,
        '--event',
        '{"value":1}',
      ];
      const firstRun = runCli(args, env);

      expect(firstRun.status).toBe(0);
      expect(firstRun.stderr).toBe('');
      expect(firstRun.stdout).toContain(firstRevision.revisionId);

      writeActivity('v2');
      const secondLoadedApp = await loadApp({ dir: appDir });
      const secondRevision = await compileApplicationRevision({
        appDir: secondLoadedApp.appDir,
        manifest: secondLoadedApp.manifest,
      });
      expect(secondRevision.revisionId).not.toBe(firstRevision.revisionId);

      const secondRun = runCli(args, env);
      expect(secondRun.status).toBe(1);
      expect(secondRun.stderr).toContain(
        'Operation revision conflicts with existing work',
      );
      expect(secondRun.stderr).toContain(firstRevision.revisionId);
      expect(secondRun.stderr).toContain(secondRevision.revisionId);

      inspectDb = createVanillaDB({ path: dbPath });
      const inspectStore = operationsStoreFactory({ db: inspectDb, tableName });
      const storedOperation = await inspectStore.getOperation(
        resourceId,
        operationId,
      );
      const storedAction = await inspectStore.getAction(
        resourceId,
        operationId,
        'invoke',
      );

      expect(storedOperation?.revision_id).toBe(firstRevision.revisionId);
      expect(storedAction).toMatchObject({
        status: ActionStatus.COMPLETED,
        attempt_count: 1,
        outputs: {
          marker: 'v1',
          revisionId: firstRevision.revisionId,
          value: 1,
        },
      });
    } finally {
      await inspectDb?.close?.();
      rmSync(appDir, { recursive: true, force: true });
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 30000);
});
