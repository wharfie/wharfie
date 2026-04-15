import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { parseJsonInput } from '../../app/local-app.js';
import { withOperationsStore } from '../operations-store.js';
import Action from '../../../core/lib/graph/action.js';
import { runOperation } from '../../../core/lib/graph/runner.js';
import {
  createOperationFromActivity,
  createOperationFromWorkflow,
  findManifestWorkflowDefinition,
  getAppResourceId,
  getManifestActivityNames,
  invokeManifestActivity,
} from '../../../core/runtime/app-runs.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';

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
    activity: action.function_name || '',
    status: action.status,
    attempt_count: action.attempt_count || 0,
  }));
}

/**
 * @param {any} manifest - manifest.
 * @returns {string[]} - Result.
 */
function getWorkflowNames(manifest) {
  return Array.isArray(manifest?.workflows)
    ? manifest.workflows
        .map((/** @type {any} */ workflow) => workflow?.name)
        .filter(
          (/** @type {unknown} */ candidate) => typeof candidate === 'string',
        )
    : [];
}

const runCommand = new Command('run')
  .description('Execute a persisted app activity or workflow locally')
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .option(
    '--activity <activityName>',
    'Activity name declared in wharfie.app.js',
  )
  .option(
    '--workflow <workflowName>',
    'Workflow name declared in wharfie.app.js',
  )
  .option('--event <json>', 'Activity event JSON (default: {})')
  .option('--operation-id <operationId>', 'Override generated operation id')
  .action(async (options) => {
    try {
      await withOperationsStore(async (store) => {
        const activityName =
          typeof options.activity === 'string' ? options.activity.trim() : '';
        const workflowName =
          typeof options.workflow === 'string' ? options.workflow.trim() : '';
        const appDir = options.dir || process.cwd();

        if (!activityName && !workflowName) {
          throw new Error(
            'ops run requires --activity <activityName> or --workflow <workflowName>.',
          );
        }
        if (activityName && workflowName) {
          throw new Error(
            'ops run accepts either --activity <activityName> or --workflow <workflowName>, not both.',
          );
        }

        const loadedApp = await loadApp({ dir: appDir });
        const { manifest, publicManifest } = loadedApp;
        const appName = manifest.app.name;
        const resourceId = getAppResourceId(appName);

        /** @type {import('../../../core/lib/graph/operation.js').default} */
        let operation;

        if (activityName) {
          const availableActivities = getManifestActivityNames(
            manifest,
            publicManifest,
          );
          if (!availableActivities.includes(activityName)) {
            throw new Error(
              `Activity '${activityName}' was not found in ${appDir}. Available activities: ${
                availableActivities.join(', ') || '(none)'
              }`,
            );
          }

          operation = createOperationFromActivity({
            appName,
            activityName,
            event: parseJsonInput(options.event, 'event', {}),
            operationId: options.operationId,
            trigger: { source: 'manual' },
          });
          displayInfo(
            `Running activity: ${resourceId}#${operation.id} (${activityName})`,
          );
        } else {
          const workflow = findManifestWorkflowDefinition({
            manifest,
            publicManifest,
            workflowName,
          });

          if (!workflow) {
            const availableWorkflows = getWorkflowNames(manifest);
            throw new Error(
              `Workflow '${workflowName}' was not found in ${appDir}. Available workflows: ${
                availableWorkflows.join(', ') || '(none)'
              }`,
            );
          }

          operation = createOperationFromWorkflow({
            workflow,
            appName,
            operationId: options.operationId,
            trigger: { source: 'manual' },
          });
          displayInfo(
            `Running workflow: ${resourceId}#${operation.id} (${workflow.name})`,
          );
        }

        await store.putOperation(operation);

        /**
         * @param {import('../../../core/lib/graph/action.js').default} action - action.
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
              `INVOKE_FUNCTION action '${action.id}' is missing activity.`,
            );
          }

          const placementMode = getPlacementMode(action.placement);
          if (placementMode !== 'local' && placementMode !== 'in_process') {
            throw new Error(
              `INVOKE_FUNCTION action '${action.id}' requested unsupported placement mode '${placementMode}'. Local execution currently supports only 'local' or 'in_process'.`,
            );
          }

          const attemptCount = Number(action.attempt_count || 0) + 1;
          displayInfo(
            `- ${action.id} (${action.type}:${action.function_name} attempt=${attemptCount})`,
          );

          const outputs = await invokeManifestActivity({
            manifest,
            publicManifest,
            activityName: action.function_name,
            event: action.inputs ?? {},
            context: {
              workflow: {
                resourceId: action.resource_id,
                operationId: action.operation_id,
                actionId: action.id,
                actionType: action.type,
                attemptCount,
                placement: action.placement,
              },
            },
          });

          return {
            ok: true,
            outputs,
          };
        };

        const result = await runOperation({
          store,
          resourceId,
          operationId: operation.id,
          executeAction,
        });

        const finalRecords = await store.getRecords(resourceId, operation.id);
        const finalOperation = finalRecords.operations.find(
          (candidate) => candidate.id === operation.id,
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
            `Operation ${resourceId}#${operation.id} finished with status ${result.status}${
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
