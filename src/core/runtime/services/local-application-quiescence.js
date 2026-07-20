/* eslint-disable jsdoc/valid-types -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { assertApplicationRevisionId } from '../application-revision.js';
import { assertLogicalId } from '../logical-id.js';
import { RunStatus } from '../../lib/ledger/execution-ledger-contract.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';

export const LOCAL_APPLICATION_QUIESCENCE_PAGE_SIZE = 100;
export const LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT = 20;

const LOCAL_APPLICATION_QUIESCENCE_SCHEMA_VERSION = 1;
const LOCAL_APPLICATION_QUIESCENCE_KIND =
  'wharfie.local-application-quiescence';
const LOCAL_APPLICATION_QUIESCENCE_REFUSAL_CODE =
  'WHARFIE_LOCAL_APPLICATION_NOT_QUIESCENT';
const MAX_CURSOR_BYTES = 4096;
const PAGE_KEYS = new Set(['items', 'nextCursor']);
const RUN_ITEM_KEYS = new Set([
  'runId',
  'appId',
  'revisionId',
  'kind',
  'status',
  'version',
  'lastSequence',
  'createdAt',
  'updatedAt',
]);
const RUN_KINDS = new Set(['manual', 'workflow', 'effect-successor']);
const RUN_STATUSES = new Set(Object.values(RunStatus));
const TERMINAL_RUN_STATUSES = new Set([
  RunStatus.COMPLETED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
]);

/**
 * @typedef LocalApplicationQuiescenceBlocker
 * @property {string} runId - Durable run identity.
 * @property {string} revisionId - Immutable revision owning the run.
 * @property {'manual'|'workflow'|'effect-successor'} kind - Durable run kind.
 * @property {'RUNNING'|'BLOCKED'} status - Nonterminal durable status.
 * @property {number} updatedAt - Last durable transition time.
 */

/**
 * @typedef LocalApplicationQuiescenceReport
 * @property {1} schemaVersion - Report schema.
 * @property {'wharfie.local-application-quiescence'} kind - Report kind.
 * @property {string} appId - Application scope.
 * @property {boolean} quiescent - Whether every durable run is terminal.
 * @property {number} scannedRunCount - Number of verified directory rows read.
 * @property {number} blockerCount - Number of nonterminal runs found.
 * @property {Array<Readonly<LocalApplicationQuiescenceBlocker>>} blockers - Bounded redacted blocker sample.
 * @property {boolean} blockersTruncated - Whether blockers were omitted from the sample.
 */

/** Raised when a release operation refuses nonterminal durable work. */
export class LocalApplicationQuiescenceRefusalError extends Error {
  /**
   * @param {Readonly<LocalApplicationQuiescenceReport>} report - Exact inspection result.
   */
  constructor(report) {
    super(
      `Local application ${report.appId} is not quiescent (${report.blockerCount} nonterminal durable ${report.blockerCount === 1 ? 'run' : 'runs'}).`,
    );
    this.name = 'LocalApplicationQuiescenceRefusalError';
    this.code = LOCAL_APPLICATION_QUIESCENCE_REFUSAL_CODE;
    this.appId = report.appId;
    this.blockerCount = report.blockerCount;
    this.blockers = report.blockers;
    this.report = report;
  }
}

/**
 * @param {unknown} value - Candidate plain record.
 * @param {string} label - Boundary label.
 * @returns {asserts value is Record<string, any>} - Returns for a plain record.
 */
function assertRecord(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object.`);
  }
}

/**
 * @param {Record<string, any>} value - Record to inspect.
 * @param {Set<string>} allowed - Supported keys.
 * @param {string[]} required - Required keys.
 * @param {string} label - Boundary label.
 * @returns {void} - Returns for an exact supported shape.
 */
function assertKeys(value, allowed, required, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${label}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate positive integer.
 * @param {string} label - Boundary label.
 * @returns {number} - Normalized integer.
 */
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate nonnegative integer.
 * @param {string} label - Boundary label.
 * @returns {number} - Normalized integer.
 */
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/**
 * Strictly validate one verified run-directory item before relying on its
 * terminal status. Only the redacted fields copied below can reach a refusal.
 * @param {unknown} raw - Candidate listRuns item.
 * @param {string} appId - Expected application scope.
 * @param {number} index - Global item index for diagnostics.
 * @returns {Readonly<Record<string, any>>} - Validated scalar snapshot.
 */
function normalizeRunItem(raw, appId, index) {
  const label = `local application quiescence run ${index}`;
  assertRecord(raw, label);
  assertKeys(raw, RUN_ITEM_KEYS, [...RUN_ITEM_KEYS], label);
  const runId = assertLedgerOpaqueId(raw.runId, `${label}.runId`);
  assertLogicalId(raw.appId, `${label}.appId`);
  if (raw.appId !== appId) {
    throw new TypeError(`${label}.appId does not match the requested scope.`);
  }
  assertApplicationRevisionId(raw.revisionId, `${label}.revisionId`);
  if (!RUN_KINDS.has(raw.kind)) {
    throw new TypeError(`${label}.kind is unsupported.`);
  }
  if (!RUN_STATUSES.has(raw.status)) {
    throw new TypeError(`${label}.status is unsupported.`);
  }
  const version = positiveInteger(raw.version, `${label}.version`);
  const lastSequence = positiveInteger(
    raw.lastSequence,
    `${label}.lastSequence`,
  );
  const createdAt = nonnegativeInteger(raw.createdAt, `${label}.createdAt`);
  const updatedAt = nonnegativeInteger(raw.updatedAt, `${label}.updatedAt`);
  if (updatedAt < createdAt) {
    throw new TypeError(`${label}.updatedAt precedes createdAt.`);
  }
  return Object.freeze({
    runId,
    appId,
    revisionId: raw.revisionId,
    kind: raw.kind,
    status: raw.status,
    version,
    lastSequence,
    createdAt,
    updatedAt,
  });
}

/**
 * @param {unknown} value - Candidate opaque page cursor.
 * @param {string} label - Boundary label.
 * @returns {string} - Valid cursor.
 */
function normalizeCursor(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAX_CURSOR_BYTES ||
    Buffer.from(value, 'utf8').toString('utf8') !== value
  ) {
    throw new TypeError(`${label} must be a bounded nonempty Unicode string.`);
  }
  return value;
}

/**
 * Fully inspect one application after durable run creation has been closed.
 * `listRuns` is authoritative rather than `listReadyWork`: blocked and waiting
 * runs also prevent a revision switch even when they are not dispatchable.
 *
 * The caller owns the admission barrier. This function proves only the run
 * set it reads; it does not close admission or stop a resident process.
 * @param {{ledger: {listRuns: Function}, appId: string}} options - Inspection dependencies.
 * @returns {Promise<Readonly<LocalApplicationQuiescenceReport>>} - Deeply frozen redacted report.
 */
export async function inspectLocalApplicationQuiescence(options) {
  assertRecord(options, 'local application quiescence options');
  assertKeys(
    options,
    new Set(['ledger', 'appId']),
    ['ledger', 'appId'],
    'local application quiescence options',
  );
  if (!options.ledger || typeof options.ledger.listRuns !== 'function') {
    throw new TypeError(
      'Local application quiescence requires a ledger with listRuns.',
    );
  }
  assertLogicalId(options.appId, 'local application quiescence appId');

  let cursor;
  let scannedRunCount = 0;
  let blockerCount = 0;
  /** @type {Readonly<LocalApplicationQuiescenceBlocker>[]} */
  const blockers = [];
  const seenCursors = new Set();
  const seenRunIds = new Set();

  do {
    const rawPage = await options.ledger.listRuns({
      appId: options.appId,
      limit: LOCAL_APPLICATION_QUIESCENCE_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const pageLabel = `local application quiescence page ${seenCursors.size + 1}`;
    assertRecord(rawPage, pageLabel);
    assertKeys(rawPage, PAGE_KEYS, ['items'], pageLabel);
    if (
      !Array.isArray(rawPage.items) ||
      rawPage.items.length > LOCAL_APPLICATION_QUIESCENCE_PAGE_SIZE
    ) {
      throw new TypeError(
        `${pageLabel}.items must be an array within the requested page limit.`,
      );
    }

    for (const rawItem of rawPage.items) {
      const item = normalizeRunItem(rawItem, options.appId, scannedRunCount);
      if (seenRunIds.has(item.runId)) {
        throw new TypeError(
          `Local application quiescence encountered duplicate run ${item.runId}.`,
        );
      }
      seenRunIds.add(item.runId);
      scannedRunCount += 1;
      if (!TERMINAL_RUN_STATUSES.has(item.status)) {
        blockerCount += 1;
        if (
          blockers.length < LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT
        ) {
          blockers.push(
            Object.freeze({
              runId: item.runId,
              revisionId: item.revisionId,
              kind: item.kind,
              status: item.status,
              updatedAt: item.updatedAt,
            }),
          );
        }
      }
    }

    if (!Object.prototype.hasOwnProperty.call(rawPage, 'nextCursor')) break;
    if (rawPage.items.length === 0) {
      throw new TypeError(
        `${pageLabel}.nextCursor cannot follow an empty page.`,
      );
    }
    const nextCursor = normalizeCursor(
      rawPage.nextCursor,
      `${pageLabel}.nextCursor`,
    );
    if (seenCursors.has(nextCursor) || nextCursor === cursor) {
      throw new TypeError(
        'Local application quiescence encountered a repeated page cursor.',
      );
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor !== undefined);

  Object.freeze(blockers);
  return Object.freeze({
    schemaVersion: LOCAL_APPLICATION_QUIESCENCE_SCHEMA_VERSION,
    kind: LOCAL_APPLICATION_QUIESCENCE_KIND,
    appId: options.appId,
    quiescent: blockerCount === 0,
    scannedRunCount,
    blockerCount,
    blockers,
    blockersTruncated: blockerCount > blockers.length,
  });
}

/**
 * Refuse a release operation unless a completed inspection found no durable
 * nonterminal work. The original deeply frozen report remains attached to the
 * typed error for redacted operator output.
 * @param {Readonly<LocalApplicationQuiescenceReport>} report - Inspection result.
 * @returns {Readonly<LocalApplicationQuiescenceReport>} - The accepted report.
 */
export function assertLocalApplicationQuiescent(report) {
  if (
    !report ||
    typeof report !== 'object' ||
    report.schemaVersion !== LOCAL_APPLICATION_QUIESCENCE_SCHEMA_VERSION ||
    report.kind !== LOCAL_APPLICATION_QUIESCENCE_KIND ||
    typeof report.appId !== 'string' ||
    typeof report.quiescent !== 'boolean' ||
    !Number.isSafeInteger(report.scannedRunCount) ||
    report.scannedRunCount < 0 ||
    !Number.isSafeInteger(report.blockerCount) ||
    report.blockerCount < 0 ||
    !Array.isArray(report.blockers) ||
    typeof report.blockersTruncated !== 'boolean' ||
    report.quiescent !== (report.blockerCount === 0) ||
    report.blockersTruncated !== report.blockerCount > report.blockers.length ||
    report.blockers.length >
      LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT ||
    !Object.isFrozen(report) ||
    !Object.isFrozen(report.blockers) ||
    report.blockers.some((blocker) => !Object.isFrozen(blocker))
  ) {
    throw new TypeError(
      'assertLocalApplicationQuiescent requires a deeply frozen inspection report.',
    );
  }
  assertLogicalId(report.appId, 'local application quiescence report.appId');
  if (!report.quiescent) {
    throw new LocalApplicationQuiescenceRefusalError(report);
  }
  return report;
}

export default inspectLocalApplicationQuiescence;
