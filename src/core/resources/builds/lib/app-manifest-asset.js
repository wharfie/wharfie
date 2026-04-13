import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getAsset as nodeGetAsset,
  isSea as nodeIsSea,
} from '../../../lib/node-sea.js';

export const APP_MANIFEST_ASSET_NAME = '<WHARFIE_APP>/manifest.json';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, unknown>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value - value.
 * @returns {unknown} - Result.
 */
function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value === null) return null;

  if (isObjectRecord(value)) {
    /** @type {Record<string, unknown>} */
    const sorted = {};

    for (const key of Object.keys(value).sort((left, right) =>
      left.localeCompare(right),
    )) {
      const child = sortJsonValue(value[key]);
      if (child !== undefined) {
        sorted[key] = child;
      }
    }

    return sorted;
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
 * @param {unknown} manifest - manifest.
 * @param {{ pretty?: boolean }} [options] - options.
 * @returns {string} - Result.
 */
export function stringifyEmbeddedAppManifest(manifest, options = {}) {
  const pretty = options.pretty !== false;
  const normalized = sortJsonValue(manifest);
  return pretty
    ? JSON.stringify(normalized, null, 2)
    : JSON.stringify(normalized);
}

/**
 * @param {unknown} manifest - manifest.
 * @param {{ assetDir?: string }} [options] - options.
 * @returns {Promise<string>} - Result.
 */
export async function writeEmbeddedAppManifestAsset(manifest, options = {}) {
  const assetDir = path.resolve(
    options.assetDir || path.join(tmpdir(), 'wharfie-app-manifest-assets'),
  );
  await fsp.mkdir(assetDir, { recursive: true });

  const assetPath = path.join(assetDir, `${randomUUID()}.json`);
  await fsp.writeFile(
    assetPath,
    `${stringifyEmbeddedAppManifest(manifest, { pretty: true })}
`,
    'utf8',
  );
  return assetPath;
}

/**
 * @typedef EmbeddedManifestAssetProvider
 * @property {() => boolean} [isSea] - isSea.
 * @property {(name: string, encoding?: string) => any} getAsset - getAsset.
 */

/**
 * @param {{ assetProvider?: EmbeddedManifestAssetProvider }} [options] - options.
 * @returns {Promise<any>} - Result.
 */
export async function readEmbeddedAppManifest(options = {}) {
  const assetProvider =
    options.assetProvider ||
    /** @type {EmbeddedManifestAssetProvider} */ ({
      isSea: nodeIsSea,
      getAsset: nodeGetAsset,
    });

  if (typeof assetProvider.getAsset !== 'function') {
    throw new Error('Embedded app manifest asset provider is unavailable.');
  }

  if (
    !options.assetProvider &&
    typeof assetProvider.isSea === 'function' &&
    !assetProvider.isSea()
  ) {
    throw new Error(
      'Embedded app manifest is only available inside a packaged SEA artifact.',
    );
  }

  const rawAsset = await assetProvider.getAsset(APP_MANIFEST_ASSET_NAME);
  if (rawAsset == null) {
    throw new Error(
      `Embedded app manifest asset '${APP_MANIFEST_ASSET_NAME}' was not found.`,
    );
  }

  const text = Buffer.from(rawAsset).toString('utf8');
  return JSON.parse(text);
}

export default {
  APP_MANIFEST_ASSET_NAME,
  readEmbeddedAppManifest,
  stringifyEmbeddedAppManifest,
  writeEmbeddedAppManifestAsset,
};
