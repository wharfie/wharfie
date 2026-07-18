/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  ManualLedgerRecoveryAction,
  createManualLedgerRunId,
  recoverManualLedgerActivity,
  runManualLedgerActivity,
} from '../../src/core/runtime/manual-ledger-run.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;

/**
 * @param {Readonly<Record<string, any>>} start - Exact host start frame.
 * @param {any} [result] - Completed activity result.
 * @returns {Record<string, any>} - Valid completed evidence.
 */
function completedEvidence(start, result = { ok: true }) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result,
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
 * @param {Readonly<Record<string, any>>} start - Exact host start frame.
 * @returns {Record<string, any>} - Valid failed evidence.
 */
function failedEvidence(start) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'failed',
    attemptId: start.attemptId,
    sequence: 1,
    error: {
      code: 'application-failed',
      name: 'ApplicationFailure',
      message: 'expected activity failure',
      details: { source: 'test' },
    },
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
 * @param {Readonly<Record<string, any>>} start - Exact host start frame.
 * @param {Record<string, any>} reason - Exact durable cancellation reason.
 * @returns {Record<string, any>} - Valid cancelled evidence.
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
 * @param {Readonly<Record<string, any>>} start - Exact host start frame.
 * @param {Record<string, any>} reason - Exact durable cancellation reason.
 * @returns {Record<string, any>} - Evidence whose post-cancel outcome is ambiguous.
 */
function ambiguousCancellationEvidence(start, reason) {
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
    type: 'protocol-failed',
    attemptId: start.attemptId,
    sequence: 1,
    error: {
      code: 'termination-failed',
      name: 'ActivityAttemptProtocolError',
      message: 'The adapter could not prove that cancellation stopped work.',
      details: {},
    },
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
 * @param {AbortSignal} signal - Attempt cancellation signal.
 * @returns {Promise<void>} - Resolves once cancellation reaches the attempt.
 */
async function waitForAbort(signal) {
  if (signal.aborted) return;
  await new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(undefined), { once: true });
  });
}

/**
 * @returns {{promise: Promise<void>, resolve: () => void}} - Externally resolvable test gate.
 */
function createDeferred() {
  /** @type {() => void} */
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, resolve: release };
}

/**
 * @returns {Error} - Structured foreground cancellation reason.
 */
function foregroundCancellationReason() {
  const reason = new Error('The foreground operator requested cancellation.');
  reason.name = 'CancellationRequested';
  Object.assign(reason, {
    code: 'operator-cancel-requested',
    details: { signal: 'SIGINT', secret: 'must-stay-durable-only' },
  });
  return reason;
}

function createClock() {
  let time = 1_700_000_000_000;
  return () => {
    time += 1;
    return time;
  };
}

/**
 * @param {string} directory - Isolated local control root.
 * @returns {ReturnType<typeof createLocalExecutionPayloadStore>} - Matching immutable payload store.
 */
function createPayloadStore(directory) {
  return createLocalExecutionPayloadStore({
    path: join(directory, 'execution-payloads'),
    storeId: 'manual-ledger-test',
  });
}

/**
 * @param {(ledger: import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore) => Promise<void>} test - Isolated ledger test body.
 * @returns {Promise<void>} - Resolves after cleanup.
 */
async function withLedger(test) {
  const directory = mkdtempSync(join(tmpdir(), 'wharfie-manual-ledger-'));
  const db = createVanillaDB({ path: directory });
  const ledger = createExecutionLedger({
    db,
    tableName: 'manual-ledger-test',
    payloadStore: createPayloadStore(directory),
    now: createClock(),
  });
  try {
    await test(ledger);
  } finally {
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * @param {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger - Test ledger.
 * @param {Record<string, any>} [overrides] - Per-test runner options.
 * @returns {any} - Bound runner options.
 */
function runOptions(ledger, overrides = {}) {
  const appId = 'manual-demo';
  const idempotencyKey = 'operator-run-1';
  return {
    ledger,
    appId,
    revisionId: REVISION_ID,
    activityId: 'work',
    runId: createManualLedgerRunId({ appId, idempotencyKey }),
    input: { who: 'Ada' },
    callerMetadata: { requestId: 'manual-request' },
    createFencingToken: () => 'local-test-fence',
    executeAttempt: async (
      /** @type {Readonly<Record<string, any>>} */ startFrame,
    ) => completedEvidence(startFrame),
    ...overrides,
  };
}

describe('manual ledger activity runner', () => {
  it('derives manual run identity from the v7 idempotency-key contract', () => {
    const appId = 'manual-demo';
    const idempotencyKey = 'operator-run-1';
    expect(createManualLedgerRunId({ appId, idempotencyKey })).toBe(
      createCanonicalJsonSha256Id({
        domain: 'wharfie:manual-ledger-run:v7',
        prefix: 'wlm',
        value: { appId, idempotencyKey },
        valuePath: 'manual ledger run identity',
      }),
    );
    expect(() =>
      createManualLedgerRunId(
        /** @type {any} */ ({ appId, operationId: idempotencyKey }),
      ),
    ).toThrow(/idempotencyKey/i);
  });

  it('persists the exact durable start before dispatch and deduplicates a terminal retry', async () => {
    await withLedger(async (ledger) => {
      /** @type {Readonly<Record<string, any>>[]} */
      const starts = [];
      const first = await runManualLedgerActivity(
        runOptions(ledger, {
          executeAttempt: async (
            /** @type {Readonly<Record<string, any>>} */ startFrame,
          ) => {
            starts.push(startFrame);
            return completedEvidence(startFrame, { greeting: 'hello Ada' });
          },
        }),
      );

      expect(first).toMatchObject({
        disposition: 'completed',
        reused: false,
        run: { status: RunStatus.COMPLETED, version: 4 },
        invocation: {
          status: InvocationStatus.COMPLETED,
          generation: 1,
        },
        attempt: { status: AttemptStatus.COMPLETED, generation: 1 },
        terminalSummary: { type: 'completed' },
        evidenceRef: {
          payloadSchema: 'wharfie.execution.activity-evidence.v1',
        },
      });
      expect(starts).toHaveLength(1);
      expect(starts[0]).toMatchObject({
        runId: first.run.runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        attemptId: first.attempt?.attemptId,
        fencingToken: 'local-test-fence',
        input: { who: 'Ada' },
        caller: { metadata: { requestId: 'manual-request' } },
      });

      const retry = await runManualLedgerActivity(
        runOptions(ledger, {
          executeAttempt: async () => {
            throw new Error('terminal work must not run again');
          },
        }),
      );
      expect(retry).toMatchObject({ disposition: 'completed', reused: true });
      expect(starts).toHaveLength(1);

      const events = await ledger.getEvents(first.run.runId);
      expect(
        events.map((/** @type {Record<string, any>} */ event) => event.type),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-started',
        'attempt-terminal',
      ]);
    });
  });

  it('prepares only after a fresh claim and awaits release after the durable terminal', async () => {
    await withLedger(async (ledger) => {
      /** @type {string[]} */
      const order = [];
      const entered = createDeferred();
      const gated = createDeferred();
      const observingLedger = {
        ...ledger,
        markAttemptStarted: async (
          /** @type {Parameters<typeof ledger.markAttemptStarted>[0]} */ options,
        ) => {
          order.push('start');
          return await ledger.markAttemptStarted(options);
        },
        commitVerifiedAttemptTerminal: async (
          /** @type {Parameters<typeof ledger.commitVerifiedAttemptTerminal>[0]} */ options,
        ) => {
          order.push('terminal');
          return await ledger.commitVerifiedAttemptTerminal(options);
        },
      };

      const options = runOptions(observingLedger, {
        executeAttempt: undefined,
        prepareAttemptDispatch: async (
          /** @type {Readonly<{runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number}>} */ context,
        ) => {
          order.push('prepare');
          expect(Object.isFrozen(context)).toBe(true);
          expect(context).toEqual({
            runId: expect.stringMatching(/^wlm_/),
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            attemptId: expect.any(String),
            fencingToken: 'local-test-fence',
            generation: 1,
          });
          const claimed = await ledger.rebuildRun(context.runId);
          expect(claimed?.attempts).toEqual([
            expect.objectContaining({
              attemptId: context.attemptId,
              status: AttemptStatus.CLAIMED,
            }),
          ]);
          return {
            executeAttempt: async (
              /** @type {Readonly<Record<string, any>>} */ startFrame,
            ) => {
              order.push('execute');
              const started = await ledger.rebuildRun(context.runId);
              expect(started?.attempts).toEqual([
                expect.objectContaining({ status: AttemptStatus.STARTED }),
              ]);
              return completedEvidence(startFrame);
            },
            release: async () => {
              order.push('release-entered');
              const terminal = await ledger.rebuildRun(context.runId);
              expect(terminal?.run.status).toBe(RunStatus.COMPLETED);
              entered.resolve();
              await gated.promise;
              order.push('release-finished');
            },
          };
        },
      });
      let settled = false;
      const resultPromise = runManualLedgerActivity(options);
      resultPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await entered.promise;
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(order).toEqual([
        'prepare',
        'start',
        'execute',
        'terminal',
        'release-entered',
      ]);
      gated.resolve();

      await expect(resultPromise).resolves.toMatchObject({
        disposition: 'completed',
        attempt: { status: AttemptStatus.COMPLETED },
      });
      expect(order).toEqual([
        'prepare',
        'start',
        'execute',
        'terminal',
        'release-entered',
        'release-finished',
      ]);
    });
  });

  it('cancels and releases a fresh claim when the signal aborts during preparation', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const entered = createDeferred();
      const continuePreparation = createDeferred();
      let executions = 0;
      let releases = 0;
      const options = runOptions(ledger, {
        executeAttempt: undefined,
        signal: controller.signal,
        prepareAttemptDispatch: async (
          /** @type {Readonly<{runId: string}>} */ context,
        ) => {
          entered.resolve();
          await continuePreparation.promise;
          return {
            executeAttempt: async () => {
              executions += 1;
              throw new Error('cancelled preparation must not dispatch');
            },
            release: async () => {
              releases += 1;
              const view = await ledger.rebuildRun(context.runId);
              expect(view).toMatchObject({
                run: { status: RunStatus.CANCELLED },
                invocations: [{ status: InvocationStatus.CANCELLED }],
                attempts: [{ status: AttemptStatus.CANCELLED }],
              });
            },
          };
        },
      });
      const resultPromise = runManualLedgerActivity(options);

      await entered.promise;
      const claimed = await ledger.rebuildRun(options.runId);
      expect(claimed?.attempts).toEqual([
        expect.objectContaining({ status: AttemptStatus.CLAIMED }),
      ]);
      controller.abort(foregroundCancellationReason());
      continuePreparation.resolve();

      await expect(resultPromise).resolves.toMatchObject({
        disposition: 'failed',
        run: { status: RunStatus.CANCELLED },
        invocation: { status: InvocationStatus.CANCELLED },
        attempt: { status: AttemptStatus.CANCELLED },
      });
      expect(executions).toBe(0);
      expect(releases).toBe(1);
      expect(
        (await ledger.getEvents(options.runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'manual-cancellation-requested',
      ]);
    });
  });

  it('does not let a stale preparation abort cancel a recovered successor generation', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const entered = createDeferred();
      const continuePreparation = createDeferred();
      let executions = 0;
      let releases = 0;
      const options = runOptions(ledger, {
        executeAttempt: undefined,
        signal: controller.signal,
        prepareAttemptDispatch: async () => {
          entered.resolve();
          await continuePreparation.promise;
          return {
            executeAttempt: async () => {
              executions += 1;
              throw new Error('stale preparation must not dispatch');
            },
            release: async () => {
              releases += 1;
              const view = await ledger.rebuildRun(options.runId);
              expect(view).toMatchObject({
                run: { status: RunStatus.RUNNING },
                invocations: [
                  { status: InvocationStatus.RUNNING, generation: 2 },
                ],
                attempts: expect.arrayContaining([
                  expect.objectContaining({
                    status: AttemptStatus.CLAIMED,
                    generation: 2,
                    fencingToken: 'replacement-preparation-fence',
                  }),
                ]),
              });
              expect(view?.run.cancellationRequest).toBeUndefined();
            },
          };
        },
      });
      const staleResultPromise = runManualLedgerActivity(options);

      await entered.promise;
      const recovery = await recoverManualLedgerActivity({
        ledger,
        runId: options.runId,
      });
      expect(recovery).toMatchObject({
        found: true,
        mayExecute: true,
        action: ManualLedgerRecoveryAction.RELEASED_UNSTARTED_CLAIM,
        changed: true,
      });
      if (!recovery.outcome) throw new Error('Expected recovered run outcome');
      const replacement = await ledger.claimInvocation({
        runId: options.runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        fencingToken: 'replacement-preparation-fence',
        expectedGeneration: recovery.outcome.invocation.generation,
        expectedVersion: recovery.outcome.run.version,
        transitionId: 'replacement-claim:2',
        actor: { kind: 'local', id: 'replacement' },
        coordinatorEpoch: 0,
      });
      expect(replacement).toMatchObject({
        applied: true,
        attempt: {
          status: AttemptStatus.CLAIMED,
          generation: 2,
          fencingToken: 'replacement-preparation-fence',
        },
      });

      controller.abort(foregroundCancellationReason());
      continuePreparation.resolve();

      await expect(staleResultPromise).resolves.toMatchObject({
        disposition: 'in-progress',
        run: { status: RunStatus.RUNNING },
        invocation: { status: InvocationStatus.RUNNING, generation: 2 },
        attempt: {
          status: AttemptStatus.CLAIMED,
          generation: 2,
          fencingToken: 'replacement-preparation-fence',
        },
      });
      expect(executions).toBe(0);
      expect(releases).toBe(1);
      expect(
        (await ledger.getEvents(options.runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-abandoned-before-start',
        'attempt-claimed',
      ]);
    });
  });

  it('does not let a stale preparation abort cancel its recovered abandoned claim', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const entered = createDeferred();
      const continuePreparation = createDeferred();
      let releases = 0;
      const options = runOptions(ledger, {
        executeAttempt: undefined,
        signal: controller.signal,
        prepareAttemptDispatch: async () => {
          entered.resolve();
          await continuePreparation.promise;
          return {
            executeAttempt: async () => {
              throw new Error('recovered preparation must not dispatch');
            },
            release: () => {
              releases += 1;
            },
          };
        },
      });
      const staleResultPromise = runManualLedgerActivity(options);

      await entered.promise;
      await expect(
        recoverManualLedgerActivity({ ledger, runId: options.runId }),
      ).resolves.toMatchObject({
        found: true,
        mayExecute: true,
        action: ManualLedgerRecoveryAction.RELEASED_UNSTARTED_CLAIM,
        changed: true,
      });
      controller.abort(foregroundCancellationReason());
      continuePreparation.resolve();

      const staleResult = await staleResultPromise;
      expect(staleResult).toMatchObject({
        disposition: 'in-progress',
        run: { status: RunStatus.RUNNING },
        invocation: { status: InvocationStatus.RUNNABLE, generation: 1 },
        attempt: { status: AttemptStatus.ABANDONED, generation: 1 },
      });
      expect(staleResult.run.cancellationRequest).toBeUndefined();
      expect(releases).toBe(1);
      expect(
        (await ledger.getEvents(options.runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-abandoned-before-start',
      ]);
    });
  });

  it('keeps cancellation authoritative when preparation rejects after an abort', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const entered = createDeferred();
      const continuePreparation = createDeferred();
      const preparationError = new Error('application store open failed');
      const options = runOptions(ledger, {
        executeAttempt: undefined,
        signal: controller.signal,
        prepareAttemptDispatch: async () => {
          entered.resolve();
          await continuePreparation.promise;
          throw preparationError;
        },
      });
      const resultPromise = runManualLedgerActivity(options);

      await entered.promise;
      controller.abort(foregroundCancellationReason());
      continuePreparation.resolve();

      await expect(resultPromise).resolves.toMatchObject({
        disposition: 'failed',
        run: { status: RunStatus.CANCELLED },
        invocation: { status: InvocationStatus.CANCELLED },
        attempt: { status: AttemptStatus.CANCELLED },
      });
      expect(
        (await ledger.getEvents(options.runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'manual-cancellation-requested',
      ]);
    });
  });

  it('cancels malformed preparation after an abort and releases its salvaged disposer', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const entered = createDeferred();
      const continuePreparation = createDeferred();
      let releases = 0;
      const options = runOptions(ledger, {
        executeAttempt: undefined,
        signal: controller.signal,
        prepareAttemptDispatch: async () => {
          entered.resolve();
          await continuePreparation.promise;
          return {
            executeAttempt: async () => {
              throw new Error('malformed preparation must not dispatch');
            },
            release: async () => {
              releases += 1;
              expect(await ledger.rebuildRun(options.runId)).toMatchObject({
                run: { status: RunStatus.CANCELLED },
                invocations: [{ status: InvocationStatus.CANCELLED }],
                attempts: [{ status: AttemptStatus.CANCELLED }],
              });
            },
            extra: true,
          };
        },
      });
      const resultPromise = runManualLedgerActivity(options);

      await entered.promise;
      controller.abort(foregroundCancellationReason());
      continuePreparation.resolve();

      await expect(resultPromise).resolves.toMatchObject({
        disposition: 'failed',
        run: { status: RunStatus.CANCELLED },
        attempt: { status: AttemptStatus.CANCELLED },
      });
      expect(releases).toBe(1);
      expect(
        (await ledger.getEvents(options.runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'manual-cancellation-requested',
      ]);
    });
  });

  it('preserves preparation and cancellation failures when abort persistence fails', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const entered = createDeferred();
      const continuePreparation = createDeferred();
      const preparationError = new Error('application store open failed');
      const cancellationError = new Error('control store unavailable');
      const failingLedger = {
        ...ledger,
        requestManualRunCancellation: async () => {
          throw cancellationError;
        },
      };
      const options = runOptions(failingLedger, {
        executeAttempt: undefined,
        signal: controller.signal,
        prepareAttemptDispatch: async () => {
          entered.resolve();
          await continuePreparation.promise;
          throw preparationError;
        },
      });
      const resultPromise = runManualLedgerActivity(options);

      await entered.promise;
      controller.abort(foregroundCancellationReason());
      continuePreparation.resolve();

      /** @type {unknown} */
      let reported;
      try {
        await resultPromise;
      } catch (error) {
        reported = error;
      }
      expect(reported).toBeInstanceOf(AggregateError);
      expect(/** @type {AggregateError} */ (reported).errors).toEqual([
        preparationError,
        cancellationError,
      ]);
      expect(await ledger.rebuildRun(options.runId)).toMatchObject({
        run: { status: RunStatus.RUNNING },
        invocations: [{ status: InvocationStatus.RUNNABLE }],
        attempts: [{ status: AttemptStatus.ABANDONED }],
      });
    });
  });

  it('never prepares resources for retained terminal, running, or uncertain state', async () => {
    await withLedger(async (ledger) => {
      let preparations = 0;
      const retainedDispatch = {
        executeAttempt: undefined,
        prepareAttemptDispatch: async () => {
          preparations += 1;
          throw new Error('retained state must not acquire dispatch resources');
        },
      };

      const terminalOptions = runOptions(ledger);
      await runManualLedgerActivity(terminalOptions);
      await expect(
        runManualLedgerActivity({ ...terminalOptions, ...retainedDispatch }),
      ).resolves.toMatchObject({
        disposition: 'completed',
        reused: true,
      });

      const uncertainOptions = runOptions(ledger, {
        runId: createManualLedgerRunId({
          appId: 'manual-demo',
          idempotencyKey: 'operator-run-uncertain',
        }),
        executeAttempt: async () => {
          throw new Error('physical outcome lost');
        },
      });
      await runManualLedgerActivity(uncertainOptions);
      await expect(
        runManualLedgerActivity({ ...uncertainOptions, ...retainedDispatch }),
      ).resolves.toMatchObject({ disposition: 'blocked', reused: true });

      const runningOptions = runOptions(ledger, {
        runId: createManualLedgerRunId({
          appId: 'manual-demo',
          idempotencyKey: 'operator-run-running',
        }),
      });
      await ledger.createManualRun({
        runId: runningOptions.runId,
        appId: runningOptions.appId,
        revisionId: runningOptions.revisionId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        activityId: runningOptions.activityId,
        input: runningOptions.input,
        callerMetadata: runningOptions.callerMetadata,
        transitionId: 'create',
        actor: { kind: 'local', id: 'cli' },
        coordinatorEpoch: 0,
      });
      await ledger.claimInvocation({
        runId: runningOptions.runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        fencingToken: 'retained-running-fence',
        expectedGeneration: 0,
        expectedVersion: 1,
        transitionId: 'claim:1',
        actor: { kind: 'local', id: 'test' },
      });
      await expect(
        runManualLedgerActivity({ ...runningOptions, ...retainedDispatch }),
      ).resolves.toMatchObject({
        disposition: 'in-progress',
        attempt: { status: AttemptStatus.CLAIMED },
      });

      expect(preparations).toBe(0);
    });
  });

  it('abandons a failed preparation before start and allows a fresh retry', async () => {
    await withLedger(async (ledger) => {
      const options = runOptions(ledger, {
        executeAttempt: undefined,
        prepareAttemptDispatch: async () => {
          throw new Error('application resources unavailable');
        },
      });
      await expect(runManualLedgerActivity(options)).rejects.toThrow(
        /application resources unavailable/i,
      );

      const failedView = await ledger.rebuildRun(options.runId);
      expect(failedView).toMatchObject({
        run: { status: RunStatus.RUNNING, version: 3 },
        invocations: [{ status: InvocationStatus.RUNNABLE, generation: 1 }],
        attempts: [{ status: AttemptStatus.ABANDONED, generation: 1 }],
      });
      expect(
        failedView?.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-abandoned-before-start',
      ]);

      const retry = await runManualLedgerActivity({
        ...options,
        createFencingToken: () => 'local-retry-fence',
        prepareAttemptDispatch: async () => ({
          executeAttempt: async (startFrame) =>
            completedEvidence(startFrame, { retried: true }),
          release: () => {},
        }),
      });
      expect(retry).toMatchObject({
        disposition: 'completed',
        invocation: { generation: 2 },
        attempt: {
          status: AttemptStatus.COMPLETED,
          generation: 2,
          fencingToken: 'local-retry-fence',
        },
      });
    });
  });

  it('releases prepared resources after dispatch uncertainty and cancellation cleanup', async () => {
    await withLedger(async (ledger) => {
      /** @type {string[]} */
      const order = [];
      const options = runOptions(ledger, {
        executeAttempt: undefined,
        registerActiveAttemptCancellationPort: () => {
          order.push('register');
          return () => {
            order.push('unregister');
          };
        },
        prepareAttemptDispatch: async (
          /** @type {Readonly<{runId: string}>} */ context,
        ) => ({
          executeAttempt: async () => {
            order.push('execute');
            throw new Error('worker transport failed');
          },
          release: async () => {
            order.push('release');
            const view = await ledger.rebuildRun(context.runId);
            expect(view).toMatchObject({
              run: { status: RunStatus.BLOCKED },
              invocations: [{ status: InvocationStatus.UNCERTAIN }],
              attempts: [{ status: AttemptStatus.ABANDONED }],
            });
          },
        }),
      });

      await expect(runManualLedgerActivity(options)).resolves.toMatchObject({
        disposition: 'blocked',
        run: { status: RunStatus.BLOCKED },
      });
      expect(order).toEqual(['register', 'execute', 'unregister', 'release']);
    });
  });

  it('finishes every cleanup and reports failures after a durable terminal', async () => {
    await withLedger(async (ledger) => {
      /** @type {string[]} */
      const order = [];
      const removeError = new Error('listener removal failed');
      const unregisterError = new Error('port unregister failed');
      const releaseError = new Error('dispatch release failed');
      let releases = 0;
      const signal = {
        aborted: false,
        addEventListener: () => {
          order.push('listen');
        },
        removeEventListener: () => {
          order.push('remove-listener');
          throw removeError;
        },
      };
      const options = runOptions(ledger, {
        executeAttempt: undefined,
        signal,
        registerActiveAttemptCancellationPort: () => {
          order.push('register');
          return () => {
            order.push('unregister');
            throw unregisterError;
          };
        },
        prepareAttemptDispatch: async () => ({
          executeAttempt: async (
            /** @type {Readonly<Record<string, any>>} */ startFrame,
          ) => {
            order.push('execute');
            return completedEvidence(startFrame);
          },
          release: async () => {
            releases += 1;
            order.push('release');
            throw releaseError;
          },
        }),
      });

      /** @type {unknown} */
      let reported;
      try {
        await runManualLedgerActivity(options);
      } catch (error) {
        reported = error;
      }
      expect(reported).toBeInstanceOf(AggregateError);
      expect(/** @type {AggregateError} */ (reported).errors).toEqual([
        removeError,
        unregisterError,
        releaseError,
      ]);
      expect(order).toEqual([
        'register',
        'listen',
        'execute',
        'remove-listener',
        'unregister',
        'release',
      ]);
      expect(releases).toBe(1);
      expect(await ledger.rebuildRun(options.runId)).toMatchObject({
        run: { status: RunStatus.COMPLETED },
        invocations: [{ status: InvocationStatus.COMPLETED }],
        attempts: [{ status: AttemptStatus.COMPLETED }],
      });

      await expect(
        runManualLedgerActivity(
          runOptions(ledger, {
            executeAttempt: async () => {
              throw new Error('retained terminal must not dispatch');
            },
          }),
        ),
      ).resolves.toMatchObject({ disposition: 'completed', reused: true });
      expect(releases).toBe(1);
    });
  });

  it('rejects ambiguous dispatch options and exact-shape preparation violations', async () => {
    await withLedger(async (ledger) => {
      const both = runOptions(ledger, {
        prepareAttemptDispatch: async () => ({
          executeAttempt: async () => ({}),
          release: () => {},
        }),
      });
      await expect(runManualLedgerActivity(both)).rejects.toThrow(
        /exactly one of executeAttempt or prepareAttemptDispatch/i,
      );
      const neither = runOptions(ledger, { executeAttempt: undefined });
      await expect(runManualLedgerActivity(neither)).rejects.toThrow(
        /exactly one of executeAttempt or prepareAttemptDispatch/i,
      );
      expect(await ledger.getEvents(both.runId)).toEqual([]);

      let salvagedReleases = 0;
      const salvagedReleaseError = new Error('salvaged release failed');
      const malformed = runOptions(ledger, {
        runId: createManualLedgerRunId({
          appId: 'manual-demo',
          idempotencyKey: 'invalid-preparation-extra-key',
        }),
        executeAttempt: undefined,
        prepareAttemptDispatch: async () => ({
          executeAttempt: async () => ({}),
          release: () => {
            salvagedReleases += 1;
            throw salvagedReleaseError;
          },
          extra: true,
        }),
      });
      /** @type {unknown} */
      let malformedError;
      try {
        await runManualLedgerActivity(malformed);
      } catch (error) {
        malformedError = error;
      }
      expect(malformedError).toBeInstanceOf(AggregateError);
      const malformedErrors = /** @type {AggregateError} */ (malformedError)
        .errors;
      expect(malformedErrors).toHaveLength(2);
      expect(malformedErrors[0]).toBeInstanceOf(TypeError);
      expect(/** @type {Error} */ (malformedErrors[0]).message).toMatch(
        /prepareAttemptDispatch/i,
      );
      expect(malformedErrors[1]).toBe(salvagedReleaseError);
      expect(salvagedReleases).toBe(1);
      expect(await ledger.rebuildRun(malformed.runId)).toMatchObject({
        run: { status: RunStatus.RUNNING },
        invocations: [{ status: InvocationStatus.RUNNABLE }],
        attempts: [{ status: AttemptStatus.ABANDONED }],
      });

      const invalidResults = [
        null,
        { executeAttempt: 'not-a-function', release: () => {} },
        { executeAttempt: async () => ({}), release: 'not-a-function' },
      ];
      for (const [index, invalidResult] of invalidResults.entries()) {
        const options = runOptions(ledger, {
          runId: createManualLedgerRunId({
            appId: 'manual-demo',
            idempotencyKey: `invalid-preparation-${index}`,
          }),
          executeAttempt: undefined,
          prepareAttemptDispatch: async () => invalidResult,
        });
        await expect(runManualLedgerActivity(options)).rejects.toThrow(
          /prepareAttemptDispatch/i,
        );
        const view = await ledger.rebuildRun(options.runId);
        expect(view).toMatchObject({
          run: { status: RunStatus.RUNNING },
          invocations: [{ status: InvocationStatus.RUNNABLE }],
          attempts: [{ status: AttemptStatus.ABANDONED }],
        });
        expect(
          view?.events.some(
            (/** @type {Record<string, any>} */ event) =>
              event.type === 'attempt-started',
          ),
        ).toBe(false);
      }
    });
  });

  it('cancels runnable work durably without inventing a physical attempt', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      controller.abort(foregroundCancellationReason());
      let dispatches = 0;

      const result = await runManualLedgerActivity(
        runOptions(ledger, {
          signal: controller.signal,
          executeAttempt: async () => {
            dispatches += 1;
            throw new Error('cancelled runnable work must not dispatch');
          },
        }),
      );

      expect(dispatches).toBe(0);
      expect(result).toMatchObject({
        disposition: 'failed',
        reused: false,
        run: {
          status: RunStatus.CANCELLED,
          version: 2,
          cancellationRequest: {
            reason: {
              code: 'operator-cancel-requested',
              name: 'CancellationRequested',
              details: {
                signal: 'SIGINT',
                secret: 'must-stay-durable-only',
              },
            },
          },
        },
        invocation: {
          status: InvocationStatus.CANCELLED,
          generation: 0,
        },
      });
      expect(result.attempt).toBeUndefined();
      expect(
        (await ledger.getEvents(result.run.runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual(['manual-run-created', 'manual-cancellation-requested']);

      const retry = await runManualLedgerActivity(
        runOptions(ledger, {
          executeAttempt: async () => {
            throw new Error('a cancelled run must remain terminal');
          },
        }),
      );
      expect(retry).toMatchObject({
        disposition: 'failed',
        reused: true,
        run: { status: RunStatus.CANCELLED },
        invocation: { status: InvocationStatus.CANCELLED, generation: 0 },
      });
      expect(retry.attempt).toBeUndefined();
    });
  });

  it('cancels a claimed attempt before durable start without dispatching it', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const cancellingLedger = {
        ...ledger,
        claimInvocation: async (
          /** @type {Parameters<typeof ledger.claimInvocation>[0]} */ options,
        ) => {
          const claimed = await ledger.claimInvocation(options);
          controller.abort(foregroundCancellationReason());
          return claimed;
        },
      };
      let dispatches = 0;

      const result = await runManualLedgerActivity(
        runOptions(cancellingLedger, {
          signal: controller.signal,
          executeAttempt: async () => {
            dispatches += 1;
            throw new Error('cancelled claimed work must not dispatch');
          },
        }),
      );

      expect(dispatches).toBe(0);
      expect(result).toMatchObject({
        disposition: 'failed',
        run: { status: RunStatus.CANCELLED, version: 3 },
        invocation: { status: InvocationStatus.CANCELLED, generation: 1 },
        attempt: {
          status: AttemptStatus.CANCELLED,
          generation: 1,
        },
      });
      expect(result.attempt).not.toHaveProperty('startedAt');
      expect(
        (await ledger.getEvents(result.run.runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'manual-cancellation-requested',
      ]);
    });
  });

  it('persists a started cancellation before signalling the physical attempt', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const options = runOptions(ledger);
      let durableRequestObservedBeforeSignal = false;

      const result = await runManualLedgerActivity({
        ...options,
        signal: controller.signal,
        executeAttempt: async (startFrame, { signal }) => {
          controller.abort(foregroundCancellationReason());
          await waitForAbort(signal);
          const durable = await ledger.rebuildRun(options.runId);
          durableRequestObservedBeforeSignal =
            durable?.events.at(-1)?.type === 'manual-cancellation-requested';
          expect(durable?.run.cancellationRequest?.reason).toEqual(
            signal.reason,
          );
          return cancelledEvidence(startFrame, signal.reason);
        },
      });

      expect(durableRequestObservedBeforeSignal).toBe(true);
      expect(result).toMatchObject({
        disposition: 'failed',
        run: {
          status: RunStatus.CANCELLED,
          version: 5,
          cancellationRequest: {
            reason: { code: 'operator-cancel-requested' },
          },
        },
        invocation: { status: InvocationStatus.CANCELLED, generation: 1 },
        attempt: {
          status: AttemptStatus.CANCELLED,
          generation: 1,
          terminal: { type: 'cancelled' },
        },
      });
      expect(
        (await ledger.getEvents(result.run.runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-started',
        'manual-cancellation-requested',
        'attempt-terminal',
      ]);
    });
  });

  it('allows completed evidence to win after a started cancellation request', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const result = await runManualLedgerActivity(
        runOptions(ledger, {
          signal: controller.signal,
          executeAttempt: async (
            /** @type {Readonly<Record<string, any>>} */ startFrame,
            /** @type {{signal: AbortSignal}} */ { signal },
          ) => {
            controller.abort(foregroundCancellationReason());
            await waitForAbort(signal);
            return completedEvidence(startFrame, { wonRace: true });
          },
        }),
      );

      expect(result).toMatchObject({
        disposition: 'completed',
        run: {
          status: RunStatus.COMPLETED,
          version: 5,
          cancellationRequest: {
            reason: { code: 'operator-cancel-requested' },
          },
        },
        invocation: { status: InvocationStatus.COMPLETED },
        attempt: {
          status: AttemptStatus.COMPLETED,
          terminal: { type: 'completed' },
        },
      });
    });
  });

  it('does not signal a started attempt when the durable request cannot be written', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      /** @type {() => void} */
      let observeRequest = () => {};
      const requestObserved = new Promise((resolve) => {
        observeRequest = () => resolve(undefined);
      });
      const rejectingLedger = {
        ...ledger,
        requestManualRunCancellation: async () => {
          observeRequest();
          throw new Error('durable cancellation store unavailable');
        },
      };
      let physicalSignalAborted = false;

      const result = await runManualLedgerActivity(
        runOptions(rejectingLedger, {
          signal: controller.signal,
          executeAttempt: async (
            /** @type {Readonly<Record<string, any>>} */ startFrame,
            /** @type {{signal: AbortSignal}} */ { signal },
          ) => {
            controller.abort(foregroundCancellationReason());
            await requestObserved;
            await Promise.resolve();
            physicalSignalAborted = signal.aborted;
            return completedEvidence(startFrame, { keptRunning: true });
          },
        }),
      );

      expect(physicalSignalAborted).toBe(false);
      expect(result).toMatchObject({
        disposition: 'completed',
        run: { status: RunStatus.COMPLETED, version: 4 },
        invocation: { status: InvocationStatus.COMPLETED },
        attempt: { status: AttemptStatus.COMPLETED },
      });
      expect(result.run.cancellationRequest).toBeUndefined();
    });
  });

  it('recovers a runnable cancellation whose durable response was lost', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      controller.abort(foregroundCancellationReason());
      const responseLostLedger = {
        ...ledger,
        requestManualRunCancellation: async (
          /** @type {Parameters<typeof ledger.requestManualRunCancellation>[0]} */ options,
        ) => {
          await ledger.requestManualRunCancellation(options);
          throw new Error('cancellation response was lost');
        },
      };
      let dispatches = 0;

      const result = await runManualLedgerActivity(
        runOptions(responseLostLedger, {
          signal: controller.signal,
          executeAttempt: async () => {
            dispatches += 1;
            throw new Error(
              'durably cancelled runnable work must not dispatch',
            );
          },
        }),
      );

      expect(dispatches).toBe(0);
      expect(result).toMatchObject({
        disposition: 'failed',
        run: {
          status: RunStatus.CANCELLED,
          cancellationRequest: {
            reason: { code: 'operator-cancel-requested' },
          },
        },
        invocation: {
          status: InvocationStatus.CANCELLED,
          generation: 0,
        },
      });
      expect(result.attempt).toBeUndefined();
    });
  });

  it('signals the exact started attempt after verifying a lost cancellation response', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const responseLostLedger = {
        ...ledger,
        requestManualRunCancellation: async (
          /** @type {Parameters<typeof ledger.requestManualRunCancellation>[0]} */ options,
        ) => {
          await ledger.requestManualRunCancellation(options);
          throw new Error('cancellation response was lost');
        },
      };
      let durableRequestObservedBeforeSignal = false;

      const result = await runManualLedgerActivity(
        runOptions(responseLostLedger, {
          signal: controller.signal,
          executeAttempt: async (
            /** @type {Readonly<Record<string, any>>} */ startFrame,
            /** @type {{signal: AbortSignal}} */ { signal },
          ) => {
            controller.abort(foregroundCancellationReason());
            await waitForAbort(signal);
            const durable = await ledger.rebuildRun(
              createManualLedgerRunId({
                appId: 'manual-demo',
                idempotencyKey: 'operator-run-1',
              }),
            );
            durableRequestObservedBeforeSignal =
              durable?.run.cancellationRequest?.requestId ===
              `cancel:${startFrame.runId}`;
            expect(signal.reason).toEqual(
              durable?.run.cancellationRequest?.reason,
            );
            return cancelledEvidence(startFrame, signal.reason);
          },
        }),
      );

      expect(durableRequestObservedBeforeSignal).toBe(true);
      expect(result).toMatchObject({
        disposition: 'failed',
        run: { status: RunStatus.CANCELLED },
        invocation: { status: InvocationStatus.CANCELLED },
        attempt: {
          status: AttemptStatus.CANCELLED,
          terminal: { type: 'cancelled' },
        },
      });
    });
  });

  it('marks ambiguous post-cancel termination uncertain instead of failed', async () => {
    await withLedger(async (ledger) => {
      const controller = new AbortController();
      const result = await runManualLedgerActivity(
        runOptions(ledger, {
          signal: controller.signal,
          executeAttempt: async (
            /** @type {Readonly<Record<string, any>>} */ startFrame,
            /** @type {{signal: AbortSignal}} */ { signal },
          ) => {
            controller.abort(foregroundCancellationReason());
            await waitForAbort(signal);
            return ambiguousCancellationEvidence(startFrame, signal.reason);
          },
        }),
      );

      expect(result).toMatchObject({
        disposition: 'blocked',
        run: {
          status: RunStatus.BLOCKED,
          cancellationRequest: {
            reason: { code: 'operator-cancel-requested' },
          },
        },
        invocation: { status: InvocationStatus.UNCERTAIN },
        attempt: { status: AttemptStatus.ABANDONED },
      });
      expect(
        (await ledger.getEvents(result.run.runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-started',
        'manual-cancellation-requested',
        'attempt-became-uncertain',
      ]);
    });
  });

  it('registers a bounded started-attempt cancellation port and closes it after terminal work', async () => {
    await withLedger(async (ledger) => {
      /** @type {any} */
      let port;
      let unregisterCalls = 0;
      const options = runOptions(ledger);

      const result = await runManualLedgerActivity({
        ...options,
        registerActiveAttemptCancellationPort: (candidate) => {
          port = candidate;
          return () => {
            unregisterCalls += 1;
          };
        },
        executeAttempt: async (startFrame) => {
          if (!port) throw new Error('Expected active cancellation port');
          const durable = await ledger.rebuildRun(options.runId);
          expect(
            durable?.events.map(
              (/** @type {Record<string, any>} */ event) => event.type,
            ),
          ).toEqual([
            'manual-run-created',
            'attempt-claimed',
            'attempt-started',
          ]);
          expect(port).toMatchObject({
            version: 1,
            runId: options.runId,
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            attemptId: startFrame.attemptId,
            fencingToken: startFrame.fencingToken,
            generation: 1,
          });
          expect(typeof port.requestCancellation).toBe('function');
          expect(port).not.toHaveProperty('signal');
          expect(port).not.toHaveProperty('abort');
          expect(Object.isFrozen(port)).toBe(true);
          return completedEvidence(startFrame);
        },
      });

      expect(result).toMatchObject({ disposition: 'completed' });
      expect(unregisterCalls).toBe(1);
      if (!port) throw new Error('Expected retained cancellation port');
      await expect(
        port.requestCancellation({ requestId: 'closed-owner-request' }),
      ).rejects.toThrow(/no longer live/i);
      expect(
        (await ledger.getEvents(options.runId)).map((event) => event.type),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-started',
        'attempt-terminal',
      ]);
    });
  });

  it('persists fixed owner-command authority before a port signals the live attempt', async () => {
    await withLedger(async (ledger) => {
      /** @type {any} */
      let port;
      const options = runOptions(ledger);
      const ownerCancellation = {
        actor: { kind: 'local', id: 'active-owner-command' },
        reason: {
          code: 'owner-cancel-requested',
          name: 'OwnerCancellationRequested',
          message: 'The current local owner accepted cancellation.',
          details: { channel: 'test-owner-command' },
        },
      };

      const result = await runManualLedgerActivity({
        ...options,
        ownerCancellation,
        registerActiveAttemptCancellationPort: (candidate) => {
          port = candidate;
        },
        executeAttempt: async (startFrame, { signal }) => {
          if (!port) throw new Error('Expected active cancellation port');
          const cancellation = await port.requestCancellation({
            requestId: 'owner-command-cancel-1',
          });
          expect(cancellation).toMatchObject({
            outcome: 'cancellation-requested',
            applied: true,
            signalDelivered: true,
            run: {
              cancellationRequest: {
                requestId: 'owner-command-cancel-1',
                actor: ownerCancellation.actor,
                reason: ownerCancellation.reason,
              },
            },
          });
          expect(signal.aborted).toBe(true);
          const durable = await ledger.rebuildRun(options.runId);
          expect(durable?.events.at(-1)?.type).toBe(
            'manual-cancellation-requested',
          );
          expect(durable?.run.cancellationRequest).toMatchObject({
            requestId: 'owner-command-cancel-1',
            actor: ownerCancellation.actor,
            reason: ownerCancellation.reason,
          });
          expect(signal.reason).toEqual(
            durable?.run.cancellationRequest?.reason,
          );
          return cancelledEvidence(startFrame, signal.reason);
        },
      });

      expect(result).toMatchObject({
        disposition: 'failed',
        run: {
          status: RunStatus.CANCELLED,
          cancellationRequest: {
            requestId: 'owner-command-cancel-1',
            actor: ownerCancellation.actor,
          },
        },
        invocation: { status: InvocationStatus.CANCELLED },
        attempt: { status: AttemptStatus.CANCELLED },
      });
    });
  });

  it('keeps the first durable port request authoritative when request IDs compete', async () => {
    await withLedger(async (ledger) => {
      /** @type {any} */
      let port;
      let abortEvents = 0;

      const result = await runManualLedgerActivity({
        ...runOptions(ledger),
        registerActiveAttemptCancellationPort: (candidate) => {
          port = candidate;
        },
        executeAttempt: async (startFrame, { signal }) => {
          if (!port) throw new Error('Expected active cancellation port');
          signal.addEventListener('abort', () => {
            abortEvents += 1;
          });
          const first = await port.requestCancellation({
            requestId: 'owner-command-first',
          });
          const second = await port.requestCancellation({
            requestId: 'owner-command-second',
          });
          expect(first).toMatchObject({
            outcome: 'cancellation-requested',
            signalDelivered: true,
            run: {
              cancellationRequest: { requestId: 'owner-command-first' },
            },
          });
          expect(second).toMatchObject({
            outcome: 'cancellation-requested',
            signalDelivered: false,
            run: {
              cancellationRequest: { requestId: 'owner-command-first' },
            },
          });
          expect(abortEvents).toBe(1);
          return cancelledEvidence(startFrame, signal.reason);
        },
      });

      expect(result).toMatchObject({
        run: {
          status: RunStatus.CANCELLED,
          cancellationRequest: { requestId: 'owner-command-first' },
        },
        attempt: { status: AttemptStatus.CANCELLED },
      });
    });
  });

  it('returns a terminal-authoritative port outcome without signalling after terminal evidence wins', async () => {
    await withLedger(async (ledger) => {
      /** @type {any} */
      let port;
      /** @type {any} */
      let portResult;
      const options = runOptions(ledger);

      const result = await runManualLedgerActivity({
        ...options,
        registerActiveAttemptCancellationPort: (candidate) => {
          port = candidate;
        },
        executeAttempt: async (startFrame, { signal }) => {
          if (!port) throw new Error('Expected active cancellation port');
          const evidence = completedEvidence(startFrame, { won: 'terminal' });
          const current = await ledger.rebuildRun(options.runId);
          const currentAttempt = current?.attempts[0];
          if (!current || !currentAttempt) {
            throw new Error('Expected durable started attempt');
          }
          await ledger.commitVerifiedAttemptTerminal({
            runId: options.runId,
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            attemptId: currentAttempt.attemptId,
            fencingToken: currentAttempt.fencingToken,
            generation: currentAttempt.generation,
            expectedVersion: current.run.version,
            transitionId: `terminal:${currentAttempt.attemptId}`,
            evidence,
            actor: { kind: 'local', id: 'cli' },
            coordinatorEpoch: currentAttempt.coordinatorEpoch,
          });
          portResult = await port.requestCancellation({
            requestId: 'after-terminal-owner-cancel',
          });
          expect(signal.aborted).toBe(false);
          return evidence;
        },
      });

      expect(portResult).toMatchObject({
        outcome: 'terminal-authoritative',
        signalDelivered: false,
        run: { status: RunStatus.COMPLETED },
        attempt: { status: AttemptStatus.COMPLETED },
      });
      expect(result).toMatchObject({
        disposition: 'completed',
        run: { status: RunStatus.COMPLETED },
      });
    });
  });

  it('returns an outcome-uncertain port result without signalling after ambiguity wins', async () => {
    await withLedger(async (ledger) => {
      /** @type {any} */
      let port;
      /** @type {any} */
      let portResult;
      const options = runOptions(ledger);

      const result = await runManualLedgerActivity({
        ...options,
        registerActiveAttemptCancellationPort: (candidate) => {
          port = candidate;
        },
        executeAttempt: async (startFrame, { signal }) => {
          if (!port) throw new Error('Expected active cancellation port');
          const current = await ledger.rebuildRun(options.runId);
          const currentAttempt = current?.attempts[0];
          if (!current || !currentAttempt) {
            throw new Error('Expected durable started attempt');
          }
          await ledger.markAttemptUncertain({
            runId: options.runId,
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            attemptId: currentAttempt.attemptId,
            fencingToken: currentAttempt.fencingToken,
            generation: currentAttempt.generation,
            expectedVersion: current.run.version,
            transitionId: `test-uncertain:${currentAttempt.attemptId}`,
            actor: { kind: 'local', id: 'cli' },
            coordinatorEpoch: currentAttempt.coordinatorEpoch,
            reason: { kind: 'test-ambiguous-owner-command' },
          });
          portResult = await port.requestCancellation({
            requestId: 'after-uncertain-owner-cancel',
          });
          expect(signal.aborted).toBe(false);
          return completedEvidence(startFrame, { ignored: 'uncertain' });
        },
      });

      expect(portResult).toMatchObject({
        outcome: 'outcome-uncertain',
        signalDelivered: false,
        run: { status: RunStatus.BLOCKED },
        invocation: { status: InvocationStatus.UNCERTAIN },
        attempt: { status: AttemptStatus.ABANDONED },
      });
      expect(result).toMatchObject({
        disposition: 'blocked',
        run: { status: RunStatus.BLOCKED },
      });
    });
  });

  it('delivers a port cancellation after verifying a lost durable response', async () => {
    await withLedger(async (ledger) => {
      const responseLostLedger = {
        ...ledger,
        requestManualRunCancellation: async (
          /** @type {Parameters<typeof ledger.requestManualRunCancellation>[0]} */ request,
        ) => {
          await ledger.requestManualRunCancellation(request);
          throw new Error('owner cancellation response was lost');
        },
      };
      /** @type {any} */
      let port;

      const result = await runManualLedgerActivity({
        ...runOptions(responseLostLedger),
        registerActiveAttemptCancellationPort: (candidate) => {
          port = candidate;
        },
        executeAttempt: async (startFrame, { signal }) => {
          if (!port) throw new Error('Expected active cancellation port');
          const cancellation = await port.requestCancellation({
            requestId: 'lost-owner-response',
          });
          expect(cancellation).toMatchObject({
            outcome: 'cancellation-requested',
            applied: false,
            signalDelivered: true,
            run: {
              cancellationRequest: { requestId: 'lost-owner-response' },
            },
          });
          const replay = await port.requestCancellation({
            requestId: 'lost-owner-response',
          });
          expect(replay).toMatchObject({
            outcome: 'cancellation-requested',
            signalDelivered: true,
            run: {
              cancellationRequest: { requestId: 'lost-owner-response' },
            },
          });
          expect(signal.aborted).toBe(true);
          return cancelledEvidence(startFrame, signal.reason);
        },
      });

      expect(result).toMatchObject({
        run: {
          status: RunStatus.CANCELLED,
          cancellationRequest: { requestId: 'lost-owner-response' },
        },
        attempt: { status: AttemptStatus.CANCELLED },
      });
    });
  });

  it('rejects non-AbortSignal cancellation inputs before mutating the ledger', async () => {
    await withLedger(async (ledger) => {
      const options = runOptions(ledger, { signal: {} });
      await expect(runManualLedgerActivity(options)).rejects.toThrow(
        /must be an AbortSignal/i,
      );
      expect(await ledger.getEvents(options.runId)).toEqual([]);
    });
  });

  it('marks a started local failure uncertain and never re-dispatches it', async () => {
    await withLedger(async (ledger) => {
      let calls = 0;
      const first = await runManualLedgerActivity(
        runOptions(ledger, {
          executeAttempt: async () => {
            calls += 1;
            throw new Error('worker connection vanished');
          },
        }),
      );

      expect(first).toMatchObject({
        disposition: 'blocked',
        run: { status: RunStatus.BLOCKED },
        invocation: { status: InvocationStatus.UNCERTAIN },
        attempt: { status: AttemptStatus.ABANDONED },
      });
      expect(calls).toBe(1);

      const retry = await runManualLedgerActivity(
        runOptions(ledger, {
          executeAttempt: async () => {
            calls += 1;
            throw new Error('must not re-dispatch uncertain work');
          },
        }),
      );
      expect(retry).toMatchObject({ disposition: 'blocked', reused: true });
      expect(calls).toBe(1);
    });
  });

  it('does not dispatch when recovery wins immediately after durable start', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'wharfie-manual-ledger-race-'),
    );
    const baseDb = createVanillaDB({ path: directory });
    /** @type {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} */
    let ledger;
    let injectedRecovery = false;
    const db = {
      ...baseDb,
      transactionWrite: async (
        /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
      ) => {
        await baseDb.transactionWrite(params);
        const startEvent = params.putRequests?.find(
          (request) =>
            request.record?.record_type === 'execution_ledger_event' &&
            request.record.type === 'attempt-started',
        )?.record;
        if (!startEvent || injectedRecovery) return;
        injectedRecovery = true;
        const attempt = startEvent.payload.attempt;
        await ledger.markAttemptUncertain({
          runId: startEvent.run_id,
          invocationId: attempt.invocationId,
          attemptId: attempt.attemptId,
          fencingToken: attempt.fencingToken,
          generation: attempt.generation,
          expectedVersion: startEvent.payload.run.version,
          transitionId: `race-recover:${attempt.attemptId}`,
          actor: { kind: 'local', id: 'recovery' },
          reason: { kind: 'test-recovery-race' },
        });
      },
    };
    ledger = createExecutionLedger({
      db,
      tableName: 'manual-ledger-race-test',
      payloadStore: createPayloadStore(directory),
      now: createClock(),
    });

    try {
      let dispatches = 0;
      const result = await runManualLedgerActivity(
        runOptions(ledger, {
          executeAttempt: async () => {
            dispatches += 1;
            throw new Error('a raced recovery must prevent physical dispatch');
          },
        }),
      );

      expect(injectedRecovery).toBe(true);
      expect(dispatches).toBe(0);
      expect(result).toMatchObject({
        disposition: 'blocked',
        run: { status: RunStatus.BLOCKED },
        invocation: { status: InvocationStatus.UNCERTAIN },
        attempt: { status: AttemptStatus.ABANDONED },
      });
    } finally {
      await baseDb.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not let a stale failed start mutate a newer attempt generation', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'wharfie-manual-ledger-stale-start-'),
    );
    const baseDb = createVanillaDB({ path: directory });
    /** @type {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} */
    let ledger;
    let replacedStaleClaim = false;
    const db = {
      ...baseDb,
      transactionWrite: async (
        /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
      ) => {
        const staleStart = params.putRequests?.find(
          (request) =>
            request.record?.record_type === 'execution_ledger_event' &&
            request.record.type === 'attempt-started' &&
            request.record.payload.attempt.fencingToken === 'stale-fence',
        )?.record;
        if (staleStart && !replacedStaleClaim) {
          replacedStaleClaim = true;
          const current = await ledger.rebuildRun(staleStart.run_id);
          if (!current) throw new Error('Expected stale claim to exist');
          const invocation = current.invocations.find(
            (/** @type {Record<string, any>} */ candidate) =>
              candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID,
          );
          const staleAttempt = current.attempts.find(
            (/** @type {Record<string, any>} */ candidate) =>
              candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID &&
              candidate.generation === invocation?.generation,
          );
          if (!invocation || !staleAttempt) {
            throw new Error('Expected stale manual attempt');
          }
          const released = await ledger.abandonUnstartedAttempt({
            runId: staleStart.run_id,
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            attemptId: staleAttempt.attemptId,
            fencingToken: staleAttempt.fencingToken,
            generation: staleAttempt.generation,
            expectedVersion: current.run.version,
            transitionId: `recover-abandon:${staleAttempt.attemptId}`,
            actor: { kind: 'local', id: 'recovery' },
            reason: { kind: 'test-replaced-stale-claim' },
          });
          const replacement = await ledger.claimInvocation({
            runId: staleStart.run_id,
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            fencingToken: 'replacement-fence',
            expectedGeneration: released.invocation.generation,
            expectedVersion: released.run.version,
            transitionId: 'replacement-claim:2',
            actor: { kind: 'local', id: 'replacement' },
          });
          if (!replacement.attempt) {
            throw new Error('Expected replacement manual attempt');
          }
          await ledger.markAttemptStarted({
            runId: staleStart.run_id,
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            attemptId: replacement.attempt.attemptId,
            fencingToken: 'replacement-fence',
            generation: replacement.attempt.generation,
            expectedVersion: replacement.run.version,
            transitionId: `replacement-start:${replacement.attempt.attemptId}`,
            actor: { kind: 'local', id: 'replacement' },
          });
        }
        await baseDb.transactionWrite(params);
      },
    };
    ledger = createExecutionLedger({
      db,
      tableName: 'manual-ledger-stale-start-test',
      payloadStore: createPayloadStore(directory),
      now: createClock(),
    });

    try {
      let dispatches = 0;
      const result = await runManualLedgerActivity(
        runOptions(ledger, {
          createFencingToken: () => 'stale-fence',
          executeAttempt: async () => {
            dispatches += 1;
            throw new Error('stale attempt must never receive a start frame');
          },
        }),
      );

      expect(replacedStaleClaim).toBe(true);
      expect(dispatches).toBe(0);
      expect(result).toMatchObject({
        disposition: 'in-progress',
        run: { status: RunStatus.RUNNING },
        invocation: { status: InvocationStatus.RUNNING, generation: 2 },
        attempt: {
          status: AttemptStatus.STARTED,
          generation: 2,
          fencingToken: 'replacement-fence',
        },
      });
      const view = await ledger.rebuildRun(result.run.runId);
      expect(view?.run.status).toBe(RunStatus.RUNNING);
      expect(view?.invocations).toEqual([
        expect.objectContaining({
          status: InvocationStatus.RUNNING,
          generation: 2,
        }),
      ]);
      expect(view?.attempts).toHaveLength(2);
      expect(view?.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: AttemptStatus.ABANDONED,
            generation: 1,
            fencingToken: 'stale-fence',
          }),
          expect.objectContaining({
            status: AttemptStatus.STARTED,
            generation: 2,
            fencingToken: 'replacement-fence',
          }),
        ]),
      );
    } finally {
      await baseDb.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not start an attempt from an ambiguous replayed claim receipt', async () => {
    await withLedger(async (ledger) => {
      const replayLedger = {
        ...ledger,
        claimInvocation: async (
          /** @type {Parameters<typeof ledger.claimInvocation>[0]} */ options,
        ) => ({
          ...(await ledger.claimInvocation(options)),
          // Model a caller that cannot tell whether its claim RPC was the
          // original writer or a replay of another owner's receipt.
          applied: false,
        }),
      };
      let dispatches = 0;
      const result = await runManualLedgerActivity(
        runOptions(replayLedger, {
          createFencingToken: () => 'replayed-claim-fence',
          executeAttempt: async () => {
            dispatches += 1;
            throw new Error('an ambiguous claim must not start physical work');
          },
        }),
      );

      expect(dispatches).toBe(0);
      expect(result).toMatchObject({
        disposition: 'in-progress',
        reused: true,
        run: { status: RunStatus.RUNNING },
        invocation: { status: InvocationStatus.RUNNING, generation: 1 },
        attempt: {
          status: AttemptStatus.CLAIMED,
          generation: 1,
          fencingToken: 'replayed-claim-fence',
        },
      });
    });
  });

  it('commits a verified failed terminal instead of treating it as uncertainty', async () => {
    await withLedger(async (ledger) => {
      const result = await runManualLedgerActivity(
        runOptions(ledger, {
          executeAttempt: async (
            /** @type {Readonly<Record<string, any>>} */ startFrame,
          ) => failedEvidence(startFrame),
        }),
      );

      expect(result).toMatchObject({
        disposition: 'failed',
        run: { status: RunStatus.FAILED },
        invocation: { status: InvocationStatus.FAILED },
        attempt: { status: AttemptStatus.FAILED },
        terminalSummary: {
          type: 'failed',
        },
      });
    });
  });

  it('does not seize a claimed run without explicit operator recovery', async () => {
    await withLedger(async (ledger) => {
      const options = runOptions(ledger, {
        executeAttempt: async (
          /** @type {Readonly<Record<string, any>>} */ startFrame,
        ) => completedEvidence(startFrame),
      });
      await ledger.createManualRun({
        runId: options.runId,
        appId: options.appId,
        revisionId: options.revisionId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        activityId: options.activityId,
        input: options.input,
        callerMetadata: options.callerMetadata,
        transitionId: 'create',
        actor: { kind: 'local', id: 'cli' },
      });
      const claimed = await ledger.claimInvocation({
        runId: options.runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        fencingToken: 'old-runner-fence',
        expectedGeneration: 0,
        expectedVersion: 1,
        transitionId: 'claim:1',
      });
      expect(claimed.attempt?.status).toBe(AttemptStatus.CLAIMED);

      let calls = 0;
      const withoutRecovery = await runManualLedgerActivity({
        ...options,
        executeAttempt: async () => {
          calls += 1;
          throw new Error('a live claim must not be stolen');
        },
      });
      expect(withoutRecovery).toMatchObject({
        disposition: 'in-progress',
        attempt: { status: AttemptStatus.CLAIMED, generation: 1 },
      });
      expect(calls).toBe(0);

      const recovery = await recoverManualLedgerActivity({
        ledger,
        runId: options.runId,
      });
      expect(recovery).toMatchObject({
        found: true,
        mayExecute: true,
        action: ManualLedgerRecoveryAction.RELEASED_UNSTARTED_CLAIM,
        changed: true,
        outcome: {
          disposition: 'in-progress',
          run: { status: RunStatus.RUNNING },
          invocation: { status: InvocationStatus.RUNNABLE, generation: 1 },
          attempt: { status: AttemptStatus.ABANDONED, generation: 1 },
        },
      });

      const recovered = await runManualLedgerActivity({
        ...options,
        createFencingToken: () => 'replacement-runner-fence',
        executeAttempt: async (
          /** @type {Readonly<Record<string, any>>} */ startFrame,
        ) => {
          calls += 1;
          return completedEvidence(startFrame, { recovered: true });
        },
      });
      expect(recovered).toMatchObject({
        disposition: 'completed',
        attempt: {
          status: AttemptStatus.COMPLETED,
          generation: 2,
          fencingToken: 'replacement-runner-fence',
        },
      });
      expect(calls).toBe(1);

      const events = await ledger.getEvents(options.runId);
      expect(
        events.map((/** @type {Record<string, any>} */ event) => event.type),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-abandoned-before-start',
        'attempt-claimed',
        'attempt-started',
        'attempt-terminal',
      ]);
    });
  });

  it('marks the same claim uncertain when it starts during confirmed recovery', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'wharfie-manual-ledger-recovery-race-'),
    );
    const baseDb = createVanillaDB({ path: directory });
    /** @type {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} */
    let ledger;
    let startedDuringRecovery = false;
    const db = {
      ...baseDb,
      transactionWrite: async (
        /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
      ) => {
        const abandon = params.putRequests?.find(
          (request) =>
            request.record?.record_type === 'execution_ledger_event' &&
            request.record.type === 'attempt-abandoned-before-start',
        )?.record;
        if (abandon && !startedDuringRecovery) {
          startedDuringRecovery = true;
          const current = await ledger.rebuildRun(abandon.run_id);
          if (!current) throw new Error('Expected claimed run to exist');
          const invocation = current.invocations.find(
            (/** @type {Record<string, any>} */ candidate) =>
              candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID,
          );
          const attempt = current.attempts.find(
            (/** @type {Record<string, any>} */ candidate) =>
              candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID &&
              candidate.generation === invocation?.generation,
          );
          if (!invocation || !attempt) {
            throw new Error('Expected concurrent claimed attempt');
          }
          await ledger.markAttemptStarted({
            runId: abandon.run_id,
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            attemptId: attempt.attemptId,
            fencingToken: attempt.fencingToken,
            generation: attempt.generation,
            expectedVersion: current.run.version,
            transitionId: `concurrent-start:${attempt.attemptId}`,
            actor: { kind: 'local', id: 'concurrent-runner' },
          });
        }
        await baseDb.transactionWrite(params);
      },
    };
    ledger = createExecutionLedger({
      db,
      tableName: 'manual-ledger-recovery-race-test',
      payloadStore: createPayloadStore(directory),
      now: createClock(),
    });

    try {
      const options = runOptions(ledger);
      await ledger.createManualRun({
        runId: options.runId,
        appId: options.appId,
        revisionId: options.revisionId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        activityId: options.activityId,
        input: options.input,
        callerMetadata: options.callerMetadata,
        transitionId: 'create',
        actor: { kind: 'local', id: 'cli' },
      });
      await ledger.claimInvocation({
        runId: options.runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        fencingToken: 'recovery-race-fence',
        expectedGeneration: 0,
        expectedVersion: 1,
        transitionId: 'claim:1',
        actor: { kind: 'local', id: 'cli' },
      });

      const recovered = await recoverManualLedgerActivity({
        ledger,
        runId: options.runId,
      });

      expect(startedDuringRecovery).toBe(true);
      expect(recovered).toMatchObject({
        found: true,
        mayExecute: false,
        action: ManualLedgerRecoveryAction.MARKED_STARTED_UNCERTAIN,
        changed: true,
        outcome: {
          disposition: 'blocked',
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: {
            status: AttemptStatus.ABANDONED,
            fencingToken: 'recovery-race-fence',
          },
        },
      });
      const view = await ledger.rebuildRun(options.runId);
      expect(
        view?.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'manual-run-created',
        'attempt-claimed',
        'attempt-started',
        'attempt-became-uncertain',
      ]);
    } finally {
      await baseDb.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('turns an explicitly recovered started attempt into uncertainty without dispatching new work', async () => {
    await withLedger(async (ledger) => {
      const options = runOptions(ledger, {
        executeAttempt: async () => {
          throw new Error('a recovered start must not dispatch');
        },
      });
      await ledger.createManualRun({
        runId: options.runId,
        appId: options.appId,
        revisionId: options.revisionId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        activityId: options.activityId,
        input: options.input,
        callerMetadata: options.callerMetadata,
        transitionId: 'create',
        actor: { kind: 'local', id: 'cli' },
      });
      const claim = await ledger.claimInvocation({
        runId: options.runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        fencingToken: 'old-runner-fence',
        expectedGeneration: 0,
        expectedVersion: 1,
        transitionId: 'claim:1',
      });
      await ledger.markAttemptStarted({
        runId: options.runId,
        invocationId: MANUAL_LEDGER_INVOCATION_ID,
        attemptId: claim.attempt?.attemptId,
        fencingToken: 'old-runner-fence',
        generation: 1,
        expectedVersion: 2,
        transitionId: `start:${claim.attempt?.attemptId}`,
      });

      const recovered = await recoverManualLedgerActivity({
        ledger,
        runId: options.runId,
      });
      expect(recovered).toMatchObject({
        found: true,
        mayExecute: false,
        action: ManualLedgerRecoveryAction.MARKED_STARTED_UNCERTAIN,
        changed: true,
        outcome: {
          disposition: 'blocked',
          run: { status: RunStatus.BLOCKED },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED, generation: 1 },
        },
      });
    });
  });
});
