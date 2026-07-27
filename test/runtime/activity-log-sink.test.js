/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import {
  ExecutionLedgerConflictError,
  ExecutionLedgerProjectionError,
} from '../../src/core/lib/ledger/execution-ledger-contract.js';
import { createDurableActivityLogSink } from '../../src/core/runtime/activity-log-sink.js';

function attempt(overrides = {}) {
  return {
    appId: 'sink-app',
    revisionId: `wrv1_${'A'.repeat(43)}`,
    activityId: 'write-report',
    runId: 'run-1',
    invocationId: 'invocation-1',
    attemptId: 'attempt-1',
    fencingToken: 'private-fence-1',
    generation: 2,
    coordinatorEpoch: 3,
    ...overrides,
  };
}

function logFrame(overrides = {}) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'log',
    attemptId: 'attempt-1',
    sequence: 1,
    level: 'info',
    message: 'report started',
    fields: { partition: 7 },
    ...overrides,
  };
}

describe('durable activity log sink', () => {
  test('snapshots the exact attempt scope and appends only log frames', async () => {
    /** @type {Record<string, any>[]} */
    const calls = [];
    const authority = attempt({ ignoredProjectionField: 'must-not-leak' });
    /** @type {any} */
    const ledger = {
      appendActivityAttemptLog: async (
        /** @type {Record<string, any>} */ input,
      ) => {
        calls.push(input);
        return {
          applied: true,
          attemptId: input.attemptId,
          acknowledgedComponentSequence: input.frame.sequence,
          entryId: 'entry-1',
        };
      },
    };
    const sink = createDurableActivityLogSink({
      ledger,
      attempt: authority,
    });
    authority.fencingToken = 'mutated-after-sink-creation';
    authority.generation = 99;

    const log = logFrame();
    await expect(sink(log)).resolves.toBeUndefined();
    await expect(
      sink({
        protocol: 'wharfie.activity',
        protocolVersion: 1,
        type: 'completed',
        attemptId: log.attemptId,
        sequence: 2,
        result: { ok: true },
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      {
        appId: 'sink-app',
        revisionId: `wrv1_${'A'.repeat(43)}`,
        activityId: 'write-report',
        runId: 'run-1',
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        fencingToken: 'private-fence-1',
        generation: 2,
        coordinatorEpoch: 3,
        frame: log,
      },
    ]);
    expect(calls[0].frame).toBe(log);
  });

  test('ignores non-log frames even when the ledger has no append method', async () => {
    const sink = createDurableActivityLogSink({
      ledger: /** @type {any} */ ({}),
      attempt: attempt(),
    });

    for (const type of ['effect-request', 'completed', 'failed']) {
      await expect(sink({ type })).resolves.toBeUndefined();
    }
  });

  test('accepts an applied-false fulfilled append as durable acknowledgement', async () => {
    /** @type {Record<string, any>[]} */
    const calls = [];
    const sink = createDurableActivityLogSink({
      ledger: /** @type {any} */ ({
        appendActivityAttemptLog: async (
          /** @type {Record<string, any>} */ input,
        ) => {
          calls.push(input);
          return {
            applied: false,
            attemptId: input.attemptId,
            acknowledgedComponentSequence: input.frame.sequence,
            entryId: 'replayed-entry',
          };
        },
      }),
      attempt: attempt(),
    });

    await expect(sink(logFrame())).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test('retries one exact request after opaque response loss', async () => {
    const responseLoss = new Error('durable append response unavailable');
    /** @type {Record<string, any>[]} */
    const calls = [];
    const sink = createDurableActivityLogSink({
      ledger: /** @type {any} */ ({
        appendActivityAttemptLog: async (
          /** @type {Record<string, any>} */ input,
        ) => {
          calls.push(input);
          if (calls.length === 1) throw responseLoss;
          return {
            applied: false,
            attemptId: input.attemptId,
            acknowledgedComponentSequence: input.frame.sequence,
            entryId: 'response-loss-replay',
          };
        },
      }),
      attempt: attempt(),
    });

    await expect(sink(logFrame())).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(calls[0]);
  });

  test.each([
    new TypeError('invalid append request'),
    new RangeError('attempt log budget exhausted'),
    new ExecutionLedgerConflictError('run-1', 'stale append fence'),
    new ExecutionLedgerProjectionError('run-1', 'corrupt retained chain'),
  ])('does not retry definitive append rejection %s', async (rejection) => {
    const appendActivityAttemptLog = jest.fn(async () => {
      throw rejection;
    });
    const sink = createDurableActivityLogSink({
      ledger: /** @type {any} */ ({
        appendActivityAttemptLog,
      }),
      attempt: attempt(),
    });

    await expect(sink(logFrame())).rejects.toBe(rejection);
    expect(appendActivityAttemptLog).toHaveBeenCalledTimes(1);
  });

  test.each([
    Object.assign(new Error('provider request aborted'), {
      name: 'AbortError',
    }),
    Object.assign(new Error('provider request aborted'), {
      code: 'ABORT_ERR',
    }),
  ])(
    'reconciles an ambiguous provider rejection named like cancellation: %s',
    async (rejection) => {
      const appendActivityAttemptLog = jest
        .fn()
        .mockRejectedValueOnce(rejection)
        .mockResolvedValueOnce({
          applied: false,
          attemptId: 'attempt-1',
          acknowledgedComponentSequence: 1,
          entryId: 'replayed-entry',
        });
      const sink = createDurableActivityLogSink({
        ledger: /** @type {any} */ ({ appendActivityAttemptLog }),
        attempt: attempt(),
      });

      await expect(sink(logFrame())).resolves.toBeUndefined();
      expect(appendActivityAttemptLog).toHaveBeenCalledTimes(2);
      expect(appendActivityAttemptLog.mock.calls[1][0]).toBe(
        appendActivityAttemptLog.mock.calls[0][0],
      );
    },
  );

  test('propagates the second opaque rejection without a third append', async () => {
    const first = new Error('first durable append response unavailable');
    const second = new Error('second durable append response unavailable');
    let callCount = 0;
    const appendActivityAttemptLog = jest.fn(async () => {
      callCount += 1;
      throw callCount === 1 ? first : second;
    });
    const sink = createDurableActivityLogSink({
      ledger: /** @type {any} */ ({ appendActivityAttemptLog }),
      attempt: attempt(),
    });

    await expect(sink(logFrame())).rejects.toBe(second);
    expect(appendActivityAttemptLog).toHaveBeenCalledTimes(2);
  });
});
