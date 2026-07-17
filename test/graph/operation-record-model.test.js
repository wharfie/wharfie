/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { Buffer } from 'node:buffer';

import Action from '../../src/core/lib/graph/action.js';
import Operation from '../../src/core/lib/graph/operation.js';
import {
  MAX_ACTION_ID_BYTES,
  MAX_OPERATION_ID_BYTES,
  OPERATIONS_SORT_KEY_PREFIX,
  RUN_SORT_KEY_PREFIX,
  getActionRecordsSortKeyPrefix,
  getActionSortKey,
  getActionSortKeyPrefix,
  getOperationRecordsSortKeyPrefix,
  getOperationSortKey,
  getOperationSortKeyPrefix,
} from '../../src/core/lib/graph/operation-record-key.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;

describe('operation record key codec', () => {
  test('creates typed injective keys and exact query prefixes', () => {
    expect(OPERATIONS_SORT_KEY_PREFIX).toBe('run/');
    expect(RUN_SORT_KEY_PREFIX).toBe(OPERATIONS_SORT_KEY_PREFIX);
    expect(getOperationSortKey('a#b')).toBe('run/YSNi/meta');
    expect(getOperationRecordsSortKeyPrefix('a#b')).toBe('run/YSNi/');
    expect(getOperationSortKeyPrefix('a#b')).toBe(
      getOperationRecordsSortKeyPrefix('a#b'),
    );
    expect(getActionSortKey('a', 'b')).toBe('run/YQ/action/Yg');
    expect(getActionRecordsSortKeyPrefix('a')).toBe('run/YQ/action/');
    expect(getActionSortKeyPrefix('a')).toBe(
      getActionRecordsSortKeyPrefix('a'),
    );

    expect(getOperationSortKey('a#b')).not.toBe(getActionSortKey('a', 'b'));
    expect(getActionSortKey('a#b', 'c')).not.toBe(getActionSortKey('a', 'b#c'));
  });

  test('preserves opaque Unicode and delimiter characters', () => {
    const operationId = '运行/#/café';
    const actionId = '步骤/#/one';
    const operationSegment = Buffer.from(operationId, 'utf8').toString(
      'base64url',
    );
    const actionSegment = Buffer.from(actionId, 'utf8').toString('base64url');

    expect(getOperationSortKey(operationId)).toBe(
      `run/${operationSegment}/meta`,
    );
    expect(getActionSortKey(operationId, actionId)).toBe(
      `run/${operationSegment}/action/${actionSegment}`,
    );
  });

  test('rejects empty, ill-formed, non-string, and oversized IDs', () => {
    expect(() => getOperationSortKey('')).toThrow(/nonempty string/i);
    expect(() => getOperationSortKey(/** @type {any} */ (1))).toThrow(
      /nonempty string/i,
    );
    expect(() => getActionSortKey('run', '')).toThrow(/nonempty string/i);
    expect(() => getOperationSortKey('\ud800')).toThrow(/well-formed Unicode/i);

    expect(() =>
      getOperationSortKey('o'.repeat(MAX_OPERATION_ID_BYTES)),
    ).not.toThrow();
    expect(() =>
      getOperationSortKey('o'.repeat(MAX_OPERATION_ID_BYTES + 1)),
    ).toThrow(/UTF-8 bytes/i);
    expect(() =>
      getActionSortKey('run', 'é'.repeat(MAX_ACTION_ID_BYTES / 2)),
    ).not.toThrow();
    expect(() =>
      getActionSortKey('run', 'é'.repeat(MAX_ACTION_ID_BYTES / 2 + 1)),
    ).toThrow(/UTF-8 bytes/i);
  });
});

describe('operation and action persistence model', () => {
  test('round-trips versions, cancellation, generations, statuses, and typed keys', () => {
    const operation = new Operation({
      resource_id: 'app:portable-notes',
      revision_id: REVISION_ID,
      id: 'run/#/雪',
      type: Operation.Type.PIPELINE,
      status: Operation.Status.CANCELLED,
      generation: 7,
      version: 11,
      cancellation: {
        requested_at: 123,
        requested_by: 'operator',
        reason: 'review',
      },
      started_at: 100,
      last_updated_at: 123,
    });
    const action = operation.createAction({
      id: 'invoke/#/雪',
      type: Action.Type.INVOKE_FUNCTION,
      status: Action.Status.CANCELLED,
      version: 13,
      started_at: 101,
      last_updated_at: 122,
    });

    expect(action.operation_generation).toBe(7);

    const records = operation.toRecords();
    const operationRecord = records.find(
      ({ data }) => data.record_type === Operation.RecordType,
    );
    const actionRecords = records.filter(
      ({ data }) => data.record_type === Action.RecordType,
    );

    expect(operationRecord).toMatchObject({
      sort_key: getOperationSortKey(operation.id),
      data: {
        revision_id: REVISION_ID,
        generation: 7,
        version: 11,
        cancellation: operation.cancellation,
        status: Operation.Status.CANCELLED,
      },
    });
    expect(actionRecords).toEqual([
      expect.objectContaining({
        sort_key: getActionSortKey(operation.id, action.id),
        data: expect.objectContaining({
          operation_generation: 7,
          version: 13,
          status: Action.Status.CANCELLED,
        }),
      }),
    ]);

    if (!operationRecord) throw new Error('Expected operation record');
    const restored = Operation.fromRecords(operationRecord, actionRecords);
    expect(restored).toMatchObject({
      id: operation.id,
      revision_id: REVISION_ID,
      generation: 7,
      version: 11,
      cancellation: operation.cancellation,
      status: Operation.Status.CANCELLED,
    });
    expect(restored.getAction(action.id)).toMatchObject({
      operation_generation: 7,
      version: 13,
      status: Action.Status.CANCELLED,
    });
  });

  test('defaults new and legacy records to generation and version zero', () => {
    const operation = new Operation({
      resource_id: 'app:defaults',
      revision_id: REVISION_ID,
      id: 'run-defaults',
      type: Operation.Type.PIPELINE,
    });
    const action = operation.createAction({
      id: 'invoke',
      type: Action.Type.INVOKE_FUNCTION,
    });

    expect(operation).toMatchObject({ generation: 0, version: 0 });
    expect(operation.cancellation).toBeUndefined();
    expect(action).toMatchObject({ operation_generation: 0, version: 0 });

    const records = operation.toRecords();
    const operationRecord = records.find(
      ({ data }) => data.record_type === Operation.RecordType,
    );
    const actionRecord = records.find(
      ({ data }) => data.record_type === Action.RecordType,
    );
    if (!operationRecord || !actionRecord) {
      throw new Error('Expected operation and action records');
    }

    delete operationRecord.data.generation;
    delete operationRecord.data.version;
    delete actionRecord.data.operation_generation;
    delete actionRecord.data.version;

    expect(Operation.fromRecord(operationRecord)).toMatchObject({
      generation: 0,
      version: 0,
    });
    expect(Action.fromRecord(actionRecord)).toMatchObject({
      operation_generation: 0,
      version: 0,
    });
  });

  test('requires a canonical immutable application revision identity', () => {
    expect(
      () =>
        new Operation(
          /** @type {any} */ ({
            resource_id: 'app:missing-revision',
            type: Operation.Type.PIPELINE,
          }),
        ),
    ).toThrow(/revision_id/i);

    expect(
      () =>
        new Operation({
          resource_id: 'app:malformed-revision',
          revision_id: 'revision-latest',
          type: Operation.Type.PIPELINE,
        }),
    ).toThrow(/revision_id must be a canonical/i);
  });
});
