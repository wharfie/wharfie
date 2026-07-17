import { Command } from 'commander';

import {
  withExecutionLedger,
  withLocalLedgerServiceMutationOwnership,
} from '../execution-ledger-store.js';
import {
  createExecutionLedgerRecoveryOperatorView,
  formatExecutionLedgerOperatorRows,
} from '../execution-ledger-view.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';
import { recoverManualLedgerActivity } from '../../../core/runtime/manual-ledger-run.js';

/**
 * @param {unknown} value - Candidate durable run ID.
 * @returns {string} - Exact requested run ID.
 */
function requireRunId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('ops recover requires --run-id <runId>.');
  }
  return value;
}

/**
 * @param {string} action - Named recovery action.
 * @returns {string} - Human-readable completed recovery message.
 */
function recoveryMessage(action) {
  if (action === 'released-unstarted-claim') {
    return 'Released an unstarted claim. This command did not dispatch an activity.';
  }
  if (action === 'marked-started-uncertain') {
    return 'Marked a begun attempt uncertain. This command did not dispatch an activity.';
  }
  return 'Verified durable recovery state. No recovery transition was needed.';
}

const recoverCommand = new Command('recover')
  .description('Reconcile one durable ledger run without loading app source')
  .option('--run-id <runId>', 'Persisted execution-ledger run ID')
  .option(
    '--confirm-runner-stopped',
    'Confirm that every prior runner for this run has stopped',
  )
  .option('--json', 'Write a redacted machine-readable recovery view')
  .action(async (options) => {
    try {
      const runId = requireRunId(options.runId);
      if (options.confirmRunnerStopped !== true) {
        throw new Error(
          'ops recover requires --confirm-runner-stopped before it can change durable state.',
        );
      }
      const { recovery, view } = await withExecutionLedger(
        async (ledger, context) => {
          const preflight = await ledger.rebuildRun(runId);
          if (!preflight) {
            return {
              recovery: { found: false, action: 'none', changed: false },
              view: null,
            };
          }
          return await withLocalLedgerServiceMutationOwnership({
            appId: preflight.run.appId,
            context,
            handler: async () => {
              const recovery = await recoverManualLedgerActivity({
                ledger,
                runId,
              });
              return {
                recovery,
                view: await ledger.rebuildRun(runId),
              };
            },
          });
        },
      );
      if (!recovery.found || !view) {
        throw new Error(
          `No durable execution-ledger run exists; recovery refuses to create work: ${runId}`,
        );
      }
      if (options.json === true) {
        console.log(
          JSON.stringify(
            createExecutionLedgerRecoveryOperatorView(recovery, view),
          ),
        );
        return;
      }
      console.table(formatExecutionLedgerOperatorRows(view));
      displaySuccess(recoveryMessage(recovery.action));
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default recoverCommand;
