import path from 'node:path';
import { promises as fsp } from 'node:fs';

import paths from '../lib/paths.js';

export const SHARED_RESOURCE_REGISTRY_FILE_NAME = 'shared-resources.json';

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
 * @param {string} raw - raw.
 * @param {string} label - label.
 * @returns {any} - Result.
 */
function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
    throw new Error(`Failed to parse ${label}: ${message}`);
  }
}

/**
 * @param {unknown} value - value.
 * @returns {any} - Result.
 */
function cloneJsonValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cloneJsonValue(item))
      .filter((item) => item !== undefined);
  }

  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((acc, key) => {
      const cloned = cloneJsonValue(value[key]);
      if (cloned !== undefined) {
        acc[key] = cloned;
      }
      return acc;
    }, /** @type {Record<string, any>} */ ({}));
}

/**
 * @param {unknown} value - value.
 * @returns {value is { ref: string }} - Result.
 */
function isSharedResourceRef(value) {
  return (
    isPlainObject(value) && typeof value.ref === 'string' && !!value.ref.trim()
  );
}

/**
 * @param {{ configDir?: string }} [options] - options.
 * @returns {string} - Result.
 */
export function getSharedResourceRegistryPath(options = {}) {
  const configDir =
    typeof options.configDir === 'string' && options.configDir.trim()
      ? options.configDir.trim()
      : typeof paths.getConfigDir === 'function'
        ? paths.getConfigDir()
        : paths.config;

  return path.join(configDir, SHARED_RESOURCE_REGISTRY_FILE_NAME);
}

/**
 * @param {{ configDir?: string }} [options] - options.
 * @returns {Promise<{ path: string, value: Record<string, any> }>} - Result.
 */
export async function loadSharedResourceRegistry(options = {}) {
  const registryPath = getSharedResourceRegistryPath(options);

  let raw;
  try {
    raw = await fsp.readFile(registryPath, 'utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {
        path: registryPath,
        value: {},
      };
    }

    throw error;
  }

  const parsed = parseJson(raw, `shared resource registry '${registryPath}'`);
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse shared resource registry '${registryPath}': expected a JSON object.`,
    );
  }

  return {
    path: registryPath,
    value: parsed,
  };
}

/**
 * @param {'db'|'queue'|'objectStorage'} kind - kind.
 * @param {any} spec - spec.
 * @param {{ configDir?: string }} [options] - options.
 * @returns {Promise<any>} - Result.
 */
export async function resolveSharedResourceSpec(kind, spec, options = {}) {
  if (!isSharedResourceRef(spec)) {
    return spec;
  }

  if (Object.prototype.hasOwnProperty.call(spec, 'adapter')) {
    throw new Error(
      `Shared ${kind} ref '${spec.ref.trim()}' cannot also declare an adapter.`,
    );
  }

  const extraKeys = Object.keys(spec).filter((key) => key !== 'ref');
  if (extraKeys.length > 0) {
    throw new Error(
      `Shared ${kind} ref '${spec.ref.trim()}' does not support inline overrides: ${extraKeys.join(', ')}.`,
    );
  }

  const { path: registryPath, value: registry } =
    await loadSharedResourceRegistry(options);
  const resourceBucket = isPlainObject(registry[kind]) ? registry[kind] : {};
  const refName = spec.ref.trim();
  const resolved = resourceBucket[refName];

  if (resolved === undefined) {
    throw new Error(
      `Shared ${kind} ref '${refName}' was not found in ${registryPath}.`,
    );
  }

  if (isSharedResourceRef(resolved)) {
    throw new Error(
      `Shared ${kind} ref '${refName}' in ${registryPath} must resolve directly to an adapter spec, not another ref.`,
    );
  }

  const cloned = cloneJsonValue(resolved);
  if (cloned === undefined) {
    throw new Error(
      `Shared ${kind} ref '${refName}' in ${registryPath} must resolve to a string adapter name or JSON object.`,
    );
  }

  return cloned;
}

/**
 * @param {any} specs - specs.
 * @param {{ configDir?: string }} [options] - options.
 * @returns {Promise<any>} - Result.
 */
export async function resolveSharedResourceSpecs(specs, options = {}) {
  if (!isPlainObject(specs)) {
    return specs;
  }

  let hasChanges = false;
  const resolvedSpecs = { ...specs };

  for (const kind of ['db', 'queue', 'objectStorage']) {
    if (!Object.prototype.hasOwnProperty.call(specs, kind)) {
      continue;
    }

    const current = specs[kind];
    const resolved = await resolveSharedResourceSpec(
      /** @type {'db'|'queue'|'objectStorage'} */ (kind),
      current,
      options,
    );

    if (resolved !== current) {
      resolvedSpecs[kind] = resolved;
      hasChanges = true;
    }
  }

  return hasChanges ? resolvedSpecs : specs;
}

export default {
  SHARED_RESOURCE_REGISTRY_FILE_NAME,
  getSharedResourceRegistryPath,
  loadSharedResourceRegistry,
  resolveSharedResourceSpec,
  resolveSharedResourceSpecs,
};
