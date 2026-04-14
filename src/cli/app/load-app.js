import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ActorSystem from '../../core/resources/builds/actor-system.js';
import WharfieFunction from '../../core/resources/builds/function.js';
import { normalizeExternalDependencies } from '../../core/resources/builds/lib/resolve-externals.js';
import Action from '../../core/lib/graph/action.js';
import Operation from '../../core/lib/graph/operation.js';

/**
 * Wharfie v2 app loader + manifest compiler.
 *
 * Wharfie v2 apps are code-defined (no YAML). The CLI needs a strict contract so
 * it can:
 *  - locate the app entrypoint (`wharfie.app.js`)
 *  - load it (ESM)
 *  - derive a normalized internal runtime manifest
 *  - derive a normalized public manifest for `wharfie app manifest`
 */

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
 * @typedef ManifestCliDefinition
 * @property {string} entrypoint - entrypoint.
 * @property {string} [export] - export.
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
 * @typedef ManifestWorkflowDefinition
 * @property {string} name - name.
 * @property {string} type - type.
 * @property {ManifestWorkflowActionDefinition[]} actions - actions.
 */

/**
 * @typedef ManifestSchedulerTrigger
 * @property {string} actor - actor.
 * @property {string} cron - cron.
 */

/**
 * @typedef ManifestSchedulerDefinition
 * @property {ManifestSchedulerTrigger[]} triggers - triggers.
 */

/**
 * @typedef WharfieAppManifest
 * @property {{ name: string }} app - App metadata.
 * @property {ManifestCliDefinition} [cli] - Bundled app CLI entrypoint.
 * @property {Array<{ nodeVersion: string, platform: string, architecture: string, libc?: string }>} [targets] - Build targets, if provided.
 * @property {CapabilitySpecs} [capabilities] - Runtime capability specs (db/queue/objectStorage), if discoverable.
 * @property {CapabilitySpecs} [resources] - Alias for `capabilities`.
 * @property {ManifestFunctionDefinition[]} [functions] - Function definitions, if discoverable.
 * @property {ManifestWorkflowDefinition[]} [workflows] - Workflow definitions, if discoverable.
 * @property {ManifestSchedulerDefinition} [scheduler] - Scheduler trigger definitions, if discoverable.
 */

/**
 * @typedef PublicActivityDefinition
 * @property {string} entrypoint - entrypoint.
 * @property {string} [export] - export.
 * @property {{ name: string, version: string }[]} [external] - external.
 * @property {Record<string, string>} [environmentVariables] - environmentVariables.
 * @property {CapabilitySpecs} [resources] - Activity-scoped resources.
 */

/**
 * @typedef PublicWorkflowActionDefinition
 * @property {string} id - id.
 * @property {string} type - type.
 * @property {string} [activity] - activity.
 * @property {any} [inputs] - inputs.
 * @property {Record<string, any>} [placement] - placement.
 * @property {Record<string, any>} [retry] - retry.
 * @property {string[]} [dependsOn] - dependsOn.
 */

/**
 * @typedef PublicWorkflowDefinition
 * @property {string} name - name.
 * @property {string} type - type.
 * @property {PublicWorkflowActionDefinition[]} actions - actions.
 */

/**
 * @typedef PublicSchedulerTrigger
 * @property {string} activity - activity.
 * @property {string} cron - cron.
 */

/**
 * @typedef PublicSchedulerDefinition
 * @property {PublicSchedulerTrigger[]} triggers - triggers.
 */

/**
 * @typedef PublicWharfieAppManifest
 * @property {{ name: string }} app - App metadata.
 * @property {ManifestCliDefinition} [cli] - Bundled app CLI entrypoint.
 * @property {Array<{ nodeVersion: string, platform: string, architecture: string, libc?: string }>} [targets] - Build targets, if provided.
 * @property {CapabilitySpecs} [resources] - Runtime capability specs (db/queue/objectStorage), if discoverable.
 * @property {Record<string, PublicActivityDefinition>} [activities] - Activity definitions, if discoverable.
 * @property {PublicWorkflowDefinition[]} [workflows] - Workflow definitions, if discoverable.
 * @property {PublicSchedulerDefinition} [scheduler] - Scheduler trigger definitions, if discoverable.
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
    /** @type {Record<string, unknown>} */
    const cloned = {};

    for (const key of Object.keys(value).sort((left, right) =>
      left.localeCompare(right),
    )) {
      const child = value[key];
      if (typeof child === 'function' || child === undefined) continue;
      const normalized = jsonSafeClone(child);
      if (normalized !== undefined) {
        cloned[key] = normalized;
      }
    }

    return cloned;
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

  /** @type {Record<string, string>} */
  const normalized = {};
  for (const key of Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const candidate = value[key];
    if (
      candidate === null ||
      typeof candidate === 'undefined' ||
      typeof candidate === 'function' ||
      typeof candidate === 'symbol' ||
      (typeof candidate === 'object' && candidate !== null)
    ) {
      continue;
    }
    normalized[key] = String(candidate);
  }

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

  /** @type {CapabilitySpecs} */
  const picked = {};

  for (const key of ['db', 'queue', 'objectStorage']) {
    if (!(key in maybeSpecs)) continue;
    const serialized = serializeCapabilitySpec(
      /** @type {PlainObject} */ (maybeSpecs)[key],
    );
    if (serialized !== undefined) {
      // @ts-ignore - keyof narrowing is cumbersome in JSDoc mode.
      picked[key] = serialized;
    }
  }

  if (!picked.db && !picked.queue && !picked.objectStorage) return undefined;
  return picked;
}

/**
 * @param {unknown} targets - targets.
 * @returns {WharfieAppManifest['targets']} - Result.
 */
function normalizeTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return undefined;

  const normalized = targets.reduce(
    (/** @type {NonNullable<WharfieAppManifest['targets']>} */ acc, target) => {
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
    },
    [],
  );

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * @param {string} entrypointPath - entrypointPath.
 * @param {string} appDir - appDir.
 * @returns {string} - Result.
 */
function resolveEntrypointPath(entrypointPath, appDir) {
  return path.isAbsolute(entrypointPath)
    ? entrypointPath
    : path.resolve(appDir, entrypointPath);
}

/**
 * @param {unknown} cli - cli.
 * @param {string} appDir - appDir.
 * @returns {ManifestCliDefinition | undefined} - Result.
 */
function normalizeCliDefinition(cli, appDir) {
  if (typeof cli === 'string' && cli.trim()) {
    return { entrypoint: resolveEntrypointPath(cli.trim(), appDir) };
  }

  if (!isPlainObject(cli)) return undefined;

  const entrypointInput =
    typeof cli.entrypoint === 'string'
      ? cli.entrypoint
      : isPlainObject(cli.entrypoint) && typeof cli.entrypoint.path === 'string'
        ? cli.entrypoint.path
        : '';

  if (!entrypointInput || !entrypointInput.trim()) {
    return undefined;
  }

  const exportName =
    (typeof cli.export === 'string' && cli.export.trim()) ||
    (isPlainObject(cli.entrypoint) &&
      typeof cli.entrypoint.export === 'string' &&
      cli.entrypoint.export.trim()) ||
    '';

  return {
    entrypoint: resolveEntrypointPath(entrypointInput.trim(), appDir),
    ...(exportName ? { export: exportName } : {}),
  };
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
 * @returns {CapabilitySpecs | undefined} - Result.
 */
function firstCapabilityCandidate(candidates) {
  for (const candidate of candidates) {
    const normalized = pickCapabilitySpecs(candidate);
    if (normalized) return normalized;
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
 * @param {any} func - func.
 * @param {string} appDir - appDir.
 * @returns {ManifestFunctionDefinition | undefined} - Result.
 */
function serializeFunctionDefinition(func, appDir) {
  if (!func || typeof func !== 'object') return undefined;

  const name = typeof func.name === 'string' ? func.name : '';
  if (!name) return undefined;

  const properties = isPlainObject(func.properties) ? func.properties : {};
  const entrypoint = isPlainObject(func.entrypoint)
    ? func.entrypoint
    : isPlainObject(properties.entrypoint)
      ? properties.entrypoint
      : null;

  if (!entrypoint || typeof entrypoint.path !== 'string') {
    return undefined;
  }

  const entrypointPath = resolveEntrypointPath(entrypoint.path, appDir);

  const externalInput =
    properties.external ?? (Array.isArray(func.external) ? func.external : []);
  const external = normalizeExternalDependencies(externalInput, entrypointPath);

  const environmentVariables = normalizeEnvironmentVariables(
    properties.environmentVariables ?? func.environmentVariables,
  );
  const resources = pickCapabilitySpecs(properties.resources ?? func.resources);

  /** @type {ManifestFunctionDefinition} */
  const normalized = {
    name,
    entrypoint: {
      path: entrypointPath,
      ...(typeof entrypoint.export === 'string'
        ? { export: entrypoint.export }
        : {}),
    },
  };

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
 * @param {unknown} functions - functions.
 * @param {string} appDir - appDir.
 * @returns {ManifestFunctionDefinition[] | undefined} - Result.
 */
function normalizeFunctions(functions, appDir) {
  if (!Array.isArray(functions) || functions.length === 0) return undefined;

  const normalized = functions.reduce(
    (/** @type {ManifestFunctionDefinition[]} */ acc, func) => {
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
    },
    [],
  );

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * @param {unknown} value - value.
 * @returns {string[] | undefined} - Result.
 */
function normalizeWorkflowDependencies(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const dependencies = value.reduce(
    (/** @type {string[]} */ acc, dependency) => {
      if (typeof dependency !== 'string') return acc;
      const trimmed = dependency.trim();
      if (!trimmed || acc.includes(trimmed)) return acc;
      acc.push(trimmed);
      return acc;
    },
    [],
  );

  return dependencies.length > 0 ? dependencies : undefined;
}

/**
 * @param {unknown} action - action.
 * @returns {ManifestWorkflowActionDefinition | undefined} - Result.
 */
function normalizeInternalWorkflowAction(action) {
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

  const functionName =
    (typeof action.functionName === 'string' && action.functionName.trim()) ||
    (typeof action.function_name === 'string' && action.function_name.trim()) ||
    '';
  const dependsOn = normalizeWorkflowDependencies(
    action.dependsOn ?? action.dependencies ?? action.prerequisites,
  );
  const inputs = jsonSafeClone(action.inputs);
  const placement = jsonSafeClone(action.placement);
  const retry = jsonSafeClone(action.retry);

  /** @type {ManifestWorkflowActionDefinition} */
  const normalized = {
    id,
    type,
  };

  if (functionName) {
    normalized.functionName = functionName;
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
 * @param {string} [nameHint] - nameHint.
 * @returns {ManifestWorkflowDefinition | undefined} - Result.
 */
function normalizeInternalWorkflowDefinition(workflow, nameHint) {
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
    ? workflow.actions.reduce(
        (/** @type {ManifestWorkflowActionDefinition[]} */ acc, action) => {
          const normalized = normalizeInternalWorkflowAction(action);
          if (normalized) {
            acc.push(normalized);
          }
          return acc;
        },
        [],
      )
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
 * @returns {ManifestWorkflowDefinition[] | undefined} - Result.
 */
function normalizeInternalWorkflows(workflows) {
  if (Array.isArray(workflows)) {
    const normalized = workflows.reduce(
      (/** @type {ManifestWorkflowDefinition[]} */ acc, workflow) => {
        const serialized = normalizeInternalWorkflowDefinition(workflow);
        if (serialized) {
          acc.push(serialized);
        }
        return acc;
      },
      [],
    );
    return normalized.length > 0 ? normalized : undefined;
  }

  if (isPlainObject(workflows)) {
    const normalized = Object.keys(workflows)
      .sort((left, right) => left.localeCompare(right))
      .reduce((/** @type {ManifestWorkflowDefinition[]} */ acc, key) => {
        const serialized = normalizeInternalWorkflowDefinition(
          workflows[key],
          key,
        );
        if (serialized) {
          acc.push(serialized);
        }
        return acc;
      }, []);
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

/**
 * @param {unknown} scheduler - scheduler.
 * @returns {ManifestSchedulerDefinition | undefined} - Result.
 */
function normalizeInternalScheduler(scheduler) {
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
        const actor =
          typeof trigger.actor === 'string' && trigger.actor.trim()
            ? trigger.actor.trim()
            : typeof trigger.functionName === 'string' &&
                trigger.functionName.trim()
              ? trigger.functionName.trim()
              : '';
        const cron =
          typeof trigger.cron === 'string' && trigger.cron.trim()
            ? trigger.cron.trim()
            : '';
        if (!actor || !cron) return acc;
        acc.push({ actor, cron });
        return acc;
      }, /** @type {ManifestSchedulerTrigger[]} */ ([]))
    : [];

  return triggers.length > 0 ? { triggers } : undefined;
}

/**
 * @param {unknown} action - action.
 * @returns {PublicWorkflowActionDefinition | undefined} - Result.
 */
function normalizePublicWorkflowAction(action) {
  if (!isPlainObject(action)) return undefined;

  const id =
    (typeof action.id === 'string' && action.id.trim()) ||
    (typeof action.name === 'string' && action.name.trim()) ||
    '';
  if (!id) return undefined;

  if (
    (typeof action.functionName === 'string' && action.functionName.trim()) ||
    (typeof action.function_name === 'string' && action.function_name.trim())
  ) {
    throw new Error(
      'Plain-object workflow actions must use activity instead of functionName.',
    );
  }

  const activity =
    typeof action.activity === 'string' && action.activity.trim()
      ? action.activity.trim()
      : '';
  const rawType =
    typeof action.type === 'string' ? action.type.trim().toUpperCase() : '';
  const type = activity
    ? 'ACTIVITY'
    : rawType && Object.values(Action.Type).includes(rawType)
      ? rawType
      : '';

  if (!type) return undefined;

  const dependsOn = normalizeWorkflowDependencies(
    action.dependsOn ?? action.dependencies ?? action.prerequisites,
  );
  const inputs = jsonSafeClone(action.inputs);
  const placement = jsonSafeClone(action.placement);
  const retry = jsonSafeClone(action.retry);

  /** @type {PublicWorkflowActionDefinition} */
  const normalized = {
    id,
    type,
  };

  if (activity) {
    normalized.activity = activity;
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
 * @param {string} [nameHint] - nameHint.
 * @returns {PublicWorkflowDefinition | undefined} - Result.
 */
function normalizePublicWorkflowDefinition(workflow, nameHint) {
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
    ? workflow.actions.reduce(
        (/** @type {PublicWorkflowActionDefinition[]} */ acc, action) => {
          const normalized = normalizePublicWorkflowAction(action);
          if (normalized) {
            acc.push(normalized);
          }
          return acc;
        },
        [],
      )
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
 * @returns {PublicWorkflowDefinition[] | undefined} - Result.
 */
function normalizePublicWorkflows(workflows) {
  if (Array.isArray(workflows)) {
    const normalized = workflows.reduce(
      (/** @type {PublicWorkflowDefinition[]} */ acc, workflow) => {
        const serialized = normalizePublicWorkflowDefinition(workflow);
        if (serialized) {
          acc.push(serialized);
        }
        return acc;
      },
      [],
    );
    return normalized.length > 0 ? normalized : undefined;
  }

  if (isPlainObject(workflows)) {
    const normalized = Object.keys(workflows)
      .sort((left, right) => left.localeCompare(right))
      .reduce((/** @type {PublicWorkflowDefinition[]} */ acc, key) => {
        const serialized = normalizePublicWorkflowDefinition(
          workflows[key],
          key,
        );
        if (serialized) {
          acc.push(serialized);
        }
        return acc;
      }, []);
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

/**
 * @param {unknown} scheduler - scheduler.
 * @returns {PublicSchedulerDefinition | undefined} - Result.
 */
function normalizePublicScheduler(scheduler) {
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
        if (
          (typeof trigger.actor === 'string' && trigger.actor.trim()) ||
          (typeof trigger.functionName === 'string' &&
            trigger.functionName.trim())
        ) {
          throw new Error(
            'Plain-object scheduler triggers must use activity instead of actor/functionName.',
          );
        }

        const activity =
          typeof trigger.activity === 'string' && trigger.activity.trim()
            ? trigger.activity.trim()
            : '';
        const cron =
          typeof trigger.cron === 'string' && trigger.cron.trim()
            ? trigger.cron.trim()
            : '';
        if (!activity || !cron) return acc;
        acc.push({ activity, cron });
        return acc;
      }, /** @type {PublicSchedulerTrigger[]} */ ([]))
    : [];

  return triggers.length > 0 ? { triggers } : undefined;
}

/**
 * @param {unknown} activity - activity.
 * @param {string} name - name.
 * @param {string} appDir - appDir.
 * @returns {PublicActivityDefinition | undefined} - Result.
 */
function normalizePublicActivityDefinition(activity, name, appDir) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return undefined;

  let entrypointInput = '';
  let exportName = '';
  let externalInput = [];
  let environmentVariablesInput;
  let resourcesInput;

  if (typeof activity === 'string') {
    entrypointInput = activity;
  } else if (isPlainObject(activity)) {
    if (typeof activity.entrypoint === 'string') {
      entrypointInput = activity.entrypoint;
    } else if (
      isPlainObject(activity.entrypoint) &&
      typeof activity.entrypoint.path === 'string'
    ) {
      entrypointInput = activity.entrypoint.path;
      if (
        typeof activity.entrypoint.export === 'string' &&
        activity.entrypoint.export.trim()
      ) {
        exportName = activity.entrypoint.export.trim();
      }
    }

    if (typeof activity.export === 'string' && activity.export.trim()) {
      exportName = activity.export.trim();
    }

    if (Array.isArray(activity.external)) {
      externalInput = activity.external;
    }

    environmentVariablesInput = activity.environmentVariables;
    resourcesInput = activity.resources;
  }

  if (!entrypointInput || !entrypointInput.trim()) return undefined;

  const entrypoint = resolveEntrypointPath(entrypointInput.trim(), appDir);
  const external = normalizeExternalDependencies(externalInput, entrypoint);
  const environmentVariables = normalizeEnvironmentVariables(
    environmentVariablesInput,
  );
  const resources = pickCapabilitySpecs(resourcesInput);

  /** @type {PublicActivityDefinition} */
  const normalized = {
    entrypoint,
  };

  if (exportName) {
    normalized.export = exportName;
  }

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
 * @param {unknown} activities - activities.
 * @param {string} appDir - appDir.
 * @returns {Record<string, PublicActivityDefinition> | undefined} - Result.
 */
function normalizePublicActivities(activities, appDir) {
  if (!isPlainObject(activities)) return undefined;

  /** @type {Record<string, PublicActivityDefinition>} */
  const normalized = {};

  for (const name of Object.keys(activities).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const activity = normalizePublicActivityDefinition(
      activities[name],
      name,
      appDir,
    );
    if (activity) {
      normalized[name] = activity;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * @param {unknown[]} candidates - candidates.
 * @returns {boolean} - Result.
 */
function hasLegacyPlainObjectFunctions(candidates) {
  return candidates.some(
    (candidate) => Array.isArray(candidate) && candidate.length > 0,
  );
}

/**
 * @param {unknown} workflows - workflows.
 * @returns {boolean} - Result.
 */
function hasLegacyWorkflowFunctionNames(workflows) {
  if (Array.isArray(workflows)) {
    return workflows.some((workflow) =>
      hasLegacyWorkflowFunctionNames(workflow),
    );
  }

  if (isPlainObject(workflows)) {
    if (Array.isArray(workflows.actions)) {
      return workflows.actions.some((action) => {
        if (!isPlainObject(action)) return false;
        return Boolean(
          (typeof action.functionName === 'string' &&
            action.functionName.trim()) ||
          (typeof action.function_name === 'string' &&
            action.function_name.trim()),
        );
      });
    }

    return Object.values(workflows).some((workflow) =>
      hasLegacyWorkflowFunctionNames(workflow),
    );
  }

  return false;
}

/**
 * @param {unknown} scheduler - scheduler.
 * @returns {boolean} - Result.
 */
function hasLegacySchedulerActors(scheduler) {
  if (!isPlainObject(scheduler)) return false;
  if (!Array.isArray(scheduler.triggers)) return false;

  return scheduler.triggers.some((trigger) => {
    if (!isPlainObject(trigger)) return false;
    return Boolean(
      (typeof trigger.actor === 'string' && trigger.actor.trim()) ||
      (typeof trigger.functionName === 'string' && trigger.functionName.trim()),
    );
  });
}

/**
 * @param {PlainObject} appExport - appExport.
 * @returns {void}
 */
function assertPlainObjectV2Contract(appExport) {
  if (
    hasLegacyPlainObjectFunctions([
      appExport.functions,
      appExport.properties?.functions,
      appExport.app?.functions,
      appExport.app?.properties?.functions,
    ])
  ) {
    throw new Error(
      'Plain-object wharfie.app.js exports must use activities instead of functions.',
    );
  }

  if (
    [
      appExport.workflows,
      appExport.properties?.workflows,
      appExport.app?.workflows,
      appExport.app?.properties?.workflows,
    ].some((candidate) => hasLegacyWorkflowFunctionNames(candidate))
  ) {
    throw new Error(
      'Plain-object workflow actions must use activity instead of functionName.',
    );
  }

  if (
    [
      appExport.scheduler,
      appExport.properties?.scheduler,
      appExport.app?.scheduler,
      appExport.app?.properties?.scheduler,
    ].some((candidate) => hasLegacySchedulerActors(candidate))
  ) {
    throw new Error(
      'Plain-object scheduler triggers must use activity instead of actor/functionName.',
    );
  }
}

/**
 * @param {WharfieAppManifest} manifest - manifest.
 * @returns {PublicWharfieAppManifest} - Result.
 */
function derivePublicManifestFromInternalManifest(manifest) {
  /** @type {PublicWharfieAppManifest} */
  const publicManifest = {
    app: { name: manifest.app.name },
  };

  if (manifest.cli) {
    publicManifest.cli = /** @type {ManifestCliDefinition} */ (
      jsonSafeClone(manifest.cli)
    );
  }

  if (Array.isArray(manifest.targets) && manifest.targets.length > 0) {
    publicManifest.targets = normalizeTargets(manifest.targets);
  }

  const resources = pickCapabilitySpecs(
    manifest.resources ?? manifest.capabilities,
  );
  if (resources) {
    publicManifest.resources = resources;
  }

  if (Array.isArray(manifest.functions) && manifest.functions.length > 0) {
    /** @type {Record<string, PublicActivityDefinition>} */
    const activities = {};

    for (const func of [...manifest.functions].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      activities[func.name] = {
        entrypoint: func.entrypoint.path,
        ...(typeof func.entrypoint.export === 'string'
          ? { export: func.entrypoint.export }
          : {}),
        ...(Array.isArray(func.external) && func.external.length > 0
          ? {
              external: /** @type {{ name: string, version: string }[]} */ (
                jsonSafeClone(func.external)
              ),
            }
          : {}),
        ...(func.environmentVariables
          ? {
              environmentVariables: /** @type {Record<string, string>} */ (
                jsonSafeClone(func.environmentVariables)
              ),
            }
          : {}),
        ...(func.resources
          ? {
              resources: /** @type {CapabilitySpecs} */ (
                jsonSafeClone(func.resources)
              ),
            }
          : {}),
      };
    }

    publicManifest.activities = activities;
  }

  if (Array.isArray(manifest.workflows) && manifest.workflows.length > 0) {
    /** @type {PublicWorkflowDefinition[]} */
    const workflows = manifest.workflows.map((workflow) => {
      /** @type {PublicWorkflowActionDefinition[]} */
      const actions = workflow.actions.map((action) => {
        /** @type {PublicWorkflowActionDefinition} */
        const mappedAction = {
          id: action.id,
          type:
            action.type === Action.Type.INVOKE_FUNCTION && action.functionName
              ? 'ACTIVITY'
              : action.type,
        };

        if (
          action.type === Action.Type.INVOKE_FUNCTION &&
          action.functionName
        ) {
          mappedAction.activity = action.functionName;
        }

        if (action.inputs !== undefined) {
          mappedAction.inputs = jsonSafeClone(action.inputs);
        }

        if (action.placement) {
          mappedAction.placement = /** @type {Record<string, any>} */ (
            jsonSafeClone(action.placement)
          );
        }

        if (action.retry) {
          mappedAction.retry = /** @type {Record<string, any>} */ (
            jsonSafeClone(action.retry)
          );
        }

        if (action.dependsOn) {
          mappedAction.dependsOn = [...action.dependsOn];
        }

        return mappedAction;
      });

      return {
        name: workflow.name,
        type: workflow.type,
        actions,
      };
    });

    publicManifest.workflows = workflows;
  }

  if (manifest.scheduler?.triggers?.length) {
    publicManifest.scheduler = {
      triggers: manifest.scheduler.triggers.map((trigger) => ({
        activity: trigger.actor,
        cron: trigger.cron,
      })),
    };
  }

  return publicManifest;
}

/**
 * @param {PublicWharfieAppManifest} publicManifest - publicManifest.
 * @returns {WharfieAppManifest} - Result.
 */
function deriveInternalManifestFromPublicManifest(publicManifest) {
  /** @type {WharfieAppManifest} */
  const manifest = {
    app: { name: publicManifest.app.name },
  };

  if (publicManifest.cli) {
    manifest.cli = /** @type {ManifestCliDefinition} */ (
      jsonSafeClone(publicManifest.cli)
    );
  }

  if (
    Array.isArray(publicManifest.targets) &&
    publicManifest.targets.length > 0
  ) {
    manifest.targets = normalizeTargets(publicManifest.targets);
  }

  const resources = pickCapabilitySpecs(publicManifest.resources);
  if (resources) {
    manifest.resources = resources;
    manifest.capabilities = resources;
  }

  if (isPlainObject(publicManifest.activities)) {
    const activities = /** @type {Record<string, PublicActivityDefinition>} */ (
      publicManifest.activities
    );
    /** @type {ManifestFunctionDefinition[]} */
    const functions = Object.keys(activities)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => {
        const activity = activities[name];
        if (!activity) {
          throw new Error(`Public manifest activity '${name}' is undefined.`);
        }

        /** @type {ManifestFunctionDefinition} */
        const func = {
          name,
          entrypoint: {
            path: activity.entrypoint,
            ...(activity.export ? { export: activity.export } : {}),
          },
        };

        if (Array.isArray(activity.external) && activity.external.length > 0) {
          func.external = /** @type {{ name: string, version: string }[]} */ (
            jsonSafeClone(activity.external)
          );
        }

        if (activity.environmentVariables) {
          func.environmentVariables = /** @type {Record<string, string>} */ (
            jsonSafeClone(activity.environmentVariables)
          );
        }

        if (activity.resources) {
          func.resources = /** @type {CapabilitySpecs} */ (
            jsonSafeClone(activity.resources)
          );
        }

        return func;
      });

    manifest.functions = functions;
  }

  if (
    Array.isArray(publicManifest.workflows) &&
    publicManifest.workflows.length > 0
  ) {
    /** @type {ManifestWorkflowDefinition[]} */
    const workflows = publicManifest.workflows.map((workflow) => {
      /** @type {ManifestWorkflowActionDefinition[]} */
      const actions = workflow.actions.map((action) => {
        /** @type {ManifestWorkflowActionDefinition} */
        const mappedAction = {
          id: action.id,
          type:
            action.type === 'ACTIVITY' || action.activity
              ? Action.Type.INVOKE_FUNCTION
              : action.type,
        };

        if (action.activity) {
          mappedAction.functionName = action.activity;
        }

        if (action.inputs !== undefined) {
          mappedAction.inputs = jsonSafeClone(action.inputs);
        }

        if (action.placement) {
          mappedAction.placement = /** @type {Record<string, any>} */ (
            jsonSafeClone(action.placement)
          );
        }

        if (action.retry) {
          mappedAction.retry = /** @type {Record<string, any>} */ (
            jsonSafeClone(action.retry)
          );
        }

        if (action.dependsOn) {
          mappedAction.dependsOn = [...action.dependsOn];
        }

        return mappedAction;
      });

      return {
        name: workflow.name,
        type: workflow.type,
        actions,
      };
    });

    manifest.workflows = workflows;
  }

  if (publicManifest.scheduler?.triggers?.length) {
    manifest.scheduler = {
      triggers: publicManifest.scheduler.triggers.map((trigger) => ({
        actor: trigger.activity,
        cron: trigger.cron,
      })),
    };
  }

  return manifest;
}

/**
 * @param {ActorSystem} appExport - appExport.
 * @param {{ appDir: string }} options - options.
 * @returns {WharfieAppManifest} - Result.
 */
function compileInternalManifestFromActorSystem(appExport, options) {
  const { appDir } = options;
  const name = appExport.name;
  if (!name) {
    throw new Error('ActorSystem export is missing a name');
  }

  /** @type {WharfieAppManifest} */
  const manifest = { app: { name } };

  const cli = normalizeCliDefinition(
    firstObjectCandidate([
      appExport.get('cli', undefined),
      appExport.properties?.cli,
    ]),
    appDir,
  );
  if (cli) {
    manifest.cli = cli;
  }

  const targets = normalizeTargets(appExport.get('targets', []));
  if (targets) {
    manifest.targets = targets;
  }

  const resources = firstCapabilityCandidate([
    appExport.get('resources', {}),
    appExport.properties?.resources,
    appExport.properties?.capabilities,
  ]);
  if (resources) {
    manifest.capabilities = resources;
    manifest.resources = resources;
  }

  const functions = normalizeFunctions(appExport.functions, appDir);
  if (functions) {
    manifest.functions = functions;
  }

  const workflows = normalizeInternalWorkflows(
    firstWorkflowCandidate([
      appExport.get('workflows', []),
      appExport.properties?.workflows,
    ]),
  );
  if (workflows) {
    manifest.workflows = workflows;
  }

  const scheduler = normalizeInternalScheduler(
    firstObjectCandidate([
      appExport.get('scheduler', {}),
      appExport.properties?.scheduler,
    ]),
  );
  if (scheduler) {
    manifest.scheduler = scheduler;
  }

  return manifest;
}

/**
 * @param {PlainObject} appExport - appExport.
 * @param {{ appDir: string }} options - options.
 * @returns {PublicWharfieAppManifest} - Result.
 */
function compilePublicManifestFromPlainObject(appExport, options) {
  const { appDir } = options;

  assertPlainObjectV2Contract(appExport);

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

  /** @type {PublicWharfieAppManifest} */
  const publicManifest = {
    app: { name },
  };

  const cli = normalizeCliDefinition(
    appExport.cli ?? appExport.app?.cli,
    appDir,
  );
  if (cli) {
    publicManifest.cli = cli;
  }

  const targets = normalizeTargets(appExport.targets ?? appExport.app?.targets);
  if (targets) {
    publicManifest.targets = targets;
  }

  const resources = pickCapabilitySpecs(
    appExport.resources ?? appExport.app?.resources,
  );
  if (resources) {
    publicManifest.resources = resources;
  }

  const activities = normalizePublicActivities(
    appExport.activities ?? appExport.app?.activities,
    appDir,
  );
  if (activities) {
    publicManifest.activities = activities;
  }

  const workflows = normalizePublicWorkflows(
    appExport.workflows ?? appExport.app?.workflows,
  );
  if (workflows) {
    publicManifest.workflows = workflows;
  }

  const scheduler = normalizePublicScheduler(
    appExport.scheduler ?? appExport.app?.scheduler,
  );
  if (scheduler) {
    publicManifest.scheduler = scheduler;
  }

  return publicManifest;
}

/**
 * Compile manifests from a supported `wharfie.app.js` export.
 * @param {any} appExport - appExport.
 * @param {{ appDir: string }} options - options.
 * @returns {{ manifest: WharfieAppManifest, publicManifest: PublicWharfieAppManifest }} - Result.
 */
function compileManifests(appExport, options) {
  // --- Shape 1: ActorSystem instance ---
  if (appExport instanceof ActorSystem) {
    const manifest = compileInternalManifestFromActorSystem(appExport, options);
    const publicManifest = derivePublicManifestFromInternalManifest(manifest);
    return { manifest, publicManifest };
  }

  // --- Shape 2: plain object export ---
  if (isPlainObject(appExport)) {
    const publicManifest = compilePublicManifestFromPlainObject(
      appExport,
      options,
    );
    const manifest = deriveInternalManifestFromPublicManifest(publicManifest);
    return { manifest, publicManifest };
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
 * @returns {Promise<{ appExport: any, manifest: WharfieAppManifest, publicManifest: PublicWharfieAppManifest }>} - Result.
 */
export async function loadApp(options = {}) {
  const dir = options.dir ?? process.cwd();
  const appPath = path.resolve(dir, 'wharfie.app.js');

  try {
    await fsp.access(appPath);
  } catch (_err) {
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
