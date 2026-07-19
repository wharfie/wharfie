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
  getEffectProjectionSortKey,
  getEventSortKey,
  getInvocationProjectionSortKey,
  getRunHeadSortKey,
  getRunProjectionSortKey,
  getTransitionSortKey,
} from '../../src/core/lib/ledger/record-key.js';
import {
  EXECUTION_LEDGER_RUN_DIRECTORY_PARTITION_DOMAIN,
  EXECUTION_LEDGER_RUN_DIRECTORY_SCHEMA_VERSION,
  EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX,
  getExecutionLedgerRunDirectorySortKey,
} from '../../src/core/lib/ledger/run-directory.js';

describe('execution ledger record key codec', () => {
  test('creates typed collision-safe keys for opaque IDs', () => {
    const invocationId = 'invoke/#/运行';
    const attemptId = 'attempt/#/café';
    const effectId = 'effect/#/海';
    const transitionId = 'transition/#/雪';

    expect(EXECUTION_LEDGER_SORT_KEY_PREFIX).toBe('ledger/v9/');
    expect(encodeLedgerKeySegment(invocationId)).toBe(
      Buffer.from(invocationId, 'utf8').toString('base64url'),
    );
    expect(getRunHeadSortKey()).toBe('ledger/v9/head');
    expect(getRunProjectionSortKey()).toBe('ledger/v9/projection/run');
    expect(getInvocationProjectionSortKey(invocationId)).toBe(
      `ledger/v9/projection/invocation/${Buffer.from(invocationId, 'utf8').toString('base64url')}`,
    );
    expect(getAttemptProjectionSortKey(attemptId)).toBe(
      `ledger/v9/projection/attempt/${Buffer.from(attemptId, 'utf8').toString('base64url')}`,
    );
    expect(getEffectProjectionSortKey(invocationId, effectId)).toMatch(
      /^ledger\/v9\/projection\/effect\/wfk_[A-Za-z0-9_-]{43}$/,
    );
    expect(getTransitionSortKey(transitionId)).toBe(
      `ledger/v9/transition/${Buffer.from(transitionId, 'utf8').toString('base64url')}`,
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
    expect(getEffectProjectionSortKey('a/b', 'c')).not.toBe(
      getEffectProjectionSortKey('a', 'b/c'),
    );
    expect(
      Buffer.byteLength(
        getEffectProjectionSortKey(
          'i'.repeat(MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES),
          'e'.repeat(MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES),
        ),
        'utf8',
      ),
    ).toBeLessThanOrEqual(1024);
  });

  test('uses lexically ordered fixed-width event sequences', () => {
    expect(EXECUTION_LEDGER_EVENT_SEQUENCE_WIDTH).toBe(16);
    expect(getEventSortKey(1)).toBe('ledger/v9/event/0000000000000001');
    expect(getEventSortKey(Number.MAX_SAFE_INTEGER)).toBe(
      'ledger/v9/event/9007199254740991',
    );

    const keys = [100, 2, 10, 1].map(getEventSortKey).sort();
    expect(keys).toEqual([1, 2, 10, 100].map(getEventSortKey));

    expect(() => getEventSortKey(0)).toThrow(/positive safe integer/i);
    expect(() => getEventSortKey(1.5)).toThrow(/positive safe integer/i);
    expect(() => getEventSortKey(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /positive safe integer/i,
    );
  });

  test('pairs the V9 ledger with a fresh V7 run-directory namespace', () => {
    expect(EXECUTION_LEDGER_RUN_DIRECTORY_SCHEMA_VERSION).toBe(7);
    expect(EXECUTION_LEDGER_RUN_DIRECTORY_PARTITION_DOMAIN).toBe(
      'wharfie:execution-ledger-run-directory:v7',
    );
    expect(EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX).toBe(
      'ledger-directory/v7/run/',
    );
    expect(
      getExecutionLedgerRunDirectorySortKey({
        createdAt: 1,
        runId: 'run-1',
      }),
    ).toBe('ledger-directory/v7/run/9007199254740990/cnVuLTE');
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
