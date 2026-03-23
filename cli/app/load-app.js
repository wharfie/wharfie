import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ActorSystem from '../../lambdas/lib/actor/resources/builds/actor-system.js';
import WharfieFunction from '../../lambdas/lib/actor/resources/builds/function.js';
import { normalizeExternalDependencies } from '../../lambdas/lib/actor/resources/builds/lib/resolve-externals.js';
import Action from '../../lambdas/lib/graph/action.js';
import Operation from '../../lambdas/lib/graph/operation.js';

/**
 * Wharfie v2 app loader + manifest compiler.
 *
 * Wharfie v2 apps are code-defined (no YAML). The CLI needs a strict contract so
 * it can:
 *  - locate the app entrypoint (`wharfie.app.js`)
 *  - load it (ESM)
 *  - derive a normalized JSON manifest that can be embedded into a build artifact
 *
 * Supported export shapes:
 *
 * 1) Plain object export
 *
 *    ```js
 *    export default {
 *      name: 'my-app',
 *      properties: {
 *        targets: [{ nodeVersion: '24', platform: 'linux', architecture: 'x64' }],
 *        resources: {
 *          db: { adapter: 'vanilla', options: { path: '.wharfie' } },
 *        },
 *      },
 *      functions: [new Function(...)],
 *    };
 *    ```
 *
 * 2) ActorSystem instance export
 *
 *    ```js
 *    import ActorSystem from '.../actor-system.js';
 *    export default new ActorSystem({ name: 'my-app', properties: { resources: { ... } } });
 *    ```
 *
 * For ActorSystem exports we only inspect properties and function/workflow definitions.
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
 * @property {Array<{ nodeVersion: string, platform: string, architecture: string, libc?: string }>} [targets] - Build targets, if provided.
 * @property {CapabilitySpecs} [capabilities] - Runtime capability specs (db/queue/objectStorage), if discoverable.
 * @property {CapabilitySpecs} [resources] - Alias for `capabilities` (kept for compatibility with existing ActorSystem terminology).
 * @property {ManifestFunctionDefinition[]} [functions] - Function definitions, if discoverable.
 * @property {ManifestWorkflowDefinition[]} [workflows] - Workflow definitions, if discoverable.
 * @property {ManifestSchedulerDefinition} [scheduler] - Scheduler trigger definitions, if discoverable.
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

  const entrypointPath = path.isAbsolute(entrypoint.path)
    ? entrypoint.path
    : path.resolve(appDir, entrypoint.path);

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
function normalizeWorkflowAction(action) {
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
function normalizeWorkflowDefinition(workflow, nameHint) {
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
          const normalized = normalizeWorkflowAction(action);
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
function normalizeWorkflows(workflows) {
  if (Array.isArray(workflows)) {
    const normalized = workflows.reduce(
      (/** @type {ManifestWorkflowDefinition[]} */ acc, workflow) => {
        const serialized = normalizeWorkflowDefinition(workflow);
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
        const serialized = normalizeWorkflowDefinition(workflows[key], key);
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
function normalizeScheduler(scheduler) {
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
 * Compile a manifest from a supported `wharfie.app.js` export.
 * @param {any} appExport - appExport.
 * @param {{ appDir: string }} options - options.
 * @returns {WharfieAppManifest} - Result.
 */
function compileManifest(appExport, options) {
  const { appDir } = options;

  // --- Shape 1: ActorSystem instance ---
  if (appExport instanceof ActorSystem) {
    const name = appExport.name;
    if (!name) {
      throw new Error('ActorSystem export is missing a name');
    }

    /** @type {WharfieAppManifest} */
    const manifest = { app: { name } };

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

    const workflows = normalizeWorkflows(
      firstWorkflowCandidate([
        appExport.get('workflows', []),
        appExport.properties?.workflows,
      ]),
    );
    if (workflows) {
      manifest.workflows = workflows;
    }

    const scheduler = normalizeScheduler(
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

  // --- Shape 2: plain object export ---
  if (isPlainObject(appExport)) {
    const name =
      (isPlainObject(appExport.app) &&
        typeof appExport.app.name === 'string' &&
        appExport.app.name) ||
      (typeof appExport.name === 'string' && appExport.name);

    if (!name) {
      throw new Error(
        'Unsupported app export: expected { name } or { app: { name } }',
      );
    }

    /** @type {WharfieAppManifest} */
    const manifest = { app: { name } };

    const targets = normalizeTargets(
      firstArrayCandidate([
        appExport.targets,
        appExport.properties?.targets,
        appExport.app?.targets,
        appExport.app?.properties?.targets,
      ]),
    );
    if (targets) {
      manifest.targets = targets;
    }

    const resources = firstCapabilityCandidate([
      appExport.capabilities,
      appExport.capabilities?.resources,
      appExport.resources,
      appExport.properties?.capabilities,
      appExport.properties?.capabilities?.resources,
      appExport.properties?.resources,
      appExport.app?.capabilities,
      appExport.app?.capabilities?.resources,
      appExport.app?.resources,
      appExport.app?.properties?.capabilities,
      appExport.app?.properties?.resources,
    ]);
    if (resources) {
      manifest.capabilities = resources;
      manifest.resources = resources;
    }

    const functions = normalizeFunctions(
      firstArrayCandidate([
        appExport.functions,
        appExport.properties?.functions,
        appExport.app?.functions,
        appExport.app?.properties?.functions,
      ]),
      appDir,
    );
    if (functions) {
      manifest.functions = functions;
    }

    const workflows = normalizeWorkflows(
      firstWorkflowCandidate([
        appExport.workflows,
        appExport.properties?.workflows,
        appExport.app?.workflows,
        appExport.app?.properties?.workflows,
      ]),
    );
    if (workflows) {
      manifest.workflows = workflows;
    }

    const scheduler = normalizeScheduler(
      firstObjectCandidate([
        appExport.scheduler,
        appExport.properties?.scheduler,
        appExport.app?.scheduler,
        appExport.app?.properties?.scheduler,
      ]),
    );
    if (scheduler) {
      manifest.scheduler = scheduler;
    }

    return manifest;
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
 * Load `wharfie.app.js` from disk and compile a manifest.
 * @param {LoadAppOptions} [options] - options.
 * @returns {Promise<{ appExport: any, manifest: WharfieAppManifest }>} - Result.
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

  const manifest = compileManifest(appExport, { appDir: dir });
  return { appExport, manifest };
}

export default loadApp;
