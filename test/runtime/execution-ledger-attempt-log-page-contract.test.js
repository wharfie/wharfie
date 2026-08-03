/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';

import {
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_SCHEMA_VERSION,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_DEFAULT_LIMIT,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_MAX_LIMIT,
  createExecutionLedgerAttemptLogPage,
  createExecutionLedgerAttemptLogPageCursor,
  normalizeExecutionLedgerAttemptLogPageOptions,
  parseExecutionLedgerAttemptLogPageCursor,
} from '../../src/core/lib/ledger/attempt-log-page.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;

/** @typedef {{appId: string, revisionId: string, activityId: string, runId: string, invocationId: string, attemptId: string, generation: number, coordinatorEpoch: number}} PageScope */
/** @typedef {{entryCount: number, cumulativePayloadBytes: number, lastSequence: number | null}} PageSnapshot */

/** @param {Partial<PageScope>} [overrides] @returns {PageScope} */
function scope(overrides = {}) {
  return {
    appId: 'demo',
    revisionId: REVISION_ID,
    activityId: 'greet',
    runId: 'run-1',
    invocationId: 'main',
    attemptId: 'attempt-1',
    generation: 1,
    coordinatorEpoch: 0,
    ...overrides,
  };
}

/** @param {Partial<PageSnapshot>} [overrides] @returns {PageSnapshot} */
function snapshot(overrides = {}) {
  return {
    entryCount: 3,
    cumulativePayloadBytes: 900,
    lastSequence: 8,
    ...overrides,
  };
}

/** @param {Record<string, any>} value @returns {string} */
function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** @param {string} cursor @returns {Record<string, any>} */
function decodeCursor(cursor) {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
}

describe('execution ledger activity-attempt log page contract', () => {
  test('publishes the bounded page constants and strict request defaults', () => {
    expect(EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_DEFAULT_LIMIT).toBe(50);
    expect(EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_MAX_LIMIT).toBe(100);
    expect(EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES).toBe(4096);
    expect(EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_SCHEMA_VERSION).toBe(1);

    expect(
      normalizeExecutionLedgerAttemptLogPageOptions({
        appId: 'demo',
        runId: 'run-1',
        attemptId: 'attempt-1',
      }),
    ).toEqual({
      appId: 'demo',
      runId: 'run-1',
      attemptId: 'attempt-1',
      limit: 50,
    });
    for (const limit of [0, 101, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        normalizeExecutionLedgerAttemptLogPageOptions({
          appId: 'demo',
          runId: 'run-1',
          attemptId: 'attempt-1',
          limit,
        }),
      ).toThrow(/limit/i);
    }
    expect(() =>
      normalizeExecutionLedgerAttemptLogPageOptions({
        appId: 'demo',
        runId: 'run-1',
        attemptId: 'attempt-1',
        extra: true,
      }),
    ).toThrow();
  });

  test('round-trips one canonical safe cursor without private identifiers', () => {
    const cursor = createExecutionLedgerAttemptLogPageCursor({
      scope: scope(),
      snapshot: snapshot(),
      nextIndex: 2,
      previousSequence: 3,
    });
    expect(Buffer.byteLength(cursor, 'utf8')).toBeLessThanOrEqual(4096);
    expect(parseExecutionLedgerAttemptLogPageCursor(cursor, scope())).toEqual({
      schemaVersion: 1,
      scope: scope(),
      snapshot: snapshot(),
      nextIndex: 2,
      previousSequence: 3,
    });

    const decoded = decodeCursor(cursor);
    expect(Object.keys(decoded)).toEqual([
      'schemaVersion',
      'scope',
      'snapshot',
      'nextIndex',
      'previousSequence',
    ]);
    expect(Object.keys(decoded.scope)).toEqual(Object.keys(scope()));
    expect(JSON.stringify(decoded)).not.toMatch(
      /fenc|partition|entryId|entry_id|payloadRef|payload_ref|reference|attemptLogId/i,
    );
  });

  test('rejects noncanonical, cross-scope, oversized, and forged cursors', () => {
    const cursor = createExecutionLedgerAttemptLogPageCursor({
      scope: scope(),
      snapshot: snapshot(),
      nextIndex: 2,
      previousSequence: 3,
    });
    expect(() =>
      parseExecutionLedgerAttemptLogPageCursor(
        cursor,
        scope({ runId: 'run-2' }),
      ),
    ).toThrow(/scope|snapshot/i);
    expect(() =>
      parseExecutionLedgerAttemptLogPageCursor(`${cursor}=`, scope()),
    ).toThrow(/valid opaque cursor/i);
    expect(() =>
      parseExecutionLedgerAttemptLogPageCursor('a'.repeat(4097), scope()),
    ).toThrow(/bounded/i);

    const forged = decodeCursor(cursor);
    forged.snapshot.lastSequence = 2;
    expect(() =>
      parseExecutionLedgerAttemptLogPageCursor(encodeCursor(forged), scope()),
    ).toThrow(/scope|snapshot/i);

    const extra = decodeCursor(cursor);
    extra.fencingToken = 'must-not-be-accepted';
    expect(() =>
      parseExecutionLedgerAttemptLogPageCursor(encodeCursor(extra), scope()),
    ).toThrow();
  });

  test('constructs one frozen exact safe page and rejects leaked shapes', () => {
    const cursor = createExecutionLedgerAttemptLogPageCursor({
      scope: scope(),
      snapshot: snapshot(),
      nextIndex: 2,
      previousSequence: 3,
    });
    const page = createExecutionLedgerAttemptLogPage({
      disclosure: 'application-sensitive-unredacted',
      scope: scope(),
      snapshot: snapshot(),
      items: [
        {
          sequence: 1,
          acceptedAt: 100,
          level: 'info',
          message: 'first',
          fields: { nested: { raw: true } },
        },
        {
          sequence: 3,
          acceptedAt: 101,
          level: 'warn',
          message: 'second',
          fields: { value: 2 },
        },
      ],
      nextCursor: cursor,
    });
    expect(page).toEqual({
      disclosure: 'application-sensitive-unredacted',
      scope: scope(),
      snapshot: snapshot(),
      items: [
        {
          sequence: 1,
          acceptedAt: 100,
          level: 'info',
          message: 'first',
          fields: { nested: { raw: true } },
        },
        {
          sequence: 3,
          acceptedAt: 101,
          level: 'warn',
          message: 'second',
          fields: { value: 2 },
        },
      ],
      nextCursor: cursor,
    });
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.items[0].fields.nested)).toBe(true);

    expect(() =>
      createExecutionLedgerAttemptLogPage(
        /** @type {any} */ ({
          ...page,
          fencingToken: 'leak',
        }),
      ),
    ).toThrow();
    expect(() =>
      createExecutionLedgerAttemptLogPage({
        ...page,
        items: [...page.items].reverse(),
      }),
    ).toThrow(/increasing/i);
    expect(() =>
      createExecutionLedgerAttemptLogPage({
        disclosure: page.disclosure,
        scope: page.scope,
        snapshot: page.snapshot,
        items: [],
      }),
    ).toThrow(/bounded snapshot page/i);
    expect(() =>
      createExecutionLedgerAttemptLogPage({
        disclosure: page.disclosure,
        scope: page.scope,
        snapshot: page.snapshot,
        items: page.items,
      }),
    ).toThrow(/snapshot tip/i);
    expect(() =>
      createExecutionLedgerAttemptLogPage({
        ...page,
        nextCursor: createExecutionLedgerAttemptLogPageCursor({
          scope: scope(),
          snapshot: snapshot(),
          nextIndex: 1,
          previousSequence: 1,
        }),
      }),
    ).toThrow(/continue/i);
  });

  test('uses an explicit all-zero snapshot for an empty retained log', () => {
    expect(
      createExecutionLedgerAttemptLogPage({
        disclosure: 'application-sensitive-unredacted',
        scope: scope(),
        snapshot: {
          entryCount: 0,
          cumulativePayloadBytes: 0,
          lastSequence: null,
        },
        items: [],
      }),
    ).toEqual({
      disclosure: 'application-sensitive-unredacted',
      scope: scope(),
      snapshot: {
        entryCount: 0,
        cumulativePayloadBytes: 0,
        lastSequence: null,
      },
      items: [],
    });
  });
});
