/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { Buffer } from 'node:buffer';

import {
  EXECUTION_LEDGER_EVENT_SEQUENCE_WIDTH,
  EXECUTION_LEDGER_SORT_KEY_PREFIX,
  MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES,
  assertLedgerOpaqueId,
  encodeLedgerKeySegment,
  getAttemptProjectionSortKey,
  getEventSortKey,
  getInvocationProjectionSortKey,
  getRunHeadSortKey,
  getRunProjectionSortKey,
  getTransitionSortKey,
} from '../../src/core/lib/ledger/record-key.js';

describe('execution ledger record key codec', () => {
  test('creates typed collision-safe keys for opaque IDs', () => {
    const invocationId = 'invoke/#/运行';
    const attemptId = 'attempt/#/café';
    const transitionId = 'transition/#/雪';

    expect(EXECUTION_LEDGER_SORT_KEY_PREFIX).toBe('ledger/v1/');
    expect(encodeLedgerKeySegment(invocationId)).toBe(
      Buffer.from(invocationId, 'utf8').toString('base64url'),
    );
    expect(getRunHeadSortKey()).toBe('ledger/v1/head');
    expect(getRunProjectionSortKey()).toBe('ledger/v1/projection/run');
    expect(getInvocationProjectionSortKey(invocationId)).toBe(
      `ledger/v1/projection/invocation/${Buffer.from(invocationId, 'utf8').toString('base64url')}`,
    );
    expect(getAttemptProjectionSortKey(attemptId)).toBe(
      `ledger/v1/projection/attempt/${Buffer.from(attemptId, 'utf8').toString('base64url')}`,
    );
    expect(getTransitionSortKey(transitionId)).toBe(
      `ledger/v1/transition/${Buffer.from(transitionId, 'utf8').toString('base64url')}`,
    );

    expect(getInvocationProjectionSortKey('a/b')).not.toBe(
      getInvocationProjectionSortKey('a').replace(/$/, '/b'),
    );
    expect(getInvocationProjectionSortKey('same')).not.toBe(
      getAttemptProjectionSortKey('same'),
    );
    expect(getAttemptProjectionSortKey('same')).not.toBe(
      getTransitionSortKey('same'),
    );
  });

  test('uses lexically ordered fixed-width event sequences', () => {
    expect(EXECUTION_LEDGER_EVENT_SEQUENCE_WIDTH).toBe(16);
    expect(getEventSortKey(1)).toBe('ledger/v1/event/0000000000000001');
    expect(getEventSortKey(Number.MAX_SAFE_INTEGER)).toBe(
      'ledger/v1/event/9007199254740991',
    );

    const keys = [100, 2, 10, 1].map(getEventSortKey).sort();
    expect(keys).toEqual([1, 2, 10, 100].map(getEventSortKey));

    expect(() => getEventSortKey(0)).toThrow(/positive safe integer/i);
    expect(() => getEventSortKey(1.5)).toThrow(/positive safe integer/i);
    expect(() => getEventSortKey(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /positive safe integer/i,
    );
  });

  test('rejects malformed or oversized raw and encoded identities', () => {
    expect(() => assertLedgerOpaqueId('')).toThrow(/nonempty string/i);
    expect(() => encodeLedgerKeySegment(/** @type {any} */ (1))).toThrow(
      /nonempty string/i,
    );
    expect(() => getAttemptProjectionSortKey('\ud800')).toThrow(
      /well-formed Unicode/i,
    );
    expect(() =>
      getTransitionSortKey('x'.repeat(MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES)),
    ).not.toThrow();
    expect(() =>
      getTransitionSortKey(
        'x'.repeat(MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES + 1),
      ),
    ).toThrow(/UTF-8 bytes/i);
  });
});
