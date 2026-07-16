import { promises as fsp } from 'node:fs';

import { validateAppManifest } from '../../../../runtime/app-manifest.js';
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
 * @returns {Record<string, any>} - Validated canonical manifest.
 */
function parseManifestJson(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse ${label}: invalid JSON.`);
  }
  return validateAppManifest(parsed, label);
}

/**
 * @param {{ manifestFile?: string, manifest_file?: string, manifest?: string }} [opts] - opts.
 * @returns {Promise<{ source: 'file' | 'inline' | 'env', value: Record<string, any> } | undefined>} - Result.
 */
export async function loadProvidedAppManifest(opts = {}) {
  const manifestFile = opts.manifestFile || opts.manifest_file;
  if (manifestFile) {
    const raw = await fsp.readFile(manifestFile, 'utf8');
    return {
      source: 'file',
      value: parseManifestJson(raw, 'provided manifest'),
    };
  }

  if (typeof opts.manifest === 'string' && opts.manifest.trim()) {
    return {
      source: 'inline',
      value: parseManifestJson(opts.manifest, 'provided manifest'),
    };
  }

  if (
    typeof process.env.WHARFIE_APP_MANIFEST === 'string' &&
    process.env.WHARFIE_APP_MANIFEST.trim()
  ) {
    return {
      source: 'env',
      value: parseManifestJson(
        process.env.WHARFIE_APP_MANIFEST,
        'provided manifest',
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
 * @returns {Promise<Record<string, any> | undefined>} - Result.
 */
export async function resolveAppManifest(opts = {}, options = {}) {
  const provided = await loadProvidedAppManifest(opts);
  if (provided) return provided.value;

  try {
    return await readEmbeddedAppManifest(options);
  } catch (error) {
    if (isMissingEmbeddedManifestError(error)) return undefined;
    throw error;
  }
}

/**
 * @param {{ manifestFile?: string, manifest_file?: string, manifest?: string }} [opts] - opts.
 * @param {{ assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [options] - options.
 * @returns {Promise<Record<string, any>>} - Result.
 */
export async function requireAppManifest(opts = {}, options = {}) {
  const manifest = await resolveAppManifest(opts, options);
  if (manifest) return manifest;
  throw new Error(
    'No app manifest was provided and no embedded app manifest was available.',
  );
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestResources(manifest) {
  return isObjectRecord(manifest?.resources) ? manifest.resources : {};
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestActivities(manifest) {
  return isObjectRecord(manifest?.activities) ? manifest.activities : {};
}

/**
 * Runtime-only resource overrides can still provide poll queues. These fields
 * are deliberately not part of the serialized v2 application manifest.
 * @param {any} value - Runtime resource configuration.
 * @returns {string[]} - Result.
 */
export function getManifestPollQueueUrls(value) {
  const queueOptions =
    value?.resources?.queue?.options ?? value?.queue?.options;
  const candidate = queueOptions?.pollQueueUrls ?? queueOptions?.queueUrls;
  return Array.isArray(candidate)
    ? candidate.filter((item) => typeof item === 'string' && item.length > 0)
    : [];
}

/**
 * @param {any} manifest - manifest.
 * @returns {string | undefined} - Result.
 */
export function getManifestAppId(manifest) {
  return typeof manifest?.app?.id === 'string' ? manifest.app.id : undefined;
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
    ...(typeof target.libc === 'string' ? { libc: target.libc } : {}),
  };
}

export default {
  getManifestActivities,
  getManifestAppId,
  getManifestPollQueueUrls,
  getManifestPrimaryTarget,
  getManifestResources,
  loadProvidedAppManifest,
  requireAppManifest,
  resolveAppManifest,
};
