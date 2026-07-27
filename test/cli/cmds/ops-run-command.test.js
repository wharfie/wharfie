/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileApplicationRevision } from '../../../src/cli/app/compile-application-revision.js';
import { loadApp } from '../../../src/cli/app/load-app.js';
import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import {
  APPLICATION_STATE_TABLE_NAME,
  resolveExecutionPayloadStoreId,
} from '../../../src/core/lib/config/db.js';
import {
  AttemptStatus,
  EffectStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../../src/core/lib/db/tables/execution-ledger.js';
import createLMDB from '../../../src/core/lib/db/adapters/lmdb.js';
import {
  createApplicationStateBusinessKey,
  createApplicationStateTable,
} from '../../../src/core/lib/db/tables/application-state.js';
import { createLedgerServiceOwnership } from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../../src/core/lib/payload-store/local.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../../../src/core/runtime/effects/application-state.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
} from '../../../src/core/runtime/manual-ledger-run.js';
import { acquireLocalLedgerServiceSession } from '../../../src/core/runtime/services/ledger-service.js';
import {
  cleanupIsolatedAuthoredAppFixtures,
  createIsolatedAuthoredAppFixture,
} from '../../helpers/isolated-authored-app.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const authoredHelloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'apps',
  'hello-world',
);
/** @type {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} */
const authoredAppFixtures = [];

afterEach(() => {
  cleanupIsolatedAuthoredAppFixtures(authoredAppFixtures);
});

/** @returns {string} - Fresh copy of the tracked authored application. */
function createHelloWorldDirectory() {
  const fixture = createIsolatedAuthoredAppFixture(authoredHelloWorldDir, {
    prefix: 'wharfie-ops-run-app-',
  });
  authoredAppFixtures.push(fixture);
  return fixture.appDir;
}

/**
 * @param {string} dbPath - Shared local control-store root.
 * @returns {ReturnType<typeof createLocalExecutionPayloadStore>} - Matching CLI payload store.
 */
function createPayloadStore(dbPath) {
  const payloadPath = path.join(dbPath, 'execution-payloads');
  return createLocalExecutionPayloadStore({
    path: payloadPath,
    storeId: resolveExecutionPayloadStoreId(payloadPath),
  });
}

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

/**
 * Start the public source CLI without blocking the test process.
 * @param {string[]} args - CLI arguments.
 * @param {Record<string, string | undefined>} env - Child environment.
 * @returns {{child: import('node:child_process').ChildProcess, exited: Promise<{code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string}>}} - Live process and captured completion.
 */
function startCli(args, env) {
  const child = spawn(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!child.stdout || !child.stderr) {
    child.kill('SIGKILL');
    throw new Error('The source CLI child did not expose stdout and stderr.');
  }
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const exited = once(child, 'close').then(([code, signal]) => ({
    code,
    signal,
    stdout,
    stderr,
  }));
  return { child, exited };
}

/** @returns {Promise<void>} - Resolves on the next short polling turn. */
async function waitForPollingTurn() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

/**
 * Wait until a distinct source CLI process has durably entered its physical
 * STARTED attempt. The reader is deliberately short-lived and read-only, the
 * same topology used by an external `wharfie ops cancel` invocation.
 * @param {{dbPath: string, tableName: string, runId: string, payloadStore: ReturnType<typeof createLocalExecutionPayloadStore>, timeoutMs?: number}} options - Exact run lookup.
 * @returns {Promise<Record<string, any>>} - Verified started run view.
 */
async function waitForStartedRun(options) {
  const deadline = Date.now() + (options.timeoutMs || 10_000);
  /** @type {unknown} */
  let lastError;
  while (Date.now() < deadline) {
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
    let db;
    try {
      db = createLMDB({ path: options.dbPath, readOnly: true });
      const view = await createExecutionLedger({
        db,
        tableName: options.tableName,
        payloadStore: options.payloadStore,
      }).rebuildRun(options.runId);
      if (
        view?.run.status === RunStatus.RUNNING &&
        view.invocations.some(
          (/** @type {Record<string, any>} */ invocation) =>
            invocation.status === InvocationStatus.RUNNING,
        ) &&
        view.attempts.some(
          (/** @type {Record<string, any>} */ attempt) =>
            attempt.status === AttemptStatus.STARTED,
        )
      ) {
        return view;
      }
    } catch (error) {
      lastError = error;
    } finally {
      await db?.close?.();
    }
    await waitForPollingTurn();
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(
    `Timed out waiting for durable STARTED attempt ${options.runId}${detail}`,
  );
}

describe('wharfie ops run', () => {
  it('exposes idempotency-key terminology without the legacy operation ID flag', () => {
    const env = { ...process.env, NODE_ENV: 'development' };
    const help = runCli(['ops', 'run', '--help'], env);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--idempotency-key <idempotencyKey>');
    expect(help.stdout).not.toContain('--operation-id');

    const legacy = runCli(
      ['ops', 'run', '--operation-id', 'legacy-operation-id'],
      env,
    );
    expect(legacy.status).toBe(1);
    expect(legacy.stderr).toMatch(/unknown option.*operation-id/i);
  });

  it('refuses to claim work while the application resident session is active', async () => {
    const helloWorldDir = createHelloWorldDirectory();
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-owner-'),
    );
    const tableName = 'execution-ledger-owner-test';
    const appId = 'hello-world-demo';
    const idempotencyKey = 'blocked-by-resident-service';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const sessionRoot = path.join(dbPath, 'ledger-service-sessions');
    const applicationStatePath = path.join(dbPath, 'application-state');
    const ownerDb = createLMDB({ path: dbPath });
    const ownership = createLedgerServiceOwnership({
      db: ownerDb,
      tableName,
    });
    const owner = await acquireLocalLedgerServiceSession({
      appId,
      ownership,
      ownerKind: 'resident',
      sessionRoot,
    });
    try {
      const result = runCli(
        [
          'ops',
          'run',
          '--activity',
          'echo-event',
          '--idempotency-key',
          idempotencyKey,
          '--dir',
          helloWorldDir,
        ],
        {
          ...process.env,
          NODE_ENV: 'development',
          WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
          WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
          WHARFIE_DB_ADAPTER: 'lmdb',
          WHARFIE_DB_PATH: dbPath,
          WHARFIE_CONTROL_ADAPTER: 'lmdb',
          WHARFIE_CONTROL_PATH: dbPath,
          WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(
            dbPath,
            'execution-payloads',
          ),
          WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionRoot,
          WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
          WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        'Local service session is already active',
      );
      expect(existsSync(applicationStatePath)).toBe(false);

      await expect(
        createExecutionLedger({
          db: ownerDb,
          tableName,
          payloadStore: createPayloadStore(dbPath),
        }).rebuildRun(runId),
      ).resolves.toBeNull();
    } finally {
      await owner.release();
      await ownerDb.close();
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 20000);

  it('refuses to alias application state onto the execution-control root', () => {
    const helloWorldDir = createHelloWorldDirectory();
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-store-alias-'),
    );
    try {
      const result = runCli(
        [
          'ops',
          'run',
          '--activity',
          'echo-event',
          '--idempotency-key',
          'aliased-local-stores',
          '--dir',
          helloWorldDir,
        ],
        {
          ...process.env,
          NODE_ENV: 'development',
          WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
          WHARFIE_CONTROL_ADAPTER: 'vanilla',
          WHARFIE_CONTROL_PATH: dbPath,
          WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(
            dbPath,
            'execution-payloads',
          ),
          WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
          WHARFIE_APPLICATION_STATE_PATH: path.join(dbPath, 'child', '..'),
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/must use distinct local roots/i);
      expect(existsSync(path.join(dbPath, 'lmdb'))).toBe(false);
    } finally {
      rmSync(dbPath, { recursive: true, force: true });
    }
  });

  it.each([
    ['explicit', 'development'],
    ['ambient test default', 'test'],
  ])(
    'rejects %s vanilla application state without materializing its root',
    (selection, nodeEnv) => {
      const helloWorldDir = createHelloWorldDirectory();
      const dbPath = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-ops-run-vanilla-app-state-'),
      );
      const applicationStatePath = path.join(dbPath, 'application-state');
      try {
        /** @type {Record<string, string | undefined>} */
        const env = {
          ...process.env,
          NODE_ENV: nodeEnv,
          WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
          WHARFIE_CONTROL_ADAPTER: 'vanilla',
          WHARFIE_CONTROL_PATH: dbPath,
          WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(
            dbPath,
            'execution-payloads',
          ),
          WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
        };
        if (selection === 'explicit') {
          env.WHARFIE_APPLICATION_STATE_ADAPTER = 'vanilla';
        } else {
          delete env.WHARFIE_APPLICATION_STATE_ADAPTER;
        }

        const result = runCli(
          [
            'ops',
            'run',
            '--activity',
            'echo-event',
            '--idempotency-key',
            `vanilla-app-state-${selection.replaceAll(' ', '-')}`,
            '--dir',
            helloWorldDir,
          ],
          env,
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(
          /requires the LMDB application-state adapter/i,
        );
        expect(existsSync(applicationStatePath)).toBe(false);
      } finally {
        rmSync(dbPath, { recursive: true, force: true });
      }
    },
  );

  it('executes an app activity through the append-only ledger and deduplicates an exact retry', async () => {
    const helloWorldDir = createHelloWorldDirectory();
    const dbPath = mkdtempSync(path.join(os.tmpdir(), 'wharfie-ops-run-'));
    const tableName = 'execution-ledger-test';
    const appId = 'hello-world-demo';
    const idempotencyKey = 'op-1';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
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
        '--idempotency-key',
        idempotencyKey,
        '--dir',
        helloWorldDir,
        '--input',
        '{"who":"ops-run"}',
        '--caller-metadata',
        '{"requestId":"ops-request","resources":{"note":"ordinary metadata"}}',
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
        WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
        WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
        WHARFIE_APPLICATION_STATE_PATH: path.join(dbPath, 'application-state'),
      };
      const first = runCli(args, env);

      expect(first.status).toBe(0);
      expect(first.stderr).toBe('');
      expect(first.stdout).toContain(
        `app ${appId}, run ${runId}@${expectedRevision.revisionId}`,
      );
      expect(first.stdout).toContain('idempotency_key');
      expect(first.stdout).not.toContain('operation_id');
      expect(first.stdout).toContain(runId);
      expect(first.stdout).toContain("'COMPLETED'");
      expect(first.stdout).toContain(
        'Executed durable activity through attempt 1',
      );

      inspectDb = createVanillaDB({ path: dbPath });
      const ledger = createExecutionLedger({
        db: inspectDb,
        tableName,
        payloadStore: createPayloadStore(dbPath),
      });
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
          requestRef: expect.objectContaining({
            payloadSchema: 'wharfie.execution.activity-request.v1',
          }),
        }),
      ]);
      expect(firstView.attempts).toEqual([
        expect.objectContaining({
          status: AttemptStatus.COMPLETED,
          generation: 1,
          terminal: expect.objectContaining({
            type: 'completed',
          }),
          evidenceRef: expect.objectContaining({
            payloadSchema: 'wharfie.execution.activity-evidence.v1',
          }),
        }),
      ]);
      expect(JSON.stringify(firstView)).not.toContain('ops-request');
      expect(JSON.stringify(firstView)).not.toContain('ordinary metadata');
      expect(JSON.stringify(firstView)).not.toContain('hello ops-run');
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
      const retry = runCli([...args, '--json'], env);
      expect(retry.status).toBe(0);
      expect(retry.stderr).toBe('');
      expect(JSON.parse(retry.stdout.trim())).toEqual({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.activity-run',
        appId,
        runId,
        revisionId: expectedRevision.revisionId,
        activityId: 'echo-event',
        idempotencyKey,
        disposition: 'completed',
        reused: true,
        runStatus: RunStatus.COMPLETED,
        invocationStatus: InvocationStatus.COMPLETED,
        attempt: {
          generation: 1,
          status: AttemptStatus.COMPLETED,
        },
      });
      expect(retry.stdout).not.toMatch(/ops-request|ordinary metadata/);

      inspectDb = createVanillaDB({ path: dbPath });
      const retryView = await createExecutionLedger({
        db: inspectDb,
        tableName,
        payloadStore: createPayloadStore(dbPath),
      }).rebuildRun(runId);
      expect(retryView?.events).toHaveLength(4);
      expect(retryView?.attempts).toHaveLength(1);
    } finally {
      await inspectDb?.close?.();
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 20000);

  it.each(['vanilla', 'lmdb'])(
    'persists and replays a managed application-state effect with %s control state',
    async (controlAdapter) => {
      const appDir = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-ops-run-effect-app-'),
      );
      const dbPath = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-ops-run-effect-db-'),
      );
      const applicationStatePath = path.join(dbPath, 'application-state');
      const tableName = `managed-effect-${controlAdapter}`;
      const appId = `managed-effect-${controlAdapter}-demo`;
      const idempotencyKey = 'persist-one-value';
      const runId = createManualLedgerRunId({ appId, idempotencyKey });
      const appApiUrl = pathToFileURL(
        path.join(repoRoot, 'src', 'app.js'),
      ).href;
      /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
      let controlDb;
      /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
      let applicationStateDb;

      try {
        writeFileSync(
          path.join(appDir, 'package.json'),
          `${JSON.stringify({ private: true, type: 'module' })}\n`,
        );
        writeFileSync(
          path.join(appDir, 'cli.js'),
          'export async function main() {}\n',
        );
        writeFileSync(
          path.join(appDir, 'activity.js'),
          `export async function persist(input, runtime) {
            const stored = await runtime.effects.request({
              effectId: 'persist-value',
              capability: 'application-state',
              operation: 'put-if-absent',
              input: { key: input.key, value: input.value },
              requestedReplayProperties: ['idempotent', 'transactional'],
            });
            return { stored };
          }\n`,
        );
        writeFileSync(
          path.join(appDir, 'wharfie.app.js'),
          `import { defineApp } from ${JSON.stringify(appApiUrl)};
           export default defineApp({
             schemaVersion: 3,
             app: { id: ${JSON.stringify(appId)} },
             cli: {
               entrypoint: {
                 kind: 'node',
                 path: './cli.js',
                 export: 'main',
               },
             },
             targets: [
               {
                 nodeVersion: '24.13.1',
                 platform: 'darwin',
                 architecture: 'arm64',
               },
               {
                 nodeVersion: '24.13.1',
                 platform: 'linux',
                 architecture: 'x64',
                 libc: 'glibc',
               },
             ],
             activities: {
               persist: {
                 entrypoint: {
                   kind: 'node',
                   path: './activity.js',
                   export: 'persist',
                 },
               },
             },
           });\n`,
        );

        const args = [
          'ops',
          'run',
          '--activity',
          'persist',
          '--idempotency-key',
          idempotencyKey,
          '--dir',
          appDir,
          '--input',
          '{"key":"operator-choice","value":{"answer":42}}',
        ];
        const env = {
          ...process.env,
          NODE_ENV: 'development',
          WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
          WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
          WHARFIE_CONTROL_ADAPTER: controlAdapter,
          WHARFIE_CONTROL_PATH: dbPath,
          WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(
            dbPath,
            'execution-payloads',
          ),
          WHARFIE_LEDGER_SERVICE_SESSION_PATH: path.join(
            dbPath,
            'ledger-service-sessions',
          ),
          WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
          WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
        };

        const first = runCli(args, env);
        expect(first.status).toBe(0);
        expect(first.stderr).toBe('');
        expect(first.stdout).toContain("'COMPLETED'");

        controlDb =
          controlAdapter === 'lmdb'
            ? createLMDB({ path: dbPath, readOnly: true })
            : createVanillaDB({ path: dbPath, readOnly: true });
        const ledger = createExecutionLedger({
          db: controlDb,
          tableName,
          payloadStore: createPayloadStore(dbPath),
          effectEvidenceVerifiers: [
            ...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
          ],
        });
        const firstView = await ledger.rebuildRun(runId);
        expect(firstView).not.toBeNull();
        if (!firstView) throw new Error('Expected managed-effect run');
        expect(firstView.run).toMatchObject({
          runId,
          appId,
          status: RunStatus.COMPLETED,
          version: 7,
        });
        expect(firstView.effects).toEqual([
          expect.objectContaining({
            effectId: 'persist-value',
            status: EffectStatus.COMPLETED,
            requestedReplayProperties: ['idempotent', 'transactional'],
            substantiatedReplayProperties: ['idempotent', 'transactional'],
            destination: expect.objectContaining({
              kind: 'application-state',
              configuration: expect.objectContaining({
                namespace: appId,
                tableName: APPLICATION_STATE_TABLE_NAME,
              }),
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
          'effect-requested',
          'effect-started',
          'effect-completed',
          'attempt-terminal',
        ]);
        const effect = firstView.effects[0];
        await controlDb.close();
        controlDb = undefined;

        applicationStateDb = createLMDB({
          path: applicationStatePath,
          readOnly: true,
        });
        const applicationState = createApplicationStateTable({
          db: applicationStateDb,
          tableName: APPLICATION_STATE_TABLE_NAME,
        });
        const businessKey = createApplicationStateBusinessKey(
          appId,
          'operator-choice',
        );
        const firstBusiness = await applicationState.readBusinessByPhysicalKey(
          businessKey.resourceId,
          businessKey.sortKey,
        );
        const firstReceipt = await applicationState.readReceipt(
          effect.destinationEffectId,
        );
        expect(firstBusiness).toMatchObject({
          namespace: appId,
          logical_key: 'operator-choice',
          value: { answer: 42 },
          created_by_destination_effect_id: effect.destinationEffectId,
        });
        expect(firstReceipt).toMatchObject({
          destination_effect_id: effect.destinationEffectId,
          business_record_digest: firstBusiness?.record_digest,
          outcome_code: 'inserted',
          inserted: true,
        });
        await applicationStateDb.close();
        applicationStateDb = undefined;
        rmSync(applicationStatePath, { recursive: true, force: true });
        expect(existsSync(applicationStatePath)).toBe(false);

        const retry = runCli(args, env);
        expect(retry.status).toBe(0);
        expect(retry.stderr).toBe('');
        expect(retry.stdout).toContain('attempt 1');
        expect(existsSync(applicationStatePath)).toBe(false);

        controlDb =
          controlAdapter === 'lmdb'
            ? createLMDB({ path: dbPath, readOnly: true })
            : createVanillaDB({ path: dbPath, readOnly: true });
        const retryView = await createExecutionLedger({
          db: controlDb,
          tableName,
          payloadStore: createPayloadStore(dbPath),
          effectEvidenceVerifiers: [
            ...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
          ],
        }).rebuildRun(runId);
        expect(retryView?.events).toHaveLength(7);
        expect(retryView?.effects).toHaveLength(1);
        await controlDb.close();
        controlDb = undefined;
      } finally {
        await controlDb?.close?.();
        await applicationStateDb?.close?.();
        rmSync(appDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 50,
        });
        rmSync(dbPath, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 50,
        });
      }
    },
    40000,
  );

  it('cancels a live source-owned attempt through the public owner command', async () => {
    const appDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-cancel-app-'),
    );
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-cancel-db-'),
    );
    const tableName = 'source-owner-cancellation';
    const appId = 'source-owner-cancellation-demo';
    const idempotencyKey = 'wait-for-owner-cancellation';
    const requestId = 'source-cli-cancel-request';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const appApiUrl = pathToFileURL(path.join(repoRoot, 'src', 'app.js')).href;
    const sessionPath = path.join(dbPath, 'ledger-service-sessions');
    const applicationStatePath = path.join(dbPath, 'application-state');
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
      WHARFIE_DB_ADAPTER: 'lmdb',
      WHARFIE_DB_PATH: dbPath,
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: dbPath,
      WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
      WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
      WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
      WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
    };
    /** @type {ReturnType<typeof startCli> | undefined} */
    let runner;

    try {
      writeFileSync(
        path.join(appDir, 'package.json'),
        `${JSON.stringify({ private: true, type: 'module' })}\n`,
      );
      writeFileSync(
        path.join(appDir, 'cli.js'),
        'export async function main() {}\n',
      );
      writeFileSync(
        path.join(appDir, 'activity.js'),
        `export async function waitForCancellation(_input, runtime) {
          await new Promise((resolve) => {
            if (runtime.signal.aborted) {
              resolve();
              return;
            }
            runtime.signal.addEventListener('abort', resolve, { once: true });
          });
          return { observedCancellation: true };
        }\n`,
      );
      writeFileSync(
        path.join(appDir, 'wharfie.app.js'),
        `import { defineApp } from ${JSON.stringify(appApiUrl)};
         export default defineApp({
           schemaVersion: 3,
           app: { id: ${JSON.stringify(appId)} },
           cli: {
             entrypoint: {
               kind: 'node',
               path: './cli.js',
               export: 'main',
             },
           },
           targets: [
             {
               nodeVersion: '24.13.1',
               platform: 'darwin',
               architecture: 'arm64',
             },
             {
               nodeVersion: '24.13.1',
               platform: 'linux',
               architecture: 'x64',
               libc: 'glibc',
             },
           ],
           activities: {
             wait: {
               entrypoint: {
                 kind: 'node',
                 path: './activity.js',
                 export: 'waitForCancellation',
               },
             },
           },
         });\n`,
      );

      runner = startCli(
        [
          'ops',
          'run',
          '--activity',
          'wait',
          '--idempotency-key',
          idempotencyKey,
          '--dir',
          appDir,
        ],
        env,
      );
      await expect(
        waitForStartedRun({
          dbPath,
          tableName,
          runId,
          payloadStore: createPayloadStore(dbPath),
        }),
      ).resolves.toMatchObject({
        run: { status: RunStatus.RUNNING },
        attempts: [expect.objectContaining({ status: AttemptStatus.STARTED })],
      });

      const cancelled = runCli(
        [
          'ops',
          'cancel',
          '--run-id',
          runId,
          '--request-id',
          requestId,
          '--json',
        ],
        env,
      );
      expect(cancelled.status).toBe(0);
      expect(cancelled.stderr).toBe('');
      const cancellationResponse = JSON.parse(
        cancelled.stdout.trim().split('\n')[0],
      );
      expect(cancellationResponse).toEqual({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.cancel',
        runId,
        requestId,
        outcome: 'cancellation-requested',
        delivery: 'started',
        runStatus: RunStatus.RUNNING,
        invocationStatus: InvocationStatus.RUNNING,
      });

      const completed = await runner.exited;
      expect(completed).toMatchObject({ code: 1, signal: null });
      expect(completed.stderr).toContain(`finished ${RunStatus.CANCELLED}`);

      const db = createLMDB({ path: dbPath, readOnly: true });
      try {
        const view = await createExecutionLedger({
          db,
          tableName,
          payloadStore: createPayloadStore(dbPath),
        }).rebuildRun(runId);
        expect(view).toMatchObject({
          run: {
            status: RunStatus.CANCELLED,
            cancellationRequest: { requestId },
          },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.CANCELLED }),
          ],
          attempts: [
            expect.objectContaining({
              status: AttemptStatus.CANCELLED,
              terminal: expect.objectContaining({ type: 'cancelled' }),
            }),
          ],
          events: expect.arrayContaining([
            expect.objectContaining({
              type: 'manual-cancellation-requested',
              transition_id: expect.stringMatching(/^wlc_[A-Za-z0-9_-]{43}$/),
            }),
          ]),
        });
      } finally {
        await db.close();
      }
    } finally {
      if (runner?.child.exitCode === null && !runner.child.killed) {
        runner.child.kill('SIGKILL');
        await runner.exited;
      }
      rmSync(appDir, { recursive: true, force: true });
      rmSync(dbPath, { recursive: true, force: true });
    }
  }, 30000);

  it('rejects reusing an idempotency key for a changed immutable revision', async () => {
    const appDir = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-revision-app-'),
    );
    const dbPath = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-ops-run-revision-db-'),
    );
    const tableName = 'revision-fence-ledger';
    const appId = 'revision-fence-cli';
    const idempotencyKey = 'stable-provider-operation';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
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
           schemaVersion: 3,
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
        WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(dbPath, 'execution-payloads'),
        WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
        WHARFIE_APPLICATION_STATE_PATH: path.join(dbPath, 'application-state'),
      };
      const args = [
        'ops',
        'run',
        '--activity',
        'work',
        '--idempotency-key',
        idempotencyKey,
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
        payloadStore: createPayloadStore(dbPath),
      }).rebuildRun(runId);
      expect(view?.run).toMatchObject({
        revisionId: firstRevision.revisionId,
        status: RunStatus.COMPLETED,
      });
      expect(view?.attempts).toEqual([
        expect.objectContaining({
          status: AttemptStatus.COMPLETED,
          terminal: expect.objectContaining({
            type: 'completed',
          }),
          evidenceRef: expect.objectContaining({
            payloadSchema: 'wharfie.execution.activity-evidence.v1',
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
