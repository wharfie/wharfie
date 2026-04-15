import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { withOperationsStore } from '../operations-store.js';
import { formatOperationRows } from '../operation-rows.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';
import { getAppResourceId } from '../../../core/runtime/app-runs.js';

const listCommand = new Command('list')
  .description('List persisted operations for an app')
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .action(async (options) => {
    try {
      const { manifest } = await loadApp({ dir: options.dir || process.cwd() });
      const resourceId = getAppResourceId(manifest.app.name);

      await withOperationsStore(async (store) => {
        const records = await store.getRecords(resourceId);
        const operations = records.operations || [];

        displaySuccess(`${operations.length} operations found.`);
        console.table(formatOperationRows(operations));
      });
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default listCommand;
