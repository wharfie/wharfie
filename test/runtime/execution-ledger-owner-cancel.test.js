/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import createLMDB from '../../src/core/lib/db/adapters/lmdb.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLedgerServiceOwnership } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { resolveExecutionPayloadStoreId } from '../../src/core/lib/config/db.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
  runManualLedgerActivity,
} from '../../src/core/runtime/manual-ledger-run.js';
import { EXECUTION_LEDGER_CANCEL_OWNER_COMMAND } from '../../src/core/runtime/operator/execution-ledger-operator.js';
import { createLocalOwnerCommandServer } from '../../src/core/runtime/operator/local-owner-command.js';
import { acquireLocalLedgerServiceSession } from '../../src/core/runtime/services/ledger-service.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const EXECUTION_LEDGER_OPERATOR_MODULE_URL = new URL(
  '../../src/core/runtime/operator/execution-ledger-operator.js',
  import.meta.url,
).href;

const EXTERNAL_CANCELLATION_CLIENT = `
  const { cancelExecutionLedgerRun } = await import(process.argv[1]);
  try {
    const result = await cancelExecutionLedgerRun(JSON.parse(process.argv[2]));
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (error) {
    const candidate = error && typeof error === 'object' ? error : {};
    process.stdout.write(JSON.stringify({
      ok: false,
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
        ...(typeof candidate.runId === 'string' ? { runId: candidate.runId } : {}),
        ...(typeof candidate.expectedAppId === 'string'
          ? { expectedAppId: candidate.expectedAppId }
          : {}),
      },
    }));
  }
`;

/**
 * Invoke the public cancellation client in a distinct process. This is the
 * real operator topology: the active LMDB owner keeps its writable handle,
 * while a separately invoked CLI opens a short-lived read-only handle before
 * it connects to the authenticated local socket.
 * @param {Record<string, any>} options
 * @returns {Promise<{ok: true, result: Record<string, any>} | {ok: false, error: {name: string, message: string, runId?: string, expectedAppId?: string}}>}
 */
async function cancelFromExternalProcess(options) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      EXTERNAL_CANCELLATION_CLIENT,
      EXECUTION_LEDGER_OPERATOR_MODULE_URL,
      JSON.stringify(options),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdout || !stderr) {
    child.kill();
    throw new Error('External cancellation helper did not expose pipes.');
  }
  let output = '';
  let errors = '';
  stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  stderr.on('data', (chunk) => {
    errors += String(chunk);
  });
  const [code, signal] = await once(child, 'close');
  if (code !== 0 || signal !== null) {
    throw new Error(
      `External cancellation helper failed (code ${code}, signal ${signal}): ${errors} ${output}`,
    );
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(
      `External cancellation helper returned invalid JSON: ${errors}`,
    );
  }
}

/**
 * @param {Record<string, any>} options
 * @returns {Promise<Record<string, any>>}
 */
async function externalCancellationResult(options) {
  const response = await cancelFromExternalProcess(options);
  if (response.ok) return response.result;
  throw new Error(
    `External cancellation helper rejected the request: ${response.error.name}: ${response.error.message}`,
  );
}

/**
 * @param {string} root
 * @param {string} tableName
 * @returns {{adapterName: 'lmdb', controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}}
 */
function createConfiguration(root, tableName) {
  const controlPath = path.join(root, 'control');
  const payloadPath = path.join(controlPath, 'execution-payloads');
  return {
    adapterName: 'lmdb',
    controlPath,
    tableName,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath: path.join(root, 'ledger-service-sessions'),
  };
}

/**
 * @param {ReturnType<typeof createConfiguration>} configuration
 * @param {{readOnly?: boolean}} [options]
 * @returns {{db: import('../../src/core/lib/db/base.js').DBClient, ledger: import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore}}
 */
function createLedger(configuration, options = {}) {
  const db = createLMDB({
    path: configuration.controlPath,
    ...(options.readOnly ? { readOnly: true } : {}),
  });
  return {
    db,
    ledger: createExecutionLedger({
      db,
      tableName: configuration.tableName,
      payloadStore: createLocalExecutionPayloadStore({
        path: configuration.payloadPath,
        storeId: configuration.payloadStoreId,
      }),
    }),
  };
}

/**
 * @param {Readonly<Record<string, any>>} start
 * @param {Record<string, any>} reason
 * @returns {Record<string, any>}
 */
function cancelledEvidence(start, reason) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const cancel = transcript.acceptHostFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancel',
    attemptId: start.attemptId,
    reason,
  });
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancelled',
    attemptId: start.attemptId,
    sequence: 1,
    error: reason,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, cancel, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {Readonly<Record<string, any>>} start
 * @returns {Record<string, any>}
 */
function completedEvidence(start) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result: { ok: true, secret: 'terminal-secret' },
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger
 * @param {{appId: string, idempotencyKey: string}} options
 * @returns {Promise<string>}
 */
async function seedRunnableManualRun(ledger, options) {
  const runId = createManualLedgerRunId(options);
  await ledger.createManualRun({
    runId,
    appId: options.appId,
    revisionId: REVISION_ID,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    activityId: 'work',
    input: { credential: 'input-secret' },
    callerMetadata: { credential: 'caller-secret' },
    transitionId: `create:${options.idempotencyKey}`,
    actor: { kind: 'local', id: 'test' },
  });
  return runId;
}

/**
 * @param {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger
 * @param {{appId: string, idempotencyKey: string}} options
 * @returns {Promise<string>}
 */
async function seedCompletedManualRun(ledger, options) {
  const runId = await seedRunnableManualRun(ledger, options);
  const created = await ledger.rebuildRun(runId);
  if (!created) throw new Error('Expected seeded manual run.');
  const claim = await ledger.claimInvocation({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    fencingToken: 'seed-fence',
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: `claim:${options.idempotencyKey}`,
    actor: { kind: 'local', id: 'test' },
  });
  if (!claim.attempt) throw new Error('Expected seeded manual attempt.');
  const started = await ledger.markAttemptStarted({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: claim.attempt.attemptId,
    fencingToken: claim.attempt.fencingToken,
    generation: claim.attempt.generation,
    expectedVersion: claim.run.version,
    transitionId: `start:${options.idempotencyKey}`,
    actor: { kind: 'local', id: 'test' },
  });
  await ledger.commitVerifiedAttemptTerminal({
    runId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    attemptId: claim.attempt.attemptId,
    fencingToken: claim.attempt.fencingToken,
    generation: claim.attempt.generation,
    expectedVersion: started.run.version,
    transitionId: `terminal:${options.idempotencyKey}`,
    actor: { kind: 'local', id: 'test' },
    evidence: completedEvidence(started.startFrame),
  });
  return runId;
}

/**
 * @param {ReturnType<typeof createConfiguration>} configuration
 * @param {{db: import('../../src/core/lib/db/base.js').DBClient, ledger: import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, runId: string}} options
 * @returns {Promise<{runner: Promise<Record<string, any>>, stop: () => Promise<void>, getAbortView: () => Record<string, any> | undefined, receivedRunIds: string[], ownerSessionId: string, ownerCommandEndpoint: string}>}
 */
async function startActiveManualOwner(configuration, options) {
  const ownership = createLedgerServiceOwnership({
    db: options.db,
    tableName: configuration.tableName,
  });
  const owner = await acquireLocalLedgerServiceSession({
    appId: options.appId,
    ownership,
    sessionRoot: configuration.sessionPath,
  });
  /** @type {import('../../src/core/runtime/manual-ledger-run.js').ManualLedgerActiveAttemptCancellationPort | undefined} */
  let activePort;
  /** @type {Record<string, any> | undefined} */
  let abortView;
  /** @type {string[]} */
  const receivedRunIds = [];
  /** @type {(value: void | PromiseLike<void>) => void} */
  let resolvePortRegistered;
  const portRegistered = new Promise((resolve) => {
    resolvePortRegistered = resolve;
  });
  /** @type {(value: void | PromiseLike<void>) => void} */
  let resolveExecutionStarted;
  /** @type {(reason?: unknown) => void} */
  let rejectExecutionStarted;
  const executionStarted = new Promise((resolve, reject) => {
    resolveExecutionStarted = resolve;
    rejectExecutionStarted = reject;
  });

  const server = await createLocalOwnerCommandServer({
    session: owner.commandSession,
    isCurrentOwner: async () => {
      const current = await ownership.getOwnership({
        serviceId: owner.ownership.serviceId,
      });
      return (
        current?.serviceId === owner.ownership.serviceId &&
        current?.sessionId === owner.ownership.sessionId &&
        current?.generation === owner.ownership.generation &&
        current?.scopeId === owner.ownership.scopeId &&
        current?.principalId === owner.ownership.principalId
      );
    },
    handleCommand: async (command) => {
      receivedRunIds.push(command.request.runId);
      const port = activePort;
      if (
        command.command !== EXECUTION_LEDGER_CANCEL_OWNER_COMMAND ||
        !port ||
        command.request.runId !== port.runId
      ) {
        return {
          outcome: 'owner-not-ready',
          delivery: 'not-delivered',
          runStatus: 'RUNNING',
          invocationStatus: 'RUNNING',
          reason: 'must-not-leave-owner',
          sessionId: owner.sessionId,
          endpoint: owner.ownerCommandEndpoint,
        };
      }
      const cancellation = await port.requestCancellation({
        requestId: command.requestId,
      });
      return {
        outcome: cancellation.outcome,
        delivery: cancellation.signalDelivered ? 'started' : 'not-delivered',
        runStatus: cancellation.run.status,
        invocationStatus: cancellation.invocation.status,
        reason: 'must-not-leave-owner',
        sessionId: owner.sessionId,
        endpoint: owner.ownerCommandEndpoint,
        fencingToken: port.fencingToken,
      };
    },
  });

  const runner = runManualLedgerActivity({
    ledger: options.ledger,
    runId: options.runId,
    appId: options.appId,
    revisionId: REVISION_ID,
    activityId: 'work',
    input: { credential: 'input-secret' },
    callerMetadata: { credential: 'caller-secret' },
    actor: { kind: 'local', id: 'manual-owner' },
    ownerCancellation: {
      actor: { kind: 'local', id: 'owner-command' },
      reason: {
        code: 'owner-cancel-requested',
        name: 'OwnerCancellationRequested',
        message: 'owner-command-reason-secret',
        details: { credential: 'owner-command-details-secret' },
      },
    },
    registerActiveAttemptCancellationPort: (port) => {
      activePort = port;
      resolvePortRegistered();
      return () => {
        if (activePort === port) activePort = undefined;
      };
    },
    executeAttempt: async (start, { signal }) => {
      resolveExecutionStarted();
      await new Promise((resolve) => {
        const observeAbort = () => {
          Promise.resolve(options.ledger.rebuildRun(options.runId))
            .then((view) => {
              abortView = view || undefined;
              resolve(undefined);
            })
            .catch(() => resolve(undefined));
        };
        if (signal.aborted) observeAbort();
        else signal.addEventListener('abort', observeAbort, { once: true });
      });
      if (!abortView?.run.cancellationRequest) {
        throw new Error(
          'The active attempt observed AbortSignal before cancellation persisted.',
        );
      }
      return cancelledEvidence(start, abortView.run.cancellationRequest.reason);
    },
  });
  // The explicit handler keeps a setup failure from becoming an unhandled
  // rejection before the test body can assert it through the returned promise.
  runner.catch((error) => {
    rejectExecutionStarted(error);
  });
  await portRegistered;
  await executionStarted;

  return {
    runner,
    getAbortView: () => abortView,
    receivedRunIds,
    ownerSessionId: owner.sessionId,
    ownerCommandEndpoint: owner.ownerCommandEndpoint,
    stop: async () => {
      if (activePort) {
        try {
          await activePort.requestCancellation({
            requestId: 'cleanup-owner-cancellation',
          });
        } catch {
          // The runner may have reached a terminal while test cleanup began.
        }
      }
      try {
        await runner;
      } catch {
        // The assertion path reports runner failures; cleanup only releases
        // the private server/session resources.
      }
      await server.close();
      await owner.release();
    },
  };
}

describe('execution-ledger local owner cancellation operator', () => {
  it('routes only the exact active run, persists before abort, and redacts owner-only data', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'wharfie-owner-cancel-'));
    const configuration = createConfiguration(root, 'owner-cancel-test');
    const appId = 'owner-cancel-demo';
    const { db, ledger } = createLedger(configuration);
    /** @type {Awaited<ReturnType<typeof startActiveManualOwner>> | undefined} */
    let host;
    try {
      const activeRunId = createManualLedgerRunId({
        appId,
        idempotencyKey: 'active-run',
      });
      const inactiveRunId = await seedRunnableManualRun(ledger, {
        appId,
        idempotencyKey: 'inactive-run',
      });
      const inactiveBefore = await ledger.rebuildRun(inactiveRunId);
      host = await startActiveManualOwner(configuration, {
        db,
        ledger,
        appId,
        runId: activeRunId,
      });
      await expect(
        externalCancellationResult({
          runId: inactiveRunId,
          requestId: 'cancel-inactive-run',
          configuration,
        }),
      ).resolves.toEqual({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.cancel',
        runId: inactiveRunId,
        requestId: 'cancel-inactive-run',
        outcome: 'owner-not-ready',
        delivery: 'not-delivered',
        runStatus: RunStatus.RUNNING,
        invocationStatus: InvocationStatus.RUNNABLE,
      });
      expect(host.getAbortView()).toBeUndefined();
      await expect(ledger.rebuildRun(inactiveRunId)).resolves.toEqual(
        inactiveBefore,
      );

      const response = await externalCancellationResult({
        runId: activeRunId,
        requestId: 'cancel-active-run',
        configuration,
      });
      expect(response).toEqual({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.cancel',
        runId: activeRunId,
        requestId: 'cancel-active-run',
        outcome: 'cancellation-requested',
        delivery: 'started',
        runStatus: RunStatus.RUNNING,
        invocationStatus: InvocationStatus.RUNNING,
      });
      expect(host.receivedRunIds).toEqual([inactiveRunId, activeRunId]);

      const abortView = host.getAbortView();
      expect(abortView).toMatchObject({
        run: {
          status: RunStatus.RUNNING,
          cancellationRequest: {
            requestId: 'cancel-active-run',
            reason: {
              message: 'owner-command-reason-secret',
              details: { credential: 'owner-command-details-secret' },
            },
          },
        },
        invocations: [
          expect.objectContaining({ status: InvocationStatus.RUNNING }),
        ],
        attempts: [expect.objectContaining({ status: AttemptStatus.STARTED })],
        events: expect.arrayContaining([
          expect.objectContaining({
            type: 'manual-cancellation-requested',
          }),
        ]),
      });
      const cancellationEvent = abortView?.events.find(
        (/** @type {Record<string, any>} */ event) =>
          event.type === 'manual-cancellation-requested',
      );
      expect(cancellationEvent?.transition_id).toMatch(
        /^wlc_[A-Za-z0-9_-]{43}$/,
      );
      expect(cancellationEvent?.transition_id).not.toBe('cancel-active-run');
      const serialized = JSON.stringify(response);
      expect(serialized).not.toContain('owner-command-reason-secret');
      expect(serialized).not.toContain('owner-command-details-secret');
      expect(serialized).not.toContain('input-secret');
      expect(serialized).not.toContain('caller-secret');
      expect(serialized).not.toContain('must-not-leave-owner');
      expect(serialized).not.toContain(host.ownerSessionId);
      expect(serialized).not.toContain(host.ownerCommandEndpoint);

      await expect(host.runner).resolves.toMatchObject({
        run: { status: RunStatus.CANCELLED },
        invocation: { status: InvocationStatus.CANCELLED },
        attempt: { status: AttemptStatus.CANCELLED },
      });
    } finally {
      await host?.stop();
      await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('keeps terminal and scope outcomes local and reports a missing current owner without a fallback write', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'wharfie-owner-cancel-'));
    const configuration = createConfiguration(root, 'owner-cancel-outcomes');
    const appId = 'owner-cancel-demo';
    const { db, ledger } = createLedger(configuration);
    try {
      const completedRunId = await seedCompletedManualRun(ledger, {
        appId,
        idempotencyKey: 'completed-run',
      });
      const completedBefore = await ledger.rebuildRun(completedRunId);

      await expect(
        externalCancellationResult({
          runId: completedRunId,
          requestId: 'cancel-completed-run',
          configuration,
        }),
      ).resolves.toEqual({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.cancel',
        runId: completedRunId,
        requestId: 'cancel-completed-run',
        outcome: 'terminal-authoritative',
        delivery: 'not-required',
        runStatus: RunStatus.COMPLETED,
        invocationStatus: InvocationStatus.COMPLETED,
      });
      await expect(
        cancelFromExternalProcess({
          runId: completedRunId,
          requestId: 'cancel-cross-app',
          expectedAppId: 'another-application',
          configuration,
        }),
      ).resolves.toEqual({
        ok: false,
        error: expect.objectContaining({
          name: 'ExecutionLedgerOperatorScopeError',
          runId: completedRunId,
          expectedAppId: 'another-application',
        }),
      });
      await expect(ledger.rebuildRun(completedRunId)).resolves.toEqual(
        completedBefore,
      );

      const unownedRunId = await seedRunnableManualRun(ledger, {
        appId,
        idempotencyKey: 'unowned-run',
      });
      const unownedBefore = await ledger.rebuildRun(unownedRunId);
      await expect(
        externalCancellationResult({
          runId: unownedRunId,
          requestId: 'cancel-unowned-run',
          configuration,
        }),
      ).resolves.toEqual({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.cancel',
        runId: unownedRunId,
        requestId: 'cancel-unowned-run',
        outcome: 'owner-unreachable',
        delivery: 'not-delivered',
        runStatus: RunStatus.RUNNING,
        invocationStatus: InvocationStatus.RUNNABLE,
      });
      await expect(ledger.rebuildRun(unownedRunId)).resolves.toEqual(
        unownedBefore,
      );
    } finally {
      await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
