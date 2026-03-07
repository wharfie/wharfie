import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * Centralized DB configuration for Wharfie lambdas.
 *
 * This module is intentionally the only place in `lambdas/lib/` that reads
 * Wharfie DB-related environment variables (adapter selection, local paths,
 * and the Operations table name).
 */

/**
 * @typedef {'dynamodb' | 'lmdb' | 'vanilla'} DBAdapterName
 */

/**
 * @param {unknown} value - value.
 * @param {string} label - label.
 * @returns {DBAdapterName} - Result.
 */
function normalizeAdapterName(value, label) {
  const normalized = String(value || '')
    .toLowerCase()
    .trim();
  if (
    normalized === 'dynamodb' ||
    normalized === 'lmdb' ||
    normalized === 'vanilla'
  ) {
    return normalized;
  }
  throw new Error(`Unsupported ${label}: ${value}`);
}

/**
 * Resolve the *general* DB adapter (used by AWS dynamo helper modules).
 *
 * Semantics are preserved from the previous `aws/dynamo/_shared.js`:
 * - WHARFIE_DB_ADAPTER overrides everything
 * - In Jest (NODE_ENV=test), prefer local adapters (vanilla)
 * - Otherwise, auto-detect DynamoDB when AWS_REGION/AWS_EXECUTION_ENV are present
 * @returns {DBAdapterName} - Result.
 */
export function resolveDBAdapterName() {
  const explicit = process.env.WHARFIE_DB_ADAPTER;
  if (explicit) return normalizeAdapterName(explicit, 'WHARFIE_DB_ADAPTER');

  // Jest sets NODE_ENV=test automatically; prefer local adapters to avoid AWS usage.
  if (process.env.NODE_ENV === 'test') return 'vanilla';

  if (process.env.AWS_REGION || process.env.AWS_EXECUTION_ENV)
    return 'dynamodb';

  return 'vanilla';
}

/**
 * Resolve the *state store* adapter (actor runtime state).
 *
 * Important: this intentionally does NOT infer cloud adapters from AWS env vars.
 * If you want DynamoDB/LMDB you must opt-in explicitly.
 * @returns {DBAdapterName} - Result.
 */
export function resolveStateAdapterName() {
  const explicit =
    process.env.WHARFIE_STATE_ADAPTER || process.env.WHARFIE_DB_ADAPTER;
  if (explicit) {
    return normalizeAdapterName(
      explicit,
      'WHARFIE_STATE_ADAPTER/WHARFIE_DB_ADAPTER',
    );
  }

  // Provider-neutral default: never infer cloud adapters from ambient environment variables.
  return 'vanilla';
}

/**
 * Resolve the Operations table name.
 *
 * This is intentionally resolved at call-time (not import-time) so tests and
 * runtimes can safely override env vars between uses.
 * @returns {string} - Result.
 */
export function resolveOperationsTableName() {
  const name = process.env.OPERATIONS_TABLE;
  if (name && String(name).trim()) return String(name).trim();
  throw new Error('OPERATIONS_TABLE env var is required');
}

/**
 * @param {string} prefix - prefix.
 * @returns {string} - Result.
 */
function mkTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Create a new DB client based on the resolved general adapter.
 * @param {DBAdapterName} [adapterName] - adapterName.
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function createDBClient(adapterName = resolveDBAdapterName()) {
  if (adapterName === 'dynamodb') {
    const { default: createDynamoDB } =
      await import('../db/adapters/dynamodb.js');
    return createDynamoDB({ region: process.env.AWS_REGION });
  }

  if (adapterName === 'lmdb') {
    const { default: createLMDB } = await import('../db/adapters/lmdb.js');
    return createLMDB({ path: process.env.WHARFIE_DB_PATH });
  }

  const { default: createVanillaDB } =
    await import('../db/adapters/vanilla.js');

  if (process.env.NODE_ENV === 'test') {
    // Isolate tests from developer machines by default.
    const dir = mkTempDir('wharfie-dynamo-');
    return createVanillaDB({ path: dir });
  }

  return createVanillaDB({ path: process.env.WHARFIE_DB_PATH });
}

/**
 * Create a new DB client for the actor runtime state store.
 * @param {DBAdapterName} [adapterName] - adapterName.
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function createStateDBClient(
  adapterName = resolveStateAdapterName(),
) {
  if (adapterName === 'dynamodb') {
    const { default: createDynamoDB } =
      await import('../db/adapters/dynamodb.js');
    return createDynamoDB({ region: process.env.AWS_REGION });
  }

  if (adapterName === 'lmdb') {
    const { default: createLMDB } = await import('../db/adapters/lmdb.js');
    return createLMDB({ path: process.env.WHARFIE_STATE_DB_PATH });
  }

  const { default: createVanillaDB } =
    await import('../db/adapters/vanilla.js');

  if (process.env.NODE_ENV === 'test') {
    // Isolate tests from developer machines by default.
    const dir = mkTempDir('wharfie-state-');
    return createVanillaDB({ path: dir });
  }

  return createVanillaDB({ path: process.env.WHARFIE_STATE_DB_PATH });
}

/** @type {import('../db/base.js').DBClient | undefined} */
let _db;
/** @type {Promise<import('../db/base.js').DBClient> | null} */
let _initPromise = null;

/**
 * Get the shared singleton DB client (general DB, not the actor state store).
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function getDB() {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    _db = await createDBClient();
    return _db;
  })();

  return _initPromise;
}

/**
 * Reset cached singleton DB client (used by tests).
 */
export function resetDB() {
  _db = undefined;
  _initPromise = null;
}

/**
 * Close the cached singleton DB client (if any) and clear caches.
 * @returns {Promise<void>} - Result.
 */
export async function closeDB() {
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
  _initPromise = null;

  if (db?.close) {
    await db.close();
  }
}

export default {
  resolveDBAdapterName,
  resolveStateAdapterName,
  resolveOperationsTableName,
  createDBClient,
  createStateDBClient,
  getDB,
  resetDB,
  closeDB,
};
