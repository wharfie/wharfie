import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import createDynamoDB from '../../db/adapters/dynamodb.js';
import createLMDB from '../../db/adapters/lmdb.js';
import createVanillaDB from '../../db/adapters/vanilla.js';

/** @type {import('../db/base.js').DBClient | undefined} */
let _db;
/** @type {Promise<import('../db/base.js').DBClient> | null} */
let _initPromise = null;

/**
 * @returns {'dynamodb'|'lmdb'|'vanilla'} - Result.
 */
function resolveAdapterName() {
  const explicit = process.env.WHARFIE_DB_ADAPTER;
  if (explicit) {
    const normalized = String(explicit).toLowerCase().trim();
    if (
      normalized === 'dynamodb' ||
      normalized === 'lmdb' ||
      normalized === 'vanilla'
    ) {
      return normalized;
    }
    throw new Error(`Unsupported WHARFIE_DB_ADAPTER: ${explicit}`);
  }

  // Jest sets NODE_ENV=test automatically; prefer local adapters to avoid AWS usage.
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
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
async function createDB(adapterName) {
  if (adapterName === 'dynamodb') {
    return createDynamoDB({ region: process.env.AWS_REGION });
  }

  if (adapterName === 'lmdb') {
    return createLMDB({
      path: process.env.WHARFIE_DB_PATH,
    });
  }

  if (process.env.NODE_ENV === 'test') {
    const dir = mkdtempSync(join(tmpdir(), 'wharfie-dynamo-'));
    return createVanillaDB({ path: dir });
  }

  return createVanillaDB({
    path: process.env.WHARFIE_DB_PATH,
  });
}

/**
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function getDB() {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const adapterName = resolveAdapterName();
    _db = await createDB(adapterName);
    return _db;
  })();

  return _initPromise;
}

/**
 * Reset cached DB client (used by tests).
 */
export function resetDB() {
  _db = undefined;
  _initPromise = null;
}
