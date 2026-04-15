import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import Action from '../../core/lib/graph/action.js';
import Operation from '../../core/lib/graph/operation.js';
import ActorSystem from '../../core/resources/builds/actor-system.js';
import WharfieFunction from '../../core/resources/builds/function.js';
import { normalizeExternalDependencies } from '../../core/resources/builds/lib/resolve-externals.js';

/**
 * @typedef {Record<string, any>} PlainObject
 */

/**
 * @typedef CapabilitySpecs
 * @property {any} [db] - DB adapter spec / instance.
 * @property {any} [queue] - Queue adapter spec / instance.
 * @property {any} [objectStorage] - Object storage adapter spec / instance.
 */

/**
 * @typedef ManifestFunctionEntrypoint
 * @property {string} path - path.
 * @property {string} [export] - export.
 */

/**
 * @typedef ManifestFunctionDefinition
 * @property {string} name - name.
 * @property {ManifestFunctionEntrypoint} entrypoint - entrypoint.
 * @property {{ name: string, version: string }[]} [external] - external.
 * @property {Record<string, string>} [environmentVariables] - environmentVariables.
 * @property {CapabilitySpecs} [resources] - Function-scoped resources.
 */

/**
 * @typedef ManifestActivityDefinition
 * @property {ManifestFunctionEntrypoint} entrypoint - entrypoint.
 * @property {{ name: string, version: string }[]} [external] - external.
 * @property {Record<string, string>} [environmentVariables] - environmentVariables.
 * @property {CapabilitySpecs} [resources] - Activity-scoped resources.
 */

/**
 * @typedef ManifestWorkflowActionDefinition
 * @property {string} id - id.
 * @property {string} type - type.
 * @property {string} [functionName] - functionName.
 * @property {any} [inputs] - inputs.
 * @property {Record<string, any>} [placement] - placement.
 * @property {Record<string, any>} [retry] - retry.
 * @property {string[]} [dependsOn] - dependsOn.
 */

/**
 * @typedef ManifestPublicWorkflowActionDefinition
 * @property {string} id - id.
 * @property {string} type - type.
 * @property {string} [activity] - activity.
 * @property {any} [inputs] - inputs.
 * @property {Record<string, any>} [placement] - placement.
 * @property {Record<string, any>} [retry] - retry.
 * @property {string[]} [dependsOn] - dependsOn.
 */

/**
 * @typedef ManifestWorkflowDefinition
 * @property {string} name - name.
 * @property {string} type - type.
 * @property {ManifestWorkflowActionDefinition[]} actions - actions.
 */

/**
 * @typedef ManifestPublicWorkflowDefinition
 * @property {string} name - name.
 * @property {string} type - type.
 * @property {ManifestPublicWorkflowActionDefinition[]} actions - actions.
 */

/**
 * @typedef ManifestSchedulerTrigger
 * @property {string} actor - actor.
 * @property {string} cron - cron.
 */

/**
 * @typedef ManifestPublicSchedulerTrigger
 * @property {string} activity - activity.
 * @property {string} cron - cron.
 */

/**
 * @typedef ManifestSchedulerDefinition
 * @property {ManifestSchedulerTrigger[]} triggers - triggers.
 */

/**
 * @typedef ManifestPublicSchedulerDefinition
 * @property {ManifestPublicSchedulerTrigger[]} triggers - triggers.
 */

/**
 * @typedef WharfieAppManifest
 * @property {{ name: string }} app - App metadata.
 * @property {{ entrypoint: string }} [cli] - cli.
 * @property {Array<{ nodeVersion: string, platform: string, architecture: string, libc?: string }>} [targets] - Build targets, if provided.
 * @property {CapabilitySpecs} [capabilities] - Runtime capability specs (db/queue/objectStorage), if discoverable.
 * @property {CapabilitySpecs} [resources] - Alias for `capabilities` (kept for compatibility with existing ActorSystem terminology).
 * @property {ManifestFunctionDefinition[]} [functions] - Function definitions, if discoverable.
 * @property {ManifestWorkflowDefinition[]} [workflows] - Workflow definitions, if discoverable.
 * @property {ManifestSchedulerDefinition} [scheduler] - Scheduler trigger definitions, if discoverable.
 */

/**
 * @typedef WharfiePublicAppManifest
 * @property {{ name: string }} app - App metadata.
 * @property {{ entrypoint: string }} [cli] - cli.
 * @property {Array<{ nodeVersion: string, platform: string, architecture: string, libc?: string }>} [targets] - Build targets, if provided.
 * @property {CapabilitySpecs} [resources] - Runtime resource specs.
 * @property {Record<string, ManifestActivityDefinition>} [activities] - Activity definitions.
 * @property {ManifestPublicWorkflowDefinition[]} [workflows] - Workflow definitions.
 * @property {ManifestPublicSchedulerDefinition} [scheduler] - Scheduler trigger definitions.
 */

/**
 * @typedef LoadAppOptions
 * @property {string} [dir] - Directory to search for `wharfie.app.js` (default: cwd).
 * @property {string[]} [requestedTargetSelectors] - Optional canonical build-target selectors used to instantiate filtered ActorSystem exports.
 */

/**
 * @param {any} value - value.
 * @returns {value is PlainObject} - Result.
 */
function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {unknown} value - value.
 * @returns {unknown} - Result.
 */
function jsonSafeClone(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => jsonSafeClone(item))
      .filter((item) => item !== undefined);
  }

  if (value === null) return null;

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((acc, key) => {
        const child = value[key];
        if (typeof child === 'function' || child === undefined) {
          return acc;
        }
        const normalized = jsonSafeClone(child);
        if (normalized !== undefined) {
          acc[key] = normalized;
        }
        return acc;
      }, /** @type {Record<string, unknown>} */ ({}));
  }

  if (
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'undefined'
  ) {
    return undefined;
  }

  return value;
}

/**
 * @param {unknown} value - value.
 * @returns {Record<string, string> | undefined} - Result.
 */
function normalizeEnvironmentVariables(value) {
  if (!isPlainObject(value)) return undefined;

  const normalized = Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((acc, key) => {
      const candidate = value[key];
      if (
        candidate === null ||
        typeof candidate === 'undefined' ||
        typeof candidate === 'function' ||
        typeof candidate === 'symbol' ||
        (typeof candidate === 'object' && candidate !== null)
      ) {
        return acc;
      }
      acc[key] = String(candidate);
      return acc;
    }, /** @type {Record<string, string>} */ ({}));

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * @param {unknown} spec - spec.
 * @returns {any} - Result.
 */
function serializeCapabilitySpec(spec) {
  if (typeof spec === 'string') return spec;
  if (!isPlainObject(spec)) return undefined;

  const cloned = jsonSafeClone(spec);
  if (!isPlainObject(cloned) || Object.keys(cloned).length === 0) {
    return undefined;
  }

  return cloned;
}

/**
 * @param {unknown} maybeSpecs - maybeSpecs.
 * @returns {CapabilitySpecs | undefined} - Result.
 */
function pickCapabilitySpecs(maybeSpecs) {
  if (!isPlainObject(maybeSpecs)) return undefined;

  const picked = /** @type {CapabilitySpecs} */ ({});
  for (const key of ['db', 'queue', 'objectStorage']) {
    if (!(key in maybeSpecs)) continue;
    const serialized = serializeCapabilitySpec(maybeSpecs[key]);
    if (serialized !== undefined) {
      // @ts-ignore - JSDoc narrowing is cumbersome here.
      picked[key] = serialized;
    }
  }

  if (!picked.db && !picked.queue && !picked.objectStorage) return undefined;
  return picked;
}

/**
 * @param {unknown[]} candidates - candidates.
 * @returns {CapabilitySpecs | undefined} - Result.
 */
function firstCapabilityCandidate(candidates) {
  for (const candidate of candidates) {
    const normalized = pickCapabilitySpecs(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

/**
 * @param {unknown[]} candidates - candidates.
 * @returns {unknown[] | undefined} - Result.
 */
function firstArrayCandidate(candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * @param {unknown[]} candidates - candidates.
 * @returns {PlainObject | undefined} - Result.
 */
function firstObjectCandidate(candidates) {
  for (const candidate of candidates) {
    if (isPlainObject(candidate) && Object.keys(candidate).length > 0) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * @param {unknown[]} candidates - candidates.
 * @returns {unknown} - Result.
 */
function firstWorkflowCandidate(candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
    if (isPlainObject(candidate) && Object.keys(candidate).length > 0) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * @param {unknown[]} candidates - candidates.
 * @returns {string | undefined} - Result.
 */
function firstStringCandidate(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

/**
 * @param {unknown} targets - targets.
 * @returns {WharfieAppManifest['targets']} - Result.
 */
function normalizeTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return undefined;

  const normalized = targets.reduce((acc, target) => {
    if (!isPlainObject(target)) return acc;
    const nodeVersion = target.nodeVersion;
    const platform = target.platform;
    const architecture = target.architecture;
    if (
      typeof nodeVersion !== 'string' ||
      typeof platform !== 'string' ||
      typeof architecture !== 'string'
    ) {
      return acc;
    }

    acc.push({
      nodeVersion,
      platform,
      architecture,
      ...(typeof target.libc === 'string' ? { libc: target.libc } : {}),
    });
    return acc;
  }, /** @type {NonNullable<WharfieAppManifest['targets']>} */ ([]));

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * @param {unknown} candidate - candidate.
 * @param {string} appDir - appDir.
 * @returns {ManifestFunctionEntrypoint | undefined} - Result.
 */
function normalizeEntrypoint(candidate, appDir) {
  if (!isPlainObject(candidate) || typeof candidate.path !== 'string') {
    return undefined;
  }

  const entrypointPath = path.isAbsolute(candidate.path)
    ? candidate.path
    : path.resolve(appDir, candidate.path);

  return {
    path: entrypointPath,
    ...(typeof candidate.export === 'string'
      ? { export: candidate.export }
      : {}),
  };
}

/**
 * @param {any} func - func.
 * @param {string} appDir - appDir.
 * @param {string} [nameHint] - nameHint.
 * @returns {ManifestFunctionDefinition | undefined} - Result.
 */
function serializeFunctionDefinition(func, appDir, nameHint) {
  if (!func || typeof func !== 'object') return undefined;

  const inferredName =
    (typeof nameHint === 'string' && nameHint.trim()) ||
    (typeof func.name === 'string' ? func.name.trim() : '');
  if (!inferredName) return undefined;

  const properties = isPlainObject(func.properties) ? func.properties : {};
  const entrypoint = normalizeEntrypoint(
    isPlainObject(func.entrypoint)
      ? func.entrypoint
      : isPlainObject(properties.entrypoint)
        ? properties.entrypoint
        : undefined,
    appDir,
  );
  if (!entrypoint) {
    return undefined;
  }

  const externalInput =
    properties.external ?? (Array.isArray(func.external) ? func.external : []);
  const external = normalizeExternalDependencies(
    externalInput,
    entrypoint.path,
  );
  const environmentVariables = normalizeEnvironmentVariables(
    properties.environmentVariables ?? func.environmentVariables,
  );
  const resources = pickCapabilitySpecs(properties.resources ?? func.resources);

  const normalized = /** @type {ManifestFunctionDefinition} */ ({
    name: inferredName,
    entrypoint,
  });

  if (Array.isArray(external) && external.length > 0) {
    normalized.external = external;
  }
  if (environmentVariables) {
    normalized.environmentVariables = environmentVariables;
  }
  if (resources) {
    normalized.resources = resources;
  }

  return normalized;
}

/**
 * @param {ManifestFunctionDefinition} definition - definition.
 * @returns {ManifestActivityDefinition} - Result.
 */
function toActivityDefinition(definition) {
  return {
    entrypoint: definition.entrypoint,
    ...(Array.isArray(definition.external) && definition.external.length > 0
      ? { external: definition.external }
      : {}),
    ...(definition.environmentVariables
      ? { environmentVariables: definition.environmentVariables }
      : {}),
    ...(definition.resources ? { resources: definition.resources } : {}),
  };
}

/**
 * @param {ManifestWorkflowActionDefinition | ManifestPublicWorkflowActionDefinition} action - action.
 * @returns {string | undefined} - Result.
 */
function getWorkflowActionActivityName(action) {
  if (
    'activity' in action &&
    typeof action.activity === 'string' &&
    action.activity
  ) {
    return action.activity;
  }
  if (
    'functionName' in action &&
    typeof action.functionName === 'string' &&
    action.functionName
  ) {
    return action.functionName;
  }
  return undefined;
}

/**
 * @param {ManifestSchedulerTrigger | ManifestPublicSchedulerTrigger} trigger - trigger.
 * @returns {string | undefined} - Result.
 */
function getSchedulerTriggerActivityName(trigger) {
  if (
    'activity' in trigger &&
    typeof trigger.activity === 'string' &&
    trigger.activity
  ) {
    return trigger.activity;
  }
  if (
    'actor' in trigger &&
    typeof trigger.actor === 'string' &&
    trigger.actor
  ) {
    return trigger.actor;
  }
  return undefined;
}

/**
 * @param {unknown} functions - functions.
 * @param {string} appDir - appDir.
 * @returns {ManifestFunctionDefinition[] | undefined} - Result.
 */
function normalizeFunctions(functions, appDir) {
  if (!Array.isArray(functions) || functions.length === 0) return undefined;

  const normalized = functions.reduce((acc, func) => {
    if (
      !(func instanceof WharfieFunction) &&
      (!func || typeof func !== 'object')
    ) {
      return acc;
    }

    const serialized = serializeFunctionDefinition(func, appDir);
    if (serialized) {
      acc.push(serialized);
    }
    return acc;
  }, /** @type {ManifestFunctionDefinition[]} */ ([]));

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * @param {unknown} activities - activities.
 * @param {string} appDir - appDir.
 * @returns {Record<string, ManifestActivityDefinition> | undefined} - Result.
 */
function normalizeActivities(activities, appDir) {
  if (Array.isArray(activities)) {
    const normalized = activities.reduce((acc, activity) => {
      const serialized = serializeFunctionDefinition(activity, appDir);
      if (serialized) {
        acc[serialized.name] = toActivityDefinition(serialized);
      }
      return acc;
    }, /** @type {Record<string, ManifestActivityDefinition>} */ ({}));
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  if (!isPlainObject(activities)) {
    return undefined;
  }

  const normalized = Object.keys(activities)
    .sort((left, right) => left.localeCompare(right))
    .reduce((acc, key) => {
      const serialized = serializeFunctionDefinition(
        activities[key],
        appDir,
        key,
      );
      if (serialized) {
        acc[key] = toActivityDefinition(serialized);
      }
      return acc;
    }, /** @type {Record<string, ManifestActivityDefinition>} */ ({}));

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * @param {Record<string, ManifestActivityDefinition> | undefined} activities - activities.
 * @returns {ManifestFunctionDefinition[] | undefined} - Result.
 */
function activitiesToFunctions(activities) {
  if (!activities) return undefined;

  const functions = Object.keys(activities)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      name,
      ...activities[name],
    }));

  return functions.length > 0 ? functions : undefined;
}

/**
 * @param {unknown} value - value.
 * @returns {string[] | undefined} - Result.
 */
function normalizeWorkflowDependencies(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const dependencies = value.reduce((acc, dependency) => {
    if (typeof dependency !== 'string') return acc;
    const trimmed = dependency.trim();
    if (!trimmed || acc.includes(trimmed)) return acc;
    acc.push(trimmed);
    return acc;
  }, /** @type {string[]} */ ([]));

  return dependencies.length > 0 ? dependencies : undefined;
}

/**
 * @param {unknown} action - action.
 * @param {{ publicShape: boolean }} options - options.
 * @returns {ManifestWorkflowActionDefinition | ManifestPublicWorkflowActionDefinition | undefined} - Result.
 */
function normalizeWorkflowAction(action, options) {
  if (!isPlainObject(action)) return undefined;

  const id =
    (typeof action.id === 'string' && action.id.trim()) ||
    (typeof action.name === 'string' && action.name.trim()) ||
    '';
  const type =
    typeof action.type === 'string' ? action.type.trim().toUpperCase() : '';

  if (!id || !type || !Object.values(Action.Type).includes(type)) {
    return undefined;
  }

  const activityName =
    (typeof action.activity === 'string' && action.activity.trim()) ||
    (typeof action.functionName === 'string' && action.functionName.trim()) ||
    (typeof action.function_name === 'string' && action.function_name.trim()) ||
    (typeof action.actor === 'string' && action.actor.trim()) ||
    '';
  const dependsOn = normalizeWorkflowDependencies(
    action.dependsOn ?? action.dependencies ?? action.prerequisites,
  );
  const inputs = jsonSafeClone(action.inputs);
  const placement = jsonSafeClone(action.placement);
  const retry = jsonSafeClone(action.retry);

  const normalized =
    /** @type {ManifestWorkflowActionDefinition | ManifestPublicWorkflowActionDefinition} */ ({
      id,
      type,
    });

  if (activityName) {
    if (options.publicShape) {
      /** @type {ManifestPublicWorkflowActionDefinition} */ (
        normalized
      ).activity = activityName;
    } else {
      /** @type {ManifestWorkflowActionDefinition} */ (
        normalized
      ).functionName = activityName;
    }
  }

  if (inputs !== undefined) {
    normalized.inputs = inputs;
  }
  if (isPlainObject(placement) && Object.keys(placement).length > 0) {
    normalized.placement = /** @type {Record<string, any>} */ (placement);
  }
  if (isPlainObject(retry) && Object.keys(retry).length > 0) {
    normalized.retry = /** @type {Record<string, any>} */ (retry);
  }
  if (dependsOn) {
    normalized.dependsOn = dependsOn;
  }

  return normalized;
}

/**
 * @param {unknown} workflow - workflow.
 * @param {string | undefined} nameHint - nameHint.
 * @param {{ publicShape: boolean }} options - options.
 * @returns {ManifestWorkflowDefinition | ManifestPublicWorkflowDefinition | undefined} - Result.
 */
function normalizeWorkflowDefinition(workflow, nameHint, options) {
  if (!isPlainObject(workflow)) return undefined;

  const name =
    (typeof workflow.name === 'string' && workflow.name.trim()) ||
    (typeof nameHint === 'string' && nameHint.trim()) ||
    '';
  if (!name) return undefined;

  const typeCandidate =
    typeof workflow.type === 'string' && workflow.type.trim()
      ? workflow.type.trim().toUpperCase()
      : Operation.Type.PIPELINE;
  const type = Object.values(Operation.Type).includes(typeCandidate)
    ? typeCandidate
    : Operation.Type.PIPELINE;

  const actions = Array.isArray(workflow.actions)
    ? workflow.actions.reduce((acc, action) => {
        const normalized = normalizeWorkflowAction(action, options);
        if (normalized) {
          acc.push(normalized);
        }
        return acc;
      }, /** @type {(ManifestWorkflowActionDefinition | ManifestPublicWorkflowActionDefinition)[]} */ ([]))
    : [];

  if (actions.length === 0) return undefined;

  return {
    name,
    type,
    actions,
  };
}

/**
 * @param {unknown} workflows - workflows.
 * @param {{ publicShape: boolean }} options - options.
 * @returns {ManifestWorkflowDefinition[] | ManifestPublicWorkflowDefinition[] | undefined} - Result.
 */
function normalizeWorkflows(workflows, options) {
  if (Array.isArray(workflows)) {
    const normalized = workflows.reduce((acc, workflow) => {
      const serialized = normalizeWorkflowDefinition(
        workflow,
        undefined,
        options,
      );
      if (serialized) {
        acc.push(serialized);
      }
      return acc;
    }, /** @type {(ManifestWorkflowDefinition | ManifestPublicWorkflowDefinition)[]} */ ([]));
    return normalized.length > 0 ? normalized : undefined;
  }

  if (isPlainObject(workflows)) {
    const normalized = Object.keys(workflows)
      .sort((left, right) => left.localeCompare(right))
      .reduce((acc, key) => {
        const serialized = normalizeWorkflowDefinition(
          workflows[key],
          key,
          options,
        );
        if (serialized) {
          acc.push(serialized);
        }
        return acc;
      }, /** @type {(ManifestWorkflowDefinition | ManifestPublicWorkflowDefinition)[]} */ ([]));
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

/**
 * @param {unknown} scheduler - scheduler.
 * @param {{ publicShape: boolean }} options - options.
 * @returns {ManifestSchedulerDefinition | ManifestPublicSchedulerDefinition | undefined} - Result.
 */
function normalizeScheduler(scheduler, options) {
  if (!isPlainObject(scheduler) && !Array.isArray(scheduler)) {
    return undefined;
  }

  const cloned = jsonSafeClone(scheduler);
  if (!isPlainObject(cloned)) {
    return undefined;
  }

  const triggers = Array.isArray(cloned.triggers)
    ? cloned.triggers.reduce((acc, trigger) => {
        if (!isPlainObject(trigger)) return acc;

        const activityName =
          (typeof trigger.activity === 'string' && trigger.activity.trim()) ||
          (typeof trigger.actor === 'string' && trigger.actor.trim()) ||
          (typeof trigger.functionName === 'string' &&
          trigger.functionName.trim()
            ? trigger.functionName.trim()
            : '');
        const cron =
          typeof trigger.cron === 'string' && trigger.cron.trim()
            ? trigger.cron.trim()
            : '';
        if (!activityName || !cron) return acc;

        if (options.publicShape) {
          acc.push({ activity: activityName, cron });
        } else {
          acc.push({ actor: activityName, cron });
        }
        return acc;
      }, /** @type {(ManifestSchedulerTrigger | ManifestPublicSchedulerTrigger)[]} */ ([]))
    : [];

  return triggers.length > 0 ? { triggers } : undefined;
}

/**
 * @param {any} appExport - appExport.
 * @returns {void}
 */
function assertPlainObjectV2Contract(appExport) {
  const legacyFunctions = firstArrayCandidate([
    appExport.functions,
    appExport.properties?.functions,
    appExport.app?.functions,
    appExport.app?.properties?.functions,
  ]);

  if (legacyFunctions) {
    throw new Error(
      'Plain-object wharfie.app.js exports must use activities instead of functions.',
    );
  }

  const workflows = firstWorkflowCandidate([
    appExport.workflows,
    appExport.properties?.workflows,
    appExport.app?.workflows,
    appExport.app?.properties?.workflows,
  ]);

  const workflowDefinitions = Array.isArray(workflows)
    ? workflows
    : isPlainObject(workflows)
      ? Object.values(workflows)
      : [];
  for (const workflow of workflowDefinitions) {
    const actions = Array.isArray(workflow?.actions) ? workflow.actions : [];
    for (const action of actions) {
      if (
        isPlainObject(action) &&
        (typeof action.functionName === 'string' ||
          typeof action.function_name === 'string')
      ) {
        throw new Error(
          'Plain-object workflow actions must use activity instead of functionName.',
        );
      }
    }
  }

  const scheduler = firstObjectCandidate([
    appExport.scheduler,
    appExport.properties?.scheduler,
    appExport.app?.scheduler,
    appExport.app?.properties?.scheduler,
  ]);
  const triggers = Array.isArray(scheduler?.triggers) ? scheduler.triggers : [];
  for (const trigger of triggers) {
    if (
      isPlainObject(trigger) &&
      (typeof trigger.actor === 'string' ||
        typeof trigger.functionName === 'string')
    ) {
      throw new Error(
        'Plain-object scheduler triggers must use activity instead of actor/functionName.',
      );
    }
  }
}

/**
 * @param {any} appExport - appExport.
 * @returns {string} - Result.
 */
function resolveAppName(appExport) {
  const name =
    (isPlainObject(appExport.app) &&
      typeof appExport.app.name === 'string' &&
      appExport.app.name.trim()) ||
    (typeof appExport.name === 'string' && appExport.name.trim()) ||
    '';

  if (!name) {
    throw new Error(
      'Unsupported app export: expected { name } or { app: { name } }',
    );
  }

  return name;
}

/**
 * @param {any} appExport - appExport.
 * @param {string} appDir - appDir.
 * @returns {{ manifest: WharfieAppManifest, publicManifest: WharfiePublicAppManifest }} - Result.
 */
function compileActorSystemManifests(appExport, appDir) {
  const name = appExport.name;
  if (!name) {
    throw new Error('ActorSystem export is missing a name');
  }

  const targets = normalizeTargets(appExport.get('targets', []));
  const resources = firstCapabilityCandidate([
    appExport.get('resources', {}),
    appExport.properties?.resources,
    appExport.properties?.capabilities,
  ]);
  const functions = normalizeFunctions(appExport.functions, appDir);
  const workflows = normalizeWorkflows(
    firstWorkflowCandidate([
      appExport.get('workflows', []),
      appExport.properties?.workflows,
    ]),
    { publicShape: false },
  );
  const scheduler = normalizeScheduler(
    firstObjectCandidate([
      appExport.get('scheduler', {}),
      appExport.properties?.scheduler,
    ]),
    { publicShape: false },
  );
  const cliEntrypoint = firstStringCandidate([
    appExport.get('cli', {})?.entrypoint,
    appExport.properties?.cli?.entrypoint,
  ]);

  const manifest = /** @type {WharfieAppManifest} */ ({ app: { name } });
  if (cliEntrypoint) {
    manifest.cli = { entrypoint: path.resolve(appDir, cliEntrypoint) };
  }
  if (targets) {
    manifest.targets = targets;
  }
  if (resources) {
    manifest.resources = resources;
    manifest.capabilities = resources;
  }
  if (functions) {
    manifest.functions = functions;
  }
  if (workflows) {
    manifest.workflows = /** @type {ManifestWorkflowDefinition[]} */ (
      workflows
    );
  }
  if (scheduler) {
    manifest.scheduler = /** @type {ManifestSchedulerDefinition} */ (scheduler);
  }

  const activities = functions
    ? Object.keys(
        functions.reduce((acc, definition) => {
          acc[definition.name] = toActivityDefinition(definition);
          return acc;
        }, /** @type {Record<string, ManifestActivityDefinition>} */ ({})),
      )
        .sort((left, right) => left.localeCompare(right))
        .reduce((acc, name) => {
          const definition = functions.find(
            (candidate) => candidate.name === name,
          );
          if (definition) {
            acc[name] = toActivityDefinition(definition);
          }
          return acc;
        }, /** @type {Record<string, ManifestActivityDefinition>} */ ({}))
    : undefined;

  const publicManifest = /** @type {WharfiePublicAppManifest} */ ({
    app: { name },
  });
  if (manifest.cli) {
    publicManifest.cli = manifest.cli;
  }
  if (targets) {
    publicManifest.targets = targets;
  }
  if (resources) {
    publicManifest.resources = resources;
  }
  if (activities && Object.keys(activities).length > 0) {
    publicManifest.activities = activities;
  }
  if (workflows) {
    publicManifest.workflows =
      /** @type {ManifestPublicWorkflowDefinition[]} */ (
        workflows.map((workflow) => ({
          name: workflow.name,
          type: workflow.type,
          actions: workflow.actions.map((action) => ({
            id: action.id,
            type: action.type,
            ...(typeof getWorkflowActionActivityName(action) === 'string'
              ? { activity: getWorkflowActionActivityName(action) }
              : {}),
            ...(action.inputs !== undefined ? { inputs: action.inputs } : {}),
            ...(action.placement ? { placement: action.placement } : {}),
            ...(action.retry ? { retry: action.retry } : {}),
            ...(action.dependsOn ? { dependsOn: action.dependsOn } : {}),
          })),
        }))
      );
  }
  if (scheduler) {
    publicManifest.scheduler = {
      triggers: scheduler.triggers.map((trigger) => ({
        activity: getSchedulerTriggerActivityName(trigger) || '',
        cron: trigger.cron,
      })),
    };
  }

  return { manifest, publicManifest };
}

/**
 * @param {any} appExport - appExport.
 * @param {string} appDir - appDir.
 * @returns {{ manifest: WharfieAppManifest, publicManifest: WharfiePublicAppManifest }} - Result.
 */
function compilePlainObjectManifests(appExport, appDir) {
  assertPlainObjectV2Contract(appExport);

  const name = resolveAppName(appExport);
  const targets = normalizeTargets(
    firstArrayCandidate([
      appExport.targets,
      appExport.properties?.targets,
      appExport.app?.targets,
      appExport.app?.properties?.targets,
    ]),
  );
  const resources = firstCapabilityCandidate([
    appExport.resources,
    appExport.properties?.resources,
    appExport.app?.resources,
    appExport.app?.properties?.resources,
    appExport.capabilities,
    appExport.properties?.capabilities,
  ]);
  const cliEntrypoint = firstStringCandidate([
    appExport.cli?.entrypoint,
    appExport.properties?.cli?.entrypoint,
    appExport.app?.cli?.entrypoint,
    appExport.app?.properties?.cli?.entrypoint,
  ]);
  const activities = normalizeActivities(
    firstObjectCandidate([
      appExport.activities,
      appExport.properties?.activities,
      appExport.app?.activities,
      appExport.app?.properties?.activities,
    ]) ||
      firstArrayCandidate([
        appExport.activities,
        appExport.properties?.activities,
        appExport.app?.activities,
        appExport.app?.properties?.activities,
      ]),
    appDir,
  );
  const functions = activitiesToFunctions(activities);
  const workflows = normalizeWorkflows(
    firstWorkflowCandidate([
      appExport.workflows,
      appExport.properties?.workflows,
      appExport.app?.workflows,
      appExport.app?.properties?.workflows,
    ]),
    { publicShape: false },
  );
  const publicWorkflows = normalizeWorkflows(
    firstWorkflowCandidate([
      appExport.workflows,
      appExport.properties?.workflows,
      appExport.app?.workflows,
      appExport.app?.properties?.workflows,
    ]),
    { publicShape: true },
  );
  const scheduler = normalizeScheduler(
    firstObjectCandidate([
      appExport.scheduler,
      appExport.properties?.scheduler,
      appExport.app?.scheduler,
      appExport.app?.properties?.scheduler,
    ]),
    { publicShape: false },
  );
  const publicScheduler = normalizeScheduler(
    firstObjectCandidate([
      appExport.scheduler,
      appExport.properties?.scheduler,
      appExport.app?.scheduler,
      appExport.app?.properties?.scheduler,
    ]),
    { publicShape: true },
  );

  const manifest = /** @type {WharfieAppManifest} */ ({ app: { name } });
  if (cliEntrypoint) {
    manifest.cli = { entrypoint: path.resolve(appDir, cliEntrypoint) };
  }
  if (targets) {
    manifest.targets = targets;
  }
  if (resources) {
    manifest.resources = resources;
    manifest.capabilities = resources;
  }
  if (functions) {
    manifest.functions = functions;
  }
  if (workflows) {
    manifest.workflows = /** @type {ManifestWorkflowDefinition[]} */ (
      workflows
    );
  }
  if (scheduler) {
    manifest.scheduler = /** @type {ManifestSchedulerDefinition} */ (scheduler);
  }

  const publicManifest = /** @type {WharfiePublicAppManifest} */ ({
    app: { name },
  });
  if (cliEntrypoint) {
    publicManifest.cli = { entrypoint: path.resolve(appDir, cliEntrypoint) };
  }
  if (targets) {
    publicManifest.targets = targets;
  }
  if (resources) {
    publicManifest.resources = resources;
  }
  if (activities) {
    publicManifest.activities = activities;
  }
  if (publicWorkflows) {
    publicManifest.workflows =
      /** @type {ManifestPublicWorkflowDefinition[]} */ (publicWorkflows);
  }
  if (publicScheduler) {
    publicManifest.scheduler =
      /** @type {ManifestPublicSchedulerDefinition} */ (publicScheduler);
  }

  return { manifest, publicManifest };
}

/**
 * @param {any} appExport - appExport.
 * @param {{ appDir: string }} options - options.
 * @returns {{ manifest: WharfieAppManifest, publicManifest: WharfiePublicAppManifest }} - Result.
 */
function compileManifests(appExport, options) {
  const { appDir } = options;

  if (appExport instanceof ActorSystem) {
    return compileActorSystemManifests(appExport, appDir);
  }

  if (isPlainObject(appExport)) {
    return compilePlainObjectManifests(appExport, appDir);
  }

  throw new Error(
    `Unsupported app export type: ${typeof appExport}. Expected a plain object or ActorSystem instance.`,
  );
}

/**
 * @param {string} appPath - appPath.
 * @param {string[] | undefined} requestedTargetSelectors - requestedTargetSelectors.
 * @returns {string} - Result.
 */
function createFreshImportUrl(appPath, requestedTargetSelectors) {
  const fileUrl = pathToFileURL(appPath);
  const cacheBuster = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fileUrl.searchParams.set('wharfie-load', cacheBuster);

  if (
    Array.isArray(requestedTargetSelectors) &&
    requestedTargetSelectors.length > 0
  ) {
    fileUrl.searchParams.set(
      'wharfie-targets',
      requestedTargetSelectors.join(','),
    );
  }

  return fileUrl.href;
}

/**
 * Load `wharfie.app.js` from disk and compile manifests.
 * @param {LoadAppOptions} [options] - options.
 * @returns {Promise<{ appExport: any, manifest: WharfieAppManifest, publicManifest: WharfiePublicAppManifest }>} - Result.
 */
export async function loadApp(options = {}) {
  const dir = options.dir ?? process.cwd();
  const appPath = path.resolve(dir, 'wharfie.app.js');

  try {
    await fsp.access(appPath);
  } catch (_error) {
    throw new Error(`Could not find wharfie.app.js in: ${dir}`);
  }

  const importUrl = createFreshImportUrl(
    appPath,
    options.requestedTargetSelectors,
  );
  const mod = await ActorSystem.withRequestedBuildTargetSelectors(
    options.requestedTargetSelectors,
    async () => await import(importUrl),
  );

  const appExport = mod?.default ?? mod?.app ?? mod?.actorSystem;
  if (!appExport) {
    throw new Error(
      'wharfie.app.js did not export an app. Expected a default export.',
    );
  }

  const { manifest, publicManifest } = compileManifests(appExport, {
    appDir: dir,
  });
  return { appExport, manifest, publicManifest };
}

export default loadApp;
