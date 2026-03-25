import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { withOperationsStore } from '../operations-store.js';
import Action from '../../../core/lib/graph/action.js';
import Operation from '../../../core/lib/graph/operation.js';
import { runOperation } from '../../../core/lib/graph/runner.js';
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

/**
 * @param {any} manifest - manifest.
 * @param {string} workflowName - workflowName.
 * @returns {any | undefined} - Result.
 */
function findWorkflowDefinition(manifest, workflowName) {
  const trimmedName = String(workflowName || '').trim();
  if (!trimmedName) return undefined;

  /** @type {any[]} */
  const workflows = Array.isArray(manifest?.workflows)
    ? manifest.workflows
    : [];
  return workflows.find(
    (/** @type {any} */ workflow) =>
      workflow?.name && String(workflow.name) === trimmedName,
  );
}

/**
 * @param {{ workflow: any, resourceId: string, operationId?: string | undefined }} options - options.
 * @returns {import('../../../core/lib/graph/operation.js').default} - Result.
 */
function createOperationFromWorkflow({ workflow, resourceId, operationId }) {
  const operation = new Operation({
    resource_id: resourceId,
    resource_version: 1,
    ...(typeof operationId === 'string' && operationId.trim()
      ? { id: operationId.trim() }
      : {}),
    type:
      typeof workflow?.type === 'string' && workflow.type.trim()
        ? workflow.type.trim().toUpperCase()
        : Operation.Type.PIPELINE,
    operation_config: {
      workflow_name: workflow?.name,
      source: 'app-manifest',
    },
  });

  const actions = Array.isArray(workflow?.actions) ? workflow.actions : [];
  for (const action of actions) {
    operation.createAction({
      id: action.id,
      type: action.type,
      function_name: action.functionName,
      inputs: action.inputs,
      placement: action.placement,
      retry: action.retry,
    });
  }

  for (const action of actions) {
    const dependencies = Array.isArray(action?.dependsOn)
      ? action.dependsOn
      : [];
    for (const dependencyId of dependencies) {
      if (typeof dependencyId !== 'string' || !dependencyId.trim()) {
        continue;
      }
      operation._addDependency(dependencyId.trim(), action.id);
    }
  }

  return operation;
}

const runCommand = new Command('run')
  .description(
    'Execute a persisted operation or an app-defined workflow locally',
  )
  .argument('<resource_id>', 'Wharfie resource ID')
  .argument(
    '[operation_id]',
    'Operation ID (or operation ID override when --workflow is used)',
  )
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .option(
    '--workflow <workflowName>',
    'Workflow name declared in wharfie.app.js',
  )
  .action(async (resource_id, operation_id, options) => {
    /** @type {{ appExport: any, manifest: any } | undefined} */
    let loadedApp;

    try {
      await withOperationsStore(async (store) => {
        const workflowName =
          typeof options.workflow === 'string' ? options.workflow.trim() : '';
        const appDir = options.dir || process.cwd();

        if (!workflowName && !operation_id) {
          throw new Error(
            'ops run requires <operation_id> unless --workflow <workflowName> is provided.',
          );
        }

        /**
         * @returns {Promise<{ appExport: any, manifest: any }>} - Result.
         */
        const ensureLoadedApp = async () => {
          if (loadedApp) {
            return loadedApp;
          }
          loadedApp = await loadApp({ dir: appDir });
          assertRunnableApp(loadedApp.appExport);
          return loadedApp;
        };

        let resolvedOperationId = operation_id;

        if (workflowName) {
          const loaded = await ensureLoadedApp();
          const workflow = findWorkflowDefinition(
            loaded.manifest,
            workflowName,
          );

          if (!workflow) {
            /** @type {string[]} */
            const availableWorkflows = Array.isArray(loaded.manifest?.workflows)
              ? loaded.manifest.workflows
                  .map((/** @type {any} */ candidate) => candidate?.name)
                  .filter(
                    (/** @type {unknown} */ candidate) =>
                      typeof candidate === 'string',
                  )
              : [];
            throw new Error(
              `Workflow '${workflowName}' was not found in ${appDir}. Available workflows: ${
                availableWorkflows.length > 0
                  ? availableWorkflows.join(', ')
                  : '(none)'
              }`,
            );
          }

          const workflowOperation = createOperationFromWorkflow({
            workflow,
            resourceId: resource_id,
            operationId: operation_id,
          });
          resolvedOperationId = workflowOperation.id;
          await store.putOperation(workflowOperation);

          displayInfo(
            `Running workflow: ${resource_id}#${resolvedOperationId} (${workflow.name})`,
          );
        } else {
          displayInfo(
            `Running operation: ${resource_id}#${resolvedOperationId}`,
          );
        }

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
              `INVOKE_FUNCTION action '${action.id}' is missing function_name.`,
            );
          }

          const placementMode = getPlacementMode(action.placement);
          if (placementMode !== 'local' && placementMode !== 'in_process') {
            throw new Error(
              `INVOKE_FUNCTION action '${action.id}' requested unsupported placement mode '${placementMode}'. Local execution currently supports only 'local' or 'in_process'.`,
            );
          }

          const { appExport } = await ensureLoadedApp();
          const app = appExport;
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

        if (!resolvedOperationId) {
          throw new Error('Operation ID is required to run a persisted DAG.');
        }

        const result = await runOperation({
          store,
          resourceId: resource_id,
          operationId: resolvedOperationId,
          executeAction,
        });

        const finalRecords = await store.getRecords(
          resource_id,
          resolvedOperationId,
        );
        const finalOperation = finalRecords.operations.find(
          (operation) => operation.id === resolvedOperationId,
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
            `Operation ${resource_id}#${resolvedOperationId} finished with status ${result.status}${
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
      if (typeof loadedApp?.appExport?.closeRuntimeResources === 'function') {
        await loadedApp.appExport.closeRuntimeResources();
      }
    }
  });

export default runCommand;
