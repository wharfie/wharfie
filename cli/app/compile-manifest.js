import ActorSystem from '../../lambdas/lib/actor/resources/builds/actor-system.js';
import { normalizeExternalDependencies } from '../../lambdas/lib/actor/resources/builds/lib/resolve-externals.js';

/**
 * @typedef {Record<string, any>} PlainObject
 */

/**
 * @typedef CapabilitySpecs
 * @property {any} [db] - DB adapter spec.
 * @property {any} [queue] - Queue adapter spec.
 * @property {any} [objectStorage] - Object storage adapter spec.
 */

/**
 * @typedef ManifestFunctionDefinition
 * @property {string} name - Function name.
 * @property {{ path: string, export?: string }} entrypoint - Function entrypoint.
 * @property {{ name: string, version: string }[]} [external] - Normalized external dependencies.
 * @property {Record<string, string>} [environmentVariables] - Environment variables.
 * @property {CapabilitySpecs} [resources] - Function-scoped runtime resources or specs.
 */

/**
 * @typedef WharfieAppManifest
 * @property {{ name: string }} app - App metadata.
 * @property {{ nodeVersion: string, platform: string, architecture: string, libc?: string }[]} [targets] - Build targets.
 * @property {CapabilitySpecs} [capabilities] - Runtime capability specs.
 * @property {CapabilitySpecs} [resources] - Alias for `capabilities`.
 * @property {ManifestFunctionDefinition[]} [functions] - App functions.
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
 * @param {any} value - value.
 * @returns {value is string} - Result.
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Convert a value into a JSON-safe clone.
 *
 * Rules:
 * - keep primitives/null
 * - recurse arrays and plain objects
 * - sort object keys for deterministic serialization
 * - drop functions, class instances, symbols, bigint, and undefined
 *
 * @param {any} value - value.
 * @returns {any} - Result.
 */
function toJsonSafeValue(value) {
  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => toJsonSafeValue(item))
      .filter((item) => item !== undefined);
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  /** @type {PlainObject} */
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const serialized = toJsonSafeValue(value[key]);
    if (serialized !== undefined) {
      out[key] = serialized;
    }
  }

  return out;
}

/**
 * @param {any} spec - spec.
 * @returns {any} - Result.
 */
function serializeResourceSpec(spec) {
  if (typeof spec === 'string') {
    const trimmed = spec.trim();
    return trimmed || undefined;
  }

  if (!isPlainObject(spec)) {
    return undefined;
  }

  const serialized = toJsonSafeValue(spec);
  if (!isPlainObject(serialized)) {
    return undefined;
  }

  if (Object.keys(serialized).length === 0 && Object.keys(spec).length > 0) {
    return undefined;
  }

  return serialized;
}

/**
 * @param {any} maybeSpecs - maybeSpecs.
 * @returns {CapabilitySpecs | undefined} - Result.
 */
function pickCapabilitySpecs(maybeSpecs) {
  if (!maybeSpecs || typeof maybeSpecs !== 'object') return undefined;

  /** @type {CapabilitySpecs} */
  const picked = {};

  const db = serializeResourceSpec(maybeSpecs.db);
  if (db !== undefined) picked.db = db;

  const queue = serializeResourceSpec(maybeSpecs.queue);
  if (queue !== undefined) picked.queue = queue;

  const objectStorage = serializeResourceSpec(maybeSpecs.objectStorage);
  if (objectStorage !== undefined) picked.objectStorage = objectStorage;

  if (!picked.db && !picked.queue && !picked.objectStorage) return undefined;
  return picked;
}

/**
 * @param {any} maybeEnv - maybeEnv.
 * @returns {Record<string, string> | undefined} - Result.
 */
function serializeEnvironmentVariables(maybeEnv) {
  if (!isPlainObject(maybeEnv)) return undefined;

  /** @type {Record<string, string>} */
  const env = {};
  for (const key of Object.keys(maybeEnv).sort()) {
    if (typeof maybeEnv[key] === 'string') {
      env[key] = maybeEnv[key];
    }
  }

  return Object.keys(env).length > 0 ? env : undefined;
}

/**
 * @param {any} value - value.
 * @returns {string | undefined} - Result.
 */
function resolveTargetPart(value) {
  const resolved = typeof value === 'function' ? value() : value;
  if (typeof resolved === 'string' && resolved) return resolved;
  if (typeof resolved === 'number' || typeof resolved === 'boolean') {
    return String(resolved);
  }
  return undefined;
}

/**
 * @param {any} target - target.
 * @returns {{ nodeVersion: string, platform: string, architecture: string, libc?: string } | undefined} - Result.
 */
function serializeTarget(target) {
  if (!target || typeof target !== 'object') return undefined;

  const nodeVersion = resolveTargetPart(target.nodeVersion);
  const platform = resolveTargetPart(target.platform);
  const architecture = resolveTargetPart(target.architecture);

  if (!nodeVersion || !platform || !architecture) {
    return undefined;
  }

  const libc = resolveTargetPart(target.libc);
  return {
    nodeVersion,
    platform,
    architecture,
    ...(libc ? { libc } : {}),
  };
}

/**
 * @param {any[]} candidates - candidates.
 * @returns {{ nodeVersion: string, platform: string, architecture: string, libc?: string }[] | undefined} - Result.
 */
function pickTargets(candidates) {
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    return candidate
      .map((target) => serializeTarget(target))
      .filter((target) => target !== undefined);
  }

  return undefined;
}

/**
 * @param {any} maybeEntrypoint - maybeEntrypoint.
 * @returns {{ path: string, export?: string } | undefined} - Result.
 */
function serializeEntrypoint(maybeEntrypoint) {
  if (
    !isPlainObject(maybeEntrypoint) ||
    !isNonEmptyString(maybeEntrypoint.path)
  ) {
    return undefined;
  }

  return {
    path: maybeEntrypoint.path,
    ...(isNonEmptyString(maybeEntrypoint.export)
      ? { export: maybeEntrypoint.export }
      : {}),
  };
}

/**
 * @param {any} maybeFunction - maybeFunction.
 * @returns {ManifestFunctionDefinition | undefined} - Result.
 */
function serializeFunctionDefinition(maybeFunction) {
  if (!maybeFunction || typeof maybeFunction !== 'object') return undefined;
  if (!isNonEmptyString(maybeFunction.name)) return undefined;

  const entrypoint = serializeEntrypoint(maybeFunction.entrypoint);
  if (!entrypoint) return undefined;

  const properties = isPlainObject(maybeFunction.properties)
    ? maybeFunction.properties
    : maybeFunction;

  const normalizedExternal = normalizeExternalDependencies(
    Array.isArray(properties.external) ? properties.external : undefined,
    entrypoint.path,
  );
  const environmentVariables = serializeEnvironmentVariables(
    properties.environmentVariables,
  );
  const resources = pickCapabilitySpecs(properties.resources);

  return {
    name: maybeFunction.name,
    entrypoint,
    ...(normalizedExternal?.length
      ? {
          external: normalizedExternal.map((dependency) => ({
            name: dependency.name,
            version: dependency.version,
          })),
        }
      : {}),
    ...(environmentVariables ? { environmentVariables } : {}),
    ...(resources ? { resources } : {}),
  };
}

/**
 * @param {any[]} candidates - candidates.
 * @returns {ManifestFunctionDefinition[] | undefined} - Result.
 */
function pickFunctions(candidates) {
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    const serialized = candidate
      .map((fn) => serializeFunctionDefinition(fn))
      .filter((fn) => fn !== undefined);

    return serialized.length > 0 ? serialized : undefined;
  }

  return undefined;
}

/**
 * Compile a JSON-safe manifest from a supported `wharfie.app.js` export.
 * @param {any} appExport - appExport.
 * @returns {WharfieAppManifest} - Result.
 */
export function compileManifest(appExport) {
  if (appExport instanceof ActorSystem) {
    const name = appExport.name;
    if (!name) {
      throw new Error('ActorSystem export is missing a name');
    }

    /** @type {WharfieAppManifest} */
    const manifest = { app: { name } };

    const targets = pickTargets([
      typeof appExport.has === 'function' && appExport.has('targets')
        ? appExport.get('targets')
        : undefined,
    ]);
    if (targets) {
      manifest.targets = targets;
    }

    const resources = pickCapabilitySpecs(
      typeof appExport.get === 'function' ? appExport.get('resources', {}) : {},
    );
    if (resources) {
      manifest.capabilities = resources;
      manifest.resources = resources;
    }

    const functions = pickFunctions([appExport.functions]);
    if (functions) {
      manifest.functions = functions;
    }

    return manifest;
  }

  if (isPlainObject(appExport)) {
    const name =
      (isPlainObject(appExport.app) &&
        isNonEmptyString(appExport.app.name) &&
        appExport.app.name) ||
      (isNonEmptyString(appExport.name) && appExport.name);

    if (!name) {
      throw new Error(
        'Unsupported app export: expected { name } or { app: { name } }',
      );
    }

    /** @type {WharfieAppManifest} */
    const manifest = { app: { name } };

    const targets = pickTargets([
      appExport.targets,
      appExport.properties?.targets,
      appExport.app?.targets,
      appExport.app?.properties?.targets,
    ]);
    if (targets) {
      manifest.targets = targets;
    }

    const resourceCandidates = [
      appExport.capabilities,
      appExport.capabilities?.resources,
      appExport.resources,
      appExport.properties?.resources,
      appExport.app?.capabilities,
      appExport.app?.capabilities?.resources,
      appExport.app?.resources,
      appExport.app?.properties?.resources,
    ];

    let discoveredResources;
    for (const candidate of resourceCandidates) {
      discoveredResources = pickCapabilitySpecs(candidate);
      if (discoveredResources) break;
    }

    if (discoveredResources) {
      manifest.capabilities = discoveredResources;
      manifest.resources = discoveredResources;
    }

    const functions = pickFunctions([
      appExport.functions,
      appExport.properties?.functions,
      appExport.app?.functions,
      appExport.app?.properties?.functions,
    ]);
    if (functions) {
      manifest.functions = functions;
    }

    return manifest;
  }

  throw new Error(
    `Unsupported app export type: ${typeof appExport}. Expected a plain object or ActorSystem instance.`,
  );
}

export default compileManifest;
