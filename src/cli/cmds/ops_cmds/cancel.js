import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { withOperationsStore } from '../operations-store.js';
import { getSyntheticAppResourceId } from '../../../core/runtime/app-runs.js';
import {
  displayFailure,
  displayInstruction,
  displaySuccess,
} from '../../output/basic.js';

/**
 * Cancels operations for a given app resource ID, operation ID, or operation type.
 * @param {import('../../../core/lib/db/tables/operations.js').OperationsTableClient} store - store.
 * @param {string} resource_id - The synthetic app resource ID.
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
  .description('Cancel persisted runs for an app')
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .option('-o, --operationId <operationId>', 'Operation ID')
  .option(
    '-t, --type <type>',
    'Operation type',
    /^(LOAD|BACKFILL|MIGRATE|PIPELINE)$/i,
  )
  .action(async (options) => {
    const { type, operationId } = options;
    const normalizedType = type ? String(type).toUpperCase() : undefined;

    if (normalizedType && operationId) {
      displayInstruction('Cannot accept both type and operationId.');
      return;
    }

    try {
      const appDir = options.dir || process.cwd();
      const { manifest } = await loadApp({ dir: appDir });
      const resourceId = getSyntheticAppResourceId(manifest);

      await withOperationsStore((store) =>
        cancel(store, resourceId, operationId, normalizedType),
      );
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default cancelCommand;
