import { assertApplicationRevisionId } from '../../runtime/application-revision.js';
import { createCanonicalJsonSha256Id } from '../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import {
  assertLedgerServiceId,
  createLedgerServiceId,
} from '../db/tables/ledger-service-lifecycle.js';
import {
  EXECUTION_LEDGER_SCHEMA_VERSION,
  assertNonnegativeSafeInteger,
  assertPositiveSafeInteger,
} from './execution-ledger-contract.js';
import { assertLedgerOpaqueId, encodeLedgerKeySegment } from './record-key.js';

/**
 * The ready-work table projection is a locator, never execution authority.
 * One exact application revision owns one partition and each active run owns
 * at most one current row. Ledger transitions replace or delete that row in
 * the same transaction as their event and run projections. A worker must
 * rebuild the named run and win its ordinary fenced transition before acting.
 */

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';
const COMMON_INPUT_KEYS = Object.freeze([
  'appId',
  'revisionId',
  'runId',
  'kind',
  'availableAt',
  'runVersion',
  'lastSequence',
]);
const COMMON_STORAGE_KEYS = Object.freeze([
  KEY_NAME,
  SORT_KEY_NAME,
  'record_type',
  'schema_version',
  'ledger_schema_version',
  'service_id',
  'app_id',
  'revision_id',
  'ledger_run_id',
  'kind',
  'available_at',
  'run_version',
  'sequence',
]);
const WORKFLOW_CURSOR_INPUT_KEYS = Object.freeze([
  'cursorVersion',
  'continuationId',
  'stepId',
  'stepIndex',
]);
const WORKFLOW_CURSOR_STORAGE_KEYS = Object.freeze([
  'cursor_version',
  'continuation_id',
  'step_id',
  'step_index',
]);
const KIND_MANUAL_INPUT_KEYS = Object.freeze({
  ACTIVITY: Object.freeze(['invocationId', 'generation']),
  RECOVERY: Object.freeze(['invocationId', 'attemptId', 'generation']),
});
const KIND_MANUAL_STORAGE_KEYS = Object.freeze({
  ACTIVITY: Object.freeze(['invocation_id', 'generation']),
  RECOVERY: Object.freeze(['invocation_id', 'attempt_id', 'generation']),
});
const KIND_WORKFLOW_INPUT_KEYS = Object.freeze({
  ACTIVITY: Object.freeze([
    ...KIND_MANUAL_INPUT_KEYS.ACTIVITY,
    ...WORKFLOW_CURSOR_INPUT_KEYS,
  ]),
  RECOVERY: Object.freeze([
    ...KIND_MANUAL_INPUT_KEYS.RECOVERY,
    ...WORKFLOW_CURSOR_INPUT_KEYS,
  ]),
  CONTINUATION: WORKFLOW_CURSOR_INPUT_KEYS,
  TIMER: Object.freeze([...WORKFLOW_CURSOR_INPUT_KEYS, 'timerId']),
});
const KIND_WORKFLOW_STORAGE_KEYS = Object.freeze({
  ACTIVITY: Object.freeze([
    ...KIND_MANUAL_STORAGE_KEYS.ACTIVITY,
    ...WORKFLOW_CURSOR_STORAGE_KEYS,
  ]),
  RECOVERY: Object.freeze([
    ...KIND_MANUAL_STORAGE_KEYS.RECOVERY,
    ...WORKFLOW_CURSOR_STORAGE_KEYS,
  ]),
  CONTINUATION: WORKFLOW_CURSOR_STORAGE_KEYS,
  TIMER: Object.freeze([...WORKFLOW_CURSOR_STORAGE_KEYS, 'timer_id']),
});

export const EXECUTION_LEDGER_READY_WORK_SCHEMA_VERSION = 2;
export const EXECUTION_LEDGER_READY_WORK_RECORD_TYPE =
  'execution_ledger_ready_work_projection';
export const EXECUTION_LEDGER_READY_WORK_PARTITION_DOMAIN =
  'wharfie:execution-ledger-ready-work-partition:v2';
export const EXECUTION_LEDGER_READY_WORK_PARTITION_PREFIX = 'wlw';
export const EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX =
  'ledger-ready/v2/work/';
export const EXECUTION_LEDGER_READY_WORK_TIMESTAMP_WIDTH = 16;
export const EXECUTION_LEDGER_READY_WORK_MAX_RECORD_BYTES = 32 * 1024;

export const ExecutionLedgerReadyWorkKind = Object.freeze({
  ACTIVITY: 'ACTIVITY',
  RECOVERY: 'RECOVERY',
  CONTINUATION: 'CONTINUATION',
  TIMER: 'TIMER',
});

const READY_WORK_KINDS = new Set(Object.values(ExecutionLedgerReadyWorkKind));

/**
 * @param {unknown} value - Candidate plain data object.
 * @param {string} label - Human-readable boundary label.
 * @returns {void} - Resolves for plain data.
 */
function assertPlainDataObject(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new TypeError(`${label} must contain only string data fields.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label}.${key} must be a plain data property.`);
    }
  }
}

/**
 * @param {Record<string, any>} value - Candidate record.
 * @param {string[]} expected - Exact field names.
 * @param {string} label - Human-readable boundary label.
 * @returns {void} - Resolves for the exact shape.
 */
function assertExactKeys(value, expected, label) {
  const expectedKeys = new Set(expected);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.size ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw new TypeError(
      `${label} must contain exactly ${expected.join(', ')}.`,
    );
  }
}

/**
 * @param {Record<string, any>} value - Candidate object.
 * @param {Iterable<string>} keys - Related fields.
 * @returns {boolean} - Whether any related field is present.
 */
function hasAnyOwnField(value, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  }
  return false;
}

/**
 * Select one strict constructor shape. Activity and recovery locators may be
 * manual rows without cursor coordinates or workflow rows with the complete
 * cursor tuple; a partial tuple selects the workflow variant and then fails
 * exact-key validation.
 * @param {Record<string, any>} value - Candidate constructor input.
 * @param {'ACTIVITY'|'RECOVERY'|'CONTINUATION'|'TIMER'} kind - Work kind.
 * @returns {Iterable<string>} - Exact kind-specific input fields.
 */
function inputKeysForKind(value, kind) {
  if (
    kind === ExecutionLedgerReadyWorkKind.ACTIVITY ||
    kind === ExecutionLedgerReadyWorkKind.RECOVERY
  ) {
    return hasAnyOwnField(value, WORKFLOW_CURSOR_INPUT_KEYS)
      ? KIND_WORKFLOW_INPUT_KEYS[kind]
      : KIND_MANUAL_INPUT_KEYS[kind];
  }
  return KIND_WORKFLOW_INPUT_KEYS[kind];
}

/**
 * Select one strict storage shape using the same all-or-none cursor rule as
 * the public constructor.
 * @param {Record<string, any>} value - Candidate storage row.
 * @param {'ACTIVITY'|'RECOVERY'|'CONTINUATION'|'TIMER'} kind - Work kind.
 * @returns {Iterable<string>} - Exact kind-specific storage fields.
 */
function storageKeysForKind(value, kind) {
  if (
    kind === ExecutionLedgerReadyWorkKind.ACTIVITY ||
    kind === ExecutionLedgerReadyWorkKind.RECOVERY
  ) {
    return hasAnyOwnField(value, WORKFLOW_CURSOR_STORAGE_KEYS)
      ? KIND_WORKFLOW_STORAGE_KEYS[kind]
      : KIND_MANUAL_STORAGE_KEYS[kind];
  }
  return KIND_WORKFLOW_STORAGE_KEYS[kind];
}

/**
 * @param {unknown} value - Candidate ready-work kind.
 * @param {string} label - Human-readable boundary label.
 * @returns {'ACTIVITY'|'RECOVERY'|'CONTINUATION'|'TIMER'} - Exact kind.
 */
function normalizeReadyWorkKind(value, label) {
  if (!READY_WORK_KINDS.has(/** @type {any} */ (value))) {
    throw new TypeError(
      `${label} must be one of ${[...READY_WORK_KINDS].join(', ')}.`,
    );
  }
  return /** @type {'ACTIVITY'|'RECOVERY'|'CONTINUATION'|'TIMER'} */ (value);
}

/**
 * @param {unknown} value - Candidate durable timestamp.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Valid timestamp.
 */
function assertReadyWorkTimestamp(value, label) {
  return assertNonnegativeSafeInteger(value, label);
}

/**
 * Derive the exact query partition for one immutable application revision.
 * The service identity remains app-scoped, while revision participates in the
 * partition so one artifact never has to page past another revision's work.
 * @param {{appId: string, revisionId: string, serviceId?: string}} input - Scope inputs.
 * @returns {{appId: string, revisionId: string, serviceId: string, readyWorkId: string}} - Exact scope.
 */
export function createExecutionLedgerReadyWorkScope(input) {
  assertPlainDataObject(input, 'ready-work scope');
  assertExactKeys(
    input,
    [
      'appId',
      'revisionId',
      ...(Object.prototype.hasOwnProperty.call(input, 'serviceId')
        ? ['serviceId']
        : []),
    ],
    'ready-work scope',
  );
  assertLogicalId(input.appId, 'ready-work scope.appId');
  assertApplicationRevisionId(input.revisionId, 'ready-work scope.revisionId');
  const serviceId = createLedgerServiceId({ appId: input.appId });
  if (Object.prototype.hasOwnProperty.call(input, 'serviceId')) {
    assertLedgerServiceId(input.serviceId, 'ready-work scope.serviceId');
    if (input.serviceId !== serviceId) {
      throw new TypeError(
        'ready-work scope.serviceId does not belong to ready-work scope.appId.',
      );
    }
  }
  const readyWorkId = createCanonicalJsonSha256Id({
    domain: EXECUTION_LEDGER_READY_WORK_PARTITION_DOMAIN,
    prefix: EXECUTION_LEDGER_READY_WORK_PARTITION_PREFIX,
    value: {
      schemaVersion: EXECUTION_LEDGER_READY_WORK_SCHEMA_VERSION,
      ledgerSchemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      serviceId,
      revisionId: input.revisionId,
    },
    valuePath: 'execution ledger ready-work partition',
  });
  return {
    appId: input.appId,
    revisionId: input.revisionId,
    serviceId,
    readyWorkId,
  };
}

/**
 * Encode ascending eligibility time and an opaque run identity. The fixed
 * timestamp width makes a bounded prefix query return currently eligible work
 * before future timers; the run identity is the stable tie-breaker.
 * @param {{availableAt: number, runId: string}} input - Work ordering inputs.
 * @returns {string} - Canonical sort key.
 */
export function getExecutionLedgerReadyWorkSortKey(input) {
  assertPlainDataObject(input, 'ready-work sort key input');
  assertExactKeys(input, ['availableAt', 'runId'], 'ready-work sort key input');
  const availableAt = assertReadyWorkTimestamp(
    input.availableAt,
    'ready-work sort key input.availableAt',
  );
  const encodedAvailableAt = String(availableAt).padStart(
    EXECUTION_LEDGER_READY_WORK_TIMESTAMP_WIDTH,
    '0',
  );
  return `${EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX}${encodedAvailableAt}/${encodeLedgerKeySegment(
    assertLedgerOpaqueId(input.runId, 'ready-work sort key input.runId'),
    'ready-work sort key input.runId',
  )}`;
}

/**
 * Parse only the exact representation emitted by the ready-work key codec.
 * @param {unknown} value - Candidate sort key.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {{availableAt: number, runId: string}} - Decoded ordering inputs.
 */
export function parseExecutionLedgerReadyWorkSortKey(
  value,
  label = 'ready-work sort key',
) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string.`);
  }
  if (!value.startsWith(EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX)) {
    throw new TypeError(
      `${label} must begin with the ready-work sort-key prefix.`,
    );
  }
  const suffix = value.slice(
    EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX.length,
  );
  const separator = suffix.indexOf('/');
  if (
    separator !== EXECUTION_LEDGER_READY_WORK_TIMESTAMP_WIDTH ||
    suffix.indexOf('/', separator + 1) !== -1
  ) {
    throw new TypeError(`${label} must contain one fixed-width timestamp.`);
  }
  const availableAtText = suffix.slice(0, separator);
  const encodedRunId = suffix.slice(separator + 1);
  if (
    !/^\d{16}$/.test(availableAtText) ||
    !/^[A-Za-z0-9_-]+$/.test(encodedRunId)
  ) {
    throw new TypeError(`${label} is not canonically encoded.`);
  }
  const availableAt = Number(availableAtText);
  assertReadyWorkTimestamp(availableAt, `${label}.availableAt`);
  let runId;
  try {
    const bytes = Buffer.from(encodedRunId, 'base64url');
    if (bytes.toString('base64url') !== encodedRunId) {
      throw new Error('noncanonical base64url');
    }
    runId = assertLedgerOpaqueId(bytes.toString('utf8'), `${label}.runId`);
  } catch {
    throw new TypeError(`${label} has an invalid run identity.`);
  }
  if (getExecutionLedgerReadyWorkSortKey({ availableAt, runId }) !== value) {
    throw new TypeError(`${label} is not canonical.`);
  }
  return { availableAt, runId };
}

/**
 * @param {Record<string, any>} value - Validated workflow locator input.
 * @returns {{cursor_version: number, continuation_id: string, step_id: string, step_index: number}} - Exact workflow cursor coordinates.
 */
function createWorkflowCursorStorageFields(value) {
  assertLogicalId(value.stepId, 'ready-work input.stepId');
  return {
    cursor_version: assertPositiveSafeInteger(
      value.cursorVersion,
      'ready-work input.cursorVersion',
    ),
    continuation_id: assertLedgerOpaqueId(
      value.continuationId,
      'ready-work input.continuationId',
    ),
    step_id: value.stepId,
    step_index: assertNonnegativeSafeInteger(
      value.stepIndex,
      'ready-work input.stepIndex',
    ),
  };
}

/**
 * @param {Record<string, any>} record - Strict workflow storage row.
 * @returns {void} - Throws when any cursor coordinate is invalid.
 */
function assertWorkflowCursorStorageFields(record) {
  assertPositiveSafeInteger(
    record.cursor_version,
    'ready-work record.cursor_version',
  );
  assertLedgerOpaqueId(
    record.continuation_id,
    'ready-work record.continuation_id',
  );
  assertLogicalId(record.step_id, 'ready-work record.step_id');
  assertNonnegativeSafeInteger(
    record.step_index,
    'ready-work record.step_index',
  );
}

/**
 * @param {Record<string, any>} value - Validated constructor input.
 * @param {'ACTIVITY'|'RECOVERY'|'CONTINUATION'|'TIMER'} kind - Work kind.
 * @returns {Record<string, string|number>} - Kind-specific storage fields.
 */
function createKindStorageFields(value, kind) {
  if (kind === ExecutionLedgerReadyWorkKind.ACTIVITY) {
    return {
      invocation_id: assertLedgerOpaqueId(
        value.invocationId,
        'ready-work input.invocationId',
      ),
      generation: assertNonnegativeSafeInteger(
        value.generation,
        'ready-work input.generation',
      ),
      ...(hasAnyOwnField(value, WORKFLOW_CURSOR_INPUT_KEYS)
        ? createWorkflowCursorStorageFields(value)
        : {}),
    };
  }
  if (kind === ExecutionLedgerReadyWorkKind.RECOVERY) {
    return {
      invocation_id: assertLedgerOpaqueId(
        value.invocationId,
        'ready-work input.invocationId',
      ),
      attempt_id: assertLedgerOpaqueId(
        value.attemptId,
        'ready-work input.attemptId',
      ),
      generation: assertPositiveSafeInteger(
        value.generation,
        'ready-work input.generation',
      ),
      ...(hasAnyOwnField(value, WORKFLOW_CURSOR_INPUT_KEYS)
        ? createWorkflowCursorStorageFields(value)
        : {}),
    };
  }
  const continuation = createWorkflowCursorStorageFields(value);
  return kind === ExecutionLedgerReadyWorkKind.TIMER
    ? {
        ...continuation,
        timer_id: assertLedgerOpaqueId(
          value.timerId,
          'ready-work input.timerId',
        ),
      }
    : continuation;
}

/**
 * Construct one strict current-work locator. Normal ledger operation must put,
 * replace, or delete this record in the same transaction as the event that
 * changes the named run's active work.
 * @param {Record<string, any>} input - Exact common and kind-specific fields.
 * @returns {Record<string, any>} - Canonical storage record.
 */
export function createExecutionLedgerReadyWorkRecord(input) {
  assertPlainDataObject(input, 'ready-work input');
  const kind = normalizeReadyWorkKind(input.kind, 'ready-work input.kind');
  assertExactKeys(
    input,
    [...COMMON_INPUT_KEYS, ...inputKeysForKind(input, kind)],
    'ready-work input',
  );
  const scope = createExecutionLedgerReadyWorkScope({
    appId: input.appId,
    revisionId: input.revisionId,
  });
  const runId = assertLedgerOpaqueId(input.runId, 'ready-work input.runId');
  const availableAt = assertReadyWorkTimestamp(
    input.availableAt,
    'ready-work input.availableAt',
  );
  const record = {
    [KEY_NAME]: scope.readyWorkId,
    [SORT_KEY_NAME]: getExecutionLedgerReadyWorkSortKey({
      availableAt,
      runId,
    }),
    record_type: EXECUTION_LEDGER_READY_WORK_RECORD_TYPE,
    schema_version: EXECUTION_LEDGER_READY_WORK_SCHEMA_VERSION,
    ledger_schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    service_id: scope.serviceId,
    app_id: scope.appId,
    revision_id: scope.revisionId,
    ledger_run_id: runId,
    kind,
    available_at: availableAt,
    run_version: assertPositiveSafeInteger(
      input.runVersion,
      'ready-work input.runVersion',
    ),
    sequence: assertPositiveSafeInteger(
      input.lastSequence,
      'ready-work input.lastSequence',
    ),
    ...createKindStorageFields(input, kind),
  };
  return normalizeExecutionLedgerReadyWorkRecord(record, {
    appId: scope.appId,
    revisionId: scope.revisionId,
  });
}

/**
 * Strictly validate an untrusted ready-work row before it becomes a locator.
 * Scope is mandatory: accepting an otherwise valid cross-revision row would
 * let one artifact spend work or attempt recovery for another revision.
 * @param {unknown} raw - Candidate storage row.
 * @param {{appId: string, revisionId: string}} expectedScope - Exact query authority.
 * @returns {Record<string, any>} - Independently cloned canonical row.
 */
export function normalizeExecutionLedgerReadyWorkRecord(raw, expectedScope) {
  assertPlainDataObject(expectedScope, 'ready-work expected scope');
  assertExactKeys(
    expectedScope,
    ['appId', 'revisionId'],
    'ready-work expected scope',
  );
  const scope = createExecutionLedgerReadyWorkScope(expectedScope);
  const record = cloneBoundedJsonObject(
    raw,
    EXECUTION_LEDGER_READY_WORK_MAX_RECORD_BYTES,
    'ready-work record',
  );
  const kind = normalizeReadyWorkKind(record.kind, 'ready-work record.kind');
  assertExactKeys(
    record,
    [...COMMON_STORAGE_KEYS, ...storageKeysForKind(record, kind)],
    'ready-work record',
  );
  if (
    record[KEY_NAME] !== scope.readyWorkId ||
    record.record_type !== EXECUTION_LEDGER_READY_WORK_RECORD_TYPE ||
    record.schema_version !== EXECUTION_LEDGER_READY_WORK_SCHEMA_VERSION ||
    record.ledger_schema_version !== EXECUTION_LEDGER_SCHEMA_VERSION ||
    record.service_id !== scope.serviceId ||
    record.app_id !== scope.appId ||
    record.revision_id !== scope.revisionId
  ) {
    throw new TypeError(
      'ready-work record does not match its schema and expected scope.',
    );
  }
  const runId = assertLedgerOpaqueId(
    record.ledger_run_id,
    'ready-work record.ledger_run_id',
  );
  const availableAt = assertReadyWorkTimestamp(
    record.available_at,
    'ready-work record.available_at',
  );
  const decoded = parseExecutionLedgerReadyWorkSortKey(
    record[SORT_KEY_NAME],
    'ready-work record.sort_key',
  );
  if (decoded.runId !== runId || decoded.availableAt !== availableAt) {
    throw new TypeError(
      'ready-work record sort key does not match its run and eligibility time.',
    );
  }
  assertPositiveSafeInteger(
    record.run_version,
    'ready-work record.run_version',
  );
  assertPositiveSafeInteger(record.sequence, 'ready-work record.sequence');

  if (kind === ExecutionLedgerReadyWorkKind.ACTIVITY) {
    assertLedgerOpaqueId(
      record.invocation_id,
      'ready-work record.invocation_id',
    );
    assertNonnegativeSafeInteger(
      record.generation,
      'ready-work record.generation',
    );
    if (hasAnyOwnField(record, WORKFLOW_CURSOR_STORAGE_KEYS)) {
      assertWorkflowCursorStorageFields(record);
    }
  } else if (kind === ExecutionLedgerReadyWorkKind.RECOVERY) {
    assertLedgerOpaqueId(
      record.invocation_id,
      'ready-work record.invocation_id',
    );
    assertLedgerOpaqueId(record.attempt_id, 'ready-work record.attempt_id');
    assertPositiveSafeInteger(
      record.generation,
      'ready-work record.generation',
    );
    if (hasAnyOwnField(record, WORKFLOW_CURSOR_STORAGE_KEYS)) {
      assertWorkflowCursorStorageFields(record);
    }
  } else {
    assertWorkflowCursorStorageFields(record);
    if (kind === ExecutionLedgerReadyWorkKind.TIMER) {
      assertLedgerOpaqueId(record.timer_id, 'ready-work record.timer_id');
    }
  }
  return record;
}

export default {
  EXECUTION_LEDGER_READY_WORK_MAX_RECORD_BYTES,
  EXECUTION_LEDGER_READY_WORK_PARTITION_DOMAIN,
  EXECUTION_LEDGER_READY_WORK_PARTITION_PREFIX,
  EXECUTION_LEDGER_READY_WORK_RECORD_TYPE,
  EXECUTION_LEDGER_READY_WORK_SCHEMA_VERSION,
  EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX,
  EXECUTION_LEDGER_READY_WORK_TIMESTAMP_WIDTH,
  ExecutionLedgerReadyWorkKind,
  createExecutionLedgerReadyWorkRecord,
  createExecutionLedgerReadyWorkScope,
  getExecutionLedgerReadyWorkSortKey,
  normalizeExecutionLedgerReadyWorkRecord,
  parseExecutionLedgerReadyWorkSortKey,
};
