import { Command, InvalidArgumentError } from 'commander';

import {
  ACTIVITY_PROTOCOL_LOG_LEVELS,
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  validateActivityProtocolComponentFrame,
} from '../activity-protocol.js';
import { assertApplicationRevisionId } from '../application-revision.js';
import { assertLogicalId } from '../logical-id.js';
import {
  EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE,
  EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES,
  EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES,
} from '../../lib/ledger/attempt-log.js';
import {
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_DEFAULT_LIMIT,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_MAX_LIMIT,
  createExecutionLedgerAttemptLogPage,
  parseExecutionLedgerAttemptLogPageCursor,
} from '../../lib/ledger/attempt-log-page.js';
import {
  assertNonnegativeSafeInteger,
  assertPositiveSafeInteger,
} from '../../lib/ledger/execution-ledger-contract.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { withExecutionLedger } from './execution-ledger-store.js';
import { renderTerminalSafeJson } from './terminal-safe-json.js';

export const EXECUTION_LEDGER_ACTIVITY_LOG_PAGE_SCHEMA_VERSION = 1;
export const EXECUTION_LEDGER_ACTIVITY_LOG_PAGE_KIND =
  'wharfie.execution-ledger.activity-log-page';
export const EXECUTION_LEDGER_ACTIVITY_LOG_DEFAULT_LIMIT =
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_DEFAULT_LIMIT;
export const EXECUTION_LEDGER_ACTIVITY_LOG_MAX_LIMIT =
  EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_MAX_LIMIT;

const INVALID_PAGE =
  'Execution-ledger activity logs returned an invalid verified page.';
const SAFE_FAILURE =
  'Sensitive durable activity logs could not be read safely. No partial page was emitted.';
const CONFIRMATION_REQUIRED =
  'logs requires --confirm-sensitive-output because application logs are unredacted and may contain secrets.';
const LOG_LEVELS = new Set(ACTIVITY_PROTOCOL_LOG_LEVELS);

/**
 * @typedef {object} ExecutionLedgerActivityLogPageScope
 * @property {string} appId - Owning application identity.
 * @property {string} revisionId - Immutable application revision.
 * @property {string} runId - Logical run identity.
 * @property {string} invocationId - Logical invocation identity.
 * @property {string} activityId - Activity identity.
 * @property {string} attemptId - Physical attempt identity.
 * @property {number} generation - Physical-attempt generation.
 * @property {number} coordinatorEpoch - Owning coordinator epoch.
 */

/**
 * @typedef {object} ExecutionLedgerActivityLogPageItem
 * @property {number} sequence - Attempt-local Activity Protocol sequence.
 * @property {number} acceptedAt - Host acceptance observation.
 * @property {'trace'|'debug'|'info'|'warn'|'error'} level - Log level.
 * @property {string} message - Raw application message.
 * @property {Record<string, any>} fields - Raw application fields.
 */

/**
 * @typedef ExecutionLedgerActivityLogOutput
 * @property {(value: Record<string, any>) => void} json - Write one raw JSON page.
 * @property {(rows: Array<Record<string, any>>) => void} table - Write escaped human rows.
 * @property {(message: string) => void} info - Write pagination guidance.
 * @property {(error: Error) => void} failure - Write one safe failure.
 */

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether value is a non-array object.
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, any>} value - Candidate exact object.
 * @param {string[]} required - Required keys.
 * @param {string[]} optional - Optional keys.
 * @returns {void} - Throws on a missing or unknown key.
 */
function assertKeys(value, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new TypeError(INVALID_PAGE);
  }
}

/**
 * @param {unknown} value - Candidate cursor.
 * @param {string} field - Safe field name for an error.
 * @returns {string} - Bounded opaque cursor.
 */
function normalizeCursor(value, field) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') >
      EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES
  ) {
    throw new TypeError(`${field} must be a bounded nonempty string.`);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate page size.
 * @param {string} field - Safe field name for an error.
 * @returns {number} - Valid page size.
 */
function normalizeLimit(value, field) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > EXECUTION_LEDGER_ACTIVITY_LOG_MAX_LIMIT
  ) {
    throw new RangeError(
      `${field} must be an integer from 1 through ${EXECUTION_LEDGER_ACTIVITY_LOG_MAX_LIMIT}.`,
    );
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate read request.
 * @returns {{appId: string, runId: string, attemptId: string, limit: number, cursor?: string}} - Exact read request.
 */
function normalizeReadRequest(value) {
  if (!isObject(value)) {
    throw new TypeError('Execution-ledger activity-log request is invalid.');
  }
  assertKeys(value, ['appId', 'runId', 'attemptId', 'limit'], ['cursor']);
  assertLogicalId(value.appId, 'activity-log request.appId');
  const appId = /** @type {string} */ (value.appId);
  const runId = assertLedgerOpaqueId(value.runId, 'activity-log request.runId');
  const attemptId = assertLedgerOpaqueId(
    value.attemptId,
    'activity-log request.attemptId',
  );
  const request = {
    appId,
    runId,
    attemptId,
    limit: normalizeLimit(value.limit, 'activity-log request.limit'),
  };
  return value.cursor === undefined
    ? request
    : {
        ...request,
        cursor: normalizeCursor(value.cursor, 'activity-log request.cursor'),
      };
}

/**
 * @param {unknown} error - Candidate adapter error.
 * @returns {boolean} - Whether the read-only local store is absent.
 */
function isMissingReadOnlyStore(error) {
  return isObject(error) && error.code === 'WHARFIE_READ_ONLY_STORE_NOT_FOUND';
}

/**
 * Read one verified raw activity-log page through the default read-only store.
 * @param {unknown} value - Exact app/run/attempt request.
 * @returns {Promise<Record<string, any> | null>} - Raw ledger page or missing scope.
 */
export async function readExecutionLedgerActivityLogPage(value) {
  const request = normalizeReadRequest(value);
  try {
    return await withExecutionLedger(
      async (ledger) => await ledger.readActivityAttemptLogPage(request),
      { readOnly: true },
    );
  } catch (error) {
    if (isMissingReadOnlyStore(error)) return null;
    throw error;
  }
}

/**
 * @param {unknown} value - Candidate safe scope.
 * @param {{appId: string, runId: string, attemptId: string}} request - Requested public scope.
 * @returns {ExecutionLedgerActivityLogPageScope} - Strict non-secret scope.
 */
function projectScope(value, request) {
  if (!isObject(value)) throw new TypeError(INVALID_PAGE);
  assertKeys(value, [
    'appId',
    'revisionId',
    'runId',
    'invocationId',
    'activityId',
    'attemptId',
    'generation',
    'coordinatorEpoch',
  ]);
  assertLogicalId(value.appId, 'activity-log page.scope.appId');
  assertApplicationRevisionId(
    value.revisionId,
    'activity-log page.scope.revisionId',
  );
  assertLedgerOpaqueId(value.runId, 'activity-log page.scope.runId');
  assertLedgerOpaqueId(
    value.invocationId,
    'activity-log page.scope.invocationId',
  );
  assertLogicalId(value.activityId, 'activity-log page.scope.activityId');
  assertLedgerOpaqueId(value.attemptId, 'activity-log page.scope.attemptId');
  assertPositiveSafeInteger(
    value.generation,
    'activity-log page.scope.generation',
  );
  assertNonnegativeSafeInteger(
    value.coordinatorEpoch,
    'activity-log page.scope.coordinatorEpoch',
  );
  if (
    value.appId !== request.appId ||
    value.runId !== request.runId ||
    value.attemptId !== request.attemptId
  ) {
    throw new Error(INVALID_PAGE);
  }
  return {
    appId: value.appId,
    revisionId: value.revisionId,
    runId: value.runId,
    invocationId: value.invocationId,
    activityId: value.activityId,
    attemptId: value.attemptId,
    generation: value.generation,
    coordinatorEpoch: value.coordinatorEpoch,
  };
}

/**
 * @param {unknown} value - Candidate frozen-prefix summary.
 * @returns {{entryCount: number, cumulativePayloadBytes: number, lastSequence: number | null}} - Strict public snapshot.
 */
function projectSnapshot(value) {
  if (!isObject(value)) throw new TypeError(INVALID_PAGE);
  assertKeys(value, ['entryCount', 'cumulativePayloadBytes', 'lastSequence']);
  const entryCount = assertNonnegativeSafeInteger(
    value.entryCount,
    'activity-log page.snapshot.entryCount',
  );
  const cumulativePayloadBytes = assertNonnegativeSafeInteger(
    value.cumulativePayloadBytes,
    'activity-log page.snapshot.cumulativePayloadBytes',
  );
  if (
    entryCount > EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES ||
    cumulativePayloadBytes >
      EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES ||
    (entryCount === 0 &&
      (cumulativePayloadBytes !== 0 || value.lastSequence !== null)) ||
    (entryCount > 0 &&
      (!Number.isSafeInteger(value.lastSequence) ||
        Number(value.lastSequence) < 1))
  ) {
    throw new TypeError(INVALID_PAGE);
  }
  return {
    entryCount,
    cumulativePayloadBytes,
    lastSequence:
      value.lastSequence === null ? null : Number(value.lastSequence),
  };
}

/**
 * @param {{entryCount: number, cumulativePayloadBytes: number, lastSequence: number | null}} left - First normalized snapshot.
 * @param {{entryCount: number, cumulativePayloadBytes: number, lastSequence: number | null}} right - Second normalized snapshot.
 * @returns {boolean} - Whether both snapshots describe the same frozen prefix.
 */
function hasSameSnapshot(left, right) {
  return (
    left.entryCount === right.entryCount &&
    left.cumulativePayloadBytes === right.cumulativePayloadBytes &&
    left.lastSequence === right.lastSequence
  );
}

/**
 * @param {unknown} value - Candidate raw log-page item.
 * @param {ExecutionLedgerActivityLogPageScope} scope - Verified public scope.
 * @returns {ExecutionLedgerActivityLogPageItem} - Strict raw sensitive item.
 */
function projectItem(value, scope) {
  if (!isObject(value)) throw new TypeError(INVALID_PAGE);
  assertKeys(value, ['sequence', 'acceptedAt', 'level', 'message', 'fields']);
  const sequence = assertPositiveSafeInteger(
    value.sequence,
    'activity-log page.item.sequence',
  );
  const acceptedAt = assertNonnegativeSafeInteger(
    value.acceptedAt,
    'activity-log page.item.acceptedAt',
  );
  if (typeof value.level !== 'string' || !LOG_LEVELS.has(value.level)) {
    throw new TypeError(INVALID_PAGE);
  }
  const frame = validateActivityProtocolComponentFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'log',
      attemptId: scope.attemptId,
      sequence,
      level: value.level,
      message: value.message,
      fields: value.fields,
    },
    'activity-log page.item',
  );
  return {
    sequence,
    acceptedAt,
    level: frame.level,
    message: frame.message,
    fields: frame.fields,
  };
}

/**
 * Validate a complete raw page before any output port receives data.
 * @param {unknown} value - Raw ledger page.
 * @param {{appId: string, runId: string, attemptId: string, limit: number, cursor?: string}} request - Exact read request.
 * @returns {{scope: Readonly<ExecutionLedgerActivityLogPageScope>, snapshot: Readonly<{entryCount: number, cumulativePayloadBytes: number, lastSequence: number | null}>, items: Readonly<ExecutionLedgerActivityLogPageItem>[], nextCursor: string | null}} - Public page data.
 */
function projectPage(value, request) {
  if (!isObject(value)) throw new TypeError(INVALID_PAGE);
  const bounded = createExecutionLedgerAttemptLogPage(
    /** @type {any} */ (value),
  );
  if (bounded.items.length > request.limit) {
    throw new TypeError(INVALID_PAGE);
  }
  const scope = projectScope(bounded.scope, request);
  const snapshot = projectSnapshot(bounded.snapshot);
  const incoming =
    request.cursor === undefined
      ? null
      : parseExecutionLedgerAttemptLogPageCursor(request.cursor, scope);
  if (incoming && !hasSameSnapshot(incoming.snapshot, snapshot)) {
    throw new TypeError(INVALID_PAGE);
  }
  const startIndex = incoming?.nextIndex ?? 0;
  const expectedItemCount = Math.min(
    request.limit,
    snapshot.entryCount - startIndex,
  );
  if (bounded.items.length !== expectedItemCount) {
    throw new TypeError(INVALID_PAGE);
  }
  /** @type {ExecutionLedgerActivityLogPageItem[]} */
  const items = [];
  let previousSequence = incoming?.previousSequence ?? 0;
  for (let index = 0; index < bounded.items.length; index += 1) {
    if (!Object.hasOwn(bounded.items, index)) throw new TypeError(INVALID_PAGE);
    const item = projectItem(bounded.items[index], scope);
    if (
      item.sequence <= previousSequence ||
      snapshot.lastSequence === null ||
      item.sequence > snapshot.lastSequence
    ) {
      throw new TypeError(INVALID_PAGE);
    }
    previousSequence = item.sequence;
    items.push(item);
  }

  let nextCursor = null;
  const endIndex = startIndex + items.length;
  if (Object.hasOwn(bounded, 'nextCursor')) {
    nextCursor = normalizeCursor(
      bounded.nextCursor,
      'activity-log page.nextCursor',
    );
    const outgoing = parseExecutionLedgerAttemptLogPageCursor(
      nextCursor,
      scope,
    );
    if (
      items.length === 0 ||
      nextCursor === request.cursor ||
      !hasSameSnapshot(outgoing.snapshot, snapshot) ||
      outgoing.nextIndex !== endIndex ||
      outgoing.previousSequence !== items.at(-1)?.sequence ||
      endIndex >= snapshot.entryCount
    ) {
      throw new TypeError(INVALID_PAGE);
    }
  } else if (
    endIndex !== snapshot.entryCount ||
    (snapshot.entryCount > 0 &&
      items.at(-1)?.sequence !== snapshot.lastSequence)
  ) {
    throw new TypeError(INVALID_PAGE);
  }
  return {
    scope,
    snapshot,
    items,
    nextCursor,
  };
}

/**
 * @param {Readonly<ExecutionLedgerActivityLogPageItem>[]} items - Verified raw page items.
 * @returns {Record<string, any>[]} - Terminal-inert human rows.
 */
function createHumanRows(items) {
  return items.map((item) => ({
    sequence: item.sequence,
    accepted_at: item.acceptedAt,
    level: item.level,
    message_json: renderTerminalSafeJson(item.message),
    fields_json: renderTerminalSafeJson(item.fields),
  }));
}

/**
 * @param {unknown} provided - Optional output overrides.
 * @returns {ExecutionLedgerActivityLogOutput} - Complete output port.
 */
function resolveOutput(provided) {
  if (provided !== undefined && !isObject(provided)) {
    throw new TypeError(
      'Execution-ledger activity-log output must be an object.',
    );
  }
  const candidate =
    provided === undefined ? {} : /** @type {Record<string, any>} */ (provided);
  for (const key of ['json', 'table', 'info', 'failure']) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'function') {
      throw new TypeError(
        `Execution-ledger activity-log output.${key} must be a function.`,
      );
    }
  }
  return {
    json:
      candidate.json || ((value) => console.log(renderTerminalSafeJson(value))),
    table: candidate.table || ((rows) => console.table(rows)),
    info: candidate.info || ((message) => console.log(message)),
    failure:
      candidate.failure ||
      ((error) => {
        console.error(error.message);
      }),
  };
}

/**
 * @param {string} value - Current CLI value.
 * @param {number | undefined} previous - Previous parsed value.
 * @returns {number} - Canonical page size.
 */
function parseLimit(value, previous) {
  if (previous !== undefined || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(value)) {
    throw new InvalidArgumentError(
      `--limit must be specified once as an integer from 1 through ${EXECUTION_LEDGER_ACTIVITY_LOG_MAX_LIMIT}.`,
    );
  }
  return Number(value);
}

/**
 * @param {string} value - Current CLI value.
 * @param {string | undefined} previous - Previous value.
 * @returns {string} - Bounded opaque cursor.
 */
function parseCursor(value, previous) {
  if (previous !== undefined) {
    throw new InvalidArgumentError('--cursor may be specified only once.');
  }
  try {
    return normalizeCursor(value, '--cursor');
  } catch {
    throw new InvalidArgumentError(
      `--cursor must be a nonempty value of at most ${EXECUTION_LEDGER_ATTEMPT_LOG_PAGE_CURSOR_MAX_BYTES} bytes.`,
    );
  }
}

/**
 * @param {string} value - Current CLI value.
 * @param {string | undefined} previous - Previous value.
 * @returns {string} - Canonical application ID.
 */
function parseAppId(value, previous) {
  if (previous !== undefined) {
    throw new InvalidArgumentError('--app-id may be specified only once.');
  }
  try {
    assertLogicalId(value, '--app-id');
    return value;
  } catch {
    throw new InvalidArgumentError('--app-id must be a canonical logical ID.');
  }
}

/**
 * @param {string} option - Public option name.
 * @returns {(value: string, previous: string | undefined) => string} - Single opaque-ID parser.
 */
function createOpaqueIdParser(option) {
  return (value, previous) => {
    if (previous !== undefined) {
      throw new InvalidArgumentError(`${option} may be specified only once.`);
    }
    try {
      return assertLedgerOpaqueId(value, option);
    } catch {
      throw new InvalidArgumentError(
        `${option} must be a bounded canonical ledger ID.`,
      );
    }
  };
}

/**
 * Create the shared source or packaged sensitive activity-log command.
 * Exactly one identity mode is selected: source accepts `--app-id`, while a
 * packaged host resolves its embedded app ID lazily.
 * @param {{allowAppId?: boolean, resolveAppId?: () => unknown | Promise<unknown>, readPage?: (request: {appId: string, runId: string, attemptId: string, limit: number, cursor?: string}) => unknown | Promise<unknown>, output?: Partial<ExecutionLedgerActivityLogOutput>}} options - Identity and read dependencies.
 * @returns {Command} - Fresh `logs` command.
 */
export function createExecutionLedgerActivityLogCommand(options) {
  if (!isObject(options)) {
    throw new TypeError(
      'Execution-ledger activity-log command options are invalid.',
    );
  }
  const allowAppId = options.allowAppId === true;
  const hasResolver = typeof options.resolveAppId === 'function';
  if (
    (options.allowAppId !== undefined &&
      typeof options.allowAppId !== 'boolean') ||
    allowAppId === hasResolver ||
    (options.readPage !== undefined && typeof options.readPage !== 'function')
  ) {
    throw new TypeError(
      'Execution-ledger activity-log command identity mode is invalid.',
    );
  }
  const readPage = options.readPage || readExecutionLedgerActivityLogPage;
  const output = resolveOutput(options.output);
  const command = new Command('logs').description(
    'Read one attempt’s verified sensitive durable activity logs',
  );
  if (allowAppId) {
    command.option(
      '--app-id <appId>',
      'Exact application logical ID that owns the persisted run',
      parseAppId,
    );
  }
  command
    .option(
      '--run-id <runId>',
      'Exact persisted execution-ledger run ID',
      createOpaqueIdParser('--run-id'),
    )
    .option(
      '--attempt-id <attemptId>',
      'Exact persisted physical-attempt ID',
      createOpaqueIdParser('--attempt-id'),
    )
    .option(
      '--limit <limit>',
      `Maximum log entries to return (default ${EXECUTION_LEDGER_ACTIVITY_LOG_DEFAULT_LIMIT}, maximum ${EXECUTION_LEDGER_ACTIVITY_LOG_MAX_LIMIT})`,
      parseLimit,
    )
    .option(
      '--cursor <cursor>',
      'Opaque cursor returned by the prior frozen-prefix page',
      parseCursor,
    )
    .option(
      '--confirm-sensitive-output',
      'Confirm that raw application logs may contain secrets',
    )
    .option('--json', 'Write one raw machine-readable log page')
    .action(async (commandOptions) => {
      if (commandOptions.confirmSensitiveOutput !== true) {
        output.failure(new Error(CONFIRMATION_REQUIRED));
        process.exitCode = 1;
        return;
      }
      try {
        const appIdValue = allowAppId
          ? commandOptions.appId
          : await options.resolveAppId?.();
        assertLogicalId(appIdValue, 'activity-log command appId');
        const request = normalizeReadRequest({
          appId: appIdValue,
          runId: commandOptions.runId,
          attemptId: commandOptions.attemptId,
          limit:
            commandOptions.limit ?? EXECUTION_LEDGER_ACTIVITY_LOG_DEFAULT_LIMIT,
          ...(commandOptions.cursor === undefined
            ? {}
            : { cursor: commandOptions.cursor }),
        });
        const rawPage = await readPage(request);
        if (rawPage === null) throw new Error(INVALID_PAGE);
        const page = projectPage(rawPage, request);
        const publicPage = {
          schemaVersion: EXECUTION_LEDGER_ACTIVITY_LOG_PAGE_SCHEMA_VERSION,
          kind: EXECUTION_LEDGER_ACTIVITY_LOG_PAGE_KIND,
          authority: 'none',
          authoritative: false,
          disclosure: EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE,
          integrity: { verified: true },
          scope: page.scope,
          snapshot: page.snapshot,
          items: page.items,
          nextCursor: page.nextCursor,
        };
        if (commandOptions.json === true) {
          output.json(publicPage);
          return;
        }
        const rows = createHumanRows(page.items);
        const nextPage =
          page.nextCursor === null
            ? null
            : `Next page: --cursor ${JSON.stringify(page.nextCursor)}`;
        output.table(rows);
        if (nextPage !== null) output.info(nextPage);
      } catch {
        output.failure(new Error(SAFE_FAILURE));
        process.exitCode = 1;
      }
    });
  return command;
}

export default createExecutionLedgerActivityLogCommand;
