import { createExecutionLedger } from '../../core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../core/lib/payload-store/local.js';
import {
  createOperationsDBClient,
  resolveExecutionLedgerTableName,
  resolveExecutionPayloadPath,
  resolveExecutionPayloadStoreId,
} from '../../core/lib/config/db.js';

/**
 * @typedef {import('../../core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ExecutionLedgerStore
 */

/**
 * Open the durable control store for one CLI operation and always close it.
 * The ledger gets its own table because its key shape and append-only records
 * are intentionally incompatible with the remaining legacy mutable OperationsStore.
 *
 * @template T
 * @param {(ledger: ExecutionLedgerStore) => Promise<T>} handler - Work to run against the ledger.
 * @returns {Promise<T>} - Result.
 */
export async function withExecutionLedger(handler) {
  /** @type {import('../../core/lib/db/base.js').DBClient | undefined} */
  let db;

  try {
    db = await createOperationsDBClient();
    const payloadPath = resolveExecutionPayloadPath();
    const ledger = createExecutionLedger({
      db,
      tableName: resolveExecutionLedgerTableName(),
      payloadStore: createLocalExecutionPayloadStore({
        path: payloadPath,
        storeId: resolveExecutionPayloadStoreId(payloadPath),
      }),
    });
    return await handler(ledger);
  } finally {
    await db?.close?.();
  }
}

export default withExecutionLedger;
