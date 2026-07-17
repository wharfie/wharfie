import createOperationsStore from '../../core/lib/graph/operations-store.js';
import {
  createOperationsDBClient,
  resolveOperationsTableName,
} from '../../core/lib/config/db.js';

/**
 * @typedef {import('../../core/lib/db/base.js').DBClient} DBClient
 * @typedef {import('../../core/lib/db/tables/operations.js').OperationsTableClient} OperationsStore
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
    db = await createOperationsDBClient();
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
