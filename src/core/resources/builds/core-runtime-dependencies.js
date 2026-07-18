import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { c } from 'tar';
import { v4 } from 'uuid';
import { buffer as streamToBuffer } from 'node:stream/consumers';

import paths from '../../lib/paths.js';
import { DEPENDENCY_LOCK_INPUT_FORMAT } from '../../runtime/application-revision.js';
import { sortCanonicalJsonValue } from '../../runtime/canonical-order.js';
import { sha256Base64Url } from '../../runtime/content-id.js';
import BuildResource from './build-resource.js';
import { installForTarget } from './lib/install-deps.js';
import {
  CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_ROOT,
  assertCoreRuntimeDependencyTargetSupported,
  stringifyCoreRuntimeDependencyManifest,
} from './lib/core-runtime-dependency-asset.js';

const CORE_LMDB_ROOT = CORE_RUNTIME_DEPENDENCY_ROOT;

/**
 * Resolve the source-tree lock only when a core dependency build is actually
 * requested. Packaged CommonJS/SEA bundles replace `import.meta.url` with a
 * filesystem string, which is not a valid URL base and must not be evaluated
 * while booting a runtime-only command.
 * @returns {string} - Absolute source lock path.
 */
function getCoreLmdbLockPath() {
  const moduleUrl = import.meta.url;
  if (typeof moduleUrl !== 'string' || !moduleUrl.startsWith('file:')) {
    throw new Error(
      'This packaged Wharfie runtime cannot resolve source core dependency build assets.',
    );
  }
  return fileURLToPath(
    new URL('./assets/core-lmdb.package-lock.json', moduleUrl),
  );
}

/**
 * @typedef CoreRuntimeDependenciesProperties
 * @property {import('../../runtime/build-target.js').BuildTarget | (() => import('../../runtime/build-target.js').BuildTarget)} buildTarget - Exact SEA target.
 * @property {Record<string, string>} [assets] - Reconciled reserved asset paths.
 * @property {Record<string, import('../../runtime/application-revision.js').Sha256Digest>} [assetDigests] - Reconciled exact asset digests.
 * @property {import('./lib/core-runtime-dependency-asset.js').CoreRuntimeDependencyManifest} [receipt] - Reconciled strict receipt.
 * @property {string} [assetDirectory] - Private directory retained until resource destruction.
 */

/**
 * @typedef CoreRuntimeDependenciesOptions
 * @property {string} name - Resource name.
 * @property {string} [parent] - Parent resource.
 * @property {import('../reconcilable.js').default.Status} [status] - Resource status.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - Prerequisite resources.
 * @property {CoreRuntimeDependenciesProperties & import('../../actors/typedefs.js').SharedProperties} properties - Resource properties.
 */

/**
 * Read the published core-lock snapshot and derive the same canonical lock
 * descriptor that frozen closures independently verify before resolving it.
 * @returns {Promise<{path: string, input: import('../../runtime/application-revision.js').LockedInputDescriptor}>} - Stable lock handle.
 */
async function getCoreLmdbDependencyLock() {
  const lockPath = getCoreLmdbLockPath();
  const bytes = await fsp.readFile(lockPath);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('The shipped core LMDB dependency lock is not valid JSON.');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    parsed.lockfileVersion !== 3
  ) {
    throw new Error(
      'The shipped core LMDB dependency lock must use package-lock v3.',
    );
  }
  const canonicalLock = JSON.stringify(sortCanonicalJsonValue(parsed));
  return {
    path: lockPath,
    input: {
      format: DEPENDENCY_LOCK_INPUT_FORMAT,
      digest: {
        algorithm: 'sha256',
        value: sha256Base64Url(canonicalLock),
      },
    },
  };
}

/**
 * Build the core-owned target closure required by a portable durable local
 * control store. This is intentionally a resource rather than an activity:
 * application dependency locks do not own Wharfie's runtime-native modules.
 */
class CoreRuntimeDependenciesResource extends BuildResource {
  /**
   * @param {CoreRuntimeDependenciesOptions} options - Resource options.
   */
  constructor({ name, parent, status, dependsOn, properties }) {
    super({
      name,
      parent,
      status,
      dependsOn,
      properties: Object.assign(
        {},
        CoreRuntimeDependenciesResource.DefaultProperties,
        properties,
      ),
    });
  }

  /**
   * @returns {Promise<void>} - Reconcile the immutable target closure.
   */
  async _reconcile() {
    const previousDirectory = this.has('assetDirectory')
      ? this.get('assetDirectory')
      : undefined;
    delete this.properties.assets;
    delete this.properties.assetDigests;
    delete this.properties.receipt;
    delete this.properties.assetDirectory;
    if (typeof previousDirectory === 'string' && previousDirectory) {
      await fsp.rm(previousDirectory, { force: true, recursive: true });
    }

    const target = assertCoreRuntimeDependencyTargetSupported(
      this.get('buildTarget'),
      'core runtime dependency build target',
    );
    const assetDirectory = join(
      CoreRuntimeDependenciesResource.BUILD_DIR,
      `core-runtime-dependencies-${v4()}`,
    );
    await fsp.mkdir(assetDirectory, { recursive: true, mode: 0o700 });
    await fsp.chmod(assetDirectory, 0o700);

    try {
      const dependencyLock = await getCoreLmdbDependencyLock();
      const closureDirectory = join(assetDirectory, 'closure');
      await fsp.mkdir(closureDirectory, { mode: 0o700 });
      const installed = await installForTarget({
        activity: 'core-local-control-store',
        buildTarget: target,
        dependencyLock,
        externals: [CORE_LMDB_ROOT],
        tmpBuildDir: closureDirectory,
      });
      if (!installed) {
        throw new Error('Core LMDB closure unexpectedly produced no receipt.');
      }
      const roots = installed.plan.roots;
      if (
        !Array.isArray(roots) ||
        roots.length !== 1 ||
        roots[0]?.name !== CORE_LMDB_ROOT.name ||
        roots[0]?.version !== CORE_LMDB_ROOT.version
      ) {
        throw new Error(
          'Core LMDB frozen closure roots do not match the local control-store contract.',
        );
      }

      const archiveBytes = await streamToBuffer(
        c(
          {
            cwd: closureDirectory,
            gzip: { level: 9 },
            portable: true,
            noMtime: true,
          },
          ['.'],
        ),
      );
      const archiveDigest = {
        algorithm: /** @type {'sha256'} */ ('sha256'),
        value: createHash('sha256').update(archiveBytes).digest('base64url'),
      };
      const receipt = {
        schemaVersion: /** @type {const} */ (1),
        kind: /** @type {const} */ ('coreRuntimeDependencyClosure'),
        purpose: /** @type {const} */ ('localControlStore'),
        target,
        roots: [{ ...CORE_LMDB_ROOT }],
        dependencyLockInput: installed.dependencyLockInput,
        closureDigest: installed.closureDigest,
        archive: {
          assetName: CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
          digest: archiveDigest,
        },
      };
      const manifestBytes = Buffer.from(
        `${stringifyCoreRuntimeDependencyManifest(receipt)}\n`,
        'utf8',
      );
      const manifestPath = join(assetDirectory, 'manifest.json');
      const archivePath = join(assetDirectory, 'local-control-store.tgz');
      await fsp.writeFile(manifestPath, manifestBytes, {
        flag: 'wx',
        mode: 0o400,
      });
      await fsp.writeFile(archivePath, archiveBytes, {
        flag: 'wx',
        mode: 0o400,
      });
      await fsp.chmod(manifestPath, 0o400);
      await fsp.chmod(archivePath, 0o400);

      this._setUNSAFE('assets', {
        [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: manifestPath,
        [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: archivePath,
      });
      this._setUNSAFE('assetDigests', {
        [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: {
          algorithm: 'sha256',
          value: createHash('sha256').update(manifestBytes).digest('base64url'),
        },
        [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: archiveDigest,
      });
      this._setUNSAFE('receipt', receipt);
      this._setUNSAFE('assetDirectory', assetDirectory);
    } catch (error) {
      await fsp.rm(assetDirectory, { force: true, recursive: true });
      throw error;
    }
  }

  /**
   * @returns {Promise<void>} - Remove retained private asset output.
   */
  async _destroy() {
    const assetDirectory = this.get('assetDirectory');
    if (typeof assetDirectory === 'string' && assetDirectory) {
      await fsp.rm(assetDirectory, { force: true, recursive: true });
    }
  }
}

CoreRuntimeDependenciesResource.DefaultProperties = {
  assets: {},
  assetDigests: {},
};
CoreRuntimeDependenciesResource.BUILD_DIR = join(paths.temp, 'builds');

export { CORE_LMDB_ROOT, getCoreLmdbDependencyLock };
export default CoreRuntimeDependenciesResource;
