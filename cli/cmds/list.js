import { Command } from 'commander';

import { withOperationsStore } from './operations-store.js';
import { formatOperationRows } from './operation-rows.js';
import { displayFailure, displaySuccess } from '../output/basic.js';

const listCommand = new Command('list')
  .description('List operations for a resource')
  .argument('<resource_id>', 'Wharfie resource ID')
  .action(async (resource_id) => {
    try {
      await withOperationsStore(async (store) => {
        const records = await store.getRecords(resource_id);
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
