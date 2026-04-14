import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { withOperationsStore } from '../operations-store.js';
import { formatOperationRows } from '../operation-rows.js';
import { getSyntheticAppResourceId } from '../../../core/runtime/app-runs.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';

const listCommand = new Command('list')
  .description('List persisted runs for an app')
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .action(async (options) => {
    try {
      const appDir = options.dir || process.cwd();
      const { manifest } = await loadApp({ dir: appDir });
      const resourceId = getSyntheticAppResourceId(manifest);

      await withOperationsStore(async (store) => {
        const records = await store.getRecords(resourceId);
        const operations = records.operations || [];

        displaySuccess(
          `${operations.length} operations found for ${manifest.app.name}.`,
        );
        console.table(formatOperationRows(operations));
      });
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default listCommand;
