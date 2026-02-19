import { createRequire } from 'node:module';
import createOperationsStore from '../../../lambdas/lib/graph/operations-store.js';

const require = createRequire(import.meta.url);

const { Command } = require('commander');
const {
  displaySuccess,
  displayFailure,
  displayInstruction,
  displayInfo,
} = require('../../output/basic');

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

/**
 * Cancels all operations for all resources of a specific type.
 * @param {import('../../../lambdas/lib/db/tables/operations.js').OperationsTableClient} store
 * @param {string} operation_type - The type of operations to cancel.
 */
const cancelAll = async (store, operation_type) => {
  const resources = await store.getAllResources();
  displayInfo(`Cancelling operations for ${resources.length} resources.`);
  while (resources.length > 0) {
    const resourceChunk = resources.splice(0, 10);
    await Promise.all(
      resourceChunk.map((resource) => {
        displayInfo(`Cancelling: ${resource.id}`);
        return cancel(store, resource.id, undefined, operation_type);
      }),
    );
  }
};

const cancelCommand = new Command('cancel')
  .description('Cancel running operations')
  .argument('[resource_id]', 'Wharfie resource ID')
  .argument('[operation_id]', 'Operation ID')
  .option('-t, --type <type>', 'Operation type', /^(LOAD|BACKFILL|MIGRATE)$/i)
  .option('-a, --all', 'DANGER! Cancels operations for all Wharfie resources')
  .action(async (resource_id, operation_id, options) => {
    const { type, all } = options;

    if (!resource_id && !all) {
      displayInstruction("Param 'resource_id' Missing 🙁");
      return;
    }
    if (type && operation_id) {
      displayInstruction('Cannot accept both type and operation_id.');
      return;
    }

    const db = await createDBClient();
    const store = createOperationsStore({ db });

    try {
      if (all) {
        await cancelAll(store, type);
      } else {
        await cancel(store, resource_id, operation_id, type);
      }
    } catch (err) {
      displayFailure(err);
    } finally {
      try {
        await db.close();
      } catch (err) {
        // ignore
      }
    }
  });

module.exports = cancelCommand;
