import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getAsset as nodeGetAsset,
  isSea as nodeIsSea,
} from '../../../lib/node-sea.js';
import {
  stringifyAppManifest,
  validateAppManifest,
} from '../../../runtime/app-manifest.js';

export const APP_MANIFEST_ASSET_PREFIX = '<WHARFIE_APP>/';
export const APP_MANIFEST_ASSET_NAME = `${APP_MANIFEST_ASSET_PREFIX}manifest.json`;

/**
 * @param {unknown} manifest - manifest.
 * @param {{ pretty?: boolean }} [options] - options.
 * @returns {string} - Result.
 */
export function stringifyEmbeddedAppManifest(manifest, options = {}) {
  return stringifyAppManifest(manifest, {
    pretty: options.pretty,
    valuePath: 'embedded manifest',
  });
}

/**
 * @param {unknown} manifest - manifest.
 * @typedef EmbeddedAppManifestAsset
 * @property {string} path - Private temporary manifest path.
 * @property {() => Promise<void>} cleanup - Remove the temporary manifest.
 */

/**
 * Materialize an embedded manifest only for the lifetime of a SEA build.
 * Manifests describe artifact behavior and must not contain secrets, but the
 * temporary file is private as defense in depth.
 * @param {unknown} manifest - manifest.
 * @returns {Promise<EmbeddedAppManifestAsset>} - Temporary asset handle.
 */
export async function createEmbeddedAppManifestAsset(manifest) {
  const assetDir = await fsp.mkdtemp(
    path.join(tmpdir(), 'wharfie-app-manifest-'),
  );
  await fsp.chmod(assetDir, 0o700);

  const assetPath = path.join(assetDir, 'manifest.json');
  await fsp.writeFile(
    assetPath,
    `${stringifyEmbeddedAppManifest(manifest, { pretty: true })}
`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  return {
    path: assetPath,
    cleanup: async () => {
      await fsp.rm(assetDir, { force: true, recursive: true });
    },
  };
}

/**
 * @typedef EmbeddedManifestAssetProvider
 * @property {() => boolean} [isSea] - isSea.
 * @property {(name: string, encoding?: string) => any} getAsset - getAsset.
 */

/**
 * @param {{ assetProvider?: EmbeddedManifestAssetProvider }} [options] - options.
 * @returns {EmbeddedManifestAssetProvider} - Result.
 */
function resolveAssetProvider(options = {}) {
  const assetProvider =
    options.assetProvider ||
    /** @type {EmbeddedManifestAssetProvider} */ ({
      isSea: nodeIsSea,
      getAsset: nodeGetAsset,
    });

  if (typeof assetProvider.getAsset !== 'function') {
    throw new Error('Embedded app asset provider is unavailable.');
  }

  return assetProvider;
}

/**
 * @param {EmbeddedManifestAssetProvider} assetProvider - assetProvider.
 * @param {boolean} hasExplicitProvider - hasExplicitProvider.
 * @param {string} label - label.
 * @returns {void}
 */
function assertPackagedSeaAssetAccess(
  assetProvider,
  hasExplicitProvider,
  label,
) {
  if (
    !hasExplicitProvider &&
    typeof assetProvider.isSea === 'function' &&
    !assetProvider.isSea()
  ) {
    throw new Error(
      `Embedded app ${label} is only available inside a packaged SEA artifact.`,
    );
  }
}

/**
 * @param {{ assetProvider?: EmbeddedManifestAssetProvider }} [options] - options.
 * @returns {Promise<any>} - Result.
 */
export async function readEmbeddedAppManifest(options = {}) {
  const assetProvider = resolveAssetProvider(options);
  assertPackagedSeaAssetAccess(
    assetProvider,
    Boolean(options.assetProvider),
    'manifest',
  );

  const rawAsset = await assetProvider.getAsset(APP_MANIFEST_ASSET_NAME);
  if (rawAsset == null) {
    throw new Error(
      `Embedded app manifest asset '${APP_MANIFEST_ASSET_NAME}' was not found.`,
    );
  }

  const text = Buffer.from(rawAsset).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Embedded app manifest is not valid JSON.');
  }
  return validateAppManifest(parsed, 'embedded manifest');
}

export default {
  APP_MANIFEST_ASSET_PREFIX,
  APP_MANIFEST_ASSET_NAME,
  createEmbeddedAppManifestAsset,
  readEmbeddedAppManifest,
  stringifyEmbeddedAppManifest,
};
