import { createStateTable } from '../tables/state.js';
import {
  createStateDBClient,
  resolveStateAdapterName,
} from '../../config/db.js';

/**
 * Singleton state store used by the actor runtime.
 *
 * The underlying table implementation is adapter-based (DBClient), and the adapter
 * is selected at runtime:
 *
 * - If `WHARFIE_DB_ADAPTER` or `WHARFIE_STATE_ADAPTER` is set:
 *   - 'dynamodb' | 'lmdb' | 'vanilla'
 * - Else:
 *   - 'vanilla' (provider-neutral default; avoids accidental cloud coupling)
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
 * Test helper: expose adapter resolution without initializing the store.
 * @returns {'dynamodb'|'lmdb'|'vanilla'} - Result.
 */
export function __resolveAdapterName() {
  return resolveStateAdapterName();
}

/**
 * @returns {Promise<ReturnType<typeof createStateTable>>} - Result.
 */
async function ensureStore() {
  if (_store) return _store;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const adapterName = resolveStateAdapterName();
    _db = await createStateDBClient(adapterName);
    _store = createStateTable({ db: _db });
    return _store;
  })();

  return _initPromise;
}

/**
 * Returns the state store proxy.
 *
 * Note: the real store (and underlying adapter) is initialized lazily on first call
 * to any method. This avoids pulling optional/native deps (AWS SDK, LMDB) into
 * test/local runtimes unless the corresponding adapter is actually selected.
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
