import { promises as fsp } from 'node:fs';

import { assertNoActivityEnvironmentVariables } from '../../lib/activity-environment.js';
import { readEmbeddedAppManifest } from '../../lib/app-manifest-asset.js';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
 * @param {{ manifestFile?: string, manifest_file?: string, manifest?: string }} [opts] - opts.
 * @returns {Promise<{ source: 'file' | 'inline' | 'env', value: any } | undefined>} - Result.
 */
export async function loadProvidedAppManifest(opts = {}) {
  const manifestFile = opts.manifestFile || opts.manifest_file;
  if (manifestFile) {
    const raw = await fsp.readFile(manifestFile, 'utf8');
    return {
      source: 'file',
      value: parseJson(raw, `manifest file '${manifestFile}'`),
    };
  }

  if (typeof opts.manifest === 'string' && opts.manifest.trim()) {
    return {
      source: 'inline',
      value: parseJson(opts.manifest, '--manifest JSON'),
    };
  }

  if (
    typeof process.env.WHARFIE_APP_MANIFEST === 'string' &&
    process.env.WHARFIE_APP_MANIFEST.trim()
  ) {
    return {
      source: 'env',
      value: parseJson(
        process.env.WHARFIE_APP_MANIFEST,
        'WHARFIE_APP_MANIFEST',
      ),
    };
  }

  return undefined;
}

/**
 * @param {unknown} error - error.
 * @returns {boolean} - Result.
 */
function isMissingEmbeddedManifestError(error) {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error);

  return (
    message.includes('only available inside a packaged SEA artifact') ||
    message.includes('was not found')
  );
}

/**
 * @param {{ manifestFile?: string, manifest_file?: string, manifest?: string }} [opts] - opts.
 * @param {{ assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [options] - options.
 * @returns {Promise<any | undefined>} - Result.
 */
export async function resolveAppManifest(opts = {}, options = {}) {
  const provided = await loadProvidedAppManifest(opts);
  if (provided) {
    return provided.value;
  }

  try {
    return await readEmbeddedAppManifest(options);
  } catch (error) {
    if (isMissingEmbeddedManifestError(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * @param {{ manifestFile?: string, manifest_file?: string, manifest?: string }} [opts] - opts.
 * @param {{ assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [options] - options.
 * @returns {Promise<any>} - Result.
 */
export async function requireAppManifest(opts = {}, options = {}) {
  const manifest = await resolveAppManifest(opts, options);
  if (manifest) {
    return manifest;
  }

  throw new Error(
    'No app manifest was provided and no embedded app manifest was available.',
  );
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestResources(manifest) {
  if (!isObjectRecord(manifest)) return {};

  const candidates = [
    manifest.capabilities,
    manifest.capabilities?.resources,
    manifest.resources,
  ];

  for (const candidate of candidates) {
    if (isObjectRecord(candidate)) {
      return candidate;
    }
  }

  return {};
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestActivities(manifest) {
  if (isObjectRecord(manifest?.activities)) {
    return Object.keys(manifest.activities).reduce((acc, name) => {
      const definition = manifest.activities[name];
      if (!isObjectRecord(definition)) {
        acc[name] = definition;
        return acc;
      }

      assertNoActivityEnvironmentVariables(
        definition.environmentVariables,
        name,
      );
      const normalized = { ...definition };
      delete normalized.environmentVariables;
      acc[name] = normalized;
      return acc;
    }, /** @type {Record<string, any>} */ ({}));
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

      assertNoActivityEnvironmentVariables(
        definition.environmentVariables,
        definition.name,
      );
      acc[definition.name] = {
        entrypoint: definition.entrypoint,
        ...(Array.isArray(definition.external)
          ? { external: definition.external }
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
 * @param {unknown} value - value.
 * @returns {string[]} - Result.
 */
function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce((acc, candidate) => {
    if (typeof candidate === 'string' && candidate.trim()) {
      acc.push(candidate.trim());
    }
    return acc;
  }, /** @type {string[]} */ ([]));
}

/**
 * @param {any} manifest - manifest.
 * @returns {string[]} - Result.
 */
export function getManifestPollQueueUrls(manifest) {
  if (!isObjectRecord(manifest)) return [];

  const candidates = [
    manifest.lambda?.pollQueueUrls,
    manifest.runtime?.lambda?.pollQueueUrls,
    manifest.services?.lambda?.pollQueueUrls,
    manifest.capabilities?.queue?.options?.pollQueueUrls,
    manifest.capabilities?.queue?.options?.queueUrls,
    manifest.resources?.queue?.options?.pollQueueUrls,
    manifest.resources?.queue?.options?.queueUrls,
  ];

  for (const candidate of candidates) {
    const values = normalizeStringArray(candidate);
    if (values.length > 0) {
      return values;
    }
  }

  return [];
}

/**
 * @param {any} manifest - manifest.
 * @returns {string | undefined} - Result.
 */
export function getManifestAppName(manifest) {
  if (!isObjectRecord(manifest?.app)) return undefined;
  return typeof manifest.app.name === 'string' && manifest.app.name.trim()
    ? manifest.app.name.trim()
    : undefined;
}

/**
 * @param {any} manifest - manifest.
 * @returns {any[]} - Result.
 */
export function getManifestFunctions(manifest) {
  const activities = getManifestActivities(manifest);
  return Object.keys(activities)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      name,
      ...activities[name],
    }));
}

/**
 * @param {any} manifest - manifest.
 * @returns {{ nodeVersion: string, platform: string, architecture: string, libc?: string } | undefined} - Result.
 */
export function getManifestPrimaryTarget(manifest) {
  const target = Array.isArray(manifest?.targets) ? manifest.targets[0] : null;
  if (!isObjectRecord(target)) return undefined;
  if (
    typeof target.nodeVersion !== 'string' ||
    typeof target.platform !== 'string' ||
    typeof target.architecture !== 'string'
  ) {
    return undefined;
  }

  return {
    nodeVersion: target.nodeVersion,
    platform: target.platform,
    architecture: target.architecture,
    ...(typeof target.libc === 'string' && target.libc
      ? { libc: target.libc }
      : {}),
  };
}

export default {
  getManifestActivities,
  getManifestAppName,
  getManifestFunctions,
  getManifestPollQueueUrls,
  getManifestPrimaryTarget,
  getManifestResources,
  loadProvidedAppManifest,
  requireAppManifest,
  resolveAppManifest,
};
