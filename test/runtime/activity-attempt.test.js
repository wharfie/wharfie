import { describe, expect, it, jest } from '@jest/globals';

import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
} from '../../src/core/runtime/activity-protocol.js';
import {
  ActivityAttemptDeliveryError,
  ActivityAttemptProtocolError,
  ActivityEffectError,
  runNodeActivityAttempt,
  serializeActivityAttemptError,
} from '../../src/core/runtime/activity-attempt.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const ATTEMPT_ID = 'attempt-1';

/**
 * @param {Record<string, any>} [overrides] - Error field overrides.
 * @returns {Record<string, any>} - Structured protocol error.
 */
function structuredError(overrides = {}) {
  return {
    code: 'activity-failed',
    name: 'Error',
    message: 'activity failed',
    details: {},
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} [overrides] - Start field overrides.
 * @returns {Record<string, any>} - Activity Protocol v1 start frame.
 */
function startFrame(overrides = {}) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'start',
    revisionId: REVISION_ID,
    activityId: 'rebuild-index',
    runId: 'run-1',
    invocationId: 'invocation-1',
    attemptId: ATTEMPT_ID,
    fencingToken: 'fence-1',
    input: { partition: 7 },
    caller: { metadata: { traceId: 'trace-1' } },
    ...overrides,
  };
}

/**
 * @param {string} effectId - Correlated effect ID.
 * @param {any} result - JSON effect result.
 * @param {Record<string, any>} [overrides] - Frame overrides.
 * @returns {Record<string, any>} - Successful effect-result frame.
 */
function effectResultFrame(effectId, result, overrides = {}) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'effect-result',
    attemptId: ATTEMPT_ID,
    effectId,
    ok: true,
    result,
    substantiatedReplayProperties: ['idempotent'],
    evidence: { destinationKey: 'index.json', deduplicated: true },
    ...overrides,
  };
}

/**
 * @param {string} effectId - Correlated effect ID.
 * @param {Record<string, any>} [overrides] - Frame overrides.
 * @returns {Record<string, any>} - Failed effect-result frame.
 */
function failedEffectResultFrame(effectId, overrides = {}) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'effect-result',
    attemptId: ATTEMPT_ID,
    effectId,
    ok: false,
    error: structuredError({
      code: 'destination-rejected',
      name: 'DestinationError',
      message: 'destination rejected the write',
      details: { status: 409 },
    }),
    substantiatedReplayProperties: ['unsafe'],
    evidence: { destination: 'object-store' },
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} [overrides] - Effect request overrides.
 * @returns {Record<string, any>} - Component effect request.
 */
function effectRequest(overrides = {}) {
  return {
    effectId: 'effect-1',
    capability: 'object-storage',
    operation: 'put-object',
    input: { key: 'index.json', value: [1, 2] },
    requestedReplayProperties: ['idempotent'],
    ...overrides,
  };
}

/**
 * @param {string} message - Cancellation message.
 * @returns {Error & {code: string, details: Record<string, any>}} - Cancellation reason.
 */
function cancellationReason(message = 'operator requested cancellation') {
  const error =
    /** @type {Error & {code: string, details: Record<string, any>}} */ (
      new Error(message)
    );
  error.name = 'CancellationError';
  error.code = 'cancel-requested';
  error.details = { actor: 'operator' };
  return error;
}

describe('Node Activity Protocol v1 attempt adapter', () => {
  it.each([
    ['null', null],
    ['string', 'done'],
    ['number', 17],
    ['boolean', false],
    ['array', [1, 'two', null]],
    ['object', { indexed: 2, nested: { complete: true } }],
  ])('preserves a completed %s result exactly', async (_label, value) => {
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      handler: async () => value,
    });

    expect(evidence.status).toBe('completed');
    expect(evidence.terminal).toEqual({
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'completed',
      attemptId: ATTEMPT_ID,
      sequence: 1,
      result: value,
    });
    expect(evidence.transcript).toEqual({
      started: true,
      attemptId: ATTEMPT_ID,
      nextComponentSequence: 2,
      cancelRequested: false,
      pendingEffectIds: [],
      terminalType: 'completed',
    });
  });

  it('supplies independently cloned frozen input and namespaced runtime context', async () => {
    const original = startFrame({
      input: { values: [1, { nested: true }] },
      caller: { metadata: { traceId: 'trace-1', labels: ['test'] } },
    });
    let observedRuntime = /** @type {Record<string, any> | null} */ (null);
    let observedInput = /** @type {Record<string, any> | null} */ (null);

    const evidence = await runNodeActivityAttempt({
      startFrame: original,
      handler: (input, runtime) => {
        observedInput = input;
        observedRuntime = runtime;
        return { ok: true };
      },
    });

    original.input.values[1].nested = false;
    original.caller.metadata.labels.push('mutated');
    const input = /** @type {Record<string, any>} */ (observedInput);
    const runtime = /** @type {Record<string, any>} */ (observedRuntime);
    expect(input).toEqual({ values: [1, { nested: true }] });
    expect(runtime).toMatchObject({
      invocation: {
        revisionId: REVISION_ID,
        activityId: 'rebuild-index',
        runId: 'run-1',
        invocationId: 'invocation-1',
        attemptId: ATTEMPT_ID,
        fencingToken: 'fence-1',
      },
      caller: { metadata: { traceId: 'trace-1', labels: ['test'] } },
    });
    expect(Object.keys(runtime).sort()).toEqual([
      'caller',
      'effects',
      'invocation',
      'logger',
      'signal',
    ]);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.values)).toBe(true);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.invocation)).toBe(true);
    expect(Object.isFrozen(runtime.caller.metadata.labels)).toBe(true);
    expect(evidence.terminal.result).toEqual({ ok: true });
  });

  it('serializes ordered logs through one non-concurrent component sink', async () => {
    const delivered = /** @type {Readonly<Record<string, any>>[]} */ ([]);
    let inFlight = 0;
    let maximumInFlight = 0;

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      onComponentFrame: async (frame) => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await Promise.resolve();
        delivered.push(frame);
        inFlight -= 1;
      },
      handler: (_input, runtime) => {
        runtime.logger.info('starting', { partition: 7 });
        runtime.logger.warn('finishing');
        return 'done';
      },
    });

    expect(maximumInFlight).toBe(1);
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'log',
      'log',
      'completed',
    ]);
    expect(evidence.frames.slice(1).map((frame) => frame.sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(delivered).toEqual(evidence.frames.slice(1));
    expect(delivered[0]).toMatchObject({
      level: 'info',
      message: 'starting',
      fields: { partition: 7 },
    });
    expect(delivered[1]).toMatchObject({
      level: 'warn',
      message: 'finishing',
      fields: {},
    });
  });

  it('mediates correlated effects without exposing host resources or credentials', async () => {
    const delivered = /** @type {Readonly<Record<string, any>>[]} */ ([]);
    let hostRequest;
    let hostSignal;
    let componentRuntime = /** @type {Record<string, any> | null} */ (null);

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      onComponentFrame: (frame) => delivered.push(frame),
      handleEffect: (request, options) => {
        hostRequest = request;
        hostSignal = options.signal;
        return effectResultFrame(request.effectId, { etag: 'abc' });
      },
      handler: async (_input, runtime) => {
        componentRuntime = runtime;
        const result = await runtime.effects.request(effectRequest());
        expect(Object.isFrozen(result)).toBe(true);
        return { effect: result };
      },
    });

    const runtime = /** @type {Record<string, any>} */ (componentRuntime);
    expect(Object.keys(runtime).sort()).toEqual([
      'caller',
      'effects',
      'invocation',
      'logger',
      'signal',
    ]);
    expect(hostSignal).toBe(runtime.signal);
    expect(hostRequest).toMatchObject({
      type: 'effect-request',
      attemptId: ATTEMPT_ID,
      sequence: 1,
      effectId: 'effect-1',
      capability: 'object-storage',
      operation: 'put-object',
      requestedReplayProperties: ['idempotent'],
    });
    expect(Object.isFrozen(hostRequest)).toBe(true);
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'effect-result',
      'completed',
    ]);
    expect(delivered.map((frame) => frame.type)).toEqual([
      'effect-request',
      'completed',
    ]);
    expect(evidence.terminal.result).toEqual({ effect: { etag: 'abc' } });
  });

  it('retains effect work beyond the bounded transport-operation timeout', async () => {
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      hostOperationTimeoutMs: 5,
      onComponentFrame: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
      handleEffect: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return effectResultFrame(request.effectId, { retained: true });
      },
      handler: (_input, runtime) => {
        void runtime.effects.request(effectRequest());
        return 'component-returned-before-effect';
      },
    });

    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'effect-result',
      'completed',
    ]);
    expect(evidence.terminal.result).toBe('component-returned-before-effect');
  });

  it('observes an ignored rejected effect without a process-level rejection', async () => {
    const unhandled = /** @type {unknown[]} */ ([]);
    const onUnhandled = (/** @type {unknown} */ reason) =>
      unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const evidence = await runNodeActivityAttempt({
        startFrame: startFrame(),
        handleEffect: async () => {
          throw new Error('destination unavailable');
        },
        handler: (_input, runtime) => {
          void runtime.effects.request(effectRequest());
          return 'component-ignored-rejection';
        },
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(evidence.status).toBe('protocol-failed');
      expect(evidence.terminal.error).toMatchObject({
        code: 'effect-handler-failed',
      });
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  it('turns a structured failed effect into a structured activity failure', async () => {
    let thrown;
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      handleEffect: (request) => failedEffectResultFrame(request.effectId),
      handler: async (_input, runtime) => {
        try {
          await runtime.effects.request(effectRequest());
        } catch (error) {
          thrown = error;
          throw error;
        }
      },
    });

    expect(thrown).toBeInstanceOf(ActivityEffectError);
    expect(thrown).toMatchObject({
      name: 'DestinationError',
      code: 'destination-rejected',
      effectId: 'effect-1',
      details: { status: 409 },
      substantiatedReplayProperties: ['unsafe'],
    });
    expect(evidence.status).toBe('failed');
    expect(evidence.terminal.error).toEqual(
      structuredError({
        code: 'destination-rejected',
        name: 'DestinationError',
        message: 'destination rejected the write',
        details: { status: 409 },
      }),
    );
  });

  it('reports an effect adapter exception as protocol failure', async () => {
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      handleEffect: () => {
        throw new Error('provider client crashed');
      },
      handler: async (_input, runtime) =>
        await runtime.effects.request(effectRequest()),
    });

    expect(evidence.status).toBe('protocol-failed');
    expect(evidence.terminal.error).toMatchObject({
      code: 'effect-handler-failed',
      name: 'ActivityAttemptProtocolError',
      details: { effectId: 'effect-1' },
    });
    expect(evidence.terminal.error.message).not.toContain(
      'provider client crashed',
    );
  });

  it('reports an invalid correlated effect result as protocol failure', async () => {
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      handleEffect: () => effectResultFrame('different-effect', 'wrong'),
      handler: async (_input, runtime) =>
        await runtime.effects.request(effectRequest()),
    });

    expect(evidence.status).toBe('protocol-failed');
    expect(evidence.terminal.error).toMatchObject({
      code: 'host-frame-invalid',
      name: 'ActivityAttemptProtocolError',
    });
    expect(evidence.transcript.pendingEffectIds).toEqual([]);
  });

  it('latches an invalid component frame even when activity code catches it', async () => {
    let caught;
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      handler: (_input, runtime) => {
        try {
          runtime.logger.info('invalid fields', { unsupported: 1n });
        } catch (error) {
          caught = error;
        }
        return 'activity tried to recover';
      },
    });

    expect(caught).toBeInstanceOf(ActivityAttemptProtocolError);
    expect(evidence.status).toBe('protocol-failed');
    expect(evidence.terminal.error).toMatchObject({
      code: 'component-frame-invalid',
      name: 'ActivityAttemptProtocolError',
    });
    expect(evidence.terminal).not.toHaveProperty('result');
  });

  it('latches a wrong host effect-frame type before it can mutate the transcript', async () => {
    let caught;
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      handleEffect: () => ({
        protocol: ACTIVITY_PROTOCOL_NAME,
        protocolVersion: ACTIVITY_PROTOCOL_VERSION,
        type: 'cancel',
        attemptId: ATTEMPT_ID,
        reason: structuredError({ code: 'cancel-requested' }),
      }),
      handler: async (_input, runtime) => {
        try {
          await runtime.effects.request(effectRequest());
        } catch (error) {
          caught = error;
        }
        return 'activity tried to recover';
      },
    });

    expect(caught).toBeInstanceOf(ActivityAttemptProtocolError);
    expect(evidence.status).toBe('protocol-failed');
    expect(evidence.terminal.error).toMatchObject({
      code: 'effect-result-invalid',
    });
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'protocol-failed',
    ]);
    expect(evidence.transcript.cancelRequested).toBe(false);
  });

  it('converts an ordinary handler exception into a stack-free structured failure', async () => {
    const error = /** @type {Error & {code: string, details: any}} */ (
      new Error('index rebuild failed')
    );
    error.name = 'RebuildError';
    error.code = 'rebuild-failed';
    error.details = { partition: 7 };

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      handler: () => {
        throw error;
      },
    });

    expect(evidence.status).toBe('failed');
    expect(evidence.terminal.error).toEqual({
      code: 'rebuild-failed',
      name: 'RebuildError',
      message: 'index rebuild failed',
      details: { partition: 7 },
    });
    expect(evidence.terminal.error).not.toHaveProperty('stack');
    expect(evidence.terminal.error).not.toHaveProperty('cause');
  });

  it.each([
    ['undefined', undefined],
    ['bigint', 1n],
    ['negative zero', -0],
  ])(
    'turns a non-transportable %s result into protocol failure',
    async (_label, value) => {
      const evidence = await runNodeActivityAttempt({
        startFrame: startFrame(),
        handler: () => value,
      });

      expect(evidence.status).toBe('protocol-failed');
      expect(evidence.terminal.error).toMatchObject({
        code: 'component-frame-invalid',
        name: 'ActivityAttemptProtocolError',
      });
    },
  );

  it('does not enter user code when cancellation is already requested', async () => {
    const controller = new AbortController();
    controller.abort(cancellationReason());
    const handler = jest.fn();

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      signal: controller.signal,
      handler,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(evidence.status).toBe('cancelled');
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'cancel',
      'cancelled',
    ]);
    expect(evidence.frames[1].reason).toEqual({
      code: 'cancel-requested',
      name: 'CancellationError',
      message: 'operator requested cancellation',
      details: { actor: 'operator' },
    });
    expect(evidence.transcript.cancelRequested).toBe(true);
  });

  it('allows bounded cooperative cancellation and rejects new effects', async () => {
    const controller = new AbortController();
    const handleEffect = jest.fn();
    let effectError;

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      signal: controller.signal,
      handleEffect,
      handler: async (_input, runtime) => {
        controller.abort(cancellationReason('stop now'));
        try {
          await runtime.effects.request(effectRequest());
        } catch (error) {
          effectError = error;
        }
        runtime.logger.info('cleanup complete');
        return 'ignored result';
      },
    });

    expect(handleEffect).not.toHaveBeenCalled();
    expect(effectError).toMatchObject({
      name: 'CancellationError',
      code: 'cancel-requested',
      details: { actor: 'operator' },
    });
    expect(evidence.status).toBe('cancelled');
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'cancel',
      'log',
      'cancelled',
    ]);
  });

  it('force-terminates an uncooperative boundary and rejects late frames', async () => {
    const controller = new AbortController();
    const forceTerminate = jest.fn();
    let runtime = /** @type {Record<string, any> | null} */ (null);

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      signal: controller.signal,
      cancellationGraceMs: 0,
      forceTerminate,
      handler: (_input, value) => {
        runtime = value;
        controller.abort(cancellationReason());
        return new Promise(() => {});
      },
    });

    expect(forceTerminate).toHaveBeenCalledTimes(1);
    expect(evidence.status).toBe('cancelled');
    const stoppedRuntime = /** @type {Record<string, any>} */ (runtime);
    expect(() => stoppedRuntime.logger.info('late log')).toThrow(
      ActivityAttemptProtocolError,
    );
    expect(() => stoppedRuntime.logger.info('late log')).toThrow(
      /no longer accepts/i,
    );
  });

  it('seals component output before forceTerminate can run', async () => {
    const controller = new AbortController();
    let runtime = /** @type {Record<string, any> | null} */ (null);
    const forceTerminate = jest.fn(() => {
      expect(() => runtime?.logger.info('late during termination')).toThrow(
        ActivityAttemptProtocolError,
      );
    });

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      signal: controller.signal,
      cancellationGraceMs: 0,
      forceTerminate,
      handler: (_input, value) => {
        runtime = value;
        controller.abort(cancellationReason());
        return new Promise(() => {});
      },
    });

    expect(forceTerminate).toHaveBeenCalledTimes(1);
    expect(evidence.status).toBe('protocol-failed');
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'cancel',
      'protocol-failed',
    ]);
    expect(evidence.terminal.error).toMatchObject({ code: 'attempt-closed' });
  });

  it('fails the protocol when an uncooperative activity has no terminable boundary', async () => {
    const controller = new AbortController();

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      signal: controller.signal,
      cancellationGraceMs: 0,
      handler: () => {
        controller.abort(cancellationReason());
        return new Promise(() => {});
      },
    });

    expect(evidence.status).toBe('protocol-failed');
    expect(evidence.terminal.error).toMatchObject({
      code: 'termination-unavailable',
      name: 'ActivityAttemptProtocolError',
    });
  });

  it('enforces a deadline in the component protocol before entering user code', async () => {
    const handler = jest.fn();
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame({ deadlineUnixMs: 100 }),
      now: () => 101,
      handler,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(evidence.status).toBe('deadline-exceeded');
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'deadline-exceeded',
    ]);
    expect(evidence.terminal.error).toEqual({
      code: 'deadline-exceeded',
      name: 'ActivityDeadlineError',
      message: 'The activity attempt deadline was exceeded.',
      details: { deadlineUnixMs: 100 },
    });
  });

  it('keeps an already accepted cancellation ahead of an elapsed deadline', async () => {
    const controller = new AbortController();
    controller.abort(cancellationReason('cancelled before worker startup'));
    const handler = jest.fn();

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame({ deadlineUnixMs: 100 }),
      now: () => 101,
      signal: controller.signal,
      handler,
    });

    expect(handler).not.toHaveBeenCalled();
    expect(evidence.status).toBe('cancelled');
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'cancel',
      'cancelled',
    ]);
    expect(evidence.terminal.error).toMatchObject({
      code: 'cancel-requested',
      message: 'cancelled before worker startup',
    });
  });

  it('delivers deadline cancellation into a running cooperative handler', async () => {
    const deadlineUnixMs = Date.now() + 15;
    let started = false;
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame({ deadlineUnixMs }),
      cancellationGraceMs: 50,
      handler: async (_input, runtime) => {
        started = true;
        await new Promise((resolve) =>
          runtime.signal.addEventListener('abort', resolve, { once: true }),
        );
        return 'ignored after deadline';
      },
    });

    expect(started).toBe(true);
    expect(evidence.status).toBe('deadline-exceeded');
    expect(evidence.terminal.error).toMatchObject({
      code: 'deadline-exceeded',
      details: { deadlineUnixMs },
    });
  });

  it('allows an in-flight managed effect to report its result after cancellation', async () => {
    const controller = new AbortController();
    let effectStarted = false;
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      signal: controller.signal,
      cancellationGraceMs: 50,
      handleEffect: async (request) => {
        effectStarted = true;
        controller.abort(cancellationReason());
        return effectResultFrame(request.effectId, { committed: true });
      },
      handler: async (_input, runtime) => {
        await runtime.effects.request(effectRequest());
        return 'ignored after cancellation';
      },
    });

    expect(effectStarted).toBe(true);
    expect(evidence.status).toBe('cancelled');
    expect(evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'effect-request',
      'cancel',
      'effect-result',
      'cancelled',
    ]);
  });

  it('returns deeply frozen physical-attempt evidence', async () => {
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      handler: () => ({ nested: { values: [1, 2] } }),
    });

    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.frames)).toBe(true);
    expect(Object.isFrozen(evidence.terminal)).toBe(true);
    expect(Object.isFrozen(evidence.terminal.result.nested.values)).toBe(true);
    expect(Object.isFrozen(evidence.transcript)).toBe(true);
    expect(() => /** @type {any} */ (evidence.frames).push({})).toThrow(
      TypeError,
    );
    expect(() => evidence.terminal.result.nested.values.push(3)).toThrow(
      TypeError,
    );
  });

  it('surfaces component-frame sink failure with the accepted terminal evidence', async () => {
    const failure = new Error('ledger append failed');

    await expect(
      runNodeActivityAttempt({
        startFrame: startFrame(),
        onComponentFrame: (frame) => {
          if (frame.type === 'completed') throw failure;
        },
        handler: () => 'done',
      }),
    ).rejects.toMatchObject({
      name: 'ActivityAttemptDeliveryError',
      code: 'frame-delivery-failed',
      cause: failure,
      terminal: { type: 'completed', result: 'done' },
    });
  });

  it('converts an earlier sink failure into protocol-failed terminal evidence', async () => {
    const failure = new Error('log append failed');
    let caught;

    try {
      await runNodeActivityAttempt({
        startFrame: startFrame(),
        onComponentFrame: (frame) => {
          if (frame.type === 'log') throw failure;
        },
        handler: (_input, runtime) => {
          runtime.logger.info('before failure');
          return 'not authoritative';
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ActivityAttemptDeliveryError);
    expect(caught).toMatchObject({
      cause: failure,
      terminal: {
        type: 'protocol-failed',
        error: { code: 'frame-delivery-failed' },
      },
    });
  });

  it('stops delivery at the first failed component frame and records its prefix', async () => {
    const failure = new Error('first append failed');
    const delivered = /** @type {number[]} */ ([]);
    let caught = /** @type {unknown} */ (null);

    try {
      await runNodeActivityAttempt({
        startFrame: startFrame(),
        onComponentFrame: (frame) => {
          delivered.push(frame.sequence);
          if (frame.sequence === 1) throw failure;
        },
        handler: (_input, runtime) => {
          runtime.logger.info('first');
          runtime.logger.info('second');
          return 'not authoritative';
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ActivityAttemptDeliveryError);
    expect(caught).toMatchObject({
      cause: failure,
      failedComponentSequence: 1,
      acknowledgedComponentSequence: 0,
      terminal: {
        type: 'protocol-failed',
        error: { code: 'frame-delivery-failed' },
      },
    });
    expect(delivered).toEqual([1]);
    const deliveryError = /** @type {ActivityAttemptDeliveryError} */ (caught);
    expect(deliveryError.evidence.frames.map((frame) => frame.type)).toEqual([
      'start',
      'log',
      'log',
      'protocol-failed',
    ]);
  });

  it('bounds a hanging component sink and preserves local protocol evidence', async () => {
    let caught = /** @type {unknown} */ (null);
    try {
      await runNodeActivityAttempt({
        startFrame: startFrame(),
        hostOperationTimeoutMs: 5,
        onComponentFrame: () => new Promise(() => {}),
        handler: (_input, runtime) => {
          runtime.logger.info('this sink never settles');
          return 'not authoritative';
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ActivityAttemptDeliveryError);
    expect(caught).toMatchObject({
      failedComponentSequence: 1,
      acknowledgedComponentSequence: 0,
      terminal: {
        type: 'protocol-failed',
        error: { code: 'frame-delivery-failed' },
      },
    });
    const deliveryError = /** @type {ActivityAttemptDeliveryError} */ (caught);
    expect(deliveryError.cause).toMatchObject({
      code: 'host-operation-timed-out',
    });
  });

  it('bounds a hanging force-termination callback', async () => {
    const controller = new AbortController();
    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      signal: controller.signal,
      cancellationGraceMs: 0,
      hostOperationTimeoutMs: 5,
      forceTerminate: () => new Promise(() => {}),
      handler: () => {
        controller.abort(cancellationReason());
        return new Promise(() => {});
      },
    });

    expect(evidence.status).toBe('protocol-failed');
    expect(evidence.terminal.error).toMatchObject({
      code: 'termination-timed-out',
    });
  });

  it('normalizes hostile oversized cancellation reasons into a terminal outcome', async () => {
    const controller = new AbortController();
    controller.abort({
      name: 'CancellationError',
      code: 'cancel-requested',
      message: 'x'.repeat(2 * 1024 * 1024),
      details: { large: 'x'.repeat(2 * 1024 * 1024) },
    });

    const evidence = await runNodeActivityAttempt({
      startFrame: startFrame(),
      signal: controller.signal,
      handler: jest.fn(),
    });

    expect(evidence.status).toBe('cancelled');
    expect(evidence.terminal.error).toMatchObject({
      code: 'cancel-requested',
      name: 'CancellationError',
      details: {},
    });
    expect(evidence.terminal.error.message.length).toBeLessThanOrEqual(
      16 * 1024,
    );
  });
});

describe('activity-attempt error serialization', () => {
  it('normalizes invalid codes and details without transporting local diagnostics', () => {
    const error = /** @type {Error & {code: any, details: any, cause: any}} */ (
      new Error('broken')
    );
    error.name = 'BrokenError';
    error.code = 'INVALID CODE';
    error.details = { value: undefined };
    error.cause = new Error('secret cause');

    expect(serializeActivityAttemptError(error, 'safe-fallback')).toEqual({
      code: 'safe-fallback',
      name: 'BrokenError',
      message: 'broken',
      details: {},
    });
  });

  it('preserves protocol error identity and its cloned strict JSON details', () => {
    const error = new ActivityAttemptProtocolError(
      'component-frame-invalid',
      'bad component frame',
      { sequence: 2 },
    );

    expect(serializeActivityAttemptError(error)).toEqual({
      code: 'component-frame-invalid',
      name: 'ActivityAttemptProtocolError',
      message: 'bad component frame',
      details: { sequence: 2 },
    });
  });
});
