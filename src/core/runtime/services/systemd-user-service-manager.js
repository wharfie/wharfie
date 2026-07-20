import { execFile as nodeExecFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import net from 'node:net';
import { userInfo } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { getLocalAppStorageLayout } from '../../lib/config/local-app-storage-context.js';
import { createControlDBClient } from '../../lib/config/db.js';
import {
  LedgerServiceLifecycleStatus,
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
} from '../../lib/db/tables/ledger-service-lifecycle.js';
import { resolveStableLocalAppDataRoot } from '../local-app-storage.js';
import {
  getRunningExecutablePath,
  inspectArtifactBytes,
} from '../packaged-artifact.js';
import { probeLocalServiceSession } from '../local-service-session.js';
import { readEmbeddedRevisionRuntimePair } from '../../resources/builds/lib/revision-runtime-assets.js';
import {
  createSystemdUserServiceInstallation,
  createSystemdUserServiceLayout,
  createSystemdUserServiceRelease,
  createSystemdUserServiceUnit,
  parseSystemdUserServiceStatus,
  validateSystemdUserServiceInstallation,
  validateSystemdUserServiceRelease,
} from './systemd-user-service.js';

const SERVICE_RESULT_SCHEMA_VERSION = 1;
const SERVICE_RESULT_KIND = 'wharfie.service.result';
const SERVICE_STATUS_KIND = 'wharfie.service.status';
const UNINSTALL_MARKER_KIND = 'wharfie.systemd-user-service.uninstall-marker';
const DEFAULT_START_TIMEOUT_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 50_000;
const DEFAULT_POLL_INTERVAL_MS = 200;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MAX_PROCESS_DURATION_MS = 60_000;
const MAX_SERVICE_RECORD_BYTES = 64 * 1024;
const PACKAGED_STORAGE_LAYOUT_KEYS = Object.freeze([
  'appId',
  'dataRoot',
  'stateRoot',
  'controlPath',
  'payloadPath',
  'applicationStatePath',
  'sessionPath',
  'executionLedgerTable',
]);
const SYSTEMD_SHOW_PROPERTIES = Object.freeze([
  'LoadState',
  'UnitFileState',
  'ActiveState',
  'SubState',
  'Result',
  'MainPID',
  'ExecMainStatus',
  'FragmentPath',
  'DropInPaths',
  'NeedDaemonReload',
]);

/**
 * @typedef SystemdUserServiceProcessResult
 * @property {string} stdout - Bounded standard output.
 * @property {string} stderr - Bounded standard error.
 */

/**
 * @param {string} command - Executable name.
 * @param {string[]} args - Exact argv array.
 * @param {{timeoutMs?: number}} [options] - Bounded execution options.
 * @returns {Promise<SystemdUserServiceProcessResult>} - Completed process result.
 */
function runProcess(command, args, options = {}) {
  const timeoutMs = positiveDuration(
    options.timeoutMs,
    'systemd user service process timeoutMs',
    MAX_PROCESS_DURATION_MS,
  );
  return new Promise((resolve, reject) => {
    nodeExecFile(
      command,
      args,
      {
        encoding: 'utf8',
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        timeout: Math.min(timeoutMs, MAX_PROCESS_DURATION_MS),
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const safeStderr = String(stderr || '')
            .trim()
            .slice(0, 4096);
          const timedOut = /** @type {any} */ (error).killed === true;
          const failure = new Error(
            `${command} ${timedOut ? 'timed out' : 'failed'}${safeStderr ? `: ${safeStderr}` : '.'}`,
          );
          failure.name = 'SystemdUserServiceProcessError';
          Object.assign(failure, {
            code: 'systemd-user-service-process-failed',
            command,
            timedOut,
            exitCode:
              typeof (/** @type {any} */ (error).code) === 'number'
                ? /** @type {any} */ (error).code
                : undefined,
            cause: error,
          });
          reject(failure);
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * @param {unknown} error - Candidate filesystem error.
 * @param {string} code - Expected code.
 * @returns {boolean} - Whether code matches.
 */
function hasCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    String(error.code) === code
  );
}

/**
 * @param {unknown} value - Candidate positive duration.
 * @param {string} label - Boundary label.
 * @param {number} fallback - Default duration.
 * @returns {number} - Validated duration.
 */
function positiveDuration(value, label, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * Parse the live user manager's shell-quoted UnitPath array without invoking a
 * shell. systemctl quotes individual entries when needed and uses C-style
 * escapes inside those words.
 * @param {unknown} value - `systemctl --user show --property=UnitPath --value` output.
 * @returns {string[]} - Canonical absolute search directories.
 */
export function parseSystemdUserManagerUnitPath(value) {
  const invalid = () =>
    new Error('Systemd user manager returned an invalid UnitPath.');
  if (typeof value !== 'string') {
    throw invalid();
  }
  const text = value.trim();
  if (
    !text ||
    text.includes('\0') ||
    text.includes('\n') ||
    text.includes('\r')
  ) {
    throw invalid();
  }

  /** @type {Readonly<Record<string, string>>} */
  const simpleEscapes = Object.freeze({
    a: '\x07',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    s: ' ',
    t: '\t',
    v: '\v',
    '\\': '\\',
    '"': '"',
    "'": "'",
    $: '$',
    '`': '`',
    '!': '!',
    ' ': ' ',
  });
  /** @type {string[]} */
  const entries = [];
  let entry = '';
  let quoted = false;
  let started = false;
  for (let offset = 0; offset < text.length; offset += 1) {
    const character = text[offset];
    if (!quoted && character === ' ') {
      if (started) entries.push(entry);
      entry = '';
      started = false;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (character !== '\\') {
      entry += character;
      started = true;
      continue;
    }

    const escape = text[offset + 1];
    if (escape === undefined) throw invalid();
    if (Object.prototype.hasOwnProperty.call(simpleEscapes, escape)) {
      entry += simpleEscapes[escape];
      started = true;
      offset += 1;
      continue;
    }
    if (escape === 'x') {
      const hexadecimal = text.slice(offset + 2, offset + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hexadecimal)) throw invalid();
      entry += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      started = true;
      offset += 3;
      continue;
    }
    if (/[0-7]/.test(escape)) {
      const octal = text.slice(offset + 1, offset + 4);
      if (!/^[0-7]{3}$/.test(octal)) throw invalid();
      entry += String.fromCharCode(Number.parseInt(octal, 8));
      started = true;
      offset += 3;
      continue;
    }
    throw invalid();
  }
  if (quoted) throw invalid();
  if (started) entries.push(entry);
  if (
    entries.length === 0 ||
    entries.some(
      (entry) =>
        entry.includes('\0') ||
        entry.includes('\n') ||
        entry.includes('\r') ||
        !path.isAbsolute(entry) ||
        path.normalize(entry) !== entry,
    )
  ) {
    throw invalid();
  }
  return entries;
}

/**
 * Sync a directory entry after an atomic rename or link replacement.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} directory - Directory to sync.
 * @returns {Promise<void>} - Resolves after sync.
 */
async function syncDirectory(fsOps, directory) {
  const handle = await fsOps.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * @param {import('node:fs').Stats} stats - Opened or lstat filesystem state.
 * @param {'file'|'directory'} kind - Required concrete type.
 * @param {string} label - Safe boundary label.
 * @param {number | undefined} expectedUid - Required owner when supplied.
 * @returns {void} - Returns for a private, owned concrete object.
 */
function assertManagedStats(stats, kind, label, expectedUid) {
  const matches = kind === 'file' ? stats.isFile() : stats.isDirectory();
  if (!matches || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real ${kind}.`);
  }
  if (
    expectedUid !== undefined &&
    typeof stats.uid === 'number' &&
    stats.uid !== expectedUid
  ) {
    throw new Error(`${label} must be owned by the service user.`);
  }
  if ((stats.mode & 0o022) !== 0) {
    throw new Error(`${label} must not be writable by group or other users.`);
  }
}

/**
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} targetPath - Managed path.
 * @param {'file'|'directory'} kind - Required concrete type.
 * @param {string} label - Safe boundary label.
 * @param {number} [expectedUid] - Required owner.
 * @returns {Promise<import('node:fs').Stats>} - Non-link filesystem state.
 */
async function assertRealPath(fsOps, targetPath, kind, label, expectedUid) {
  const stats = await fsOps.lstat(targetPath);
  assertManagedStats(stats, kind, label, expectedUid);
  return stats;
}

/**
 * Read one bounded managed record through a no-follow file descriptor. The
 * descriptor, rather than a second pathname lookup, owns the bytes parsed.
 * @param {{fsOps: typeof fsp, filePath: string, label: string, uid: number, maxBytes?: number}} options - Record boundary.
 * @returns {Promise<string>} - Stable UTF-8 contents.
 */
async function readManagedTextFile(options) {
  const handle = await options.fsOps.open(
    options.filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    const before = await handle.stat();
    assertManagedStats(before, 'file', options.label, options.uid);
    const maximum = options.maxBytes || MAX_SERVICE_RECORD_BYTES;
    if (before.size > maximum) {
      throw new Error(`${options.label} exceeds its byte limit.`);
    }
    const contents = await handle.readFile({ encoding: 'utf8' });
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      Buffer.byteLength(contents, 'utf8') > maximum
    ) {
      throw new Error(`${options.label} changed while it was being read.`);
    }
    return contents;
  } finally {
    await handle.close();
  }
}

/**
 * Create and validate one managed directory only after its parent has already
 * been validated by the caller.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} directory - Directory to create or reuse.
 * @param {string} label - Boundary label.
 * @param {number} uid - Required owner.
 * @returns {Promise<void>} - Resolves for a private real directory.
 */
async function ensureManagedDirectory(fsOps, directory, label, uid) {
  await fsOps.mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await fsOps.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
  if (typeof stats.uid === 'number' && stats.uid !== uid) {
    throw new Error(`${label} must be owned by the service user.`);
  }
  if ((stats.mode & 0o077) !== 0) {
    await fsOps.chmod(directory, 0o700);
  }
  await assertRealPath(fsOps, directory, 'directory', label, uid);
}

/**
 * Establish the exact app-owned data tree component by component so a managed
 * ancestor cannot redirect later reads or writes through a symbolic link.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {Readonly<Record<string, string>>} layout - Derived layout.
 * @param {number} uid - Required filesystem owner.
 * @returns {Promise<void>} - Resolves after the service root is safe.
 */
async function ensureManagedServiceRoot(fsOps, layout, uid) {
  await ensureManagedDirectory(
    fsOps,
    layout.dataRoot,
    'Wharfie data root',
    uid,
  );
  const applicationsRoot = path.dirname(layout.serviceRoot);
  await ensureManagedDirectory(
    fsOps,
    applicationsRoot,
    'Wharfie applications root',
    uid,
  );
  await ensureManagedDirectory(
    fsOps,
    layout.serviceRoot,
    'Systemd user-service root',
    uid,
  );
}

/**
 * Validate an existing app-owned data tree without creating it.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {Readonly<Record<string, string>>} layout - Derived layout.
 * @param {number} uid - Required filesystem owner.
 * @returns {Promise<boolean>} - Whether the complete service root exists.
 */
async function hasManagedServiceRoot(fsOps, layout, uid) {
  try {
    await fsOps.lstat(layout.serviceRoot);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
  const directories = [
    [layout.dataRoot, 'Wharfie data root'],
    [path.dirname(layout.serviceRoot), 'Wharfie applications root'],
    [layout.serviceRoot, 'Systemd user-service root'],
  ];
  for (const [directory, label] of directories) {
    try {
      await assertRealPath(fsOps, directory, 'directory', label, uid);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return false;
      throw error;
    }
  }
  return true;
}

/**
 * Establish the fixed user-unit directory component by component.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {Readonly<Record<string, string>>} layout - Derived layout.
 * @param {number} uid - Required filesystem owner.
 * @returns {Promise<void>} - Resolves after the unit parent is safe.
 */
async function ensureManagedUnitDirectory(fsOps, layout, uid) {
  await ensureManagedDirectory(
    fsOps,
    layout.configRoot,
    'Wharfie config root',
    uid,
  );
  const systemdRoot = path.join(layout.configRoot, 'systemd');
  await ensureManagedDirectory(
    fsOps,
    systemdRoot,
    'Systemd user config root',
    uid,
  );
  await ensureManagedDirectory(
    fsOps,
    path.dirname(layout.unitPath),
    'Systemd user unit directory',
    uid,
  );
}

/**
 * Validate the existing fixed user-unit directory component by component.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {Readonly<Record<string, string>>} layout - Derived layout.
 * @param {number} uid - Required filesystem owner.
 * @returns {Promise<void>} - Resolves after the unit parent is safe.
 */
async function assertManagedUnitDirectory(fsOps, layout, uid) {
  const directories = [
    [layout.configRoot, 'Wharfie config root'],
    [path.join(layout.configRoot, 'systemd'), 'Systemd user config root'],
    [path.dirname(layout.unitPath), 'Systemd user unit directory'],
  ];
  for (const [directory, label] of directories) {
    await assertRealPath(fsOps, directory, 'directory', label, uid);
  }
}

/**
 * Atomically publish a small file without following an existing destination
 * symlink during the write.
 * @param {{fsOps: typeof fsp, filePath: string, contents: string, mode: number, token: string, uid: number}} options - Publication inputs.
 * @returns {Promise<void>} - Resolves after file and parent sync.
 */
async function writeFileAtomic(options) {
  const parent = path.dirname(options.filePath);
  const temporary = path.join(
    parent,
    `.${path.basename(options.filePath)}.${options.token}.tmp`,
  );
  await options.fsOps.mkdir(parent, { recursive: true, mode: 0o700 });
  await assertRealPath(
    options.fsOps,
    parent,
    'directory',
    'Managed publication directory',
    options.uid,
  );
  let handle;
  try {
    handle = await options.fsOps.open(
      temporary,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      options.mode,
    );
    await handle.writeFile(options.contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await options.fsOps.rename(temporary, options.filePath);
    await assertRealPath(
      options.fsOps,
      options.filePath,
      'file',
      'Managed published file',
      options.uid,
    );
    await syncDirectory(options.fsOps, parent);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await options.fsOps.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/**
 * Atomically select one immutable release using a relative same-directory
 * symlink. `rename` replaces an earlier symlink without an absent window.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, artifactId: string, token: string}} options - Selection inputs.
 * @returns {Promise<void>} - Resolves after the parent directory is synced.
 */
async function selectRelease(options) {
  const releaseDirectory = path.join(
    options.layout.releasesRoot,
    options.artifactId,
  );
  const relative = path.relative(options.layout.serviceRoot, releaseDirectory);
  const temporary = path.join(
    options.layout.serviceRoot,
    `.current.${options.token}.tmp`,
  );
  try {
    await options.fsOps.symlink(relative, temporary, 'dir');
    await options.fsOps.rename(temporary, options.layout.currentLink);
    await syncDirectory(options.fsOps, options.layout.serviceRoot);
  } catch (error) {
    await options.fsOps.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/**
 * @param {Readonly<Record<string, any>>} left - Byte observation.
 * @param {Readonly<Record<string, any>>} right - Byte observation.
 * @returns {boolean} - Exact byte identity match.
 */
function hasSameArtifactBytes(left, right) {
  return (
    left.artifactId === right.artifactId &&
    left.size === right.size &&
    left.byteDigest?.algorithm === right.byteDigest?.algorithm &&
    left.byteDigest?.value === right.byteDigest?.value
  );
}

/**
 * Validate the private phase marker that makes destructive manager-wiring
 * removal retryable. The marker is published only after systemd confirms the
 * unit is disabled and inactive.
 * @param {unknown} value - Parsed marker.
 * @param {{appId: string, unitName: string, uid: number, artifactId?: string, revisionId?: string}} expected - Exact installation binding.
 * @returns {Readonly<Record<string, any>>} - Exact marker.
 */
function validateUninstallMarker(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Systemd user-service uninstall marker is malformed.');
  }
  const marker = /** @type {Record<string, any>} */ (value);
  const keys = [
    'schemaVersion',
    'kind',
    'appId',
    'unitName',
    'uid',
    'artifactId',
    'revisionId',
  ];
  if (
    Object.keys(marker).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(marker, key)) ||
    marker.schemaVersion !== 1 ||
    marker.kind !== UNINSTALL_MARKER_KIND ||
    marker.appId !== expected.appId ||
    marker.unitName !== expected.unitName ||
    marker.uid !== expected.uid ||
    typeof marker.artifactId !== 'string' ||
    marker.artifactId.length === 0 ||
    typeof marker.revisionId !== 'string' ||
    marker.revisionId.length === 0 ||
    (expected.artifactId !== undefined &&
      marker.artifactId !== expected.artifactId) ||
    (expected.revisionId !== undefined &&
      marker.revisionId !== expected.revisionId)
  ) {
    throw new Error(
      'Systemd user-service uninstall marker disagrees with the installation.',
    );
  }
  return Object.freeze({ ...marker });
}

/**
 * Stage exact current executable bytes in an immutable content-addressed
 * release. Existing releases are rehashed before reuse.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, uid: number, artifactPath: string, artifact: Readonly<Record<string, any>>, pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, installedAt: number, token: string, inspectBytes: typeof inspectArtifactBytes}} options - Release inputs.
 * @returns {Promise<Readonly<Record<string, any>>>} - Verified release record.
 */
async function stageRelease(options) {
  const releaseDirectory = path.join(
    options.layout.releasesRoot,
    options.artifact.artifactId,
  );
  const releaseArtifactPath = path.join(releaseDirectory, 'app');
  const releaseRecordPath = path.join(releaseDirectory, 'release.json');

  /** @returns {Promise<Readonly<Record<string, any>>>} - Existing verified release. */
  const readExisting = async () => {
    await assertRealPath(
      options.fsOps,
      options.layout.releasesRoot,
      'directory',
      'Systemd user-service releases root',
      options.uid,
    );
    await assertRealPath(
      options.fsOps,
      releaseDirectory,
      'directory',
      'Systemd user-service release directory',
      options.uid,
    );
    await assertRealPath(
      options.fsOps,
      releaseRecordPath,
      'file',
      'Systemd user-service release receipt',
      options.uid,
    );
    await assertRealPath(
      options.fsOps,
      releaseArtifactPath,
      'file',
      'Systemd user-service release artifact',
      options.uid,
    );
    const parsed = JSON.parse(
      await readManagedTextFile({
        fsOps: options.fsOps,
        filePath: releaseRecordPath,
        label: 'Systemd user-service release receipt',
        uid: options.uid,
      }),
    );
    const release = validateSystemdUserServiceRelease(parsed);
    if (
      release.appId !== options.pair.runtime.appId ||
      release.revisionId !== options.pair.runtime.revisionId ||
      release.artifactPath !== releaseArtifactPath ||
      !hasSameArtifactBytes(release, options.artifact)
    ) {
      throw new Error(
        'Existing systemd user-service release does not match the packaged artifact.',
      );
    }
    const observed = await options.inspectBytes(releaseArtifactPath);
    if (!hasSameArtifactBytes(observed, options.artifact)) {
      throw new Error(
        'Existing systemd user-service release bytes failed verification.',
      );
    }
    return release;
  };

  try {
    return await readExisting();
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }

  await options.fsOps.mkdir(options.layout.releasesRoot, {
    recursive: true,
    mode: 0o700,
  });
  await assertRealPath(
    options.fsOps,
    options.layout.releasesRoot,
    'directory',
    'Systemd user-service releases root',
    options.uid,
  );
  const temporaryDirectory = path.join(
    options.layout.releasesRoot,
    `.${options.artifact.artifactId}.${options.token}.tmp`,
  );
  try {
    await options.fsOps.mkdir(temporaryDirectory, { mode: 0o700 });
    const temporaryArtifact = path.join(temporaryDirectory, 'app');
    await options.fsOps.copyFile(
      options.artifactPath,
      temporaryArtifact,
      fsConstants.COPYFILE_EXCL,
    );
    await options.fsOps.chmod(temporaryArtifact, 0o500);
    await assertRealPath(
      options.fsOps,
      temporaryArtifact,
      'file',
      'Staged systemd user-service artifact',
      options.uid,
    );
    const copied = await options.inspectBytes(temporaryArtifact);
    if (!hasSameArtifactBytes(copied, options.artifact)) {
      throw new Error(
        'Packaged artifact changed while its service release was staged.',
      );
    }
    const release = createSystemdUserServiceRelease({
      appId: options.pair.runtime.appId,
      artifactId: copied.artifactId,
      revisionId: options.pair.runtime.revisionId,
      byteDigest: copied.byteDigest,
      size: copied.size,
      target: options.pair.runtime.target,
      installedAt: options.installedAt,
      artifactPath: releaseArtifactPath,
    });
    const releaseRecord = path.join(temporaryDirectory, 'release.json');
    const recordHandle = await options.fsOps.open(
      releaseRecord,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o400,
    );
    try {
      await recordHandle.writeFile(`${JSON.stringify(release, null, 2)}\n`);
      await recordHandle.sync();
    } finally {
      await recordHandle.close();
    }
    const artifactHandle = await options.fsOps.open(temporaryArtifact, 'r');
    try {
      await artifactHandle.sync();
    } finally {
      await artifactHandle.close();
    }
    // Commit the staged directory entries before publishing the directory
    // itself into the content-addressed release namespace.
    await syncDirectory(options.fsOps, temporaryDirectory);
    try {
      await options.fsOps.rename(temporaryDirectory, releaseDirectory);
    } catch (error) {
      if (!hasCode(error, 'EEXIST') && !hasCode(error, 'ENOTEMPTY')) {
        throw error;
      }
      await options.fsOps.chmod(temporaryDirectory, 0o700);
      await options.fsOps.rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
      return await readExisting();
    }
    await syncDirectory(options.fsOps, options.layout.releasesRoot);
    return release;
  } catch (error) {
    await options.fsOps.chmod(temporaryDirectory, 0o700).catch(() => undefined);
    await options.fsOps
      .rm(temporaryDirectory, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
}

/**
 * Verify that the installed selector still names the exact immutable regular
 * file and receipt recorded by the installation. This is intentionally done
 * before start/restart and for each explicit status observation.
 * @param {{fsOps: typeof fsp, installation: Readonly<Record<string, any>>, inspectBytes: typeof inspectArtifactBytes, uid: number}} options - Installed selection.
 * @returns {Promise<Readonly<Record<string, any>>>} - Verified integrity view.
 */
async function verifyInstalledSelection(options) {
  const { installation } = options;
  const layout = installation.layout;
  if (!(await hasManagedServiceRoot(options.fsOps, layout, options.uid))) {
    throw new Error('Installed systemd user-service root is missing.');
  }
  for (const [directory, label] of [
    [layout.stateRoot, 'Installed systemd user-service state root'],
    [layout.controlPath, 'Installed systemd user-service control root'],
    [
      layout.applicationStatePath,
      'Installed systemd user-service application-state root',
    ],
  ]) {
    await assertRealPath(
      options.fsOps,
      directory,
      'directory',
      label,
      options.uid,
    );
  }
  await assertManagedUnitDirectory(options.fsOps, layout, options.uid);
  const unit = await readManagedTextFile({
    fsOps: options.fsOps,
    filePath: layout.unitPath,
    label: 'Installed systemd user unit',
    uid: options.uid,
  });
  if (unit !== createSystemdUserServiceUnit({ layout })) {
    throw new Error('Installed systemd user unit was changed.');
  }
  const expectedLink = path.join('releases', installation.current.artifactId);
  const linkStats = await options.fsOps.lstat(layout.currentLink);
  if (!linkStats.isSymbolicLink()) {
    throw new Error(
      'Installed systemd user-service current selection must be a symbolic link.',
    );
  }
  const selected = await options.fsOps.readlink(layout.currentLink);
  if (selected !== expectedLink) {
    throw new Error(
      'Installed systemd user-service current selection was changed.',
    );
  }

  const releaseDirectory = path.join(
    layout.releasesRoot,
    installation.current.artifactId,
  );
  const releasePath = path.join(releaseDirectory, 'release.json');
  await assertRealPath(
    options.fsOps,
    layout.releasesRoot,
    'directory',
    'Installed systemd user-service releases root',
    options.uid,
  );
  await assertRealPath(
    options.fsOps,
    releaseDirectory,
    'directory',
    'Installed systemd user-service release directory',
    options.uid,
  );
  await assertRealPath(
    options.fsOps,
    releasePath,
    'file',
    'Installed systemd user-service release receipt',
    options.uid,
  );
  await assertRealPath(
    options.fsOps,
    installation.current.artifactPath,
    'file',
    'Installed systemd user-service artifact',
    options.uid,
  );
  const release = validateSystemdUserServiceRelease(
    JSON.parse(
      await readManagedTextFile({
        fsOps: options.fsOps,
        filePath: releasePath,
        label: 'Installed systemd user-service release receipt',
        uid: options.uid,
      }),
    ),
  );
  if (JSON.stringify(release) !== JSON.stringify(installation.current)) {
    throw new Error(
      'Installed systemd user-service release receipt was changed.',
    );
  }
  const observed = await options.inspectBytes(
    installation.current.artifactPath,
  );
  if (!hasSameArtifactBytes(observed, installation.current)) {
    throw new Error(
      'Installed systemd user-service artifact bytes were changed.',
    );
  }
  return Object.freeze({
    status: 'verified',
    artifactId: installation.current.artifactId,
    revisionId: installation.current.revisionId,
  });
}

/**
 * Acquire one kernel-held operation lock in Linux's abstract Unix-socket
 * namespace. Bind is atomic across processes, and the address disappears when
 * the owning process exits, so recovery needs no stale-file deletion or PID
 * reuse heuristic.
 * @param {{serviceRoot: string, uid: number, createServer?: typeof net.createServer}} options - Lock identity and test seam.
 * @returns {Promise<() => Promise<void>>} - Idempotent release callback.
 */
async function acquireOperationLock(options) {
  const digest = createHash('sha256')
    .update('wharfie:systemd-user-service-operation-lock:v1', 'utf8')
    .update('\0', 'utf8')
    .update(String(options.uid), 'utf8')
    .update('\0', 'utf8')
    .update(options.serviceRoot, 'utf8')
    .digest('base64url');
  const address = `\0wharfie-service-op-${options.uid}-${digest}`;
  const createServer = options.createServer || net.createServer;
  const server = createServer((socket) => socket.destroy());
  // A post-bind server error must not become an uncaught EventEmitter error.
  server.on('error', () => undefined);

  try {
    await new Promise((resolve, reject) => {
      /** @param {Error} error - Bind failure. */
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onListening = () => {
        cleanup();
        resolve(undefined);
      };
      const cleanup = () => {
        server.removeListener('error', onError);
        server.removeListener('listening', onListening);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(address);
    });
  } catch (error) {
    await new Promise((resolve) =>
      server.close(() => resolve(undefined)),
    ).catch(() => undefined);
    if (hasCode(error, 'EADDRINUSE')) {
      throw new Error(
        'Another systemd user-service operation is already active.',
      );
    }
    throw error;
  }
  server.unref();

  let released = false;
  return async () => {
    if (released) return;
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(undefined);
      });
    });
    released = true;
  };
}

/**
 * @param {Readonly<Record<string, string>>} expected - Expected layout.
 * @param {Readonly<Record<string, string>>} actual - Persisted layout.
 * @returns {void} - Returns when every derived path matches.
 */
function assertSameLayout(expected, actual) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(
        `Installed systemd user-service layout differs at ${key}.`,
      );
    }
  }
}

/**
 * Build a redacted runtime observation from lifecycle, ownership, and the
 * process-held liveness endpoint.
 * @param {{layout: Readonly<Record<string, string>>, appId: string, createDB?: typeof createControlDBClient, probeSession?: typeof probeLocalServiceSession, fsOps?: typeof fsp}} options - Observation inputs.
 * @returns {Promise<Readonly<Record<string, any>> | null>} - Runtime state when durable control state exists.
 */
async function readRuntimeState(options) {
  const fsOps = options.fsOps || fsp;
  try {
    const state = await fsOps.stat(options.layout.controlPath);
    if (!state.isDirectory()) {
      return Object.freeze({ status: 'UNAVAILABLE', session: 'unknown' });
    }
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
  const createDB = options.createDB || createControlDBClient;
  const probeSession = options.probeSession || probeLocalServiceSession;
  let db;
  try {
    db = await createDB('lmdb', {
      path: options.layout.controlPath,
      readOnly: true,
    });
    const serviceId = createLedgerServiceId({ appId: options.appId });
    const lifecycleStore = createLedgerServiceLifecycle({
      db,
      tableName: options.layout.executionLedgerTable,
    });
    const ownershipStore = createLedgerServiceOwnership({
      db,
      tableName: options.layout.executionLedgerTable,
    });
    const [lifecycle, ownership] = await Promise.all([
      lifecycleStore.get({ serviceId }),
      ownershipStore.getOwnership({ serviceId }),
    ]);
    let session = 'absent';
    let processId;
    if (ownership?.ownerKind === LedgerServiceOwnerKind.RESIDENT) {
      const observed = await probeSession({
        serviceId,
        sessionId: ownership.sessionId,
        sessionRoot: options.layout.sessionPath,
      });
      session = observed.status;
      processId = observed.processId;
    } else if (ownership) {
      session = 'manual';
    }
    if (!lifecycle && !ownership) return null;
    return Object.freeze({
      status: lifecycle?.status || 'UNKNOWN',
      revisionId: lifecycle?.revisionId,
      generation: lifecycle?.generation,
      ownerKind: ownership?.ownerKind,
      ownerGeneration: ownership?.generation,
      session,
      ...(processId === undefined ? {} : { processId }),
      currentOwner:
        lifecycle?.sessionId !== undefined &&
        lifecycle.sessionId === ownership?.sessionId,
    });
  } finally {
    await db?.close?.();
  }
}

/**
 * @param {Readonly<Record<string, any>>} installation - Installed selection.
 * @param {Readonly<Record<string, any>>} systemd - Parsed manager status.
 * @param {Readonly<Record<string, any>> | null} runtime - Durable runtime state.
 * @param {Readonly<Record<string, any>>} integrity - Installed byte selection.
 * @param {Readonly<Record<string, any>>} persistence - Boot-persistence state.
 * @returns {'healthy'|'starting'|'stopped'|'failed'|'degraded'} - Finite health classification.
 */
function classifyHealth(
  installation,
  systemd,
  runtime,
  integrity,
  persistence,
) {
  if (systemd.activeState === 'failed' || systemd.result === 'failed') {
    return 'failed';
  }
  if (integrity.status !== 'verified') return 'degraded';
  if (
    persistence.bootEnabled === true &&
    systemd.loadState === 'loaded' &&
    systemd.activeState === 'active' &&
    systemd.subState === 'running' &&
    systemd.mainPid > 0 &&
    systemd.execMainStatus === 0 &&
    runtime?.status === LedgerServiceLifecycleStatus.READY &&
    runtime.revisionId === installation.current.revisionId &&
    runtime.ownerKind === LedgerServiceOwnerKind.RESIDENT &&
    runtime.session === 'active' &&
    runtime.processId === systemd.mainPid &&
    runtime.currentOwner === true
  ) {
    return 'healthy';
  }
  if (
    systemd.activeState === 'activating' ||
    (systemd.activeState === 'active' &&
      runtime?.status === LedgerServiceLifecycleStatus.STARTING)
  ) {
    return 'starting';
  }
  if (
    systemd.activeState === 'inactive' &&
    (!runtime ||
      (runtime.status === LedgerServiceLifecycleStatus.STOPPED &&
        runtime.ownerKind === undefined))
  ) {
    return 'stopped';
  }
  return 'degraded';
}

/**
 * @param {string} payloadPath - Canonical local payload root.
 * @returns {string} - Default logical payload-store identity.
 */
function defaultPayloadStoreId(payloadPath) {
  const digest = createHash('sha256')
    .update(path.resolve(payloadPath), 'utf8')
    .digest('hex');
  return `payload-${digest.slice(0, 55)}`;
}

/**
 * Refuse service management unless the packaged bootstrap and every explicit
 * durable-storage override agree with the fixed resident layout. This turns a
 * silent split-ledger failure into an actionable boundary error.
 * @param {Readonly<Record<string, string>>} layout - Derived systemd service layout.
 * @param {Readonly<Record<string, string>> | undefined} packagedStorage - Active packaged bootstrap authority.
 * @param {Record<string, string | undefined>} environment - Ambient explicit overrides.
 * @returns {void} - Returns after exact agreement is established.
 */
function assertSharedPackagedStorage(layout, packagedStorage, environment) {
  if (!packagedStorage) {
    throw new Error(
      'Systemd user-service management requires packaged app storage context.',
    );
  }
  for (const key of PACKAGED_STORAGE_LAYOUT_KEYS) {
    if (packagedStorage[key] !== layout[key]) {
      throw new Error(
        `Packaged app storage disagrees with the systemd service layout at ${key}.`,
      );
    }
  }
  if (packagedStorage.appRoot !== layout.serviceRoot) {
    throw new Error(
      'Packaged app storage disagrees with the systemd service application root.',
    );
  }

  const expected = Object.freeze({
    WHARFIE_CONTROL_ADAPTER: 'lmdb',
    WHARFIE_CONTROL_PATH: layout.controlPath,
    WHARFIE_EXECUTION_PAYLOAD_PATH: layout.payloadPath,
    WHARFIE_EXECUTION_PAYLOAD_STORE_ID: defaultPayloadStoreId(
      layout.payloadPath,
    ),
    WHARFIE_EXECUTION_LEDGER_TABLE: layout.executionLedgerTable,
    WHARFIE_LEDGER_SERVICE_SESSION_PATH: layout.sessionPath,
    WHARFIE_APPLICATION_STATE_ADAPTER: 'lmdb',
    WHARFIE_APPLICATION_STATE_PATH: layout.applicationStatePath,
  });
  for (const [name, expectedValue] of Object.entries(expected)) {
    const raw = environment[name];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const actual = raw.trim();
    const matches = name.endsWith('_ADAPTER')
      ? actual.toLowerCase() === expectedValue
      : actual === expectedValue;
    if (!matches) {
      throw new Error(
        `${name} redirects packaged commands away from the fixed systemd service storage.`,
      );
    }
  }
}

/**
 * Create the packaged Linux systemd user-service operator. Construction is
 * side-effect free; every method resolves embedded identity lazily.
 * @param {Record<string, any>} [options] - Testable host adapters and roots.
 * @returns {Readonly<{install: () => Promise<Record<string, any>>, start: () => Promise<Record<string, any>>, stop: () => Promise<Record<string, any>>, restart: () => Promise<Record<string, any>>, status: () => Promise<Record<string, any>>, uninstall: () => Promise<Record<string, any>>}>} - Service operations.
 */
export function createSystemdUserServiceOperator(options = {}) {
  const platform = options.platform || process.platform;
  const architecture = options.architecture || process.arch;
  const nodeVersion = options.nodeVersion || process.versions.node;
  const artifactPath =
    options.artifactPath ||
    getRunningExecutablePath({ platform, execPath: process.execPath });
  const environment = options.environment || process.env;
  const getHomeDirectory =
    options.getHomeDirectory || (() => userInfo().homedir);
  const homeDirectory = getHomeDirectory();
  const dataRoot =
    options.dataRoot ??
    resolveStableLocalAppDataRoot({ platform, homeDirectory });
  const configRoot = options.configRoot ?? path.join(homeDirectory, '.config');
  const fsOps = options.fsOps || fsp;
  const readPackagedStorage =
    options.getLocalAppStorageLayout || getLocalAppStorageLayout;
  const execute = options.execute || runProcess;
  const readPair =
    options.readEmbeddedRevisionRuntimePair || readEmbeddedRevisionRuntimePair;
  const inspectBytes = options.inspectArtifactBytes || inspectArtifactBytes;
  const getUid = options.getUid || (() => process.getuid?.());
  const getEffectiveUid =
    options.getEffectiveUid ||
    (options.getUid ? options.getUid : () => process.geteuid?.());
  const getFilesystemUid = options.getFilesystemUid || getUid;
  const acquireLock = options.acquireOperationLock || acquireOperationLock;
  const createToken = options.createToken || randomUUID;
  const now = options.now || (() => Date.now());
  const monotonicNow = options.monotonicNow || (() => performance.now());
  /**
   * @param {number} duration - Delay in milliseconds.
   * @returns {Promise<void>} - Resolves after the delay.
   */
  const defaultWait = (duration) =>
    new Promise((resolve) => {
      setTimeout(resolve, duration);
    });
  const wait = options.wait || defaultWait;
  const pollIntervalMs = positiveDuration(
    options.pollIntervalMs,
    'systemd user service pollIntervalMs',
    DEFAULT_POLL_INTERVAL_MS,
  );
  const startTimeoutMs = positiveDuration(
    options.startTimeoutMs,
    'systemd user service startTimeoutMs',
    DEFAULT_START_TIMEOUT_MS,
  );
  const stopTimeoutMs = positiveDuration(
    options.stopTimeoutMs,
    'systemd user service stopTimeoutMs',
    DEFAULT_STOP_TIMEOUT_MS,
  );

  /** @returns {void} - Returns on supported host. */
  function assertLinuxUserManager() {
    if (platform !== 'linux') {
      throw new Error(
        'Systemd user-service management is supported only on Linux.',
      );
    }
    const uid = getUid();
    const effectiveUid = getEffectiveUid();
    const filesystemUid = getFilesystemUid();
    if (
      !Number.isSafeInteger(uid) ||
      Number(uid) < 1 ||
      !Number.isSafeInteger(effectiveUid) ||
      Number(effectiveUid) !== Number(uid) ||
      !Number.isSafeInteger(filesystemUid) ||
      Number(filesystemUid) < 0
    ) {
      throw new Error(
        'Systemd user-service management requires one non-root real/effective local user ID.',
      );
    }
    const configuredXdgRoot = environment.XDG_CONFIG_HOME;
    if (
      configuredXdgRoot !== undefined &&
      configuredXdgRoot !== '' &&
      (typeof configuredXdgRoot !== 'string' ||
        !path.isAbsolute(configuredXdgRoot) ||
        path.resolve(configuredXdgRoot) !== configRoot)
    ) {
      const error = new Error(
        `Systemd user-service management requires XDG_CONFIG_HOME to be unset or equal ${configRoot}.`,
      );
      error.name = 'SystemdUserServiceConfigurationError';
      Object.assign(error, {
        code: 'systemd-user-service-unstable-config-root',
      });
      throw error;
    }
  }

  /** @returns {Promise<{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}>} - Embedded app context. */
  async function resolveContext() {
    assertLinuxUserManager();
    const pair = await readPair();
    if (
      pair.runtime.target.platform !== platform ||
      pair.runtime.target.architecture !== architecture ||
      pair.runtime.target.nodeVersion !== nodeVersion
    ) {
      throw new Error(
        'Packaged artifact target does not match the running Linux host process.',
      );
    }
    const uid = Number(getUid());
    const layout = createSystemdUserServiceLayout({
      appId: pair.runtime.appId,
      dataRoot,
      configRoot,
    });
    assertSharedPackagedStorage(layout, readPackagedStorage(), environment);
    return {
      pair,
      uid,
      filesystemUid: Number(getFilesystemUid()),
      layout,
    };
  }

  /**
   * @param {string} command - Host command.
   * @param {string[]} args - Exact argv.
   * @param {number} [timeoutMs] - Remaining operation time.
   * @returns {Promise<SystemdUserServiceProcessResult>} - Process result.
   */
  async function executeHost(command, args, timeoutMs) {
    if (timeoutMs === undefined) return await execute(command, args);
    return await execute(command, args, { timeoutMs });
  }

  /**
   * @param {number | undefined} deadline - Monotonic deadline.
   * @returns {number | undefined} - Positive remaining command duration.
   */
  function remainingCommandTime(deadline) {
    if (deadline === undefined) return undefined;
    return Math.max(1, Math.ceil(deadline - monotonicNow()));
  }

  /**
   * @param {string[]} args - systemctl arguments.
   * @param {number} [timeoutMs] - Remaining operation time.
   * @returns {Promise<SystemdUserServiceProcessResult>} - Process result.
   */
  async function systemctl(args, timeoutMs) {
    return await executeHost('systemctl', ['--user', ...args], timeoutMs);
  }

  /**
   * @param {number} [timeoutMs] - Remaining operation time.
   * @returns {Promise<string[]>} - Live manager unit search path.
   */
  async function readManagerUnitPaths(timeoutMs) {
    const result = await systemctl(
      ['show', '--property=UnitPath', '--value', '--no-pager'],
      timeoutMs,
    );
    return parseSystemdUserManagerUnitPath(result.stdout);
  }

  /**
   * Create and validate only the stable account-home unit directory, then
   * require the live manager to include it in its actual lookup path. A fresh
   * manager may omit a directory until it exists and daemon-reload recomputes
   * UnitPath, so retry exactly once after that bounded preparation.
   * @param {Readonly<Record<string, string>>} layout - Candidate service layout.
   * @param {number} uid - Required filesystem owner.
   * @returns {Promise<void>} - Resolves only for a reachable exact search path.
   */
  async function prepareManagerUnitDirectory(layout, uid) {
    const unitDirectory = path.dirname(layout.unitPath);
    let unitPaths = await readManagerUnitPaths();
    await ensureManagedUnitDirectory(fsOps, layout, uid);
    if (unitPaths.includes(unitDirectory)) return;
    await systemctl(['daemon-reload']);
    unitPaths = await readManagerUnitPaths();
    if (!unitPaths.includes(unitDirectory)) {
      throw new Error(
        `Systemd user manager does not search Wharfie's fixed unit directory ${unitDirectory}; remove conflicting manager path overrides and restart the user manager before installing.`,
      );
    }
  }

  /**
   * @param {number} uid - Current user.
   * @param {number} [timeoutMs] - Remaining operation time.
   * @returns {Promise<boolean>} - Current linger state.
   */
  async function readLinger(uid, timeoutMs) {
    const result = await executeHost(
      'loginctl',
      ['show-user', String(uid), '--property=Linger', '--value', '--no-pager'],
      timeoutMs,
    );
    const value = result.stdout.trim();
    if (value === 'yes') return true;
    if (value === 'no') return false;
    throw new Error('Systemd returned an invalid lingering state.');
  }

  /**
   * @param {number} uid - Current user.
   * @returns {Promise<void>} - Resolves only with boot-persistent user manager.
   */
  async function assertLinger(uid) {
    if (!(await readLinger(uid))) {
      throw new Error(
        `Systemd lingering is required for boot persistence; enable it for uid ${uid} before installing.`,
      );
    }
  }

  /**
   * @param {Readonly<Record<string, string>>} layout - Installed layout.
   * @param {number} [timeoutMs] - Remaining operation time.
   * @returns {Promise<Readonly<Record<string, any>>>} - Manager state.
   */
  async function readSystemd(layout, timeoutMs) {
    const args = ['show', layout.unitName, '--no-pager'];
    for (const property of SYSTEMD_SHOW_PROPERTIES) {
      args.push(`--property=${property}`);
    }
    const result = await systemctl(args, timeoutMs);
    return parseSystemdUserServiceStatus(result.stdout);
  }

  /**
   * Require systemd to have loaded Wharfie's exact immutable unit source with
   * no administrator or generator drop-ins changing its effective behavior.
   * @param {Readonly<Record<string, any>>} systemd - Parsed manager state.
   * @param {Readonly<Record<string, string>>} layout - Expected unit layout.
   * @returns {boolean} - Whether effective unit selection is exact.
   */
  function hasExpectedEffectiveUnit(systemd, layout) {
    return (
      systemd.loadState === 'loaded' &&
      systemd.fragmentPath === layout.unitPath &&
      systemd.dropInPaths === '' &&
      systemd.needDaemonReload === false
    );
  }

  /**
   * Refuse a unit name already resolved from another fragment or modified by
   * drop-ins before Wharfie publishes release or durable state.
   * @param {Readonly<Record<string, any>>} systemd - Parsed manager state.
   * @param {Readonly<Record<string, string>>} layout - Candidate unit layout.
   * @returns {void} - Returns when the name is absent or already exact.
   */
  function assertNoForeignEffectiveUnit(systemd, layout) {
    if (systemd.loadState === 'not-found') return;
    if (!hasExpectedEffectiveUnit(systemd, layout)) {
      throw new Error(
        'Systemd user-service unit name is already claimed by another or stale effective configuration.',
      );
    }
  }

  /**
   * @param {Readonly<Record<string, string>>} layout - Expected layout.
   * @param {number} uid - Expected principal.
   * @param {number} filesystemUid - Expected managed-file owner.
   * @returns {Promise<Readonly<Record<string, any>> | null>} - Installation or null.
   */
  async function readInstallation(layout, uid, filesystemUid) {
    if (!(await hasManagedServiceRoot(fsOps, layout, filesystemUid))) {
      return null;
    }
    let raw;
    try {
      raw = await readManagedTextFile({
        fsOps,
        filePath: layout.installationPath,
        label: 'Systemd user-service installation receipt',
        uid: filesystemUid,
      });
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
    const installation = validateSystemdUserServiceInstallation(
      JSON.parse(raw),
    );
    assertSameLayout(layout, installation.layout);
    if (installation.principal.uid !== uid) {
      throw new Error(
        'Installed systemd user service belongs to a different local user ID.',
      );
    }
    return installation;
  }

  /**
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {Readonly<Record<string, any>> | null} installation - Optional exact receipt.
   * @returns {Promise<Readonly<Record<string, any>> | null>} - Retry marker.
   */
  async function readUninstallMarker(context, installation) {
    let raw;
    try {
      raw = await readManagedTextFile({
        fsOps,
        filePath: context.layout.uninstallPath,
        label: 'Systemd user-service uninstall marker',
        uid: context.filesystemUid,
      });
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
    return validateUninstallMarker(JSON.parse(raw), {
      appId: context.pair.runtime.appId,
      unitName: context.layout.unitName,
      uid: context.uid,
      ...(installation
        ? {
            artifactId: installation.current.artifactId,
            revisionId: installation.current.revisionId,
          }
        : {}),
    });
  }

  /**
   * @param {Readonly<Record<string, any>>} installation - Installed state.
   * @param {{tolerateSystemdFailure?: boolean, integrity?: Readonly<Record<string, any>>, deadline?: number}} [observationOptions] - Status-only degradation policy.
   * @returns {Promise<Record<string, any>>} - Redacted status.
   */
  async function observeInstallation(installation, observationOptions = {}) {
    let integrity = observationOptions.integrity;
    if (!integrity) {
      try {
        integrity = await verifyInstalledSelection({
          fsOps,
          installation,
          inspectBytes,
          uid: Number(getFilesystemUid()),
        });
      } catch {
        integrity = Object.freeze({ status: 'invalid' });
      }
    }
    let systemd;
    try {
      systemd = await readSystemd(
        installation.layout,
        remainingCommandTime(observationOptions.deadline),
      );
    } catch (error) {
      if (observationOptions.tolerateSystemdFailure !== true) throw error;
      systemd = Object.freeze({
        loadState: 'unavailable',
        unitFileState: 'unknown',
        activeState: 'unknown',
        subState: 'unknown',
        result: 'unknown',
        mainPid: 0,
        execMainStatus: 0,
        fragmentPath: '',
        dropInPaths: '',
        needDaemonReload: null,
      });
    }
    if (
      integrity.status === 'verified' &&
      !hasExpectedEffectiveUnit(systemd, installation.layout)
    ) {
      integrity = Object.freeze({ status: 'invalid' });
    }
    let runtime;
    if (integrity.status !== 'verified') {
      runtime = Object.freeze({ status: 'UNAVAILABLE', session: 'unknown' });
    } else {
      try {
        runtime = await (options.readRuntimeState || readRuntimeState)({
          layout: installation.layout,
          appId: installation.appId,
          fsOps,
          ...(options.createControlDBClient
            ? { createDB: options.createControlDBClient }
            : {}),
          ...(options.probeLocalServiceSession
            ? { probeSession: options.probeLocalServiceSession }
            : {}),
        });
      } catch {
        runtime = Object.freeze({ status: 'UNAVAILABLE', session: 'unknown' });
      }
    }
    let linger = null;
    try {
      linger = await readLinger(
        installation.principal.uid,
        remainingCommandTime(observationOptions.deadline),
      );
    } catch {
      linger = null;
    }
    const persistence = Object.freeze({
      linger,
      unitEnabled: systemd.unitFileState === 'enabled',
      bootEnabled: linger === true && systemd.unitFileState === 'enabled',
    });
    const health = classifyHealth(
      installation,
      systemd,
      runtime,
      integrity,
      persistence,
    );
    return {
      schemaVersion: SERVICE_RESULT_SCHEMA_VERSION,
      kind: SERVICE_STATUS_KIND,
      appId: installation.appId,
      unit: installation.unitName,
      installation: {
        state: 'installed',
        activeArtifactId: installation.current.artifactId,
        activeRevisionId: installation.current.revisionId,
        previousArtifactId: installation.previous?.artifactId || null,
      },
      systemd,
      runtime,
      integrity,
      persistence,
      health,
    };
  }

  /**
   * @param {Readonly<Record<string, any>>} installation - Installed state.
   * @param {'healthy'|'stopped'} expected - Required health.
   * @param {number} timeoutMs - Bound.
   * @param {Readonly<Record<string, any>>} integrity - Preverified selection.
   * @returns {Promise<Record<string, any>>} - Matching status.
   */
  async function waitForHealth(installation, expected, timeoutMs, integrity) {
    const attempts = Math.ceil(timeoutMs / pollIntervalMs) + 1;
    const deadline = monotonicNow() + timeoutMs;
    let last;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      last = await observeInstallation(installation, { integrity, deadline });
      if (last.health === expected) return last;
      const remaining = deadline - monotonicNow();
      if (remaining <= 0) break;
      if (attempt + 1 < attempts) {
        await wait(Math.min(pollIntervalMs, Math.ceil(remaining)));
      }
    }
    const error = new Error(
      `Systemd user service did not become ${expected} within ${timeoutMs}ms (last state: ${last?.health || 'unknown'}).`,
    );
    error.name = 'SystemdUserServiceHealthTimeoutError';
    Object.assign(error, {
      code: 'systemd-user-service-health-timeout',
      expected,
      status: last,
    });
    throw error;
  }

  /**
   * Wait only for systemd to stop supervising a process. Durable READY state
   * may be stale after SIGKILL or power loss and is reported separately; it
   * must not prevent a data-preserving stop or uninstall from converging.
   * @param {Readonly<Record<string, any>>} installation - Installed state.
   * @param {number} timeoutMs - Bound.
   * @returns {Promise<Readonly<Record<string, any>>>} - Inactive manager state.
   */
  async function waitForSystemdInactive(installation, timeoutMs) {
    const attempts = Math.ceil(timeoutMs / pollIntervalMs) + 1;
    const deadline = monotonicNow() + timeoutMs;
    let last;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      last = await readSystemd(
        installation.layout,
        remainingCommandTime(deadline),
      );
      if (last.activeState === 'inactive') return last;
      const remaining = deadline - monotonicNow();
      if (remaining <= 0) break;
      if (attempt + 1 < attempts) {
        await wait(Math.min(pollIntervalMs, Math.ceil(remaining)));
      }
    }
    const error = new Error(
      `Systemd user service did not become inactive within ${timeoutMs}ms (last state: ${last?.activeState || 'unknown'}).`,
    );
    error.name = 'SystemdUserServiceStopTimeoutError';
    Object.assign(error, {
      code: 'systemd-user-service-stop-timeout',
      status: last,
    });
    throw error;
  }

  /**
   * Refuse to start an installed service whose persistent enablement was
   * changed outside Wharfie. Re-running install is the explicit repair path.
   * @param {Readonly<Record<string, any>>} installation - Installed state.
   * @returns {Promise<void>} - Resolves while persistent enablement is intact.
   */
  async function assertUnitEnabled(installation) {
    const systemd = await assertExpectedEffectiveUnit(installation);
    if (systemd.unitFileState !== 'enabled') {
      throw new Error(
        'Installed systemd user service is no longer enabled; rerun service install to repair it.',
      );
    }
  }

  /**
   * Resolve the unit name before any lifecycle mutation and require it to be
   * Wharfie's exact fragment without drop-ins. This prevents stop/uninstall
   * from acting on a higher-precedence foreign unit with the same name.
   * @param {Readonly<Record<string, any>>} installation - Installed state.
   * @returns {Promise<Readonly<Record<string, any>>>} - Exact manager state.
   */
  async function assertExpectedEffectiveUnit(installation) {
    const systemd = await readSystemd(installation.layout);
    if (!hasExpectedEffectiveUnit(systemd, installation.layout)) {
      throw new Error(
        'Systemd loaded a different unit or additional drop-ins, or its unit cache is stale; rerun service install after removing the override.',
      );
    }
    return systemd;
  }

  /**
   * @param {string} action - Operation.
   * @param {string} outcome - Result.
   * @param {Record<string, any>} status - Final status.
   * @returns {Record<string, any>} - Stable receipt.
   */
  function createReceipt(action, outcome, status) {
    return {
      schemaVersion: SERVICE_RESULT_SCHEMA_VERSION,
      kind: SERVICE_RESULT_KIND,
      action,
      appId: status.appId,
      outcome,
      unit: status.unit,
      health: status.health,
      activeArtifactId: status.installation?.activeArtifactId || null,
      activeRevisionId: status.installation?.activeRevisionId || null,
    };
  }

  /**
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>}} context - App context.
   * @param {'uninstalled'|'already-uninstalled'} outcome - Converged result.
   * @returns {Record<string, any>} - Data-preserving uninstall receipt.
   */
  function createUninstallReceipt(context, outcome) {
    return {
      schemaVersion: SERVICE_RESULT_SCHEMA_VERSION,
      kind: SERVICE_RESULT_KIND,
      action: 'uninstall',
      appId: context.pair.runtime.appId,
      outcome,
      unit: context.layout.unitName,
      health: 'absent',
      activeArtifactId: null,
      activeRevisionId: null,
      preserved: {
        releases: context.layout.releasesRoot,
        state: context.layout.stateRoot,
      },
    };
  }

  /**
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @returns {Promise<{installation: Readonly<Record<string, any>>, release: () => Promise<void>}>} - Locked installation.
   */
  async function lockInstalled(context) {
    const release = await acquireLock({
      serviceRoot: context.layout.serviceRoot,
      uid: context.uid,
    });
    try {
      const installation = await readInstallation(
        context.layout,
        context.uid,
        context.filesystemUid,
      );
      if (!installation || installation.state !== 'installed') {
        throw new Error('Systemd user service is not installed.');
      }
      if (await readUninstallMarker(context, installation)) {
        throw new Error(
          'Systemd user-service uninstall is incomplete; rerun service uninstall.',
        );
      }
      return { installation, release };
    } catch (error) {
      await release();
      throw error;
    }
  }

  /** @returns {Promise<Record<string, any>>} - Installation receipt. */
  async function install() {
    const context = await resolveContext();
    await assertLinger(context.uid);
    const token = createToken();
    const releaseLock = await acquireLock({
      serviceRoot: context.layout.serviceRoot,
      uid: context.uid,
    });
    try {
      await prepareManagerUnitDirectory(context.layout, context.filesystemUid);
      let knownUnit = await readSystemd(context.layout);
      if (knownUnit.needDaemonReload) {
        await systemctl(['daemon-reload']);
        knownUnit = await readSystemd(context.layout);
      }
      assertNoForeignEffectiveUnit(knownUnit, context.layout);
      const artifact = await inspectBytes(artifactPath);
      await ensureManagedServiceRoot(
        fsOps,
        context.layout,
        context.filesystemUid,
      );
      const existing = await readInstallation(
        context.layout,
        context.uid,
        context.filesystemUid,
      );
      const uninstallMarker = await readUninstallMarker(context, existing);
      if (uninstallMarker && existing?.state !== 'uninstalled') {
        throw new Error(
          'Systemd user-service uninstall is incomplete; rerun service uninstall before installing.',
        );
      }
      if (uninstallMarker) {
        await fsOps.unlink(context.layout.uninstallPath);
        await syncDirectory(fsOps, context.layout.serviceRoot);
      }
      if (existing && existing.current.artifactId !== artifact.artifactId) {
        throw new Error(
          'A different artifact is installed; race-free update is not implemented yet.',
        );
      }
      const observedAt = now();
      const release = await stageRelease({
        fsOps,
        layout: context.layout,
        uid: context.filesystemUid,
        artifactPath,
        artifact,
        pair: context.pair,
        installedAt: observedAt,
        token,
        inspectBytes,
      });
      if (
        existing &&
        (!hasSameArtifactBytes(existing.current, release) ||
          existing.current.revisionId !== release.revisionId)
      ) {
        throw new Error(
          'Installed systemd user-service selection disagrees with its immutable release.',
        );
      }
      await ensureManagedDirectory(
        fsOps,
        context.layout.stateRoot,
        'Systemd user-service state root',
        context.filesystemUid,
      );
      await ensureManagedDirectory(
        fsOps,
        context.layout.controlPath,
        'Systemd user-service control root',
        context.filesystemUid,
      );
      await ensureManagedDirectory(
        fsOps,
        context.layout.applicationStatePath,
        'Systemd user-service application-state root',
        context.filesystemUid,
      );
      await selectRelease({
        fsOps,
        layout: context.layout,
        artifactId: release.artifactId,
        token,
      });
      const unit = createSystemdUserServiceUnit({ layout: context.layout });
      try {
        const currentUnit = await readManagedTextFile({
          fsOps,
          filePath: context.layout.unitPath,
          label: 'Systemd user unit',
          uid: context.filesystemUid,
        });
        if (currentUnit !== unit) {
          throw new Error(
            'Systemd user unit path already contains different content.',
          );
        }
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
        await writeFileAtomic({
          fsOps,
          filePath: context.layout.unitPath,
          contents: unit,
          mode: 0o600,
          token,
          uid: context.filesystemUid,
        });
      }
      const installation =
        existing?.state === 'installed'
          ? existing
          : createSystemdUserServiceInstallation({
              layout: context.layout,
              uid: context.uid,
              current: release,
              previous: existing?.previous,
              state: 'installed',
              installedAt: existing?.installedAt ?? observedAt,
              updatedAt: existing
                ? Math.max(existing.updatedAt, observedAt)
                : observedAt,
            });
      if (!existing || existing.state === 'uninstalled') {
        await writeFileAtomic({
          fsOps,
          filePath: context.layout.installationPath,
          contents: `${JSON.stringify(installation, null, 2)}\n`,
          mode: 0o600,
          token,
          uid: context.filesystemUid,
        });
      }
      const integrity = await verifyInstalledSelection({
        fsOps,
        installation,
        inspectBytes,
        uid: context.filesystemUid,
      });
      await systemctl(['daemon-reload']);
      const loaded = await readSystemd(context.layout);
      if (
        loaded.loadState !== 'loaded' ||
        !hasExpectedEffectiveUnit(loaded, context.layout)
      ) {
        throw new Error(
          "Systemd did not load Wharfie's exact unit without drop-ins; installation was not enabled.",
        );
      }
      await systemctl(['enable', '--now', context.layout.unitName]);
      const status = await waitForHealth(
        installation,
        'healthy',
        startTimeoutMs,
        integrity,
      );
      return createReceipt(
        'install',
        existing?.state === 'installed'
          ? 'already-installed'
          : existing
            ? 'reinstalled'
            : 'installed',
        status,
      );
    } finally {
      await releaseLock();
    }
  }

  /** @returns {Promise<Record<string, any>>} - Current service status. */
  async function status() {
    const context = await resolveContext();
    const installation = await readInstallation(
      context.layout,
      context.uid,
      context.filesystemUid,
    );
    if (!installation || installation.state === 'uninstalled') {
      return {
        schemaVersion: SERVICE_RESULT_SCHEMA_VERSION,
        kind: SERVICE_STATUS_KIND,
        appId: context.pair.runtime.appId,
        unit: context.layout.unitName,
        installation: installation
          ? {
              state: 'uninstalled',
              lastArtifactId: installation.current.artifactId,
              lastRevisionId: installation.current.revisionId,
            }
          : { state: 'absent' },
        systemd: null,
        runtime: null,
        health: 'absent',
      };
    }
    return await observeInstallation(installation, {
      tolerateSystemdFailure: true,
    });
  }

  /** @returns {Promise<Record<string, any>>} - Start receipt. */
  async function start() {
    const context = await resolveContext();
    await assertLinger(context.uid);
    const locked = await lockInstalled(context);
    try {
      const integrity = await verifyInstalledSelection({
        fsOps,
        installation: locked.installation,
        inspectBytes,
        uid: context.filesystemUid,
      });
      await assertUnitEnabled(locked.installation);
      await systemctl(['start', context.layout.unitName]);
      const observed = await waitForHealth(
        locked.installation,
        'healthy',
        startTimeoutMs,
        integrity,
      );
      return createReceipt('start', 'started', observed);
    } finally {
      await locked.release();
    }
  }

  /** @returns {Promise<Record<string, any>>} - Stop receipt. */
  async function stop() {
    const context = await resolveContext();
    const locked = await lockInstalled(context);
    try {
      await assertExpectedEffectiveUnit(locked.installation);
      await systemctl(['stop', context.layout.unitName]);
      await waitForSystemdInactive(locked.installation, stopTimeoutMs);
      const observed = await observeInstallation(locked.installation, {
        tolerateSystemdFailure: true,
      });
      return createReceipt('stop', 'stopped', observed);
    } finally {
      await locked.release();
    }
  }

  /** @returns {Promise<Record<string, any>>} - Restart receipt. */
  async function restart() {
    const context = await resolveContext();
    await assertLinger(context.uid);
    const locked = await lockInstalled(context);
    try {
      const integrity = await verifyInstalledSelection({
        fsOps,
        installation: locked.installation,
        inspectBytes,
        uid: context.filesystemUid,
      });
      await assertUnitEnabled(locked.installation);
      await systemctl(['restart', context.layout.unitName]);
      const observed = await waitForHealth(
        locked.installation,
        'healthy',
        startTimeoutMs,
        integrity,
      );
      return createReceipt('restart', 'restarted', observed);
    } finally {
      await locked.release();
    }
  }

  /** @returns {Promise<Record<string, any>>} - Data-preserving uninstall receipt. */
  async function uninstall() {
    const context = await resolveContext();
    const releaseLock = await acquireLock({
      serviceRoot: context.layout.serviceRoot,
      uid: context.uid,
    });
    try {
      const installation = await readInstallation(
        context.layout,
        context.uid,
        context.filesystemUid,
      );
      let marker = await readUninstallMarker(context, installation);
      if (!installation) {
        if (marker) {
          throw new Error(
            'Systemd user-service uninstall marker has no installation receipt.',
          );
        }
        return createUninstallReceipt(context, 'already-uninstalled');
      }
      if (installation.state === 'uninstalled') {
        if (marker) {
          await fsOps.unlink(context.layout.uninstallPath);
          await syncDirectory(fsOps, context.layout.serviceRoot);
        }
        return createUninstallReceipt(context, 'already-uninstalled');
      }

      await assertManagedUnitDirectory(
        fsOps,
        context.layout,
        context.filesystemUid,
      );
      const expectedUnit = createSystemdUserServiceUnit({
        layout: context.layout,
      });
      let restoredUnit = false;
      try {
        const installedUnit = await readManagedTextFile({
          fsOps,
          filePath: context.layout.unitPath,
          label: 'Installed systemd user unit',
          uid: context.filesystemUid,
        });
        if (installedUnit !== expectedUnit) {
          throw new Error('Installed systemd user unit was changed.');
        }
      } catch (error) {
        if (!marker || !hasCode(error, 'ENOENT')) throw error;
        await writeFileAtomic({
          fsOps,
          filePath: context.layout.unitPath,
          contents: expectedUnit,
          mode: 0o600,
          token: createToken(),
          uid: context.filesystemUid,
        });
        restoredUnit = true;
      }
      if (restoredUnit) await systemctl(['daemon-reload']);
      await assertExpectedEffectiveUnit(installation);
      await systemctl(['disable', '--now', context.layout.unitName]);
      await waitForSystemdInactive(installation, stopTimeoutMs);

      if (!marker) {
        marker = validateUninstallMarker(
          {
            schemaVersion: 1,
            kind: UNINSTALL_MARKER_KIND,
            appId: installation.appId,
            unitName: installation.unitName,
            uid: context.uid,
            artifactId: installation.current.artifactId,
            revisionId: installation.current.revisionId,
          },
          {
            appId: installation.appId,
            unitName: installation.unitName,
            uid: context.uid,
            artifactId: installation.current.artifactId,
            revisionId: installation.current.revisionId,
          },
        );
        await writeFileAtomic({
          fsOps,
          filePath: context.layout.uninstallPath,
          contents: `${JSON.stringify(marker, null, 2)}\n`,
          mode: 0o600,
          token: createToken(),
          uid: context.filesystemUid,
        });
      }

      await assertManagedUnitDirectory(
        fsOps,
        context.layout,
        context.filesystemUid,
      );
      await fsOps.unlink(context.layout.unitPath).catch(
        /** @param {unknown} error - Filesystem failure. */ (error) => {
          if (!hasCode(error, 'ENOENT')) throw error;
        },
      );
      await syncDirectory(fsOps, path.dirname(context.layout.unitPath));
      await systemctl(['daemon-reload']);
      await fsOps.unlink(context.layout.currentLink).catch(
        /** @param {unknown} error - Filesystem failure. */ (error) => {
          if (!hasCode(error, 'ENOENT')) throw error;
        },
      );
      await syncDirectory(fsOps, context.layout.serviceRoot);
      const uninstalledAt = now();
      const retainedInstallation = createSystemdUserServiceInstallation({
        layout: context.layout,
        uid: context.uid,
        current: installation.current,
        previous: installation.previous,
        state: 'uninstalled',
        installedAt: installation.installedAt,
        updatedAt: Math.max(installation.updatedAt, uninstalledAt),
      });
      await writeFileAtomic({
        fsOps,
        filePath: context.layout.installationPath,
        contents: `${JSON.stringify(retainedInstallation, null, 2)}\n`,
        mode: 0o600,
        token: createToken(),
        uid: context.filesystemUid,
      });
      await syncDirectory(fsOps, context.layout.serviceRoot);
      await fsOps.unlink(context.layout.uninstallPath);
      await syncDirectory(fsOps, context.layout.serviceRoot);
      return createUninstallReceipt(context, 'uninstalled');
    } finally {
      await releaseLock();
    }
  }

  return Object.freeze({ install, start, stop, restart, status, uninstall });
}

export default createSystemdUserServiceOperator;

export {
  acquireOperationLock as acquireSystemdUserServiceOperationLock,
  readRuntimeState as readSystemdUserServiceRuntimeState,
};
