import { Command } from 'commander';

import { prepareApplicationRevision } from '../../app/compile-application-revision.js';
import { loadApp } from '../../app/load-app.js';
import { parseJsonInput } from '../../app/local-app.js';
import { withOperationsStore } from '../operations-store.js';
import Action from '../../../core/lib/graph/action.js';
import { runOperation } from '../../../core/lib/graph/runner.js';
import {
  createOperationFromActivity,
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

const runCommand = new Command('run')
  .description('Execute a persisted app activity locally')
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .option(
    '--activity <activityName>',
    'Activity name declared in wharfie.app.js',
  )
  .option('--input <json>', 'Activity input JSON (default: {})')
  .option('--caller-metadata <json>', 'Caller metadata JSON (default: {})')
  .option('--operation-id <operationId>', 'Override generated operation id')
  .action(async (options) => {
    try {
      await withOperationsStore(async (store) => {
        const activityName =
          typeof options.activity === 'string' ? options.activity : '';
        const appDir = options.dir || process.cwd();

        if (!activityName) {
          throw new Error('ops run requires --activity <activityName>.');
        }

        const loadedApp = await loadApp({ dir: appDir });
        const { manifest } = loadedApp;
        const appId = manifest.app.id;
        const resourceId = getAppResourceId(appId);
        const callerMetadata = parseJsonInput(
          options.callerMetadata,
          'caller metadata',
          {},
        );
        if (
          !callerMetadata ||
          typeof callerMetadata !== 'object' ||
          Array.isArray(callerMetadata)
        ) {
          throw new Error('Caller metadata JSON must be an object.');
        }
        if (Object.prototype.hasOwnProperty.call(callerMetadata, 'resources')) {
          throw new Error(
            'Caller metadata cannot supply resources; managed capabilities are not available yet.',
          );
        }

        /** @type {import('../../../core/lib/graph/operation.js').default} */
        let operation;

        const availableActivities = getManifestActivityNames(manifest);
        if (!availableActivities.includes(activityName)) {
          throw new Error(
            `Activity '${activityName}' was not found in ${appDir}. Available activities: ${
              availableActivities.join(', ') || '(none)'
            }`,
          );
        }

        const preparedRevision = await prepareApplicationRevision({
          appDir: loadedApp.appDir,
          manifest,
        });
        try {
          const revisionId = preparedRevision.revision.revisionId;

          operation = createOperationFromActivity({
            appId,
            revisionId,
            activityName,
            event: parseJsonInput(options.input, 'input', {}),
            context: callerMetadata,
            operationId: options.operationId,
            trigger: { source: 'manual' },
          });
          displayInfo(
            `Running activity: ${resourceId}#${operation.id}@${revisionId} (${activityName})`,
          );

          try {
            await store.createOperation(operation);
          } catch (error) {
            if (
              error instanceof Error &&
              error.name === 'OperationAlreadyExistsError'
            ) {
              const existing = await store.getOperation(
                resourceId,
                operation.id,
              );
              if (existing && existing.revision_id !== revisionId) {
                const mismatch = new Error(
                  `Operation revision conflicts with existing work: ${resourceId}#${operation.id} requested ${revisionId}, persisted ${existing.revision_id}`,
                );
                mismatch.name = 'OperationRevisionMismatchError';
                throw mismatch;
              }
            }
            throw error;
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

            const persistedOperation = await store.getOperation(
              action.resource_id,
              action.operation_id,
            );
            const persistedCallerMetadata =
              persistedOperation?.operation_config?.context || callerMetadata;
            const outputs = await invokeManifestActivity({
              activityName: action.function_name,
              input: action.inputs ?? {},
              callerMetadata: {
                ...persistedCallerMetadata,
                operation: {
                  resourceId: action.resource_id,
                  operationId: action.operation_id,
                  revisionId,
                  actionId: action.id,
                  actionType: action.type,
                  attemptCount,
                  placement: action.placement,
                },
              },
              execution: {
                kind: 'prepared-source',
                prepared: preparedRevision,
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

          await preparedRevision.verifyRuntime();
          displaySuccess(
            `Executed ${result.executedActionIds.length} actions.`,
          );
        } finally {
          await preparedRevision.cleanup();
        }
      });
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default runCommand;
