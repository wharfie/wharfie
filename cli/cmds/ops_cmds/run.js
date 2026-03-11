import { Command } from 'commander';

import { withOperationsStore } from '../operations-store.js';
import { runOperation } from '../../../lambdas/lib/graph/runner.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';

const runCommand = new Command('run')
  .description(
    'Execute an operation DAG in-process (placeholder executor: marks actions completed)',
  )
  .argument('<resource_id>', 'Wharfie resource ID')
  .argument('<operation_id>', 'Operation ID')
  .action(async (resource_id, operation_id) => {
    try {
      await withOperationsStore(async (store) => {
        displayInfo(`Running operation: ${resource_id}#${operation_id}`);

        /**
         * @param {import('../../../lambdas/lib/graph/action.js').default} action - action.
         * @returns {Promise<boolean>} - Result.
         */
        const executeAction = async (action) => {
          // Placeholder executor used for DAG inspection/testing.
          // The runner will handle status transitions; we just return success.
          displayInfo(`- ${action.id} (${action.type})`);
          return true;
        };

        const result = await runOperation({
          store,
          resourceId: resource_id,
          operationId: operation_id,
          executeAction,
        });

        if (result.status !== 'COMPLETED') {
          const details = [];
          if (result.failedActionIds.length > 0) {
            details.push(`failed=${result.failedActionIds.join(',')}`);
          }
          if (result.blockedActionIds.length > 0) {
            details.push(`blocked=${result.blockedActionIds.join(',')}`);
          }
          throw new Error(
            `Operation ${resource_id}#${operation_id} finished with status ${result.status}${
              details.length > 0 ? ` (${details.join(' ')})` : ''
            }.`,
          );
        }

        displaySuccess(`Executed ${result.executedActionIds.length} actions.`);
        console.table(
          Object.entries(result.finalStatusByActionId).map(
            ([action_id, status]) => ({
              action_id,
              status,
            }),
          ),
        );
      });
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default runCommand;
