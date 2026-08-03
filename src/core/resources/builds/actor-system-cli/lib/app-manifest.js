import { promises as fsp } from 'node:fs';

import { validateAppManifest } from '../../../../runtime/app-manifest.js';
import { readEmbeddedAppManifest } from '../../lib/app-manifest-asset.js';

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
 * @param {{ manifestFile?: string, manifest?: string }} [opts] - opts.
 * @returns {Promise<{ source: 'file' | 'inline', value: Record<string, any> } | undefined>} - Result.
 */
export async function loadProvidedAppManifest(opts = {}) {
  const manifestFile = opts.manifestFile;
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
 * @param {{ manifestFile?: string, manifest?: string }} [opts] - opts.
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
