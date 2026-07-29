/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import { createExecutionLedger } from '../../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../../src/core/lib/payload-store/local.js';
import { createExecutionLedgerRunOutputCommand } from '../../../src/core/runtime/operator/execution-ledger-run-output-command.js';
import { createDurableWorkflowStartCommand } from '../../../src/core/runtime/operator/durable-workflow-start-command.js';
import {
  runPersistedDurableManifestWorkflowActivity,
  startDurableManifestWorkflow,
} from '../../../src/core/runtime/durable-workflow-host.js';
import { fireWorkflowLedgerTimer } from '../../../src/core/runtime/workflow-ledger-continuation.js';
import {
  loadPreparedDurableCliModule,
  loadPreparedDurableExecution,
} from '../../../src/cli/app/load-durable-execution.js';
import {
  cleanupIsolatedAuthoredAppFixtures,
  createIsolatedAuthoredAppFixture,
} from '../../helpers/isolated-authored-app.js';

const repoRoot = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
);
const authoredAppDir = path.join(repoRoot, 'examples', 'steady-file');
const APP_ID = 'steady-file-demo';
const WORKFLOW_ID = 'verify-stable';
const TABLE_NAME = 'steady-file-golden-path';
const ACTOR = Object.freeze({
  kind: 'worker',
  id: 'steady-file-golden-path',
});
/** @type {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} */
const fixtures = [];

afterEach(() => {
  cleanupIsolatedAuthoredAppFixtures(fixtures);
});

function createFixture() {
  const fixture = createIsolatedAuthoredAppFixture(authoredAppDir, {
    prefix: 'wharfie-steady-file-golden-',
  });
  fixtures.push(fixture);
  return fixture;
}

/**
 * @param {ReturnType<typeof createIsolatedAuthoredAppFixture>} fixture
 */
function localCliEnvironment(fixture) {
  return {
    ...process.env,
    HOME: fixture.root,
    TMPDIR: fixture.root,
    XDG_CONFIG_HOME: path.join(fixture.root, 'xdg-config'),
    XDG_DATA_HOME: path.join(fixture.root, 'xdg-data'),
    NO_COLOR: '1',
    WHARFIE_DISABLE_UPDATE_CHECK: '1',
  };
}

/**
 * @param {ReturnType<typeof createIsolatedAuthoredAppFixture>} fixture
 * @param {string} filePath
 */
function runLocalCli(fixture, filePath) {
  return spawnSync(
    process.execPath,
    [path.join(fixture.appDir, 'local.js'), filePath],
    {
      cwd: fixture.appDir,
      encoding: 'utf8',
      env: localCliEnvironment(fixture),
      timeout: 5_000,
      killSignal: 'SIGKILL',
    },
  );
}

/**
 * Keep replacing one file with monotonically changing bytes until the local
 * CLI exits. This guarantees changes throughout its observation window without
 * exposing a test-only delay through the application.
 *
 * @param {ReturnType<typeof createIsolatedAuthoredAppFixture>} fixture
 * @param {string} filePath
 * @returns {Promise<{status: number | null, signal: string | null, error: Error | undefined, stdout: string, stderr: string}>}
 */
async function runLocalCliWhileChanging(fixture, filePath) {
  const child = spawn(
    process.execPath,
    [path.join(fixture.appDir, 'local.js'), filePath],
    {
      cwd: fixture.appDir,
      env: localCliEnvironment(fixture),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
      killSignal: 'SIGKILL',
    },
  );
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let stdout = '';
  let stderr = '';
  let sequence = 0;
  /** @type {Error | undefined} */
  let childError;
  /** @type {unknown} */
  let mutationError;

  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.once('error', (error) => {
    childError = error;
  });

  return await new Promise((resolve, reject) => {
    const mutationTimer = setInterval(() => {
      try {
        sequence += 1;
        writeFileSync(
          filePath,
          `mutation:${String(sequence).padStart(8, '0')}\n`,
        );
      } catch (error) {
        mutationError = error;
        child.kill('SIGKILL');
      }
    }, 10);

    child.once('close', (status, signal) => {
      clearInterval(mutationTimer);
      if (mutationError) {
        reject(mutationError);
        return;
      }
      resolve({ status, signal, error: childError, stdout, stderr });
    });
  });
}

/**
 * @param {ReturnType<typeof createIsolatedAuthoredAppFixture>} fixture
 * @param {() => number} now
 */
async function createLedger(fixture, now) {
  const controlPath = path.join(fixture.root, 'control');
  const db = createVanillaDB({ path: controlPath });
  try {
    const payloadPath = path.join(fixture.root, 'payloads');
    const ledger = createExecutionLedger({
      db,
      tableName: TABLE_NAME,
      payloadStore: createLocalExecutionPayloadStore({
        path: payloadPath,
        storeId: 'steady-file-golden-path',
      }),
      now,
    });
    return { db, ledger };
  } catch (error) {
    try {
      await db.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        'Golden-path ledger construction and cleanup both failed.',
      );
    }
    throw error;
  }
}

/** @param {Record<string, any>} view */
function currentActivity(view) {
  const cursor = view.workflowCursor;
  const invocation = view.invocations.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === cursor.invocationId,
  );
  if (!invocation) {
    throw new Error('Golden-path workflow has no current activity invocation.');
  }
  return { cursor, invocation };
}

/**
 * @param {{ledger: ReturnType<typeof createExecutionLedger>, execution: any, runId: string, fence: string}} options
 */
async function runCurrentActivity(options) {
  const view = await options.ledger.rebuildRun(options.runId);
  if (!view) {
    throw new Error(
      'Golden-path workflow disappeared before activity dispatch.',
    );
  }
  const { cursor, invocation } = currentActivity(view);
  return await runPersistedDurableManifestWorkflowActivity({
    ledger: options.ledger,
    execution: options.execution,
    runId: options.runId,
    workflowId: WORKFLOW_ID,
    planId: cursor.planId,
    invocationId: invocation.invocationId,
    activityId: invocation.activityId,
    generation: invocation.generation,
    cursor: {
      version: cursor.version,
      continuationId: cursor.continuationId,
      stepId: cursor.stepId,
      stepIndex: cursor.stepIndex,
    },
    actor: ACTOR,
    createFencingToken: () => options.fence,
  });
}

describe('steady-file golden path', () => {
  it('rejects an app-local Wharfie runtime before importing the sealed CLI adapter', async () => {
    const fixture = createFixture();
    const appLocalWharfie = path.join(
      fixture.appDir,
      'node_modules',
      '@wharfie',
      'wharfie',
    );
    rmSync(appLocalWharfie, { force: true });
    mkdirSync(appLocalWharfie, { recursive: true });
    writeFileSync(
      path.join(appLocalWharfie, 'package.json'),
      JSON.stringify({
        name: '@wharfie/wharfie',
        version: '0.0.0-conflicting',
        type: 'module',
        exports: {
          './app': './app.js',
          './package.json': './package.json',
        },
      }),
    );
    writeFileSync(
      path.join(appLocalWharfie, 'app.js'),
      'export function defineApp(definition) { return definition; }\n',
    );
    const loaded = await loadPreparedDurableExecution({
      dir: fixture.appDir,
      workflow: WORKFLOW_ID,
    });
    const cleanup = loaded.cleanup;
    if (typeof cleanup !== 'function') {
      throw new Error('Prepared source did not expose snapshot cleanup.');
    }

    try {
      await expect(
        loadPreparedDurableCliModule(loaded.execution),
      ).rejects.toThrow(
        'Source CLI entrypoint resolves a different @wharfie/wharfie runtime',
      );
    } finally {
      await cleanup();
    }
  });

  it('maps changed and failed local observations to their documented exits', async () => {
    const fixture = createFixture();
    const changingPath = path.join(fixture.root, 'changing-artifact.bin');
    writeFileSync(changingPath, 'mutation:00000000\n');

    const changed = await runLocalCliWhileChanging(fixture, changingPath);
    expect(changed.error).toBeUndefined();
    expect(changed.signal).toBeNull();
    expect(changed.status).toBe(2);
    expect(changed.stderr).toBe('');
    expect(JSON.parse(changed.stdout)).toMatchObject({
      path: changingPath,
      stable: false,
      baseline: {
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      current: {
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });

    const missingPath = path.join(fixture.root, 'missing-artifact.bin');
    const missing = runLocalCli(fixture, missingPath);
    expect(missing.error).toBeUndefined();
    expect(missing.signal).toBeNull();
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toMatch(/ENOENT|no such file/i);
    expect(missing.stderr).toContain(missingPath);

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const fifoPath = path.join(fixture.root, 'not-a-regular-file');
      const mkfifo = spawnSync('mkfifo', [fifoPath], {
        cwd: fixture.root,
        encoding: 'utf8',
        timeout: 5_000,
        killSignal: 'SIGKILL',
      });
      expect(mkfifo.error).toBeUndefined();
      expect(mkfifo.signal).toBeNull();
      expect(mkfifo.status).toBe(0);
      expect(mkfifo.stderr).toBe('');

      const fifo = runLocalCli(fixture, fifoPath);
      expect(fifo.error).toBeUndefined();
      expect(fifo.signal).toBeNull();
      expect(fifo.status).toBe(1);
      expect(fifo.stdout).toBe('');
      expect(fifo.stderr).toMatch(/regular file/i);
    }
  });

  it('maps ordinary CLI args, reopens at a durable timer, and discloses the retained changed result', async () => {
    const fixture = createFixture();
    const artifactPath = path.join(fixture.root, 'artifact.bin');
    writeFileSync(artifactPath, 'first artifact bytes\n');

    const local = runLocalCli(fixture, artifactPath);
    expect(local.error).toBeUndefined();
    expect(local.signal).toBeNull();
    expect(local.status).toBe(0);
    expect(local.stderr).toBe('');
    expect(JSON.parse(local.stdout)).toMatchObject({
      path: artifactPath,
      stable: true,
      baseline: {
        bytes: 21,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        readStable: true,
      },
      current: {
        bytes: 21,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        readStable: true,
      },
    });

    /** @type {Awaited<ReturnType<typeof loadPreparedDurableExecution>> | undefined} */
    let loaded;
    /** @type {Awaited<ReturnType<typeof createLedger>> | undefined} */
    let context;
    let executionFailed = false;
    /** @type {unknown} */
    let executionFailure;
    try {
      const prepared = await loadPreparedDurableExecution({
        dir: fixture.appDir,
        workflow: WORKFLOW_ID,
      });
      loaded = prepared;
      let observedAt = 1_700_000_000_000;
      const now = () => {
        observedAt += 1;
        return observedAt;
      };
      const initialContext = await createLedger(fixture, now);
      context = initialContext;

      /** @type {Record<string, any> | undefined} */
      let startReceipt;
      const startCommand = createDurableWorkflowStartCommand({
        includeDirOption: true,
        processRef: {
          cwd: () => fixture.appDir,
          exitCode: undefined,
        },
        loadExecution: async () => ({ execution: prepared.execution }),
        loadCliModule: loadPreparedDurableCliModule,
        startWorkflow: async (options) =>
          await startDurableManifestWorkflow({
            ledger: initialContext.ledger,
            ...options,
          }),
        output: {
          json: (value) => {
            startReceipt = value;
          },
          table: () => {
            throw new Error('Golden path expected JSON start output.');
          },
          success: () => {
            throw new Error('Golden path expected JSON start output.');
          },
          failure: (error) => {
            throw error;
          },
        },
      });
      await startCommand.parseAsync(
        [
          'node',
          'start',
          '--dir',
          fixture.appDir,
          '--idempotency-key',
          'artifact-build-42',
          '--json',
          '--',
          artifactPath,
        ],
        { from: 'node' },
      );

      expect(startReceipt).toMatchObject({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.workflow-start',
        appId: APP_ID,
        workflowId: WORKFLOW_ID,
        idempotencyKey: 'artifact-build-42',
        reused: false,
        runStatus: 'RUNNING',
        cursor: {
          disposition: 'ACTIVITY_RUNNABLE',
          stepId: 'baseline',
          stepIndex: 0,
        },
      });
      if (!startReceipt) {
        throw new Error('Golden path did not capture its start receipt.');
      }

      const first = await runCurrentActivity({
        ledger: initialContext.ledger,
        execution: prepared.execution,
        runId: startReceipt.runId,
        fence: 'steady-file-baseline-fence',
      });
      expect(first.outcome).toMatchObject({
        disposition: 'timer-waiting',
        workflowCursor: {
          disposition: 'TIMER_WAITING',
          stepId: 'stability-window',
          stepIndex: 1,
        },
        timer: {
          status: 'WAITING',
          stepId: 'stability-window',
        },
      });

      await initialContext.db.close();
      context = undefined;
      writeFileSync(artifactPath, 'second, deliberately changed artifact\n');
      const reopenedContext = await createLedger(fixture, now);
      context = reopenedContext;

      const waiting = await reopenedContext.ledger.rebuildRun(
        startReceipt.runId,
      );
      if (!waiting) {
        throw new Error('Golden-path workflow disappeared during reopen.');
      }
      expect(waiting).toMatchObject({
        run: { status: 'RUNNING' },
        workflowCursor: {
          disposition: 'TIMER_WAITING',
          stepId: 'stability-window',
        },
        timers: [
          {
            status: 'WAITING',
            stepId: 'stability-window',
            dueAt: expect.any(Number),
          },
        ],
      });
      const timer = waiting.timers[0];
      expect(timer.dueAt - timer.scheduledAt).toBe(60_000);
      observedAt = timer.dueAt;
      const fired = await fireWorkflowLedgerTimer({
        ledger: reopenedContext.ledger,
        runId: startReceipt.runId,
        timerId: timer.timerId,
        actor: ACTOR,
        observedAt: timer.dueAt,
      });
      expect(fired).toMatchObject({
        applied: true,
        outcome: 'fired',
        workflowCursor: {
          disposition: 'ACTIVITY_RUNNABLE',
          stepId: 'comparison',
          stepIndex: 2,
        },
      });

      const completed = await runCurrentActivity({
        ledger: reopenedContext.ledger,
        execution: prepared.execution,
        runId: startReceipt.runId,
        fence: 'steady-file-comparison-fence',
      });
      expect(completed.outcome).toMatchObject({
        disposition: 'completed',
        run: { status: 'COMPLETED' },
        workflowCursor: { disposition: 'COMPLETED' },
      });

      /** @type {Record<string, any> | undefined} */
      let outputReceipt;
      const outputCommand = createExecutionLedgerRunOutputCommand({
        allowAppId: true,
        readOutput: async (request) =>
          await reopenedContext.ledger.readRunOutput(request),
        output: {
          json: (value, rendered) => {
            if (typeof rendered !== 'string') {
              throw new Error('Golden path expected pre-rendered JSON output.');
            }
            expect(JSON.parse(rendered)).toEqual(value);
            outputReceipt = value;
          },
          table: () => {
            throw new Error('Golden path expected JSON run output.');
          },
          failure: (error) => {
            throw error;
          },
        },
      });
      await outputCommand.parseAsync(
        [
          'node',
          'output',
          '--app-id',
          APP_ID,
          '--run-id',
          startReceipt.runId,
          '--confirm-sensitive-output',
          '--json',
        ],
        { from: 'node' },
      );

      expect(outputReceipt).toMatchObject({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.run-output',
        authority: 'none',
        authoritative: false,
        disclosure: 'application-sensitive-unredacted',
        integrity: { verified: true },
        scope: {
          appId: APP_ID,
          revisionId: startReceipt.revisionId,
          runId: startReceipt.runId,
        },
        snapshot: {
          runKind: 'workflow',
          status: 'COMPLETED',
        },
        outputs: [
          {
            stepId: 'baseline',
            stepIndex: 0,
            value: {
              path: artifactPath,
              bytes: 21,
              sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
              readStable: true,
            },
          },
          {
            stepId: 'stability-window',
            stepIndex: 1,
            value: {
              scheduledAt: expect.any(Number),
              dueAt: timer.dueAt,
              firedAt: timer.dueAt,
            },
          },
          {
            stepId: 'comparison',
            stepIndex: 2,
            value: {
              path: artifactPath,
              stable: false,
              baseline: {
                bytes: 21,
                sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                readStable: true,
              },
              current: {
                bytes: 38,
                sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                readStable: true,
              },
            },
          },
        ],
        terminal: {
          type: 'completed',
          result: {
            path: artifactPath,
            stable: false,
          },
        },
      });
      expect(Object.isFrozen(outputReceipt)).toBe(true);
    } catch (error) {
      executionFailed = true;
      executionFailure = error;
    }

    /** @type {unknown[]} */
    const cleanupErrors = [];
    if (context) {
      try {
        await context.db.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (loaded?.cleanup) {
      try {
        await loaded.cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    const failures = executionFailed
      ? [executionFailure, ...cleanupErrors]
      : cleanupErrors;
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'Golden-path proof and resource cleanup both failed.',
      );
    }
  }, 60_000);
});
