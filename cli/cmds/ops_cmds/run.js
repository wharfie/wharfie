import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { withOperationsStore } from '../operations-store.js';
import Action from '../../../lambdas/lib/graph/action.js';
import { runOperation } from '../../../lambdas/lib/graph/runner.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';

/**
 * @param {any} appExport - appExport.
 * @returns {void}
 */
function assertRunnableApp(appExport) {
  if (!appExport || typeof appExport.invoke !== 'function') {
    throw new Error(
      'App is not runnable. Expected a default export with invoke(functionName, event, context).',
    );
  }
}

/**
 * @param {Record<string, any> | undefined} placement - placement.
 * @returns {string} - Result.
 */
function getPlacementMode(placement) {
  const mode = placement?.mode;
  if (typeof mode !== 'string' || !mode.trim()) return 'local';
  return mode.trim().toLowerCase();
}

/**
 * @param {import('../../../lambdas/lib/graph/operation.js').default | undefined} operation - operation.
 * @param {Record<string, string>} fallbackStatuses - fallbackStatuses.
 * @returns {Array<Record<string, any>>} - Result.
 */
function formatActionRows(operation, fallbackStatuses) {
  if (!operation) {
    return Object.entries(fallbackStatuses).map(([action_id, status]) => ({
      action_id,
      status,
    }));
  }

  return operation.getSequentialActionOrder().map((action) => ({
    action_id: action.id,
    type: action.type,
    function_name: action.function_name || '',
    status: action.status,
    attempt_count: action.attempt_count || 0,
  }));
}

const runCommand = new Command('run')
  .description('Execute an operation DAG locally against wharfie.app.js')
  .argument('<resource_id>', 'Wharfie resource ID')
  .argument('<operation_id>', 'Operation ID')
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .action(async (resource_id, operation_id, options) => {
    /** @type {any | undefined} */
    let appExport;

    try {
      await withOperationsStore(async (store) => {
        displayInfo(`Running operation: ${resource_id}#${operation_id}`);

        /**
         * @returns {Promise<any>} - Result.
         */
        const ensureRunnableApp = async () => {
          if (appExport) return appExport;
          const loaded = await loadApp({ dir: options.dir || process.cwd() });
          assertRunnableApp(loaded.appExport);
          appExport = loaded.appExport;
          return appExport;
        };

        /**
         * @param {import('../../../lambdas/lib/graph/action.js').default} action - action.
         * @returns {Promise<{ ok: boolean, outputs?: any }>} - Result.
         */
        const executeAction = async (action) => {
          if (
            action.type === Action.Type.START ||
            action.type === Action.Type.FINISH
          ) {
            displayInfo(`- ${action.id} (${action.type})`);
            return { ok: true };
          }

          if (action.type !== Action.Type.INVOKE_FUNCTION) {
            throw new Error(
              `Unsupported action type '${action.type}' for ops run. Only START, FINISH, and INVOKE_FUNCTION are currently executable.`,
            );
          }

          if (!action.function_name || !String(action.function_name).trim()) {
            throw new Error(
              `INVOKE_FUNCTION action '${action.id}' is missing function_name.`,
            );
          }

          const placementMode = getPlacementMode(action.placement);
          if (placementMode !== 'local' && placementMode !== 'in_process') {
            throw new Error(
              `INVOKE_FUNCTION action '${action.id}' requested unsupported placement mode '${placementMode}'. Local execution currently supports only 'local' or 'in_process'.`,
            );
          }

          const app = await ensureRunnableApp();
          const attemptCount = Number(action.attempt_count || 0) + 1;
          displayInfo(
            `- ${action.id} (${action.type}:${action.function_name} attempt=${attemptCount})`,
          );

          const outputs = await app.invoke(
            action.function_name,
            action.inputs ?? {},
            {
              workflow: {
                resourceId: action.resource_id,
                operationId: action.operation_id,
                actionId: action.id,
                actionType: action.type,
                attemptCount,
                placement: action.placement,
              },
            },
          );

          return {
            ok: true,
            outputs,
          };
        };

        const result = await runOperation({
          store,
          resourceId: resource_id,
          operationId: operation_id,
          executeAction,
        });

        const finalRecords = await store.getRecords(resource_id, operation_id);
        const finalOperation = finalRecords.operations.find(
          (operation) => operation.id === operation_id,
        );

        console.table(
          formatActionRows(finalOperation, result.finalStatusByActionId),
        );

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
      });
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    } finally {
      if (typeof appExport?.closeRuntimeResources === 'function') {
        await appExport.closeRuntimeResources();
      }
    }
  });

export default runCommand;
