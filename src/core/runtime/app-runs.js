import path from 'node:path';

import Action from '../lib/graph/action.js';
import Operation, { Type as OperationType } from '../lib/graph/operation.js';
import WharfieFunction from '../resources/builds/function.js';
import { compareCanonicalStrings } from './canonical-order.js';
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
 * @param {any} trigger - trigger.
 * @returns {{ source: string, scheduledTime?: string, event?: any }} - Result.
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
      ? { event: trigger.event }
      : {}),
  };
}

/**
 * @param {{ appId: string, activityName: string, event?: any, operationId?: string, trigger?: any }} options - options.
 * @returns {Operation} - Result.
 */
export function createOperationFromActivity(options) {
  const operation = new Operation({
    resource_id: getAppResourceId(options.appId),
    resource_version: getAppResourceVersion(),
    ...(typeof options.operationId === 'string' && options.operationId.trim()
      ? { id: options.operationId.trim() }
      : {}),
    type: OperationType.PIPELINE,
    operation_config: {
      source: 'app-manifest',
      app_id: options.appId,
      activity_name: options.activityName,
      trigger: normalizeTrigger(options.trigger),
    },
    ...(Object.prototype.hasOwnProperty.call(options, 'event')
      ? { operation_inputs: options.event }
      : {}),
  });

  const start = operation.createAction({
    id: 'start',
    type: Action.Type.START,
  });
  const invoke = operation.createAction({
    id: 'invoke',
    type: Action.Type.INVOKE_FUNCTION,
    function_name: options.activityName,
    inputs: Object.prototype.hasOwnProperty.call(options, 'event')
      ? options.event
      : {},
    placement: { mode: 'local' },
    dependsOn: [start],
  });
  operation.createAction({
    id: 'finish',
    type: Action.Type.FINISH,
    dependsOn: [invoke],
  });

  return operation;
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
  invokeEmbeddedManifestActivity,
  invokeManifestActivity,
};
