import Action from '../lib/graph/action.js';
import Operation, { Type as OperationType } from '../lib/graph/operation.js';
import WharfieFunction from '../resources/builds/function.js';
import { createActorSystemResources } from './resources.js';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {any} manifest - manifest.
 * @param {any} publicManifest - publicManifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestActivities(manifest, publicManifest) {
  if (isObjectRecord(publicManifest?.activities)) {
    return publicManifest.activities;
  }

  const functions = Array.isArray(manifest?.functions)
    ? manifest.functions
    : [];
  return functions.reduce(
    (/** @type {Record<string, any>} */ acc, /** @type {any} */ definition) => {
      if (
        !isObjectRecord(definition) ||
        typeof definition.name !== 'string' ||
        !isObjectRecord(definition.entrypoint)
      ) {
        return acc;
      }

      acc[definition.name] = {
        entrypoint: definition.entrypoint,
        ...(Array.isArray(definition.external)
          ? { external: definition.external }
          : {}),
        ...(isObjectRecord(definition.environmentVariables)
          ? { environmentVariables: definition.environmentVariables }
          : {}),
        ...(isObjectRecord(definition.resources)
          ? { resources: definition.resources }
          : {}),
      };
      return acc;
    },
    /** @type {Record<string, any>} */ ({}),
  );
}

/**
 * @param {any} manifest - manifest.
 * @param {any} publicManifest - publicManifest.
 * @returns {string[]} - Result.
 */
export function getManifestActivityNames(manifest, publicManifest) {
  return Object.keys(getManifestActivities(manifest, publicManifest)).sort(
    (left, right) => left.localeCompare(right),
  );
}

/**
 * @param {{ manifest: any, publicManifest: any, activityName: string }} options - options.
 * @returns {any | undefined} - Result.
 */
export function getManifestActivityDefinition(options) {
  const activityName = String(options.activityName || '').trim();
  if (!activityName) return undefined;

  const activities = getManifestActivities(
    options.manifest,
    options.publicManifest,
  );
  return activities[activityName];
}

/**
 * @param {any} manifest - manifest.
 * @param {any} publicManifest - publicManifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestResourcesSpec(manifest, publicManifest) {
  if (isObjectRecord(publicManifest?.resources)) {
    return publicManifest.resources;
  }
  if (isObjectRecord(manifest?.resources)) {
    return manifest.resources;
  }
  if (isObjectRecord(manifest?.capabilities)) {
    return manifest.capabilities;
  }
  return {};
}

/**
 * @param {{ manifest: any, publicManifest: any, activityName: string }} options - options.
 * @returns {WharfieFunction} - Result.
 */
export function createManifestActivityFunction(options) {
  const activityName = String(options.activityName || '').trim();
  const definition = getManifestActivityDefinition(options);

  if (!definition || !isObjectRecord(definition.entrypoint)) {
    const available = getManifestActivityNames(
      options.manifest,
      options.publicManifest,
    );
    throw new Error(
      `Unknown activity '${activityName}'. Available activities: ${available.join(', ') || '(none)'}`,
    );
  }

  return new WharfieFunction({
    name: activityName,
    entrypoint: definition.entrypoint,
    properties: {
      ...(Array.isArray(definition.external)
        ? { external: definition.external }
        : {}),
      ...(isObjectRecord(definition.environmentVariables)
        ? { environmentVariables: definition.environmentVariables }
        : {}),
      ...(isObjectRecord(definition.resources)
        ? { resources: definition.resources }
        : {}),
    },
  });
}

/**
 * @param {{ manifest: any, publicManifest: any, activityName: string, event?: any, context?: any, resourceResolution?: { registryPath?: string } }} options - options.
 * @returns {Promise<any>} - Result.
 */
export async function invokeEmbeddedManifestActivity(options) {
  const activityName = String(options.activityName || '').trim();
  const definition = getManifestActivityDefinition(options);

  if (!definition || !isObjectRecord(definition.entrypoint)) {
    const available = getManifestActivityNames(
      options.manifest,
      options.publicManifest,
    );
    throw new Error(
      `Unknown activity '${activityName}'. Available activities: ${available.join(', ') || '(none)'}`,
    );
  }

  const { resources: baseResources, close } = await createActorSystemResources(
    getManifestResourcesSpec(options.manifest, options.publicManifest),
    options.resourceResolution,
  );

  try {
    return await WharfieFunction.run(
      activityName,
      options.event ?? {},
      options.context ?? {},
      { resources: baseResources },
    );
  } finally {
    await close();
  }
}

/**
 * @param {{ manifest: any, publicManifest: any, activityName: string, event?: any, context?: any, resourceResolution?: { registryPath?: string }, executionMode?: 'source' | 'embedded' }} options - options.
 * @returns {Promise<any>} - Result.
 */
export async function invokeManifestActivity(options) {
  if (options.executionMode === 'embedded') {
    return await invokeEmbeddedManifestActivity(options);
  }

  const fn = createManifestActivityFunction(options);
  const { resources: baseResources, close } = await createActorSystemResources(
    getManifestResourcesSpec(options.manifest, options.publicManifest),
    options.resourceResolution,
  );

  try {
    return await fn.fn(options.event ?? {}, options.context ?? {}, {
      baseResources,
    });
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
 * @param {{ manifest: any, publicManifest: any, workflowName: string }} options - options.
 * @returns {any | undefined} - Result.
 */
export function findManifestWorkflowDefinition(options) {
  const workflowName = String(options.workflowName || '').trim();
  if (!workflowName) return undefined;

  /** @type {any[]} */
  const workflows = Array.isArray(options.manifest?.workflows)
    ? options.manifest.workflows
    : [];
  return workflows.find(
    (workflow) =>
      typeof workflow?.name === 'string' &&
      workflow.name.trim() === workflowName,
  );
}

/**
 * @param {string} appName - appName.
 * @returns {string} - Result.
 */
export function getAppResourceId(appName) {
  return `app:${String(appName || '').trim()}`;
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
 * @param {{ appName: string, activityName: string, event?: any, operationId?: string, trigger?: any }} options - options.
 * @returns {Operation} - Result.
 */
export function createOperationFromActivity(options) {
  const operation = new Operation({
    resource_id: getAppResourceId(options.appName),
    resource_version: getAppResourceVersion(),
    ...(typeof options.operationId === 'string' && options.operationId.trim()
      ? { id: options.operationId.trim() }
      : {}),
    type: OperationType.PIPELINE,
    operation_config: {
      source: 'app-manifest',
      app_name: options.appName,
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

/**
 * @param {{ workflow: any, appName: string, operationId?: string, trigger?: any }} options - options.
 * @returns {Operation} - Result.
 */
export function createOperationFromWorkflow(options) {
  const workflow = options.workflow;
  const operation = new Operation({
    resource_id: getAppResourceId(options.appName),
    resource_version: getAppResourceVersion(),
    ...(typeof options.operationId === 'string' && options.operationId.trim()
      ? { id: options.operationId.trim() }
      : {}),
    type:
      typeof workflow?.type === 'string' && workflow.type.trim()
        ? workflow.type.trim().toUpperCase()
        : OperationType.PIPELINE,
    operation_config: {
      workflow_name: workflow?.name,
      app_name: options.appName,
      source: 'app-manifest',
      trigger: normalizeTrigger(options.trigger),
    },
  });

  const actions = Array.isArray(workflow?.actions) ? workflow.actions : [];
  for (const action of actions) {
    operation.createAction({
      id: action.id,
      type: action.type,
      function_name:
        typeof action.functionName === 'string'
          ? action.functionName
          : typeof action.activity === 'string'
            ? action.activity
            : undefined,
      inputs: action.inputs,
      placement: action.placement,
      retry: action.retry,
    });
  }

  for (const action of actions) {
    const dependencies = Array.isArray(action?.dependsOn)
      ? action.dependsOn
      : Array.isArray(action?.dependencies)
        ? action.dependencies
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

export default {
  createManifestActivityFunction,
  createOperationFromActivity,
  createOperationFromWorkflow,
  findManifestWorkflowDefinition,
  getAppResourceId,
  getAppResourceVersion,
  getManifestActivities,
  getManifestActivityDefinition,
  getManifestActivityNames,
  getManifestResourcesSpec,
  invokeEmbeddedManifestActivity,
  invokeManifestActivity,
};
