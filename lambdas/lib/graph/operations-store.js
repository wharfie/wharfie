import { createOperationsTable } from '../db/tables/operations.js';

/**
 * Provider-neutral OperationsStore.
 *
 * This is intentionally thin: it accepts any DBClient-compatible interface
 * (including JSON-over-gRPC ResourceRpc clients that implement the same methods)
 * and returns the operations table API from `createOperationsTable`.
 * @param {{
 *   db: import('../db/base.js').DBClient,
 *   tableName?: string,
 * }} params - params.
 * @returns {ReturnType<typeof createOperationsTable>} - Result.
 */
export function createOperationsStore({ db, tableName }) {
  return createOperationsTable({ db, tableName });
}

export default createOperationsStore;
