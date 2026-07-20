/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import createLMDB from '../../../src/core/lib/db/adapters/lmdb.js';
import { resolveExecutionPayloadStoreId } from '../../../src/core/lib/config/db.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../../src/core/lib/db/tables/execution-ledger.js';
import {
  createLedgerServiceId,
  createLedgerServiceOwnership,
} from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../../src/core/lib/payload-store/local.js';
import { ExecutionLedgerReadyWorkKind } from '../../../src/core/lib/ledger/ready-work.js';
import {
  WorkflowCursorDisposition,
  createWorkflowRunId,
} from '../../../src/core/lib/ledger/workflow-execution-contract.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const binPath = path.join(repoRoot, 'bin', 'wharfie');
const childPath = fileURLToPath(
  new URL('../../fixtures/workflow-crash-child.js', import.meta.url),
);
const appDir = fileURLToPath(
  new URL('../../fixtures/apps/workflow-crash/', import.meta.url),
);
const APP_ID = 'workflow-crash-source';
const WORKFLOW_ID = 'crash-chain';
const TIMER_SIGNAL_WORKFLOW_ID = 'timer-signal-chain';
const TIMER_STEP_ID = 'durable-delay';
const SIGNAL_STEP_ID = 'continue';
const CHILD_BOUNDARY_TIMEOUT_MS = 30_000;
const CHILD_EXIT_TIMEOUT_MS = 5_000;
const DURABLE_STATE_WAIT_TIMEOUT_MS = 60_000;
const itOnUnix = process.platform === 'win32' ? it.skip : it;

/** @typedef {{adapterName: 'lmdb', controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}} ControlConfiguration */
/** @typedef {{root: string, configuration: ControlConfiguration, env: Record<string, string | undefined>, runId: string, idempotencyKey: string, markerPath: string}} WorkflowFixture */
/** @typedef {{code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string}} ChildExit */
/** @typedef {{child: import('node:child_process').ChildProcess, exited: Promise<ChildExit>, output: () => {stdout: string, stderr: string}}} LiveWorker */

/** @param {string} label @returns {WorkflowFixture} */
function createFixture(label) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wharfie-workflow-kill-'));
  const controlPath = path.join(root, 'control');
  const payloadPath = path.join(root, 'execution-payloads');
  const tableName = `workflow-kill-${label}`;
  const idempotencyKey = `workflow-kill-${label}`;
  const configuration = /** @type {ControlConfiguration} */ ({
    adapterName: 'lmdb',
    controlPath,
    tableName,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath: path.join(root, 'ledger-service-sessions'),
  });
  return /** @type {WorkflowFixture} */ ({
    root,
    configuration,
    idempotencyKey,
    runId: createWorkflowRunId({ appId: APP_ID, idempotencyKey }),
    markerPath: path.join(root, 'activity-entry.log'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NO_COLOR: '1',
      WHARFIE_ARTIFACT_BUCKET: 'workflow-crash-source-bucket',
      WHARFIE_DB_ADAPTER: 'lmdb',
      WHARFIE_DB_PATH: path.join(root, 'general'),
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: controlPath,
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
      WHARFIE_LEDGER_SERVICE_SESSION_PATH: configuration.sessionPath,
      WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
      WHARFIE_APPLICATION_STATE_PATH: path.join(root, 'application-state'),
    },
  });
}

/**
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
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
 * @param {import('node:child_process').SpawnSyncReturns<string>} result
 * @param {string} label
 * @returns {Record<string, any>}
 */
function parseSuccessfulJson(result, label) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with status=${result.status} signal=${result.signal || 'none'} error=${result.error?.message || 'none'}: ${result.stderr || result.stdout}`,
    );
  }
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/**
 * Operator commands emit their JSON receipt before a human success line.
 * @param {import('node:child_process').SpawnSyncReturns<string>} result
 * @param {string} label
 * @returns {Record<string, any>}
 */
function parseSuccessfulOperatorJson(result, label) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout.trim().split('\n')[0]);
}

/**
 * @param {WorkflowFixture} fixture
 * @param {string} [workflowId]
 * @returns {Record<string, any>}
 */
function startWorkflow(fixture, workflowId = WORKFLOW_ID) {
  return parseSuccessfulJson(
    runCli(
      [
        'ops',
        'start',
        '--workflow',
        workflowId,
        '--idempotency-key',
        fixture.idempotencyKey,
        '--dir',
        appDir,
        '--input',
        JSON.stringify({ markerPath: fixture.markerPath }),
        '--json',
      ],
      fixture.env,
    ),
    'ops start',
  );
}

/**
 * @param {WorkflowFixture} fixture
 * @param {string} deliveryId
 * @param {unknown} payload
 * @returns {string[]}
 */
function signalArgs(fixture, deliveryId, payload) {
  return [
    'ops',
    'signal',
    '--run-id',
    fixture.runId,
    '--signal',
    SIGNAL_STEP_ID,
    '--delivery-id',
    deliveryId,
    '--payload',
    JSON.stringify(payload),
    '--json',
  ];
}

/**
 * Parse the redacted signal row. Rejections intentionally use a nonzero exit
 * after writing their durable decision, while accepted deliveries are normal
 * command success.
 * @param {import('node:child_process').SpawnSyncReturns<string>} result
 * @param {string} label
 * @param {number} expectedStatus
 * @returns {Record<string, any>}
 */
function parseSignalJson(result, label, expectedStatus) {
  if (result.status !== expectedStatus) {
    throw new Error(
      `${label} exited with ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  const firstLine = result.stdout.trim().split('\n')[0];
  if (!firstLine) {
    throw new Error(
      `${label} emitted no JSON row (status=${result.status} signal=${result.signal || 'none'} error=${result.error?.message || 'none'}): ${result.stderr || '<empty stderr>'}`,
    );
  }
  return JSON.parse(firstLine);
}

/** @param {WorkflowFixture} fixture @returns {string[]} */
function recoveryArgs(fixture) {
  return [
    'ops',
    'recover',
    '--run-id',
    fixture.runId,
    '--confirm-runner-stopped',
    '--json',
  ];
}

/**
 * @param {WorkflowFixture} fixture
 * @param {string} requestId
 * @returns {string[]}
 */
function cancellationArgs(fixture, requestId) {
  return [
    'ops',
    'cancel',
    '--run-id',
    fixture.runId,
    '--request-id',
    requestId,
    '--json',
  ];
}

/**
 * @param {WorkflowFixture} fixture
 * @param {string} reconciliationId
 * @param {string} evidenceFile
 * @returns {string[]}
 */
function reconciliationArgs(fixture, reconciliationId, evidenceFile) {
  return [
    'ops',
    'reconcile',
    '--run-id',
    fixture.runId,
    '--reconciliation-id',
    reconciliationId,
    '--evidence-file',
    evidenceFile,
    '--confirm-runner-stopped',
    '--json',
  ];
}

/** @param {WorkflowFixture} fixture @returns {string[]} */
function markerEntries(fixture) {
  if (!existsSync(fixture.markerPath)) return [];
  return readFileSync(fixture.markerPath, 'utf8').split('\n').filter(Boolean);
}

/** @param {WorkflowFixture} fixture @param {string} revisionId */
async function readState(fixture, revisionId) {
  const db = createLMDB({
    path: fixture.configuration.controlPath,
    readOnly: true,
  });
  const payloadStore = createLocalExecutionPayloadStore({
    path: fixture.configuration.payloadPath,
    storeId: fixture.configuration.payloadStoreId,
  });
  const ledger = createExecutionLedger({
    db,
    tableName: fixture.configuration.tableName,
    payloadStore,
  });
  try {
    const view = await ledger.rebuildRun(fixture.runId);
    if (!view) throw new Error(`Workflow ${fixture.runId} is unavailable.`);
    return {
      view,
      events: await ledger.getEvents(fixture.runId),
      ready: await ledger.listReadyWork({
        appId: APP_ID,
        revisionId,
        observedAt: Number.MAX_SAFE_INTEGER,
        limit: 100,
      }),
      ownership: await createLedgerServiceOwnership({
        db,
        tableName: fixture.configuration.tableName,
      }).getOwnership({ serviceId: createLedgerServiceId({ appId: APP_ID }) }),
      outputs: await Promise.all(
        (view.workflowCursor?.outputs || []).map(
          (/** @type {Record<string, any>} */ binding) =>
            payloadStore.readJson(binding.outputRef),
        ),
      ),
    };
  } finally {
    await db.close();
  }
}

/**
 * @param {Promise<ChildExit>} exitPromise
 * @param {string} label
 * @param {number} [timeoutMs]
 * @returns {Promise<ChildExit>}
 */
async function waitForExit(
  exitPromise,
  label,
  timeoutMs = CHILD_EXIT_TIMEOUT_MS,
) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      exitPromise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${label} to exit.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * @param {WorkflowFixture} fixture
 * @param {Record<string, any>} options
 * @param {string} expectedBoundary
 * @returns {Promise<ChildExit & {message: Record<string, any>}>}
 */
async function crashChild(fixture, options, expectedBoundary) {
  const child = spawn(
    process.execPath,
    [
      childPath,
      JSON.stringify({
        ...options,
        appDir,
        configuration: fixture.configuration,
      }),
    ],
    {
      cwd: repoRoot,
      env: fixture.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = once(child, 'close').then(([code, signal]) => ({
    code,
    signal,
    stdout,
    stderr,
  }));
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const boundary = new Promise((resolve, reject) => {
    let settled = false;
    const fail = (/** @type {unknown} */ error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      const candidate = /** @type {Record<string, any>} */ (message);
      if (candidate.kind === 'fatal') {
        fail(new Error(`Workflow crash child failed: ${candidate.error}`));
        return;
      }
      if (candidate.kind !== 'boundary') return;
      if (candidate.boundary !== expectedBoundary) {
        fail(
          new Error(
            `Workflow crash child reached ${candidate.boundary}; expected ${expectedBoundary}.`,
          ),
        );
        return;
      }
      if (settled) return;
      settled = true;
      resolve(candidate);
    });
    child.once('error', fail);
    child.once('exit', (code, signal) => {
      fail(
        new Error(
          `Workflow crash child exited before ${expectedBoundary}: code=${code} signal=${signal} stdout=${stdout} stderr=${stderr}`,
        ),
      );
    });
    timer = setTimeout(
      () =>
        fail(
          new Error(
            `Workflow crash child timed out at ${expectedBoundary}: stdout=${stdout} stderr=${stderr}`,
          ),
        ),
      CHILD_BOUNDARY_TIMEOUT_MS,
    );
  });
  try {
    const message = /** @type {Record<string, any>} */ (await boundary);
    expect(child.kill('SIGKILL')).toBe(true);
    const exit = await waitForExit(exited, expectedBoundary);
    return { ...exit, message };
  } catch (error) {
    child.kill('SIGKILL');
    await waitForExit(exited, expectedBoundary).catch(() => undefined);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** @param {WorkflowFixture} fixture @returns {LiveWorker} */
function startLiveWorker(fixture) {
  const child = spawn(
    process.execPath,
    [binPath, 'ops', 'worker', '--dir', appDir],
    {
      cwd: repoRoot,
      env: fixture.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  return {
    child,
    exited: once(child, 'close').then(([code, signal]) => ({
      code,
      signal,
      stdout,
      stderr,
    })),
    output: () => ({ stdout, stderr }),
  };
}

/**
 * @param {LiveWorker} worker
 * @param {string} label
 */
async function stopLiveWorker(worker, label) {
  expect(worker.child.kill('SIGTERM')).toBe(true);
  const stopped = await waitForExit(worker.exited, label, 15_000);
  expect(stopped).toMatchObject({ code: 0, signal: null, stderr: '' });
}

/**
 * @param {WorkflowFixture} fixture
 * @param {string} revisionId
 * @param {LiveWorker} worker
 */
async function waitForCompleted(fixture, revisionId, worker) {
  const deadline = Date.now() + DURABLE_STATE_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      const output = worker.output();
      throw new Error(
        `Workflow worker exited before completion: exitCode=${worker.child.exitCode} signalCode=${worker.child.signalCode || 'none'} ${output.stderr || output.stdout}`,
      );
    }
    const state = await readState(fixture, revisionId).catch(() => null);
    if (state?.view?.run.status === RunStatus.COMPLETED) {
      return { ...state, view: state.view };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for workflow ${fixture.runId}.`);
}

/**
 * @param {WorkflowFixture} fixture
 * @param {string} revisionId
 * @param {LiveWorker} worker
 * @param {(state: Record<string, any>) => boolean} predicate
 * @param {string} label
 */
async function waitForWorkflowState(
  fixture,
  revisionId,
  worker,
  predicate,
  label,
) {
  const deadline = Date.now() + DURABLE_STATE_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      const output = worker.output();
      throw new Error(
        `Workflow worker exited before ${label}: exitCode=${worker.child.exitCode} signalCode=${worker.child.signalCode || 'none'} ${output.stderr || output.stdout}`,
      );
    }
    const state = await readState(fixture, revisionId).catch(() => null);
    if (state?.view && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}: ${fixture.runId}.`);
}

/**
 * @param {WorkflowFixture} fixture
 * @param {string} revisionId
 */
async function finishWithWorker(fixture, revisionId) {
  const worker = startLiveWorker(fixture);
  try {
    const completed = await waitForCompleted(fixture, revisionId, worker);
    expect(worker.child.kill('SIGTERM')).toBe(true);
    const stopped = await waitForExit(worker.exited, 'resident worker', 15_000);
    expect(stopped).toMatchObject({ code: 0, signal: null, stderr: '' });
    return completed;
  } finally {
    if (worker.child.exitCode === null && worker.child.signalCode === null) {
      worker.child.kill('SIGKILL');
    }
    await worker.exited.catch(() => undefined);
  }
}

/**
 * @param {ChildExit & {message: Record<string, any>}} crashed
 * @param {string} boundary
 */
function expectKilledAt(crashed, boundary) {
  expect(crashed).toMatchObject({
    code: null,
    signal: 'SIGKILL',
    stdout: '',
    stderr: '',
    message: { kind: 'boundary', boundary },
  });
}

describe('source workflow real-process SIGKILL recovery', () => {
  itOnUnix(
    'persists active workflow cancellation before delivery and does not redeliver after response loss',
    async () => {
      const fixture = createFixture('active-cancel-response');
      const requestId = 'source-kill-active-workflow-cancellation';
      /** @type {LiveWorker | undefined} */
      let worker;
      try {
        const started = parseSuccessfulJson(
          runCli(
            [
              'ops',
              'start',
              '--workflow',
              WORKFLOW_ID,
              '--idempotency-key',
              fixture.idempotencyKey,
              '--dir',
              appDir,
              '--input',
              JSON.stringify({
                markerPath: fixture.markerPath,
                waitForCancellation: true,
              }),
              '--json',
            ],
            fixture.env,
          ),
          'ops start cancellation fixture',
        );
        worker = startLiveWorker(fixture);
        await waitForWorkflowState(
          fixture,
          started.revision,
          worker,
          (state) =>
            state.view.run.status === RunStatus.RUNNING &&
            state.view.workflowCursor.disposition ===
              WorkflowCursorDisposition.ACTIVITY_RUNNING &&
            state.view.attempts[0]?.status === AttemptStatus.STARTED &&
            markerEntries(fixture).includes('enter:0'),
          'started workflow cancellation fixture',
        );

        const crashed = await crashChild(
          fixture,
          {
            mode: 'cancel-response',
            runId: fixture.runId,
            requestId,
          },
          'cancellation-response-ready',
        );
        expectKilledAt(crashed, 'cancellation-response-ready');
        expect(crashed.message.detail.response).toMatchObject({
          schemaVersion: 1,
          kind: 'wharfie.execution-ledger.cancel',
          runId: fixture.runId,
          requestId,
          outcome: 'cancellation-requested',
          delivery: 'started',
          runStatus: RunStatus.RUNNING,
          invocationStatus: InvocationStatus.RUNNING,
        });

        const cancelled = await waitForWorkflowState(
          fixture,
          started.revision,
          worker,
          (state) =>
            state.view.run.status === RunStatus.CANCELLED &&
            state.view.workflowCursor.disposition ===
              WorkflowCursorDisposition.CANCELLED,
          'durable workflow cancellation terminal',
        );
        expect(cancelled).toMatchObject({
          view: {
            run: {
              status: RunStatus.CANCELLED,
              cancellationRequest: { requestId },
            },
            workflowCursor: {
              disposition: WorkflowCursorDisposition.CANCELLED,
              stepId: 'first',
              stepIndex: 0,
              outputs: [],
            },
            invocations: [
              expect.objectContaining({
                status: InvocationStatus.CANCELLED,
                cancellationRequest: expect.objectContaining({ requestId }),
              }),
            ],
            attempts: [
              expect.objectContaining({
                status: AttemptStatus.CANCELLED,
                cancellationRequest: expect.objectContaining({ requestId }),
                terminal: expect.objectContaining({ type: 'cancelled' }),
              }),
            ],
          },
          ready: { items: [] },
        });
        expect(cancelled.events.map((event) => event.type)).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-cancellation-requested',
          'workflow-activity-cancelled',
        ]);
        expect(markerEntries(fixture)).toEqual(['enter:0', 'cancel:0']);
        const eventCount = cancelled.events.length;

        const replay = parseSuccessfulOperatorJson(
          runCli(cancellationArgs(fixture, requestId), fixture.env),
          'ops active cancel replay',
        );
        expect(replay).toMatchObject({
          runId: fixture.runId,
          requestId,
          outcome: 'cancellation-requested',
          delivery: 'not-required',
          runStatus: RunStatus.CANCELLED,
          invocationStatus: InvocationStatus.CANCELLED,
        });
        const afterReplay = await readState(fixture, started.revision);
        expect(afterReplay.events).toHaveLength(eventCount);
        expect(afterReplay.view).toEqual(cancelled.view);
        expect(afterReplay.ready).toEqual(cancelled.ready);
        expect(markerEntries(fixture)).toEqual(['enter:0', 'cancel:0']);

        expect(worker.child.kill('SIGTERM')).toBe(true);
        const stopped = await waitForExit(
          worker.exited,
          'cancelled resident worker',
          15_000,
        );
        expect(stopped).toMatchObject({ code: 0, signal: null, stderr: '' });
      } finally {
        if (
          worker &&
          worker.child.exitCode === null &&
          worker.child.signalCode === null
        ) {
          worker.child.kill('SIGKILL');
        }
        await worker?.exited.catch(() => undefined);
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    90_000,
  );

  itOnUnix(
    'replays offline workflow cancellation after SIGKILL at the command response boundary',
    async () => {
      const fixture = createFixture('cancel-response');
      const requestId = 'source-kill-workflow-cancellation';
      try {
        const started = startWorkflow(fixture);
        const beforeCancellation = await readState(fixture, started.revision);
        expect(beforeCancellation).toMatchObject({
          view: {
            run: { status: RunStatus.RUNNING, version: 1, lastSequence: 1 },
            workflowCursor: {
              disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
              stepIndex: 0,
            },
            attempts: [],
          },
          ready: {
            items: [
              expect.objectContaining({
                kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
                stepIndex: 0,
              }),
            ],
          },
          ownership: null,
        });

        const crashed = await crashChild(
          fixture,
          {
            mode: 'cancel-response',
            runId: fixture.runId,
            requestId,
          },
          'cancellation-response-ready',
        );
        expectKilledAt(crashed, 'cancellation-response-ready');
        expect(crashed.message.detail.response).toEqual({
          schemaVersion: 1,
          kind: 'wharfie.execution-ledger.cancel',
          runId: fixture.runId,
          requestId,
          outcome: 'cancellation-requested',
          delivery: 'not-required',
          runStatus: RunStatus.CANCELLED,
          invocationStatus: InvocationStatus.CANCELLED,
        });

        const cancelled = await readState(fixture, started.revision);
        expect(cancelled).toMatchObject({
          view: {
            run: {
              status: RunStatus.CANCELLED,
              version: 2,
              lastSequence: 2,
              cancellationRequest: { requestId },
            },
            workflowCursor: {
              disposition: WorkflowCursorDisposition.CANCELLED,
              stepIndex: 0,
            },
            invocations: [
              expect.objectContaining({
                status: InvocationStatus.CANCELLED,
                cancellationRequest: expect.objectContaining({ requestId }),
              }),
            ],
            attempts: [],
          },
          events: [
            expect.objectContaining({ type: 'workflow-run-created' }),
            expect.objectContaining({
              type: 'workflow-cancellation-requested',
            }),
          ],
          ready: { items: [] },
          ownership: null,
        });
        expect(markerEntries(fixture)).toEqual([]);

        const replay = parseSuccessfulOperatorJson(
          runCli(cancellationArgs(fixture, requestId), fixture.env),
          'ops cancel replay',
        );
        expect(replay).toEqual(crashed.message.detail.response);
        await expect(readState(fixture, started.revision)).resolves.toEqual(
          cancelled,
        );
        expect(markerEntries(fixture)).toEqual([]);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  itOnUnix(
    'recovers retained terminal evidence, replays a lost reconciliation response, and advances exactly once',
    async () => {
      const fixture = createFixture('reconcile-response');
      try {
        const started = startWorkflow(fixture);
        const crashed = await crashChild(
          fixture,
          { mode: 'worker', boundary: 'terminal-evidence-ready' },
          'terminal-evidence-ready',
        );
        expectKilledAt(crashed, 'terminal-evidence-ready');
        expect(crashed.message.detail).toMatchObject({
          runId: fixture.runId,
          stepIndex: 0,
          evidence: { status: 'completed' },
        });
        expect(markerEntries(fixture)).toEqual(['enter:0']);

        const beforeRecovery = await readState(fixture, started.revision);
        expect(beforeRecovery.view).toMatchObject({
          run: {
            status: RunStatus.RUNNING,
            version: 3,
            lastSequence: 3,
          },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
            stepId: 'first',
            stepIndex: 0,
          },
          invocations: [
            expect.objectContaining({ status: InvocationStatus.RUNNING }),
          ],
          attempts: [
            expect.objectContaining({ status: AttemptStatus.STARTED }),
          ],
        });
        expect(beforeRecovery.ready.items).toEqual([
          expect.objectContaining({
            runId: fixture.runId,
            kind: ExecutionLedgerReadyWorkKind.RECOVERY,
            stepIndex: 0,
          }),
        ]);
        expect(beforeRecovery.ownership).toEqual(crashed.message.ownership);
        expect(beforeRecovery.events.map((event) => event.type)).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
        ]);

        const recovered = parseSuccessfulJson(
          runCli(recoveryArgs(fixture), fixture.env),
          'ops recover',
        );
        expect(recovered).toMatchObject({
          recovery: {
            action: 'marked-started-uncertain',
            changed: true,
          },
          run: { status: RunStatus.BLOCKED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
            stepIndex: 0,
          },
        });
        const afterRecovery = await readState(fixture, started.revision);
        if (!afterRecovery.view)
          throw new Error('Recovered workflow vanished.');
        expect(afterRecovery.ready.items).toEqual([]);
        expect(afterRecovery.view).toMatchObject({
          run: { status: RunStatus.BLOCKED, version: 4, lastSequence: 4 },
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
        });
        expect(afterRecovery.ownership).toBeNull();
        expect(afterRecovery.events.map((event) => event.type)).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-became-uncertain',
        ]);
        expect(afterRecovery.events.at(-1)?.actor).toEqual({
          kind: 'local',
          id: 'cli',
        });
        const retainedAbandonedAttempt = JSON.parse(
          JSON.stringify(afterRecovery.view.attempts[0]),
        );

        const evidenceFile = path.join(fixture.root, 'terminal-evidence.json');
        writeFileSync(
          evidenceFile,
          `${JSON.stringify(crashed.message.detail.evidence)}\n`,
          { mode: 0o600 },
        );
        const reconciliationId = 'source-kill-terminal-reconciliation';
        const responseCrash = await crashChild(
          fixture,
          {
            mode: 'reconcile-response',
            runId: fixture.runId,
            reconciliationId,
            evidenceFile,
          },
          'reconciliation-response-ready',
        );
        expectKilledAt(responseCrash, 'reconciliation-response-ready');
        expect(responseCrash.message.detail.response).toMatchObject({
          reconciliation: { reconciliationId, changed: true },
          run: { status: RunStatus.RUNNING },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            stepId: 'second',
            stepIndex: 1,
          },
        });

        const afterReconciliation = await readState(fixture, started.revision);
        if (!afterReconciliation.view) {
          throw new Error('Reconciled workflow vanished.');
        }
        expect(afterReconciliation.view).toMatchObject({
          run: { status: RunStatus.RUNNING, version: 5, lastSequence: 5 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            stepId: 'second',
            stepIndex: 1,
          },
          invocations: expect.arrayContaining([
            expect.objectContaining({ status: InvocationStatus.COMPLETED }),
            expect.objectContaining({
              status: InvocationStatus.RUNNABLE,
              workflow: expect.objectContaining({ stepIndex: 1 }),
            }),
          ]),
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
        });
        expect(afterReconciliation.ready.items).toEqual([
          expect.objectContaining({
            kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
            stepIndex: 1,
          }),
        ]);
        expect(afterReconciliation.view.attempts).toEqual([
          retainedAbandonedAttempt,
        ]);
        expect(afterReconciliation.ownership).toBeNull();
        expect(afterReconciliation.events.map((event) => event.type)).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-became-uncertain',
          'workflow-activity-uncertainty-reconciled',
        ]);
        expect(afterReconciliation.events.at(-1)).toMatchObject({
          transition_id: `reconcile:${reconciliationId}`,
          actor: { kind: 'local', id: 'cli' },
        });

        const replay = parseSuccessfulJson(
          runCli(
            reconciliationArgs(fixture, reconciliationId, evidenceFile),
            fixture.env,
          ),
          'ops reconcile replay',
        );
        expect(replay.reconciliation).toEqual({
          reconciliationId,
          changed: false,
        });
        await expect(readState(fixture, started.revision)).resolves.toEqual(
          afterReconciliation,
        );

        const completed = await finishWithWorker(fixture, started.revision);
        expect(completed.view).toMatchObject({
          run: { status: RunStatus.COMPLETED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.COMPLETED,
            stepId: 'second',
            stepIndex: 1,
          },
        });
        expect(markerEntries(fixture)).toEqual(['enter:0', 'enter:1']);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    90_000,
  );

  itOnUnix(
    'releases a killed CLAIMED attempt, replays a lost recovery response, and dispatches only the fresh generation',
    async () => {
      const fixture = createFixture('claim-recovery-response');
      try {
        const started = startWorkflow(fixture);
        const crashed = await crashChild(
          fixture,
          { mode: 'worker', boundary: 'claim-committed' },
          'claim-committed',
        );
        expectKilledAt(crashed, 'claim-committed');
        expect(markerEntries(fixture)).toEqual([]);
        const claimed = await readState(fixture, started.revision);
        expect(claimed.view).toMatchObject({
          run: { status: RunStatus.RUNNING, version: 2, lastSequence: 2 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
          },
          invocations: [
            expect.objectContaining({
              status: InvocationStatus.RUNNING,
              generation: 1,
            }),
          ],
          attempts: [
            expect.objectContaining({
              status: AttemptStatus.CLAIMED,
              generation: 1,
            }),
          ],
        });
        expect(claimed.ownership).toEqual(crashed.message.ownership);
        expect(claimed.events.map((event) => event.type)).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
        ]);

        const recoveryCrash = await crashChild(
          fixture,
          { mode: 'recover-response', runId: fixture.runId },
          'recovery-response-ready',
        );
        expectKilledAt(recoveryCrash, 'recovery-response-ready');
        expect(recoveryCrash.message.detail.response.recovery).toMatchObject({
          action: 'released-unstarted-claim',
          changed: true,
        });
        const released = await readState(fixture, started.revision);
        expect(released.view).toMatchObject({
          run: { version: 3, lastSequence: 3 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
          },
          invocations: [
            expect.objectContaining({
              status: InvocationStatus.RUNNABLE,
              generation: 1,
            }),
          ],
          attempts: [
            expect.objectContaining({ status: AttemptStatus.ABANDONED }),
          ],
        });
        expect(released.ready.items).toEqual([
          expect.objectContaining({
            kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
            generation: 1,
          }),
        ]);
        expect(released.ownership).toBeNull();
        expect(released.events.map((event) => event.type)).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-abandoned-before-start',
        ]);
        expect(released.events.at(-1)?.actor).toEqual({
          kind: 'local',
          id: 'cli',
        });

        const replay = parseSuccessfulJson(
          runCli(recoveryArgs(fixture), fixture.env),
          'ops recover replay',
        );
        expect(replay.recovery).toEqual({ action: 'none', changed: false });
        await expect(readState(fixture, started.revision)).resolves.toEqual(
          released,
        );

        const completed = await finishWithWorker(fixture, started.revision);
        expect(completed.view.run.status).toBe(RunStatus.COMPLETED);
        expect(completed.view.attempts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              generation: 1,
              status: AttemptStatus.ABANDONED,
            }),
            expect.objectContaining({
              generation: 2,
              status: AttemptStatus.COMPLETED,
            }),
          ]),
        );
        expect(markerEntries(fixture)).toEqual(['enter:0', 'enter:1']);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    90_000,
  );

  itOnUnix(
    'blocks a killed STARTED-before-dispatch attempt without executing authored code',
    async () => {
      const fixture = createFixture('started-before-dispatch');
      try {
        const started = startWorkflow(fixture);
        const crashed = await crashChild(
          fixture,
          { mode: 'worker', boundary: 'start-committed' },
          'start-committed',
        );
        expectKilledAt(crashed, 'start-committed');
        expect(markerEntries(fixture)).toEqual([]);
        const durableStarted = await readState(fixture, started.revision);
        expect(durableStarted.view).toMatchObject({
          run: {
            status: RunStatus.RUNNING,
            version: 3,
            lastSequence: 3,
          },
          attempts: [
            expect.objectContaining({ status: AttemptStatus.STARTED }),
          ],
        });
        expect(durableStarted.ready.items).toEqual([
          expect.objectContaining({
            kind: ExecutionLedgerReadyWorkKind.RECOVERY,
          }),
        ]);
        expect(durableStarted.ownership).toEqual(crashed.message.ownership);
        expect(durableStarted.events.map((event) => event.type)).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
        ]);

        const recovered = parseSuccessfulJson(
          runCli(recoveryArgs(fixture), fixture.env),
          'ops recover started workflow',
        );
        expect(recovered).toMatchObject({
          recovery: {
            action: 'marked-started-uncertain',
            changed: true,
          },
          run: { status: RunStatus.BLOCKED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
          },
        });
        const blocked = await readState(fixture, started.revision);
        expect(blocked.ready.items).toEqual([]);
        expect(blocked.ownership).toBeNull();
        expect(blocked.events.map((event) => event.type)).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-became-uncertain',
        ]);
        expect(markerEntries(fixture)).toEqual([]);

        const replay = parseSuccessfulJson(
          runCli(recoveryArgs(fixture), fixture.env),
          'ops recover blocked replay',
        );
        expect(replay.recovery).toEqual({ action: 'none', changed: false });
        await expect(readState(fixture, started.revision)).resolves.toEqual(
          blocked,
        );
        expect(markerEntries(fixture)).toEqual([]);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    60_000,
  );

  itOnUnix(
    'retains one atomic successor after SIGKILL immediately following the first terminal commit',
    async () => {
      const fixture = createFixture('terminal-commit');
      try {
        const started = startWorkflow(fixture);
        const crashed = await crashChild(
          fixture,
          { mode: 'worker', boundary: 'terminal-committed' },
          'terminal-committed',
        );
        expectKilledAt(crashed, 'terminal-committed');
        expect(markerEntries(fixture)).toEqual(['enter:0']);
        const afterTerminal = await readState(fixture, started.revision);
        expect(afterTerminal.view).toMatchObject({
          run: {
            status: RunStatus.RUNNING,
            version: 4,
            lastSequence: 4,
          },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            stepId: 'second',
            stepIndex: 1,
          },
          invocations: expect.arrayContaining([
            expect.objectContaining({ status: InvocationStatus.COMPLETED }),
            expect.objectContaining({
              status: InvocationStatus.RUNNABLE,
              workflow: expect.objectContaining({ stepIndex: 1 }),
            }),
          ]),
          attempts: [
            expect.objectContaining({ status: AttemptStatus.COMPLETED }),
          ],
        });
        expect(afterTerminal.ready.items).toEqual([
          expect.objectContaining({
            kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
            stepIndex: 1,
          }),
        ]);
        expect(afterTerminal.ownership).toEqual(crashed.message.ownership);
        expect(afterTerminal.events.map((event) => event.type)).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-succeeded',
        ]);

        const completed = await finishWithWorker(fixture, started.revision);
        expect(completed.view.run.status).toBe(RunStatus.COMPLETED);
        expect(markerEntries(fixture)).toEqual(['enter:0', 'enter:1']);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    90_000,
  );

  itOnUnix(
    'retains one timer deadline across SIGKILL and completes from an offline signal exactly once',
    async () => {
      const fixture = createFixture('timer-restart-offline-signal');
      const deliveryId = 'source-offline-signal-delivery';
      const signalPayload = {
        markerPath: fixture.markerPath,
        stepIndex: 1,
        route: 'offline',
      };
      /** @type {LiveWorker | undefined} */
      let worker;
      try {
        const started = startWorkflow(fixture, TIMER_SIGNAL_WORKFLOW_ID);
        const crashed = await crashChild(
          fixture,
          { mode: 'worker', boundary: 'terminal-committed' },
          'terminal-committed',
        );
        expectKilledAt(crashed, 'terminal-committed');
        expect(crashed.message.detail).toMatchObject({
          cursorDisposition: WorkflowCursorDisposition.TIMER_WAITING,
          stepId: TIMER_STEP_ID,
          stepIndex: 1,
        });
        expect(markerEntries(fixture)).toEqual(['enter:0']);

        const scheduled = await readState(fixture, started.revision);
        expect(scheduled).toMatchObject({
          view: {
            run: { status: RunStatus.RUNNING },
            workflowCursor: {
              disposition: WorkflowCursorDisposition.TIMER_WAITING,
              stepId: TIMER_STEP_ID,
              stepIndex: 1,
              outputs: [expect.objectContaining({ stepId: 'first' })],
            },
            timers: [
              expect.objectContaining({
                status: 'WAITING',
                stepId: TIMER_STEP_ID,
                stepIndex: 1,
              }),
            ],
          },
          ready: {
            items: [
              expect.objectContaining({
                kind: ExecutionLedgerReadyWorkKind.TIMER,
                stepId: TIMER_STEP_ID,
                stepIndex: 1,
              }),
            ],
          },
        });
        const timer = scheduled.view.timers[0];
        expect(timer.dueAt).toBeGreaterThan(timer.scheduledAt);
        expect(scheduled.view.workflowCursor.timerId).toBe(timer.timerId);
        expect(scheduled.ready.items[0]).toMatchObject({
          timerId: timer.timerId,
          availableAt: timer.dueAt,
        });

        // readState closes and reopens the real LMDB environment every time.
        // Neither process death nor reopening may recompute now + delay.
        const reopened = await readState(fixture, started.revision);
        expect(reopened.view.timers).toEqual(scheduled.view.timers);
        expect(reopened.view.workflowCursor).toEqual(
          scheduled.view.workflowCursor,
        );
        expect(reopened.ready).toEqual(scheduled.ready);
        expect(reopened.outputs).toEqual(scheduled.outputs);

        worker = startLiveWorker(fixture);
        const waiting = await waitForWorkflowState(
          fixture,
          started.revision,
          worker,
          (state) =>
            state.view.workflowCursor.disposition ===
              WorkflowCursorDisposition.SIGNAL_WAITING &&
            state.view.workflowCursor.stepId === SIGNAL_STEP_ID,
          'persisted signal wait after timer restart',
        );
        expect(waiting).toMatchObject({
          view: {
            workflowCursor: {
              disposition: WorkflowCursorDisposition.SIGNAL_WAITING,
              stepId: SIGNAL_STEP_ID,
              stepIndex: 2,
            },
            timers: [
              expect.objectContaining({
                timerId: timer.timerId,
                status: 'FIRED',
                scheduledAt: timer.scheduledAt,
                dueAt: timer.dueAt,
              }),
            ],
            signalWaits: [
              expect.objectContaining({
                status: 'WAITING',
                signalId: SIGNAL_STEP_ID,
                stepIndex: 2,
              }),
            ],
          },
          ready: { items: [] },
        });
        expect(waiting.outputs[1]).toMatchObject({
          value: {
            scheduledAt: timer.scheduledAt,
            dueAt: timer.dueAt,
            firedAt: expect.any(Number),
          },
        });
        expect(waiting.outputs[1].value.firedAt).toBeGreaterThanOrEqual(
          timer.dueAt,
        );

        await stopLiveWorker(worker, 'timer-to-signal resident worker');
        worker = undefined;
        const beforeOfflineSignal = await readState(fixture, started.revision);
        expect(beforeOfflineSignal.ownership).toBeNull();

        const acceptedResult = runCli(
          signalArgs(fixture, deliveryId, signalPayload),
          fixture.env,
        );
        const accepted = parseSignalJson(
          acceptedResult,
          'ops offline signal',
          0,
        );
        expect(accepted).toMatchObject({
          runId: fixture.runId,
          deliveryId,
          signalId: SIGNAL_STEP_ID,
          outcome: 'accepted',
          reused: false,
        });
        expect(acceptedResult.stderr).toBe('');

        const afterAccepted = await readState(fixture, started.revision);
        expect(afterAccepted).toMatchObject({
          view: {
            workflowCursor: {
              disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
              stepId: 'last',
              stepIndex: 3,
            },
            signalWaits: [
              expect.objectContaining({
                status: 'CONSUMED',
                signalId: SIGNAL_STEP_ID,
              }),
            ],
            signalDeliveries: [
              expect.objectContaining({
                deliveryId,
                status: 'ACCEPTED',
              }),
            ],
          },
          ready: {
            items: [
              expect.objectContaining({
                kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
                stepId: 'last',
                stepIndex: 3,
              }),
            ],
          },
          ownership: null,
        });
        expect(afterAccepted.outputs[2]).toMatchObject({
          value: signalPayload,
        });
        expect(markerEntries(fixture)).toEqual(['enter:0']);

        const replayResult = runCli(
          signalArgs(fixture, deliveryId, signalPayload),
          fixture.env,
        );
        expect(
          parseSignalJson(replayResult, 'ops offline signal replay', 0),
        ).toMatchObject({
          runId: fixture.runId,
          deliveryId,
          outcome: 'accepted',
          reused: true,
        });
        await expect(readState(fixture, started.revision)).resolves.toEqual(
          afterAccepted,
        );

        const completed = await finishWithWorker(fixture, started.revision);
        expect(completed.view).toMatchObject({
          run: { status: RunStatus.COMPLETED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.COMPLETED,
            stepId: 'last',
            stepIndex: 3,
            outputs: expect.arrayContaining([
              expect.objectContaining({ stepId: TIMER_STEP_ID }),
              expect.objectContaining({ stepId: SIGNAL_STEP_ID }),
            ]),
          },
          timers: [
            expect.objectContaining({
              timerId: timer.timerId,
              status: 'FIRED',
              dueAt: timer.dueAt,
            }),
          ],
          signalDeliveries: [
            expect.objectContaining({
              deliveryId,
              status: 'ACCEPTED',
            }),
          ],
        });
        expect(completed.outputs).toHaveLength(4);
        expect(completed.outputs[2]).toMatchObject({ value: signalPayload });
        expect(completed.outputs[3]).toMatchObject({
          value: { markerPath: fixture.markerPath, stepIndex: 2 },
        });
        expect(
          completed.events.filter(
            (event) => event.type === 'workflow-timer-fired',
          ),
        ).toHaveLength(1);
        expect(
          completed.events.filter(
            (event) => event.type === 'workflow-signal-accepted',
          ),
        ).toHaveLength(1);
        expect(markerEntries(fixture)).toEqual(['enter:0', 'enter:1']);
      } finally {
        if (
          worker &&
          worker.child.exitCode === null &&
          worker.child.signalCode === null
        ) {
          worker.child.kill('SIGKILL');
        }
        await worker?.exited.catch(() => undefined);
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  itOnUnix(
    'retains an early signal rejection and replays a resident acceptance after response loss',
    async () => {
      const fixture = createFixture('signal-rejection-response-loss');
      const rejectedDeliveryId = 'source-early-signal-delivery';
      const acceptedDeliveryId = 'source-resident-signal-delivery';
      const signalPayload = {
        markerPath: fixture.markerPath,
        stepIndex: 1,
        route: 'resident',
      };
      /** @type {LiveWorker | undefined} */
      let worker;
      try {
        const started = startWorkflow(fixture, TIMER_SIGNAL_WORKFLOW_ID);
        const rejectedResult = runCli(
          signalArgs(fixture, rejectedDeliveryId, signalPayload),
          fixture.env,
        );
        expect(
          parseSignalJson(rejectedResult, 'ops early signal', 1),
        ).toMatchObject({
          runId: fixture.runId,
          deliveryId: rejectedDeliveryId,
          signalId: SIGNAL_STEP_ID,
          outcome: 'rejected',
          rejectionReason: 'early-signal',
          reused: false,
        });
        expect(
          `${rejectedResult.stdout}\n${rejectedResult.stderr}`,
        ).not.toContain(fixture.markerPath);

        const afterEarlyRejection = await readState(fixture, started.revision);
        expect(afterEarlyRejection).toMatchObject({
          view: {
            run: { status: RunStatus.RUNNING },
            workflowCursor: {
              disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
              stepId: 'first',
              stepIndex: 0,
              outputs: [],
            },
            signalDeliveries: [
              expect.objectContaining({
                deliveryId: rejectedDeliveryId,
                status: 'REJECTED',
                rejectionReason: 'early-signal',
              }),
            ],
          },
          ready: {
            items: [
              expect.objectContaining({
                kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
                stepIndex: 0,
              }),
            ],
          },
          ownership: null,
        });
        expect(
          afterEarlyRejection.events.filter(
            (event) => event.type === 'workflow-signal-rejected',
          ),
        ).toHaveLength(1);
        expect(markerEntries(fixture)).toEqual([]);

        worker = startLiveWorker(fixture);
        const waiting = await waitForWorkflowState(
          fixture,
          started.revision,
          worker,
          (state) =>
            state.view.workflowCursor.disposition ===
              WorkflowCursorDisposition.SIGNAL_WAITING &&
            state.view.workflowCursor.stepId === SIGNAL_STEP_ID,
          'signal wait after retained early rejection',
        );
        expect(waiting.view.signalDeliveries).toEqual([
          expect.objectContaining({
            deliveryId: rejectedDeliveryId,
            status: 'REJECTED',
          }),
        ]);

        const rejectedReplay = await crashChild(
          fixture,
          {
            mode: 'signal-response',
            runId: fixture.runId,
            signalId: SIGNAL_STEP_ID,
            deliveryId: rejectedDeliveryId,
            payload: signalPayload,
          },
          'signal-response-ready',
        );
        expectKilledAt(rejectedReplay, 'signal-response-ready');
        expect(rejectedReplay.message.detail.response).toMatchObject({
          runId: fixture.runId,
          deliveryId: rejectedDeliveryId,
          outcome: 'rejected',
          rejectionReason: 'early-signal',
          reused: true,
        });
        expect(
          JSON.stringify(rejectedReplay.message.detail.response),
        ).not.toContain(fixture.markerPath);
        const afterRejectedReplay = await readState(fixture, started.revision);
        expect(afterRejectedReplay.events).toEqual(waiting.events);
        expect(afterRejectedReplay.view).toEqual(waiting.view);
        expect(afterRejectedReplay.ready).toEqual(waiting.ready);
        expect(afterRejectedReplay.outputs).toEqual(waiting.outputs);

        const acceptedResponse = await crashChild(
          fixture,
          {
            mode: 'signal-response',
            runId: fixture.runId,
            signalId: SIGNAL_STEP_ID,
            deliveryId: acceptedDeliveryId,
            payload: signalPayload,
          },
          'signal-response-ready',
        );
        expectKilledAt(acceptedResponse, 'signal-response-ready');
        expect(acceptedResponse.message.detail.response).toMatchObject({
          runId: fixture.runId,
          deliveryId: acceptedDeliveryId,
          signalId: SIGNAL_STEP_ID,
          outcome: 'accepted',
          reused: false,
        });
        expect(
          JSON.stringify(acceptedResponse.message.detail.response),
        ).not.toContain(fixture.markerPath);

        const completed = await waitForCompleted(
          fixture,
          started.revision,
          worker,
        );
        expect(completed.view).toMatchObject({
          run: { status: RunStatus.COMPLETED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.COMPLETED,
            stepId: 'last',
            stepIndex: 3,
          },
          signalWaits: [
            expect.objectContaining({
              status: 'CONSUMED',
              signalId: SIGNAL_STEP_ID,
            }),
          ],
          signalDeliveries: expect.arrayContaining([
            expect.objectContaining({
              deliveryId: rejectedDeliveryId,
              status: 'REJECTED',
              rejectionReason: 'early-signal',
            }),
            expect.objectContaining({
              deliveryId: acceptedDeliveryId,
              status: 'ACCEPTED',
            }),
          ]),
        });
        expect(completed.view.signalDeliveries).toHaveLength(2);
        expect(completed.outputs[2]).toMatchObject({ value: signalPayload });
        expect(markerEntries(fixture)).toEqual(['enter:0', 'enter:1']);
        expect(
          completed.events.filter(
            (event) => event.type === 'workflow-signal-rejected',
          ),
        ).toHaveLength(1);
        expect(
          completed.events.filter(
            (event) => event.type === 'workflow-signal-accepted',
          ),
        ).toHaveLength(1);
        expect(
          completed.events.filter(
            (event) => event.type === 'workflow-timer-fired',
          ),
        ).toHaveLength(1);

        const acceptedReplayResult = runCli(
          signalArgs(fixture, acceptedDeliveryId, signalPayload),
          fixture.env,
        );
        expect(
          parseSignalJson(
            acceptedReplayResult,
            'ops resident accepted signal replay',
            0,
          ),
        ).toMatchObject({
          runId: fixture.runId,
          deliveryId: acceptedDeliveryId,
          outcome: 'accepted',
          reused: true,
        });
        expect(
          `${acceptedReplayResult.stdout}\n${acceptedReplayResult.stderr}`,
        ).not.toContain(fixture.markerPath);
        await expect(readState(fixture, started.revision)).resolves.toEqual(
          completed,
        );

        await stopLiveWorker(worker, 'signal response-loss resident worker');
        worker = undefined;
      } finally {
        if (
          worker &&
          worker.child.exitCode === null &&
          worker.child.signalCode === null
        ) {
          worker.child.kill('SIGKILL');
        }
        await worker?.exited.catch(() => undefined);
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  itOnUnix(
    'replays an offline workflow start after SIGKILL at the command response boundary',
    async () => {
      const fixture = createFixture('start-response');
      try {
        const crashed = await crashChild(
          fixture,
          {
            mode: 'start-response',
            workflowId: WORKFLOW_ID,
            idempotencyKey: fixture.idempotencyKey,
            input: { markerPath: fixture.markerPath },
          },
          'start-response-ready',
        );
        expectKilledAt(crashed, 'start-response-ready');
        expect(crashed.message.detail.response).toMatchObject({
          run_id: fixture.runId,
          reused: false,
        });
        const revisionId = crashed.message.detail.response.revision;
        const beforeReplay = await readState(fixture, revisionId);
        expect(beforeReplay).toMatchObject({
          view: {
            run: { status: RunStatus.RUNNING, version: 1, lastSequence: 1 },
            workflowCursor: {
              disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
              stepIndex: 0,
            },
            attempts: [],
          },
          events: [expect.objectContaining({ type: 'workflow-run-created' })],
          ready: {
            items: [
              expect.objectContaining({
                kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
                stepIndex: 0,
              }),
            ],
          },
          ownership: null,
        });

        const replay = startWorkflow(fixture);
        expect(replay).toEqual({
          ...crashed.message.detail.response,
          reused: true,
        });
        await expect(readState(fixture, revisionId)).resolves.toEqual(
          beforeReplay,
        );
        expect(markerEntries(fixture)).toEqual([]);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
