/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import {
  APPLICATION_STATE_TABLE_NAME,
  resolveExecutionPayloadStoreId,
} from '../../src/core/lib/config/db.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ExecutionLedgerReadyWorkKind } from '../../src/core/lib/ledger/ready-work.js';
import {
  createManualLedgerRunId,
  runManualLedgerActivity,
} from '../../src/core/runtime/manual-ledger-run.js';
import {
  withExecutionLedger,
  withExecutionLedgerCoordinatorAuthority,
  withLocalLedgerServiceMutationOwnership,
} from '../../src/core/runtime/operator/execution-ledger-store.js';
import {
  ResidentExecutionReconstructionPolicy,
  reconstructResidentExecutionHistory,
} from '../../src/core/runtime/services/resident-execution-reconstruction.js';
import {
  cleanupIsolatedAuthoredAppFixtures,
  createIsolatedAuthoredAppFixture,
} from '../helpers/isolated-authored-app.js';
import {
  cleanupCrashChild,
  killCrashChild,
  spawnCrashChild,
  waitForCrashChildMessage,
} from '../helpers/real-sigkill-subprocess.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN_PATH = join(REPO_ROOT, 'bin', 'wharfie');
const CHILD_PATH = fileURLToPath(
  new URL('../fixtures/resident-authored-crash-child.js', import.meta.url),
);
const AUTHORED_APP_PATH = fileURLToPath(
  new URL('../fixtures/apps/resident-authored-crash/', import.meta.url),
);
const APP_ID = 'resident-authored-crash';
const ACTIVITY_ID = 'crash-task';
const BOUNDARY = Object.freeze({
  AUTHORED_ENTERED: 'authored-entered',
  FINAL_TERMINAL_COMMITTED: 'final-terminal-committed',
});
const WAIT_TIMEOUT_MS = 30_000;
const testOnUnix = process.platform === 'win32' ? test.skip : test;
/** @type {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} */
const authoredAppFixtures = [];

/** @typedef {{root: string, appDir: string, controlPath: string, markerPath: string, tableName: string, configuration: {adapterName: 'lmdb', controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}, applicationStateConfiguration: {adapterName: 'lmdb', storePath: string, tableName: string}, env: NodeJS.ProcessEnv}} Fixture */
/** @typedef {{child: import('node:child_process').ChildProcess, exited: Promise<{code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string}>, output: () => {stdout: string, stderr: string}}} LiveWorker */

/** @param {string} label @returns {Fixture} */
function createFixture(label) {
  const authoredApp = createIsolatedAuthoredAppFixture(AUTHORED_APP_PATH, {
    prefix: 'wharfie-resident-authored-crash-app-',
  });
  authoredAppFixtures.push(authoredApp);
  const root = mkdtempSync(join(tmpdir(), 'wharfie-resident-authored-crash-'));
  const controlPath = join(root, 'control');
  const payloadPath = join(root, 'payloads');
  const sessionPath = join(root, 'sessions');
  const applicationStatePath = join(root, 'application-state');
  const tableName = `resident-authored-crash-${label}`;
  const configuration = {
    adapterName: /** @type {const} */ ('lmdb'),
    controlPath,
    tableName,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath,
  };
  const applicationStateConfiguration = {
    adapterName: /** @type {const} */ ('lmdb'),
    storePath: applicationStatePath,
    tableName: APPLICATION_STATE_TABLE_NAME,
  };
  return /** @type {Fixture} */ ({
    root,
    appDir: authoredApp.appDir,
    controlPath,
    markerPath: join(root, 'authored-entry.log'),
    tableName,
    configuration,
    applicationStateConfiguration,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NO_COLOR: '1',
      WHARFIE_ARTIFACT_BUCKET: 'resident-authored-crash-bucket',
      WHARFIE_DB_ADAPTER: 'lmdb',
      WHARFIE_DB_PATH: join(root, 'general'),
      WHARFIE_CONTROL_ADAPTER: 'lmdb',
      WHARFIE_CONTROL_PATH: controlPath,
      WHARFIE_EXECUTION_LEDGER_TABLE: tableName,
      WHARFIE_EXECUTION_PAYLOAD_PATH: payloadPath,
      WHARFIE_LEDGER_SERVICE_SESSION_PATH: sessionPath,
      WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
      WHARFIE_APPLICATION_STATE_PATH: applicationStatePath,
    },
  });
}

/** @param {Fixture} fixture @param {string[]} args */
function runCli(fixture, args) {
  return /** @type {import('node:child_process').SpawnSyncReturns<string>} */ (
    spawnSync(process.execPath, [BIN_PATH, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: fixture.env,
    })
  );
}

/** @param {import('node:child_process').SpawnSyncReturns<string>} result @param {string} label */
function parseSuccessfulJson(result, label) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with status=${result.status} signal=${result.signal || 'none'}: ${result.stderr || result.stdout}`,
    );
  }
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout.trim());
}

/** @param {Fixture} fixture */
function markerEntries(fixture) {
  if (!existsSync(fixture.markerPath)) return [];
  return readFileSync(fixture.markerPath, 'utf8').split('\n').filter(Boolean);
}

/** @param {unknown} value @returns {{kind: string, id: string}} */
function exactActor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Manual creation actor is invalid.');
  }
  const actor = /** @type {Record<string, unknown>} */ (value);
  if (
    Object.keys(actor).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(actor, 'kind') ||
    !Object.prototype.hasOwnProperty.call(actor, 'id') ||
    typeof actor.kind !== 'string' ||
    !actor.kind ||
    typeof actor.id !== 'string' ||
    !actor.id
  ) {
    throw new TypeError('Manual creation actor is invalid.');
  }
  return { kind: actor.kind, id: actor.id };
}

/** @param {Fixture} fixture */
function payloadStore(fixture) {
  return createLocalExecutionPayloadStore({
    path: fixture.configuration.payloadPath,
    storeId: fixture.configuration.payloadStoreId,
  });
}

/** @param {Fixture} fixture @param {string} runId @param {string} revisionId */
async function readState(fixture, runId, revisionId) {
  const db = createLMDB({ path: fixture.controlPath, readOnly: true });
  try {
    const ledger = createExecutionLedger({
      db,
      tableName: fixture.tableName,
      payloadStore: payloadStore(fixture),
    });
    const view = await ledger.rebuildRun(runId);
    if (!view) throw new Error(`Crash run is unavailable: ${runId}`);
    return {
      view,
      ready: await ledger.listReadyWork({
        appId: APP_ID,
        revisionId,
        observedAt: Number.MAX_SAFE_INTEGER,
        limit: 100,
      }),
    };
  } finally {
    await db.close();
  }
}

/** @param {Fixture} fixture @param {string} idempotencyKey @param {Record<string, any>} input */
function submit(fixture, idempotencyKey, input) {
  return parseSuccessfulJson(
    runCli(fixture, [
      'ops',
      'submit',
      '--activity',
      ACTIVITY_ID,
      '--idempotency-key',
      idempotencyKey,
      '--dir',
      fixture.appDir,
      '--input',
      JSON.stringify(input),
      '--json',
    ]),
    'ops submit',
  );
}

/** @param {Fixture} fixture @param {string} runId @param {string} boundary @param {string} marker */
function spawnBoundaryChild(fixture, runId, boundary, marker) {
  return spawnCrashChild({
    childPath: CHILD_PATH,
    cwd: REPO_ROOT,
    options: {
      boundary,
      appDir: fixture.appDir,
      runId,
      markerPath: fixture.markerPath,
      marker,
      configuration: fixture.configuration,
      applicationStateConfiguration: fixture.applicationStateConfiguration,
    },
  });
}

/** @param {ReturnType<typeof spawnCrashChild>} handle @param {string} boundary */
async function killAtBoundary(handle, boundary) {
  const message = await waitForCrashChildMessage(
    handle,
    (candidate) =>
      candidate.kind === 'boundary' && candidate.boundary === boundary,
    boundary,
    WAIT_TIMEOUT_MS,
  );
  const exit = await killCrashChild(handle);
  expect(exit).toEqual({ code: null, signal: 'SIGKILL' });
  expect(handle.stdout).toBe('');
  expect(handle.stderr).toBe('');
  return message;
}

/**
 * @param {Fixture} fixture
 * @param {Record<string, any>} reportedAuthority
 * @param {string} revisionId
 * @param {string} label
 */
async function reconstructAfterKnownProcessDeath(
  fixture,
  reportedAuthority,
  revisionId,
  label,
) {
  const db = createLMDB({ path: fixture.controlPath });
  const authorities = createCoordinatorAuthority({
    db,
    tableName: fixture.tableName,
  });
  let successorAuthority;
  try {
    const observed = await authorities.get({ appId: APP_ID });
    expect({ ...observed }).toEqual({ ...reportedAuthority });
    expect(observed).toMatchObject({
      status: CoordinatorAuthorityStatus.ACTIVE,
    });
    const takeover = await authorities.takeover({
      appId: APP_ID,
      coordinatorId: `known-stopped-successor-${label}`,
      requestId: `known-stopped-successor-takeover-${label}`,
      observedAuthority: observed,
      confirmAuthorityReplacement: true,
    });
    successorAuthority = takeover.authority;
    const token = createCoordinatorAuthorityToken(successorAuthority);
    const ledger = createExecutionLedger({
      db,
      tableName: fixture.tableName,
      payloadStore: payloadStore(fixture),
    }).bindCoordinatorAuthority(token);
    const reconstruction = await reconstructResidentExecutionHistory({
      ledger,
      appId: APP_ID,
      currentRevisionId: revisionId,
      coordinatorAuthority: token,
    });
    const release = await authorities.release({
      authority: successorAuthority,
      requestId: `known-stopped-successor-release-${label}`,
    });
    expect(release).toMatchObject({
      applied: true,
      authority: { status: CoordinatorAuthorityStatus.RELEASED },
    });
    successorAuthority = undefined;
    return reconstruction;
  } finally {
    if (successorAuthority) {
      await authorities
        .release({
          authority: successorAuthority,
          requestId: `known-stopped-successor-cleanup-${label}`,
        })
        .catch(() => undefined);
    }
    await db.close();
  }
}

/**
 * Replay the exact persisted create request with physical dispatch replaced by
 * traps. A terminal run must return before either trap can be reached.
 * @param {Fixture} fixture
 * @param {string} runId
 * @param {string} revisionId
 * @param {Record<string, any>} input
 * @param {{kind: string, id: string}} creationActor
 */
async function replayRetainedTerminal(
  fixture,
  runId,
  revisionId,
  input,
  creationActor,
) {
  let reentryCalls = 0;
  const outcome = await withExecutionLedger(
    async (ledger, context) =>
      await withLocalLedgerServiceMutationOwnership({
        appId: APP_ID,
        context,
        handler: async (localOwner) => {
          if (!localOwner) {
            throw new Error('Terminal replay requires its local owner.');
          }
          return await withExecutionLedgerCoordinatorAuthority({
            appId: APP_ID,
            coordinatorId: localOwner.sessionId,
            ledger,
            context,
            handler: async (boundLedger) =>
              await runManualLedgerActivity({
                ledger: boundLedger,
                runId,
                appId: APP_ID,
                revisionId,
                activityId: ACTIVITY_ID,
                input,
                callerMetadata: {},
                actor: creationActor,
                createFencingToken: () => {
                  reentryCalls += 1;
                  throw new Error('Terminal replay minted a new attempt.');
                },
                executeAttempt: async () => {
                  reentryCalls += 1;
                  throw new Error('Terminal replay re-entered authored code.');
                },
              }),
          });
        },
      }),
    { configuration: fixture.configuration },
  );
  return { outcome, reentryCalls };
}

/** @param {Fixture} fixture @returns {LiveWorker} */
function startSuccessorWorker(fixture) {
  const child = spawn(
    process.execPath,
    [BIN_PATH, 'ops', 'worker', '--dir', fixture.appDir],
    {
      cwd: REPO_ROOT,
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

/** @param {LiveWorker} worker @param {number} [timeoutMs] */
async function waitForExit(worker, timeoutMs = 15_000) {
  let timer;
  try {
    return await Promise.race([
      worker.exited,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for successor worker.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** @param {Fixture} fixture @param {string} runId @param {string} revisionId @param {LiveWorker} worker */
async function waitForBlocked(fixture, runId, revisionId, worker) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      const output = worker.output();
      throw new Error(
        `Successor exited before recovery: ${output.stderr || output.stdout}`,
      );
    }
    try {
      const state = await readState(fixture, runId, revisionId);
      if (
        state.view.run.status === RunStatus.BLOCKED &&
        state.view.invocations[0]?.status === InvocationStatus.UNCERTAIN &&
        state.view.attempts[0]?.status === AttemptStatus.ABANDONED
      ) {
        return state;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for stopped STARTED recovery${detail}`);
}

/** @param {Fixture} fixture @param {Array<ReturnType<typeof spawnCrashChild>>} [handles] @param {LiveWorker[]} [workers] */
async function cleanupFixture(fixture, handles = [], workers = []) {
  /** @type {unknown[]} */
  const failures = [];
  for (const handle of handles) {
    try {
      await cleanupCrashChild(handle);
    } catch (error) {
      failures.push(error);
    }
  }
  for (const worker of workers) {
    try {
      if (worker.child.exitCode === null && worker.child.signalCode === null) {
        worker.child.kill('SIGKILL');
      }
      await worker.exited;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 0) {
    try {
      cleanupIsolatedAuthoredAppFixtures(authoredAppFixtures);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 0) {
    try {
      rmSync(fixture.root, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Resident authored crash cleanup failed; retaining ${fixture.root}`,
    );
  }
}

describe('resident authored work real-process crash semantics', () => {
  testOnUnix(
    'kills physically entered STARTED code and reconstructs it recovery-only without re-entry',
    async () => {
      const fixture = createFixture('entered-started');
      const idempotencyKey = 'entered-started';
      const runId = createManualLedgerRunId({ appId: APP_ID, idempotencyKey });
      const token = 'entered-started-generation-1';
      const marker = `entry:${token}`;
      let crash;
      /** @type {ReturnType<typeof startSuccessorWorker> | undefined} */
      let successor;
      try {
        const accepted = submit(fixture, idempotencyKey, {
          markerPath: fixture.markerPath,
          mode: 'hang',
          token,
        });
        expect(accepted).toMatchObject({
          appId: APP_ID,
          runId,
          activityId: ACTIVITY_ID,
          reused: false,
        });
        crash = spawnBoundaryChild(
          fixture,
          runId,
          BOUNDARY.AUTHORED_ENTERED,
          marker,
        );

        const killed = await killAtBoundary(crash, BOUNDARY.AUTHORED_ENTERED);
        expect(killed.detail).toMatchObject({
          runId,
          attemptStatus: AttemptStatus.STARTED,
          generation: 1,
          marker,
        });
        expect(markerEntries(fixture)).toEqual([marker]);
        const stopped = await readState(fixture, runId, accepted.revisionId);
        expect(stopped).toMatchObject({
          view: {
            run: { status: RunStatus.RUNNING },
            invocations: [
              expect.objectContaining({
                status: InvocationStatus.RUNNING,
                generation: 1,
              }),
            ],
            attempts: [
              expect.objectContaining({
                attemptId: killed.detail.attemptId,
                status: AttemptStatus.STARTED,
                generation: 1,
              }),
            ],
          },
          ready: {
            items: [
              expect.objectContaining({
                kind: ExecutionLedgerReadyWorkKind.RECOVERY,
                runId,
                attemptId: killed.detail.attemptId,
              }),
            ],
          },
        });
        expect(
          stopped.view.events.map(
            (/** @type {Record<string, any>} */ event) => event.type,
          ),
        ).toEqual(['manual-run-created', 'attempt-claimed', 'attempt-started']);

        const reconstruction = await reconstructAfterKnownProcessDeath(
          fixture,
          killed.coordinatorAuthority,
          accepted.revisionId,
          'entered-started',
        );
        expect(reconstruction).toMatchObject({
          inspectedRuns: 1,
          policyCounts: {
            [ResidentExecutionReconstructionPolicy.STARTED_OUTCOME_UNKNOWN]: 1,
          },
        });
        expect(markerEntries(fixture)).toEqual([marker]);

        successor = startSuccessorWorker(fixture);
        const blocked = await waitForBlocked(
          fixture,
          runId,
          accepted.revisionId,
          successor,
        );
        expect(blocked).toMatchObject({
          view: {
            run: { status: RunStatus.BLOCKED },
            invocations: [
              expect.objectContaining({
                status: InvocationStatus.UNCERTAIN,
                generation: 1,
              }),
            ],
            attempts: [
              expect.objectContaining({
                attemptId: killed.detail.attemptId,
                status: AttemptStatus.ABANDONED,
                generation: 1,
              }),
            ],
          },
          ready: { items: [] },
        });
        expect(
          blocked.view.events.map(
            (/** @type {Record<string, any>} */ event) => event.type,
          ),
        ).toEqual([
          'manual-run-created',
          'attempt-claimed',
          'attempt-started',
          'attempt-became-uncertain',
        ]);
        expect(
          blocked.view.events.filter(
            (/** @type {Record<string, any>} */ event) =>
              event.type === 'attempt-terminal',
          ),
        ).toEqual([]);
        expect(markerEntries(fixture)).toEqual([marker]);

        expect(successor.child.kill('SIGTERM')).toBe(true);
        const drained = await waitForExit(successor);
        expect(drained).toMatchObject({ code: 0, signal: null, stderr: '' });
        successor = undefined;
      } finally {
        await cleanupFixture(
          fixture,
          crash ? [crash] : [],
          successor ? [successor] : [],
        );
      }
    },
    90_000,
  );

  testOnUnix(
    'replays the exact final terminal after its committed response is killed without duplicate execution',
    async () => {
      const fixture = createFixture('final-terminal-response');
      const idempotencyKey = 'final-terminal-response';
      const runId = createManualLedgerRunId({ appId: APP_ID, idempotencyKey });
      const token = 'final-terminal-generation-1';
      const marker = `entry:${token}`;
      const proof = {
        exact: 'retained-final-authored-outcome',
        nested: { sequence: 1, committed: true },
      };
      const input = {
        markerPath: fixture.markerPath,
        mode: 'complete',
        token,
        proof,
      };
      let crash;
      try {
        const accepted = submit(fixture, idempotencyKey, input);
        expect(accepted).toMatchObject({
          appId: APP_ID,
          runId,
          activityId: ACTIVITY_ID,
          reused: false,
        });
        crash = spawnBoundaryChild(
          fixture,
          runId,
          BOUNDARY.FINAL_TERMINAL_COMMITTED,
          marker,
        );

        const killed = await killAtBoundary(
          crash,
          BOUNDARY.FINAL_TERMINAL_COMMITTED,
        );
        expect(killed.detail).toMatchObject({
          runId,
          runStatus: RunStatus.COMPLETED,
          invocationStatus: InvocationStatus.COMPLETED,
          attemptStatus: AttemptStatus.COMPLETED,
          generation: 1,
          terminal: { type: 'completed' },
          evidenceRef: expect.objectContaining({
            payloadSchema: 'wharfie.execution.activity-evidence.v1',
          }),
          marker,
        });
        expect(markerEntries(fixture)).toEqual([marker]);

        const committed = await readState(fixture, runId, accepted.revisionId);
        expect(committed).toMatchObject({
          view: {
            run: { status: RunStatus.COMPLETED },
            invocations: [
              expect.objectContaining({
                status: InvocationStatus.COMPLETED,
                generation: 1,
              }),
            ],
            attempts: [
              expect.objectContaining({
                attemptId: killed.detail.attemptId,
                status: AttemptStatus.COMPLETED,
                generation: 1,
                terminal: killed.detail.terminal,
                evidenceRef: killed.detail.evidenceRef,
              }),
            ],
          },
          ready: { items: [] },
        });
        expect(
          committed.view.events.map(
            (/** @type {Record<string, any>} */ event) => event.type,
          ),
        ).toEqual([
          'manual-run-created',
          'attempt-claimed',
          'attempt-started',
          'attempt-terminal',
        ]);

        const reconstruction = await reconstructAfterKnownProcessDeath(
          fixture,
          killed.coordinatorAuthority,
          accepted.revisionId,
          'final-terminal-response',
        );
        expect(reconstruction).toMatchObject({
          inspectedRuns: 1,
          policyCounts: {
            [ResidentExecutionReconstructionPolicy.TERMINAL]: 1,
          },
        });

        const creationActor = exactActor(committed.view.events[0]?.actor);
        const replay = await replayRetainedTerminal(
          fixture,
          runId,
          accepted.revisionId,
          input,
          creationActor,
        );
        expect(replay).toEqual({
          reentryCalls: 0,
          outcome: {
            disposition: 'completed',
            reused: true,
            run: committed.view.run,
            invocation: committed.view.invocations[0],
            attempt: committed.view.attempts[0],
            terminalSummary: committed.view.attempts[0].terminal,
            evidenceRef: committed.view.attempts[0].evidenceRef,
          },
        });

        const output = parseSuccessfulJson(
          runCli(fixture, [
            'ops',
            'output',
            '--app-id',
            APP_ID,
            '--run-id',
            runId,
            '--confirm-sensitive-output',
            '--json',
          ]),
          'ops output terminal replay',
        );
        expect(output).toMatchObject({
          integrity: { verified: true },
          scope: { appId: APP_ID, revisionId: accepted.revisionId, runId },
          snapshot: { runKind: 'manual', status: RunStatus.COMPLETED },
          terminal: {
            type: 'completed',
            result: { token, proof },
          },
        });

        const afterReplay = await readState(
          fixture,
          runId,
          accepted.revisionId,
        );
        expect(afterReplay).toEqual(committed);
        expect(afterReplay.view.attempts).toHaveLength(1);
        expect(
          afterReplay.view.events.filter(
            (/** @type {Record<string, any>} */ event) =>
              event.type === 'attempt-started',
          ),
        ).toHaveLength(1);
        expect(
          afterReplay.view.events.filter(
            (/** @type {Record<string, any>} */ event) =>
              event.type === 'attempt-terminal',
          ),
        ).toHaveLength(1);
        expect(markerEntries(fixture)).toEqual([marker]);
      } finally {
        await cleanupFixture(fixture, crash ? [crash] : []);
      }
    },
    90_000,
  );
});
