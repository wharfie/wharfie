import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createApplicationRevision,
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
} from '../../core/runtime/application-revision.js';
import { validateAppManifest } from '../../core/runtime/app-manifest.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from '../../core/runtime/canonical-order.js';
import { sha256Base64Url } from '../../core/runtime/content-id.js';
import { cloneJsonObject } from '../../core/runtime/json-value.js';
import { assertLogicalId } from '../../core/runtime/logical-id.js';
import { build as esbuild } from '../../core/lib/esbuild.js';

const compileApplicationRevisionMetaUrl =
  typeof import.meta.url === 'string' ? import.meta.url : '';
const compileApplicationRevisionFilePath =
  compileApplicationRevisionMetaUrl.startsWith('file:')
    ? fileURLToPath(compileApplicationRevisionMetaUrl)
    : compileApplicationRevisionMetaUrl;
const moduleDir =
  typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : path.dirname(compileApplicationRevisionFilePath);
const DEFAULT_WHARFIE_RUNTIME_ROOT = path.resolve(moduleDir, '../../..');
const SOURCE_ALWAYS_EXCLUDED_PATHS = new Set([
  '.wharfie',
  'coverage',
  'dist',
  'package-lock.json',
  'tmp',
  'wharfie.app.js',
]);
const ALWAYS_EXCLUDED_DIRECTORY_NAMES = new Set(['.git', 'node_modules']);
const PACKAGE_DEPENDENCY_KEYS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const SNAPSHOT_STATE_DIRECTORY = '.wharfie';
const SNAPSHOT_PARENT_DIRECTORY = 'revision-snapshots';
const WHARFIE_PACKAGE_NAME = '@wharfie/wharfie';

/**
 * @typedef Sha256Digest
 * @property {'sha256'} algorithm - Digest algorithm.
 * @property {string} value - Unpadded base64url SHA-256 value.
 */

/**
 * @typedef TreeEntry
 * @property {string} path - Canonical root-relative POSIX path.
 * @property {number} size - Exact byte length.
 * @property {Sha256Digest} digest - Exact file-byte digest.
 */

/**
 * @param {unknown} value - JSON value.
 * @returns {string} - Canonical compact JSON.
 */
function stringifyCanonicalJson(value) {
  return JSON.stringify(sortCanonicalJsonValue(value));
}

/**
 * @param {unknown} value - Value to digest.
 * @returns {Sha256Digest} - Named digest.
 */
function digestBytes(value) {
  return {
    algorithm: 'sha256',
    value: sha256Base64Url(
      /** @type {string | Buffer | Uint8Array | ArrayBuffer} */ (value),
    ),
  };
}

/**
 * @param {string} parentPath - Candidate parent.
 * @param {string} candidatePath - Candidate descendant.
 * @returns {boolean} - Whether candidate is contained by parent.
 */
function isWithin(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

/**
 * @param {string} value - Platform-native relative path.
 * @returns {string} - Canonical POSIX path.
 */
function toLogicalPath(value) {
  return value.split(path.sep).join('/');
}

/**
 * @param {import('node:fs').BigIntStats} left - First file snapshot.
 * @param {import('node:fs').BigIntStats} right - Second file snapshot.
 * @returns {boolean} - Whether both snapshots describe unchanged bytes.
 */
function hasStableFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/**
 * Read an exact byte count twice through one already opened descriptor.
 * @param {import('node:fs/promises').FileHandle} handle - Open file.
 * @param {number} size - Exact safe byte length.
 * @returns {Promise<Buffer>} - Stable bytes.
 */
async function readStableHandleBytes(handle, size) {
  /** @returns {Promise<Buffer>} One exact read pass. */
  async function readPass() {
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const result = await handle.read(bytes, offset, size - offset, offset);
      if (result.bytesRead === 0) {
        throw new Error('File changed while its revision snapshot was read.');
      }
      offset += result.bytesRead;
    }
    return bytes;
  }

  const first = await readPass();
  const second = await readPass();
  if (!first.equals(second)) {
    throw new Error('File changed while its revision snapshot was read.');
  }
  return first;
}

/**
 * Open without following a final symlink, read through one descriptor twice,
 * and reject metadata changes around the read. The returned bytes are safe to
 * copy into an immutable application snapshot.
 * @param {string} filePath - Source file path.
 * @param {string} valuePath - Human-readable path label.
 * @returns {Promise<Buffer>} - Stable exact bytes.
 */
async function readStableRegularFile(filePath, valuePath) {
  const noFollow =
    typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = await fsp.open(filePath, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    const message = error instanceof Error ? ` ${error.message}` : '';
    throw new TypeError(
      `${valuePath} must be a readable non-symbolic file.${message}`,
    );
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new TypeError(`${valuePath} must be a regular file.`);
    }
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError(`${valuePath} is too large to snapshot safely.`);
    }
    const bytes = await readStableHandleBytes(handle, Number(before.size));
    const after = await handle.stat({ bigint: true });
    if (!hasStableFileIdentity(before, after)) {
      throw new Error(`${valuePath} changed while it was being snapshotted.`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

/**
 * Walk one behavior tree without following symbolic links. Known dependency
 * stores are excluded because their exact resolution is represented by the
 * dependency lock instead of mutable installed bytes.
 * @param {string} rootPath - Tree root.
 * @param {{ excludedPaths?: Set<string>, includePath?: (logicalPath: string, kind: 'file'|'directory') => boolean }} [options] - Walk controls.
 * @returns {Promise<TreeEntry[]>} - Sorted immutable file descriptions.
 */
async function describeFileTree(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  const rootStat = await fsp.lstat(root);
  if (!rootStat.isDirectory()) {
    throw new TypeError(`Behavior tree root '${root}' must be a directory.`);
  }
  const realRoot = await fsp.realpath(root);
  const excludedPaths = options.excludedPaths || new Set();
  /** @type {TreeEntry[]} */
  const files = [];

  /**
   * @param {string} directoryPath - Absolute directory.
   * @param {string} relativeDirectory - Native relative directory.
   * @returns {Promise<void>}
   */
  async function walk(directoryPath, relativeDirectory) {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) =>
      compareCanonicalStrings(left.name, right.name),
    );

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, entry.name)
        : entry.name;
      const logicalPath = toLogicalPath(relativePath);
      if (excludedPaths.has(logicalPath)) continue;

      const absolutePath = path.join(directoryPath, entry.name);
      const stats = await fsp.lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new TypeError(
          `Behavior tree path '${logicalPath}' must not be a symbolic link.`,
        );
      }

      if (stats.isDirectory()) {
        if (ALWAYS_EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue;
        if (options.includePath?.(logicalPath, 'directory') === false) {
          continue;
        }
        const realDirectory = await fsp.realpath(absolutePath);
        if (!isWithin(realRoot, realDirectory)) {
          throw new TypeError(
            `Behavior tree directory '${logicalPath}' escapes its root.`,
          );
        }
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!stats.isFile()) {
        throw new TypeError(
          `Behavior tree path '${logicalPath}' must be a regular file or directory.`,
        );
      }
      if (options.includePath?.(logicalPath, 'file') === false) continue;

      const bytes = await readStableRegularFile(
        absolutePath,
        `Behavior tree path '${logicalPath}'`,
      );
      files.push({
        path: logicalPath,
        size: bytes.byteLength,
        digest: digestBytes(bytes),
      });
    }
  }

  await walk(root, '');
  files.sort((left, right) => compareCanonicalStrings(left.path, right.path));
  return files;
}

/**
 * Build the exact top-level and caller-specific source exclusions shared by
 * source hashing and immutable snapshot creation.
 * @param {string} appDir - Application root.
 * @param {{ outputDir?: string, assetPaths?: string[] }} [options] - Exclusion inputs.
 * @returns {Set<string>} - Canonical app-relative paths.
 */
function createSourceExcludedPaths(appDir, options = {}) {
  const root = path.resolve(appDir);
  const excludedPaths = new Set(SOURCE_ALWAYS_EXCLUDED_PATHS);
  const candidates = [
    ...(typeof options.outputDir === 'string' ? [options.outputDir] : []),
    ...(Array.isArray(options.assetPaths) ? options.assetPaths : []),
  ];

  for (const candidate of candidates) {
    const absolutePath = path.resolve(candidate);
    if (!isWithin(root, absolutePath)) continue;
    const relativePath = toLogicalPath(path.relative(root, absolutePath));
    if (relativePath) excludedPaths.add(relativePath);
  }
  return excludedPaths;
}

/**
 * @param {string} logicalPath - Canonical app-relative path.
 * @param {Set<string>} excludedPaths - Exact excluded files/directories.
 * @returns {boolean} - Whether the path is excluded by itself or an ancestor.
 */
function isSourcePathExcluded(logicalPath, excludedPaths) {
  for (const excludedPath of excludedPaths) {
    if (
      logicalPath === excludedPath ||
      logicalPath.startsWith(`${excludedPath}/`)
    ) {
      return true;
    }
  }
  return logicalPath
    .split('/')
    .some((segment) => ALWAYS_EXCLUDED_DIRECTORY_NAMES.has(segment));
}

/**
 * @param {Record<string, any>} manifest - Canonical app manifest.
 * @returns {{ valuePath: string, logicalPath: string, external: string[] }[]} - Entrypoints to audit.
 */
function getBehaviorEntrypoints(manifest) {
  const entries = [
    {
      valuePath: 'app.cli.entrypoint',
      logicalPath: String(manifest.cli.entrypoint.path),
      external: [],
    },
  ];
  for (const [activityName, activity] of Object.entries(
    manifest.activities || {},
  ).sort(([left], [right]) => compareCanonicalStrings(left, right))) {
    entries.push({
      valuePath: `app.activities.${activityName}.entrypoint`,
      logicalPath: String(activity.entrypoint.path),
      external: Array.isArray(activity.externalPackages)
        ? activity.externalPackages.flatMap(
            (/** @type {{name: string}} */ externalPackage) => [
              externalPackage.name,
              `${externalPackage.name}/*`,
            ],
          )
        : [],
    });
  }
  return entries;
}

/**
 * Reject contracts whose declared behavior starts in a mutable/generated path
 * that the revision source lock intentionally omits.
 * @param {Record<string, any>} manifest - Canonical app manifest.
 * @param {Set<string>} excludedPaths - Snapshot exclusions.
 */
function assertEntrypointsIncluded(manifest, excludedPaths) {
  for (const entrypoint of getBehaviorEntrypoints(manifest)) {
    if (isSourcePathExcluded(entrypoint.logicalPath, excludedPaths)) {
      throw new TypeError(
        `${entrypoint.valuePath}.path '${entrypoint.logicalPath}' is excluded from immutable application revisions. Move behavior source out of generated/state directories and named build assets.`,
      );
    }
  }
}

/**
 * Copy one behavior tree into a private snapshot from stable opened files.
 * Symlinks and special files fail closed.
 * @param {string} sourceRoot - Authored app root.
 * @param {string} destinationRoot - Empty snapshot app root.
 * @param {Set<string>} excludedPaths - Canonical exclusions.
 * @returns {Promise<void>}
 */
async function copyBehaviorTree(sourceRoot, destinationRoot, excludedPaths) {
  const realSourceRoot = await fsp.realpath(sourceRoot);
  await fsp.mkdir(destinationRoot, { mode: 0o700 });

  /**
   * @param {string} sourceDirectory - Current source directory.
   * @param {string} destinationDirectory - Current destination directory.
   * @param {string} relativeDirectory - Native relative directory.
   * @returns {Promise<void>}
   */
  async function copyDirectory(
    sourceDirectory,
    destinationDirectory,
    relativeDirectory,
  ) {
    const entries = await fsp.readdir(sourceDirectory, {
      withFileTypes: true,
    });
    entries.sort((left, right) =>
      compareCanonicalStrings(left.name, right.name),
    );

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, entry.name)
        : entry.name;
      const logicalPath = toLogicalPath(relativePath);
      if (isSourcePathExcluded(logicalPath, excludedPaths)) continue;

      const sourcePath = path.join(sourceDirectory, entry.name);
      const destinationPath = path.join(destinationDirectory, entry.name);
      const stats = await fsp.lstat(sourcePath);
      if (stats.isSymbolicLink()) {
        throw new TypeError(
          `Behavior tree path '${logicalPath}' must not be a symbolic link.`,
        );
      }
      if (stats.isDirectory()) {
        const realDirectory = await fsp.realpath(sourcePath);
        if (!isWithin(realSourceRoot, realDirectory)) {
          throw new TypeError(
            `Behavior tree directory '${logicalPath}' escapes its root.`,
          );
        }
        await fsp.mkdir(destinationPath, { mode: 0o700 });
        await copyDirectory(sourcePath, destinationPath, relativePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new TypeError(
          `Behavior tree path '${logicalPath}' must be a regular file or directory.`,
        );
      }
      const bytes = await readStableRegularFile(
        sourcePath,
        `Behavior tree path '${logicalPath}'`,
      );
      await fsp.writeFile(destinationPath, bytes, {
        flag: 'wx',
        mode: 0o600,
      });
    }
  }

  await copyDirectory(path.resolve(sourceRoot), destinationRoot, '');
}

/**
 * Audit the complete statically bundled module graph. Every bundled input must
 * come from the immutable app snapshot; Wharfie and declared target externals
 * remain external to this graph and are locked by other revision inputs.
 * @param {string} snapshotAppDir - Immutable app snapshot root.
 * @param {Record<string, any>} manifest - Canonical app manifest.
 * @returns {Promise<void>}
 */
async function auditBehaviorModuleGraph(snapshotAppDir, manifest) {
  for (const entrypoint of getBehaviorEntrypoints(manifest)) {
    let result;
    try {
      result = await esbuild({
        absWorkingDir: snapshotAppDir,
        entryPoints: [path.join(snapshotAppDir, entrypoint.logicalPath)],
        write: false,
        bundle: true,
        metafile: true,
        platform: 'node',
        format: 'esm',
        logLevel: 'silent',
        external: [
          WHARFIE_PACKAGE_NAME,
          `${WHARFIE_PACKAGE_NAME}/*`,
          ...entrypoint.external,
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new TypeError(
        `${entrypoint.valuePath} does not form a closed portable module graph: ${message}`,
      );
    }

    if (!result.metafile) {
      throw new Error(
        `${entrypoint.valuePath} module graph did not produce esbuild metadata.`,
      );
    }
    for (const inputPath of Object.keys(result.metafile.inputs)) {
      if (inputPath.startsWith('<')) continue;
      const absoluteInputPath = path.resolve(snapshotAppDir, inputPath);
      if (!isWithin(snapshotAppDir, absoluteInputPath)) {
        throw new TypeError(
          `${entrypoint.valuePath} bundles '${inputPath}' from outside the immutable app snapshot. Keep local modules inside the app, declare activity packages in externalPackages, and import Wharfie through '${WHARFIE_PACKAGE_NAME}/app'.`,
        );
      }
    }
  }
}

/**
 * Copy named behavior assets into the same private snapshot transaction.
 * @param {Record<string, string>} assets - Authored asset paths.
 * @param {string} snapshotRoot - Snapshot transaction root.
 * @returns {Promise<Record<string, string>>} - Snapshot asset paths.
 */
async function snapshotBehaviorAssets(assets, snapshotRoot) {
  const entries = Object.entries(assets || {}).sort(([left], [right]) =>
    compareCanonicalStrings(left, right),
  );
  if (entries.length === 0) return {};

  const assetsDir = path.join(snapshotRoot, 'assets');
  await fsp.mkdir(assetsDir, { mode: 0o700 });
  const snapshotted = /** @type {Record<string, string>} */ ({});
  for (const [name, assetPath] of entries) {
    assertLogicalId(name, `build.assets.${name}`);
    const bytes = await readStableRegularFile(
      assetPath,
      `Behavior asset '${name}'`,
    );
    const snapshotPath = path.join(assetsDir, name);
    await fsp.writeFile(snapshotPath, bytes, { flag: 'wx', mode: 0o600 });
    snapshotted[name] = snapshotPath;
  }
  return snapshotted;
}

/**
 * Seal regular files and directories against accidental mutation while a
 * package or durable source run consumes them.
 * @param {string} rootPath - Snapshot root.
 * @param {boolean} writable - Whether to make the tree removable again.
 * @returns {Promise<void>}
 */
async function setSnapshotTreeWritable(rootPath, writable) {
  const entries = await fsp.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (writable) await fsp.chmod(entryPath, 0o700);
      await setSnapshotTreeWritable(entryPath, writable);
      if (!writable) await fsp.chmod(entryPath, 0o500);
    } else {
      await fsp.chmod(entryPath, writable ? 0o600 : 0o400);
    }
  }
  await fsp.chmod(rootPath, writable ? 0o700 : 0o500);
}

/**
 * Remove a snapshot and opportunistically remove only empty Wharfie-owned
 * parent directories.
 * @param {string} snapshotRoot - Snapshot transaction root.
 * @param {string} snapshotParent - Wharfie snapshot parent.
 * @param {string} stateDirectory - App-local Wharfie state directory.
 * @returns {Promise<void>}
 */
async function cleanupApplicationSnapshot(
  snapshotRoot,
  snapshotParent,
  stateDirectory,
) {
  try {
    await setSnapshotTreeWritable(snapshotRoot, true);
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
  await fsp.rm(snapshotRoot, { force: true, recursive: true });
  for (const directory of [snapshotParent, stateDirectory]) {
    try {
      await fsp.rmdir(directory);
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String(error.code))
      ) {
        throw error;
      }
    }
  }
}

/**
 * @param {unknown} manifest - Canonical application manifest.
 * @returns {Record<string, any>} - Strict target-independent contract.
 */
export function getTargetIndependentAppContract(manifest) {
  const validated = validateAppManifest(manifest);
  const contract = { ...validated };
  delete contract.targets;
  return contract;
}

/**
 * @param {string} appDir - Application root.
 * @param {{ outputDir?: string, assetPaths?: string[] }} [options] - Exclusions represented by other revision inputs.
 * @returns {Promise<{ format: string, digest: Sha256Digest }>} - Source lock descriptor.
 */
export async function createSourceTreeInput(appDir, options = {}) {
  const root = path.resolve(appDir);
  const excludedPaths = createSourceExcludedPaths(root, options);

  const files = await describeFileTree(root, { excludedPaths });
  return {
    format: SOURCE_TREE_INPUT_FORMAT,
    digest: digestBytes(
      stringifyCanonicalJson({ format: SOURCE_TREE_INPUT_FORMAT, files }),
    ),
  };
}

/**
 * Find the npm lock governing an app, including an enclosing workspace lock.
 * @param {string} appDir - Application root.
 * @returns {Promise<string | undefined>} - Nearest package-lock path.
 */
async function findDependencyLockPath(appDir) {
  let current = path.resolve(appDir);
  while (true) {
    const candidate = path.join(current, 'package-lock.json');
    try {
      const stats = await fsp.stat(candidate);
      if (stats.isFile()) return candidate;
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * @param {string} appDir - Application root.
 * @returns {Promise<boolean>} - Whether package metadata declares dependencies.
 */
async function appPackageDeclaresDependencies(appDir) {
  const packagePath = path.join(path.resolve(appDir), 'package.json');
  let raw;
  try {
    raw = (
      await readStableRegularFile(packagePath, 'Application package.json')
    ).toString('utf8');
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError(`Application package.json is not valid JSON.`);
  }
  const packageValue = cloneJsonObject(parsed, 'application package.json');
  return PACKAGE_DEPENDENCY_KEYS.some((key) => {
    const value = packageValue[key];
    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0
    );
  });
}

/**
 * @param {Record<string, any>} contract - Target-free application contract.
 * @returns {{ name: string, version: string }[]} - Exact external requests.
 */
function getExternalPackageRequests(contract) {
  const requests = new Map();
  for (const activity of Object.values(contract.activities || {})) {
    for (const externalPackage of activity.externalPackages || []) {
      const previous = requests.get(externalPackage.name);
      if (previous && previous !== externalPackage.version) {
        throw new TypeError(
          `External package '${externalPackage.name}' is requested at conflicting versions.`,
        );
      }
      requests.set(externalPackage.name, externalPackage.version);
    }
  }
  return Array.from(requests, ([name, version]) => ({ name, version })).sort(
    (left, right) => compareCanonicalStrings(left.name, right.name),
  );
}

/**
 * @param {Record<string, any>} lock - Parsed npm lock.
 * @param {{ name: string, version: string }[]} requests - External requests.
 * @param {string} valuePath - Lock label.
 * @returns {void}
 */
function assertExternalPackagesLocked(lock, requests, valuePath) {
  const packages = lock.packages;
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new TypeError(`${valuePath}.packages must be an object.`);
  }
  for (const request of requests) {
    const packagePath = `node_modules/${request.name}`;
    const locked = packages[packagePath];
    if (
      !locked ||
      typeof locked !== 'object' ||
      Array.isArray(locked) ||
      locked.version !== request.version
    ) {
      throw new TypeError(
        `${valuePath}.packages[${JSON.stringify(packagePath)}] must lock exact external version '${request.version}'.`,
      );
    }
  }
}

/**
 * @param {string} appDir - Application root.
 * @param {Record<string, any>} contract - Target-free application contract.
 * @param {{ dependencyLockPath?: string | null }} [options] - Explicit lock override; null asserts no lock.
 * @returns {Promise<{ format: string, digest: Sha256Digest }>} - Dependency lock descriptor.
 */
export async function createDependencyLockInput(
  appDir,
  contract,
  options = {},
) {
  const externalRequests = getExternalPackageRequests(contract);
  const hasLockOverride = Object.prototype.hasOwnProperty.call(
    options,
    'dependencyLockPath',
  );
  const lockPath = hasLockOverride
    ? typeof options.dependencyLockPath === 'string'
      ? path.resolve(options.dependencyLockPath)
      : undefined
    : await findDependencyLockPath(appDir);

  if (!lockPath) {
    if (
      externalRequests.length > 0 ||
      (await appPackageDeclaresDependencies(appDir))
    ) {
      throw new TypeError(
        'Application dependencies require a package-lock.json with lockfileVersion 3.',
      );
    }

    const emptyLock = { lockfileVersion: 3, packages: {} };
    return {
      format: DEPENDENCY_LOCK_INPUT_FORMAT,
      digest: digestBytes(stringifyCanonicalJson(emptyLock)),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(
      (
        await readStableRegularFile(lockPath, `Dependency lock '${lockPath}'`)
      ).toString('utf8'),
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TypeError(`Dependency lock '${lockPath}' is not valid JSON.`);
    }
    throw error;
  }
  const lock = cloneJsonObject(parsed, `dependency lock '${lockPath}'`);
  if (lock.lockfileVersion !== 3) {
    throw new TypeError(
      `Dependency lock '${lockPath}' must use lockfileVersion 3.`,
    );
  }
  assertExternalPackagesLocked(
    lock,
    externalRequests,
    `dependency lock '${lockPath}'`,
  );
  return {
    format: DEPENDENCY_LOCK_INPUT_FORMAT,
    digest: digestBytes(stringifyCanonicalJson(lock)),
  };
}

/**
 * Lock the installed Wharfie interpreter and loader source. The file set is
 * explicit so repository-only docs/tests do not change application identity,
 * while an npm-packed installation and its source checkout hash alike.
 * @param {string} [runtimeRoot] - Wharfie package root.
 * @returns {Promise<{ format: string, digest: Sha256Digest }>} - Runtime lock descriptor.
 */
export async function createRuntimeInput(
  runtimeRoot = DEFAULT_WHARFIE_RUNTIME_ROOT,
) {
  const root = path.resolve(runtimeRoot);
  const files = await describeFileTree(root, {
    includePath: (logicalPath, kind) => {
      if (logicalPath === 'package.json' && kind === 'file') return true;
      if (logicalPath === 'src' || logicalPath.startsWith('src/')) return true;
      if (logicalPath === 'bin' && kind === 'directory') return true;
      if (logicalPath === 'bin/wharfie' && kind === 'file') return true;
      return false;
    },
  });
  if (files.length === 0) {
    throw new TypeError(
      `Wharfie runtime root '${root}' does not contain package runtime files.`,
    );
  }
  return {
    format: RUNTIME_INPUT_FORMAT,
    digest: digestBytes(
      stringifyCanonicalJson({ format: RUNTIME_INPUT_FORMAT, files }),
    ),
  };
}

/**
 * @param {Record<string, string>} assets - Logical asset name to absolute file path.
 * @returns {Promise<{ name: string, digest: Sha256Digest }[] | undefined>} - Canonical asset inputs.
 */
export async function createBehaviorAssetInputs(assets) {
  const entries = Object.entries(assets || {}).sort(([left], [right]) =>
    compareCanonicalStrings(left, right),
  );
  if (entries.length === 0) return undefined;

  return await Promise.all(
    entries.map(async ([name, assetPath]) => {
      assertLogicalId(name, `build.assets.${name}`);
      return {
        name,
        digest: digestBytes(
          await readStableRegularFile(assetPath, `Behavior asset '${name}'`),
        ),
      };
    }),
  );
}

/**
 * @typedef PreparedApplicationRevision
 * @property {import('../../core/runtime/application-revision.js').ApplicationRevision} revision - Immutable logical revision.
 * @property {string} appDir - Sealed source snapshot root consumed by execution/build.
 * @property {Record<string, any>} manifest - Canonical app manifest for the snapshot.
 * @property {Record<string, string>} assets - Sealed named behavior assets.
 * @property {() => Promise<void>} verifyRuntime - Recheck the live Wharfie runtime lock after consumption.
 * @property {() => Promise<void>} cleanup - Idempotently remove the snapshot.
 */

/**
 * Compare two named digest values.
 * @param {{ algorithm: string, value: string }} left - First digest.
 * @param {{ algorithm: string, value: string }} right - Second digest.
 * @returns {boolean} - Whether both digest identities match.
 */
function hasSameDigest(left, right) {
  return left.algorithm === right.algorithm && left.value === right.value;
}

/**
 * Prepare one immutable source/asset snapshot and derive its logical revision.
 * Both packaging and durable source execution must consume the returned paths,
 * never the mutable authored tree used to create them.
 * @param {{ appDir: string, manifest: unknown, outputDir?: string, assets?: Record<string, string>, dependencyLockPath?: string, runtimeRoot?: string }} options - Revision preparation inputs.
 * @returns {Promise<PreparedApplicationRevision>} - Sealed snapshot handle.
 */
export async function prepareApplicationRevision(options) {
  const authoredAppDir = path.resolve(options.appDir);
  const manifest = validateAppManifest(options.manifest);
  const contract = getTargetIndependentAppContract(manifest);
  const authoredAssets = options.assets || {};
  const excludedPaths = createSourceExcludedPaths(authoredAppDir, {
    outputDir: options.outputDir,
    assetPaths: Object.values(authoredAssets),
  });
  assertEntrypointsIncluded(manifest, excludedPaths);

  const stateDirectory = path.join(authoredAppDir, SNAPSHOT_STATE_DIRECTORY);
  const snapshotParent = path.join(stateDirectory, SNAPSHOT_PARENT_DIRECTORY);
  await fsp.mkdir(snapshotParent, { mode: 0o700, recursive: true });
  await fsp.chmod(stateDirectory, 0o700);
  await fsp.chmod(snapshotParent, 0o700);
  const snapshotRoot = await fsp.mkdtemp(
    path.join(snapshotParent, 'revision-'),
  );
  await fsp.chmod(snapshotRoot, 0o700);
  const snapshotAppDir = path.join(snapshotRoot, 'app');
  const runtimeRoot = path.resolve(
    options.runtimeRoot || DEFAULT_WHARFIE_RUNTIME_ROOT,
  );

  try {
    await copyBehaviorTree(authoredAppDir, snapshotAppDir, excludedPaths);
    const snapshotAssets = await snapshotBehaviorAssets(
      authoredAssets,
      snapshotRoot,
    );

    const authoredLockPath =
      typeof options.dependencyLockPath === 'string'
        ? path.resolve(options.dependencyLockPath)
        : await findDependencyLockPath(authoredAppDir);
    let snapshotLockPath;
    if (authoredLockPath) {
      snapshotLockPath = path.join(snapshotRoot, 'package-lock.json');
      await fsp.writeFile(
        snapshotLockPath,
        await readStableRegularFile(
          authoredLockPath,
          `Dependency lock '${authoredLockPath}'`,
        ),
        { flag: 'wx', mode: 0o600 },
      );
    }

    await auditBehaviorModuleGraph(snapshotAppDir, manifest);
    const [source, dependencies, runtime, assetInputs] = await Promise.all([
      createSourceTreeInput(snapshotAppDir),
      createDependencyLockInput(snapshotAppDir, contract, {
        dependencyLockPath: snapshotLockPath || null,
      }),
      createRuntimeInput(runtimeRoot),
      createBehaviorAssetInputs(snapshotAssets),
    ]);
    const revision = createApplicationRevision({
      contract,
      inputs: {
        source,
        dependencies,
        runtime,
        ...(assetInputs ? { assets: assetInputs } : {}),
      },
    });

    await setSnapshotTreeWritable(snapshotRoot, false);
    let cleaned = false;
    return {
      revision,
      appDir: snapshotAppDir,
      manifest,
      assets: Object.freeze({ ...snapshotAssets }),
      verifyRuntime: async () => {
        const currentRuntime = await createRuntimeInput(runtimeRoot);
        if (
          currentRuntime.format !== revision.inputs.runtime.format ||
          !hasSameDigest(currentRuntime.digest, revision.inputs.runtime.digest)
        ) {
          throw new Error(
            'Wharfie runtime files changed while the application revision was being consumed.',
          );
        }
      },
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        await cleanupApplicationSnapshot(
          snapshotRoot,
          snapshotParent,
          stateDirectory,
        );
      },
    };
  } catch (error) {
    try {
      await cleanupApplicationSnapshot(
        snapshotRoot,
        snapshotParent,
        stateDirectory,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Application revision preparation failed and its private snapshot could not be removed.',
      );
    }
    throw error;
  }
}

/**
 * Compile a revision for inspection without leaking its temporary source
 * snapshot. Callers that execute or package behavior must use
 * prepareApplicationRevision instead.
 * @param {{ appDir: string, manifest: unknown, outputDir?: string, assets?: Record<string, string>, dependencyLockPath?: string, runtimeRoot?: string }} options - Revision compilation inputs.
 * @returns {Promise<import('../../core/runtime/application-revision.js').ApplicationRevision>} - Immutable logical revision.
 */
export async function compileApplicationRevision(options) {
  const prepared = await prepareApplicationRevision(options);
  try {
    return prepared.revision;
  } finally {
    await prepared.cleanup();
  }
}

export default compileApplicationRevision;
