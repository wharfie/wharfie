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

/**
 * @returns {'dynamodb'|'lmdb'|'vanilla'} -
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

  if (process.env.AWS_REGION || process.env.AWS_EXECUTION_ENV) {
    return 'dynamodb';
  }

  return 'vanilla';
}

/**
 * @param {'dynamodb'|'lmdb'|'vanilla'} adapterName -
 * @returns {import('../base.js').DBClient} -
 */
function createDB(adapterName) {
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
 * @returns {ReturnType<typeof createStateTable>}
 */
export function getStateStore() {
  if (_store) return _store;

  const adapterName = resolveAdapterName();
  _db = createDB(adapterName);
  _store = createStateTable({ db: _db });

  return _store;
}

/**
 * Close the underlying DB (if any) and clear the cached singleton.
 * Primarily useful for local CLI flows.
 * @returns {Promise<void>}
 */
export async function closeStateStore() {
  const db = _db;
  _db = undefined;
  _store = undefined;

  if (db?.close) {
    await db.close();
  }
}

const stateStore = getStateStore();

export const {
  putResource,
  putResourceStatus,
  getResource,
  getResources,
  getResourceStatus,
  deleteResource,
} = stateStore;

export default stateStore;
