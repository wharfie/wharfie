import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { withOperationsStore } from '../operations-store.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';
import { getAppResourceId } from '../../../core/runtime/app-runs.js';

/**
 * Durably cancels nonterminal operations for an app resource or operation ID.
 * @param {import('../../../core/lib/db/tables/operations.js').OperationsTableClient} store - store.
 * @param {string} resource_id - The ID of the resource.
 * @param {string} [operation_id] - The specific operation ID to cancel.
 */
const cancel = async (store, resource_id, operation_id) => {
  const records = await store.getRecords(resource_id, operation_id);
  let cancelled = 0;
  let alreadyTerminal = 0;

  for (const operation of records.operations) {
    // Serialize cancellation requests so each result and conflict is visible.
    // eslint-disable-next-line no-await-in-loop
    const result = await store.cancelOperation(resource_id, operation.id, {
      requestedBy: 'cli',
    });
    if (result.changed) {
      cancelled += 1;
    } else {
      alreadyTerminal += 1;
    }
  }

  displaySuccess(
    `${cancelled} operations cancelled; ${alreadyTerminal} already terminal.`,
  );
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
