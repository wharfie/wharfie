import { Command } from 'commander';

import createOperationsStore from '../../../lambdas/lib/graph/operations-store.js';
import { resolveOperationsTableName } from '../../../lambdas/lib/config/db.js';
import {
  displayFailure,
  displayInstruction,
  displaySuccess,
} from '../../output/basic.js';

function resolveAdapterName() {
  const adapter = process.env.WHARFIE_DB_ADAPTER?.trim().toLowerCase();
  if (!adapter) return 'vanilla';

  if (adapter === 'dynamodb') return 'dynamodb';
  if (adapter === 'lmdb') return 'lmdb';
  if (adapter === 'vanilla') return 'vanilla';

  throw new Error(
    `Invalid WHARFIE_DB_ADAPTER: ${process.env.WHARFIE_DB_ADAPTER}`,
  );
}

async function createDBClient() {
  const adapterName = resolveAdapterName();
  const path = process.env.WHARFIE_DB_PATH;

  if (adapterName === 'dynamodb') {
    const { default: createDynamoDB } =
      await import('../../../lambdas/lib/db/adapters/dynamodb.js');
    return createDynamoDB({
      region: process.env.AWS_REGION,
    });
  }

  if (adapterName === 'lmdb') {
    const { default: createLMDB } =
      await import('../../../lambdas/lib/db/adapters/lmdb.js');
    return createLMDB({ path });
  }

  const { default: createVanillaDB } =
    await import('../../../lambdas/lib/db/adapters/vanilla.js');
  return createVanillaDB({ path });
}

/**
 * Cancels operations for a given resource ID, operation ID, or operation type.
 * @param {import('../../../lambdas/lib/db/tables/operations.js').OperationsTableClient} store
 * @param {string} resource_id - The ID of the resource.
 * @param {string} [operation_id] - The specific operation ID to cancel.
 * @param {string} [operation_type] - The type of operation to cancel.
 */
const cancel = async (store, resource_id, operation_id, operation_type) => {
  const records = await store.getRecords(resource_id);
  let operationsToRemove = [];

  if (operation_type) {
    operationsToRemove = records.operations.filter(
      (x) => x.type === operation_type,
    );
  } else if (operation_id) {
    operationsToRemove = records.operations.filter(
      (x) => x.id === operation_id,
    );
  } else {
    operationsToRemove = records.operations;
  }

  const operationsToRemoveCount = operationsToRemove.length;
  while (operationsToRemove.length > 0) {
    const operationChunk = operationsToRemove.splice(0, 10);
    await Promise.all(
      operationChunk.map((operation) => store.deleteOperation(operation)),
    );
  }

  displaySuccess(`${operationsToRemoveCount} operations cancelled.`);
};

const cancelCommand = new Command('cancel')
  .description('Cancel operations for a single resource')
  .argument('<resource_id>', 'Wharfie resource ID')
  .option('-o, --operationId <operationId>', 'Operation ID')
  .option(
    '-t, --type <type>',
    'Operation type',
    /^(LOAD|BACKFILL|MIGRATE|PIPELINE)$/i,
  )
  .action(async (resource_id, options) => {
    const { type, operationId } = options;
    const normalizedType = type ? String(type).toUpperCase() : undefined;

    if (normalizedType && operationId) {
      displayInstruction('Cannot accept both type and operationId.');
      return;
    }

    const db = await createDBClient();
    const store = createOperationsStore({
      db,
      tableName: resolveOperationsTableName(),
    });

    try {
      await cancel(store, resource_id, operationId, normalizedType);
    } catch (err) {
      displayFailure(err);
    } finally {
      try {
        await db.close();
      } catch {
        // ignore
      }
    }
  });

export default cancelCommand;
