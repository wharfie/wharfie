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
const CHILD_BOUNDARY_TIMEOUT_MS = 30_000;
const CHILD_EXIT_TIMEOUT_MS = 5_000;
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
      `${label} failed with ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/** @param {WorkflowFixture} fixture @returns {Record<string, any>} */
function startWorkflow(fixture) {
  return parseSuccessfulJson(
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
        JSON.stringify({ markerPath: fixture.markerPath }),
        '--json',
      ],
      fixture.env,
    ),
    'ops start',
  );
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
  const ledger = createExecutionLedger({
    db,
    tableName: fixture.configuration.tableName,
    payloadStore: createLocalExecutionPayloadStore({
      path: fixture.configuration.payloadPath,
      storeId: fixture.configuration.payloadStoreId,
    }),
  });
  try {
    return {
      view: await ledger.rebuildRun(fixture.runId),
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
 * @param {WorkflowFixture} fixture
 * @param {string} revisionId
 * @param {LiveWorker} worker
 */
async function waitForCompleted(fixture, revisionId, worker) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      const output = worker.output();
      throw new Error(
        `Workflow worker exited before completion: ${output.stderr || output.stdout}`,
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
