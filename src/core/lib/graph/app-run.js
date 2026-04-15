import { createId } from '../id.js';
import Action, { Status as ActionStatus } from './action.js';
import Operation, { Type as OperationType } from './operation.js';
import { runOperation } from './runner.js';

/**
 * @typedef QueueRunMetadata
 * @property {string} [queueUrl] - queueUrl.
 * @property {string} [messageId] - messageId.
 * @property {string} [receiptHandle] - receiptHandle.
 */

/**
 * @typedef RunPersistedEventActivityOptions
 * @property {import('../db/tables/operations.js').OperationsTableClient} store - store.
 * @property {string} appName - appName.
 * @property {string} activity - activity.
 * @property {any} [event] - event.
 * @property {any} [context] - context.
 * @property {any} [payload] - raw payload.
 * @property {QueueRunMetadata} [message] - message metadata.
 * @property {(request: { functionName: string, event?: any, context?: any }) => Promise<any>} execute - execute.
 */

/**
 * @param {unknown} value - value.
 * @returns {string | undefined} - Result.
 */
function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * @param {string} appName - appName.
 * @returns {string} - Result.
 */
export function getSyntheticAppResourceId(appName) {
  const normalized = normalizeOptionalString(appName);
  if (!normalized) {
    throw new Error('runPersistedEventActivity requires appName');
  }
  return `app:${normalized}`;
}

/**
 * @param {{
 *   appName: string,
 *   activity: string,
 *   operationId: string,
 *   previousAttemptCount?: number,
 *   payload?: any,
 *   event?: any,
 *   message?: QueueRunMetadata,
 * }} options - options.
 * @returns {Operation} - Result.
 */
function createEventOperation({
  appName,
  activity,
  operationId,
  previousAttemptCount = 0,
  payload,
  event,
  message,
}) {
  const resourceId = getSyntheticAppResourceId(appName);
  const trigger = {
    source: 'event',
    ...(normalizeOptionalString(message?.queueUrl)
      ? { queueUrl: normalizeOptionalString(message?.queueUrl) }
      : {}),
    ...(normalizeOptionalString(message?.messageId)
      ? { messageId: normalizeOptionalString(message?.messageId) }
      : {}),
    ...(normalizeOptionalString(message?.receiptHandle)
      ? { receiptHandle: normalizeOptionalString(message?.receiptHandle) }
      : {}),
  };

  const operation = new Operation({
    resource_id: resourceId,
    resource_version: 1,
    id: operationId,
    type: OperationType.PIPELINE,
    operation_config: {
      app: appName,
      activity,
      trigger,
    },
    operation_inputs:
      payload !== undefined
        ? payload
        : {
            event,
          },
  });

  operation.createAction({
    id: 'invoke',
    type: Action.Type.INVOKE_FUNCTION,
    function_name: activity,
    inputs: event,
    retry: { maxAttempts: 1 },
    attempt_count: previousAttemptCount,
  });

  return operation;
}

/**
 * @param {RunPersistedEventActivityOptions} options - options.
 * @returns {Promise<{ resourceId: string, operationId: string, status: 'COMPLETED' | 'FAILED' | 'BLOCKED' }>} - Result.
 */
export async function runPersistedEventActivity({
  store,
  appName,
  activity,
  event,
  context,
  payload,
  message,
  execute,
}) {
  if (!store) {
    throw new Error('runPersistedEventActivity requires store');
  }
  const normalizedActivity = normalizeOptionalString(activity);
  if (!normalizedActivity) {
    throw new Error('runPersistedEventActivity requires activity');
  }
  if (typeof execute !== 'function') {
    throw new Error('runPersistedEventActivity requires execute(request)');
  }

  const resourceId = getSyntheticAppResourceId(appName);
  const operationId = normalizeOptionalString(message?.messageId) || createId();

  const existingRecords = await store.getRecords(resourceId, operationId);
  const existingAction = existingRecords.actions.find(
    (candidate) => candidate.id === 'invoke',
  );
  const previousAttemptCount = Number(existingAction?.attempt_count || 0);

  const operation = createEventOperation({
    appName,
    activity: normalizedActivity,
    operationId,
    previousAttemptCount,
    payload,
    event,
    message,
  });

  await store.putOperation(operation);

  const result = await runOperation({
    store,
    resourceId,
    operationId,
    executeAction: async (action) => {
      if (action.type !== Action.Type.INVOKE_FUNCTION) {
        return { ok: true };
      }

      const outputs = await execute({
        functionName: action.function_name || normalizedActivity,
        event: action.inputs,
        context,
      });

      return { ok: true, outputs };
    },
  });

  if (result.status !== 'COMPLETED') {
    const finalRecords = await store.getRecords(resourceId, operationId);
    const failedAction = finalRecords.actions.find(
      (candidate) => candidate.status === ActionStatus.FAILED,
    );
    const messageText =
      typeof failedAction?.error?.message === 'string' &&
      failedAction.error.message.trim()
        ? failedAction.error.message.trim()
        : `Persisted event run ${resourceId}#${operationId} finished with status ${result.status}`;
    const error = new Error(messageText);
    Object.assign(error, {
      resourceId,
      operationId,
      status: result.status,
    });
    throw error;
  }

  return {
    resourceId,
    operationId,
    status: result.status,
  };
}

export default {
  getSyntheticAppResourceId,
  runPersistedEventActivity,
};
