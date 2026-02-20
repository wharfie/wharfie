import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { getAsset as nodeGetAsset, isSea as nodeIsSea } from 'node:sea';

export const TEMPLATES_ASSET_BASE =
  '<WHARFIE_BUILT_IN>/templates/project_structure_examples';
export const TEMPLATES_ASSET_MANIFEST_KEY = `${TEMPLATES_ASSET_BASE}/manifest.json`;

/**
 * @typedef SeaAssetProvider
 * @property {(name: string, encoding?: BufferEncoding) => any} getAsset
 * @property {() => boolean} isSea
 */

/**
 * @typedef TemplatesManifest
 * @property {string} baseKey
 * @property {string[]} files
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @param {unknown} asset
 * @returns {Buffer}
 */
function assetToBuffer(asset) {
  if (Buffer.isBuffer(asset)) return asset;

  if (typeof asset === 'string') {
    return Buffer.from(asset, 'utf8');
  }

  if (asset instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(asset));
  }

  if (ArrayBuffer.isView(asset)) {
    return Buffer.from(asset.buffer, asset.byteOffset, asset.byteLength);
  }

  throw new TypeError(`Unsupported SEA asset type: ${typeof asset}`);
}

/**
 * Normalize template relative paths from manifest to a safe, POSIX-style path.
 * @param {string} rel
 * @returns {string}
 */
function normalizeRelativePath(rel) {
  const posixRel = rel.replace(/\\/g, '/');
  if (!posixRel) throw new Error('Invalid template path: empty');
  if (posixRel.startsWith('/')) {
    throw new Error(`Invalid template path: ${rel}`);
  }

  const parts = posixRel.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new Error(`Invalid template path: ${rel}`);
    }
  }

  return posixRel;
}

/**
 * @returns {SeaAssetProvider}
 */
function defaultAssetProvider() {
  return {
    getAsset: nodeGetAsset,
    isSea: nodeIsSea,
  };
}

/**
 * @param {SeaAssetProvider} provider
 * @param {string} manifestKey
 * @returns {Promise<TemplatesManifest | null>}
 */
async function tryReadManifest(provider, manifestKey) {
  try {
    const raw = await provider.getAsset(manifestKey);
    const text = assetToBuffer(raw).toString('utf8');
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) return null;

    const baseKey =
      typeof parsed.baseKey === 'string' && parsed.baseKey.length > 0
        ? parsed.baseKey
        : TEMPLATES_ASSET_BASE;

    if (!Array.isArray(parsed.files)) return null;
    const files = parsed.files.filter((x) => typeof x === 'string');
    if (files.length === 0) return null;

    return { baseKey, files };
  } catch {
    return null;
  }
}

/**
 * @typedef ExtractTemplatesOptions
 * @property {string} destinationDir
 * @property {string} [diskSourceDir] - Templates source directory on disk (non-SEA fallback).
 * @property {SeaAssetProvider} [assetProvider]
 * @property {string} [assetManifestKey]
 */

/**
 * Extract Wharfie init templates into a destination directory.
 *
 * - When running under SEA and the manifest asset exists, reads files from SEA assets.
 * - Otherwise, falls back to copying from disk.
 *
 * @param {ExtractTemplatesOptions} options
 * @returns {Promise<{ mode: 'sea' | 'fs', filesWritten: number }>}
 */
export async function extractTemplates(options) {
  const {
    destinationDir,
    diskSourceDir,
    assetProvider = defaultAssetProvider(),
    assetManifestKey = TEMPLATES_ASSET_MANIFEST_KEY,
  } = options;

  if (!destinationDir) {
    throw new Error('extractTemplates: destinationDir is required');
  }

  const canUseSea =
    !!assetProvider &&
    typeof assetProvider.isSea === 'function' &&
    assetProvider.isSea() &&
    typeof assetProvider.getAsset === 'function';

  if (canUseSea) {
    const manifest = await tryReadManifest(assetProvider, assetManifestKey);

    if (manifest) {
      let filesWritten = 0;

      for (const rawRel of manifest.files) {
        const rel = normalizeRelativePath(rawRel);
        const assetKey = `${manifest.baseKey}/${rel}`;
        const raw = await assetProvider.getAsset(assetKey);
        const buf = assetToBuffer(raw);

        const outPath = path.join(destinationDir, ...rel.split('/'));
        await fsp.mkdir(path.dirname(outPath), { recursive: true });
        await fsp.writeFile(outPath, buf);
        filesWritten += 1;
      }

      return { mode: 'sea', filesWritten };
    }
  }

  if (!diskSourceDir) {
    throw new Error(
      'extractTemplates: diskSourceDir is required when SEA assets are unavailable',
    );
  }

  await fsp.cp(diskSourceDir, destinationDir, { recursive: true });
  return { mode: 'fs', filesWritten: 0 };
}
