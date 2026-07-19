/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';

import { createLedgerServiceId } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { EXECUTION_LEDGER_SCHEMA_VERSION } from '../../src/core/lib/ledger/execution-ledger-contract.js';
import {
  EXECUTION_LEDGER_READY_WORK_PARTITION_DOMAIN,
  EXECUTION_LEDGER_READY_WORK_RECORD_TYPE,
  EXECUTION_LEDGER_READY_WORK_SCHEMA_VERSION,
  EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX,
  ExecutionLedgerReadyWorkKind,
  createExecutionLedgerReadyWorkRecord,
  createExecutionLedgerReadyWorkScope,
  getExecutionLedgerReadyWorkSortKey,
  normalizeExecutionLedgerReadyWorkRecord,
  parseExecutionLedgerReadyWorkSortKey,
} from '../../src/core/lib/ledger/ready-work.js';
import { MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES } from '../../src/core/lib/ledger/record-key.js';

const APP_ID = 'ready-work-app';
const OTHER_APP_ID = 'other-ready-work-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('ready-work-revision')
  .digest('base64url')}`;
const OTHER_REVISION_ID = `wrv1_${createHash('sha256')
  .update('other-ready-work-revision')
  .digest('base64url')}`;

function common(overrides = {}) {
  return {
    appId: APP_ID,
    revisionId: REVISION_ID,
    runId: 'run-1',
    kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
    availableAt: 0,
    runVersion: 3,
    lastSequence: 3,
    invocationId: 'invocation-1',
    generation: 0,
    ...overrides,
  };
}

describe('execution ledger ready-work projection codec', () => {
  test('derives an exact app-and-revision partition', () => {
    const scope = createExecutionLedgerReadyWorkScope({
      appId: APP_ID,
      revisionId: REVISION_ID,
    });

    expect(EXECUTION_LEDGER_READY_WORK_SCHEMA_VERSION).toBe(2);
    expect(EXECUTION_LEDGER_READY_WORK_PARTITION_DOMAIN).toBe(
      'wharfie:execution-ledger-ready-work-partition:v2',
    );
    expect(scope).toEqual({
      appId: APP_ID,
      revisionId: REVISION_ID,
      serviceId: createLedgerServiceId({ appId: APP_ID }),
      readyWorkId: expect.stringMatching(/^wlw_[A-Za-z0-9_-]{43}$/),
    });
    expect(
      createExecutionLedgerReadyWorkScope({
        appId: APP_ID,
        revisionId: OTHER_REVISION_ID,
      }).readyWorkId,
    ).not.toBe(scope.readyWorkId);
    expect(
      createExecutionLedgerReadyWorkScope({
        appId: OTHER_APP_ID,
        revisionId: REVISION_ID,
      }).readyWorkId,
    ).not.toBe(scope.readyWorkId);
    expect(() =>
      createExecutionLedgerReadyWorkScope({
        appId: APP_ID,
        revisionId: REVISION_ID,
        serviceId: createLedgerServiceId({ appId: OTHER_APP_ID }),
      }),
    ).toThrow(/does not belong/i);
    expect(() =>
      createExecutionLedgerReadyWorkScope(
        /** @type {any} */ ({
          appId: APP_ID,
          revisionId: REVISION_ID,
          unexpected: true,
        }),
      ),
    ).toThrow(/exactly/i);
  });

  test('orders and round-trips canonical eligibility keys', () => {
    const early = getExecutionLedgerReadyWorkSortKey({
      availableAt: 2,
      runId: 'run/早',
    });
    const later = getExecutionLedgerReadyWorkSortKey({
      availableAt: 10,
      runId: 'run/晚',
    });

    expect(EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX).toBe(
      'ledger-ready/v2/work/',
    );
    expect(early).toBe(
      `ledger-ready/v2/work/0000000000000002/${Buffer.from('run/早', 'utf8').toString('base64url')}`,
    );
    expect([later, early].sort()).toEqual([early, later]);
    expect(parseExecutionLedgerReadyWorkSortKey(early)).toEqual({
      availableAt: 2,
      runId: 'run/早',
    });
    expect(
      parseExecutionLedgerReadyWorkSortKey(
        getExecutionLedgerReadyWorkSortKey({
          availableAt: Number.MAX_SAFE_INTEGER,
          runId: 'maximum-time',
        }),
      ),
    ).toEqual({
      availableAt: Number.MAX_SAFE_INTEGER,
      runId: 'maximum-time',
    });
    expect(
      Buffer.byteLength(
        getExecutionLedgerReadyWorkSortKey({
          availableAt: Number.MAX_SAFE_INTEGER,
          runId: 'r'.repeat(MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES),
        }),
        'utf8',
      ),
    ).toBeLessThanOrEqual(1024);
  });

  test.each([
    [
      'manual activity',
      ExecutionLedgerReadyWorkKind.ACTIVITY,
      { invocationId: 'invocation-1', generation: 0 },
      { invocation_id: 'invocation-1', generation: 0 },
    ],
    [
      'workflow activity',
      ExecutionLedgerReadyWorkKind.ACTIVITY,
      {
        invocationId: 'invocation-1',
        generation: 0,
        cursorVersion: 2,
        continuationId: 'continue-1',
        stepId: 'activity-1',
        stepIndex: 0,
      },
      {
        invocation_id: 'invocation-1',
        generation: 0,
        cursor_version: 2,
        continuation_id: 'continue-1',
        step_id: 'activity-1',
        step_index: 0,
      },
    ],
    [
      'manual recovery',
      ExecutionLedgerReadyWorkKind.RECOVERY,
      {
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        generation: 1,
      },
      {
        invocation_id: 'invocation-1',
        attempt_id: 'attempt-1',
        generation: 1,
      },
    ],
    [
      'workflow recovery',
      ExecutionLedgerReadyWorkKind.RECOVERY,
      {
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        generation: 1,
        cursorVersion: 3,
        continuationId: 'continue-1',
        stepId: 'activity-1',
        stepIndex: 0,
      },
      {
        invocation_id: 'invocation-1',
        attempt_id: 'attempt-1',
        generation: 1,
        cursor_version: 3,
        continuation_id: 'continue-1',
        step_id: 'activity-1',
        step_index: 0,
      },
    ],
    [
      'continuation',
      ExecutionLedgerReadyWorkKind.CONTINUATION,
      {
        cursorVersion: 4,
        continuationId: 'continue-1',
        stepId: 'wait-1',
        stepIndex: 2,
      },
      {
        cursor_version: 4,
        continuation_id: 'continue-1',
        step_id: 'wait-1',
        step_index: 2,
      },
    ],
    [
      'timer',
      ExecutionLedgerReadyWorkKind.TIMER,
      {
        cursorVersion: 5,
        continuationId: 'continue-1',
        stepId: 'timer-1',
        stepIndex: 2,
        timerId: 'timer-run-1',
      },
      {
        cursor_version: 5,
        continuation_id: 'continue-1',
        step_id: 'timer-1',
        step_index: 2,
        timer_id: 'timer-run-1',
      },
    ],
  ])(
    'constructs and validates one exact %s locator',
    (label, kind, fields, stored) => {
      const input = {
        appId: APP_ID,
        revisionId: REVISION_ID,
        runId: `run-${label.replace(' ', '-')}`,
        kind,
        availableAt: kind === ExecutionLedgerReadyWorkKind.TIMER ? 100 : 0,
        runVersion: 4,
        lastSequence: 7,
        ...fields,
      };
      const record = createExecutionLedgerReadyWorkRecord(input);
      const scope = createExecutionLedgerReadyWorkScope({
        appId: APP_ID,
        revisionId: REVISION_ID,
      });

      expect(record).toEqual({
        run_id: scope.readyWorkId,
        sort_key: getExecutionLedgerReadyWorkSortKey({
          availableAt: input.availableAt,
          runId: input.runId,
        }),
        record_type: EXECUTION_LEDGER_READY_WORK_RECORD_TYPE,
        schema_version: EXECUTION_LEDGER_READY_WORK_SCHEMA_VERSION,
        ledger_schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
        service_id: scope.serviceId,
        app_id: APP_ID,
        revision_id: REVISION_ID,
        ledger_run_id: input.runId,
        kind,
        available_at: input.availableAt,
        run_version: 4,
        sequence: 7,
        ...stored,
      });
      expect(
        normalizeExecutionLedgerReadyWorkRecord(record, {
          appId: APP_ID,
          revisionId: REVISION_ID,
        }),
      ).toEqual(record);
    },
  );

  test.each([
    [
      ExecutionLedgerReadyWorkKind.ACTIVITY,
      { invocationId: 'invocation-1', generation: 0 },
    ],
    [
      ExecutionLedgerReadyWorkKind.RECOVERY,
      {
        invocationId: 'invocation-1',
        attemptId: 'attempt-1',
        generation: 1,
      },
    ],
  ])('requires an all-or-none workflow cursor tuple for %s', (kind, base) => {
    const workflowCursor = {
      cursorVersion: 1,
      continuationId: 'continue-1',
      stepId: 'activity-1',
      stepIndex: 0,
    };
    const input = common({ kind, ...base, ...workflowCursor });
    const record = createExecutionLedgerReadyWorkRecord(input);

    for (const field of Object.keys(workflowCursor)) {
      const partialInput = /** @type {Record<string, any>} */ ({ ...input });
      delete partialInput[field];
      expect(() => createExecutionLedgerReadyWorkRecord(partialInput)).toThrow(
        /exactly/i,
      );
    }

    for (const field of [
      'cursor_version',
      'continuation_id',
      'step_id',
      'step_index',
    ]) {
      const partialRecord = { ...record };
      delete partialRecord[field];
      expect(() =>
        normalizeExecutionLedgerReadyWorkRecord(partialRecord, {
          appId: APP_ID,
          revisionId: REVISION_ID,
        }),
      ).toThrow(/exactly/i);
    }

    expect(() =>
      createExecutionLedgerReadyWorkRecord({
        ...input,
        cursorVersion: 0,
      }),
    ).toThrow(/positive safe integer/i);
  });

  test('rejects malformed, stale-scope, and cross-kind rows', () => {
    const record = createExecutionLedgerReadyWorkRecord(common());

    expect(() =>
      normalizeExecutionLedgerReadyWorkRecord(record, {
        appId: APP_ID,
        revisionId: OTHER_REVISION_ID,
      }),
    ).toThrow(/expected scope/i);
    expect(() =>
      normalizeExecutionLedgerReadyWorkRecord(
        { ...record, ledger_schema_version: 9 },
        { appId: APP_ID, revisionId: REVISION_ID },
      ),
    ).toThrow(/schema and expected scope/i);
    expect(() =>
      normalizeExecutionLedgerReadyWorkRecord(
        { ...record, available_at: 1 },
        { appId: APP_ID, revisionId: REVISION_ID },
      ),
    ).toThrow(/sort key does not match/i);
    expect(() =>
      normalizeExecutionLedgerReadyWorkRecord(
        { ...record, kind: ExecutionLedgerReadyWorkKind.RECOVERY },
        { appId: APP_ID, revisionId: REVISION_ID },
      ),
    ).toThrow(/exactly/i);
    expect(() =>
      createExecutionLedgerReadyWorkRecord({
        ...common(),
        unsupported: true,
      }),
    ).toThrow(/exactly/i);
    expect(() =>
      createExecutionLedgerReadyWorkRecord({
        ...common({
          kind: ExecutionLedgerReadyWorkKind.RECOVERY,
          attemptId: 'attempt-1',
        }),
        generation: 0,
      }),
    ).toThrow(/positive safe integer/i);
  });

  test('rejects noncanonical keys and unsafe timestamps', () => {
    expect(() =>
      getExecutionLedgerReadyWorkSortKey({ availableAt: -1, runId: 'run' }),
    ).toThrow(/nonnegative safe integer/i);
    expect(() =>
      getExecutionLedgerReadyWorkSortKey({
        availableAt: Number.MAX_SAFE_INTEGER + 1,
        runId: 'run',
      }),
    ).toThrow(/nonnegative safe integer/i);
    expect(() =>
      parseExecutionLedgerReadyWorkSortKey('ledger-ready/v2/work/2/cnVu'),
    ).toThrow(/fixed-width timestamp/i);
    expect(() =>
      parseExecutionLedgerReadyWorkSortKey(
        'ledger-ready/v2/work/0000000000000002/not+base64',
      ),
    ).toThrow(/canonically encoded/i);
    expect(() =>
      parseExecutionLedgerReadyWorkSortKey(
        'ledger-ready/v2/work/0000000000000002/wA',
      ),
    ).toThrow(/not canonical|invalid run identity/i);
  });
});
