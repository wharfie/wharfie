import { describe, expect, it } from '@jest/globals';

import {
  ACTIVITY_PROTOCOL_COMPONENT_FRAME_TYPES,
  ACTIVITY_PROTOCOL_HOST_FRAME_TYPES,
  ACTIVITY_PROTOCOL_LOG_LEVELS,
  ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES,
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_REPLAY_PROPERTIES,
  ACTIVITY_PROTOCOL_TERMINAL_TYPES,
  ACTIVITY_PROTOCOL_VERSION,
  ActivityProtocolTranscriptValidator,
  cloneActivityProtocolFrame,
  validateActivityProtocolComponentFrame,
  validateActivityProtocolFrame,
  validateActivityProtocolHostFrame,
} from '../../src/core/runtime/activity-protocol.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const ATTEMPT_ID = 'attempt-1';

/**
 * @param {Record<string, any>} [overrides] - Error field overrides.
 * @returns {any} - Mutable structured error fixture.
 */
function structuredError(overrides = {}) {
  return {
    code: 'activity-failed',
    name: 'Error',
    message: 'activity failed',
    details: { retryable: false },
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} [overrides] - Start field overrides.
 * @returns {any} - Mutable start fixture.
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
    fencingToken: 'opaque-fence-token',
    input: { partition: 7 },
    caller: { metadata: { traceId: 'trace-1' } },
    ...overrides,
  };
}

/**
 * @param {number} [sequence] - Component sequence.
 * @param {Record<string, any>} [overrides] - Log field overrides.
 * @returns {any} - Mutable log fixture.
 */
function logFrame(sequence = 1, overrides = {}) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'log',
    attemptId: ATTEMPT_ID,
    sequence,
    level: 'info',
    message: 'rebuilding index',
    fields: { partition: 7 },
    ...overrides,
  };
}

/**
 * @param {number} [sequence] - Component sequence.
 * @param {string} [effectId] - Effect correlation identity.
 * @param {Record<string, any>} [overrides] - Effect field overrides.
 * @returns {any} - Mutable effect request fixture.
 */
function effectRequestFrame(
  sequence = 1,
  effectId = 'effect-1',
  overrides = {},
) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'effect-request',
    attemptId: ATTEMPT_ID,
    sequence,
    effectId,
    capability: 'object-storage',
    operation: 'put-object',
    input: { key: 'index.json', body: ['one', 'two'] },
    requestedReplayProperties: ['idempotent'],
    ...overrides,
  };
}

/**
 * @param {string} [effectId] - Effect correlation identity.
 * @param {any} [result] - Successful effect result.
 * @param {Record<string, any>} [overrides] - Result field overrides.
 * @returns {any} - Mutable successful effect result fixture.
 */
function effectResultFrame(
  effectId = 'effect-1',
  result = { etag: 'abc' },
  overrides = {},
) {
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
 * @param {string} [effectId] - Effect correlation identity.
 * @param {Record<string, any>} [overrides] - Result field overrides.
 * @returns {any} - Mutable failed effect result fixture.
 */
function failedEffectResultFrame(effectId = 'effect-1', overrides = {}) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'effect-result',
    attemptId: ATTEMPT_ID,
    effectId,
    ok: false,
    error: structuredError({ code: 'effect-failed' }),
    substantiatedReplayProperties: ['unsafe'],
    evidence: { reason: 'destination did not expose a stable result' },
    ...overrides,
  };
}

/**
 * @param {string} type - Terminal type.
 * @param {number} [sequence] - Component sequence.
 * @param {Record<string, any>} [overrides] - Terminal field overrides.
 * @returns {any} - Mutable terminal fixture.
 */
function terminalFrame(type, sequence = 1, overrides = {}) {
  const common = {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type,
    attemptId: ATTEMPT_ID,
    sequence,
  };
  if (type === 'completed') {
    return { ...common, result: { indexed: 2 }, ...overrides };
  }
  return { ...common, error: structuredError(), ...overrides };
}

/**
 * @param {Record<string, any>} [overrides] - Cancel field overrides.
 * @returns {any} - Mutable cancel fixture.
 */
function cancelFrame(overrides = {}) {
  return {
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'cancel',
    attemptId: ATTEMPT_ID,
    reason: structuredError({
      code: 'cancel-requested',
      name: 'CancellationError',
      message: 'operator requested cancellation',
    }),
    ...overrides,
  };
}

describe('Activity Protocol v1 frame validation', () => {
  it('publishes the fixed protocol vocabulary', () => {
    expect(ACTIVITY_PROTOCOL_NAME).toBe('wharfie.activity');
    expect(ACTIVITY_PROTOCOL_VERSION).toBe(1);
    expect(ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES).toBe(1024 * 1024);
    expect(ACTIVITY_PROTOCOL_HOST_FRAME_TYPES).toEqual([
      'start',
      'cancel',
      'effect-result',
    ]);
    expect(ACTIVITY_PROTOCOL_COMPONENT_FRAME_TYPES).toEqual([
      'log',
      'effect-request',
      'completed',
      'failed',
      'cancelled',
      'deadline-exceeded',
      'protocol-failed',
    ]);
    expect(ACTIVITY_PROTOCOL_TERMINAL_TYPES).toEqual([
      'completed',
      'failed',
      'cancelled',
      'deadline-exceeded',
      'protocol-failed',
    ]);
    expect(ACTIVITY_PROTOCOL_LOG_LEVELS).toEqual([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
    ]);
    expect(ACTIVITY_PROTOCOL_REPLAY_PROPERTIES).toEqual([
      'pure',
      'idempotent',
      'transactional',
      'unsafe',
    ]);
  });

  it('independently clones and deeply freezes a start frame', () => {
    const input = startFrame({
      deadlineUnixMs: 2_000_000_000_000,
      input: { values: [1, { nested: true }] },
    });
    const frame = validateActivityProtocolHostFrame(input);

    expect(frame).toEqual(input);
    expect(frame).not.toBe(input);
    expect(frame.input).not.toBe(input.input);
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.input)).toBe(true);
    expect(Object.isFrozen(frame.input.values)).toBe(true);
    expect(Object.isFrozen(frame.caller.metadata)).toBe(true);

    input.input.values[1].nested = false;
    input.caller.metadata.traceId = 'mutated';
    expect(frame.input.values[1].nested).toBe(true);
    expect(frame.caller.metadata.traceId).toBe('trace-1');
    expect(() => {
      frame.input.values.push(3);
    }).toThrow(TypeError);
  });

  it('exposes cloning as an explicit validated transport boundary', () => {
    const input = logFrame();
    const frame = cloneActivityProtocolFrame(input, 'wireFrame');

    expect(frame).toEqual(input);
    expect(frame).not.toBe(input);
    expect(Object.isFrozen(frame.fields)).toBe(true);
  });

  it.each([
    ['null', null],
    ['string scalar', 'done'],
    ['number scalar', 17],
    ['boolean scalar', false],
    ['array', ['one', { two: 2 }]],
    ['object', { indexed: 2 }],
  ])(
    'accepts a completed terminal with a required %s result',
    (_name, result) => {
      const frame = validateActivityProtocolComponentFrame(
        terminalFrame('completed', 1, { result }),
      );

      expect(frame.result).toEqual(result);
      if (result !== null && typeof result === 'object') {
        expect(Object.isFrozen(frame.result)).toBe(true);
      }
    },
  );

  it.each(['failed', 'cancelled', 'deadline-exceeded', 'protocol-failed'])(
    'accepts the structured %s terminal',
    (type) => {
      const frame = validateActivityProtocolComponentFrame(terminalFrame(type));

      expect(frame.type).toBe(type);
      expect(frame.error).toEqual(structuredError());
      expect(Object.isFrozen(frame.error.details)).toBe(true);
    },
  );

  it('accepts log, effect request, cancellation, and both effect result variants', () => {
    expect(validateActivityProtocolComponentFrame(logFrame()).type).toBe('log');
    expect(
      validateActivityProtocolComponentFrame(effectRequestFrame()).type,
    ).toBe('effect-request');
    expect(validateActivityProtocolHostFrame(cancelFrame()).type).toBe(
      'cancel',
    );
    expect(validateActivityProtocolHostFrame(effectResultFrame()).ok).toBe(
      true,
    );
    expect(
      validateActivityProtocolHostFrame(failedEffectResultFrame()).ok,
    ).toBe(false);
  });

  it('accepts canonical composable replay properties and explicit evidence', () => {
    const request = validateActivityProtocolComponentFrame(
      effectRequestFrame(1, 'effect-1', {
        requestedReplayProperties: ['pure', 'idempotent', 'transactional'],
      }),
    );
    const result = validateActivityProtocolHostFrame(
      effectResultFrame('effect-1', null, {
        substantiatedReplayProperties: ['idempotent', 'transactional'],
        evidence: {
          mechanism: 'destination-transaction',
          transactionId: 'transaction-1',
        },
      }),
    );

    expect(request.requestedReplayProperties).toEqual([
      'pure',
      'idempotent',
      'transactional',
    ]);
    expect(result.substantiatedReplayProperties).toEqual([
      'idempotent',
      'transactional',
    ]);
    expect(Object.isFrozen(result.evidence)).toBe(true);
  });

  it.each([
    [
      'empty request',
      () =>
        effectRequestFrame(1, 'effect-1', { requestedReplayProperties: [] }),
      /requestedReplayProperties must be a nonempty array/i,
    ],
    [
      'unknown request property',
      () =>
        effectRequestFrame(1, 'effect-1', {
          requestedReplayProperties: ['exactly-once'],
        }),
      /is not a supported replay property/i,
    ],
    [
      'duplicate request property',
      () =>
        effectRequestFrame(1, 'effect-1', {
          requestedReplayProperties: ['idempotent', 'idempotent'],
        }),
      /must be unique and in canonical replay-property order/i,
    ],
    [
      'out-of-order request properties',
      () =>
        effectRequestFrame(1, 'effect-1', {
          requestedReplayProperties: ['transactional', 'idempotent'],
        }),
      /must be unique and in canonical replay-property order/i,
    ],
    [
      'unsafe request composition',
      () =>
        effectRequestFrame(1, 'effect-1', {
          requestedReplayProperties: ['pure', 'unsafe'],
        }),
      /cannot combine unsafe/i,
    ],
    [
      'unsafe result composition',
      () =>
        effectResultFrame('effect-1', null, {
          substantiatedReplayProperties: ['idempotent', 'unsafe'],
        }),
      /cannot combine unsafe/i,
    ],
    [
      'non-object result evidence',
      () => effectResultFrame('effect-1', null, { evidence: ['claim'] }),
      /evidence must be a JSON object/i,
    ],
  ])('rejects invalid replay-property %s', (_name, makeFrame, pattern) => {
    expect(() => validateActivityProtocolFrame(makeFrame())).toThrow(pattern);
  });

  it('enforces the compact UTF-8 JSON frame-size limit at its exact boundary', () => {
    const frame = startFrame({ input: '' });
    const fixedBytes = Buffer.byteLength(JSON.stringify(frame), 'utf8');
    frame.input = 'x'.repeat(
      ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES - fixedBytes,
    );

    expect(Buffer.byteLength(JSON.stringify(frame), 'utf8')).toBe(
      ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES,
    );
    expect(validateActivityProtocolFrame(frame).input).toHaveLength(
      frame.input.length,
    );

    frame.input += 'x';
    expect(() => validateActivityProtocolFrame(frame)).toThrow(
      new RegExp(
        `encoded JSON size must not exceed ${ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES} bytes`,
        'i',
      ),
    );
  });

  it.each([
    [
      'protocol name',
      () => startFrame({ protocol: 'wharfie.activity.other' }),
      /protocol must be 'wharfie\.activity'/i,
    ],
    [
      'protocol version',
      () => startFrame({ protocolVersion: 2 }),
      /protocolVersion must be the integer 1/i,
    ],
    [
      'non-integer protocol version',
      () => startFrame({ protocolVersion: '1' }),
      /protocolVersion must be the integer 1/i,
    ],
    [
      'frame type',
      () => startFrame({ type: 'heartbeat' }),
      /type is not a supported frame type/i,
    ],
  ])('rejects an unknown or malformed %s', (_name, makeFrame, pattern) => {
    expect(() => validateActivityProtocolFrame(makeFrame())).toThrow(pattern);
  });

  it('enforces frame direction', () => {
    expect(() => validateActivityProtocolHostFrame(logFrame())).toThrow(
      /not a host frame type/i,
    );
    expect(() => validateActivityProtocolComponentFrame(startFrame())).toThrow(
      /not a component frame type/i,
    );
  });

  it.each([
    [
      'start top level',
      () => startFrame({ workerId: 'not-versioned' }),
      /frame\.workerId is not supported/i,
    ],
    [
      'caller namespace',
      () =>
        startFrame({
          caller: { metadata: {}, credentials: { token: 'secret' } },
        }),
      /frame\.caller\.credentials is not supported/i,
    ],
    [
      'structured error',
      () =>
        terminalFrame('failed', 1, {
          error: structuredError({ stack: 'not-on-the-wire' }),
        }),
      /frame\.error\.stack is not supported/i,
    ],
    [
      'successful effect result union',
      () => effectResultFrame('effect-1', null, { error: structuredError() }),
      /frame\.error is not supported/i,
    ],
    [
      'failed effect result union',
      () => failedEffectResultFrame('effect-1', { result: null }),
      /frame\.result is not supported/i,
    ],
  ])('rejects an unknown field in the %s', (_name, makeFrame, pattern) => {
    expect(() => validateActivityProtocolFrame(makeFrame())).toThrow(pattern);
  });

  it.each([
    [
      'start input',
      () => {
        const frame = startFrame();
        delete frame.input;
        return frame;
      },
      /frame\.input is required/i,
    ],
    [
      'caller metadata',
      () => startFrame({ caller: {} }),
      /frame\.caller\.metadata is required/i,
    ],
    [
      'completed result',
      () => {
        const frame = terminalFrame('completed');
        delete frame.result;
        return frame;
      },
      /frame\.result is required/i,
    ],
    [
      'failed error',
      () => {
        const frame = terminalFrame('failed');
        delete frame.error;
        return frame;
      },
      /frame\.error is required/i,
    ],
    [
      'successful effect result',
      () => {
        const frame = effectResultFrame();
        delete frame.result;
        return frame;
      },
      /frame\.result is required/i,
    ],
  ])('requires the %s field', (_name, makeFrame, pattern) => {
    expect(() => validateActivityProtocolFrame(makeFrame())).toThrow(pattern);
  });

  it.each([
    [
      'revision identity',
      () => startFrame({ revisionId: 'revision-1' }),
      /revisionId/i,
    ],
    [
      'activity logical identity',
      () => startFrame({ activityId: 'Not Canonical' }),
      /activityId must be a canonical logical ID/i,
    ],
    [
      'empty run identity',
      () => startFrame({ runId: '' }),
      /runId must be a nonempty opaque string/i,
    ],
    [
      'empty invocation identity',
      () => startFrame({ invocationId: '' }),
      /invocationId must be a nonempty opaque string/i,
    ],
    [
      'empty attempt identity',
      () => startFrame({ attemptId: '' }),
      /attemptId must be a nonempty opaque string/i,
    ],
    [
      'non-string fence token',
      () => startFrame({ fencingToken: 7 }),
      /fencingToken must be a nonempty opaque string/i,
    ],
    [
      'caller metadata object',
      () => startFrame({ caller: { metadata: [] } }),
      /caller\.metadata must be a JSON object/i,
    ],
    [
      'absolute deadline',
      () => startFrame({ deadlineUnixMs: 0 }),
      /deadlineUnixMs must be a positive safe integer/i,
    ],
    [
      'component sequence',
      () => logFrame(0),
      /sequence must be a positive safe integer/i,
    ],
    [
      'fractional component sequence',
      () => logFrame(1.5),
      /sequence must be a positive safe integer/i,
    ],
    [
      'log level',
      () => logFrame(1, { level: 'notice' }),
      /level is not a supported log level/i,
    ],
    [
      'effect capability',
      () => effectRequestFrame(1, 'effect-1', { capability: 'ObjectStorage' }),
      /capability must be a canonical logical ID/i,
    ],
    [
      'effect operation',
      () => effectRequestFrame(1, 'effect-1', { operation: '' }),
      /operation must be a canonical logical ID/i,
    ],
    [
      'effect result discriminator',
      () => effectResultFrame('effect-1', null, { ok: 'true' }),
      /ok must be a boolean/i,
    ],
  ])('rejects an invalid %s', (_name, makeFrame, pattern) => {
    expect(() => validateActivityProtocolFrame(makeFrame())).toThrow(pattern);
  });

  it.each([
    [
      'nested undefined',
      () => startFrame({ input: { value: undefined } }),
      /unsupported undefined/i,
    ],
    ['bigint', () => startFrame({ input: 1n }), /unsupported bigint/i],
    [
      'non-finite number',
      () => startFrame({ input: Number.POSITIVE_INFINITY }),
      /finite JSON number/i,
    ],
    [
      'negative zero',
      () => startFrame({ input: -0 }),
      /must not contain negative zero/i,
    ],
    [
      'date object',
      () => startFrame({ input: new Date(0) }),
      /plain JSON object/i,
    ],
    [
      'sparse array',
      () => startFrame({ input: new Array(1) }),
      /sparse array/i,
    ],
  ])('enforces strict transport JSON for %s', (_name, makeFrame, pattern) => {
    expect(() => validateActivityProtocolFrame(makeFrame())).toThrow(pattern);
  });

  it.each([
    [
      'error code',
      () => structuredError({ code: 'NOT_CANONICAL' }),
      /error\.code must be a canonical logical ID/i,
    ],
    [
      'error name',
      () => structuredError({ name: '' }),
      /error\.name must be a nonempty opaque string/i,
    ],
    [
      'error message',
      () => structuredError({ message: 7 }),
      /error\.message must be a string/i,
    ],
    [
      'error details',
      () => structuredError({ details: [] }),
      /error\.details must be a JSON object/i,
    ],
  ])('rejects an invalid structured %s', (_name, makeError, pattern) => {
    expect(() =>
      validateActivityProtocolFrame(
        terminalFrame('failed', 1, { error: makeError() }),
      ),
    ).toThrow(pattern);
  });
});

describe('Activity Protocol v1 transcript validation', () => {
  it('accepts an ordered effectful transcript and exposes immutable state', () => {
    const transcript = new ActivityProtocolTranscriptValidator();

    transcript.acceptHostFrame(startFrame());
    transcript.acceptComponentFrame(logFrame(1));
    transcript.acceptComponentFrame(effectRequestFrame(2));
    transcript.acceptHostFrame(effectResultFrame());
    transcript.acceptComponentFrame(logFrame(3, { message: 'effect done' }));
    transcript.acceptComponentFrame(
      terminalFrame('completed', 4, { result: ['index.json', 2] }),
    );

    const snapshot = transcript.snapshot();
    expect(snapshot).toEqual({
      started: true,
      attemptId: ATTEMPT_ID,
      nextComponentSequence: 5,
      cancelRequested: false,
      pendingEffectIds: [],
      terminalType: 'completed',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.pendingEffectIds)).toBe(true);
    expect(() => snapshot.pendingEffectIds.push('mutated')).toThrow(TypeError);
  });

  it('requires exactly one start before any other frame', () => {
    const componentFirst = new ActivityProtocolTranscriptValidator();
    expect(() => componentFirst.acceptComponentFrame(logFrame())).toThrow(
      /before a start frame/i,
    );

    const hostFirst = new ActivityProtocolTranscriptValidator();
    expect(() => hostFirst.acceptHostFrame(cancelFrame())).toThrow(
      /before a start frame/i,
    );

    const transcript = new ActivityProtocolTranscriptValidator();
    transcript.acceptHostFrame(startFrame());
    expect(() => transcript.acceptHostFrame(startFrame())).toThrow(
      /exactly one start frame/i,
    );
  });

  it('enforces a contiguous monotonic component sequence without consuming rejected frames', () => {
    const transcript = new ActivityProtocolTranscriptValidator();
    transcript.acceptHostFrame(startFrame());

    expect(() => transcript.acceptComponentFrame(logFrame(2))).toThrow(
      /sequence must be 1; received 2/i,
    );
    transcript.acceptComponentFrame(logFrame(1));
    expect(() => transcript.acceptComponentFrame(logFrame(1))).toThrow(
      /sequence must be 2; received 1/i,
    );
    expect(() => transcript.acceptComponentFrame(logFrame(3))).toThrow(
      /sequence must be 2; received 3/i,
    );
    transcript.acceptComponentFrame(logFrame(2));

    expect(transcript.snapshot().nextComponentSequence).toBe(3);
  });

  it('binds every later frame to the started attempt', () => {
    const transcript = new ActivityProtocolTranscriptValidator();
    transcript.acceptHostFrame(startFrame());

    expect(() =>
      transcript.acceptComponentFrame(
        logFrame(1, { attemptId: 'different-attempt' }),
      ),
    ).toThrow(/attemptId does not match/i);
    expect(() =>
      transcript.acceptHostFrame(
        cancelFrame({ attemptId: 'different-attempt' }),
      ),
    ).toThrow(/attemptId does not match/i);
  });

  it('correlates each effect result exactly once and never reuses an effect identity', () => {
    const transcript = new ActivityProtocolTranscriptValidator();
    transcript.acceptHostFrame(startFrame());

    expect(() =>
      transcript.acceptHostFrame(effectResultFrame('unknown-effect')),
    ).toThrow(/does not correlate to a pending effect request/i);

    transcript.acceptComponentFrame(effectRequestFrame(1));
    transcript.acceptHostFrame(failedEffectResultFrame());
    expect(() => transcript.acceptHostFrame(effectResultFrame())).toThrow(
      /does not correlate to a pending effect request/i,
    );
    expect(() =>
      transcript.acceptComponentFrame(effectRequestFrame(2)),
    ).toThrow(/was already used in this attempt/i);

    transcript.acceptComponentFrame(
      effectRequestFrame(2, 'effect-2', { input: null }),
    );
    expect(transcript.snapshot().pendingEffectIds).toEqual(['effect-2']);
  });

  it('rejects a successful effect result that downgrades a requested replay guarantee', () => {
    const transcript = new ActivityProtocolTranscriptValidator();
    transcript.acceptHostFrame(startFrame());
    transcript.acceptComponentFrame(
      effectRequestFrame(1, 'effect-1', {
        requestedReplayProperties: ['idempotent', 'transactional'],
      }),
    );

    expect(() =>
      transcript.acceptHostFrame(
        effectResultFrame(
          'effect-1',
          { written: true },
          {
            substantiatedReplayProperties: ['idempotent'],
          },
        ),
      ),
    ).toThrow(/does not satisfy requested replay properties: transactional/i);
    expect(transcript.snapshot().pendingEffectIds).toEqual(['effect-1']);

    transcript.acceptHostFrame(
      failedEffectResultFrame('effect-1', {
        substantiatedReplayProperties: ['unsafe'],
      }),
    );
    expect(transcript.snapshot().pendingEffectIds).toEqual([]);
  });

  it('does not allow successful completion while an effect is pending', () => {
    const transcript = new ActivityProtocolTranscriptValidator();
    transcript.acceptHostFrame(startFrame());
    transcript.acceptComponentFrame(effectRequestFrame(1));

    expect(() =>
      transcript.acceptComponentFrame(terminalFrame('completed', 2)),
    ).toThrow(/cannot leave pending effect requests/i);
    expect(transcript.snapshot().nextComponentSequence).toBe(2);

    transcript.acceptHostFrame(effectResultFrame());
    transcript.acceptComponentFrame(terminalFrame('completed', 2));
    expect(transcript.snapshot().terminalType).toBe('completed');
  });

  it('models cancellation as a single host request followed by a component terminal', () => {
    const transcript = new ActivityProtocolTranscriptValidator();
    transcript.acceptHostFrame(startFrame());
    transcript.acceptComponentFrame(logFrame(1));
    transcript.acceptHostFrame(cancelFrame());

    expect(() => transcript.acceptHostFrame(cancelFrame())).toThrow(
      /at most one cancel frame/i,
    );
    expect(() =>
      transcript.acceptComponentFrame(effectRequestFrame(2)),
    ).toThrow(/cannot request a new effect after cancellation/i);
    transcript.acceptComponentFrame(logFrame(2, { message: 'cleaning up' }));
    transcript.acceptComponentFrame(terminalFrame('cancelled', 3));

    expect(transcript.snapshot()).toMatchObject({
      cancelRequested: true,
      nextComponentSequence: 4,
      terminalType: 'cancelled',
    });
  });

  it('requires the triggering condition for cancelled and deadline terminals', () => {
    const withoutCancel = new ActivityProtocolTranscriptValidator();
    withoutCancel.acceptHostFrame(startFrame());
    expect(() =>
      withoutCancel.acceptComponentFrame(terminalFrame('cancelled')),
    ).toThrow(/requires a preceding host cancel frame/i);

    const withoutDeadline = new ActivityProtocolTranscriptValidator();
    withoutDeadline.acceptHostFrame(startFrame());
    expect(() =>
      withoutDeadline.acceptComponentFrame(terminalFrame('deadline-exceeded')),
    ).toThrow(/requires a deadline on the start frame/i);

    const withDeadline = new ActivityProtocolTranscriptValidator();
    withDeadline.acceptHostFrame(startFrame({ deadlineUnixMs: 1000 }));
    withDeadline.acceptComponentFrame(terminalFrame('deadline-exceeded'));
    expect(withDeadline.snapshot().terminalType).toBe('deadline-exceeded');
  });

  it('allows an error terminal to abandon pending effects', () => {
    const transcript = new ActivityProtocolTranscriptValidator();
    transcript.acceptHostFrame(startFrame());
    transcript.acceptComponentFrame(effectRequestFrame(1));
    transcript.acceptComponentFrame(terminalFrame('failed', 2));

    expect(transcript.snapshot()).toMatchObject({
      pendingEffectIds: [],
      terminalType: 'failed',
    });
  });

  it.each(ACTIVITY_PROTOCOL_TERMINAL_TYPES)(
    'rejects every frame after the %s terminal',
    (terminalType) => {
      const transcript = new ActivityProtocolTranscriptValidator();
      const start =
        terminalType === 'deadline-exceeded'
          ? startFrame({ deadlineUnixMs: 1000 })
          : startFrame();
      transcript.acceptHostFrame(start);
      if (terminalType === 'cancelled') {
        transcript.acceptHostFrame(cancelFrame());
      }
      transcript.acceptComponentFrame(terminalFrame(terminalType));

      expect(() => transcript.acceptComponentFrame(logFrame(2))).toThrow(
        /cannot be accepted after terminal/i,
      );
      expect(() => transcript.acceptHostFrame(cancelFrame())).toThrow(
        /cannot be accepted after terminal/i,
      );
      expect(() =>
        transcript.acceptComponentFrame(terminalFrame('failed', 2)),
      ).toThrow(/duplicate terminal/i);
    },
  );
});
