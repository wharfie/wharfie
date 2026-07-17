import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import pacote from 'pacote';
import { extract as extractTar, list as listTar } from 'tar';

import { compareCanonicalStrings } from '../../../runtime/canonical-order.js';
import {
  createFrozenDependencyClosurePlan,
  verifyExtractedPackageManifest,
} from './frozen-dependency-closure.js';

/**
 * @typedef {import('node:process')['platform']} TargetPlatform
 * @typedef {import('node:process')['arch']} TargetArch
 * @typedef {'glibc' | 'musl'} TargetLibc
 * @typedef BuildTarget
 * @property {string} nodeVersion - Exact target Node version.
 * @property {TargetPlatform} platform - Target platform.
 * @property {TargetArch} architecture - Target architecture.
 * @property {TargetLibc} [libc] - Target Linux libc.
 * @typedef ExternalDep
 * @property {string} name - Exact npm name.
 * @property {string} version - Exact semantic version.
 */

/**
 * Remove a path without treating absence as an error.
 * @param {string} value - Path to remove.
 * @param {import('node:fs').RmOptions} options - Removal options.
 * @returns {Promise<void>}
 */
async function rmSafe(value, options) {
  try {
    await rm(value, options);
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
}

/**
 * Assert a plan location remains beneath this private materialization root.
 * @param {string} root - Private build root.
 * @param {string} location - Canonical lock location.
 * @returns {string} - Absolute destination.
 */
function resolvePackageDestination(root, location) {
  const destination = path.resolve(root, ...location.split('/'));
  const nodeModulesRoot = path.resolve(root, 'node_modules');
  const relative = path.relative(nodeModulesRoot, destination);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Frozen dependency location '${location}' escapes node_modules.`,
    );
  }
  return destination;
}

/**
 * Reject links, devices, sockets, and other filesystem behavior that cannot be
 * represented by closure v1.
 * @param {string} root - Materialized node_modules root.
 * @returns {Promise<void>}
 */
async function assertRegularMaterializedTree(root) {
  /** @param {string} directory - Directory to inspect. */
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      compareCanonicalStrings(left.name, right.name),
    );
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Frozen dependency materialization produced symbolic link '${entryPath}'.`,
        );
      }
      if (stats.isDirectory()) {
        await visit(entryPath);
      } else if (!stats.isFile()) {
        throw new Error(
          `Frozen dependency materialization produced unsupported special path '${entryPath}'.`,
        );
      }
    }
  }

  await visit(root);
}

/**
 * Feed exact in-memory tar bytes through one tar parser and await completion.
 * @param {any} stream - Tar parser/unpacker.
 * @param {Buffer} bytes - Exact integrity-checked archive.
 * @param {'end'|'close'} completionEvent - Successful terminal event.
 * @returns {Promise<void>}
 */
async function consumeTarBytes(stream, bytes, completionEvent) {
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.once(completionEvent, resolve);
    try {
      stream.end(bytes);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Validate the effective entries in exact package tar bytes before any path is
 * materialized. npm package archives must contain one canonical `package/`
 * tree composed only of regular files and directories.
 * @param {Buffer} bytes - Exact integrity-checked archive.
 * @param {string} location - Planned package location.
 * @returns {Promise<void>}
 */
async function validatePackageTarball(bytes, location) {
  /** @type {Map<string, 'file'|'directory'>} */
  const entries = new Map();
  let packageJsonSeen = false;
  const parser = listTar({
    strict: true,
    onReadEntry(entry) {
      const rawPath = entry.path;
      if (
        typeof rawPath !== 'string' ||
        !rawPath ||
        rawPath.includes('\\') ||
        rawPath.includes('\0') ||
        path.posix.isAbsolute(rawPath)
      ) {
        throw new Error(
          `Frozen dependency '${location}' archive contains a non-canonical path.`,
        );
      }
      const entryPath = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
      if (
        !entryPath ||
        path.posix.normalize(entryPath) !== entryPath ||
        (entryPath !== 'package' && !entryPath.startsWith('package/'))
      ) {
        throw new Error(
          `Frozen dependency '${location}' archive path '${rawPath}' is outside its canonical package/ root.`,
        );
      }
      const logicalPath =
        entryPath === 'package' ? '' : entryPath.slice('package/'.length);
      if (
        logicalPath &&
        logicalPath
          .split('/')
          .some(
            (component) =>
              !component || component === '.' || component === '..',
          )
      ) {
        throw new Error(
          `Frozen dependency '${location}' archive path '${rawPath}' is not canonical.`,
        );
      }
      if (logicalPath.split('/').includes('node_modules')) {
        throw new Error(
          `Frozen dependency '${location}' archive contains an embedded node_modules tree.`,
        );
      }
      if (entry.type !== 'File' && entry.type !== 'Directory') {
        throw new Error(
          `Frozen dependency '${location}' archive contains unsupported ${entry.type} entry '${rawPath}'.`,
        );
      }
      if (entryPath === 'package' && entry.type !== 'Directory') {
        throw new Error(
          `Frozen dependency '${location}' archive package root must be a directory.`,
        );
      }
      if (entries.has(logicalPath)) {
        throw new Error(
          `Frozen dependency '${location}' archive contains duplicate path '${rawPath}'.`,
        );
      }
      entries.set(logicalPath, entry.type === 'File' ? 'file' : 'directory');
      if (logicalPath === 'package.json') {
        if (entry.type !== 'File') {
          throw new Error(
            `Frozen dependency '${location}' archive package.json must be a regular file.`,
          );
        }
        packageJsonSeen = true;
      }
    },
  });
  await consumeTarBytes(parser, bytes, 'end');

  if (!packageJsonSeen) {
    throw new Error(
      `Frozen dependency '${location}' archive has no regular package/package.json.`,
    );
  }
  for (const logicalPath of entries.keys()) {
    if (!logicalPath) continue;
    const components = logicalPath.split('/');
    for (let index = 1; index < components.length; index += 1) {
      const parent = components.slice(0, index).join('/');
      if (entries.get(parent) === 'file') {
        throw new Error(
          `Frozen dependency '${location}' archive places '${logicalPath}' beneath regular file '${parent}'.`,
        );
      }
    }
  }
}

/**
 * Extract the same already-validated bytes into a new exact package root.
 * @param {Buffer} bytes - Exact integrity-checked archive.
 * @param {string} destination - Exact physical package destination.
 * @returns {Promise<void>}
 */
async function extractPackageTarball(bytes, destination) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const unpacker = extractTar({
    cwd: destination,
    strip: 1,
    strict: true,
    preserveOwner: false,
    unlink: true,
    noMtime: true,
  });
  await consumeTarBytes(unpacker, bytes, 'close');
}

/**
 * Discover physical npm package roots using only node_modules boundaries.
 * @param {string} buildRoot - Private build root.
 * @returns {Promise<string[]>} - Canonical installed lock locations.
 */
async function discoverInstalledPackageLocations(buildRoot) {
  /** @type {string[]} */
  const found = [];

  /**
   * @param {string} nodeModulesPath - Absolute node_modules path.
   * @param {string} logicalNodeModulesPath - Canonical lock prefix.
   * @returns {Promise<void>}
   */
  async function scanNodeModules(nodeModulesPath, logicalNodeModulesPath) {
    const entries = await readdir(nodeModulesPath, { withFileTypes: true });
    entries.sort((left, right) =>
      compareCanonicalStrings(left.name, right.name),
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        throw new Error(
          `Frozen dependency node_modules contains unexpected non-directory '${path.join(nodeModulesPath, entry.name)}'.`,
        );
      }
      if (entry.name.startsWith('@')) {
        const scopePath = path.join(nodeModulesPath, entry.name);
        const scopedEntries = await readdir(scopePath, {
          withFileTypes: true,
        });
        scopedEntries.sort((left, right) =>
          compareCanonicalStrings(left.name, right.name),
        );
        if (scopedEntries.length === 0) {
          throw new Error(
            `Frozen dependency node_modules contains empty scope '${entry.name}'.`,
          );
        }
        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory()) {
            throw new Error(
              `Frozen dependency scope '${entry.name}' contains a non-directory entry.`,
            );
          }
          await recordPackage(
            path.join(scopePath, scopedEntry.name),
            `${logicalNodeModulesPath}/${entry.name}/${scopedEntry.name}`,
          );
        }
      } else {
        await recordPackage(
          path.join(nodeModulesPath, entry.name),
          `${logicalNodeModulesPath}/${entry.name}`,
        );
      }
    }
  }

  /**
   * @param {string} packagePath - Absolute package root.
   * @param {string} location - Canonical lock location.
   * @returns {Promise<void>}
   */
  async function recordPackage(packagePath, location) {
    found.push(location);
    const nestedNodeModules = path.join(packagePath, 'node_modules');
    if (existsSync(nestedNodeModules)) {
      const stats = await lstat(nestedNodeModules);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(
          `Frozen dependency package '${location}' has an invalid node_modules boundary.`,
        );
      }
      await scanNodeModules(nestedNodeModules, `${location}/node_modules`);
    }
  }

  const root = path.join(buildRoot, 'node_modules');
  await scanNodeModules(root, 'node_modules');
  return found.sort(compareCanonicalStrings);
}

/**
 * Verify every planned package and reject any unplanned physical root.
 * @param {string} buildRoot - Private materialization root.
 * @param {Readonly<Record<string, any>>} plan - Frozen closure plan.
 * @returns {Promise<void>}
 */
async function verifyMaterializedClosure(buildRoot, plan) {
  const expectedLocations = plan.packages.map(
    (/** @type {any} */ entry) => entry.location,
  );
  for (const packageEntry of plan.packages) {
    const destination = resolvePackageDestination(
      buildRoot,
      packageEntry.location,
    );
    let packageManifest;
    try {
      packageManifest = JSON.parse(
        await readFile(path.join(destination, 'package.json'), 'utf8'),
      );
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      throw new Error(
        `Frozen dependency '${packageEntry.location}' has no valid package.json.${detail}`,
      );
    }
    verifyExtractedPackageManifest(packageManifest, packageEntry);
  }

  const nodeModulesRoot = path.join(buildRoot, 'node_modules');
  await assertRegularMaterializedTree(nodeModulesRoot);
  const actualLocations = await discoverInstalledPackageLocations(buildRoot);
  if (
    actualLocations.length !== expectedLocations.length ||
    actualLocations.some(
      (location, index) => location !== expectedLocations[index],
    )
  ) {
    throw new Error(
      `Frozen dependency materialization does not match its exact planned package roots. Expected ${JSON.stringify(expectedLocations)}, received ${JSON.stringify(actualLocations)}.`,
    );
  }
}

/**
 * Materialize one exact activity/target closure. This function performs no
 * manifest lookup, tag/range resolution, ideal-tree update, lifecycle script,
 * or optional-package heuristic. Every fetched byte is named by the sealed
 * lock URL and checked against its SHA-512 SRI.
 * @param {{
 *   activity: string,
 *   buildTarget: BuildTarget,
 *   dependencyLock: unknown,
 *   externals: ExternalDep[] | undefined,
 *   tmpBuildDir: string
 * }} params - Exact closure inputs.
 * @returns {Promise<{ dependencyLockInput: import('../../../runtime/application-revision.js').LockedInputDescriptor, closureDigest: import('../../../runtime/application-revision.js').Sha256Digest, plan: Readonly<Record<string, any>> } | null>} - Materialized closure receipt.
 */
async function installForTarget({
  activity,
  buildTarget,
  dependencyLock,
  externals,
  tmpBuildDir,
}) {
  if (!externals?.length) return null;

  const closure = await createFrozenDependencyClosurePlan({
    activity,
    buildTarget,
    dependencyLock,
    externals,
  });
  await rmSafe(path.join(tmpBuildDir, 'node_modules'), {
    recursive: true,
    force: true,
  });
  await rmSafe(path.join(tmpBuildDir, 'package-lock.json'), { force: true });
  await rmSafe(path.join(tmpBuildDir, '.npmrc'), { force: true });
  await mkdir(tmpBuildDir, { recursive: true });
  await writeFile(
    path.join(tmpBuildDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'wharfie-frozen-dependency-closure',
        private: true,
        dependencies: Object.fromEntries(
          closure.plan.roots.map((/** @type {any} */ root) => [
            root.name,
            root.version,
          ]),
        ),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  for (const packageEntry of closure.plan.packages) {
    const destination = resolvePackageDestination(
      tmpBuildDir,
      packageEntry.location,
    );
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      // eslint-disable-next-line import/no-named-as-default-member
      const tarball = await pacote.tarball(packageEntry.resolved, {
        integrity: packageEntry.integrity,
      });
      if (!Buffer.isBuffer(tarball) || tarball.length === 0) {
        throw new TypeError('Locked package URL did not return tar bytes.');
      }
      await validatePackageTarball(tarball, packageEntry.location);
      await extractPackageTarball(tarball, destination);
    } catch (error) {
      await rmSafe(destination, { recursive: true, force: true });
      const detail = error instanceof Error ? ` ${error.message}` : '';
      throw new Error(
        `Failed to validate and extract frozen dependency '${packageEntry.location}' from its locked URL and integrity.${detail}`,
      );
    }
  }

  await verifyMaterializedClosure(tmpBuildDir, closure.plan);
  return {
    dependencyLockInput: closure.plan.lock,
    closureDigest: closure.digest,
    plan: closure.plan,
  };
}

export { installForTarget };
