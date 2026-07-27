import { Command, InvalidArgumentError } from 'commander';

import { assertLogicalId } from '../logical-id.js';
import { withExecutionLedger } from './execution-ledger-store.js';

export const EXECUTION_LEDGER_HISTORY_PAGE_SCHEMA_VERSION = 1;
export const EXECUTION_LEDGER_HISTORY_PAGE_KIND =
  'wharfie.execution-ledger.run-page';
export const EXECUTION_LEDGER_HISTORY_DEFAULT_LIMIT = 50;
export const EXECUTION_LEDGER_HISTORY_MAX_LIMIT = 100;

const CURSOR_MAX_BYTES = 4096;
const DIRECTORY_MAX_BYTES = 4096;
const INVALID_PAGE =
  'Execution-ledger history returned an invalid verified page.';
const SAFE_FAILURE =
  'Durable run history could not be read safely. No partial page was emitted.';

/**
 * @typedef ExecutionLedgerHistoryOutput
 * @property {(value: Record<string, any>) => void} json - Write one JSON page.
 * @property {(rows: Array<Record<string, any>>) => void} table - Write human rows.
 * @property {(message: string) => void} info - Write pagination guidance.
 * @property {(error: Error) => void} failure - Write a redacted failure.
 */

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether value is a non-array object.
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a bounded cursor without interpreting the ledger-owned format.
 * @param {unknown} value - Candidate cursor.
 * @param {string} field - Safe field name for an error.
 * @returns {string} - Opaque cursor.
 */
function normalizeCursor(value, field) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > CURSOR_MAX_BYTES
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
    Number(value) > EXECUTION_LEDGER_HISTORY_MAX_LIMIT
  ) {
    throw new RangeError(
      `${field} must be an integer from 1 through ${EXECUTION_LEDGER_HISTORY_MAX_LIMIT}.`,
    );
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate app identity.
 * @returns {{appId: string}} - App-scoped identity.
 */
function normalizeIdentity(value) {
  if (!isObject(value)) {
    throw new TypeError('Execution-ledger history identity must be an object.');
  }
  assertLogicalId(value.appId, 'execution-ledger history identity.appId');
  return { appId: /** @type {string} */ (value.appId) };
}

/**
 * @param {unknown} value - Candidate list request.
 * @returns {{appId: string, limit: number, cursor?: string}} - Valid request.
 */
function normalizeListRequest(value) {
  if (!isObject(value)) {
    throw new TypeError('Execution-ledger history list request is invalid.');
  }
  assertLogicalId(value.appId, 'execution-ledger history request.appId');
  const request = {
    appId: /** @type {string} */ (value.appId),
    limit: normalizeLimit(
      value.limit,
      'execution-ledger history request.limit',
    ),
  };
  return value.cursor === undefined
    ? request
    : {
        ...request,
        cursor: normalizeCursor(
          value.cursor,
          'execution-ledger history request.cursor',
        ),
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
 * List durable runs through the default read-only control-store adapter.
 * A store that has never been created is an honest empty history.
 * @param {unknown} value - App-scoped list request.
 * @returns {Promise<Record<string, any>>} - Raw ledger page.
 */
export async function listExecutionLedgerRuns(value) {
  const request = normalizeListRequest(value);
  try {
    return await withExecutionLedger(
      async (ledger) => await ledger.listRuns(request),
      { readOnly: true },
    );
  } catch (error) {
    if (isMissingReadOnlyStore(error)) return { items: [] };
    throw error;
  }
}

/**
 * @param {Record<string, any>} item - Raw verified directory item.
 * @param {string} key - Required string field.
 * @returns {string} - Nonempty string field.
 */
function readString(item, key) {
  const value = item[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(INVALID_PAGE);
  }
  return value;
}

/**
 * @param {Record<string, any>} item - Raw verified directory item.
 * @param {string} key - Required integer field.
 * @returns {number} - Nonnegative safe integer field.
 */
function readInteger(item, key) {
  const value = item[key];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(INVALID_PAGE);
  }
  return Number(value);
}

/**
 * Project one verified item onto the documented redacted surface.
 * @param {unknown} value - Raw item.
 * @param {string} appId - Expected app scope.
 * @returns {Record<string, any>} - Safe public item.
 */
function projectItem(value, appId) {
  if (!isObject(value)) throw new TypeError(INVALID_PAGE);
  const itemAppId = readString(value, 'appId');
  if (itemAppId !== appId) {
    throw new Error('Execution-ledger history item crossed application scope.');
  }
  return {
    runId: readString(value, 'runId'),
    revisionId: readString(value, 'revisionId'),
    kind: readString(value, 'kind'),
    status: readString(value, 'status'),
    version: readInteger(value, 'version'),
    lastSequence: readInteger(value, 'lastSequence'),
    createdAt: readInteger(value, 'createdAt'),
    updatedAt: readInteger(value, 'updatedAt'),
  };
}

/**
 * Validate and project a complete page before emitting any output.
 * @param {unknown} value - Raw adapter page.
 * @param {{appId: string, limit: number, cursor?: string}} request - List request.
 * @returns {{items: Array<Record<string, any>>, nextCursor: string | null}} - Public page data.
 */
function projectPage(value, request) {
  if (!isObject(value) || !Array.isArray(value.items)) {
    throw new TypeError(INVALID_PAGE);
  }
  if (value.items.length > request.limit) {
    throw new RangeError(INVALID_PAGE);
  }
  const items = [];
  for (let index = 0; index < value.items.length; index += 1) {
    if (!Object.hasOwn(value.items, index)) throw new TypeError(INVALID_PAGE);
    items.push(projectItem(value.items[index], request.appId));
  }

  let nextCursor = null;
  if (Object.hasOwn(value, 'nextCursor')) {
    nextCursor = normalizeCursor(
      value.nextCursor,
      'execution-ledger history page.nextCursor',
    );
    if (items.length === 0 || nextCursor === request.cursor) {
      throw new Error(INVALID_PAGE);
    }
  }
  return { items, nextCursor };
}

/**
 * @param {Array<Record<string, any>>} items - Public history items.
 * @returns {Array<Record<string, any>>} - Safe human rows.
 */
function createHumanRows(items) {
  return items.map((item) => ({
    run_id: item.runId,
    revision: item.revisionId,
    run_kind: item.kind,
    status: item.status,
    version: item.version,
    last_sequence: item.lastSequence,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  }));
}

/**
 * @param {unknown} provided - Optional output overrides.
 * @returns {ExecutionLedgerHistoryOutput} - Complete output port.
 */
function resolveOutput(provided) {
  if (provided !== undefined && !isObject(provided)) {
    throw new TypeError('Execution-ledger history output must be an object.');
  }
  const candidate =
    provided === undefined ? {} : /** @type {Record<string, any>} */ (provided);
  for (const key of ['json', 'table', 'info', 'failure']) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'function') {
      throw new TypeError(
        `Execution-ledger history output.${key} must be a function.`,
      );
    }
  }
  return {
    json: candidate.json || ((value) => console.log(JSON.stringify(value))),
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
      `--limit must be specified once as an integer from 1 through ${EXECUTION_LEDGER_HISTORY_MAX_LIMIT}.`,
    );
  }
  return Number(value);
}

/**
 * @param {string} value - Current CLI value.
 * @param {string | undefined} previous - Previous value.
 * @returns {string} - Opaque cursor.
 */
function parseCursor(value, previous) {
  if (previous !== undefined) {
    throw new InvalidArgumentError('--cursor may be specified only once.');
  }
  try {
    return normalizeCursor(value, '--cursor');
  } catch {
    throw new InvalidArgumentError(
      `--cursor must be a nonempty value of at most ${CURSOR_MAX_BYTES} bytes.`,
    );
  }
}

/**
 * @param {string} value - Current CLI value.
 * @param {string | undefined} previous - Previous value.
 * @returns {string} - App directory.
 */
function parseDirectory(value, previous) {
  if (
    previous !== undefined ||
    value.length === 0 ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > DIRECTORY_MAX_BYTES
  ) {
    throw new InvalidArgumentError(
      `--dir must be specified once as a nonempty path of at most ${DIRECTORY_MAX_BYTES} bytes.`,
    );
  }
  return value;
}

/**
 * Create the shared source or packaged read-only run-history command.
 * @param {{resolveIdentity: (selection: {dir?: string}) => unknown | Promise<unknown>, allowDirectory?: boolean, listRuns?: (request: {appId: string, limit: number, cursor?: string}) => unknown | Promise<unknown>, output?: Partial<ExecutionLedgerHistoryOutput>}} options - Host dependencies.
 * @returns {Command} - Fresh `list` command.
 */
export function createExecutionLedgerHistoryCommand(options) {
  if (
    !isObject(options) ||
    typeof options.resolveIdentity !== 'function' ||
    (options.allowDirectory !== undefined &&
      typeof options.allowDirectory !== 'boolean') ||
    (options.listRuns !== undefined && typeof options.listRuns !== 'function')
  ) {
    throw new TypeError(
      'Execution-ledger history command options are invalid.',
    );
  }
  const allowDirectory = options.allowDirectory === true;
  const listRuns = options.listRuns || listExecutionLedgerRuns;
  const output = resolveOutput(options.output);
  const command = new Command('list').description(
    'List one application’s verified durable run history',
  );
  if (allowDirectory) {
    command.option(
      '--dir <dir>',
      'Directory containing wharfie.app.js (default: cwd)',
      parseDirectory,
    );
  }
  command
    .option(
      '--limit <limit>',
      `Maximum runs to return (default ${EXECUTION_LEDGER_HISTORY_DEFAULT_LIMIT}, maximum ${EXECUTION_LEDGER_HISTORY_MAX_LIMIT})`,
      parseLimit,
    )
    .option(
      '--cursor <cursor>',
      'Opaque cursor returned by the prior page',
      parseCursor,
    )
    .option('--json', 'Write one stable machine-readable page')
    .action(async (commandOptions) => {
      try {
        const identity = normalizeIdentity(
          await options.resolveIdentity(
            allowDirectory && commandOptions.dir !== undefined
              ? { dir: commandOptions.dir }
              : {},
          ),
        );
        const request = normalizeListRequest({
          appId: identity.appId,
          limit: commandOptions.limit ?? EXECUTION_LEDGER_HISTORY_DEFAULT_LIMIT,
          ...(commandOptions.cursor === undefined
            ? {}
            : { cursor: commandOptions.cursor }),
        });
        const page = projectPage(await listRuns(request), request);
        const publicPage = {
          schemaVersion: EXECUTION_LEDGER_HISTORY_PAGE_SCHEMA_VERSION,
          kind: EXECUTION_LEDGER_HISTORY_PAGE_KIND,
          authority: 'none',
          authoritative: false,
          integrity: { verified: true },
          scope: { appId: identity.appId },
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

export default createExecutionLedgerHistoryCommand;
