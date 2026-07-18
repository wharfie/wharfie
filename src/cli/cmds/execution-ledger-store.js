import { createExecutionLedger } from '../../core/lib/db/tables/execution-ledger.js';
import { createLedgerServiceOwnership } from '../../core/lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../core/lib/payload-store/local.js';
import {
  createControlDBClient,
  resolveExecutionLedgerTableName,
  resolveExecutionPayloadPath,
  resolveExecutionPayloadStoreId,
  resolveLedgerServiceSessionPath,
  resolveControlAdapterName,
} from '../../core/lib/config/db.js';
import { acquireLocalLedgerServiceSession } from '../../core/runtime/services/ledger-service.js';

/**
 * @typedef {import('../../core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ExecutionLedgerStore
 */

/**
 * Open the durable control store for one CLI operation and always close it.
 * The ledger gets its own table because its key shape and append-only records
 * are an explicit durable control-state boundary.
 *
 * @template T
 * @param {(ledger: ExecutionLedgerStore, context: {db: import('../../core/lib/db/base.js').DBClient, tableName: string}) => Promise<T>} handler - Work to run against the ledger and its shared durable control client.
 * @returns {Promise<T>} - Result.
 */
export async function withExecutionLedger(handler) {
  /** @type {import('../../core/lib/db/base.js').DBClient | undefined} */
  let db;

  try {
    db = await createControlDBClient();
    const tableName = resolveExecutionLedgerTableName();
    const payloadPath = resolveExecutionPayloadPath();
    const ledger = createExecutionLedger({
      db,
      tableName,
      payloadStore: createLocalExecutionPayloadStore({
        path: payloadPath,
        storeId: resolveExecutionPayloadStoreId(payloadPath),
      }),
    });
    return await handler(ledger, { db, tableName });
  } finally {
    await db?.close?.();
  }
}

/**
 * Hold the resident-service ownership fence while a local manual mutation
 * uses an LMDB-backed control volume. The hidden resident runtime rejects
 * non-LMDB control adapters, so direct manual operations on diagnostic or
 * future remote adapters deliberately retain their existing ledger behavior
 * instead of claiming this process-local exclusion guarantee.
 *
 * The ownership release occurs only after `handler` has completed every
 * ledger mutation and read-back using the shared DB client. `withExecutionLedger`
 * closes that client after this callback returns.
 * @template T
 * @param {{appId: string, context: {db: import('../../core/lib/db/base.js').DBClient, tableName: string}, handler: () => Promise<T>}} options - Ownership-scoped mutation.
 * @returns {Promise<T>} - Handler result.
 */
export async function withLocalLedgerServiceMutationOwnership(options) {
  if (resolveControlAdapterName() !== 'lmdb') {
    return await options.handler();
  }

  const ownership = createLedgerServiceOwnership({
    db: options.context.db,
    tableName: options.context.tableName,
  });
  const localSession = await acquireLocalLedgerServiceSession({
    appId: options.appId,
    ownership,
    sessionRoot: resolveLedgerServiceSessionPath(),
  });
  try {
    return await options.handler();
  } finally {
    await localSession.release();
  }
}

export default withExecutionLedger;
