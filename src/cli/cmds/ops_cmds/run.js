import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { parseJsonInput } from '../../app/local-app.js';
import { withOperationsStore } from '../operations-store.js';
import {
  createAppActivityOperation,
  createAppWorkflowOperation,
  persistAndRunAppOperation,
} from '../../../core/runtime/app-runs.js';
import Action from '../../../core/lib/graph/action.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {import('../../../core/lib/graph/operation.js').default | undefined} operation - operation.
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
  .description(
    'Create and execute a persisted app activity or workflow locally',
  )
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .option(
    '--activity <activityName>',
    'Activity name declared in wharfie.app.js',
  )
  .option(
    '--workflow <workflowName>',
    'Workflow name declared in wharfie.app.js',
  )
  .option('--operationId <operationId>', 'Operation ID override')
  .option('--event <json>', 'Event JSON for activity runs (default: {})')
  .option('--context <json>', 'Context JSON merged beneath workflow metadata')
  .action(async (options) => {
    try {
      const activityName =
        typeof options.activity === 'string' ? options.activity.trim() : '';
      const workflowName =
        typeof options.workflow === 'string' ? options.workflow.trim() : '';
      const appDir = options.dir || process.cwd();

      if (!activityName && !workflowName) {
        throw new Error(
          'ops run requires either --activity <activityName> or --workflow <workflowName>.',
        );
      }

      if (activityName && workflowName) {
        throw new Error(
          'ops run cannot accept both --activity <activityName> and --workflow <workflowName>.',
        );
      }

      const context = parseJsonInput(options.context, 'context', {});
      if (!isObjectRecord(context)) {
        throw new Error('Context JSON must be an object.');
      }

      if (workflowName && typeof options.event === 'string') {
        throw new Error('--event is only supported with --activity runs.');
      }

      const event = parseJsonInput(options.event, 'event', {});
      const { manifest } = await loadApp({ dir: appDir });

      const operation = activityName
        ? createAppActivityOperation({
            manifest,
            activityName,
            event,
            operationId: options.operationId,
          })
        : createAppWorkflowOperation({
            manifest,
            workflowName,
            operationId: options.operationId,
          });

      await withOperationsStore(async (store) => {
        displayInfo(
          `Running ${activityName ? 'activity' : 'workflow'}: ${operation.resource_id}#${operation.id} (${activityName || workflowName})`,
        );

        const result = await persistAndRunAppOperation({
          store,
          manifest,
          operation,
          baseContext: context,
          onActionStart: (action, { attemptCount }) => {
            if (
              action.type === Action.Type.START ||
              action.type === Action.Type.FINISH
            ) {
              displayInfo(`- ${action.id} (${action.type})`);
              return;
            }

            displayInfo(
              `- ${action.id} (${action.type}:${action.function_name} attempt=${attemptCount})`,
            );
          },
        });

        const finalRecords = await store.getRecords(
          operation.resource_id,
          operation.id,
        );
        const finalOperation = finalRecords.operations.find(
          (record) => record.id === operation.id,
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
            `Operation ${operation.resource_id}#${operation.id} finished with status ${result.status}${
              details.length > 0 ? ` (${details.join(' ')})` : ''
            }.`,
          );
        }

        displaySuccess(`Executed ${result.executedActionIds.length} actions.`);
      });
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default runCommand;
