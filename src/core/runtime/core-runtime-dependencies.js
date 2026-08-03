import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { x } from 'tar';

import {
  getAsset as nodeGetAsset,
  isSea as nodeIsSea,
} from '../lib/node-sea.js';
import {
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
  validateCoreRuntimeDependencyManifest,
} from '../resources/builds/lib/core-runtime-dependency-asset.js';
import { verifyExtractedPackageManifest } from '../resources/builds/lib/frozen-dependency-closure-plan.js';
import { readEmbeddedRevisionRuntimePair } from '../resources/builds/lib/revision-runtime-assets.js';
import { getBuildTargetId } from './build-target.js';
import { compareCanonicalStrings } from './canonical-order.js';

const CORE_RUNTIME_DEPENDENCY_TEMP_DIRECTORY =
  'wharfie-core-runtime-dependencies-v2';
const CORE_RUNTIME_DEPENDENCY_ROOT_NAME_PATTERN =
  /^closure-v2-[A-Za-z0-9_-]{16}-h(?<host>[a-f0-9]{24})-b(?<boot>[a-f0-9]{24})-n(?<namespace>[a-z0-9]+)-p(?<pid>[1-9][0-9]*)-s(?<start>[a-z0-9]+)-t[0-9a-z]+-[A-Za-z0-9]{6}$/;
const MAX_STALE_CORE_RUNTIME_DEPENDENCY_REMOVALS = 8;
const MAX_CORE_RUNTIME_DEPENDENCY_ROOT_INSPECTIONS = 128;

/** @type {Promise<PreparedCoreRuntimeDependencies | null> | null} */
let preparedDependenciesPromise = null;
/** @type {PreparedCoreRuntimeDependencies | null} */
let preparedDependencies = null;
let processExitCleanupInstalled = false;

/**
 * @typedef EmbeddedAssetProvider
 * @property {() => boolean} [isSea] - Whether this process is a SEA.
 * @property {(name: string, encoding?: string) => any} getAsset - Read one exact embedded asset.
 */

/**
 * @typedef PreparedCoreRuntimeDependencies
 * @property {string} root - Fresh private extraction root.
 * @property {ReturnType<typeof createRequire>} require - Require scoped to the verified extraction root.
 * @property {import('../resources/builds/lib/core-runtime-dependency-asset.js').CoreRuntimeDependencyManifest} manifest - Exact validated receipt.
 * @property {Buffer} archiveBytes - Exact verified archive bytes.
 * @property {any | null} lmdbModule - Loaded trusted LMDB module when requested.
 * @property {Map<string, string>} packageDirectories - Planned package locations to verified canonical directories.
 */

/**
 * @typedef RuntimeExtractionOwnerIdentity
 * @property {string} hostToken - Opaque stable host identity.
 * @property {string} bootToken - Opaque host-boot identity.
 * @property {string} namespaceToken - Opaque process namespace identity.
 * @property {string} processStartToken - Opaque process-birth identity.
 * @property {boolean} bootIdentityReliable - Whether a changed boot token proves the prior owner exited.
 */

/**
 * @typedef RuntimeExtractionRootClaim
 * @property {string} hostToken - Opaque claimed stable host identity.
 * @property {string} bootToken - Opaque claimed host-boot identity.
 * @property {string} namespaceToken - Opaque claimed process namespace identity.
 * @property {number} pid - Claimed owner process ID.
 * @property {string} processStartToken - Opaque claimed process-birth identity.
 */

/**
 * Return a short filesystem-safe digest without disclosing its input.
 * @param {string} value - Host identity input.
 * @returns {string} - Twenty-four lowercase hexadecimal characters.
 */
function digestRuntimeOwnerToken(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

/**
 * Use the effective filesystem principal when POSIX exposes one.
 * @returns {number | null} - Effective UID or null on an unsupported host.
 */
function getRuntimeFilesystemUid() {
  if (typeof process.geteuid === 'function') return process.geteuid();
  if (typeof process.getuid === 'function') return process.getuid();
  return null;
}

/**
 * Read Linux field 22 (starttime) without depending on the parenthesized comm
 * field's contents. The token distinguishes a reused PID from the owner that
 * created an extraction root.
 * @param {number | 'self'} pid - Visible process identifier.
 * @returns {string} - Kernel start ticks encoded in base 36.
 */
function readLinuxProcessStartToken(pid) {
  const record = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const commEnd = record.lastIndexOf(')');
  const fields =
    commEnd < 0
      ? []
      : record
          .slice(commEnd + 2)
          .trim()
          .split(/ +/);
  const startTicks = fields[19];
  if (!startTicks || !/^[1-9][0-9]*$/.test(startTicks)) {
    throw new Error(`Linux process '${pid}' has an invalid /proc stat record.`);
  }
  return BigInt(startTicks).toString(36);
}

/**
 * Identify the process authority used by extraction-root claims. Linux host,
 * boot, and PID-namespace identities prevent another host or namespace from
 * being mistaken for a dead local owner. Darwin has no PID namespaces; PID
 * reuse can conservatively retain a stale root but cannot delete a live one.
 * @returns {RuntimeExtractionOwnerIdentity} - Current process authority.
 */
function getRuntimeExtractionOwnerIdentity() {
  if (process.platform !== 'linux') {
    return {
      hostToken: digestRuntimeOwnerToken(`${process.platform}:${hostname()}`),
      bootToken: digestRuntimeOwnerToken(`${process.platform}:portable`),
      namespaceToken: 'host',
      processStartToken: 'portable',
      bootIdentityReliable: false,
    };
  }

  let bootId;
  let machineId;
  let namespaceIdentity;
  let processStartToken;
  try {
    bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    machineId = readFileSync('/etc/machine-id', 'utf8').trim();
    namespaceIdentity = readlinkSync('/proc/self/ns/pid');
    processStartToken = readLinuxProcessStartToken('self');
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(
      `Linux core runtime extraction requires readable machine, boot, and PID-namespace identities.${detail}`,
    );
  }
  const namespaceMatch = /^pid:\[([1-9][0-9]*)\]$/.exec(namespaceIdentity);
  if (
    !bootId ||
    !/^[a-f0-9]{32}$/.test(machineId) ||
    /^0+$/.test(machineId) ||
    !namespaceMatch
  ) {
    throw new Error(
      'Linux core runtime extraction received invalid machine, boot, or PID-namespace identity.',
    );
  }
  return {
    hostToken: digestRuntimeOwnerToken(machineId),
    bootToken: digestRuntimeOwnerToken(bootId),
    namespaceToken: Number(namespaceMatch[1]).toString(36),
    processStartToken,
    bootIdentityReliable: true,
  };
}

/**
 * Parse only the versioned root names created atomically by this runtime.
 * @param {string} name - Direct child name beneath the private parent.
 * @returns {RuntimeExtractionRootClaim | null} - Parsed claim or null.
 */
function parseRuntimeExtractionRootClaim(name) {
  const match = CORE_RUNTIME_DEPENDENCY_ROOT_NAME_PATTERN.exec(name);
  if (!match?.groups) return null;
  const pid = Number(match.groups.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  return {
    hostToken: match.groups.host,
    bootToken: match.groups.boot,
    namespaceToken: match.groups.namespace,
    pid,
    processStartToken: match.groups.start,
  };
}

/**
 * A failed liveness probe is authoritative only for ESRCH. Permission and
 * platform errors preserve the root rather than risking deletion of live
 * native code.
 * @param {number} pid - Claimed owner process ID.
 * @returns {boolean} - Whether the process may still be alive.
 */
function mayProcessBeAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ESRCH'
    );
  }
}

/**
 * Require positive evidence that a claimed owner is gone. A Linux boot change
 * on the same stable host is sufficient. Within one boot, cleanup only probes
 * PIDs from this exact PID namespace. Other hosts, unknown namespaces, and
 * uncertain probes are retained.
 * @param {RuntimeExtractionRootClaim} claim - Root owner claim.
 * @param {RuntimeExtractionOwnerIdentity} current - Current process authority.
 * @returns {boolean} - Whether the root may still have a live owner.
 */
function mayRuntimeExtractionOwnerBeAlive(claim, current) {
  if (claim.hostToken !== current.hostToken) return true;
  if (current.bootIdentityReliable && claim.bootToken !== current.bootToken) {
    return false;
  }
  if (
    claim.bootToken !== current.bootToken ||
    claim.namespaceToken !== current.namespaceToken
  ) {
    return true;
  }
  if (process.platform === 'linux') {
    try {
      return readLinuxProcessStartToken(claim.pid) === claim.processStartToken;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return false;
      }
      return true;
    }
  }
  return mayProcessBeAlive(claim.pid);
}

/**
 * @param {string} directory - Candidate private directory.
 * @param {string} label - Human-readable label.
 * @returns {Promise<import('node:fs').Stats>} - Stable directory identity.
 */
async function assertPrivateDirectory(directory, label) {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a non-symbolic-link directory.`);
  }
  if ((stats.mode & 0o777) !== 0o700) {
    throw new Error(`${label} must have mode 0700.`);
  }
  const uid = getRuntimeFilesystemUid();
  if (uid !== null && stats.uid !== uid) {
    throw new Error(`${label} must be owned by the current user.`);
  }
  return stats;
}

/**
 * Create and validate a private parent beneath the operating system temporary
 * directory. A fresh child is used for each process; native dependencies never
 * share a mutable cross-process cache.
 * @param {string} parent - Requested parent path.
 * @returns {Promise<import('node:fs').Stats>} - Parent identity.
 */
async function ensurePrivateParent(parent) {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const before = await lstat(parent);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error(
      'Core runtime dependency parent must be a non-symbolic-link directory.',
    );
  }
  const uid = getRuntimeFilesystemUid();
  if (uid !== null && before.uid !== uid) {
    throw new Error(
      'Core runtime dependency parent must be owned by the current user.',
    );
  }
  await chmod(parent, 0o700);
  const after = await assertPrivateDirectory(
    parent,
    'Core runtime dependency parent',
  );
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error(
      'Core runtime dependency parent changed while it was being prepared.',
    );
  }
  return after;
}

/**
 * @param {string} parent - Validated private parent.
 * @param {string} prefix - Readable content-derived prefix.
 * @param {RuntimeExtractionOwnerIdentity} owner - Current process authority.
 * @returns {Promise<string>} - Fresh private child root.
 */
async function createFreshPrivateRoot(parent, prefix, owner) {
  const parentIdentity = await ensurePrivateParent(parent);
  const ownerPrefix = `${prefix}-h${owner.hostToken}-b${owner.bootToken}-n${owner.namespaceToken}-p${process.pid}-s${owner.processStartToken}-t${Date.now().toString(36)}`;
  const root = await mkdtemp(path.join(parent, `${ownerPrefix}-`));
  try {
    await chmod(root, 0o700);
    await assertPrivateDirectory(root, 'Core runtime dependency root');
    const currentParent = await assertPrivateDirectory(
      parent,
      'Core runtime dependency parent',
    );
    if (
      currentParent.dev !== parentIdentity.dev ||
      currentParent.ino !== parentIdentity.ino
    ) {
      throw new Error(
        'Core runtime dependency parent changed while an extraction root was being created.',
      );
    }
    return root;
  } catch (error) {
    await rm(root, { force: true, recursive: true });
    throw error;
  }
}

/**
 * Remove a bounded number of positively dead extraction roots before creating
 * another. The versioned private parent contains no application data: an
 * unrecognized entry is left untouched, an uncertain owner is retained, and
 * an unsafe claimed root or exhausted budget stops allocation without deleting
 * it.
 *
 * Cleanup happens before extraction, so repeated abrupt termination converges:
 * a killed attempt leaves at most its fresh root, and its successor removes it
 * before allocating another. Large pre-existing backlogs are drained in fixed
 * batches across explicit retries.
 * @param {string} parent - Dedicated private extraction parent.
 * @param {RuntimeExtractionOwnerIdentity} owner - Current process authority.
 * @returns {Promise<void>} - Completes when another root may be admitted.
 */
async function scavengeStaleRuntimeExtractionRoots(parent, owner) {
  const parentIdentity = await ensurePrivateParent(parent);
  let inspected = 0;
  let removed = 0;
  let staleBacklog = false;
  let inspectionBudgetExhausted = false;

  const directory = await opendir(parent);
  for await (const entry of directory) {
    inspected += 1;
    if (inspected > MAX_CORE_RUNTIME_DEPENDENCY_ROOT_INSPECTIONS) {
      inspectionBudgetExhausted = true;
      break;
    }
    const claim = parseRuntimeExtractionRootClaim(entry.name);
    if (!claim) continue;
    const root = path.join(parent, entry.name);
    let rootIdentity;
    try {
      rootIdentity = await assertPrivateDirectory(
        root,
        `Core runtime dependency root '${entry.name}'`,
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
    if (mayRuntimeExtractionOwnerBeAlive(claim, owner)) {
      continue;
    }
    if (removed >= MAX_STALE_CORE_RUNTIME_DEPENDENCY_REMOVALS) {
      staleBacklog = true;
      continue;
    }

    const currentParent = await assertPrivateDirectory(
      parent,
      'Core runtime dependency parent',
    );
    let currentRoot;
    try {
      currentRoot = await assertPrivateDirectory(
        root,
        `Core runtime dependency root '${entry.name}'`,
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
    if (
      currentParent.dev !== parentIdentity.dev ||
      currentParent.ino !== parentIdentity.ino ||
      currentRoot.dev !== rootIdentity.dev ||
      currentRoot.ino !== rootIdentity.ino
    ) {
      throw new Error(
        'Core runtime dependency extraction authority changed during stale-root cleanup.',
      );
    }
    await rm(root, { force: true, recursive: true });
    removed += 1;
  }

  if (inspectionBudgetExhausted) {
    throw new Error(
      `Core runtime dependency parent exceeded the ${MAX_CORE_RUNTIME_DEPENDENCY_ROOT_INSPECTIONS}-entry automatic inspection limit after removing ${removed} stale roots; manual inspection is required before another allocation.`,
    );
  }
  if (staleBacklog) {
    throw new Error(
      `Core runtime dependency stale-root cleanup exhausted its bounded removal budget after inspecting ${inspected} entries and removing ${removed}; retry preparation to continue convergence.`,
    );
  }
}

/**
 * Reject links, devices, sockets, and other unsupported filesystem behavior
 * after archive materialization. The walk uses lstat and never follows a link.
 * @param {string} root - Fresh private extraction root.
 * @returns {Promise<void>} - Completes after validation.
 */
async function assertRegularExtractedTree(root) {
  await assertPrivateDirectory(root, 'Core runtime dependency root');

  /** @param {string} directory - Directory to inspect. */
  async function visit(directory) {
    const names = await readdir(directory);
    names.sort();
    for (const name of names) {
      const entryPath = path.join(directory, name);
      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Core runtime dependency archive produced symbolic link '${entryPath}'.`,
        );
      }
      if (stats.isDirectory()) {
        await visit(entryPath);
      } else if (!stats.isFile()) {
        throw new Error(
          `Core runtime dependency archive produced unsupported special path '${entryPath}'.`,
        );
      }
    }
  }

  await visit(root);
}

/**
 * Discover package roots strictly through physical node_modules boundaries.
 * The resulting locations are compared to the embedded plan before any
 * closure package code is resolved or executed.
 * @param {string} root - Fresh extraction root.
 * @returns {Promise<string[]>} - Canonical package-lock locations.
 */
async function discoverExtractedPackageLocations(root) {
  /** @type {string[]} */
  const found = [];

  /**
   * @param {string} nodeModulesPath - Physical node_modules directory.
   * @param {string} logicalPrefix - Canonical package-lock prefix.
   * @returns {Promise<void>}
   */
  async function scanNodeModules(nodeModulesPath, logicalPrefix) {
    const entries = await readdir(nodeModulesPath, { withFileTypes: true });
    entries.sort((left, right) =>
      compareCanonicalStrings(left.name, right.name),
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        throw new Error(
          `Core runtime dependency node_modules contains non-directory '${entry.name}'.`,
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
            `Core runtime dependency closure contains empty scope '${entry.name}'.`,
          );
        }
        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory()) {
            throw new Error(
              `Core runtime dependency scope '${entry.name}' contains a non-directory entry.`,
            );
          }
          await recordPackage(
            path.join(scopePath, scopedEntry.name),
            `${logicalPrefix}/${entry.name}/${scopedEntry.name}`,
          );
        }
      } else {
        await recordPackage(
          path.join(nodeModulesPath, entry.name),
          `${logicalPrefix}/${entry.name}`,
        );
      }
    }
  }

  /**
   * @param {string} packagePath - Physical package root.
   * @param {string} location - Canonical package-lock location.
   * @returns {Promise<void>}
   */
  async function recordPackage(packagePath, location) {
    found.push(location);
    const nestedNodeModules = path.join(packagePath, 'node_modules');
    try {
      const stats = await lstat(nestedNodeModules);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(
          `Core runtime dependency package '${location}' has an invalid node_modules boundary.`,
        );
      }
      await scanNodeModules(nestedNodeModules, `${location}/node_modules`);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  await scanNodeModules(path.join(root, 'node_modules'), 'node_modules');
  return found.sort(compareCanonicalStrings);
}

/**
 * @param {unknown} value - Candidate SEA asset bytes.
 * @param {string} label - Human-readable asset label.
 * @returns {Buffer} - Exact byte view.
 */
function asAssetBytes(value, label) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new TypeError(`${label} must return exact binary asset bytes.`);
}

/**
 * @param {EmbeddedAssetProvider} assetProvider - Available asset reader.
 * @param {boolean} hasExplicitProvider - Whether a test injected the reader.
 * @returns {void}
 */
function assertSeaAccess(assetProvider, hasExplicitProvider) {
  if (
    !hasExplicitProvider &&
    typeof assetProvider.isSea === 'function' &&
    !assetProvider.isSea()
  ) {
    throw new Error(
      'Core runtime dependency assets are only available inside a packaged SEA artifact.',
    );
  }
}

/**
 * @param {import('../resources/builds/lib/core-runtime-dependency-asset.js').CoreRuntimeDependencyManifest} manifest - Expected artifact target.
 * @param {{runtime: {target: import('./build-target.js').BuildTarget}}} embedded - Embedded artifact metadata.
 * @returns {void}
 */
function assertRuntimeTarget(manifest, embedded) {
  const manifestTargetId = getBuildTargetId(
    manifest.target,
    'core runtime dependency target',
  );
  const runtimeTargetId = getBuildTargetId(
    embedded.runtime.target,
    'embedded artifact runtime target',
  );
  if (manifestTargetId !== runtimeTargetId) {
    throw new Error(
      'Core runtime dependency target does not match embedded artifact runtime metadata.',
    );
  }
  if (
    manifest.target.nodeVersion !== process.versions.node ||
    manifest.target.platform !== process.platform ||
    manifest.target.architecture !== process.arch
  ) {
    throw new Error(
      'Core runtime dependency target does not match the running SEA process.',
    );
  }
  if (manifest.target.platform === 'linux') {
    let glibcVersionRuntime;
    try {
      const report = /** @type {any} */ (process.report?.getReport?.());
      glibcVersionRuntime = report?.header?.glibcVersionRuntime;
    } catch {
      glibcVersionRuntime = undefined;
    }
    if (
      typeof glibcVersionRuntime !== 'string' ||
      !glibcVersionRuntime.trim()
    ) {
      throw new Error(
        'Core runtime LMDB dependency requires a positively identified glibc runtime.',
      );
    }
  }
}

/**
 * Extract exact verified closure bytes into one fresh private root.
 * @param {Buffer} archiveBytes - Exact archive bytes.
 * @param {string} root - Fresh extraction root.
 * @returns {Promise<void>} - Completes after extraction and validation.
 */
async function extractCoreRuntimeDependencyArchive(archiveBytes, root) {
  let unsupportedEntryType = null;
  const extractor = x({
    C: root,
    preserveOwner: false,
    preservePaths: false,
    strict: true,
    filter: (_entryPath, entry) => {
      const entryType = 'type' in entry ? String(entry.type) : 'unknown';
      if (!['Directory', 'File', 'OldFile'].includes(entryType)) {
        unsupportedEntryType ||= entryType;
        return false;
      }
      return true;
    },
  });
  await pipeline(Readable.from([archiveBytes]), extractor);
  if (unsupportedEntryType) {
    throw new Error(
      `Core runtime dependency archive contains unsupported entry type '${unsupportedEntryType}'.`,
    );
  }
  await chmod(root, 0o700);
  await assertRegularExtractedTree(root);
  const packagePath = path.join(root, 'package.json');
  await writeFile(
    packagePath,
    JSON.stringify(
      {
        name: 'wharfie-core-runtime-dependencies',
        private: true,
      },
      null,
      2,
    ),
    { flag: 'w', mode: 0o600 },
  );
  await chmod(packagePath, 0o600);
}

/**
 * Remove the per-process extracted closure on a normal process exit. SIGKILL
 * intentionally cannot run this hook; the next process uses a distinct fresh
 * root and never trusts a prior mutable extraction. Windows may retain a
 * loaded native file through process teardown, so cleanup remains best effort.
 * @returns {void}
 */
function installPreparedDependencyExitCleanup() {
  if (processExitCleanupInstalled) return;
  processExitCleanupInstalled = true;
  process.once('exit', () => {
    const root = preparedDependencies?.root;
    if (!root) return;
    try {
      rmSync(root, { force: true, recursive: true });
    } catch {
      // Process teardown cannot safely surface cleanup errors.
    }
  });
}

/**
 * @param {string} root - Canonical verified extraction root.
 * @param {string} candidate - Canonical candidate path.
 * @returns {boolean} - Whether candidate is root or below it.
 */
function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

/**
 * Resolve a path through the filesystem and reject anything outside the fresh
 * verified extraction root. realpath is required here because macOS exposes
 * /var through /private/var, and Node's CJS loader hands native loaders its
 * physical resolved paths.
 * @param {PreparedCoreRuntimeDependencies} prepared - Prepared closure state.
 * @param {string} candidate - Path to inspect.
 * @param {string} label - Human-readable path label.
 * @returns {string} - Canonical path beneath the verified extraction root.
 */
function resolveVerifiedPath(prepared, candidate, label) {
  let root;
  let resolved;
  try {
    root = realpathSync(prepared.root);
    resolved = realpathSync(candidate);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(
      `${label} must exist beneath the verified closure.${detail}`,
    );
  }
  if (!isPathInside(root, resolved)) {
    throw new Error(
      `${label} resolved outside the verified core dependency closure.`,
    );
  }
  return resolved;
}

/**
 * @param {PreparedCoreRuntimeDependencies} prepared - Prepared closure state.
 * @param {string} candidate - Directory to inspect.
 * @param {string} label - Human-readable path label.
 * @returns {string} - Canonical regular directory beneath the closure.
 */
function assertVerifiedDirectory(prepared, candidate, label) {
  let stats;
  try {
    stats = lstatSync(candidate);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(`${label} must be a readable directory.${detail}`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a non-symbolic-link directory.`);
  }
  const resolved = resolveVerifiedPath(prepared, candidate, label);
  const resolvedStats = lstatSync(resolved);
  if (resolvedStats.isSymbolicLink() || !resolvedStats.isDirectory()) {
    throw new Error(`${label} must be a non-symbolic-link directory.`);
  }
  return resolved;
}

/**
 * @param {PreparedCoreRuntimeDependencies} prepared - Prepared closure state.
 * @param {string} candidate - File to inspect.
 * @param {string} label - Human-readable path label.
 * @returns {string} - Canonical regular file beneath the closure.
 */
function assertVerifiedRegularFile(prepared, candidate, label) {
  let stats;
  try {
    stats = lstatSync(candidate);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(`${label} must be a readable file.${detail}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular non-symbolic file.`);
  }
  const resolved = resolveVerifiedPath(prepared, candidate, label);
  const resolvedStats = lstatSync(resolved);
  if (resolvedStats.isSymbolicLink() || !resolvedStats.isFile()) {
    throw new Error(`${label} must be a regular non-symbolic file.`);
  }
  return resolved;
}

/**
 * Return one package directory by its fixed location inside the closure.
 * Never call Node resolution for this: a malformed closure must not fall back
 * to a parent node_modules directory.
 * @param {PreparedCoreRuntimeDependencies} prepared - Prepared closure state.
 * @param {string} packageName - Exact trusted package name.
 * @param {string} [expectedVersion] - Optional exact version requirement.
 * @returns {string} - Canonical verified package directory.
 */
function getVerifiedPackageDirectory(prepared, packageName, expectedVersion) {
  const segments = packageName.split('/');
  if (
    !packageName ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid verified package name '${packageName}'.`);
  }
  const matches = prepared.manifest.plan.packages.filter(
    (/** @type {Record<string, any>} */ packageEntry) =>
      packageEntry.name === packageName &&
      (expectedVersion === undefined ||
        packageEntry.version === expectedVersion),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Verified package '${packageName}' must name exactly one package in the sealed closure plan.`,
    );
  }
  const packageDirectory = prepared.packageDirectories.get(matches[0].location);
  if (!packageDirectory) {
    throw new Error(
      `Verified package '${packageName}' was not prepared from its sealed closure plan.`,
    );
  }
  return packageDirectory;
}

/**
 * Execute a native resolver with environment values fixed to the SEA target.
 * node-gyp-build-optional-packages otherwise honors host npm and prebuild
 * overrides, which could select an ambient sidecar before its result is
 * checked against the verified closure.
 * @template T
 * @param {PreparedCoreRuntimeDependencies} prepared - Prepared closure state.
 * @param {string} packageName - Package whose prebuild override is reserved.
 * @param {() => T} fn - Synchronous resolver invocation.
 * @returns {T} - Resolver result.
 */
function withVerifiedNativeResolverEnvironment(prepared, packageName, fn) {
  const prebuildVariable = `${packageName
    .toUpperCase()
    .replace(/-/g, '_')}_PREBUILD`;
  const keys = [
    'PREBUILDS_ONLY',
    'npm_config_arch',
    'npm_config_platform',
    'LIBC',
    'ARM_VERSION',
    prebuildVariable,
  ];
  const original = keys.map((key) => ({
    key,
    present: Object.prototype.hasOwnProperty.call(process.env, key),
    value: process.env[key],
  }));
  try {
    delete process.env.PREBUILDS_ONLY;
    process.env.npm_config_arch = prepared.manifest.target.architecture;
    process.env.npm_config_platform = prepared.manifest.target.platform;
    if (prepared.manifest.target.platform === 'linux') {
      process.env.LIBC = prepared.manifest.target.libc;
    } else {
      delete process.env.LIBC;
    }
    if (prepared.manifest.target.architecture === 'arm64') {
      process.env.ARM_VERSION = '8';
    } else {
      delete process.env.ARM_VERSION;
    }
    delete process.env[prebuildVariable];
    return fn();
  } finally {
    for (const item of original) {
      if (item.present) {
        process.env[item.key] = item.value;
      } else {
        delete process.env[item.key];
      }
    }
  }
}

/**
 * Resolve a native addon using node-gyp-build's ABI/libc logic, then prove the
 * selected bytes came from the expected platform package in this exact SEA
 * closure. That preserves Linux multi-ABI selection while excluding ambient
 * executable-adjacent prebuilds and parent node_modules fallbacks.
 * @param {PreparedCoreRuntimeDependencies} prepared - Prepared closure state.
 * @param {{resolve: (directory: string) => string}} nativeResolver - Closure-local native resolver.
 * @param {string} directory - Verified package directory requested by its CJS code.
 * @param {string} expectedNativePackage - Exact target platform package.
 * @returns {string} - Canonical verified native addon path.
 */
function resolveVerifiedNativeAddon(
  prepared,
  nativeResolver,
  directory,
  expectedNativePackage,
) {
  const requestedDirectory = assertVerifiedDirectory(
    prepared,
    directory,
    'Native addon loader directory',
  );
  const expectedNativeDirectory = getVerifiedPackageDirectory(
    prepared,
    expectedNativePackage,
  );
  const selected = withVerifiedNativeResolverEnvironment(
    prepared,
    path.basename(requestedDirectory),
    () => nativeResolver.resolve(requestedDirectory),
  );
  if (typeof selected !== 'string' || !selected) {
    throw new Error(
      `Verified native resolver did not select an addon for '${expectedNativePackage}'.`,
    );
  }
  const addonPath = assertVerifiedRegularFile(
    prepared,
    selected,
    `Native addon for '${expectedNativePackage}'`,
  );
  if (!isPathInside(expectedNativeDirectory, addonPath)) {
    throw new Error(
      `Native addon for '${expectedNativePackage}' was not selected from its verified platform package.`,
    );
  }
  return addonPath;
}

/**
 * Resolve a package from its actual caller and require the result to be the
 * fixed top-level package supplied by the sealed closure. This closes Node's
 * normal upward node_modules search before arbitrary package code runs.
 * @param {PreparedCoreRuntimeDependencies} prepared - Prepared closure state.
 * @param {ReturnType<typeof createRequire>} packageRequire - Require scoped to the actual caller package.
 * @param {string} packageName - Exact dependency name.
 * @param {string} expectedDirectory - Canonical expected package root.
 * @param {string} label - Human-readable caller label.
 * @returns {string} - Canonical resolved package entry.
 */
function assertResolvedClosurePackage(
  prepared,
  packageRequire,
  packageName,
  expectedDirectory,
  label,
) {
  const entry = assertVerifiedRegularFile(
    prepared,
    packageRequire.resolve(packageName),
    `${label} '${packageName}' entry`,
  );
  if (!isPathInside(expectedDirectory, entry)) {
    throw new Error(
      `${label} resolved '${packageName}' outside its sealed closure package.`,
    );
  }
  const nestedNodeModules = path.join(expectedDirectory, 'node_modules');
  if (isPathInside(nestedNodeModules, entry)) {
    throw new Error(
      `${label} resolved '${packageName}' from a nested package instead of its exact sealed closure package.`,
    );
  }
  return entry;
}

/**
 * Verify the complete plan/archive package set and every generic CommonJS
 * package edge before loading any code from the closure. This makes a missing
 * or misdirected planned package fail at preparation instead of allowing
 * Node's upward/global module search to select ambient JavaScript.
 * @param {PreparedCoreRuntimeDependencies} prepared - Fresh extracted closure.
 * @returns {Promise<Map<string, string>>} - Planned locations to canonical package roots.
 */
async function preflightCoreRuntimeDependencyClosure(prepared) {
  const plan = prepared.manifest.plan;
  const expectedLocations = plan.packages.map(
    (/** @type {Record<string, any>} */ packageEntry) => packageEntry.location,
  );
  const actualLocations = await discoverExtractedPackageLocations(
    prepared.root,
  );
  if (
    actualLocations.length !== expectedLocations.length ||
    actualLocations.some(
      (location, index) => location !== expectedLocations[index],
    )
  ) {
    throw new Error(
      `Core runtime dependency archive does not match its exact closure plan package roots. Expected ${JSON.stringify(expectedLocations)}, received ${JSON.stringify(actualLocations)}.`,
    );
  }

  /** @type {Map<string, string>} */
  const packageDirectories = new Map();
  for (const packageEntry of plan.packages) {
    const packageDirectory = assertVerifiedDirectory(
      prepared,
      path.join(prepared.root, ...packageEntry.location.split('/')),
      `Planned package '${packageEntry.location}'`,
    );
    const manifestPath = assertVerifiedRegularFile(
      prepared,
      path.join(packageDirectory, 'package.json'),
      `Planned package '${packageEntry.location}' manifest`,
    );
    let packageManifest;
    try {
      packageManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      throw new Error(
        `Planned package '${packageEntry.location}' manifest must be valid JSON.${detail}`,
      );
    }
    verifyExtractedPackageManifest(packageManifest, packageEntry);
    packageDirectories.set(packageEntry.location, packageDirectory);
  }

  for (const root of plan.roots) {
    const expectedDirectory = packageDirectories.get(root.location);
    if (!expectedDirectory) {
      throw new Error(
        `Core runtime dependency root '${root.name}' is absent from its closure plan.`,
      );
    }
    assertResolvedClosurePackage(
      prepared,
      prepared.require,
      root.name,
      expectedDirectory,
      'Core runtime dependency root',
    );
  }
  for (const packageEntry of plan.packages) {
    const callerDirectory = packageDirectories.get(packageEntry.location);
    if (!callerDirectory) {
      throw new Error(
        `Core runtime dependency caller '${packageEntry.location}' is absent from its closure plan.`,
      );
    }
    const packageRequire = createRequire(
      path.join(callerDirectory, 'package.json'),
    );
    for (const edge of packageEntry.edges) {
      if (edge.location === null) {
        try {
          const ambientEntry = packageRequire.resolve(edge.name);
          throw new Error(
            `Planned package '${packageEntry.location}' omitted '${edge.name}', but generic CommonJS resolution selected ambient entry '${ambientEntry}'.`,
          );
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'MODULE_NOT_FOUND'
          ) {
            continue;
          }
          throw error;
        }
      }
      const expectedDirectory = packageDirectories.get(edge.location);
      if (!expectedDirectory) {
        throw new Error(
          `Core runtime dependency edge '${packageEntry.location}' -> '${edge.name}' is absent from its closure plan.`,
        );
      }
      assertResolvedClosurePackage(
        prepared,
        packageRequire,
        edge.name,
        expectedDirectory,
        `Planned package '${packageEntry.location}'`,
      );
    }
  }
  return packageDirectories;
}

/**
 * Verify that all packages that call node-gyp-build resolve the one patched
 * closure-local loader. A nested or parent fallback is rejected rather than
 * silently retaining the loader's ambient sidecar search behavior.
 * @param {PreparedCoreRuntimeDependencies} prepared - Prepared closure state.
 * @param {ReturnType<typeof createRequire>} packageRequire - Require scoped to a native caller.
 * @param {string} label - Native caller label.
 * @param {string} expectedLoaderPath - Canonical patched loader entry.
 * @returns {void}
 */
function assertPatchedNativeLoader(
  prepared,
  packageRequire,
  label,
  expectedLoaderPath,
) {
  const loaderPath = assertVerifiedRegularFile(
    prepared,
    packageRequire.resolve('node-gyp-build-optional-packages'),
    `${label} native addon loader`,
  );
  if (loaderPath !== expectedLoaderPath) {
    throw new Error(
      `${label} resolves a nested native addon loader instead of the verified patched loader.`,
    );
  }
}

/**
 * Load LMDB while replacing node-gyp-build's ambient prebuild search with
 * exact native bytes extracted from this SEA's verified closure.
 * @param {PreparedCoreRuntimeDependencies} prepared - Prepared closure state.
 * @returns {any} - LMDB module exports.
 */
function loadVerifiedLmdb(prepared) {
  if (prepared.lmdbModule) return prepared.lmdbModule;
  const dependencyRequire = prepared.require;
  const lmdbVersion = prepared.manifest.roots[0]?.version;
  const lmdbDirectory = getVerifiedPackageDirectory(
    prepared,
    'lmdb',
    lmdbVersion,
  );
  const lmdbEntryPath = assertVerifiedRegularFile(
    prepared,
    dependencyRequire.resolve('lmdb'),
    'LMDB CommonJS entry',
  );
  if (!isPathInside(lmdbDirectory, lmdbEntryPath)) {
    throw new Error(
      'LMDB CommonJS entry is outside its verified package root.',
    );
  }
  const lmdbRequire = createRequire(lmdbEntryPath);
  const loaderPath = assertVerifiedRegularFile(
    prepared,
    dependencyRequire.resolve('node-gyp-build-optional-packages'),
    'Native addon loader entry',
  );
  const resolverPath = assertVerifiedRegularFile(
    prepared,
    path.join(path.dirname(loaderPath), 'node-gyp-build.js'),
    'Native addon resolver entry',
  );
  /** @type {any} */
  let resolvedNativeResolver = null;
  withVerifiedNativeResolverEnvironment(prepared, 'lmdb', () => {
    resolvedNativeResolver = dependencyRequire(resolverPath);
    // Populate the exact closure-local cache entry before replacing its export.
    dependencyRequire(loaderPath);
  });
  const nativeResolver =
    /** @type {{resolve: (directory: string) => string}} */ (
      resolvedNativeResolver
    );
  if (!nativeResolver || typeof nativeResolver.resolve !== 'function') {
    throw new Error(
      'Verified native addon loader does not expose an ABI-aware resolver.',
    );
  }
  const loaderRecord = dependencyRequire.cache[loaderPath];
  if (!loaderRecord) {
    throw new Error(
      'Could not locate verified native addon loader cache entry.',
    );
  }
  const targetSuffix = `${prepared.manifest.target.platform}-${prepared.manifest.target.architecture}`;
  const lmdbNativePackage = `@lmdb/lmdb-${targetSuffix}`;
  const msgpackrExtractNativePackage = `@msgpackr-extract/msgpackr-extract-${targetSuffix}`;
  const msgpackrDirectory = getVerifiedPackageDirectory(prepared, 'msgpackr');
  const msgpackrEntryPath = assertResolvedClosurePackage(
    prepared,
    lmdbRequire,
    'msgpackr',
    msgpackrDirectory,
    'LMDB',
  );
  const msgpackrRequire = createRequire(msgpackrEntryPath);
  const msgpackrExtractDirectory = getVerifiedPackageDirectory(
    prepared,
    'msgpackr-extract',
  );
  const msgpackrExtractEntryPath = assertResolvedClosurePackage(
    prepared,
    msgpackrRequire,
    'msgpackr-extract',
    msgpackrExtractDirectory,
    'msgpackr',
  );
  const msgpackrExtractRequire = createRequire(msgpackrExtractEntryPath);
  assertPatchedNativeLoader(prepared, lmdbRequire, 'LMDB', loaderPath);
  assertPatchedNativeLoader(
    prepared,
    msgpackrExtractRequire,
    'msgpackr-extract',
    loaderPath,
  );
  /** @type {Map<string, string>} */
  const nativePackagesByDirectory = new Map([
    [lmdbDirectory, lmdbNativePackage],
    [msgpackrExtractDirectory, msgpackrExtractNativePackage],
  ]);
  const originalExports = loaderRecord.exports;
  loaderRecord.exports = (/** @type {unknown} */ directory) => {
    const requestedDirectory = assertVerifiedDirectory(
      prepared,
      String(directory),
      'Native addon loader directory',
    );
    const expectedNativePackage =
      nativePackagesByDirectory.get(requestedDirectory);
    if (!expectedNativePackage) {
      throw new Error(
        `Verified core dependency closure rejected native loader request for '${String(directory)}'.`,
      );
    }
    const addonPath = resolveVerifiedNativeAddon(
      prepared,
      nativeResolver,
      requestedDirectory,
      expectedNativePackage,
    );
    return dependencyRequire(addonPath);
  };
  try {
    const lmdb = dependencyRequire('lmdb');
    if (!lmdb || typeof lmdb.open !== 'function') {
      throw new Error('Verified LMDB closure did not export open().');
    }
    prepared.lmdbModule = lmdb;
    return lmdb;
  } finally {
    loaderRecord.exports = originalExports;
  }
}

/**
 * Read, verify, and materialize the core local durable-storage dependency
 * closure embedded in a SEA. The same verified LMDB graph backs distinct
 * control and application-state roots. Source execution is deliberately a no-op: it
 * continues to use its installed development dependencies.
 * @param {{assetProvider?: EmbeddedAssetProvider, readEmbeddedRevisionRuntimePair?: () => Promise<any>, tempParent?: string}} [options] - Controlled test hooks.
 * @returns {Promise<PreparedCoreRuntimeDependencies | null>} - Prepared closure or source-mode no-op.
 */
export async function preparePackagedCoreRuntimeDependencies(options = {}) {
  const hasExplicitProvider = Boolean(options.assetProvider);
  const assetProvider =
    options.assetProvider ||
    /** @type {EmbeddedAssetProvider} */ ({
      isSea: nodeIsSea,
      getAsset: nodeGetAsset,
    });
  if (!hasExplicitProvider && typeof assetProvider.isSea === 'function') {
    if (!assetProvider.isSea()) return null;
  }
  assertSeaAccess(assetProvider, hasExplicitProvider);
  if (preparedDependenciesPromise) return await preparedDependenciesPromise;

  const readIdentity =
    options.readEmbeddedRevisionRuntimePair || readEmbeddedRevisionRuntimePair;
  preparedDependenciesPromise = (async () => {
    const rawManifest = asAssetBytes(
      await assetProvider.getAsset(CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME),
      `Core runtime dependency asset '${CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME}'`,
    );
    let parsedManifest;
    try {
      parsedManifest = JSON.parse(rawManifest.toString('utf8'));
    } catch {
      throw new Error('Core runtime dependency manifest is not valid JSON.');
    }
    const manifest = validateCoreRuntimeDependencyManifest(parsedManifest);
    const archiveBytes = asAssetBytes(
      await assetProvider.getAsset(manifest.archive.assetName),
      `Core runtime dependency asset '${manifest.archive.assetName}'`,
    );
    const actualArchiveDigest = createHash('sha256')
      .update(archiveBytes)
      .digest('base64url');
    if (actualArchiveDigest !== manifest.archive.digest.value) {
      throw new Error(
        'Core runtime dependency archive does not match its embedded receipt.',
      );
    }
    const embedded = await readIdentity();
    assertRuntimeTarget(manifest, embedded);
    const owner = getRuntimeExtractionOwnerIdentity();
    const filesystemUid = getRuntimeFilesystemUid();
    if (filesystemUid === null) {
      throw new Error(
        'Core runtime dependency extraction requires a POSIX filesystem principal.',
      );
    }
    const tempParent =
      options.tempParent ||
      path.join(
        tmpdir(),
        `${CORE_RUNTIME_DEPENDENCY_TEMP_DIRECTORY}-uid${filesystemUid}-h${owner.hostToken}`,
      );
    await scavengeStaleRuntimeExtractionRoots(tempParent, owner);
    const root = await createFreshPrivateRoot(
      tempParent,
      `closure-v2-${actualArchiveDigest.slice(0, 16)}`,
      owner,
    );
    try {
      await extractCoreRuntimeDependencyArchive(archiveBytes, root);
      const prepared = {
        root,
        require: createRequire(path.join(root, 'package.json')),
        manifest,
        archiveBytes,
        lmdbModule: null,
        packageDirectories: /** @type {Map<string, string>} */ (new Map()),
      };
      prepared.packageDirectories =
        await preflightCoreRuntimeDependencyClosure(prepared);
      preparedDependencies = prepared;
      installPreparedDependencyExitCleanup();
      return prepared;
    } catch (error) {
      await rm(root, { force: true, recursive: true });
      throw error;
    }
  })();
  try {
    return await preparedDependenciesPromise;
  } catch (error) {
    preparedDependenciesPromise = null;
    preparedDependencies = null;
    throw error;
  }
}

/**
 * Return one exact module from the prepared SEA closure. Calling this before
 * bootstrap preparation fails closed instead of reaching ambient modules.
 * @param {'lmdb'} name - Supported core native dependency.
 * @returns {any} - Verified module exports.
 */
export function requirePackagedCoreRuntimeDependency(name) {
  if (name !== 'lmdb') {
    throw new Error(`Unsupported packaged core dependency '${String(name)}'.`);
  }
  if (!preparedDependencies) {
    throw new Error(
      'Packaged core dependencies were not prepared before LMDB was requested.',
    );
  }
  return loadVerifiedLmdb(preparedDependencies);
}

/**
 * Test-only cleanup for independently injected asset providers.
 * @returns {Promise<void>} - Completes after resetting local state.
 */
export async function _resetPackagedCoreRuntimeDependenciesForTest() {
  const prepared = preparedDependencies;
  preparedDependencies = null;
  preparedDependenciesPromise = null;
  if (prepared) {
    await rm(prepared.root, { force: true, recursive: true });
  }
}

export default {
  _resetPackagedCoreRuntimeDependenciesForTest,
  preparePackagedCoreRuntimeDependencies,
  requirePackagedCoreRuntimeDependency,
};
