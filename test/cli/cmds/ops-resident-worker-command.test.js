/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
} from '../../../src/core/lib/db/tables/execution-ledger.js';
import { createManualLedgerRunId } from '../../../src/core/runtime/manual-ledger-run.js';
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
const itOnUnix = process.platform === 'win32' ? it.skip : it;
/** @type {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} */
const authoredAppFixtures = [];

afterEach(() => {
  cleanupIsolatedAuthoredAppFixtures(authoredAppFixtures);
});

/** @returns {string} - Fresh copy of the tracked authored application. */
function createHelloWorldDirectory() {
  const fixture = createIsolatedAuthoredAppFixture(authoredHelloWorldDir, {
    prefix: 'wharfie-ops-resident-app-',
  });
  authoredAppFixtures.push(fixture);
  return fixture.appDir;
}

/**
 * @param {string[]} args - Source CLI arguments.
 * @param {Record<string, string | undefined>} env - Isolated child environment.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} - Completed CLI result.
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
 * @typedef LiveCli
 * @property {import('node:child_process').ChildProcess} child - Running source CLI process.
 * @property {Promise<{code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string}>} exited - Captured process completion.
 * @property {() => {stdout: string, stderr: string}} output - Current captured output.
 */

/**
 * @param {string[]} args - Source CLI arguments.
 * @param {Record<string, string | undefined>} env - Isolated child environment.
 * @returns {LiveCli} - Running process and its bounded-observation handles.
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
  return {
    child,
    exited,
    output: () => ({ stdout, stderr }),
  };
}

/**
 * @param {string} output - CLI stdout.
 * @param {string} label - Failure context.
 * @returns {Record<string, any>} - Parsed object row.
 */
function parseJsonRow(output, label) {
  const lines = output
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
      }
    } catch {
      // Continue so incidental process output cannot hide the expected row.
    }
  }
  throw new Error(`${label} did not write a JSON object: ${output}`);
}

/**
 * @param {Record<string, string | undefined>} env - Isolated child environment.
 * @param {string} runId - Exact durable run identity.
 * @returns {Record<string, any>} - Redacted verified operator view.
 */
function inspectRun(env, runId) {
  const result = runCli(['ops', 'inspect', '--run-id', runId, '--json'], env);
  if (result.status !== 0) {
    throw new Error(
      `ops inspect failed with ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return parseJsonRow(result.stdout, 'ops inspect');
}

/** @returns {Promise<void>} - Resolves on the next short polling turn. */
async function waitForPollingTurn() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * @param {{env: Record<string, string | undefined>, runId: string, worker: LiveCli, timeoutMs?: number}} options - Terminal-run wait controls.
 * @returns {Promise<Record<string, any>>} - Completed verified operator view.
 */
async function waitForCompletedRun(options) {
  const deadline = Date.now() + (options.timeoutMs || 30_000);
  /** @type {unknown} */
  let lastError;
  while (Date.now() < deadline) {
    if (
      options.worker.child.exitCode !== null ||
      options.worker.child.signalCode !== null
    ) {
      const output = options.worker.output();
      throw new Error(
        `Resident worker exited before completion: ${output.stderr || output.stdout}`,
      );
    }
    try {
      const view = inspectRun(options.env, options.runId);
      if (
        view.run?.status === RunStatus.COMPLETED &&
        view.invocations?.some(
          (/** @type {Record<string, any>} */ invocation) =>
            invocation.status === InvocationStatus.COMPLETED,
        ) &&
        view.attempts?.some(
          (/** @type {Record<string, any>} */ attempt) =>
            attempt.status === AttemptStatus.COMPLETED,
        )
      ) {
        return view;
      }
    } catch (error) {
      lastError = error;
    }
    await waitForPollingTurn();
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(
    `Timed out waiting for ${options.runId} to complete${detail}`,
  );
}

/**
 * @param {LiveCli} live - Running child.
 * @param {number} timeoutMs - Maximum graceful-exit wait.
 * @returns {Promise<{code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string}>} - Captured completion.
 */
async function waitForExit(live, timeoutMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      live.exited,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error('Timed out waiting for the CLI child to exit.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe('wharfie ops resident worker', () => {
  itOnUnix(
    'carries an offline source submission through durable completion and graceful SIGTERM',
    async () => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-ops-resident-e2e-'),
      );
      const helloWorldDir = createHelloWorldDirectory();
      const controlPath = path.join(root, 'control');
      const tableName = 'source-resident-worker-e2e';
      const idempotencyKey = 'offline-source-resident-e2e';
      const runId = createManualLedgerRunId({
        appId: 'hello-world-demo',
        idempotencyKey,
      });
      const env = {
        ...process.env,
        NODE_ENV: 'development',
        NO_COLOR: '1',
        WHARFIE_ARTIFACT_BUCKET: 'service-bucket',
        WHARFIE_DB_ADAPTER: 'lmdb',
        WHARFIE_DB_PATH: path.join(root, 'general'),
        WHARFIE_CONTROL_ADAPTER: 'lmdb',
        WHARFIE_CONTROL_PATH: controlPath,
        WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
        WHARFIE_EXECUTION_PAYLOAD_PATH: path.join(root, 'payloads'),
        WHARFIE_LEDGER_SERVICE_SESSION_PATH: path.join(root, 'sessions'),
        WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
        WHARFIE_APPLICATION_STATE_PATH: path.join(root, 'application-state'),
      };
      /** @type {LiveCli | undefined} */
      let worker;

      try {
        const submitted = runCli(
          [
            'ops',
            'submit',
            '--dir',
            helloWorldDir,
            '--activity',
            'echo-event',
            '--idempotency-key',
            idempotencyKey,
            '--input',
            '{"who":"resident-e2e"}',
            '--caller-metadata',
            '{"requestId":"resident-e2e-request"}',
            '--json',
          ],
          env,
        );
        expect(submitted.status).toBe(0);
        expect(submitted.stderr).toBe('');
        const accepted = parseJsonRow(submitted.stdout, 'ops submit');
        expect(accepted).toMatchObject({
          idempotency_key: idempotencyKey,
          run_id: runId,
          activity: 'echo-event',
          status: RunStatus.RUNNING,
          invocation_status: InvocationStatus.RUNNABLE,
          attempt_generation: 0,
          attempt_status: '',
          reused: false,
        });
        expect(accepted.revision).toMatch(/^wrv1_[A-Za-z0-9_-]{43}$/);

        const runnable = inspectRun(env, runId);
        expect(runnable).toMatchObject({
          integrity: { verified: true },
          run: {
            runId,
            appId: 'hello-world-demo',
            revisionId: accepted.revision,
            status: RunStatus.RUNNING,
          },
          invocations: [
            expect.objectContaining({
              invocationId: 'manual',
              activityId: 'echo-event',
              status: InvocationStatus.RUNNABLE,
              generation: 0,
            }),
          ],
          attempts: [],
        });

        worker = startCli(['ops', 'worker', '--dir', helloWorldDir], env);
        const completed = await waitForCompletedRun({
          env,
          runId,
          worker,
        });
        expect(completed).toMatchObject({
          integrity: { verified: true },
          run: {
            runId,
            revisionId: accepted.revision,
            status: RunStatus.COMPLETED,
          },
          invocations: [
            expect.objectContaining({
              invocationId: 'manual',
              activityId: 'echo-event',
              status: InvocationStatus.COMPLETED,
              generation: 1,
            }),
          ],
          attempts: [
            expect.objectContaining({
              invocationId: 'manual',
              status: AttemptStatus.COMPLETED,
              generation: 1,
            }),
          ],
        });

        expect(worker.child.kill('SIGTERM')).toBe(true);
        const stopped = await waitForExit(worker, 15_000);
        expect(stopped).toMatchObject({ code: 0, signal: null, stderr: '' });
        expect(stopped.stdout).toContain(
          'Starting resident activity worker for app hello-world-demo@',
        );
        expect(stopped.stdout).toContain(
          'Resident activity worker drained and stopped.',
        );
      } finally {
        if (
          worker &&
          worker.child.exitCode === null &&
          worker.child.signalCode === null
        ) {
          worker.child.kill('SIGKILL');
        }
        await worker?.exited.catch(() => undefined);
        rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
