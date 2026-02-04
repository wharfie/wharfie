import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import createDynamoDB from '../adapters/dynamodb.js';
import createLMDB from '../adapters/lmdb.js';
import createVanillaDB from '../adapters/vanilla.js';
import { createStateTable } from '../tables/state.js';

/**
 * Singleton state store used by the actor runtime.
 *
 * The underlying table implementation is adapter-based (DBClient), and the adapter
 * is selected at runtime:
 *
 * - If `WHARFIE_DB_ADAPTER` or `WHARFIE_STATE_ADAPTER` is set:
 *   - 'dynamodb' | 'lmdb' | 'vanilla'
 * - Else if NODE_ENV === 'test':
 *   - 'vanilla' (keeps tests isolated from developer AWS env)
 * - Else if we appear to be in AWS (AWS_REGION/AWS_EXECUTION_ENV):
 *   - 'dynamodb'
 * - Else:
 *   - 'vanilla'
 *
 * Local adapters will persist on close, but most runtime use-cases never call close,
 * so they behave as in-memory stores by default.
 */

/** @type {import('../base.js').DBClient | undefined} */
let _db;
/** @type {ReturnType<typeof createStateTable> | undefined} */
let _store;
/** @type {Promise<ReturnType<typeof createStateTable>> | null} */
let _initPromise = null;

/**
 * @returns {'dynamodb'|'lmdb'|'vanilla'} - Result.
 */
function resolveAdapterName() {
  const explicit =
    process.env.WHARFIE_STATE_ADAPTER || process.env.WHARFIE_DB_ADAPTER;

  if (explicit) {
    const normalized = String(explicit).toLowerCase().trim();
    if (
      normalized === 'dynamodb' ||
      normalized === 'lmdb' ||
      normalized === 'vanilla'
    ) {
      return normalized;
    }
    throw new Error(
      `Unsupported WHARFIE_STATE_ADAPTER/WHARFIE_DB_ADAPTER: ${explicit}`,
    );
  }

  // Jest sets NODE_ENV=test automatically; developers often also have AWS_REGION set locally.
  // Defaulting to vanilla keeps tests deterministic and avoids accidental AWS usage.
  if (process.env.NODE_ENV === 'test') {
    return 'vanilla';
  }

  if (process.env.AWS_REGION || process.env.AWS_EXECUTION_ENV) {
    return 'dynamodb';
  }

  return 'vanilla';
}

/**
 * @param {'dynamodb'|'lmdb'|'vanilla'} adapterName - adapterName.
 * @returns {Promise<import('../base.js').DBClient>} - Result.
 */
async function createDB(adapterName) {
  if (adapterName === 'dynamodb') {
    return createDynamoDB({ region: process.env.AWS_REGION });
  }

  if (adapterName === 'lmdb') {
    return createLMDB({
      // Optional; adapter defaults to OS-specific wharfie data dir.
      path: process.env.WHARFIE_STATE_DB_PATH,
    });
  }

  // vanilla
  if (process.env.NODE_ENV === 'test') {
    // Isolate tests from developer machines by default.
    const dir = mkdtempSync(join(tmpdir(), 'wharfie-state-'));
    return createVanillaDB({ path: dir });
  }

  return createVanillaDB({
    // Optional; adapter defaults to OS-specific wharfie data dir.
    path: process.env.WHARFIE_STATE_DB_PATH,
  });
}

/**
 * @returns {Promise<ReturnType<typeof createStateTable>>} - Result.
 */
async function ensureStore() {
  if (_store) return _store;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const adapterName = resolveAdapterName();
    _db = await createDB(adapterName);
    _store = createStateTable({ db: _db });
    return _store;
  })();

  return _initPromise;
}

/**
 * Returns the state store proxy.
 *
 * Note: the real store (and underlying adapter) is initialized lazily on first call
 * to any method. This avoids pulling AWS SDK dependencies into test/local runtimes
 * unless the dynamodb adapter is actually selected.
 * @returns {ReturnType<typeof createStateTable>} - Result.
 */
export function getStateStore() {
  return stateStore;
}

/**
 * Close the underlying DB (if any) and clear the cached singleton.
 * Primarily useful for local CLI flows.
 * @returns {Promise<void>} - Result.
 */
export async function closeStateStore() {
  // Wait for any in-flight init so we can close reliably.
  if (_initPromise) {
    try {
      await _initPromise;
    } catch {
      // ignore init errors; still clear caches
    }
  }

  const db = _db;
  _db = undefined;
  _store = undefined;
  _initPromise = null;

  if (db?.close) {
    await db.close();
  }
}

/**
 * Lazy state store proxy.
 * @type {ReturnType<typeof createStateTable>}
 */
const stateStore = {
  putResource: async (/** @type {any[]} */ ...args) =>
    (await ensureStore()).putResource(...args),
  putResourceStatus: async (/** @type {any[]} */ ...args) =>
    (await ensureStore()).putResourceStatus(...args),
  getResource: async (/** @type {any[]} */ ...args) =>
    (await ensureStore()).getResource(...args),
  getResources: async (/** @type {any[]} */ ...args) =>
    (await ensureStore()).getResources(...args),
  getResourceStatus: async (/** @type {any[]} */ ...args) =>
    (await ensureStore()).getResourceStatus(...args),
  deleteResource: async (/** @type {any[]} */ ...args) =>
    (await ensureStore()).deleteResource(...args),
};

export const {
  putResource,
  putResourceStatus,
  getResource,
  getResources,
  getResourceStatus,
  deleteResource,
} = stateStore;

export default stateStore;
