import { getDB, resetDB, resolveOperationsTableName } from '../../config/db.js';
import { createOperationsTable } from '../tables/operations.js';

/** @type {Map<string, ReturnType<typeof createOperationsTable>>} */
const _stores = new Map();
/** @type {Map<string, Promise<ReturnType<typeof createOperationsTable>>>} */
const _initPromises = new Map();

/**
 * Resolve the operations store for a given (or env-resolved) table name.
 *
 * This is a thin wrapper that centralizes:
 * - DB client resolution (shared singleton)
 * - Operations table name resolution (call-time, from env)
 * @param {{ tableName?: string }} [params] - params.
 * @returns {Promise<ReturnType<typeof createOperationsTable>>} - Result.
 */
export async function getOperationsStore({ tableName } = {}) {
  const resolvedTableName = tableName || resolveOperationsTableName();

  const existing = _stores.get(resolvedTableName);
  if (existing) return existing;

  const inflight = _initPromises.get(resolvedTableName);
  if (inflight) return inflight;

  const init = (async () => {
    const db = await getDB();
    const store = createOperationsTable({ db, tableName: resolvedTableName });
    _stores.set(resolvedTableName, store);
    _initPromises.delete(resolvedTableName);
    return store;
  })();

  _initPromises.set(resolvedTableName, init);
  return init;
}

/**
 * Test helper: clear cached stores and reset the shared DB singleton.
 * @returns {void}
 */
export function __setMockState() {
  _stores.clear();
  _initPromises.clear();
  resetDB();
}

export default getOperationsStore;
