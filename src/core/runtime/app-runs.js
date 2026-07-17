import { createHash } from 'node:crypto';
import path from 'node:path';

import Action, { Status as ActionStatus } from '../lib/graph/action.js';
import Operation, {
  Status as OperationStatus,
  Type as OperationType,
} from '../lib/graph/operation.js';
import { runOperation } from '../lib/graph/runner.js';
import WharfieFunction from '../resources/builds/function.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import { cloneJsonObject, cloneJsonValue } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { createActorSystemResources } from './resources.js';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Clone caller-owned values before they cross an activity boundary.
 * @param {{ event?: any, context?: any }} options - Invocation options.
 * @returns {{ event: any, context: Record<string, any> }} - JSON-only inputs.
 */
function cloneActivityInputs(options) {
  const hasEvent = Object.prototype.hasOwnProperty.call(options, 'event');
  const hasContext = Object.prototype.hasOwnProperty.call(options, 'context');
  return {
    event: cloneJsonValue(hasEvent ? options.event : {}, 'Activity event'),
    context: cloneJsonObject(
      hasContext ? options.context : {},
      'Activity context',
    ),
  };
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestActivities(manifest) {
  return isObjectRecord(manifest?.activities) ? manifest.activities : {};
}

/**
 * @param {any} manifest - manifest.
 * @returns {string[]} - Result.
 */
export function getManifestActivityNames(manifest) {
  return Object.keys(getManifestActivities(manifest)).sort(
    compareCanonicalStrings,
  );
}

/**
 * @param {{ manifest: any, activityName: string }} options - options.
 * @returns {any | undefined} - Result.
 */
export function getManifestActivityDefinition(options) {
  assertLogicalId(options.activityName, 'activityName');
  return getManifestActivities(options.manifest)[options.activityName];
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestResourcesSpec(manifest) {
  return isObjectRecord(manifest?.resources) ? manifest.resources : {};
}

/**
 * @param {{ manifest: any, activityName: string, appDir: string }} options - options.
 * @returns {WharfieFunction} - Result.
 */
export function createManifestActivityFunction(options) {
  const activityName = options.activityName;
  const definition = getManifestActivityDefinition(options);

  if (!definition || !isObjectRecord(definition.entrypoint)) {
    const available = getManifestActivityNames(options.manifest);
    throw new Error(
      `Unknown activity '${activityName}'. Available activities: ${available.join(', ') || '(none)'}`,
    );
  }

  return new WharfieFunction({
    name: activityName,
    entrypoint: {
      path: path.resolve(options.appDir, definition.entrypoint.path),
      export: definition.entrypoint.export,
    },
    properties: {
      ...(Array.isArray(definition.externalPackages)
        ? { external: definition.externalPackages }
        : {}),
      ...(isObjectRecord(definition.resources)
        ? { resources: definition.resources }
        : {}),
    },
  });
}

/**
 * @param {{ manifest: any, activityName: string, event?: any, context?: any, resourceResolution?: { registryPath?: string } }} options - options.
 * @returns {Promise<any>} - Result.
 */
export async function invokeEmbeddedManifestActivity(options) {
  const activityName = options.activityName;
  const definition = getManifestActivityDefinition(options);

  if (!definition || !isObjectRecord(definition.entrypoint)) {
    const available = getManifestActivityNames(options.manifest);
    throw new Error(
      `Unknown activity '${activityName}'. Available activities: ${available.join(', ') || '(none)'}`,
    );
  }

  const { event, context } = cloneActivityInputs(options);

  const { resources: baseResources, close } = await createActorSystemResources(
    getManifestResourcesSpec(options.manifest),
    options.resourceResolution,
  );

  try {
    const result = await WharfieFunction.run(activityName, event, context, {
      resources: baseResources,
    });
    return cloneJsonValue(result, 'Activity result');
  } finally {
    await close();
  }
}

/**
 * @param {{ manifest: any, appDir?: string, activityName: string, event?: any, context?: any, resourceResolution?: { registryPath?: string }, executionMode?: 'source' | 'embedded' }} options - options.
 * @returns {Promise<any>} - Result.
 */
export async function invokeManifestActivity(options) {
  if (options.executionMode === 'embedded') {
    return await invokeEmbeddedManifestActivity(options);
  }

  if (typeof options.appDir !== 'string' || !options.appDir) {
    throw new Error(
      'Source activity execution requires the application directory.',
    );
  }
  const fn = createManifestActivityFunction({
    manifest: options.manifest,
    activityName: options.activityName,
    appDir: options.appDir,
  });
  const { event, context } = cloneActivityInputs(options);
  const { resources: baseResources, close } = await createActorSystemResources(
    getManifestResourcesSpec(options.manifest),
    options.resourceResolution,
  );

  try {
    const result = await fn.fn(event, context, {
      baseResources,
    });
    return cloneJsonValue(result, 'Activity result');
  } finally {
    await Promise.allSettled([
      close(),
      typeof fn.closeRuntimeResources === 'function'
        ? fn.closeRuntimeResources()
        : Promise.resolve(),
    ]);
  }
}

/**
 * @param {string} appId - Canonical application logical ID.
 * @returns {string} - Result.
 */
export function getAppResourceId(appId) {
  assertLogicalId(appId, 'appId');
  return `app:${appId}`;
}

/**
 * @returns {number} - Result.
 */
export function getAppResourceVersion() {
  return 1;
}

/**
 * Derive one stable operation identity from a queue and its provider-assigned
 * message identity. JSON encodes the pair without delimiter ambiguity; the
 * domain-separated digest keeps operation IDs compact and safe for storage.
 * @param {{ queueUrl: string, messageId: string }} options - Queue message identity.
 * @returns {string} - Stable queue operation ID.
 */
export function getQueueOperationId(options) {
  if (typeof options?.queueUrl !== 'string' || options.queueUrl.length === 0) {
    throw new TypeError('queueUrl must be a non-empty string.');
  }
  if (
    typeof options?.messageId !== 'string' ||
    options.messageId.length === 0
  ) {
    throw new TypeError('messageId must be a non-empty string.');
  }

  const digest = createHash('sha256')
    .update('wharfie:queue-operation:v1\0', 'utf8')
    .update(JSON.stringify([options.queueUrl, options.messageId]), 'utf8')
    .digest('hex');
  return `queue-${digest}`;
}

/**
 * @param {any} trigger - trigger.
 * @returns {{ source: string, scheduledTime?: string, event?: any, queueUrl?: string, messageId?: string }} - Result.
 */
function normalizeTrigger(trigger) {
  if (!isObjectRecord(trigger)) {
    return { source: 'manual' };
  }

  return {
    source:
      typeof trigger.source === 'string' && trigger.source.trim()
        ? trigger.source.trim()
        : 'manual',
    ...(typeof trigger.scheduledTime === 'string' && trigger.scheduledTime
      ? { scheduledTime: trigger.scheduledTime }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(trigger, 'event')
      ? { event: cloneJsonValue(trigger.event, 'Operation trigger event') }
      : {}),
    ...(typeof trigger.queueUrl === 'string' && trigger.queueUrl.length > 0
      ? { queueUrl: trigger.queueUrl }
      : {}),
    ...(typeof trigger.messageId === 'string' && trigger.messageId.length > 0
      ? { messageId: trigger.messageId }
      : {}),
  };
}

/**
 * @param {{ appId: string, activityName: string, event?: any, operationId?: string, trigger?: any }} options - options.
 * @returns {Operation} - Result.
 */
export function createOperationFromActivity(options) {
  assertLogicalId(options.appId, 'appId');
  assertLogicalId(options.activityName, 'activityName');
  const hasOperationId = options.operationId !== undefined;
  if (
    hasOperationId &&
    (typeof options.operationId !== 'string' ||
      options.operationId.length === 0)
  ) {
    throw new TypeError('operationId must be a nonempty string when provided.');
  }
  const event = cloneJsonValue(
    Object.prototype.hasOwnProperty.call(options, 'event') ? options.event : {},
    'Activity event',
  );
  const operation = new Operation({
    resource_id: getAppResourceId(options.appId),
    resource_version: getAppResourceVersion(),
    ...(hasOperationId ? { id: options.operationId } : {}),
    type: OperationType.PIPELINE,
    operation_config: {
      source: 'app-manifest',
      app_id: options.appId,
      activity_name: options.activityName,
      trigger: normalizeTrigger(options.trigger),
    },
    operation_inputs: event,
  });

  operation.createAction({
    id: 'invoke',
    type: Action.Type.INVOKE_FUNCTION,
    function_name: options.activityName,
    inputs: cloneJsonValue(event, 'Activity action input'),
    placement: { mode: 'local' },
  });

  return operation;
}

/**
 * @typedef RunPersistedActivityOptions
 * @property {import('../lib/db/tables/operations.js').OperationsTableClient} store - Operations store.
 * @property {string} appId - Canonical application ID.
 * @property {string} activityName - Canonical activity ID.
 * @property {string} operationId - Stable operation ID.
 * @property {any} [event] - Activity event.
 * @property {Record<string, any>} [context] - Attempt-scoped activity context.
 * @property {any} [trigger] - Immutable operation trigger.
 * @property {(request: { activityName: string, event?: any, context: Record<string, any> }) => Promise<any>} execute - Activity executor.
 */

/**
 * @param {unknown} error - Candidate duplicate-create error.
 * @returns {boolean} - Whether the operation already exists.
 */
function isOperationAlreadyExistsError(error) {
  return error instanceof Error && error.name === 'OperationAlreadyExistsError';
}

/**
 * @param {string} message - Error message.
 * @param {{ resourceId: string, operationId: string, status: string }} details - Operation details.
 * @param {string} [name] - Error name.
 * @returns {Error} - Enriched operation error.
 */
function createOperationRunError(message, details, name) {
  const error = new Error(message);
  if (name) error.name = name;
  Object.assign(error, details);
  return error;
}

/**
 * Return the immutable part of a persisted named-activity operation. Runtime
 * status, generations, attempts, timestamps, errors, and outputs intentionally
 * do not participate in idempotency identity.
 * @param {Operation} operation - Operation to describe.
 * @returns {Record<string, any>} - Canonical identity input.
 */
function getPersistedActivityIdentity(operation) {
  return {
    resource_id: operation.resource_id,
    resource_version: operation.resource_version,
    id: operation.id,
    type: operation.type,
    operation_config: operation.operation_config,
    operation_inputs: operation.operation_inputs,
    actions: operation
      .getActions()
      .map((action) => ({
        id: action.id,
        resource_id: action.resource_id,
        operation_id: action.operation_id,
        type: action.type,
        function_name: action.function_name,
        inputs: action.inputs,
        placement: action.placement,
        retry: action.retry,
        depends_on: operation
          .getUpstreamActionIds(action.id)
          .sort(compareCanonicalStrings),
      }))
      .sort((left, right) => compareCanonicalStrings(left.id, right.id)),
  };
}

/**
 * @param {Operation} requested - Requested immutable definition.
 * @param {Operation} existing - Persisted immutable definition.
 * @returns {boolean} - Whether both definitions describe the same work.
 */
function hasSamePersistedActivityIdentity(requested, existing) {
  try {
    return (
      JSON.stringify(
        sortCanonicalJsonValue(getPersistedActivityIdentity(requested)),
      ) ===
      JSON.stringify(
        sortCanonicalJsonValue(getPersistedActivityIdentity(existing)),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Create or resume one persisted named-activity operation and execute it through
 * the shared graph runner. Operation creation is immutable: duplicate delivery
 * loads existing truth, completed work deduplicates, and retryable terminal work
 * is reopened only through the store's explicit retry transition.
 * @param {RunPersistedActivityOptions} options - Run options.
 * @returns {Promise<{ resourceId: string, operationId: string, status: 'COMPLETED', deduplicated: boolean }>} - Completed operation identity.
 */
export async function runPersistedActivity(options) {
  if (!options?.store) {
    throw new Error('runPersistedActivity requires store');
  }
  if (typeof options.store.createOperation !== 'function') {
    throw new Error('runPersistedActivity requires store.createOperation');
  }
  if (typeof options.execute !== 'function') {
    throw new Error('runPersistedActivity requires execute(request)');
  }
  if (typeof options.operationId !== 'string' || !options.operationId) {
    throw new Error('runPersistedActivity requires operationId');
  }

  const operation = createOperationFromActivity({
    appId: options.appId,
    activityName: options.activityName,
    operationId: options.operationId,
    ...(Object.prototype.hasOwnProperty.call(options, 'event')
      ? { event: options.event }
      : {}),
    trigger: options.trigger,
  });
  const resourceId = operation.resource_id;
  const operationId = operation.id;
  const context = cloneJsonObject(
    Object.prototype.hasOwnProperty.call(options, 'context')
      ? options.context
      : {},
    'Activity context',
  );

  let created = false;
  let operationToClaim = operation;
  try {
    await options.store.createOperation(operation);
    created = true;
  } catch (error) {
    if (!isOperationAlreadyExistsError(error)) throw error;
  }

  if (!created) {
    const records = await options.store.getRecords(resourceId, operationId);
    const existing = records.operations.find(
      (candidate) => candidate.id === operationId,
    );
    if (!existing) {
      throw createOperationRunError(
        `Operation already exists but could not be loaded: ${resourceId}#${operationId}`,
        { resourceId, operationId, status: 'UNKNOWN' },
      );
    }

    if (!hasSamePersistedActivityIdentity(operation, existing)) {
      throw createOperationRunError(
        `Operation identity conflicts with existing work: ${resourceId}#${operationId}`,
        { resourceId, operationId, status: existing.status },
        'OperationIdentityConflictError',
      );
    }

    if (existing.status === OperationStatus.COMPLETED) {
      return {
        resourceId,
        operationId,
        status: 'COMPLETED',
        deduplicated: true,
      };
    }

    if (existing.status === OperationStatus.CANCELLED) {
      throw createOperationRunError(
        `Operation ${resourceId}#${operationId} was cancelled.`,
        { resourceId, operationId, status: existing.status },
        'OperationCancelledError',
      );
    }

    if (existing.status === OperationStatus.RUNNING) {
      throw createOperationRunError(
        `Operation ${resourceId}#${operationId} is already running.`,
        { resourceId, operationId, status: existing.status },
        'OperationInProgressError',
      );
    }

    if (
      existing.status === OperationStatus.FAILED ||
      existing.status === OperationStatus.BLOCKED
    ) {
      if (typeof options.store.retryOperation !== 'function') {
        throw new Error('runPersistedActivity requires store.retryOperation');
      }
      operationToClaim = await options.store.retryOperation(
        resourceId,
        operationId,
        existing.version,
      );
      if (!hasSamePersistedActivityIdentity(operation, operationToClaim)) {
        throw createOperationRunError(
          `Operation identity changed during retry: ${resourceId}#${operationId}`,
          { resourceId, operationId, status: operationToClaim.status },
          'OperationIdentityConflictError',
        );
      }
    } else if (existing.status !== OperationStatus.PENDING) {
      throw createOperationRunError(
        `Operation ${resourceId}#${operationId} has unsupported status ${String(existing.status)}.`,
        { resourceId, operationId, status: String(existing.status) },
      );
    } else {
      operationToClaim = existing;
    }
  }

  const result = await runOperation({
    store: options.store,
    resourceId,
    operationId,
    expectedGeneration: operationToClaim.generation,
    expectedVersion: operationToClaim.version,
    executeAction: async (action) => {
      if (action.type !== Action.Type.INVOKE_FUNCTION) {
        throw new Error(
          `Persisted activity operation contains unsupported action type '${action.type}'.`,
        );
      }
      const activityName = action.function_name || options.activityName;
      const rawOutputs = await options.execute({
        activityName,
        event: cloneJsonValue(action.inputs, 'Activity event'),
        context,
      });
      const outputs =
        rawOutputs === undefined
          ? undefined
          : cloneJsonValue(rawOutputs, 'Activity result');
      return { ok: true, outputs };
    },
  });

  if (result.status !== 'COMPLETED') {
    const finalRecords = await options.store.getRecords(
      resourceId,
      operationId,
    );
    const failedAction = finalRecords.actions.find(
      (candidate) => candidate.status === ActionStatus.FAILED,
    );
    const message =
      typeof failedAction?.error?.message === 'string' &&
      failedAction.error.message.trim()
        ? failedAction.error.message.trim()
        : `Persisted activity ${resourceId}#${operationId} finished with status ${result.status}`;
    throw createOperationRunError(message, {
      resourceId,
      operationId,
      status: result.status,
    });
  }

  return {
    resourceId,
    operationId,
    status: 'COMPLETED',
    deduplicated: false,
  };
}

export default {
  createManifestActivityFunction,
  createOperationFromActivity,
  getAppResourceId,
  getAppResourceVersion,
  getManifestActivities,
  getManifestActivityDefinition,
  getManifestActivityNames,
  getManifestResourcesSpec,
  getQueueOperationId,
  invokeEmbeddedManifestActivity,
  invokeManifestActivity,
  runPersistedActivity,
};
