import { ACTIVITY_PROTOCOL_LOG_LEVELS } from '../../runtime/activity-protocol.js';
import { assertApplicationRevisionId } from '../../runtime/application-revision.js';
import {
  cloneBoundedJsonObject,
  cloneJsonObject,
} from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import {
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
  assertExactKeys,
  assertNonnegativeSafeInteger,
  assertOpaqueId,
  assertPositiveSafeInteger,
  assertSnapshotKeys,
  deepFreezeJson,
} from './execution-ledger-contract.js';
import {
  EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE,
  EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES,
  EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES,
} from './attempt-log.js';

export const EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_DEFAULT_LIMIT = 50;
export const EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_MAX_LIMIT = 100;
export const EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES = 4096;
export const EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_SCHEMA_VERSION = 1;

const SAFE_SCOPE_KEYS = [
  'appId',
  'revisionId',
  'activityId',
  'runId',
  'invocationId',
  'attemptId',
  'generation',
  'coordinatorEpoch',
];
const SNAPSHOT_KEYS = ['entryCount', 'cumulativePayloadBytes', 'lastSequence'];
const ITEM_KEYS = ['sequence', 'acceptedAt', 'level', 'message', 'fields'];
const CURSOR_KEYS = [
  'schemaVersion',
  'scope',
  'snapshot',
  'nextIndex',
  'previousSequence',
];
const LOG_LEVELS = new Set(ACTIVITY_PROTOCOL_LOG_LEVELS);

/**
 * @typedef {object} ActivityAttemptLogPageScope
 * @property {string} appId - Application identity.
 * @property {string} revisionId - Immutable revision identity.
 * @property {string} activityId - Activity identity.
 * @property {string} runId - Logical run identity.
 * @property {string} invocationId - Logical invocation identity.
 * @property {string} attemptId - Physical attempt identity.
 * @property {number} generation - Attempt generation.
 * @property {number} coordinatorEpoch - Coordinator epoch.
 */

/**
 * @typedef {object} ActivityAttemptLogPageSnapshot
 * @property {number} entryCount - Frozen prefix length.
 * @property {number} cumulativePayloadBytes - Frozen prefix payload bytes.
 * @property {number | null} lastSequence - Last frozen prefix protocol sequence, or null.
 */

/**
 * @typedef {object} ActivityAttemptLogPageItem
 * @property {number} sequence - Activity Protocol component sequence.
 * @property {number} acceptedAt - Host acceptance time.
 * @property {'trace'|'debug'|'info'|'warn'|'error'} level - Log level.
 * @property {string} message - Raw application message.
 * @property {Record<string, any>} fields - Raw application fields.
 */

/**
 * @typedef {object} ActivityAttemptLogPageCursor
 * @property {1} schemaVersion - Cursor schema version.
 * @property {ActivityAttemptLogPageScope} scope - Safe attempt scope.
 * @property {ActivityAttemptLogPageSnapshot} snapshot - Frozen prefix.
 * @property {number} nextIndex - Zero-based next entry index.
 * @property {number} previousSequence - Sequence immediately before nextIndex.
 */

/**
 * Clone and validate the public, non-secret attempt scope.
 * @param {unknown} input - Candidate safe scope.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {Readonly<ActivityAttemptLogPageScope>} - Frozen safe scope.
 */
export function normalizeExecutionLedgerAttemptLogPageScope(
  input,
  label = 'activity attempt-log page scope',
) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(value, SAFE_SCOPE_KEYS, label);
  assertLogicalId(value.appId, `${label}.appId`);
  assertApplicationRevisionId(value.revisionId, `${label}.revisionId`);
  assertLogicalId(value.activityId, `${label}.activityId`);
  const runId = assertOpaqueId(value.runId, `${label}.runId`);
  const invocationId = assertOpaqueId(
    value.invocationId,
    `${label}.invocationId`,
  );
  const attemptId = assertOpaqueId(value.attemptId, `${label}.attemptId`);
  const generation = assertPositiveSafeInteger(
    value.generation,
    `${label}.generation`,
  );
  const coordinatorEpoch = assertNonnegativeSafeInteger(
    value.coordinatorEpoch,
    `${label}.coordinatorEpoch`,
  );
  return deepFreezeJson({
    appId: value.appId,
    revisionId: value.revisionId,
    activityId: value.activityId,
    runId,
    invocationId,
    attemptId,
    generation,
    coordinatorEpoch,
  });
}

/**
 * Clone and validate one frozen page snapshot.
 * @param {unknown} input - Candidate snapshot.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {Readonly<ActivityAttemptLogPageSnapshot>} - Frozen snapshot.
 */
export function normalizeExecutionLedgerAttemptLogPageSnapshot(
  input,
  label = 'activity attempt-log page snapshot',
) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(value, SNAPSHOT_KEYS, label);
  const entryCount = assertNonnegativeSafeInteger(
    value.entryCount,
    `${label}.entryCount`,
  );
  const cumulativePayloadBytes = assertNonnegativeSafeInteger(
    value.cumulativePayloadBytes,
    `${label}.cumulativePayloadBytes`,
  );
  const lastSequence =
    value.lastSequence === null
      ? null
      : assertPositiveSafeInteger(value.lastSequence, `${label}.lastSequence`);
  if (
    entryCount > EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES ||
    cumulativePayloadBytes >
      EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES ||
    (entryCount === 0
      ? cumulativePayloadBytes !== 0 || lastSequence !== null
      : cumulativePayloadBytes === 0 || lastSequence === null)
  ) {
    throw new TypeError(`${label} is not a valid retained-log snapshot.`);
  }
  return deepFreezeJson({
    entryCount,
    cumulativePayloadBytes,
    lastSequence,
  });
}

/**
 * Strictly normalize the public reader request.
 * @param {unknown} input - Candidate read request.
 * @returns {{appId: string, runId: string, attemptId: string, limit: number, cursor?: string}} - Exact bounded request.
 */
export function normalizeExecutionLedgerAttemptLogPageOptions(input) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'readActivityAttemptLogPage',
  );
  assertSnapshotKeys(
    value,
    ['appId', 'runId', 'attemptId'],
    ['limit', 'cursor'],
    'readActivityAttemptLogPage',
  );
  assertLogicalId(value.appId, 'readActivityAttemptLogPage.appId');
  const runId = assertOpaqueId(value.runId, 'readActivityAttemptLogPage.runId');
  const attemptId = assertOpaqueId(
    value.attemptId,
    'readActivityAttemptLogPage.attemptId',
  );
  const limit = Object.prototype.hasOwnProperty.call(value, 'limit')
    ? value.limit
    : EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_DEFAULT_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_MAX_LIMIT
  ) {
    throw new TypeError(
      `readActivityAttemptLogPage.limit must be a safe integer from 1 through ${EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_MAX_LIMIT}.`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(value, 'cursor')) {
    if (
      typeof value.cursor !== 'string' ||
      value.cursor.length === 0 ||
      Buffer.byteLength(value.cursor, 'utf8') >
        EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES
    ) {
      throw new TypeError(
        'readActivityAttemptLogPage.cursor must be a nonempty bounded opaque string.',
      );
    }
  }
  return {
    appId: value.appId,
    runId,
    attemptId,
    limit,
    ...(Object.prototype.hasOwnProperty.call(value, 'cursor')
      ? { cursor: value.cursor }
      : {}),
  };
}

/**
 * Decode one canonical, scope-bound snapshot continuation.
 * @param {string} cursor - Candidate opaque cursor.
 * @param {ActivityAttemptLogPageScope} expectedScope - Exact requested scope.
 * @returns {Readonly<ActivityAttemptLogPageCursor>} - Frozen continuation.
 */
export function parseExecutionLedgerAttemptLogPageCursor(
  cursor,
  expectedScope,
) {
  const scope = normalizeExecutionLedgerAttemptLogPageScope(
    expectedScope,
    'activity attempt-log page expected scope',
  );
  if (
    typeof cursor !== 'string' ||
    cursor.length === 0 ||
    Buffer.byteLength(cursor, 'utf8') >
      EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES
  ) {
    throw new TypeError(
      'readActivityAttemptLogPage.cursor must be a nonempty bounded opaque string.',
    );
  }
  /** @type {string} */
  let text;
  /** @type {unknown} */
  let parsed;
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) {
      throw new Error('noncanonical base64url');
    }
    text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
      throw new Error('invalid utf8');
    }
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError(
      'readActivityAttemptLogPage.cursor is not a valid opaque cursor.',
    );
  }
  const value = cloneBoundedJsonObject(
    parsed,
    EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES,
    'readActivityAttemptLogPage.cursor',
  );
  assertExactKeys(value, CURSOR_KEYS, 'readActivityAttemptLogPage.cursor');
  const cursorScope = normalizeExecutionLedgerAttemptLogPageScope(
    value.scope,
    'readActivityAttemptLogPage.cursor.scope',
  );
  const snapshot = normalizeExecutionLedgerAttemptLogPageSnapshot(
    value.snapshot,
    'readActivityAttemptLogPage.cursor.snapshot',
  );
  const nextIndex = assertPositiveSafeInteger(
    value.nextIndex,
    'readActivityAttemptLogPage.cursor.nextIndex',
  );
  const previousSequence = assertPositiveSafeInteger(
    value.previousSequence,
    'readActivityAttemptLogPage.cursor.previousSequence',
  );
  const normalized = {
    schemaVersion: EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_SCHEMA_VERSION,
    scope: cursorScope,
    snapshot,
    nextIndex,
    previousSequence,
  };
  if (
    value.schemaVersion !==
      EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_SCHEMA_VERSION ||
    JSON.stringify(cursorScope) !== JSON.stringify(scope) ||
    snapshot.entryCount === 0 ||
    nextIndex >= snapshot.entryCount ||
    snapshot.lastSequence === null ||
    previousSequence > snapshot.lastSequence ||
    text !== JSON.stringify(normalized)
  ) {
    throw new TypeError(
      'readActivityAttemptLogPage.cursor does not match the requested scope or snapshot.',
    );
  }
  return deepFreezeJson(normalized);
}

/**
 * Create one canonical, scope-bound snapshot continuation.
 * @param {{scope: ActivityAttemptLogPageScope, snapshot: ActivityAttemptLogPageSnapshot, nextIndex: number, previousSequence: number}} input - Continuation fields.
 * @returns {string} - Canonical base64url cursor.
 */
export function createExecutionLedgerAttemptLogPageCursor(input) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'activity attempt-log page cursor input',
  );
  assertExactKeys(
    value,
    ['scope', 'snapshot', 'nextIndex', 'previousSequence'],
    'activity attempt-log page cursor input',
  );
  const scope = normalizeExecutionLedgerAttemptLogPageScope(
    value.scope,
    'activity attempt-log page cursor input.scope',
  );
  const snapshot = normalizeExecutionLedgerAttemptLogPageSnapshot(
    value.snapshot,
    'activity attempt-log page cursor input.snapshot',
  );
  const nextIndex = assertPositiveSafeInteger(
    value.nextIndex,
    'activity attempt-log page cursor input.nextIndex',
  );
  const previousSequence = assertPositiveSafeInteger(
    value.previousSequence,
    'activity attempt-log page cursor input.previousSequence',
  );
  if (
    snapshot.entryCount === 0 ||
    nextIndex >= snapshot.entryCount ||
    snapshot.lastSequence === null ||
    previousSequence > snapshot.lastSequence
  ) {
    throw new TypeError(
      'activity attempt-log page cursor input is not an interior snapshot boundary.',
    );
  }
  const cursor = Buffer.from(
    JSON.stringify({
      schemaVersion: EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_SCHEMA_VERSION,
      scope,
      snapshot,
      nextIndex,
      previousSequence,
    }),
    'utf8',
  ).toString('base64url');
  if (
    Buffer.byteLength(cursor, 'utf8') >
    EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES
  ) {
    throw new TypeError('activity attempt-log page cursor is too large.');
  }
  return cursor;
}

/**
 * Clone and validate one deliberately raw public log item.
 * @param {unknown} input - Candidate page item.
 * @param {string} label - Human-readable boundary label.
 * @returns {Readonly<ActivityAttemptLogPageItem>} - Frozen raw item.
 */
function normalizePageItem(input, label) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(value, ITEM_KEYS, label);
  const sequence = assertPositiveSafeInteger(
    value.sequence,
    `${label}.sequence`,
  );
  const acceptedAt = assertNonnegativeSafeInteger(
    value.acceptedAt,
    `${label}.acceptedAt`,
  );
  if (typeof value.level !== 'string' || !LOG_LEVELS.has(value.level)) {
    throw new TypeError(`${label}.level is not a supported log level.`);
  }
  if (typeof value.message !== 'string') {
    throw new TypeError(`${label}.message must be a string.`);
  }
  const fields = cloneJsonObject(value.fields, `${label}.fields`);
  return deepFreezeJson({
    sequence,
    acceptedAt,
    level: /** @type {'trace'|'debug'|'info'|'warn'|'error'} */ (value.level),
    message: value.message,
    fields,
  });
}

/**
 * Strictly construct the only public attempt-log page shape.
 * @param {{disclosure: string, scope: ActivityAttemptLogPageScope, snapshot: ActivityAttemptLogPageSnapshot, items: ActivityAttemptLogPageItem[], nextCursor?: string}} input - Candidate page.
 * @returns {Readonly<{disclosure: 'application-sensitive-unredacted', scope: Readonly<ActivityAttemptLogPageScope>, snapshot: Readonly<ActivityAttemptLogPageSnapshot>, items: Readonly<ActivityAttemptLogPageItem>[], nextCursor?: string}>} - Frozen safe page.
 */
export function createExecutionLedgerAttemptLogPage(input) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES +
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'activity attempt-log page',
  );
  assertSnapshotKeys(
    value,
    ['disclosure', 'scope', 'snapshot', 'items'],
    ['nextCursor'],
    'activity attempt-log page',
  );
  if (value.disclosure !== EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE) {
    throw new TypeError(
      'activity attempt-log page.disclosure is not supported.',
    );
  }
  const scope = normalizeExecutionLedgerAttemptLogPageScope(
    value.scope,
    'activity attempt-log page.scope',
  );
  const snapshot = normalizeExecutionLedgerAttemptLogPageSnapshot(
    value.snapshot,
    'activity attempt-log page.snapshot',
  );
  if (
    !Array.isArray(value.items) ||
    value.items.length > EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_MAX_LIMIT ||
    value.items.length > snapshot.entryCount ||
    (snapshot.entryCount > 0 && value.items.length === 0)
  ) {
    throw new TypeError(
      'activity attempt-log page.items must be a bounded snapshot page.',
    );
  }
  const items = value.items.map((item, index) =>
    normalizePageItem(item, `activity attempt-log page.items[${index}]`),
  );
  for (let index = 1; index < items.length; index += 1) {
    if (items[index].sequence <= items[index - 1].sequence) {
      throw new TypeError(
        'activity attempt-log page.items must have increasing sequences.',
      );
    }
  }
  if (
    items.some(
      (item) =>
        snapshot.lastSequence === null || item.sequence > snapshot.lastSequence,
    ) ||
    (snapshot.entryCount === 0 && items.length !== 0)
  ) {
    throw new TypeError(
      'activity attempt-log page.items do not belong to its snapshot.',
    );
  }
  let nextCursor;
  if (Object.prototype.hasOwnProperty.call(value, 'nextCursor')) {
    if (typeof value.nextCursor !== 'string' || value.nextCursor.length === 0) {
      throw new TypeError(
        'activity attempt-log page.nextCursor must be a nonempty opaque string.',
      );
    }
    const continuation = parseExecutionLedgerAttemptLogPageCursor(
      value.nextCursor,
      scope,
    );
    if (
      JSON.stringify(continuation.snapshot) !== JSON.stringify(snapshot) ||
      items.length === 0 ||
      continuation.previousSequence !== items.at(-1)?.sequence
    ) {
      throw new TypeError(
        'activity attempt-log page.nextCursor does not continue its items.',
      );
    }
    nextCursor = value.nextCursor;
  } else if (
    snapshot.entryCount > 0 &&
    items.at(-1)?.sequence !== snapshot.lastSequence
  ) {
    throw new TypeError(
      'activity attempt-log page terminal items do not reach its snapshot tip.',
    );
  }
  return deepFreezeJson({
    disclosure: EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE,
    scope,
    snapshot,
    items,
    ...(nextCursor ? { nextCursor } : {}),
  });
}

export default {
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_SCHEMA_VERSION,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_DEFAULT_LIMIT,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_MAX_LIMIT,
  createExecutionLedgerAttemptLogPage,
  createExecutionLedgerAttemptLogPageCursor,
  normalizeExecutionLedgerAttemptLogPageOptions,
  normalizeExecutionLedgerAttemptLogPageScope,
  normalizeExecutionLedgerAttemptLogPageSnapshot,
  parseExecutionLedgerAttemptLogPageCursor,
};
