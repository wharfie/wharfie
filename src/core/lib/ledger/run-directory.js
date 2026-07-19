import { createCanonicalJsonSha256Id } from '../../runtime/content-id.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import {
  assertLedgerServiceId,
  createLedgerServiceId,
} from '../db/tables/ledger-service-lifecycle.js';
import { assertLedgerOpaqueId, encodeLedgerKeySegment } from './record-key.js';

/**
 * A run-history directory is a typed, queryable projection of one service's
 * runs. It is deliberately not a ready-work queue: directory membership says
 * only that a durable run exists, never that a resident worker may execute it.
 */
// V7 is paired with the V9 ledger namespace. Reusing V6 would place V8 and V9
// run projections in one directory partition despite incompatible durable
// ledger semantics.
export const EXECUTION_LEDGER_RUN_DIRECTORY_SCHEMA_VERSION = 7;
export const EXECUTION_LEDGER_RUN_DIRECTORY_PARTITION_DOMAIN =
  'wharfie:execution-ledger-run-directory:v7';
export const EXECUTION_LEDGER_RUN_DIRECTORY_PARTITION_PREFIX = 'wld';
export const EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX =
  'ledger-directory/v7/run/';
export const EXECUTION_LEDGER_RUN_DIRECTORY_TIMESTAMP_WIDTH = 16;

/**
 * @param {unknown} value - Candidate durable timestamp.
 * @param {string} label - Human-readable value path.
 * @returns {number} - Validated timestamp.
 */
function assertDirectoryTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/**
 * Derive the directory partition from the same stable service identity used
 * by the local resident lifecycle. The partition stays separate from lifecycle
 * records, so a page can never accidentally include ownership/lifecycle rows.
 * @param {{appId: string, serviceId?: string}} input - Application/service scope.
 * @returns {{appId: string, serviceId: string, directoryId: string}} - Exact directory scope.
 */
export function createExecutionLedgerRunDirectoryScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('run directory scope must be an object.');
  }
  const allowed = new Set(['appId', 'serviceId']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new TypeError(`run directory scope.${key} is not supported.`);
    }
  }
  assertLogicalId(input.appId, 'run directory scope.appId');
  const serviceId = createLedgerServiceId({ appId: input.appId });
  if (input.serviceId !== undefined) {
    assertLedgerServiceId(input.serviceId, 'run directory scope.serviceId');
    if (input.serviceId !== serviceId) {
      throw new TypeError(
        'run directory scope.serviceId does not belong to run directory scope.appId.',
      );
    }
  }
  const directoryId = createCanonicalJsonSha256Id({
    domain: EXECUTION_LEDGER_RUN_DIRECTORY_PARTITION_DOMAIN,
    prefix: EXECUTION_LEDGER_RUN_DIRECTORY_PARTITION_PREFIX,
    value: {
      schemaVersion: EXECUTION_LEDGER_RUN_DIRECTORY_SCHEMA_VERSION,
      serviceId,
    },
    valuePath: 'execution ledger run directory partition',
  });
  return { appId: input.appId, serviceId, directoryId };
}

/**
 * Create a newest-first immutable directory key. Creation ordering avoids
 * duplicates/skips when a run changes status between independently read pages.
 * @param {{createdAt: number, runId: string}} input - Immutable run identity and creation time.
 * @returns {string} - Lexically sortable directory sort key.
 */
export function getExecutionLedgerRunDirectorySortKey(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('run directory sort key input must be an object.');
  }
  const allowed = new Set(['createdAt', 'runId']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `run directory sort key input.${key} is not supported.`,
      );
    }
  }
  const createdAt = assertDirectoryTimestamp(
    input.createdAt,
    'run directory sort key input.createdAt',
  );
  const reverseCreatedAt = String(Number.MAX_SAFE_INTEGER - createdAt).padStart(
    EXECUTION_LEDGER_RUN_DIRECTORY_TIMESTAMP_WIDTH,
    '0',
  );
  return `${EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX}${reverseCreatedAt}/${encodeLedgerKeySegment(
    assertLedgerOpaqueId(input.runId, 'run directory sort key input.runId'),
    'run directory sort key input.runId',
  )}`;
}

/**
 * Decode and canonicalize one immutable directory key before using it as a
 * page boundary. Cursors must name the exact representation this module
 * emits; accepting a merely prefix-shaped key would make a forged cursor
 * behave differently across storage adapters.
 * @param {unknown} value - Candidate directory sort key.
 * @param {string} [label] - Human-readable value path.
 * @returns {{createdAt: number, runId: string}} - Decoded immutable identity.
 */
export function parseExecutionLedgerRunDirectorySortKey(
  value,
  label = 'run directory sort key',
) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a string.`);
  }
  if (!value.startsWith(EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX)) {
    throw new TypeError(
      `${label} must begin with the run directory sort-key prefix.`,
    );
  }
  const suffix = value.slice(
    EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX.length,
  );
  const separator = suffix.indexOf('/');
  if (
    separator !== EXECUTION_LEDGER_RUN_DIRECTORY_TIMESTAMP_WIDTH ||
    suffix.indexOf('/', separator + 1) !== -1
  ) {
    throw new TypeError(`${label} must contain one fixed-width timestamp.`);
  }
  const reverseCreatedAtText = suffix.slice(0, separator);
  const encodedRunId = suffix.slice(separator + 1);
  if (
    !/^\d{16}$/.test(reverseCreatedAtText) ||
    !/^[A-Za-z0-9_-]+$/.test(encodedRunId)
  ) {
    throw new TypeError(`${label} is not canonically encoded.`);
  }
  const reverseCreatedAt = Number(reverseCreatedAtText);
  if (
    !Number.isSafeInteger(reverseCreatedAt) ||
    reverseCreatedAt < 0 ||
    reverseCreatedAt > Number.MAX_SAFE_INTEGER
  ) {
    throw new TypeError(`${label} has an invalid timestamp.`);
  }
  let runId;
  try {
    const bytes = Buffer.from(encodedRunId, 'base64url');
    if (bytes.toString('base64url') !== encodedRunId) {
      throw new Error('noncanonical base64url');
    }
    runId = assertLedgerOpaqueId(
      bytes.toString('utf8'),
      `${label} run identity`,
    );
  } catch {
    throw new TypeError(`${label} has an invalid run identity.`);
  }
  const createdAt = Number.MAX_SAFE_INTEGER - reverseCreatedAt;
  if (getExecutionLedgerRunDirectorySortKey({ createdAt, runId }) !== value) {
    throw new TypeError(`${label} is not canonical.`);
  }
  return { createdAt, runId };
}

export default {
  EXECUTION_LEDGER_RUN_DIRECTORY_PARTITION_DOMAIN,
  EXECUTION_LEDGER_RUN_DIRECTORY_PARTITION_PREFIX,
  EXECUTION_LEDGER_RUN_DIRECTORY_SCHEMA_VERSION,
  EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX,
  EXECUTION_LEDGER_RUN_DIRECTORY_TIMESTAMP_WIDTH,
  createExecutionLedgerRunDirectoryScope,
  getExecutionLedgerRunDirectorySortKey,
  parseExecutionLedgerRunDirectorySortKey,
};
