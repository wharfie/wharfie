/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';

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

  test('propagates append rejection without converting it to acknowledgement', async () => {
    const rejection = new Error('durable append unavailable');
    const sink = createDurableActivityLogSink({
      ledger: /** @type {any} */ ({
        appendActivityAttemptLog: async () => {
          throw rejection;
        },
      }),
      attempt: attempt(),
    });

    await expect(sink(logFrame())).rejects.toBe(rejection);
  });
});
