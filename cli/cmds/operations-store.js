import createOperationsStore from '../../lambdas/lib/graph/operations-store.js';
import {
  createDBClient,
  resolveOperationsTableName,
} from '../../lambdas/lib/config/db.js';

/**
 * @typedef {import('../../lambdas/lib/db/base.js').DBClient} DBClient
 * @typedef {import('../../lambdas/lib/db/tables/operations.js').OperationsTableClient} OperationsStore
 */

/**
 * Create an operations store for the current CLI environment, run a handler, and
 * always close the underlying DB client.
 *
 * @template T
 * @param {(store: OperationsStore) => Promise<T>} handler - handler.
 * @returns {Promise<T>} - Result.
 */
export async function withOperationsStore(handler) {
  /** @type {DBClient | undefined} */
  let db;

  try {
    db = await createDBClient();
    const store = createOperationsStore({
      db,
      tableName: resolveOperationsTableName(),
    });

    return await handler(store);
  } finally {
    await db?.close?.();
  }
}

export default withOperationsStore;
