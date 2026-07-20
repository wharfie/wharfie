import { execFile as nodeExecFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import net from 'node:net';
import { userInfo } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { getLocalAppStorageLayout } from '../../lib/config/local-app-storage-context.js';
import { createControlDBClient } from '../../lib/config/db.js';
import { createExecutionLedger } from '../../lib/db/tables/execution-ledger.js';
import {
  LedgerServiceLifecycleStatus,
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
} from '../../lib/db/tables/ledger-service-lifecycle.js';
import {
  LocalApplicationActivationPhase,
  createLocalApplicationActivation,
  getLocalApplicationServiceStartFence,
} from '../../lib/db/tables/local-application-activation.js';
import { createLocalExecutionPayloadStore } from '../../lib/payload-store/local.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../effects/application-state.js';
import { assertApplicationRevisionId } from '../application-revision.js';
import { assertArtifactId } from '../artifact-record.js';
import { resolveStableLocalAppDataRoot } from '../local-app-storage.js';
import {
  getRunningExecutablePath,
  inspectArtifactBytes,
} from '../packaged-artifact.js';
import { probeLocalServiceSession } from '../local-service-session.js';
import { readEmbeddedRevisionRuntimePair } from '../../resources/builds/lib/revision-runtime-assets.js';
import { getBuildTargetId } from '../build-target.js';
import {
  createSystemdUserServiceInstallation,
  createSystemdUserServiceLayout,
  createSystemdUserServiceRelease,
  createSystemdUserServiceUnit,
  parseSystemdUserServiceStatus,
  validateSystemdUserServiceInstallation,
  validateSystemdUserServiceRelease,
} from './systemd-user-service.js';
import { createLocalApplicationSystemdActivation } from './local-application-systemd-activation.js';

const SERVICE_RESULT_SCHEMA_VERSION = 1;
const SERVICE_STATUS_SCHEMA_VERSION = 2;
const SERVICE_RESULT_KIND = 'wharfie.service.result';
const SERVICE_STATUS_KIND = 'wharfie.service.status';
const UNINSTALL_MARKER_KIND = 'wharfie.systemd-user-service.uninstall-marker';
const UNINSTALL_MARKER_SCHEMA_VERSION = 2;
const DEFAULT_START_TIMEOUT_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 50_000;
const DEFAULT_POLL_INTERVAL_MS = 200;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MAX_PROCESS_DURATION_MS = 60_000;
const MAX_SERVICE_RECORD_BYTES = 64 * 1024;
const ATOMIC_PUBLICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ACTIVATION_RECOVERY_REMEDIATION =
  'Run service recover before retrying activation.';
const ACTIVE_REINSTALL_RECOVERY_REMEDIATION =
  'Run service install again from the exact selected SEA to resume repair.';
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
 * Preserve the original failure while marking only errors that left a durable
 * activation transition in flight as recoverable operator work.
 * @param {unknown} error - Transition failure.
 * @returns {Error} - Recovery-tagged failure.
 */
function createActivationRecoveryRequiredError(error) {
  if (hasCode(error, 'systemd-user-service-activation-recovery-required')) {
    return /** @type {Error} */ (error);
  }
  const failure = new Error(
    error instanceof Error
      ? error.message
      : 'Systemd user-service activation was interrupted.',
  );
  failure.name = 'SystemdUserServiceActivationRecoveryRequiredError';
  Object.assign(failure, {
    code: 'systemd-user-service-activation-recovery-required',
    remediation: ACTIVATION_RECOVERY_REMEDIATION,
    cause: error,
  });
  return failure;
}

/**
 * Mark only failures after an authorized ACTIVE repair begins. Durable
 * activation remains ACTIVE, so replay is `service install` from the selected
 * SEA rather than activation `recover`.
 * @param {unknown} error - Interrupted physical repair.
 * @returns {Error} - Actionable replay error.
 */
function createActiveReinstallRecoveryRequiredError(error) {
  if (
    hasCode(error, 'systemd-user-service-active-reinstall-recovery-required')
  ) {
    return /** @type {Error} */ (error);
  }
  const causeMessage =
    error instanceof Error
      ? error.message
      : 'Systemd user-service ACTIVE repair was interrupted.';
  const failure = new Error(causeMessage);
  failure.name = 'SystemdUserServiceActiveReinstallRecoveryRequiredError';
  Object.assign(failure, {
    code: 'systemd-user-service-active-reinstall-recovery-required',
    remediation: ACTIVE_REINSTALL_RECOVERY_REMEDIATION,
    cause: error,
  });
  return failure;
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
 * Create or validate one account-owned shared directory without changing the
 * permissions of an existing path. Wharfie owns its unit file, not the
 * account's shared XDG/systemd directory policy.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} directory - Shared directory to create or reuse.
 * @param {string} label - Boundary label.
 * @param {number} uid - Required owner.
 * @returns {Promise<void>} - Resolves for a real, non-writable shared directory.
 */
async function ensureSharedDirectory(fsOps, directory, label, uid) {
  try {
    await fsOps.mkdir(directory, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
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
  await ensureSharedDirectory(
    fsOps,
    layout.configRoot,
    'Wharfie config root',
    uid,
  );
  const systemdRoot = path.join(layout.configRoot, 'systemd');
  await ensureSharedDirectory(
    fsOps,
    systemdRoot,
    'Systemd user config root',
    uid,
  );
  await ensureSharedDirectory(
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
 * @param {Readonly<Record<string, any>> | null | undefined} release - Release record or reference.
 * @param {Readonly<Record<string, any>> | null | undefined} reference - Exact activation reference.
 * @returns {boolean} - Whether both identities name the same immutable release.
 */
function hasSameReleaseReference(release, reference) {
  return (
    release === reference ||
    (release !== null &&
      release !== undefined &&
      reference !== null &&
      reference !== undefined &&
      release.artifactId === reference.artifactId &&
      release.revisionId === reference.revisionId)
  );
}

/**
 * Read and verify one immutable release directory by content identity. The
 * optional revision fence lets the selected-link reader discover its own
 * revision while activation recovery requires an exact stored reference.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, inspectBytes: typeof inspectArtifactBytes, uid: number, target: unknown, artifactId: string, revisionId?: string}} options - Immutable release boundary.
 * @returns {Promise<Readonly<Record<string, any>>>} - Verified release.
 */
async function readImmutableRelease(options) {
  assertArtifactId(options.artifactId, 'systemd release artifactId');
  if (options.revisionId !== undefined) {
    assertApplicationRevisionId(
      options.revisionId,
      'systemd release revisionId',
    );
  }
  const releaseDirectory = path.join(
    options.layout.releasesRoot,
    options.artifactId,
  );
  const releasePath = path.join(releaseDirectory, 'release.json');
  const releaseArtifactPath = path.join(releaseDirectory, 'app');
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
  const release = validateSystemdUserServiceRelease(
    JSON.parse(
      await readManagedTextFile({
        fsOps: options.fsOps,
        filePath: releasePath,
        label: 'Systemd user-service release receipt',
        uid: options.uid,
      }),
    ),
  );
  if (
    release.appId !== options.layout.appId ||
    release.artifactId !== options.artifactId ||
    (options.revisionId !== undefined &&
      release.revisionId !== options.revisionId) ||
    release.artifactPath !== releaseArtifactPath ||
    getBuildTargetId(release.target) !== getBuildTargetId(options.target)
  ) {
    throw new Error(
      'Systemd user-service immutable release disagrees with its reference.',
    );
  }
  await assertRealPath(
    options.fsOps,
    releaseArtifactPath,
    'file',
    'Systemd user-service release artifact',
    options.uid,
  );
  const observed = await options.inspectBytes(releaseArtifactPath);
  if (!hasSameArtifactBytes(observed, release)) {
    throw new Error(
      'Systemd user-service immutable release bytes failed verification.',
    );
  }
  return release;
}

/**
 * Resolve an exact durable activation reference to verified immutable bytes.
 * @param {{fsOps?: typeof fsp, layout: Readonly<Record<string, string>>, inspectBytes?: typeof inspectArtifactBytes, uid: number, target: unknown, reference: Readonly<{artifactId: string, revisionId: string}>}} options - Exact release lookup.
 * @returns {Promise<Readonly<Record<string, any>>>} - Verified release.
 */
async function readReleaseByReference(options) {
  if (
    !options.reference ||
    typeof options.reference !== 'object' ||
    Array.isArray(options.reference) ||
    Object.keys(options.reference).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(options.reference, 'artifactId') ||
    !Object.prototype.hasOwnProperty.call(options.reference, 'revisionId')
  ) {
    throw new TypeError(
      'Systemd user-service release reference must contain only artifactId and revisionId.',
    );
  }
  return await readImmutableRelease({
    ...options,
    fsOps: options.fsOps || fsp,
    inspectBytes: options.inspectBytes || inspectArtifactBytes,
    artifactId: options.reference.artifactId,
    revisionId: options.reference.revisionId,
  });
}

/**
 * Read and verify the optional immutable release selected by `current` without
 * relying on an installation receipt. This is the only authority that lets an
 * orphan cleanup remove the selector or retain an identity tombstone.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, inspectBytes: typeof inspectArtifactBytes, uid: number, target: unknown}} options - Managed selection boundary.
 * @returns {Promise<Readonly<Record<string, any>> | null>} - Verified selected release or null.
 */
async function readSelectedRelease(options) {
  if (
    !(await hasManagedServiceRoot(options.fsOps, options.layout, options.uid))
  ) {
    return null;
  }
  let before;
  try {
    before = await options.fsOps.lstat(options.layout.currentLink);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
  if (!before.isSymbolicLink()) {
    throw new Error(
      'Systemd user-service current selection must be a symbolic link.',
    );
  }
  if (typeof before.uid === 'number' && before.uid !== options.uid) {
    throw new Error(
      'Systemd user-service current selection must be owned by the service user.',
    );
  }
  const selected = await options.fsOps.readlink(options.layout.currentLink);
  const after = await options.fsOps.lstat(options.layout.currentLink);
  if (
    !after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new Error(
      'Systemd user-service current selection changed while it was being read.',
    );
  }
  if (
    path.isAbsolute(selected) ||
    path.dirname(selected) !== 'releases' ||
    path.basename(selected) === '.' ||
    path.basename(selected) === '..'
  ) {
    throw new Error('Systemd user-service current selection is invalid.');
  }
  const artifactId = path.basename(selected);
  const releaseDirectory = path.join(options.layout.releasesRoot, artifactId);
  if (
    selected !== path.relative(options.layout.serviceRoot, releaseDirectory)
  ) {
    throw new Error('Systemd user-service current selection is invalid.');
  }
  return await readImmutableRelease({
    ...options,
    artifactId,
  });
}

/**
 * Classify the fixed local unit without exposing its bytes in status output.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, uid: number}} options - Fixed unit boundary.
 * @returns {Promise<Readonly<{state: 'absent'|'managed'|'conflicting', error?: unknown}>>} - Local unit state.
 */
async function inspectFixedUnitFile(options) {
  try {
    await assertManagedUnitDirectory(
      options.fsOps,
      options.layout,
      options.uid,
    );
    const contents = await readManagedTextFile({
      fsOps: options.fsOps,
      filePath: options.layout.unitPath,
      label: 'Systemd user unit',
      uid: options.uid,
    });
    return Object.freeze({
      state:
        contents === createSystemdUserServiceUnit({ layout: options.layout })
          ? 'managed'
          : 'conflicting',
    });
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      return Object.freeze({ state: 'absent' });
    }
    return Object.freeze({ state: 'conflicting', error });
  }
}

/**
 * Validate the private phase marker that makes destructive manager-wiring
 * removal retryable. The marker is published only after systemd confirms the
 * unit is disabled and inactive.
 * @param {unknown} value - Parsed marker.
 * @param {{appId: string, unitName: string, uid: number, layout: Readonly<Record<string, string>>, artifactId?: string, revisionId?: string}} expected - Exact installation binding.
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
    'layout',
    'unitDigest',
    'receiptState',
    'release',
  ];
  const release = marker.release;
  const releaseKeys = ['artifactId', 'revisionId'];
  const validRelease =
    release === null ||
    (release &&
      typeof release === 'object' &&
      !Array.isArray(release) &&
      Object.keys(release).length === releaseKeys.length &&
      releaseKeys.every((key) =>
        Object.prototype.hasOwnProperty.call(release, key),
      ) &&
      typeof release.artifactId === 'string' &&
      release.artifactId.length > 0 &&
      typeof release.revisionId === 'string' &&
      release.revisionId.length > 0);
  const layoutKeys = Object.keys(expected.layout);
  const validLayout =
    marker.layout &&
    typeof marker.layout === 'object' &&
    !Array.isArray(marker.layout) &&
    Object.keys(marker.layout).length === layoutKeys.length &&
    layoutKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(marker.layout, key) &&
        marker.layout[key] === expected.layout[key],
    );
  const expectedUnitDigest = createHash('sha256')
    .update(createSystemdUserServiceUnit({ layout: expected.layout }), 'utf8')
    .digest('base64url');
  if (
    Object.keys(marker).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(marker, key)) ||
    marker.schemaVersion !== UNINSTALL_MARKER_SCHEMA_VERSION ||
    marker.kind !== UNINSTALL_MARKER_KIND ||
    marker.appId !== expected.appId ||
    marker.unitName !== expected.unitName ||
    marker.uid !== expected.uid ||
    !validLayout ||
    marker.unitDigest !== expectedUnitDigest ||
    !['missing', 'installed', 'uninstalled'].includes(marker.receiptState) ||
    !validRelease ||
    (expected.artifactId !== undefined &&
      release?.artifactId !== expected.artifactId) ||
    (expected.revisionId !== undefined &&
      release?.revisionId !== expected.revisionId)
  ) {
    throw new Error(
      'Systemd user-service uninstall marker disagrees with the installation.',
    );
  }
  return Object.freeze({
    ...marker,
    layout: Object.freeze({ ...marker.layout }),
    release: release === null ? null : Object.freeze({ ...release }),
  });
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
      getBuildTargetId(release.target) !==
        getBuildTargetId(options.pair.runtime.target) ||
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
      artifactId: lifecycle?.artifactId,
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
    runtime.artifactId === installation.current.artifactId &&
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
 * @returns {Readonly<{install: () => Promise<Record<string, any>>, update: () => Promise<Record<string, any>>, rollback: () => Promise<Record<string, any>>, recover: () => Promise<Record<string, any>>, start: () => Promise<Record<string, any>>, stop: () => Promise<Record<string, any>>, restart: () => Promise<Record<string, any>>, status: () => Promise<Record<string, any>>, uninstall: () => Promise<Record<string, any>>}>} - Service operations.
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
  const createControlDB =
    options.createActivationControlDBClient ||
    options.createControlDBClient ||
    createControlDBClient;
  const createActivationStore =
    options.createLocalApplicationActivation ||
    createLocalApplicationActivation;
  const createLedgerStore =
    options.createExecutionLedger || createExecutionLedger;
  const createPayloadStore =
    options.createLocalExecutionPayloadStore ||
    createLocalExecutionPayloadStore;
  const createActivationCoordinator =
    options.createLocalApplicationSystemdActivation ||
    createLocalApplicationSystemdActivation;
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
   * Refuse removal when another manager search directory already contains the
   * same unit name. Removing Wharfie's higher-priority file must not reveal a
   * lower-priority foreign unit after daemon-reload.
   * @param {Readonly<Record<string, string>>} layout - Fixed service layout.
   * @param {string[]} unitPaths - Fresh manager search path.
   * @returns {Promise<void>} - Resolves only when no second claim exists.
   */
  async function assertNoOtherUnitClaims(layout, unitPaths) {
    for (const unitDirectory of unitPaths) {
      const candidate = path.join(unitDirectory, layout.unitName);
      if (candidate === layout.unitPath) continue;
      try {
        await fsOps.lstat(candidate);
      } catch (error) {
        if (hasCode(error, 'ENOENT')) continue;
        throw error;
      }
      throw new Error(
        'Systemd user-service unit name is also claimed in another manager search directory.',
      );
    }
  }

  /**
   * Create and validate only the stable account-home unit directory, then
   * require the live manager to include it in its actual lookup path. A fresh
   * manager may omit a directory until it exists and daemon-reload recomputes
   * UnitPath, so retry exactly once after that bounded preparation.
   * @param {Readonly<Record<string, string>>} layout - Candidate service layout.
   * @param {number} uid - Required filesystem owner.
   * @returns {Promise<string[]>} - Fresh reachable manager search path.
   */
  async function prepareManagerUnitDirectory(layout, uid) {
    const unitDirectory = path.dirname(layout.unitPath);
    let unitPaths = await readManagerUnitPaths();
    await ensureManagedUnitDirectory(fsOps, layout, uid);
    if (unitPaths.includes(unitDirectory)) return unitPaths;
    await systemctl(['daemon-reload']);
    unitPaths = await readManagerUnitPaths();
    if (!unitPaths.includes(unitDirectory)) {
      throw new Error(
        `Systemd user manager does not search Wharfie's fixed unit directory ${unitDirectory}; remove conflicting manager path overrides and restart the user manager before installing.`,
      );
    }
    return unitPaths;
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
   * Require systemd to resolve the unit name from Wharfie's fixed fragment
   * without administrator or generator drop-ins. Cache freshness is checked
   * separately so missing local bytes can be restored before daemon-reload.
   * @param {Readonly<Record<string, any>>} systemd - Parsed manager state.
   * @param {Readonly<Record<string, string>>} layout - Expected unit layout.
   * @returns {boolean} - Whether the loaded source identity is exact.
   */
  function hasExpectedUnitSource(systemd, layout) {
    return (
      systemd.loadState === 'loaded' &&
      systemd.fragmentPath === layout.unitPath &&
      systemd.dropInPaths === ''
    );
  }

  /**
   * @param {Readonly<Record<string, any>>} systemd - Parsed manager state.
   * @param {Readonly<Record<string, string>>} layout - Expected unit layout.
   * @returns {boolean} - Whether exact effective wiring is also fresh.
   */
  function hasExpectedEffectiveUnit(systemd, layout) {
    return (
      hasExpectedUnitSource(systemd, layout) &&
      systemd.needDaemonReload === false
    );
  }

  /**
   * Join local unit bytes with the manager's effective selection. Intent from
   * an installed receipt determines whether matching wiring is managed or an
   * orphan that must be reconciled explicitly.
   * @param {Readonly<{state: 'absent'|'managed'|'conflicting'}>} unitFile - Fixed local file state.
   * @param {'absent'|'managed'|'conflicting'} selection - Immutable executable selection state.
   * @param {Readonly<Record<string, any>>} systemd - Live or unavailable manager state.
   * @param {Readonly<Record<string, string>>} layout - Fixed service layout.
   * @param {boolean} installed - Whether a receipt requires wiring to exist.
   * @param {boolean} cleanupPending - Whether an uninstall marker remains.
   * @returns {Readonly<Record<string, any>>} - Redacted actual-wiring view.
   */
  function createWiringView(
    unitFile,
    selection,
    systemd,
    layout,
    installed,
    cleanupPending,
  ) {
    const effectiveUnit =
      systemd.loadState === 'unavailable'
        ? 'unknown'
        : systemd.loadState === 'not-found'
          ? 'absent'
          : hasExpectedEffectiveUnit(systemd, layout)
            ? 'managed'
            : 'conflicting';
    let state;
    if (
      unitFile.state === 'conflicting' ||
      selection === 'conflicting' ||
      effectiveUnit === 'conflicting'
    ) {
      state = 'conflicting';
    } else if (effectiveUnit === 'unknown') {
      state = 'unknown';
    } else if (
      unitFile.state === 'absent' &&
      selection === 'absent' &&
      effectiveUnit === 'absent'
    ) {
      state = cleanupPending ? 'orphaned' : 'absent';
    } else if (
      installed &&
      unitFile.state === 'managed' &&
      selection === 'managed' &&
      effectiveUnit === 'managed' &&
      !cleanupPending
    ) {
      state = 'managed';
    } else {
      state = installed ? 'conflicting' : 'orphaned';
    }
    return Object.freeze({
      state,
      unitFile: unitFile.state,
      selection,
      effectiveUnit,
      cleanupPending,
    });
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
   * @param {unknown} target - Exact packaged build target.
   * @param {{allowUninstalledTargetMismatch?: boolean}} [readOptions] - Narrow legacy tombstone policy.
   * @returns {Promise<Readonly<Record<string, any>> | null>} - Installation or null.
   */
  async function readInstallation(
    layout,
    uid,
    filesystemUid,
    target,
    readOptions = {},
  ) {
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
    const targetId = getBuildTargetId(target);
    const targetMismatch =
      getBuildTargetId(installation.current.target) !== targetId ||
      (installation.previous &&
        getBuildTargetId(installation.previous.target) !== targetId);
    if (
      targetMismatch &&
      !(
        readOptions.allowUninstalledTargetMismatch === true &&
        installation.state === 'uninstalled'
      )
    ) {
      throw new Error(
        'Installed systemd user service belongs to a different build target.',
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
      layout: context.layout,
      ...(installation
        ? {
            artifactId: installation.current.artifactId,
            revisionId: installation.current.revisionId,
          }
        : {}),
    });
  }

  /**
   * Remove only a private regular temp file left by this process's atomic
   * uninstall-marker publication after a hard crash. The operation lock makes
   * a matching publication stale; every other service-root entry remains
   * potential durable application state and is never ignored.
   * @param {{layout: Readonly<Record<string, string>>, filesystemUid: number}} context - Exact managed root.
   * @returns {Promise<void>} - Resolves after stale marker temps are removed.
   */
  async function removeStaleUninstallMarkerTemps(context) {
    if (
      !(await hasManagedServiceRoot(
        fsOps,
        context.layout,
        context.filesystemUid,
      ))
    ) {
      return;
    }
    const prefix = `.${path.basename(context.layout.uninstallPath)}.`;
    const suffix = '.tmp';
    let removed = false;
    for (const entry of await fsOps.readdir(context.layout.serviceRoot)) {
      if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
      const token = entry.slice(prefix.length, -suffix.length);
      if (!ATOMIC_PUBLICATION_TOKEN_PATTERN.test(token)) continue;
      const temporary = path.join(context.layout.serviceRoot, entry);
      await assertRealPath(
        fsOps,
        temporary,
        'file',
        'Stale systemd user-service uninstall-marker publication',
        context.filesystemUid,
      );
      await fsOps.unlink(temporary);
      removed = true;
    }
    if (removed) {
      await syncDirectory(fsOps, context.layout.serviceRoot);
    }
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
    const unitFile = await inspectFixedUnitFile({
      fsOps,
      layout: installation.layout,
      uid: Number(getFilesystemUid()),
    });
    const wiring = createWiringView(
      unitFile,
      integrity.status === 'verified' ? 'managed' : 'conflicting',
      systemd,
      installation.layout,
      true,
      false,
    );
    if (integrity.status === 'verified' && wiring.state !== 'managed') {
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
      schemaVersion: SERVICE_STATUS_SCHEMA_VERSION,
      kind: SERVICE_STATUS_KIND,
      appId: installation.appId,
      unit: installation.unitName,
      installation: {
        state: 'installed',
        activeArtifactId: installation.current.artifactId,
        activeRevisionId: installation.current.revisionId,
        previousArtifactId: installation.previous?.artifactId || null,
        previousRevisionId: installation.previous?.revisionId || null,
      },
      systemd,
      runtime,
      integrity,
      wiring,
      persistence,
      health,
    };
  }

  /**
   * Observe actual unit wiring when durable metadata says no installation is
   * present. Absence is established only by both disk and a reachable fresh
   * manager; any divergence remains visible and non-healthy.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {Readonly<Record<string, any>> | null} installation - Missing receipt or tombstone.
   * @param {Readonly<Record<string, any>> | null} marker - Optional cleanup marker.
   * @returns {Promise<Record<string, any>>} - Redacted detached status.
   */
  async function observeDetachedInstallation(context, installation, marker) {
    const unitFile = await inspectFixedUnitFile({
      fsOps,
      layout: context.layout,
      uid: context.filesystemUid,
    });
    /** @type {'absent'|'managed'|'conflicting'} */
    let selection;
    try {
      selection = (await readSelectedRelease({
        fsOps,
        layout: context.layout,
        inspectBytes,
        uid: context.filesystemUid,
        target: context.pair.runtime.target,
      }))
        ? 'managed'
        : 'absent';
    } catch {
      selection = 'conflicting';
    }
    let systemd;
    try {
      systemd = await readSystemd(context.layout);
    } catch {
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
    const wiring = createWiringView(
      unitFile,
      selection,
      systemd,
      context.layout,
      false,
      marker !== null,
    );
    return {
      schemaVersion: SERVICE_STATUS_SCHEMA_VERSION,
      kind: SERVICE_STATUS_KIND,
      appId: context.pair.runtime.appId,
      unit: context.layout.unitName,
      installation: installation
        ? installation.state === 'installed'
          ? {
              state: 'installed',
              activeArtifactId: installation.current.artifactId,
              activeRevisionId: installation.current.revisionId,
              previousArtifactId: installation.previous?.artifactId || null,
              previousRevisionId: installation.previous?.revisionId || null,
            }
          : {
              state: 'uninstalled',
              lastArtifactId: installation.current.artifactId,
              lastRevisionId: installation.current.revisionId,
            }
        : { state: 'absent' },
      systemd,
      runtime: null,
      wiring,
      health: wiring.state === 'absent' ? 'absent' : 'degraded',
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
   * Wharfie's exact fragment without drop-ins. This refuses an observed
   * higher-precedence foreign unit; concurrent mutation by another same-UID
   * process remains inside the documented trusted-user boundary.
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
      requestStatus: 'fulfilled',
      appId: status.appId,
      outcome,
      unit: status.unit,
      health: status.health,
      activeArtifactId: status.installation?.activeArtifactId || null,
      activeRevisionId: status.installation?.activeRevisionId || null,
      rollbackArtifactId: status.installation?.previousArtifactId || null,
      rollbackRevisionId: status.installation?.previousRevisionId || null,
    };
  }

  /**
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>}} context - App context.
   * @param {'uninstalled'|'orphan-reconciled'|'already-uninstalled'} outcome - Converged result.
   * @returns {Record<string, any>} - Data-preserving uninstall receipt.
   */
  function createUninstallReceipt(context, outcome) {
    return {
      schemaVersion: SERVICE_RESULT_SCHEMA_VERSION,
      kind: SERVICE_RESULT_KIND,
      action: 'uninstall',
      requestStatus: 'fulfilled',
      appId: context.pair.runtime.appId,
      outcome,
      unit: context.layout.unitName,
      health: 'absent',
      activeArtifactId: null,
      activeRevisionId: null,
      rollbackArtifactId: null,
      rollbackRevisionId: null,
      preserved: {
        releases: context.layout.releasesRoot,
        state: context.layout.stateRoot,
      },
    };
  }

  /**
   * @param {Readonly<Record<string, any>> | null} activation - Durable activation snapshot.
   * @returns {Readonly<Record<string, any>> | null} Redacted activation view.
   */
  function createActivationStatusView(activation) {
    if (!activation) return null;
    /**
     * @param {Readonly<Record<string, any>> | null | undefined} value - Release.
     * @returns {Readonly<Record<string, string>> | null} Redacted reference.
     */
    const release = (value) =>
      value
        ? Object.freeze({
            artifactId: value.artifactId,
            revisionId: value.revisionId,
          })
        : null;
    return Object.freeze({
      phase: activation.phase,
      action: activation.transition?.action || null,
      desired: release(activation.desired),
      selected: release(activation.selected),
      rollback: release(activation.rollbackCandidate),
      lastOutcome: activation.lastTransition?.outcome || null,
    });
  }

  /**
   * @template T
   * @param {import('../../lib/db/base.js').DBClient | undefined} db - Open DB.
   * @param {() => Promise<T>} handler - DB-scoped work.
   * @returns {Promise<T>} Result after close.
   */
  async function withOpenControlDB(db, handler) {
    /** @type {T | undefined} */
    let result;
    /** @type {unknown} */
    let handlerError;
    let handlerFailed = false;
    try {
      result = await handler();
    } catch (error) {
      handlerFailed = true;
      handlerError = error;
    }
    /** @type {unknown} */
    let closeError;
    let closeFailed = false;
    try {
      await db?.close?.();
    } catch (error) {
      closeFailed = true;
      closeError = error;
    }
    if (handlerFailed && closeFailed) {
      throw new AggregateError(
        [handlerError, closeError],
        'Systemd activation convergence and control-store close both failed.',
      );
    }
    if (handlerFailed) throw handlerError;
    if (closeFailed) throw closeError;
    return /** @type {T} */ (result);
  }

  /**
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, filesystemUid: number}} context - App context.
   * @returns {Promise<Readonly<Record<string, any>> | null>} Activation snapshot.
   */
  async function readActivationSnapshot(context) {
    try {
      await assertRealPath(
        fsOps,
        context.layout.controlPath,
        'directory',
        'Systemd user-service control root',
        context.filesystemUid,
      );
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
    const db = await createControlDB('lmdb', {
      path: context.layout.controlPath,
      readOnly: true,
    });
    return await withOpenControlDB(db, async () => {
      const activation = createActivationStore({
        db,
        tableName: context.layout.executionLedgerTable,
        now,
      });
      return await activation.get({ appId: context.pair.runtime.appId });
    });
  }

  /**
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, filesystemUid: number}} context - App context.
   * @param {Readonly<{artifactId: string, revisionId: string}>} reference - Activation release reference.
   * @returns {Promise<Readonly<Record<string, any>>>} - Exact immutable release.
   */
  async function readActivationRelease(context, reference) {
    return await readReleaseByReference({
      fsOps,
      layout: context.layout,
      inspectBytes,
      uid: context.filesystemUid,
      target: context.pair.runtime.target,
      reference,
    });
  }

  /**
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, filesystemUid: number}} context - App context.
   * @param {Readonly<Record<string, any>>} projection - Current/previous activation projection.
   * @returns {Promise<{current: Readonly<Record<string, any>>, previous: Readonly<Record<string, any>> | null}>} - Verified release records.
   */
  async function readProjectionReleases(context, projection) {
    if (projection.appId !== context.pair.runtime.appId) {
      throw new Error(
        'Systemd activation projection belongs to a different application.',
      );
    }
    const current = await readActivationRelease(context, projection.current);
    const previous = projection.previous
      ? await readActivationRelease(context, projection.previous)
      : null;
    return { current, previous };
  }

  /**
   * Verify the exact receipt, selector, immutable releases, fixed unit and
   * persistent manager wiring represented by one activation projection.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {Readonly<Record<string, any>>} projection - Exact projection.
   * @returns {Promise<{installation: Readonly<Record<string, any>>, integrity: Readonly<Record<string, any>>, systemd: Readonly<Record<string, any>>}>} - Verified physical projection.
   */
  async function verifyPhysicalSelection(context, projection) {
    const releases = await readProjectionReleases(context, projection);
    const installation = await readInstallation(
      context.layout,
      context.uid,
      context.filesystemUid,
      context.pair.runtime.target,
    );
    if (!installation || installation.state !== 'installed') {
      throw new Error(
        'Systemd activation selection has no installed projection receipt.',
      );
    }
    if (
      !hasSameReleaseReference(installation.current, projection.current) ||
      (projection.previous
        ? !hasSameReleaseReference(installation.previous, projection.previous)
        : installation.previous !== null)
    ) {
      throw new Error(
        'Systemd activation receipt disagrees with its durable selection projection.',
      );
    }
    if (
      JSON.stringify(installation.current) !==
        JSON.stringify(releases.current) ||
      (releases.previous
        ? JSON.stringify(installation.previous) !==
          JSON.stringify(releases.previous)
        : installation.previous !== null)
    ) {
      throw new Error(
        'Systemd activation receipt does not retain the exact immutable release records.',
      );
    }
    const selected = await readSelectedRelease({
      fsOps,
      layout: context.layout,
      inspectBytes,
      uid: context.filesystemUid,
      target: context.pair.runtime.target,
    });
    if (!hasSameReleaseReference(selected, projection.current)) {
      throw new Error(
        'Systemd activation selector disagrees with its durable projection.',
      );
    }
    const integrity = await verifyInstalledSelection({
      fsOps,
      installation,
      inspectBytes,
      uid: context.filesystemUid,
    });
    const systemd = await assertExpectedEffectiveUnit(installation);
    if (systemd.unitFileState !== 'enabled') {
      throw new Error(
        'Systemd activation projection is not persistently enabled.',
      );
    }
    if (!(await readLinger(context.uid))) {
      throw new Error(
        'Systemd activation projection is not boot persistent because lingering is disabled.',
      );
    }
    return { installation, integrity, systemd };
  }

  /**
   * Publish or repair a selector/receipt/unit projection only from references
   * already authorized by the durable activation transition. Either selector
   * or receipt may have reached disk first before a crash.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {ReturnType<typeof createLocalApplicationActivation>} activation - Activation store.
   * @param {Readonly<Record<string, any>>} projection - Desired projection.
   * @returns {Promise<void>} - Resolves after exact persistent selection.
   */
  async function convergePhysicalSelection(context, activation, projection) {
    const releases = await readProjectionReleases(context, projection);
    const durable = await activation.get({
      appId: context.pair.runtime.appId,
    });
    if (!durable) {
      throw new Error(
        'Systemd activation selection requires durable activation authority.',
      );
    }
    if (
      projection.transitionId !== null &&
      projection.transitionId !== undefined &&
      durable.transition?.transitionId !== projection.transitionId
    ) {
      throw new Error(
        'Systemd activation selection transition changed before publication.',
      );
    }
    const authorizedReferences = [
      durable.selected,
      durable.desired,
      durable.rollbackCandidate,
      durable.transition?.source,
      durable.transition?.target,
    ].filter(Boolean);
    /**
     * @param {Readonly<Record<string, any>> | null} release - Physical release.
     * @returns {boolean} Whether durable state authorizes it.
     */
    const isAuthorized = (release) =>
      release === null ||
      authorizedReferences.some((reference) =>
        hasSameReleaseReference(release, reference),
      );

    const unitPaths = await prepareManagerUnitDirectory(
      context.layout,
      context.filesystemUid,
    );
    await assertNoOtherUnitClaims(context.layout, unitPaths);
    await ensureManagedServiceRoot(
      fsOps,
      context.layout,
      context.filesystemUid,
    );
    for (const [directory, label] of [
      [context.layout.stateRoot, 'Systemd user-service state root'],
      [context.layout.controlPath, 'Systemd user-service control root'],
      [
        context.layout.applicationStatePath,
        'Systemd user-service application-state root',
      ],
    ]) {
      await ensureManagedDirectory(
        fsOps,
        directory,
        label,
        context.filesystemUid,
      );
    }

    const existing = await readInstallation(
      context.layout,
      context.uid,
      context.filesystemUid,
      context.pair.runtime.target,
      { allowUninstalledTargetMismatch: true },
    );
    if (
      existing?.state === 'installed' &&
      (!isAuthorized(existing.current) || !isAuthorized(existing.previous))
    ) {
      throw new Error(
        'Systemd installation receipt names a release outside durable activation authority.',
      );
    }
    if (await readUninstallMarker(context, existing)) {
      throw new Error(
        'Systemd user-service uninstall is incomplete; finish uninstall before activation.',
      );
    }
    const selected = await readSelectedRelease({
      fsOps,
      layout: context.layout,
      inspectBytes,
      uid: context.filesystemUid,
      target: context.pair.runtime.target,
    });
    if (selected && !isAuthorized(selected)) {
      throw new Error(
        'Systemd selector names a release outside durable activation authority.',
      );
    }
    const unitFile = await inspectFixedUnitFile({
      fsOps,
      layout: context.layout,
      uid: context.filesystemUid,
    });
    if (unitFile.state === 'conflicting') {
      throw new Error(
        'Systemd user unit path contains unverified or different content.',
      );
    }
    let knownUnit = await readSystemd(context.layout);
    if (knownUnit.loadState !== 'not-found') {
      if (!hasExpectedUnitSource(knownUnit, context.layout)) {
        throw new Error(
          'Systemd user-service unit name is claimed by another effective configuration.',
        );
      }
      if (unitFile.state === 'managed' && knownUnit.needDaemonReload) {
        await systemctl(['daemon-reload']);
        knownUnit = await readSystemd(context.layout);
      }
      if (
        unitFile.state === 'managed' &&
        !hasExpectedEffectiveUnit(knownUnit, context.layout)
      ) {
        throw new Error(
          'Systemd user-service manager has stale or conflicting effective wiring.',
        );
      }
    }

    if (!hasSameReleaseReference(selected, projection.current)) {
      await selectRelease({
        fsOps,
        layout: context.layout,
        artifactId: releases.current.artifactId,
        token: createToken(),
      });
    }
    const observedAt = now();
    const installation = createSystemdUserServiceInstallation({
      layout: context.layout,
      uid: context.uid,
      current: releases.current,
      ...(releases.previous ? { previous: releases.previous } : {}),
      state: 'installed',
      installedAt: existing?.installedAt ?? releases.current.installedAt,
      updatedAt: Math.max(
        existing?.updatedAt ?? releases.current.installedAt,
        observedAt,
      ),
    });
    await writeFileAtomic({
      fsOps,
      filePath: context.layout.installationPath,
      contents: `${JSON.stringify(installation, null, 2)}\n`,
      mode: 0o600,
      token: createToken(),
      uid: context.filesystemUid,
    });

    if (unitFile.state === 'absent') {
      await writeFileAtomic({
        fsOps,
        filePath: context.layout.unitPath,
        contents: createSystemdUserServiceUnit({ layout: context.layout }),
        mode: 0o600,
        token: createToken(),
        uid: context.filesystemUid,
      });
    }
    await systemctl(['daemon-reload']);
    const loaded = await readSystemd(context.layout);
    if (!hasExpectedEffectiveUnit(loaded, context.layout)) {
      throw new Error(
        "Systemd did not load Wharfie's exact activation unit without drop-ins.",
      );
    }
    await systemctl(['enable', context.layout.unitName]);
    await verifyPhysicalSelection(context, projection);
  }

  /**
   * Prove there is no physical service projection before creating the first
   * activation record. Immutable staged releases and the fixed control/state
   * directories are deliberately not wiring.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @returns {Promise<void>} - Resolves only for exact absence.
   */
  async function verifyPhysicalAbsence(context) {
    const installation = await readInstallation(
      context.layout,
      context.uid,
      context.filesystemUid,
      context.pair.runtime.target,
      { allowUninstalledTargetMismatch: true },
    );
    if (installation && installation.state !== 'uninstalled') {
      throw new Error(
        'Systemd activation is missing while an installation receipt exists.',
      );
    }
    if (await readUninstallMarker(context, null)) {
      throw new Error(
        'Systemd activation is missing while an uninstall marker exists.',
      );
    }
    const selected = await readSelectedRelease({
      fsOps,
      layout: context.layout,
      inspectBytes,
      uid: context.filesystemUid,
      target: context.pair.runtime.target,
    });
    if (selected) {
      throw new Error(
        'Systemd activation is missing while an executable selector exists.',
      );
    }
    let fixedUnitExists = true;
    try {
      await fsOps.lstat(context.layout.unitPath);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) fixedUnitExists = false;
      else throw error;
    }
    if (fixedUnitExists) {
      throw new Error(
        'Systemd activation is missing while fixed unit wiring exists.',
      );
    }
    let systemd = await readSystemd(context.layout);
    if (systemd.loadState !== 'not-found') {
      throw new Error(
        'Systemd activation is missing while effective manager wiring exists.',
      );
    }
    if (systemd.needDaemonReload) {
      await systemctl(['daemon-reload']);
      systemd = await readSystemd(context.layout);
    }
    if (
      systemd.loadState !== 'not-found' ||
      systemd.needDaemonReload !== false
    ) {
      throw new Error(
        'Systemd activation cannot prove fresh effective-manager absence.',
      );
    }
  }

  /**
   * @param {Readonly<Record<string, any>>} installation - Exact selected receipt.
   * @param {Readonly<Record<string, any>>} integrity - Verified bytes.
   * @returns {Promise<'healthy'|'failed'>} - Definitive activation result.
   */
  async function waitForActivationOutcome(installation, integrity) {
    const attempts = Math.ceil(startTimeoutMs / pollIntervalMs) + 1;
    const deadline = monotonicNow() + startTimeoutMs;
    let last;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      last = await observeInstallation(installation, { integrity, deadline });
      if (last.health === 'healthy') return 'healthy';
      if (last.health === 'failed' || last.health === 'stopped')
        return 'failed';
      const remaining = deadline - monotonicNow();
      if (remaining <= 0) break;
      if (attempt + 1 < attempts) {
        await wait(Math.min(pollIntervalMs, Math.ceil(remaining)));
      }
    }
    const error = new Error(
      `Systemd user service activation remained ${last?.health || 'unknown'} after ${startTimeoutMs}ms.`,
    );
    error.name = 'SystemdUserServiceHealthTimeoutError';
    Object.assign(error, {
      code: 'systemd-user-service-health-timeout',
      expected: 'healthy-or-failed',
      status: last,
    });
    throw error;
  }

  /**
   * Construct a narrow no-lock physical driver. The caller holds the single
   * kernel operation lock for the complete DB and host convergence.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {import('../../lib/db/base.js').DBClient} db - Open fixed control DB.
   * @param {ReturnType<typeof createLocalApplicationActivation>} activation - Activation store.
   * @returns {Readonly<Record<string, Function>>} - Physical driver methods.
   */
  function createActivationDriver(context, db, activation) {
    const appId = context.pair.runtime.appId;
    const tableName = context.layout.executionLedgerTable;

    /** @param {Readonly<Record<string, any>>} input - Driver input. @returns {void} - Validates app scope. */
    function assertApp(input) {
      if (input.appId !== appId) {
        throw new Error('Systemd activation driver application mismatch.');
      }
    }

    return Object.freeze({
      /** @param {Readonly<Record<string, any>>} input - Staging request. @returns {Promise<void>} - Resolves after staging. */
      async stageRelease(input) {
        assertApp(input);
        const artifact = await inspectBytes(artifactPath);
        if (
          input.release.revisionId !== context.pair.runtime.revisionId ||
          input.release.artifactId !== artifact.artifactId
        ) {
          throw new Error(
            'Systemd activation can stage only the exact invoking packaged artifact.',
          );
        }
        await ensureManagedServiceRoot(
          fsOps,
          context.layout,
          context.filesystemUid,
        );
        const staged = await stageRelease({
          fsOps,
          layout: context.layout,
          uid: context.filesystemUid,
          artifactPath,
          artifact,
          pair: context.pair,
          installedAt: now(),
          token: createToken(),
          inspectBytes,
        });
        if (!hasSameReleaseReference(staged, input.release)) {
          throw new Error(
            'Staged systemd release disagrees with the activation target.',
          );
        }
      },

      /** @param {Readonly<Record<string, any>>} input - Verification request. @returns {Promise<void>} - Resolves after verification. */
      async verifyRelease(input) {
        assertApp(input);
        await readActivationRelease(context, input.release);
      },

      /** @param {Readonly<Record<string, any>>} input - Absence request. @returns {Promise<void>} - Resolves for absence. */
      async verifyAbsent(input) {
        assertApp(input);
        await verifyPhysicalAbsence(context);
      },

      /** @param {Readonly<Record<string, any>>} input - Stop request. @returns {Promise<void>} - Resolves after stop. */
      async stopService(input) {
        assertApp(input);
        const systemd = await readSystemd(context.layout);
        if (systemd.loadState === 'not-found') {
          if (systemd.activeState !== 'inactive') {
            throw new Error(
              'Systemd reported an active service without loaded unit wiring.',
            );
          }
          return;
        }
        if (!hasExpectedEffectiveUnit(systemd, context.layout)) {
          throw new Error(
            'Systemd loaded different or stale wiring while activation tried to stop the service.',
          );
        }
        if (systemd.activeState === 'inactive') return;
        await systemctl(['stop', context.layout.unitName]);
        await waitForSystemdInactive({ layout: context.layout }, stopTimeoutMs);
      },

      /** @param {Readonly<Record<string, any>>} input - Inactivity proof request. @returns {Promise<void>} - Resolves for inactive service. */
      async proveServiceInactive(input) {
        assertApp(input);
        const systemd = await readSystemd(context.layout);
        if (
          systemd.loadState === 'not-found' &&
          systemd.activeState === 'inactive'
        ) {
          return;
        }
        if (!hasExpectedEffectiveUnit(systemd, context.layout)) {
          throw new Error(
            'Systemd activation could not prove exact service wiring before inactivity.',
          );
        }
        if (systemd.activeState !== 'inactive') {
          await waitForSystemdInactive(
            { layout: context.layout },
            stopTimeoutMs,
          );
        }
      },

      /**
       * @param {Readonly<Record<string, any>>} input - Selection request.
       * @returns {Promise<void>} Resolves after selection.
       */
      async selectRelease(input) {
        assertApp(input);
        await convergePhysicalSelection(context, activation, input);
      },

      /**
       * @param {Readonly<Record<string, any>>} input - Projection verification.
       * @returns {Promise<void>} Resolves after verification.
       */
      async verifySelection(input) {
        assertApp(input);
        await verifyPhysicalSelection(context, input);
      },

      /**
       * @param {Readonly<Record<string, any>>} input - Activation request.
       * @returns {Promise<Readonly<{status: 'healthy'|'failed'}>>} Definitive activation outcome.
       */
      async activateRelease(input) {
        assertApp(input);
        const installation = await readInstallation(
          context.layout,
          context.uid,
          context.filesystemUid,
          context.pair.runtime.target,
        );
        if (
          !installation ||
          installation.state !== 'installed' ||
          !hasSameReleaseReference(installation.current, input.release)
        ) {
          throw new Error(
            'Systemd activation cannot start a release outside its exact installed projection.',
          );
        }
        const projection = Object.freeze({
          appId,
          current: input.release,
          previous: installation.previous
            ? Object.freeze({
                artifactId: installation.previous.artifactId,
                revisionId: installation.previous.revisionId,
              })
            : null,
        });
        const verified = await verifyPhysicalSelection(context, projection);
        await getLocalApplicationServiceStartFence({
          db,
          tableName,
          appId,
          artifactId: input.release.artifactId,
          revisionId: input.release.revisionId,
        });
        const before = await observeInstallation(verified.installation, {
          integrity: verified.integrity,
        });
        if (before.health === 'healthy') return { status: 'healthy' };
        try {
          await systemctl(['start', context.layout.unitName]);
        } catch (error) {
          try {
            const observed = await observeInstallation(verified.installation, {
              integrity: verified.integrity,
            });
            if (observed.health === 'failed') return { status: 'failed' };
          } catch {
            // The original host-command error is the only reliable evidence.
          }
          throw error;
        }
        return {
          status: await waitForActivationOutcome(
            verified.installation,
            verified.integrity,
          ),
        };
      },

      /** @param {Readonly<Record<string, any>>} input - Health verification request. @returns {Promise<void>} - Resolves for exact health. */
      async verifyActiveRelease(input) {
        assertApp(input);
        const durable = await activation.get({ appId });
        const previous = durable
          ? getActivationPhysicalPrevious(durable)
          : undefined;
        if (
          !durable ||
          !durable.selected ||
          previous === undefined ||
          !hasSameReleaseReference(durable.selected, input.release)
        ) {
          throw new Error(
            'Systemd active release has no exact durable activation projection.',
          );
        }
        const installation = await readInstallation(
          context.layout,
          context.uid,
          context.filesystemUid,
          context.pair.runtime.target,
        );
        if (
          !installation ||
          installation.state !== 'installed' ||
          !hasSameReleaseReference(installation.current, input.release)
        ) {
          throw new Error(
            'Systemd active release has no exact installed projection.',
          );
        }
        const projection = Object.freeze({
          appId,
          current: input.release,
          previous,
        });
        const verified = await verifyPhysicalSelection(context, projection);
        const observed = await observeInstallation(verified.installation, {
          integrity: verified.integrity,
        });
        if (observed.health !== 'healthy') {
          const error = new Error(
            `Systemd active release is not independently healthy (${observed.health}).`,
          );
          error.name = 'SystemdUserServiceActivationHealthError';
          Object.assign(error, {
            code: 'systemd-user-service-activation-unhealthy',
            status: observed,
          });
          throw error;
        }
      },
    });
  }

  /**
   * Hold one kernel lock across the activation DB, quiescence ledger, and all
   * physical host effects. The converger receives a no-op nested lock adapter
   * so it cannot recursively acquire the same kernel address.
   * @template T
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {(runtime: {activation: ReturnType<typeof createLocalApplicationActivation>, coordinator: Readonly<Record<string, Function>>, driver: Readonly<Record<string, Function>>}) => Promise<T>} handler - Locked operation.
   * @param {{preflightFirstInstall?: boolean}} [runtimeOptions] - First-install host preflight.
   * @returns {Promise<T>} - Converged result.
   */
  async function withLockedActivation(context, handler, runtimeOptions = {}) {
    const releaseLock = await acquireLock({
      serviceRoot: context.layout.serviceRoot,
      uid: context.uid,
    });
    try {
      if (runtimeOptions.preflightFirstInstall === true) {
        let controlRootExists = true;
        try {
          await fsOps.lstat(context.layout.controlPath);
        } catch (error) {
          if (hasCode(error, 'ENOENT')) controlRootExists = false;
          else throw error;
        }
        if (!controlRootExists) {
          await prepareManagerUnitDirectory(
            context.layout,
            context.filesystemUid,
          );
          await verifyPhysicalAbsence(context);
        }
      }
      await ensureManagedServiceRoot(
        fsOps,
        context.layout,
        context.filesystemUid,
      );
      for (const [directory, label] of [
        [context.layout.stateRoot, 'Systemd user-service state root'],
        [context.layout.controlPath, 'Systemd user-service control root'],
        [
          context.layout.applicationStatePath,
          'Systemd user-service application-state root',
        ],
      ]) {
        await ensureManagedDirectory(
          fsOps,
          directory,
          label,
          context.filesystemUid,
        );
      }
      const db = await createControlDB('lmdb', {
        path: context.layout.controlPath,
      });
      return await withOpenControlDB(db, async () => {
        const activation = createActivationStore({
          db,
          tableName: context.layout.executionLedgerTable,
          now,
        });
        const payloadStore = createPayloadStore({
          path: context.layout.payloadPath,
          storeId: defaultPayloadStoreId(context.layout.payloadPath),
        });
        const ledger = createLedgerStore({
          db,
          tableName: context.layout.executionLedgerTable,
          payloadStore,
          effectEvidenceVerifiers: [
            ...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS,
          ],
          now,
        });
        const driver = createActivationDriver(context, db, activation);
        const coordinator = createActivationCoordinator({
          activation,
          ledger,
          acquireOperationLock: async () => async () => undefined,
          ...driver,
        });
        try {
          return await handler({ activation, coordinator, driver });
        } catch (error) {
          let current;
          try {
            current = await activation.get({
              appId: context.pair.runtime.appId,
            });
          } catch {
            throw error;
          }
          if (
            current &&
            current.phase !== LocalApplicationActivationPhase.ACTIVE
          ) {
            throw createActivationRecoveryRequiredError(error);
          }
          throw error;
        }
      });
    } finally {
      await releaseLock();
    }
  }

  /**
   * Convert an internal activation result into the stable service receipt used
   * by both JSON and human operator surfaces.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {Readonly<Record<string, any>>} result - Activation result.
   * @param {string} [action] - Optional public action override.
   * @returns {Promise<Record<string, any>>} - Stable receipt.
   */
  async function createActivationReceipt(context, result, action) {
    const installation = await readInstallation(
      context.layout,
      context.uid,
      context.filesystemUid,
      context.pair.runtime.target,
    );
    let health = 'degraded';
    let provenActive = null;
    if (installation?.state === 'installed') {
      const observed = await observeInstallation(installation, {
        tolerateSystemdFailure: true,
      });
      health = observed.health;
      if (
        observed.health === 'healthy' &&
        result.activation?.selected &&
        hasSameReleaseReference(
          installation.current,
          result.activation.selected,
        )
      ) {
        provenActive = result.activation.selected;
      }
    } else if (!result.activation) {
      health = 'absent';
    }
    const rollback = result.activation?.rollbackCandidate || null;
    const blockingWork = result.quiescence
      ? Object.freeze({
          reason: result.reason,
          blockerCount: result.quiescence.blockerCount,
          blockers: result.quiescence.blockers,
          blockersTruncated: result.quiescence.blockersTruncated === true,
        })
      : null;
    return {
      schemaVersion: SERVICE_RESULT_SCHEMA_VERSION,
      kind: SERVICE_RESULT_KIND,
      action: action || result.operation,
      requestStatus: result.requestStatus,
      appId: context.pair.runtime.appId,
      outcome: result.settledOutcome,
      unit: context.layout.unitName,
      health,
      activeArtifactId: provenActive?.artifactId || null,
      activeRevisionId: provenActive?.revisionId || null,
      rollbackArtifactId: rollback?.artifactId || null,
      rollbackRevisionId: rollback?.revisionId || null,
      reason: result.reason,
      blockingWork,
    };
  }

  /**
   * Prove that any existing receipt, selector, and manager wiring is either
   * absent or an authorized projection of the durable ACTIVE selection. This
   * check is deliberately read-only and must complete before reinstall stops
   * a running service.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {Readonly<Record<string, any>>} projection - Exact durable projection.
   * @returns {Promise<Readonly<{needsRepair: boolean}>>} Repair classification after authority proof.
   */
  async function inspectPhysicalSelectionRepair(context, projection) {
    const releases = await readProjectionReleases(context, projection);
    const installation = await readInstallation(
      context.layout,
      context.uid,
      context.filesystemUid,
      context.pair.runtime.target,
    );
    if (
      installation &&
      (!hasSameReleaseReference(installation.current, projection.current) ||
        !hasSameReleaseReference(installation.previous, projection.previous) ||
        JSON.stringify(installation.current) !==
          JSON.stringify(releases.current) ||
        (releases.previous
          ? JSON.stringify(installation.previous) !==
            JSON.stringify(releases.previous)
          : installation.previous !== null))
    ) {
      throw new Error(
        'Systemd installation receipt is outside durable activation repair authority.',
      );
    }
    if (await readUninstallMarker(context, installation)) {
      throw new Error(
        'Systemd user-service uninstall is incomplete; finish uninstall before reinstalling.',
      );
    }
    const selected = await readSelectedRelease({
      fsOps,
      layout: context.layout,
      inspectBytes,
      uid: context.filesystemUid,
      target: context.pair.runtime.target,
    });
    if (selected && !hasSameReleaseReference(selected, projection.current)) {
      throw new Error(
        'Systemd selector is outside durable activation repair authority.',
      );
    }
    const unitFile = await inspectFixedUnitFile({
      fsOps,
      layout: context.layout,
      uid: context.filesystemUid,
    });
    if (unitFile.state === 'conflicting') {
      throw new Error(
        'Systemd user unit path contains unverified or different content.',
      );
    }
    const unitPaths = await readManagerUnitPaths();
    if (!unitPaths.includes(path.dirname(context.layout.unitPath))) {
      throw new Error(
        "Systemd user manager no longer searches Wharfie's fixed unit directory.",
      );
    }
    await assertNoOtherUnitClaims(context.layout, unitPaths);
    const systemd = await readSystemd(context.layout);
    if (
      systemd.loadState !== 'not-found' &&
      !hasExpectedUnitSource(systemd, context.layout)
    ) {
      throw new Error(
        'Systemd user-service unit name is claimed by different effective wiring.',
      );
    }
    return Object.freeze({
      needsRepair:
        installation?.state !== 'installed' ||
        selected === null ||
        unitFile.state !== 'managed' ||
        !hasExpectedEffectiveUnit(systemd, context.layout) ||
        systemd.unitFileState !== 'enabled',
    });
  }

  /**
   * Reproject an intentionally uninstalled ACTIVE selection without changing
   * activation record version or selection generation. The retained release
   * is the only target accepted; switching artifacts is `update`.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {{activation: ReturnType<typeof createLocalApplicationActivation>, driver: Readonly<Record<string, Function>>}} runtime - Locked activation runtime.
   * @param {Readonly<Record<string, any>>} current - Exact ACTIVE state.
   * @param {{requireInvokingRelease?: boolean}} [options] - Reprojection authority.
   * @returns {Promise<Readonly<Record<string, any>>>} - Synthetic activation result.
   */
  async function reinstallActiveSelection(
    context,
    runtime,
    current,
    options = {},
  ) {
    if (
      current.phase !== LocalApplicationActivationPhase.ACTIVE ||
      !current.selected
    ) {
      throw new Error(
        'Systemd service reinstall requires one exact ACTIVE activation selection.',
      );
    }
    if (options.requireInvokingRelease !== false) {
      const artifact = await inspectBytes(artifactPath);
      const target = Object.freeze({
        artifactId: artifact.artifactId,
        revisionId: context.pair.runtime.revisionId,
      });
      if (!hasSameReleaseReference(current.selected, target)) {
        throw new Error(
          'A different activation release is selected; use service update.',
        );
      }
    }
    const projection = Object.freeze({
      appId: context.pair.runtime.appId,
      current: current.selected,
      previous: current.rollbackCandidate,
      destination: 'target',
      action: 'install',
      transitionId: null,
    });
    const physical = await inspectPhysicalSelectionRepair(context, projection);
    let needsRepair = physical.needsRepair;
    if (!needsRepair) {
      const verified = await verifyPhysicalSelection(context, projection);
      const observed = await observeInstallation(verified.installation, {
        integrity: verified.integrity,
      });
      if (observed.health === 'stopped') {
        needsRepair = true;
      } else if (observed.health !== 'healthy') {
        const error = new Error(
          `Systemd active release is not independently healthy (${observed.health}).`,
        );
        error.name = 'SystemdUserServiceActivationHealthError';
        Object.assign(error, {
          code: 'systemd-user-service-activation-unhealthy',
          status: observed,
        });
        throw error;
      }
    }
    if (needsRepair) {
      try {
        await runtime.driver.stopService({ appId: context.pair.runtime.appId });
        await runtime.driver.proveServiceInactive({
          appId: context.pair.runtime.appId,
        });
        await runtime.driver.selectRelease(projection);
        await runtime.driver.verifySelection(projection);
        const activated = await runtime.driver.activateRelease({
          appId: context.pair.runtime.appId,
          release: current.selected,
        });
        if (activated.status !== 'healthy') {
          throw new Error(
            'Retained systemd activation release failed during reinstall.',
          );
        }
        await runtime.driver.verifyActiveRelease({
          appId: context.pair.runtime.appId,
          release: current.selected,
        });
      } catch (error) {
        throw createActiveReinstallRecoveryRequiredError(error);
      }
    }
    return Object.freeze({
      operation: 'install',
      appId: context.pair.runtime.appId,
      requestStatus: 'fulfilled',
      settledOutcome: 'target-active',
      reason: null,
      activation: current,
      quiescence: null,
    });
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
        context.pair.runtime.target,
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

  /**
   * Resolve the receipt's exact previous release from durable activation
   * state. During a forward target selection this is the transition source;
   * while the source remains selected (including restoration) it is the older
   * retained rollback candidate.
   * @param {Readonly<Record<string, any>>} activation - Activation snapshot.
   * @returns {Readonly<Record<string, any>> | null | undefined} - Expected previous reference, or undefined for an incoherent projection.
   */
  function getActivationPhysicalPrevious(activation) {
    if (activation.phase === LocalApplicationActivationPhase.ACTIVE) {
      return activation.rollbackCandidate;
    }
    if (!activation.transition || !activation.selected) return undefined;
    if (
      hasSameReleaseReference(activation.selected, activation.transition.target)
    ) {
      return activation.transition.source;
    }
    if (
      activation.transition.source &&
      hasSameReleaseReference(activation.selected, activation.transition.source)
    ) {
      return activation.rollbackCandidate;
    }
    return undefined;
  }

  /**
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, filesystemUid: number}} context - App context.
   * @param {Readonly<Record<string, any>>} installation - Installed receipt.
   * @param {boolean} requireActive - Whether only settled ACTIVE state is accepted.
   * @returns {Promise<Readonly<Record<string, any>>>} - Exact activation state.
   */
  async function requireManagedActivation(
    context,
    installation,
    requireActive,
  ) {
    const activation = await readActivationSnapshot(context);
    if (
      requireActive &&
      activation &&
      activation.phase !== LocalApplicationActivationPhase.ACTIVE
    ) {
      throw createActivationRecoveryRequiredError(
        new Error('Systemd user-service activation is in flight.'),
      );
    }
    const expectedPrevious = activation
      ? getActivationPhysicalPrevious(activation)
      : undefined;
    if (
      !activation ||
      !activation.selected ||
      expectedPrevious === undefined ||
      !hasSameReleaseReference(activation.selected, installation.current) ||
      !hasSameReleaseReference(expectedPrevious, installation.previous) ||
      (requireActive &&
        activation.phase !== LocalApplicationActivationPhase.ACTIVE)
    ) {
      throw new Error(
        'Systemd service wiring is not backed by the exact required durable activation state.',
      );
    }
    return activation;
  }

  /** @returns {Promise<Record<string, any>>} - Installation receipt. */
  async function install() {
    const context = await resolveContext();
    await assertLinger(context.uid);
    return await withLockedActivation(
      context,
      async (runtime) => {
        const current = await runtime.activation.get({
          appId: context.pair.runtime.appId,
        });
        const artifact = await inspectBytes(artifactPath);
        const target = Object.freeze({
          artifactId: artifact.artifactId,
          revisionId: context.pair.runtime.revisionId,
        });
        let result;
        if (current?.phase === LocalApplicationActivationPhase.ACTIVE) {
          if (!hasSameReleaseReference(current.selected, target)) {
            const installation = await readInstallation(
              context.layout,
              context.uid,
              context.filesystemUid,
              context.pair.runtime.target,
              { allowUninstalledTargetMismatch: true },
            );
            if (installation?.state !== 'uninstalled') {
              throw new Error(
                installation?.state === 'installed'
                  ? 'A different activation release is selected; use service update.'
                  : 'The durable activation lacks its installed source projection; invoke its exact selected SEA and run service install before service update.',
              );
            }
            await reinstallActiveSelection(context, runtime, current, {
              requireInvokingRelease: false,
            });
            result = await runtime.coordinator.update({
              appId: context.pair.runtime.appId,
              target,
            });
          } else {
            result = await reinstallActiveSelection(context, runtime, current);
          }
        } else {
          result = await runtime.coordinator.install({
            appId: context.pair.runtime.appId,
            target,
          });
        }
        return await createActivationReceipt(context, result, 'install');
      },
      { preflightFirstInstall: true },
    );
  }

  /** @returns {Promise<Record<string, any>>} - Update receipt. */
  async function update() {
    const context = await resolveContext();
    await assertLinger(context.uid);
    return await withLockedActivation(context, async (runtime) => {
      const artifact = await inspectBytes(artifactPath);
      const current = await runtime.activation.get({
        appId: context.pair.runtime.appId,
      });
      if (current?.phase === LocalApplicationActivationPhase.ACTIVE) {
        if (!current.selected) {
          throw new Error(
            'Systemd update requires one exact ACTIVE source release.',
          );
        }
        const installation = await readInstallation(
          context.layout,
          context.uid,
          context.filesystemUid,
          context.pair.runtime.target,
          { allowUninstalledTargetMismatch: true },
        );
        if (installation?.state === 'uninstalled') {
          await reinstallActiveSelection(context, runtime, current, {
            requireInvokingRelease: false,
          });
        } else {
          const projection = Object.freeze({
            appId: context.pair.runtime.appId,
            current: current.selected,
            previous: current.rollbackCandidate,
          });
          const physical = await inspectPhysicalSelectionRepair(
            context,
            projection,
          );
          if (physical.needsRepair) {
            throw new Error(
              'The durable activation lacks its exact installed source projection; invoke its exact selected SEA and run service install before service update.',
            );
          }
        }
      }
      const result = await runtime.coordinator.update({
        appId: context.pair.runtime.appId,
        target: {
          artifactId: artifact.artifactId,
          revisionId: context.pair.runtime.revisionId,
        },
      });
      return await createActivationReceipt(context, result);
    });
  }

  /** @returns {Promise<Record<string, any>>} - Rollback receipt. */
  async function rollback() {
    const context = await resolveContext();
    await assertLinger(context.uid);
    return await withLockedActivation(
      context,
      async ({ activation, coordinator }) => {
        const artifact = await inspectBytes(artifactPath);
        const invokingRelease = Object.freeze({
          artifactId: artifact.artifactId,
          revisionId: context.pair.runtime.revisionId,
        });
        const current = await activation.get({
          appId: context.pair.runtime.appId,
        });
        let result;
        if (current?.transition?.action === 'rollback') {
          if (
            !current.transition.source ||
            !hasSameReleaseReference(current.transition.source, invokingRelease)
          ) {
            throw new Error(
              'An in-flight rollback belongs to a different source release.',
            );
          }
          result = await coordinator.rollback({
            appId: context.pair.runtime.appId,
          });
        } else if (
          current?.phase === LocalApplicationActivationPhase.ACTIVE &&
          current.selected &&
          hasSameReleaseReference(current.selected, invokingRelease)
        ) {
          if (!current.rollbackCandidate) {
            throw new Error(
              'Systemd rollback has no retained prior release candidate.',
            );
          }
          result = await coordinator.rollback({
            appId: context.pair.runtime.appId,
          });
        } else {
          throw new Error(
            'Systemd rollback must be invoked by the exact currently selected release; use service recover after an ambiguous rollback response.',
          );
        }
        return await createActivationReceipt(context, result, 'rollback');
      },
    );
  }

  /** @returns {Promise<Record<string, any>>} - Recovery receipt. */
  async function recover() {
    const context = await resolveContext();
    await assertLinger(context.uid);
    return await withLockedActivation(context, async ({ coordinator }) => {
      const result = await coordinator.recover({
        appId: context.pair.runtime.appId,
      });
      return await createActivationReceipt(context, result);
    });
  }

  /** @returns {Promise<Record<string, any>>} - Current service status. */
  async function status() {
    const context = await resolveContext();
    const releaseLock = await acquireLock({
      serviceRoot: context.layout.serviceRoot,
      uid: context.uid,
    });
    try {
      const activation = await readActivationSnapshot(context);
      const installation = await readInstallation(
        context.layout,
        context.uid,
        context.filesystemUid,
        context.pair.runtime.target,
        { allowUninstalledTargetMismatch: activation === null },
      );
      const marker = await readUninstallMarker(context, installation);
      const observed =
        !installation || installation.state === 'uninstalled' || marker !== null
          ? await observeDetachedInstallation(context, installation, marker)
          : await observeInstallation(installation, {
              tolerateSystemdFailure: true,
            });
      const expectedPrevious = activation
        ? getActivationPhysicalPrevious(activation)
        : undefined;
      const hasActivationProjection =
        activation !== null &&
        activation.selected !== null &&
        expectedPrevious !== undefined;
      const inertLegacyTombstone =
        activation === null &&
        installation?.state === 'uninstalled' &&
        marker === null &&
        observed.health === 'absent';
      const activationMismatch = installation
        ? inertLegacyTombstone || hasActivationProjection
          ? !inertLegacyTombstone &&
            (!hasSameReleaseReference(
              installation.current,
              activation?.selected,
            ) ||
              !hasSameReleaseReference(installation.previous, expectedPrevious))
          : true
        : activation !== null;
      const activationUnsettled =
        activation !== null &&
        activation.phase !== LocalApplicationActivationPhase.ACTIVE;
      return {
        ...observed,
        activation: createActivationStatusView(activation),
        ...(activationMismatch
          ? {
              integrity: { status: 'invalid' },
            }
          : {}),
        ...(activationMismatch || activationUnsettled
          ? { health: 'degraded' }
          : {}),
      };
    } finally {
      await releaseLock();
    }
  }

  /** @returns {Promise<Record<string, any>>} - Start receipt. */
  async function start() {
    const context = await resolveContext();
    await assertLinger(context.uid);
    const locked = await lockInstalled(context);
    try {
      await requireManagedActivation(context, locked.installation, true);
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
      await requireManagedActivation(context, locked.installation, true);
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
      await requireManagedActivation(context, locked.installation, true);
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
      const durableActivation = await readActivationSnapshot(context);
      if (
        durableActivation &&
        durableActivation.phase !== LocalApplicationActivationPhase.ACTIVE
      ) {
        throw new Error(
          'Systemd user-service activation is in flight; run service recover before uninstalling.',
        );
      }
      const installation = await readInstallation(
        context.layout,
        context.uid,
        context.filesystemUid,
        context.pair.runtime.target,
      );
      let marker = await readUninstallMarker(context, installation);
      const selected = await readSelectedRelease({
        fsOps,
        layout: context.layout,
        inspectBytes,
        uid: context.filesystemUid,
        target: context.pair.runtime.target,
      });
      if (
        durableActivation &&
        (!durableActivation.selected ||
          (installation &&
            (!hasSameReleaseReference(
              installation.current,
              durableActivation.selected,
            ) ||
              !hasSameReleaseReference(
                installation.previous,
                durableActivation.rollbackCandidate,
              ))) ||
          (selected &&
            !hasSameReleaseReference(selected, durableActivation.selected)))
      ) {
        throw new Error(
          'Systemd user-service physical selection disagrees with durable ACTIVE activation state.',
        );
      }
      if (
        installation &&
        selected &&
        (!hasSameArtifactBytes(installation.current, selected) ||
          installation.current.revisionId !== selected.revisionId)
      ) {
        throw new Error(
          'Installed systemd user-service selection disagrees with its immutable release.',
        );
      }
      if (installation?.state === 'installed' && !marker && !selected) {
        throw new Error(
          'Installed systemd user-service current selection is missing.',
        );
      }
      if (
        marker?.release &&
        selected &&
        (marker.release.artifactId !== selected.artifactId ||
          marker.release.revisionId !== selected.revisionId)
      ) {
        throw new Error(
          'Systemd user-service uninstall marker disagrees with the selected release.',
        );
      }
      if (!installation && marker?.release && !selected) {
        throw new Error(
          'Systemd user-service uninstall marker retained a release identity but its current selection is missing.',
        );
      }
      await removeStaleUninstallMarkerTemps(context);
      if (
        !installation &&
        !selected &&
        !marker &&
        (await hasManagedServiceRoot(
          fsOps,
          context.layout,
          context.filesystemUid,
        )) &&
        (await fsOps.readdir(context.layout.serviceRoot)).length > 0
      ) {
        throw new Error(
          'Durable application state exists without a verified release identity; refusing orphan cleanup.',
        );
      }

      const expectedUnit = createSystemdUserServiceUnit({
        layout: context.layout,
      });
      let unitFile = await inspectFixedUnitFile({
        fsOps,
        layout: context.layout,
        uid: context.filesystemUid,
      });
      if (unitFile.state === 'conflicting') {
        throw new Error(
          'Systemd user unit path contains unverified or different content.',
        );
      }
      let systemd = await readSystemd(context.layout);
      const cachedWithoutLocalBytes =
        unitFile.state === 'absent' && systemd.loadState !== 'not-found';
      if (cachedWithoutLocalBytes) {
        if (!hasExpectedUnitSource(systemd, context.layout)) {
          throw new Error(
            'Systemd loaded different effective service wiring; refusing orphan cleanup.',
          );
        }
        if (!installation && !marker) {
          throw new Error(
            'Systemd has cached a unit whose local bytes cannot be verified; refusing to mutate the unit name.',
          );
        }
        await assertNoOtherUnitClaims(
          context.layout,
          await readManagerUnitPaths(),
        );
        await ensureManagedUnitDirectory(
          fsOps,
          context.layout,
          context.filesystemUid,
        );
        await writeFileAtomic({
          fsOps,
          filePath: context.layout.unitPath,
          contents: expectedUnit,
          mode: 0o600,
          token: createToken(),
          uid: context.filesystemUid,
        });
        unitFile = Object.freeze({ state: 'managed' });
        await systemctl(['daemon-reload']);
        systemd = await readSystemd(context.layout);
        if (!hasExpectedEffectiveUnit(systemd, context.layout)) {
          throw new Error(
            "Systemd did not reload Wharfie's restored unit exactly; refusing orphan cleanup.",
          );
        }
      } else {
        if (systemd.needDaemonReload) {
          await systemctl(['daemon-reload']);
          systemd = await readSystemd(context.layout);
        }
        assertNoForeignEffectiveUnit(systemd, context.layout);
      }
      const unitPaths = await readManagerUnitPaths();
      await assertNoOtherUnitClaims(context.layout, unitPaths);

      const hasDetachedWiring =
        unitFile.state !== 'absent' ||
        systemd.loadState !== 'not-found' ||
        selected !== null ||
        marker !== null;
      if (
        !hasDetachedWiring &&
        (!installation || installation.state === 'uninstalled')
      ) {
        return createUninstallReceipt(context, 'already-uninstalled');
      }

      if (unitFile.state === 'managed' && systemd.loadState === 'not-found') {
        await systemctl(['daemon-reload']);
        systemd = await readSystemd(context.layout);
        assertNoForeignEffectiveUnit(systemd, context.layout);
      }

      if (systemd.loadState === 'loaded') {
        if (!hasExpectedEffectiveUnit(systemd, context.layout)) {
          throw new Error(
            'Systemd loaded different or stale effective service wiring; refusing orphan cleanup.',
          );
        }
        await systemctl(['disable', '--now', context.layout.unitName]);
        await waitForSystemdInactive({ layout: context.layout }, stopTimeoutMs);
      } else if (systemd.loadState !== 'not-found') {
        throw new Error(
          'Systemd user-service state is not safe for orphan cleanup.',
        );
      }

      if (!marker) {
        const release = installation?.current || selected;
        marker = validateUninstallMarker(
          {
            schemaVersion: UNINSTALL_MARKER_SCHEMA_VERSION,
            kind: UNINSTALL_MARKER_KIND,
            appId: context.pair.runtime.appId,
            unitName: context.layout.unitName,
            uid: context.uid,
            layout: context.layout,
            unitDigest: createHash('sha256')
              .update(expectedUnit, 'utf8')
              .digest('base64url'),
            receiptState: installation?.state || 'missing',
            release: release
              ? {
                  artifactId: release.artifactId,
                  revisionId: release.revisionId,
                }
              : null,
          },
          {
            appId: context.pair.runtime.appId,
            unitName: context.layout.unitName,
            uid: context.uid,
            layout: context.layout,
            ...(release
              ? {
                  artifactId: release.artifactId,
                  revisionId: release.revisionId,
                }
              : {}),
          },
        );
        await ensureManagedServiceRoot(
          fsOps,
          context.layout,
          context.filesystemUid,
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

      if (unitFile.state === 'managed') {
        const reverified = await inspectFixedUnitFile({
          fsOps,
          layout: context.layout,
          uid: context.filesystemUid,
        });
        if (reverified.state !== 'managed') {
          throw new Error(
            'Systemd user unit changed before orphan cleanup could remove it.',
          );
        }
        await fsOps.unlink(context.layout.unitPath);
        await syncDirectory(fsOps, path.dirname(context.layout.unitPath));
        await systemctl(['daemon-reload']);
      }
      const finalSystemd = await readSystemd(context.layout);
      if (
        finalSystemd.loadState !== 'not-found' ||
        finalSystemd.needDaemonReload !== false
      ) {
        throw new Error(
          'Systemd exposed another or stale unit after Wharfie removed its wiring; cleanup remains incomplete.',
        );
      }

      const retainedRelease = installation?.current || selected;
      if (retainedRelease && installation?.state !== 'uninstalled') {
        const uninstalledAt = now();
        const retainedInstallation = createSystemdUserServiceInstallation({
          layout: context.layout,
          uid: context.uid,
          current: retainedRelease,
          previous: installation?.previous,
          state: 'uninstalled',
          installedAt: installation?.installedAt ?? retainedRelease.installedAt,
          updatedAt: Math.max(
            installation?.updatedAt ?? retainedRelease.installedAt,
            uninstalledAt,
          ),
        });
        await writeFileAtomic({
          fsOps,
          filePath: context.layout.installationPath,
          contents: `${JSON.stringify(retainedInstallation, null, 2)}\n`,
          mode: 0o600,
          token: createToken(),
          uid: context.filesystemUid,
        });
      }
      if (selected) {
        const reselected = await readSelectedRelease({
          fsOps,
          layout: context.layout,
          inspectBytes,
          uid: context.filesystemUid,
          target: context.pair.runtime.target,
        });
        if (
          !reselected ||
          !hasSameArtifactBytes(reselected, selected) ||
          reselected.revisionId !== selected.revisionId
        ) {
          throw new Error(
            'Systemd user-service current selection changed before cleanup.',
          );
        }
        await fsOps.unlink(context.layout.currentLink);
      }
      await syncDirectory(fsOps, context.layout.serviceRoot);
      await fsOps.unlink(context.layout.uninstallPath);
      await syncDirectory(fsOps, context.layout.serviceRoot);
      return createUninstallReceipt(
        context,
        marker.receiptState === 'installed'
          ? 'uninstalled'
          : 'orphan-reconciled',
      );
    } finally {
      await releaseLock();
    }
  }

  return Object.freeze({
    install,
    update,
    rollback,
    recover,
    start,
    stop,
    restart,
    status,
    uninstall,
  });
}

export default createSystemdUserServiceOperator;

export {
  acquireOperationLock as acquireSystemdUserServiceOperationLock,
  readReleaseByReference as readSystemdUserServiceReleaseByReference,
  readRuntimeState as readSystemdUserServiceRuntimeState,
};
