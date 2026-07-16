import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { withOperationsStore } from '../operations-store.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';
import { getAppResourceId } from '../../../core/runtime/app-runs.js';

/**
 * Cancels operations for a given app resource or operation ID.
 * @param {import('../../../core/lib/db/tables/operations.js').OperationsTableClient} store - store.
 * @param {string} resource_id - The ID of the resource.
 * @param {string} [operation_id] - The specific operation ID to cancel.
 */
const cancel = async (store, resource_id, operation_id) => {
  const records = await store.getRecords(resource_id, operation_id);
  const operationsToRemove = records.operations;

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
  .description('Cancel persisted operations for an app')
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .option('-o, --operationId <operationId>', 'Operation ID')
  .action(async (options) => {
    const { operationId } = options;

    try {
      const { manifest } = await loadApp({ dir: options.dir || process.cwd() });
      const resourceId = getAppResourceId(manifest.app.id);

      await withOperationsStore((store) =>
        cancel(store, resourceId, operationId),
      );
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default cancelCommand;
