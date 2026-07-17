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
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../../src/core/lib/db/tables/execution-ledger.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../../src/core/runtime/manual-ledger-run.js';

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
 * @param {string[]} args - CLI arguments.
 * @param {Record<string, string | undefined>} env - Child environment.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} - Child result.
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
  it('executes an app activity through the append-only ledger and deduplicates an exact retry', async () => {
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-run-'));
    const tableName = 'execution-ledger-test';
    const appId = 'hello-world-demo';
    const resourceId = `app:${appId}`;
    const operationId = 'op-1';
    const runId = createManualLedgerRunId({ appId, operationId });
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
    let inspectDb;

    try {
      const loadedApp = await loadApp({ dir: helloWorldDir });
      const expectedRevision = await compileApplicationRevision({
        appDir: loadedApp.appDir,
        manifest: loadedApp.manifest,
      });
      const args = [
        'ops',
        'run',
        '--activity',
        'echo-event',
        '--operation-id',
        operationId,
        '--dir',
        helloWorldDir,
        '--input',
        '{"who":"ops-run"}',
        '--caller-metadata',
        '{"requestId":"ops-request"}',
      ];
      const env = {
        ...process.env,
        NODE_ENV: 'development',
        WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
        WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
        WHARFIE_DB_ADAPTER: 'vanilla',
        WHARFIE_DB_PATH: dbPath,
        WHARFIE_CONTROL_ADAPTER: 'vanilla',
        WHARFIE_CONTROL_PATH: dbPath,
      };
      const first = runCli(args, env);

      expect(first.status).toBe(0);
      expect(first.stderr).toBe('');
      expect(first.stdout).toContain(
        `${resourceId}#${operationId}@${expectedRevision.revisionId}`,
      );
      expect(first.stdout).toContain(runId);
      expect(first.stdout).toContain("'COMPLETED'");
      expect(first.stdout).toContain(
        'Executed durable activity through attempt 1',
      );

      inspectDb = createVanillaDB({ path: dbPath });
      const ledger = createExecutionLedger({ db: inspectDb, tableName });
      const firstView = await ledger.rebuildRun(runId);
      expect(firstView).not.toBeNull();
      if (!firstView) throw new Error('Expected durable manual run');
      expect(firstView.run).toMatchObject({
        runId,
        appId,
        revisionId: expectedRevision.revisionId,
        status: RunStatus.COMPLETED,
        version: 4,
      });
      expect(firstView.invocations).toEqual([
        expect.objectContaining({
          invocationId: MANUAL_LEDGER_INVOCATION_ID,
          activityId: 'echo-event',
          status: InvocationStatus.COMPLETED,
          input: { who: 'ops-run' },
          callerMetadata: { requestId: 'ops-request' },
        }),
      ]);
      expect(firstView.attempts).toEqual([
        expect.objectContaining({
          status: AttemptStatus.COMPLETED,
          generation: 1,
          terminal: expect.objectContaining({
            type: 'completed',
            result: {
              ok: true,
              who: 'ops-run',
              message: 'hello ops-run',
              requestId: 'ops-request',
            },
          }),
        }),
      ]);
      expect(
        firstView.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-started',
        'attempt-terminal',
      ]);

      await inspectDb.close();
      inspectDb = undefined;
      const retry = runCli(args, env);
      expect(retry.status).toBe(0);
      expect(retry.stderr).toBe('');
      expect(retry.stdout).toContain('attempt 1');

      inspectDb = createVanillaDB({ path: dbPath });
      const retryView = await createExecutionLedger({
        db: inspectDb,
        tableName,
      }).rebuildRun(runId);
      expect(retryView?.events).toHaveLength(4);
      expect(retryView?.attempts).toHaveLength(1);
    } finally {
      await inspectDb?.close?.();
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 20000);

  it('rejects reusing an operation ID for a changed immutable revision', async () => {
    const appDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-revision-app-'),
    );
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-revision-db-'),
    );
    const tableName = 'revision-fence-ledger';
    const appId = 'revision-fence-cli';
    const operationId = 'stable-provider-operation';
    const runId = createManualLedgerRunId({ appId, operationId });
    const appApiUrl = pathToFileURL(path.join(repoRoot, 'src', 'app.js')).href;
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
    let inspectDb;

    /** @param {string} marker - Source behavior marker. */
    const writeActivity = (marker) => {
      writeFileSync(
        path.join(appDir, 'activity.js'),
        `export async function work(input, runtime) {
          return {
            marker: ${JSON.stringify(marker)},
            revisionId: runtime.invocation.revisionId,
            value: input.value,
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
        WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
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
        '--input',
        '{"value":1}',
      ];
      const first = runCli(args, env);

      expect(first.status).toBe(0);
      expect(first.stderr).toBe('');
      expect(first.stdout).toContain(firstRevision.revisionId);

      writeActivity('v2');
      const secondLoadedApp = await loadApp({ dir: appDir });
      const secondRevision = await compileApplicationRevision({
        appDir: secondLoadedApp.appDir,
        manifest: secondLoadedApp.manifest,
      });
      expect(secondRevision.revisionId).not.toBe(firstRevision.revisionId);

      const second = runCli(args, env);
      expect(second.status).toBe(1);
      expect(second.stderr).toContain(
        'Execution ledger run conflicts with existing work',
      );

      inspectDb = createVanillaDB({ path: dbPath });
      const view = await createExecutionLedger({
        db: inspectDb,
        tableName,
      }).rebuildRun(runId);
      expect(view?.run).toMatchObject({
        revisionId: firstRevision.revisionId,
        status: RunStatus.COMPLETED,
      });
      expect(view?.attempts).toEqual([
        expect.objectContaining({
          status: AttemptStatus.COMPLETED,
          terminal: expect.objectContaining({
            result: {
              marker: 'v1',
              revisionId: firstRevision.revisionId,
              value: 1,
            },
          }),
        }),
      ]);
      expect(view?.events).toHaveLength(4);
    } finally {
      await inspectDb?.close?.();
      rmSync(appDir, { recursive: true, force: true });
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 30000);
});
