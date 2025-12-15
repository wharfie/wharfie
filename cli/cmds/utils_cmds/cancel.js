import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');
const {
  displaySuccess,
  displayFailure,
  displayInstruction,
  displayInfo,
} = require('../../output/basic');
const { getRecords, deleteOperation, getAllResources } =
  require('../../../lambdas/lib/dynamo/operations').default;

/**
 * Cancels operations for a given resource ID, operation ID, or operation type.
 * @param {string} resource_id - The ID of the resource.
 * @param {string} [operation_id] - The specific operation ID to cancel.
 * @param {string} [operation_type] - The type of operation to cancel.
 */
const cancel = async (resource_id, operation_id, operation_type) => {
  const records = await getRecords(resource_id);
  let operationsToRemove = [];

  if (operation_type) {
    operationsToRemove = records.operations.filter(
      // @ts-ignore
      (x) => x.operation_type === operation_type
    );
  } else if (operation_id) {
    operationsToRemove = records.operations.filter(
      // @ts-ignore
      (x) => x.operation_id === operation_id
    );
  } else {
    operationsToRemove = records.operations;
  }

  const operationsToRemoveCount = operationsToRemove.length;
  while (operationsToRemove.length > 0) {
    const operationChunk = operationsToRemove.splice(0, 10);
    await Promise.all(
      // @ts-ignore
      operationChunk.map((operation) => deleteOperation(operation))
    );
  }
  displaySuccess(`${operationsToRemoveCount} operations cancelled.`);
};

/**
 * Cancels all operations for all resources of a specific type.
 * @param {string} operation_type - The type of operations to cancel.
 */
const cancelAll = async (operation_type) => {
  const resources = await getAllResources();
  displayInfo(`Cancelling operations for ${resources.length} resources.`);
  while (resources.length > 0) {
    const resourceChunk = resources.splice(0, 10);
    await Promise.all(
      resourceChunk.map((resource) => {
        displayInfo(`Cancelling: ${resource.id}`);
        return cancel(resource.id, undefined, operation_type);
      })
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
    try {
      if (all) {
        await cancelAll(type);
      } else {
        await cancel(resource_id, operation_id, type);
      }
    } catch (err) {
      displayFailure(err);
    }
  });

module.exports = cancelCommand;
