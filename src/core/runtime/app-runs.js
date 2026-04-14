import Action from '../lib/graph/action.js';
import Operation, { Type as OperationType } from '../lib/graph/operation.js';
import { runOperation } from '../lib/graph/runner.js';
import WharfieFunction from '../resources/builds/function.js';

import { createActorSystemResources } from './resources.js';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {any} manifest - manifest.
 * @returns {string} - Result.
 */
function getManifestAppName(manifest) {
  const appName = manifest?.app?.name;
  if (typeof appName !== 'string' || !appName.trim()) {
    throw new Error('App manifest is missing app.name.');
  }

  return appName.trim();
}

/**
 * @param {any} manifest - manifest.
 * @returns {string} - Result.
 */
export function getSyntheticAppResourceId(manifest) {
  return `app:${getManifestAppName(manifest)}`;
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
function getManifestResources(manifest) {
  if (isPlainObject(manifest?.resources)) {
    return manifest.resources;
  }

  if (isPlainObject(manifest?.capabilities)) {
    return manifest.capabilities;
  }

  return {};
}

/**
 * @param {any} manifest - manifest.
 * @returns {Array<Record<string, any>>} - Result.
 */
function getManifestActivities(manifest) {
  return Array.isArray(manifest?.functions)
    ? manifest.functions.filter(
        (/** @type {any} */ activity) =>
          isPlainObject(activity) &&
          typeof activity.name === 'string' &&
          activity.name.trim(),
      )
    : [];
}

/**
 * @param {any} manifest - manifest.
 * @returns {string[]} - Result.
 */
export function getManifestActivityNames(manifest) {
  return getManifestActivities(manifest)
    .map((activity) => String(activity.name).trim())
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * @param {any} manifest - manifest.
 * @param {string} activityName - activityName.
 * @returns {Record<string, any> | undefined} - Result.
 */
export function findManifestActivity(manifest, activityName) {
  const trimmedName = String(activityName || '').trim();
  if (!trimmedName) return undefined;

  return getManifestActivities(manifest).find(
    (activity) => String(activity.name).trim() === trimmedName,
  );
}

/**
 * @param {any} manifest - manifest.
 * @returns {Array<Record<string, any>>} - Result.
 */
function getManifestWorkflows(manifest) {
  return Array.isArray(manifest?.workflows)
    ? manifest.workflows.filter(
        (/** @type {any} */ workflow) =>
          isPlainObject(workflow) &&
          typeof workflow.name === 'string' &&
          workflow.name.trim(),
      )
    : [];
}

/**
 * @param {any} manifest - manifest.
 * @returns {string[]} - Result.
 */
export function getManifestWorkflowNames(manifest) {
  return getManifestWorkflows(manifest)
    .map((workflow) => String(workflow.name).trim())
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * @param {any} manifest - manifest.
 * @param {string} workflowName - workflowName.
 * @returns {Record<string, any> | undefined} - Result.
 */
export function findManifestWorkflow(manifest, workflowName) {
  const trimmedName = String(workflowName || '').trim();
  if (!trimmedName) return undefined;

  return getManifestWorkflows(manifest).find(
    (workflow) => String(workflow.name).trim() === trimmedName,
  );
}

/**
 * @param {string} name - name.
 * @returns {string} - Result.
 */
function toActionIdSegment(name) {
  const normalized = String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return normalized || 'activity';
}

/**
 * @param {{
 *   manifest: any,
 *   activityName?: string,
 *   workflowName?: string,
 *   triggerSource?: string,
 * }} options - options.
 * @returns {Record<string, any>} - Result.
 */
function createOperationConfig({
  manifest,
  activityName,
  workflowName,
  triggerSource = 'manual',
}) {
  return {
    app: getManifestAppName(manifest),
    ...(typeof activityName === 'string' && activityName.trim()
      ? { activity: activityName.trim() }
      : {}),
    ...(typeof workflowName === 'string' && workflowName.trim()
      ? { workflow: workflowName.trim() }
      : {}),
    trigger: {
      source: String(triggerSource || 'manual').trim() || 'manual',
    },
    source: 'app-manifest',
  };
}

/**
 * @param {{
 *   manifest: any,
 *   activityName: string,
 *   event?: any,
 *   operationId?: string,
 *   triggerSource?: string,
 * }} options - options.
 * @returns {import('../lib/graph/operation.js').default} - Result.
 */
export function createAppActivityOperation({
  manifest,
  activityName,
  event = {},
  operationId,
  triggerSource = 'manual',
}) {
  const activity = findManifestActivity(manifest, activityName);
  if (!activity) {
    const availableActivities = getManifestActivityNames(manifest);
    throw new Error(
      `Activity '${activityName}' was not found in the app manifest. Available activities: ${
        availableActivities.length > 0
          ? availableActivities.join(', ')
          : '(none)'
      }`,
    );
  }

  const operation = new Operation({
    resource_id: getSyntheticAppResourceId(manifest),
    resource_version: 1,
    ...(typeof operationId === 'string' && operationId.trim()
      ? { id: operationId.trim() }
      : {}),
    type: OperationType.PIPELINE,
    operation_config: createOperationConfig({
      manifest,
      activityName: activity.name,
      triggerSource,
    }),
    operation_inputs: event,
  });

  const startAction = operation.createAction({
    id: 'start',
    type: Action.Type.START,
  });
  const invokeAction = operation.createAction({
    id: `invoke-${toActionIdSegment(activity.name)}`,
    type: Action.Type.INVOKE_FUNCTION,
    function_name: activity.name,
    inputs: event,
    placement: { mode: 'local' },
    retry: { max_attempts: 1 },
    dependsOn: [startAction],
  });

  operation.createAction({
    id: 'finish',
    type: Action.Type.FINISH,
    dependsOn: [invokeAction],
  });

  return operation;
}

/**
 * @param {Record<string, any>} action - action.
 * @returns {string | undefined} - Result.
 */
function getWorkflowActionFunctionName(action) {
  if (typeof action?.functionName === 'string' && action.functionName.trim()) {
    return action.functionName.trim();
  }

  if (
    typeof action?.function_name === 'string' &&
    action.function_name.trim()
  ) {
    return action.function_name.trim();
  }

  if (typeof action?.activity === 'string' && action.activity.trim()) {
    return action.activity.trim();
  }

  return undefined;
}

/**
 * @param {{
 *   manifest: any,
 *   workflowName: string,
 *   operationId?: string,
 *   triggerSource?: string,
 * }} options - options.
 * @returns {import('../lib/graph/operation.js').default} - Result.
 */
export function createAppWorkflowOperation({
  manifest,
  workflowName,
  operationId,
  triggerSource = 'manual',
}) {
  const workflow = findManifestWorkflow(manifest, workflowName);
  if (!workflow) {
    const availableWorkflows = getManifestWorkflowNames(manifest);
    throw new Error(
      `Workflow '${workflowName}' was not found in the app manifest. Available workflows: ${
        availableWorkflows.length > 0 ? availableWorkflows.join(', ') : '(none)'
      }`,
    );
  }

  const operation = new Operation({
    resource_id: getSyntheticAppResourceId(manifest),
    resource_version: 1,
    ...(typeof operationId === 'string' && operationId.trim()
      ? { id: operationId.trim() }
      : {}),
    type:
      typeof workflow?.type === 'string' && workflow.type.trim()
        ? workflow.type.trim().toUpperCase()
        : OperationType.PIPELINE,
    operation_config: createOperationConfig({
      manifest,
      workflowName: workflow.name,
      triggerSource,
    }),
  });

  const actions = Array.isArray(workflow.actions) ? workflow.actions : [];
  for (const action of actions) {
    operation.createAction({
      id: action.id,
      type: action.type,
      function_name: getWorkflowActionFunctionName(action),
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
 * @param {Record<string, any>} activity - activity.
 * @returns {import('../resources/builds/function.js').default} - Result.
 */
function createManifestFunction(activity) {
  return new WharfieFunction({
    name: String(activity.name),
    entrypoint: activity.entrypoint,
    properties: {
      ...(Array.isArray(activity.external)
        ? { external: activity.external }
        : {}),
      ...(isPlainObject(activity.environmentVariables)
        ? { environmentVariables: activity.environmentVariables }
        : {}),
      ...(isPlainObject(activity.resources)
        ? { resources: activity.resources }
        : {}),
    },
  });
}

/**
 * @param {Record<string, any>} workflowContext - workflowContext.
 * @param {any} baseContext - baseContext.
 * @returns {Record<string, any>} - Result.
 */
function mergeExecutionContext(workflowContext, baseContext) {
  if (!isPlainObject(baseContext)) {
    return {
      workflow: workflowContext,
    };
  }

  const inheritedWorkflow = isPlainObject(baseContext.workflow)
    ? baseContext.workflow
    : {};

  return {
    ...baseContext,
    workflow: {
      ...inheritedWorkflow,
      ...workflowContext,
    },
  };
}

/**
 * @typedef AppOperationStartEvent
 * @property {number} attemptCount - attemptCount.
 */

/**
 * @typedef CreateAppOperationExecutorOptions
 * @property {any} manifest - manifest.
 * @property {Record<string, any>} [baseContext] - baseContext.
 * @property {(action: import('../lib/graph/action.js').default, details: AppOperationStartEvent) => void} [onActionStart] - onActionStart.
 */

/**
 * @param {CreateAppOperationExecutorOptions} options - options.
 * @returns {{ executeAction: (action: import('../lib/graph/action.js').default) => Promise<{ ok: boolean, outputs?: any }>, close: () => Promise<void> }} - Result.
 */
export function createAppOperationExecutor({
  manifest,
  baseContext = {},
  onActionStart,
}) {
  /** @type {Promise<{ resources: Record<string, any>, close: () => Promise<void> }> | null} */
  let appResourcesPromise = null;

  /**
   * @returns {Promise<{ resources: Record<string, any>, close: () => Promise<void> }>} - Result.
   */
  async function ensureAppResources() {
    if (appResourcesPromise) {
      return appResourcesPromise;
    }

    appResourcesPromise = createActorSystemResources(
      getManifestResources(manifest),
    );
    return appResourcesPromise;
  }

  /**
   * @param {import('../lib/graph/action.js').default} action - action.
   * @returns {Promise<{ ok: boolean, outputs?: any }>} - Result.
   */
  async function executeAction(action) {
    if (
      action.type === Action.Type.START ||
      action.type === Action.Type.FINISH
    ) {
      onActionStart?.(action, {
        attemptCount: Number(action.attempt_count || 0),
      });
      return { ok: true };
    }

    if (action.type !== Action.Type.INVOKE_FUNCTION) {
      throw new Error(
        `Unsupported action type '${action.type}' for app runs. Only START, FINISH, and INVOKE_FUNCTION are currently executable.`,
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

    const activity = findManifestActivity(manifest, action.function_name);
    if (!activity) {
      const availableActivities = getManifestActivityNames(manifest);
      throw new Error(
        `Activity '${action.function_name}' was not found in the app manifest. Available activities: ${
          availableActivities.length > 0
            ? availableActivities.join(', ')
            : '(none)'
        }`,
      );
    }

    const attemptCount = Number(action.attempt_count || 0) + 1;
    onActionStart?.(action, { attemptCount });

    const appResources = await ensureAppResources();
    const fn = createManifestFunction(activity);

    try {
      const outputs = await fn.fn(
        action.inputs ?? {},
        mergeExecutionContext(
          {
            resourceId: action.resource_id,
            operationId: action.operation_id,
            actionId: action.id,
            actionType: action.type,
            attemptCount,
            placement: action.placement,
          },
          baseContext,
        ),
        {
          baseResources: appResources.resources,
        },
      );

      return {
        ok: true,
        outputs,
      };
    } finally {
      await fn.closeRuntimeResources();
    }
  }

  return {
    executeAction,
    close: async () => {
      if (!appResourcesPromise) {
        return;
      }

      const appResources = await appResourcesPromise;
      await appResources.close();
      appResourcesPromise = null;
    },
  };
}

/**
 * @typedef {import('../lib/graph/runner.js').OperationRunnerStore & {
 *   putOperation: (operation: import('../lib/graph/operation.js').default) => Promise<void>
 * }} AppOperationStore
 */

/**
 * @typedef PersistAndRunAppOperationOptions
 * @property {AppOperationStore} store - store.
 * @property {any} manifest - manifest.
 * @property {import('../lib/graph/operation.js').default} operation - operation.
 * @property {Record<string, any>} [baseContext] - baseContext.
 * @property {(action: import('../lib/graph/action.js').default, details: AppOperationStartEvent) => void} [onActionStart] - onActionStart.
 */

/**
 * @param {PersistAndRunAppOperationOptions} options - options.
 * @returns {Promise<{ status: 'COMPLETED' | 'FAILED' | 'BLOCKED'; executedActionIds: string[]; failedActionIds: string[]; blockedActionIds: string[]; finalStatusByActionId: Record<string, string> }>} - Result.
 */
export async function persistAndRunAppOperation({
  store,
  manifest,
  operation,
  baseContext = {},
  onActionStart,
}) {
  const executor = createAppOperationExecutor({
    manifest,
    baseContext,
    onActionStart,
  });

  try {
    await store.putOperation(operation);
    return await runOperation({
      store,
      resourceId: operation.resource_id,
      operationId: operation.id,
      executeAction: executor.executeAction,
    });
  } finally {
    await executor.close();
  }
}
