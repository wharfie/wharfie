import { Command } from 'commander';

import { withExecutionLedger } from '../execution-ledger-store.js';
import {
  createExecutionLedgerOperatorView,
  formatExecutionLedgerOperatorRows,
} from '../execution-ledger-view.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';

/**
 * @param {unknown} value - Candidate durable run ID.
 * @returns {string} - Exact requested run ID.
 */
function requireRunId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('ops inspect requires --run-id <runId>.');
  }
  return value;
}

const inspectCommand = new Command('inspect')
  .description('Inspect one verified durable ledger run by persisted run ID')
  .option('--run-id <runId>', 'Persisted execution-ledger run ID')
  .option('--json', 'Write a redacted machine-readable inspection view')
  .action(async (options) => {
    try {
      const runId = requireRunId(options.runId);
      const view = await withExecutionLedger(
        async (ledger) => await ledger.rebuildRun(runId),
      );
      if (!view) {
        throw new Error(`No durable execution-ledger run exists: ${runId}`);
      }
      if (options.json === true) {
        console.log(JSON.stringify(createExecutionLedgerOperatorView(view)));
        return;
      }
      console.table(formatExecutionLedgerOperatorRows(view));
      displaySuccess(
        `Verified durable run ${view.run.runId} with ${view.events.length} ledger events.`,
      );
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default inspectCommand;
