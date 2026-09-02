import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { DB_ADAPTER_NAMES, brandDBClient } from '../../src/core/lib/db/base.js';
import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';

const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 5_000;

/**
 * Open Wharfie's portable conditional-transaction implementation behind the
 * exact DynamoDB DBClient identity required by the production RVN protocol.
 * Every operation takes an interprocess directory lock and opens the persisted
 * JSON snapshot afresh; every mutation durably closes it before releasing the
 * lock. This keeps independent crash children and inspectors coherent without
 * a native database, network access, credentials, or a hand-rolled authority
 * protocol. close() synchronously fences new calls and resolves only after
 * every already-started call has released the cross-process lock.
 *
 * This is a test-only provider proxy. Production code must establish the real
 * DynamoDB table topology before constructing the RVN protocol; the
 * reconstructed-resident crash test supplies that proof at its existing
 * injected topology boundary.
 *
 * @param {{path: string, readOnly?: boolean}} options - Persistent volume.
 * @returns {import('../../src/core/lib/db/base.js').DBClient} - DynamoDB-identified durable test client.
 */
export function createPersistentDynamoDBAuthorityTestClient(options) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    typeof options.path !== 'string' ||
    options.path.length === 0 ||
    Object.keys(options).some((key) => key !== 'path' && key !== 'readOnly')
  ) {
    throw new TypeError(
      'Persistent DynamoDB authority test client requires a path and optional readOnly flag.',
    );
  }
  const root = options.path;
  const readOnly = options.readOnly === true;
  const lockPath = join(root, '.persistent-dynamodb-authority.lock');
  let closed = false;
  let activeOperations = 0;
  const drainWaiters = new Set();

  function finishOperation() {
    activeOperations -= 1;
    if (activeOperations !== 0) return;
    for (const resolve of drainWaiters) resolve();
    drainWaiters.clear();
  }

  async function acquireLock() {
    await fsp.mkdir(root, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (true) {
      try {
        await fsp.mkdir(lockPath, { mode: 0o700 });
        return;
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'EEXIST'
        ) {
          throw error;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `Persistent DynamoDB authority test lock timed out: ${lockPath}`,
          );
        }
        // eslint-disable-next-line no-await-in-loop -- The directory is the cross-process serialization primitive.
        await delay(LOCK_RETRY_MS);
      }
    }
  }

  async function releaseLock() {
    await fsp.rmdir(lockPath);
  }

  /** @template T @param {boolean} mutation @param {(db: import('../../src/core/lib/db/base.js').DBClient) => Promise<T>} operation @returns {Promise<T>} */
  async function runOperation(mutation, operation) {
    if (closed) {
      throw new Error('Persistent DynamoDB authority test client is closed.');
    }
    if (readOnly && mutation) {
      throw new Error(
        'Persistent DynamoDB authority test client is read-only.',
      );
    }
    activeOperations += 1;
    let lockAcquired = false;
    try {
      await acquireLock();
      lockAcquired = true;
      const db = createVanillaDB({ path: root, readOnly: !mutation });
      try {
        const result = await operation(db);
        if (mutation) await db.close();
        return result;
      } finally {
        if (!mutation) await db.close();
      }
    } finally {
      try {
        if (lockAcquired) await releaseLock();
      } finally {
        finishOperation();
      }
    }
  }

  const db = {
    /** @param {any} params */
    query: (params) =>
      runOperation(false, async (client) => client.query(params)),
    /** @param {any} params */
    queryPage: (params) =>
      runOperation(false, async (client) => client.queryPage(params)),
    /** @param {any} params */
    batchWrite: (params) =>
      runOperation(true, async (client) => client.batchWrite(params)),
    /** @param {any} params */
    transactionWrite: (params) =>
      runOperation(true, async (client) => client.transactionWrite(params)),
    /** @param {any} params */
    update: (params) =>
      runOperation(true, async (client) => client.update(params)),
    /** @param {any} params */
    put: (params) => runOperation(true, async (client) => client.put(params)),
    /** @param {any} params */
    get: (params) => runOperation(false, async (client) => client.get(params)),
    /** @param {any} params */
    remove: (params) =>
      runOperation(true, async (client) => client.remove(params)),
    async close() {
      closed = true;
      if (activeOperations === 0) return;
      await new Promise((resolve) => drainWaiters.add(resolve));
    },
  };
  return brandDBClient(db, DB_ADAPTER_NAMES.DYNAMODB);
}

export default createPersistentDynamoDBAuthorityTestClient;
