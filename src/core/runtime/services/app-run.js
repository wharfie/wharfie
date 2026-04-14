import Action from '../../lib/graph/action.js';
import Operation, { Type as OperationType } from '../../lib/graph/operation.js';
import { runOperation } from '../../lib/graph/runner.js';

/**
 * @typedef ActivityRunTrigger
 * @property {string} source - Trigger source.
 * @property {string} [cron] - Cron expression, when applicable.
 * @property {string} [scheduledTime] - ISO scheduled time, when applicable.
 */

/**
 * @typedef ActivityRunContext
 * @property {{
 *   resourceId: string,
 *   operationId: string,
 *   actionId: string,
 *   actionType: import('../../lib/graph/action.js').WharfieActionTypeEnum,
 *   attemptCount: number,
 *   placement: Record<string, any> | undefined,
 * }} workflow - Persisted workflow/action metadata.
 * @property {ActivityRunTrigger} trigger - Trigger metadata.
 */

/**
 * @typedef PersistedActivityRunOptions
 * @property {any} store - Operations store.
 * @property {any} manifest - App manifest.
 * @property {string} activityName - Activity/function name.
 * @property {any} [event] - Event payload.
 * @property {ActivityRunTrigger} trigger - Trigger metadata.
 * @property {(activityName: string, event: any, context: ActivityRunContext) => Promise<any>} invokeActivity - Low-level activity invoker.
 */

/**
 * @param {any} manifest - manifest.
 * @returns {string} - Result.
 */
export function getSyntheticAppResourceId(manifest) {
  const appName =
    typeof manifest?.app?.name === 'string' ? manifest.app.name.trim() : '';

  if (!appName) {
    throw new Error('Persisted app runs require manifest.app.name.');
  }

  return `app:${appName}`;
}

/**
 * @param {{
 *   manifest: any,
 *   activityName: string,
 *   event?: any,
 *   trigger: ActivityRunTrigger,
 * }} options - options.
 * @returns {import('../../lib/graph/operation.js').default} - Result.
 */
export function createPersistedActivityOperation({
  manifest,
  activityName,
  event,
  trigger,
}) {
  const resourceId = getSyntheticAppResourceId(manifest);
  const appName = String(manifest.app.name).trim();
  const normalizedActivityName = String(activityName || '').trim();

  if (!normalizedActivityName) {
    throw new Error('Persisted app runs require a non-empty activityName.');
  }

  const operation = new Operation({
    resource_id: resourceId,
    resource_version: 1,
    type: OperationType.PIPELINE,
    operation_config: {
      source: 'scheduler',
      app_name: appName,
      activity_name: normalizedActivityName,
      trigger: { ...trigger },
    },
    operation_inputs: event,
  });

  operation.createAction({
    id: 'invoke',
    type: Action.Type.INVOKE_FUNCTION,
    function_name: normalizedActivityName,
    inputs: event,
    placement: { mode: 'local' },
    retry: { max_attempts: 1 },
  });

  return operation;
}

/**
 * @param {PersistedActivityRunOptions} options - options.
 * @returns {Promise<{
 *   resourceId: string,
 *   operation: import('../../lib/graph/operation.js').default,
 *   result: any,
 * }>} - Result.
 */
export async function runPersistedActivityOperation({
  store,
  manifest,
  activityName,
  event,
  trigger,
  invokeActivity,
}) {
  if (!store || typeof store.putOperation !== 'function') {
    throw new Error(
      'runPersistedActivityOperation requires store.putOperation',
    );
  }
  if (typeof invokeActivity !== 'function') {
    throw new Error(
      'runPersistedActivityOperation requires invokeActivity(activityName, event, context)',
    );
  }

  const operation = createPersistedActivityOperation({
    manifest,
    activityName,
    event,
    trigger,
  });
  const resourceId = operation.resource_id;

  await store.putOperation(operation);

  const result = await runOperation({
    store,
    resourceId,
    operationId: operation.id,
    executeAction: async (action) => {
      if (action.type !== Action.Type.INVOKE_FUNCTION) {
        throw new Error(
          `Unsupported action type '${action.type}' for persisted activity runs.`,
        );
      }

      if (!action.function_name || !String(action.function_name).trim()) {
        throw new Error(
          `Persisted activity action '${action.id}' is missing function_name.`,
        );
      }

      const attemptCount = Number(action.attempt_count || 0) + 1;
      return {
        ok: true,
        outputs: await invokeActivity(action.function_name, action.inputs, {
          workflow: {
            resourceId: action.resource_id,
            operationId: action.operation_id,
            actionId: action.id,
            actionType: action.type,
            attemptCount,
            placement: action.placement,
          },
          trigger,
        }),
      };
    },
  });

  return {
    resourceId,
    operation,
    result,
  };
}
