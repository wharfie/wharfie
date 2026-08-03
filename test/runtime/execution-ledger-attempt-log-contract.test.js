/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';

import { ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES } from '../../src/core/runtime/activity-protocol.js';
import {
  createExecutionPayloadReference,
  encodeCanonicalJsonPayload,
  verifyExecutionPayloadReference,
} from '../../src/core/runtime/execution-payload.js';
import {
  EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE,
  EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_PREFIX,
  EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_RECORD_TYPE,
  EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX,
  EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_RECORD_TYPE,
  EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY,
  EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES,
  EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES,
  EXECUTION_LEDGER_ATTEMPT_LOG_PARTITION_PREFIX,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAYLOAD_SCHEMA,
  EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION,
  advanceExecutionLedgerAttemptLogHeadRecord,
  createExecutionLedgerAttemptLogEntryRecord,
  createExecutionLedgerAttemptLogScope,
  createInitialExecutionLedgerAttemptLogHeadRecord,
  getExecutionLedgerAttemptLogEntrySortKey,
  getExecutionLedgerAttemptLogHeadSortKey,
  normalizeExecutionLedgerAttemptLogEntryRecord,
  normalizeExecutionLedgerAttemptLogHeadRecord,
  parseExecutionLedgerAttemptLogEntrySortKey,
} from '../../src/core/lib/ledger/attempt-log.js';
import { EXECUTION_LEDGER_SCHEMA_VERSION } from '../../src/core/lib/ledger/execution-ledger-contract.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const OTHER_REVISION_ID = `wrv1_${'Q'.repeat(43)}`;
const FENCING_TOKEN = 'private-fence-do-not-retain';

/**
 * @param {Record<string, any>} [overrides]
 * @returns {any}
 */
function scope(overrides = {}) {
  return {
    appId: 'log-app',
    revisionId: REVISION_ID,
    activityId: 'build-index',
    runId: 'run/#/一',
    invocationId: 'invocation/#/二',
    attemptId: 'attempt/#/三',
    generation: 1,
    coordinatorEpoch: 0,
    fencingToken: FENCING_TOKEN,
    ...overrides,
  };
}

/**
 * @param {number} sequence
 * @param {string} [level]
 * @param {string} [message]
 * @returns {Record<string, any>}
 */
function logFrame(sequence, level = 'info', message = `message-${sequence}`) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'log',
    attemptId: scope().attemptId,
    sequence,
    level,
    message,
    fields: { sequence },
  };
}

/**
 * @param {Record<string, any>} frame
 * @returns {{bytes: Buffer, payloadRef: any}}
 */
function payload(frame) {
  const bytes = encodeCanonicalJsonPayload(frame);
  const created = createExecutionPayloadReference({
    bytes,
    payloadSchema: EXECUTION_LEDGER_ATTEMPT_LOG_PAYLOAD_SCHEMA,
    storeId: 'attempt-log-test',
  });
  const payloadRef = verifyExecutionPayloadReference(created, bytes).reference;
  return { bytes, payloadRef };
}

/**
 * @param {{
 *   fullScope?: any,
 *   sequence?: number,
 *   level?: string,
 *   acceptedAt?: number,
 *   previousEntryId?: string | null,
 *   message?: string,
 * }} [options]
 * @returns {any}
 */
function entry({
  fullScope = scope(),
  sequence = 2,
  level = 'info',
  acceptedAt = 1_700_000_000_001,
  previousEntryId = null,
  message,
} = {}) {
  const frame = logFrame(sequence, level, message);
  const { bytes, payloadRef } = payload(frame);
  return createExecutionLedgerAttemptLogEntryRecord({
    scope: fullScope,
    sequence,
    level,
    payloadRef,
    canonicalPayloadBytes: bytes.byteLength,
    acceptedAt,
    previousEntryId,
  });
}

/**
 * @param {any} value
 * @returns {any}
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('execution ledger attempt-log contract', () => {
  test('derives one frozen non-secret partition identity from the full fence scope', () => {
    const input = scope();
    const derived = createExecutionLedgerAttemptLogScope(input);

    expect(derived).toEqual({
      attemptLogId: expect.stringMatching(
        new RegExp(
          `^${EXECUTION_LEDGER_ATTEMPT_LOG_PARTITION_PREFIX}_[A-Za-z0-9_-]{43}$`,
        ),
      ),
      appId: input.appId,
      revisionId: input.revisionId,
      activityId: input.activityId,
      runId: input.runId,
      invocationId: input.invocationId,
      attemptId: input.attemptId,
      generation: input.generation,
      coordinatorEpoch: input.coordinatorEpoch,
    });
    expect(derived).not.toHaveProperty('fencingToken');
    expect(JSON.stringify(derived)).not.toContain(FENCING_TOKEN);
    expect(Object.isFrozen(derived)).toBe(true);

    const reordered = {
      fencingToken: input.fencingToken,
      coordinatorEpoch: input.coordinatorEpoch,
      generation: input.generation,
      attemptId: input.attemptId,
      invocationId: input.invocationId,
      runId: input.runId,
      activityId: input.activityId,
      revisionId: input.revisionId,
      appId: input.appId,
    };
    expect(createExecutionLedgerAttemptLogScope(reordered)).toEqual(derived);

    const changes = [
      { appId: 'other-app' },
      { revisionId: OTHER_REVISION_ID },
      { activityId: 'other-activity' },
      { runId: 'other-run' },
      { invocationId: 'other-invocation' },
      { attemptId: 'other-attempt' },
      { generation: 2 },
      { coordinatorEpoch: 1 },
      { fencingToken: 'other-private-fence' },
    ];
    for (const change of changes) {
      expect(
        createExecutionLedgerAttemptLogScope(scope(change)).attemptLogId,
      ).not.toBe(derived.attemptLogId);
    }
  });

  test('rejects incomplete, unknown, malformed, and oversized private scope fields', () => {
    const missingFence = /** @type {any} */ (scope());
    delete missingFence.fencingToken;
    expect(() => createExecutionLedgerAttemptLogScope(missingFence)).toThrow(
      /exactly/i,
    );
    expect(() =>
      createExecutionLedgerAttemptLogScope(
        /** @type {any} */ ({
          ...scope(),
          extra: true,
        }),
      ),
    ).toThrow(/exactly/i);
    expect(() =>
      createExecutionLedgerAttemptLogScope(scope({ appId: 'Not-Canonical' })),
    ).toThrow(/canonical logical ID/i);
    expect(() =>
      createExecutionLedgerAttemptLogScope(scope({ revisionId: 'revision-1' })),
    ).toThrow(/canonical wrv1_/i);
    expect(() =>
      createExecutionLedgerAttemptLogScope(scope({ generation: 0 })),
    ).toThrow(/positive safe integer/i);
    expect(() =>
      createExecutionLedgerAttemptLogScope(scope({ coordinatorEpoch: -1 })),
    ).toThrow(/nonnegative safe integer/i);
    expect(() =>
      createExecutionLedgerAttemptLogScope(
        scope({ fencingToken: 'x'.repeat(513) }),
      ),
    ).toThrow(/512 UTF-8 bytes/i);
  });

  test('uses canonical fixed-width sparse sequence keys', () => {
    expect(getExecutionLedgerAttemptLogHeadSortKey()).toBe(
      EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY,
    );
    expect(getExecutionLedgerAttemptLogEntrySortKey(1)).toBe(
      `${EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX}0000000000000001`,
    );
    expect(
      getExecutionLedgerAttemptLogEntrySortKey(Number.MAX_SAFE_INTEGER),
    ).toBe(
      `${EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX}9007199254740991`,
    );
    const keys = [100, 2, 9, 1].map(getExecutionLedgerAttemptLogEntrySortKey);
    expect([...keys].sort()).toEqual(
      [1, 2, 9, 100].map(getExecutionLedgerAttemptLogEntrySortKey),
    );
    for (const sequence of [1, 2, 9, 100, Number.MAX_SAFE_INTEGER]) {
      expect(
        parseExecutionLedgerAttemptLogEntrySortKey(
          getExecutionLedgerAttemptLogEntrySortKey(sequence),
        ),
      ).toBe(sequence);
    }
    for (const invalid of [
      EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX,
      `${EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX}0`,
      `${EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX}0000000000000000`,
      `${EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX}00000000000000x1`,
      `${EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX}00000000000000001`,
      'ledger/v10/event/0000000000000001',
    ]) {
      expect(() =>
        parseExecutionLedgerAttemptLogEntrySortKey(invalid),
      ).toThrow();
    }
  });

  test('constructs and revalidates a frozen immutable sensitive-data entry', () => {
    const fullScope = scope();
    const frame = logFrame(2, 'warn');
    const { bytes, payloadRef } = payload(frame);
    const acceptedAt = 1_700_000_000_123;
    const record = createExecutionLedgerAttemptLogEntryRecord({
      scope: fullScope,
      sequence: frame.sequence,
      level: frame.level,
      payloadRef,
      canonicalPayloadBytes: bytes.byteLength,
      acceptedAt,
      previousEntryId: null,
    });
    const derivedScope = createExecutionLedgerAttemptLogScope(fullScope);

    expect(record).toEqual({
      run_id: derivedScope.attemptLogId,
      sort_key: getExecutionLedgerAttemptLogEntrySortKey(2),
      record_type: EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_RECORD_TYPE,
      schema_version: EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION,
      ledger_schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
      app_id: fullScope.appId,
      revision_id: fullScope.revisionId,
      activity_id: fullScope.activityId,
      ledger_run_id: fullScope.runId,
      invocation_id: fullScope.invocationId,
      attempt_id: fullScope.attemptId,
      generation: fullScope.generation,
      coordinator_epoch: fullScope.coordinatorEpoch,
      disclosure: EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE,
      protocol_sequence: 2,
      level: 'warn',
      payload_ref: payloadRef,
      canonical_payload_bytes: bytes.byteLength,
      accepted_at: acceptedAt,
      previous_entry_id: null,
      entry_id: expect.stringMatching(
        new RegExp(
          `^${EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_PREFIX}_[A-Za-z0-9_-]{43}$`,
        ),
      ),
    });
    expect(record).not.toHaveProperty('fencing_token');
    expect(JSON.stringify(record)).not.toContain(FENCING_TOKEN);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.payload_ref)).toBe(true);
    expect(Object.isFrozen(record.payload_ref.storage)).toBe(true);
    const normalized = normalizeExecutionLedgerAttemptLogEntryRecord(
      clone(record),
      fullScope,
    );
    expect(normalized).toEqual(record);
    expect(Object.isFrozen(normalized)).toBe(true);
  });

  test('binds entry identity to every retained field and the prior hash link', () => {
    const first = entry();
    const same = entry();
    expect(same.entry_id).toBe(first.entry_id);

    const changed = [
      entry({ level: 'warn' }),
      entry({ acceptedAt: first.accepted_at + 1 }),
      entry({ sequence: 3 }),
      entry({ message: 'different-message' }),
      entry({ previousEntryId: first.entry_id }),
      entry({ fullScope: scope({ fencingToken: 'other-fence' }) }),
    ];
    for (const candidate of changed) {
      expect(candidate.entry_id).not.toBe(first.entry_id);
    }

    const second = entry({
      sequence: 5,
      previousEntryId: first.entry_id,
    });
    expect(second.previous_entry_id).toBe(first.entry_id);
    expect(second.entry_id).not.toBe(first.entry_id);
  });

  test('rejects entry input and retained-record corruption without retaining a raw fence', () => {
    const frame = logFrame(2);
    const { bytes, payloadRef } = payload(frame);
    const base = {
      scope: scope(),
      sequence: frame.sequence,
      level: frame.level,
      payloadRef,
      canonicalPayloadBytes: bytes.byteLength,
      acceptedAt: 1,
      previousEntryId: null,
    };
    expect(() =>
      createExecutionLedgerAttemptLogEntryRecord({
        ...base,
        canonicalPayloadBytes: bytes.byteLength + 1,
      }),
    ).toThrow(/must equal payloadRef.size/i);
    expect(() =>
      createExecutionLedgerAttemptLogEntryRecord({
        ...base,
        level: 'fatal',
      }),
    ).toThrow(/supported activity log level/i);
    expect(() =>
      createExecutionLedgerAttemptLogEntryRecord({
        ...base,
        sequence: 0,
      }),
    ).toThrow(/positive safe integer/i);
    expect(() =>
      createExecutionLedgerAttemptLogEntryRecord({
        ...base,
        acceptedAt: -1,
      }),
    ).toThrow(/nonnegative safe integer/i);
    expect(() =>
      createExecutionLedgerAttemptLogEntryRecord({
        ...base,
        previousEntryId: 'not-an-entry',
      }),
    ).toThrow(/canonical wge_/i);
    expect(() =>
      createExecutionLedgerAttemptLogEntryRecord(
        /** @type {any} */ ({
          ...base,
          extra: true,
        }),
      ),
    ).toThrow(/exactly/i);

    const oversizedRef = clone(payloadRef);
    oversizedRef.size = ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES + 1;
    expect(() =>
      createExecutionLedgerAttemptLogEntryRecord({
        ...base,
        payloadRef: oversizedRef,
        canonicalPayloadBytes: oversizedRef.size,
      }),
    ).toThrow(/Activity Protocol frame limit/i);

    const wrongSchemaRef = clone(payloadRef);
    wrongSchemaRef.payloadSchema = 'wharfie.execution.activity-evidence.v1';
    expect(() =>
      createExecutionLedgerAttemptLogEntryRecord({
        ...base,
        payloadRef: wrongSchemaRef,
      }),
    ).toThrow(/payloadSchema/i);

    const record = entry();
    const corruptions = [
      {
        property: 'run_id',
        value: 'wlg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      {
        property: 'sort_key',
        value: getExecutionLedgerAttemptLogEntrySortKey(3),
      },
      {
        property: 'record_type',
        value: EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_RECORD_TYPE,
      },
      { property: 'schema_version', value: 2 },
      { property: 'ledger_schema_version', value: 9 },
      { property: 'app_id', value: 'other-app' },
      { property: 'protocol_sequence', value: 3 },
      { property: 'level', value: 'fatal' },
      {
        property: 'canonical_payload_bytes',
        value: record.canonical_payload_bytes + 1,
      },
      { property: 'accepted_at', value: -1 },
      { property: 'previous_entry_id', value: 'not-an-entry' },
      {
        property: 'entry_id',
        value: `${EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_PREFIX}_${'A'.repeat(43)}`,
      },
      { property: 'disclosure', value: 'public' },
    ];
    for (const { property, value } of corruptions) {
      expect(() =>
        normalizeExecutionLedgerAttemptLogEntryRecord(
          { ...clone(record), [property]: value },
          scope(),
        ),
      ).toThrow();
    }
    expect(() =>
      normalizeExecutionLedgerAttemptLogEntryRecord(
        { ...clone(record), fencing_token: FENCING_TOKEN },
        scope(),
      ),
    ).toThrow(/exactly/i);
    expect(() =>
      normalizeExecutionLedgerAttemptLogEntryRecord(
        record,
        scope({ fencingToken: 'wrong-fence' }),
      ),
    ).toThrow(/expected attempt scope/i);
  });

  test('creates and advances a frozen head through sparse hash-linked entries', () => {
    const fullScope = scope();
    const first = entry({ fullScope, sequence: 2 });
    const initial = createInitialExecutionLedgerAttemptLogHeadRecord({
      scope: fullScope,
      entry: first,
    });
    expect(initial).toMatchObject({
      run_id: first.run_id,
      sort_key: EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY,
      record_type: EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_RECORD_TYPE,
      disclosure: EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE,
      last_protocol_sequence: 2,
      last_entry_id: first.entry_id,
      entry_count: 1,
      cumulative_payload_bytes: first.canonical_payload_bytes,
      version: 1,
    });
    expect(initial).not.toHaveProperty('fencing_token');
    expect(JSON.stringify(initial)).not.toContain(FENCING_TOKEN);
    expect(Object.isFrozen(initial)).toBe(true);

    const second = entry({
      fullScope,
      sequence: 5,
      level: 'debug',
      previousEntryId: first.entry_id,
    });
    const advanced = advanceExecutionLedgerAttemptLogHeadRecord({
      scope: fullScope,
      previousHead: initial,
      entry: second,
    });
    expect(advanced).toEqual({
      ...initial,
      last_protocol_sequence: 5,
      last_entry_id: second.entry_id,
      entry_count: 2,
      cumulative_payload_bytes:
        first.canonical_payload_bytes + second.canonical_payload_bytes,
      version: 2,
    });
    expect(Object.isFrozen(advanced)).toBe(true);
    expect(
      normalizeExecutionLedgerAttemptLogHeadRecord(clone(advanced), fullScope),
    ).toEqual(advanced);
  });

  test('rejects a broken chain, non-increasing sequence, or non-first initial entry', () => {
    const first = entry({ sequence: 2 });
    const initial = createInitialExecutionLedgerAttemptLogHeadRecord({
      scope: scope(),
      entry: first,
    });
    const nonFirst = entry({
      sequence: 5,
      previousEntryId: first.entry_id,
    });
    expect(() =>
      createInitialExecutionLedgerAttemptLogHeadRecord({
        scope: scope(),
        entry: nonFirst,
      }),
    ).toThrow(/must be null/i);

    const outOfOrder = entry({
      sequence: 2,
      previousEntryId: first.entry_id,
    });
    expect(() =>
      advanceExecutionLedgerAttemptLogHeadRecord({
        scope: scope(),
        previousHead: initial,
        entry: outOfOrder,
      }),
    ).toThrow(/must increase/i);

    const unrelated = entry({ sequence: 7 });
    const broken = entry({
      sequence: 8,
      previousEntryId: unrelated.entry_id,
    });
    expect(() =>
      advanceExecutionLedgerAttemptLogHeadRecord({
        scope: scope(),
        previousHead: initial,
        entry: broken,
      }),
    ).toThrow(/does not link/i);
  });

  test('enforces the exact entry-count and cumulative-byte budgets at head advance', () => {
    const first = entry({ sequence: 2 });
    const initial = createInitialExecutionLedgerAttemptLogHeadRecord({
      scope: scope(),
      entry: first,
    });
    const countSaturated = normalizeExecutionLedgerAttemptLogHeadRecord(
      {
        ...clone(initial),
        last_protocol_sequence: EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES,
        entry_count: EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES,
        version: EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES,
      },
      scope(),
    );
    const afterSaturatedCount = entry({
      sequence: EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES + 1,
      previousEntryId: countSaturated.last_entry_id,
    });
    expect(() =>
      advanceExecutionLedgerAttemptLogHeadRecord({
        scope: scope(),
        previousHead: countSaturated,
        entry: afterSaturatedCount,
      }),
    ).toThrow(/entry limit/i);

    const next = entry({
      sequence: 5,
      previousEntryId: initial.last_entry_id,
    });
    const exactBudgetHead = normalizeExecutionLedgerAttemptLogHeadRecord(
      {
        ...clone(initial),
        cumulative_payload_bytes:
          EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES -
          next.canonical_payload_bytes,
      },
      scope(),
    );
    expect(
      advanceExecutionLedgerAttemptLogHeadRecord({
        scope: scope(),
        previousHead: exactBudgetHead,
        entry: next,
      }).cumulative_payload_bytes,
    ).toBe(EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES);

    const overBudgetHead = normalizeExecutionLedgerAttemptLogHeadRecord(
      {
        ...clone(initial),
        cumulative_payload_bytes:
          EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES -
          next.canonical_payload_bytes +
          1,
      },
      scope(),
    );
    expect(() =>
      advanceExecutionLedgerAttemptLogHeadRecord({
        scope: scope(),
        previousHead: overBudgetHead,
        entry: next,
      }),
    ).toThrow(/cumulative payload limit/i);
  });

  test('fails closed on malformed, cross-scope, or internally inconsistent heads', () => {
    const first = entry();
    const head = createInitialExecutionLedgerAttemptLogHeadRecord({
      scope: scope(),
      entry: first,
    });
    const corruptions = [
      {
        property: 'run_id',
        value: 'wlg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      },
      {
        property: 'sort_key',
        value: `${EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY}/extra`,
      },
      {
        property: 'record_type',
        value: EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_RECORD_TYPE,
      },
      { property: 'schema_version', value: 2 },
      { property: 'ledger_schema_version', value: 9 },
      { property: 'last_protocol_sequence', value: 0 },
      { property: 'last_entry_id', value: 'not-an-entry' },
      {
        property: 'entry_count',
        value: EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES + 1,
      },
      {
        property: 'cumulative_payload_bytes',
        value: EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES + 1,
      },
      { property: 'version', value: 2 },
      { property: 'disclosure', value: 'public' },
    ];
    for (const { property, value } of corruptions) {
      expect(() =>
        normalizeExecutionLedgerAttemptLogHeadRecord(
          { ...clone(head), [property]: value },
          scope(),
        ),
      ).toThrow();
    }
    expect(() =>
      normalizeExecutionLedgerAttemptLogHeadRecord(
        {
          ...clone(head),
          last_protocol_sequence: 1,
          entry_count: 2,
          version: 2,
        },
        scope(),
      ),
    ).toThrow(/cannot precede/i);
    expect(() =>
      normalizeExecutionLedgerAttemptLogHeadRecord(
        { ...clone(head), fencing_token: FENCING_TOKEN },
        scope(),
      ),
    ).toThrow(/exactly/i);
    expect(() =>
      normalizeExecutionLedgerAttemptLogHeadRecord(
        head,
        scope({ fencingToken: 'wrong-fence' }),
      ),
    ).toThrow(/expected attempt scope/i);
  });
});
