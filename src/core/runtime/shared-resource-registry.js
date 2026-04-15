import { promises as fsp } from 'node:fs';
import path from 'node:path';

import paths from '../lib/paths.js';

export const SHARED_RESOURCE_REGISTRY_FILE_NAME = 'shared-resources.json';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {unknown} value - value.
 * @returns {unknown} - Result.
 */
function cloneJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item));
  }

  if (!isObjectRecord(value)) {
    return value;
  }

  return Object.keys(value).reduce((acc, key) => {
    acc[key] = cloneJson(value[key]);
    return acc;
  }, /** @type {Record<string, any>} */ ({}));
}

/**
 * @param {string | { registryPath?: string, configDir?: string } | undefined} [options] - options.
 * @returns {string} - Result.
 */
export function getSharedResourceRegistryPath(options = {}) {
  if (typeof options === 'string' && options.trim()) {
    return path.resolve(options);
  }

  const registryPath =
    isObjectRecord(options) &&
    typeof options.registryPath === 'string' &&
    options.registryPath.trim()
      ? options.registryPath.trim()
      : undefined;
  if (registryPath) {
    return path.resolve(registryPath);
  }

  const configDir =
    isObjectRecord(options) &&
    typeof options.configDir === 'string' &&
    options.configDir.trim()
      ? options.configDir.trim()
      : typeof process.env.CONFIG_DIR === 'string' &&
          process.env.CONFIG_DIR.trim()
        ? process.env.CONFIG_DIR.trim()
        : typeof paths.getConfigDir === 'function'
          ? paths.getConfigDir()
          : paths.config;

  return path.join(configDir, SHARED_RESOURCE_REGISTRY_FILE_NAME);
}

/**
 * @param {{ registryPath?: string, configDir?: string }} [options] - options.
 * @returns {Promise<Record<string, Record<string, any>>>} - Result.
 */
export async function readSharedResourceRegistry(options = {}) {
  const registryPath = getSharedResourceRegistryPath(options);

  try {
    const raw = await fsp.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    return isObjectRecord(parsed)
      ? /** @type {Record<string, Record<string, any>>} */ (parsed)
      : {};
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {};
    }
    throw error;
  }
}

/**
 * @param {{ registryPath?: string, configDir?: string }} [options] - options.
 * @returns {Promise<{ path: string, value: Record<string, Record<string, any>> }>} - Result.
 */
export async function loadSharedResourceRegistry(options = {}) {
  return {
    path: getSharedResourceRegistryPath(options),
    value: await readSharedResourceRegistry(options),
  };
}

/**
 * @param {string} kind - kind.
 * @param {string} refName - refName.
 * @param {{ registryPath?: string, configDir?: string }} [options] - options.
 * @returns {Promise<any>} - Result.
 */
export async function resolveSharedResourceRef(kind, refName, options = {}) {
  const registry = await readSharedResourceRegistry(options);
  const registryKind = registry[kind];
  if (!isObjectRecord(registryKind)) {
    throw new Error(
      `Shared resource ref '${kind}:${refName}' was not found in ${getSharedResourceRegistryPath(
        options,
      )}.`,
    );
  }

  const resolved = registryKind[refName];
  if (resolved === undefined) {
    throw new Error(
      `Shared resource ref '${kind}:${refName}' was not found in ${getSharedResourceRegistryPath(
        options,
      )}.`,
    );
  }

  return cloneJson(resolved);
}

/**
 * @param {any} resolved - resolved.
 * @param {Record<string, any>} override - override.
 * @returns {any} - Result.
 */
function mergeResolvedSpec(resolved, override) {
  const overrideWithoutRef = Object.keys(override).reduce((acc, key) => {
    if (key === 'ref') {
      return acc;
    }
    acc[key] = cloneJson(override[key]);
    return acc;
  }, /** @type {Record<string, any>} */ ({}));

  if (!isObjectRecord(resolved)) {
    return Object.keys(overrideWithoutRef).length > 0
      ? overrideWithoutRef
      : resolved;
  }

  const baseResolved = /** @type {Record<string, any>} */ (
    isObjectRecord(resolved) ? cloneJson(resolved) : {}
  );
  const merged = /** @type {Record<string, any>} */ ({
    ...baseResolved,
    ...overrideWithoutRef,
  });

  if (
    isObjectRecord(resolved.options) ||
    isObjectRecord(overrideWithoutRef.options)
  ) {
    merged.options = {
      ...(isObjectRecord(resolved.options) ? resolved.options : {}),
      ...(isObjectRecord(overrideWithoutRef.options)
        ? overrideWithoutRef.options
        : {}),
    };
  }

  return merged;
}

/**
 * @param {'db' | 'queue' | 'objectStorage'} kind - kind.
 * @param {any} spec - spec.
 * @param {{ registryPath?: string, configDir?: string }} [options] - options.
 * @returns {Promise<any>} - Result.
 */
export async function resolveSharedResourceSpec(kind, spec, options = {}) {
  if (
    !isObjectRecord(spec) ||
    typeof spec.ref !== 'string' ||
    !spec.ref.trim()
  ) {
    return spec;
  }

  const resolved = await resolveSharedResourceRef(
    kind,
    spec.ref.trim(),
    options,
  );
  return mergeResolvedSpec(resolved, spec);
}

/**
 * @param {{ db?: any, queue?: any, objectStorage?: any }} specs - specs.
 * @param {{ registryPath?: string, configDir?: string }} [options] - options.
 * @returns {Promise<{ db?: any, queue?: any, objectStorage?: any }>} - Result.
 */
export async function resolveSharedResourceRefs(specs = {}, options = {}) {
  if (!isObjectRecord(specs)) {
    return specs;
  }

  const resolvedSpecs = /** @type {Record<string, any>} */ ({ ...specs });

  for (const kind of /** @type {const} */ (['db', 'queue', 'objectStorage'])) {
    if (!Object.prototype.hasOwnProperty.call(specs, kind)) {
      continue;
    }

    resolvedSpecs[kind] = await resolveSharedResourceSpec(
      kind,
      specs[kind],
      options,
    );
  }

  return /** @type {{ db?: any, queue?: any, objectStorage?: any }} */ (
    resolvedSpecs
  );
}

export const resolveSharedResourceSpecs = resolveSharedResourceRefs;

export default {
  SHARED_RESOURCE_REGISTRY_FILE_NAME,
  getSharedResourceRegistryPath,
  readSharedResourceRegistry,
  loadSharedResourceRegistry,
  resolveSharedResourceRef,
  resolveSharedResourceSpec,
  resolveSharedResourceRefs,
  resolveSharedResourceSpecs,
};
