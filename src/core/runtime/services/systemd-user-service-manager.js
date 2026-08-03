import { execFile as nodeExecFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
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
  LocalApplicationActivationAction,
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
import {
  LinuxAbstractOperationLockBusyError,
  acquireLinuxAbstractOperationLock,
} from '../linux-abstract-operation-lock.js';
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
import {
  SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES,
  SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES,
  createSystemdUserServiceReleasePruneReceipt,
  createSystemdUserServiceReleasePruneTombstoneName,
  parseSystemdUserServiceReleasePruneTombstoneName,
} from './systemd-user-service-release-prune.js';
import { createLocalApplicationSystemdActivation } from './local-application-systemd-activation.js';
import { inspectLocalApplicationQuiescence } from './local-application-quiescence.js';

const SERVICE_RESULT_SCHEMA_VERSION = 1;
const SERVICE_STATUS_SCHEMA_VERSION = 3;
const SERVICE_RESULT_KIND = 'wharfie.service.result';
const SERVICE_STATUS_KIND = 'wharfie.service.status';
const DESIRED_CONVERGENCE_SCHEMA_VERSION = 1;
const DESIRED_CONVERGENCE_KIND = 'wharfie.service.desired-convergence';
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
const CONVERGE_RECOVERY_REMEDIATION =
  'Retry service converge from this exact desired SEA.';
const CONVERGE_ROLLBACK_RECOVERY_REMEDIATION =
  'Run service recover before retrying desired-target convergence.';
const ACTIVE_REINSTALL_RECOVERY_REMEDIATION =
  'Run service install again from the exact selected SEA to resume repair.';
const PRUNE_RECOVERY_REMEDIATION =
  'Run service recover before retrying service prune.';
const PRUNE_RETRY_REMEDIATION =
  'Retry service prune from the exact selected SEA.';
const PRUNE_UNINSTALL_REMEDIATION =
  'Rerun service uninstall before retrying service prune.';
const PRUNE_MISSING_ACTIVATION_REMEDIATION =
  'Run service install or service converge from the exact selected SEA before retrying service prune.';
const PURGE_CONFIRMATION_REMEDIATION =
  'Repeat the embedded application ID with --confirm-data-loss.';
const PURGE_UNINSTALL_REMEDIATION =
  'Run service uninstall before retrying service purge.';
const PURGE_QUIESCENCE_REMEDIATION =
  'Finish or cancel nonterminal durable work before retrying service purge.';
const PURGE_RETRY_REMEDIATION =
  'Retry service purge with the same --confirm-data-loss application ID.';
const SERVICE_PURGE_TOMBSTONE_PREFIX = '.wharfie-service-purge-v1.';
const SERVICE_PURGE_MARKER_NAME = '.purging.json';
const SERVICE_PURGE_MARKER_KIND = 'wharfie.systemd-user-service.purge-marker';
const SERVICE_PURGE_MARKER_SCHEMA_VERSION = 1;
const SERVICE_PURGE_TOP_LEVEL_ENTRIES = new Set([
  'installation.json',
  'releases',
  'state',
]);
const SERVICE_PURGE_REMOVAL_BATCH_SIZE = 64;
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
const TRANSIENT_OBSERVATION_ERROR_CODES = new Set([
  'EAGAIN',
  'EBUSY',
  'EINTR',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ENOMEM',
  'ETIMEDOUT',
]);
const RELEASE_PRUNE_ERRORS = new WeakSet();
const SERVICE_PURGE_ERRORS = new WeakSet();

/**
 * @param {string} code - Stable local prune failure code.
 * @param {string} message - Secret-free failure text.
 * @param {unknown} [cause] - Internal cause.
 * @param {string} [remediation] - Exact static retry guidance.
 * @returns {Error} - Tagged operation error.
 */
function createReleasePruneError(code, message, cause, remediation) {
  const error = new Error(message, cause === undefined ? {} : { cause });
  error.name = 'SystemdUserServiceReleasePruneError';
  Object.assign(error, {
    code,
    ...(remediation ? { remediation } : {}),
  });
  RELEASE_PRUNE_ERRORS.add(error);
  return error;
}

/**
 * @param {unknown} error - Candidate already-sanitized prune failure.
 * @returns {boolean} - Whether the failure was created by this module.
 */
function isReleasePruneError(error) {
  return error instanceof Error && RELEASE_PRUNE_ERRORS.has(error);
}

/**
 * @param {string} code - Stable local purge failure code.
 * @param {string} message - Secret-free failure text.
 * @param {unknown} [cause] - Internal cause.
 * @param {string} [remediation] - Exact static retry guidance.
 * @returns {Error} - Tagged operation error.
 */
function createServicePurgeError(code, message, cause, remediation) {
  const error = new Error(message, cause === undefined ? {} : { cause });
  error.name = 'SystemdUserServicePurgeError';
  Object.assign(error, {
    code,
    ...(remediation ? { remediation } : {}),
  });
  SERVICE_PURGE_ERRORS.add(error);
  return error;
}

/**
 * @param {unknown} error - Candidate already-sanitized purge failure.
 * @returns {boolean} - Whether the failure was created by this module.
 */
function isServicePurgeError(error) {
  return error instanceof Error && SERVICE_PURGE_ERRORS.has(error);
}

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
 * Separate retryable observation loss from stable local-state contradictions.
 * Process-adapter failures are always observations, while a small errno set
 * covers resource pressure and interrupted filesystem reads.
 * @param {unknown} error - Observation failure.
 * @returns {boolean} - Whether status must report unknown rather than conflict.
 */
function isTransientObservationError(error) {
  return (
    (error instanceof Error &&
      error.name === 'SystemdUserServiceProcessError') ||
    (error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      TRANSIENT_OBSERVATION_ERROR_CODES.has(String(error.code)))
  );
}

/**
 * Preserve the original failure while marking only errors that left a durable
 * activation transition in flight as recoverable operator work.
 * @param {unknown} error - Transition failure.
 * @param {string} [remediation] - Exact safe replay guidance.
 * @returns {Error} - Recovery-tagged failure.
 */
function createActivationRecoveryRequiredError(
  error,
  remediation = ACTIVATION_RECOVERY_REMEDIATION,
) {
  if (
    error instanceof Error &&
    hasCode(error, 'systemd-user-service-activation-recovery-required') &&
    'remediation' in error &&
    error.remediation === remediation
  ) {
    return error;
  }
  const failure = new Error(
    error instanceof Error
      ? error.message
      : 'Systemd user-service activation was interrupted.',
  );
  failure.name = 'SystemdUserServiceActivationRecoveryRequiredError';
  Object.assign(failure, {
    code: 'systemd-user-service-activation-recovery-required',
    remediation,
    cause: error,
  });
  return failure;
}

/**
 * Mark only failures after an authorized ACTIVE repair begins. Durable
 * activation remains ACTIVE, so replay is either selected-release
 * `service install` or exact-desired `service converge`, never activation
 * `recover`.
 * @param {unknown} error - Interrupted physical repair.
 * @param {string} [remediation] - Exact safe replay guidance.
 * @returns {Error} - Actionable replay error.
 */
function createActiveReinstallRecoveryRequiredError(
  error,
  remediation = ACTIVE_REINSTALL_RECOVERY_REMEDIATION,
) {
  if (
    error instanceof Error &&
    hasCode(error, 'systemd-user-service-active-reinstall-recovery-required') &&
    'remediation' in error &&
    error.remediation === remediation
  ) {
    return error;
  }
  const causeMessage =
    error instanceof Error
      ? error.message
      : 'Systemd user-service ACTIVE repair was interrupted.';
  const failure = new Error(causeMessage);
  failure.name = 'SystemdUserServiceActiveReinstallRecoveryRequiredError';
  Object.assign(failure, {
    code: 'systemd-user-service-active-reinstall-recovery-required',
    remediation,
    cause: error,
  });
  return failure;
}

/**
 * Refuse desired-target convergence across an in-flight rollback. Only the
 * direction-neutral recovery command may settle that ambiguity.
 * @returns {Error} - Stable rollback-recovery boundary.
 */
function createConvergeRollbackRecoveryRequiredError() {
  const failure = new Error(
    'Desired-target convergence cannot resolve an in-flight rollback.',
  );
  failure.name = 'SystemdUserServiceConvergeRollbackRecoveryRequiredError';
  Object.assign(failure, {
    code: 'systemd-user-service-converge-rollback-recovery-required',
    remediation: CONVERGE_ROLLBACK_RECOVERY_REMEDIATION,
  });
  return failure;
}

/**
 * Mark a lost post-settlement proof of the exact desired resident. The
 * durable transition is already ACTIVE, so replay is the same convergence
 * request rather than transition-only recovery.
 * @param {unknown} error - Exact proof failure.
 * @returns {Error} - Stable desired-proof error.
 */
function createConvergeProofRequiredError(error) {
  if (
    error instanceof Error &&
    hasCode(error, 'systemd-user-service-converge-proof-required') &&
    'remediation' in error &&
    error.remediation === CONVERGE_RECOVERY_REMEDIATION
  ) {
    return error;
  }
  const failure = new Error(
    error instanceof Error
      ? error.message
      : 'Desired-target convergence lost its exact resident proof.',
  );
  failure.name = 'SystemdUserServiceConvergeProofRequiredError';
  Object.assign(failure, {
    code: 'systemd-user-service-converge-proof-required',
    remediation: CONVERGE_RECOVERY_REMEDIATION,
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
 * Read at most one fixed number of directory entries without materializing an
 * unbounded namespace in memory.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} directory - Exact directory to enumerate.
 * @param {number} maximum - Inclusive entry limit.
 * @param {string} label - Safe boundary label.
 * @returns {Promise<string[]>} - Canonically sorted basenames.
 */
async function readBoundedDirectoryNames(fsOps, directory, maximum, label) {
  const opened = await fsOps.opendir(directory);
  /** @type {string[]} */
  const names = [];
  try {
    while (true) {
      const entry = await opened.read();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > maximum) {
        throw new Error(`${label} exceeds its entry limit.`);
      }
    }
  } finally {
    await opened.close().catch((error) => {
      if (!hasCode(error, 'ERR_DIR_CLOSED')) throw error;
    });
  }
  return names.sort();
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
 * Derive the one reserved retry tombstone beside the app root. The logical app
 * ID has already passed the layout's strict validator.
 * @param {Readonly<Record<string, string>>} layout - Fixed service layout.
 * @returns {string} - Canonical direct-child tombstone path.
 */
function createServicePurgeTombstonePath(layout) {
  return path.join(
    path.dirname(layout.serviceRoot),
    `${SERVICE_PURGE_TOMBSTONE_PREFIX}${layout.appId}`,
  );
}

/**
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} targetPath - Exact path to inspect.
 * @returns {Promise<import('node:fs').Stats | null>} - lstat result or absence.
 */
async function lstatIfPresent(fsOps, targetPath) {
  try {
    return await fsOps.lstat(targetPath);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
}

/**
 * Inspect only the derived app root and its reserved purge tombstone. When
 * either exists, every ancestor is required to remain a private, owned real
 * directory before rename or recursive removal is possible.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {Readonly<Record<string, string>>} layout - Fixed service layout.
 * @param {number} uid - Required filesystem owner.
 * @returns {Promise<Readonly<{applicationRoot: import('node:fs').Stats | null, tombstonePath: string, tombstone: import('node:fs').Stats | null}>>} - Exact purge namespace state.
 */
async function inspectServicePurgeRoots(fsOps, layout, uid) {
  const tombstonePath = createServicePurgeTombstonePath(layout);
  const [applicationRoot, tombstone] = await Promise.all([
    lstatIfPresent(fsOps, layout.serviceRoot),
    lstatIfPresent(fsOps, tombstonePath),
  ]);
  if (applicationRoot !== null && tombstone !== null) {
    throw createServicePurgeError(
      'systemd-user-service-purge-state-conflict',
      'Systemd user-service purge found both the application root and its retry tombstone.',
      undefined,
      PURGE_RETRY_REMEDIATION,
    );
  }
  if (applicationRoot !== null || tombstone !== null) {
    const applicationsRoot = path.dirname(layout.serviceRoot);
    await assertRealPath(
      fsOps,
      layout.dataRoot,
      'directory',
      'Wharfie data root',
      uid,
    );
    await assertRealPath(
      fsOps,
      applicationsRoot,
      'directory',
      'Wharfie applications root',
      uid,
    );
    if (applicationRoot !== null) {
      assertManagedStats(
        applicationRoot,
        'directory',
        'Systemd user-service root',
        uid,
      );
    }
    if (tombstone !== null) {
      assertManagedStats(
        tombstone,
        'directory',
        'Systemd user-service purge tombstone',
        uid,
      );
    }
  }
  return Object.freeze({
    applicationRoot,
    tombstonePath,
    tombstone,
  });
}

/**
 * Create the exact marker that authenticates an interrupted app-root purge.
 * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number}} context - Fixed application context.
 * @returns {Readonly<Record<string, any>>} - Persistable purge marker.
 */
function createServicePurgeMarker(context) {
  return Object.freeze({
    schemaVersion: SERVICE_PURGE_MARKER_SCHEMA_VERSION,
    kind: SERVICE_PURGE_MARKER_KIND,
    appId: context.pair.runtime.appId,
    unitName: context.layout.unitName,
    uid: context.uid,
    serviceRoot: context.layout.serviceRoot,
    tombstonePath: createServicePurgeTombstonePath(context.layout),
  });
}

/**
 * Require one exact derived purge marker before an interrupted tombstone may
 * be removed.
 * @param {unknown} value - Candidate marker.
 * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number}} context - Fixed application context.
 * @returns {Readonly<Record<string, any>>} - Validated marker.
 */
function validateServicePurgeMarker(value, context) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Systemd user-service purge marker is malformed.');
  }
  const marker = /** @type {Record<string, any>} */ (value);
  const expected = createServicePurgeMarker(context);
  const expectedKeys = Object.keys(expected);
  if (
    Object.keys(marker).length !== expectedKeys.length ||
    expectedKeys.some(
      (key) =>
        !Object.prototype.hasOwnProperty.call(marker, key) ||
        marker[key] !== expected[key],
    )
  ) {
    throw new Error(
      'Systemd user-service purge marker disagrees with the application.',
    );
  }
  return expected;
}

/**
 * @param {{fsOps: typeof fsp, root: string, context: {pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number}, filesystemUid: number}} options - Marker location and authority.
 * @returns {Promise<Readonly<Record<string, any>> | null>} - Exact marker or absence.
 */
async function readServicePurgeMarker(options) {
  try {
    const raw = await readManagedTextFile({
      fsOps: options.fsOps,
      filePath: path.join(options.root, SERVICE_PURGE_MARKER_NAME),
      label: 'Systemd user-service purge marker',
      uid: options.filesystemUid,
    });
    return validateServicePurgeMarker(JSON.parse(raw), options.context);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
}

/**
 * Require the app/tombstone root to contain only the three canonical managed
 * areas plus the authenticated marker.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} root - App root or isolated tombstone.
 * @returns {Promise<string[]>} - Sorted top-level names.
 */
async function inspectServicePurgeTopLevel(fsOps, root) {
  const names = await readBoundedDirectoryNames(
    fsOps,
    root,
    SERVICE_PURGE_TOP_LEVEL_ENTRIES.size + 1,
    'Systemd user-service purge root',
  );
  if (
    names.some(
      (name) =>
        name !== SERVICE_PURGE_MARKER_NAME &&
        !SERVICE_PURGE_TOP_LEVEL_ENTRIES.has(name),
    )
  ) {
    throw new Error(
      'Systemd user-service purge root contains an unsupported entry.',
    );
  }
  return names;
}

/**
 * Remove private atomic-publication residue for the purge marker. The
 * operation lock makes every matching temporary stale.
 * @param {{fsOps: typeof fsp, root: string, uid: number}} options - Managed app root.
 * @returns {Promise<void>} - Resolves after matching residue is absent.
 */
async function removeStaleServicePurgeMarkerTemps(options) {
  const prefix = `.${SERVICE_PURGE_MARKER_NAME}.`;
  const suffix = '.tmp';
  let removed = false;
  for (const entry of await options.fsOps.readdir(options.root)) {
    if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) continue;
    const token = entry.slice(prefix.length, -suffix.length);
    if (!ATOMIC_PUBLICATION_TOKEN_PATTERN.test(token)) continue;
    const temporary = path.join(options.root, entry);
    await assertRealPath(
      options.fsOps,
      temporary,
      'file',
      'Stale systemd user-service purge-marker publication',
      options.uid,
    );
    await options.fsOps.unlink(temporary);
    removed = true;
  }
  if (removed) await syncDirectory(options.fsOps, options.root);
}

/**
 * Recursively remove one already-isolated, owned tree entry without following
 * symbolic links. Every concrete descendant must remain on the tombstone
 * filesystem and owned by the service account.
 * @param {{fsOps: typeof fsp, entryPath: string, rootDevice: number, uid: number}} options - Isolated tree entry.
 * @returns {Promise<void>} - Resolves after the entry is durably absent.
 */
async function removeOwnedPurgeTreeEntry(options) {
  const stats = await options.fsOps.lstat(options.entryPath);
  if (typeof stats.uid === 'number' && stats.uid !== options.uid) {
    throw new Error(
      'Systemd user-service purge found content owned by another user.',
    );
  }
  if (typeof stats.dev === 'number' && stats.dev !== options.rootDevice) {
    throw new Error(
      'Systemd user-service purge refuses a cross-filesystem entry.',
    );
  }
  if (stats.isSymbolicLink()) {
    await options.fsOps.unlink(options.entryPath);
    await syncDirectory(options.fsOps, path.dirname(options.entryPath));
    return;
  }
  if (stats.isFile()) {
    assertManagedStats(
      stats,
      'file',
      'Systemd user-service purge file',
      options.uid,
    );
    await options.fsOps.unlink(options.entryPath);
    await syncDirectory(options.fsOps, path.dirname(options.entryPath));
    return;
  }
  if (!stats.isDirectory()) {
    throw new Error(
      'Systemd user-service purge found an unsupported filesystem entry.',
    );
  }
  assertManagedStats(
    stats,
    'directory',
    'Systemd user-service purge directory',
    options.uid,
  );
  while (true) {
    const opened = await options.fsOps.opendir(options.entryPath);
    /** @type {string[]} */
    const names = [];
    try {
      while (names.length < SERVICE_PURGE_REMOVAL_BATCH_SIZE) {
        const entry = await opened.read();
        if (entry === null) break;
        names.push(entry.name);
      }
    } finally {
      await opened.close().catch((error) => {
        if (!hasCode(error, 'ERR_DIR_CLOSED')) throw error;
      });
    }
    if (names.length === 0) break;
    for (const name of names) {
      await removeOwnedPurgeTreeEntry({
        ...options,
        entryPath: path.join(options.entryPath, name),
      });
    }
  }
  await syncDirectory(options.fsOps, options.entryPath);
  await options.fsOps.rmdir(options.entryPath);
  await syncDirectory(options.fsOps, path.dirname(options.entryPath));
}

/**
 * Finish removal of one authenticated isolated app root. The marker remains
 * until every other known top-level entry is absent, making retry authority
 * independent of partially deleted application state.
 * @param {{fsOps: typeof fsp, tombstonePath: string, context: {pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number}, filesystemUid: number, rootDevice: number}} options - Authenticated tombstone.
 * @returns {Promise<void>} - Resolves after the exact app tombstone is absent.
 */
async function removeServicePurgeTombstone(options) {
  const marker = await readServicePurgeMarker({
    fsOps: options.fsOps,
    root: options.tombstonePath,
    context: options.context,
    filesystemUid: options.filesystemUid,
  });
  if (!marker) {
    throw new Error(
      'Systemd user-service purge tombstone lacks its authenticated marker.',
    );
  }
  const names = await inspectServicePurgeTopLevel(
    options.fsOps,
    options.tombstonePath,
  );
  for (const name of names) {
    if (name === SERVICE_PURGE_MARKER_NAME) continue;
    await removeOwnedPurgeTreeEntry({
      fsOps: options.fsOps,
      entryPath: path.join(options.tombstonePath, name),
      rootDevice: options.rootDevice,
      uid: options.filesystemUid,
    });
  }
  const finalNames = await inspectServicePurgeTopLevel(
    options.fsOps,
    options.tombstonePath,
  );
  if (finalNames.length !== 1 || finalNames[0] !== SERVICE_PURGE_MARKER_NAME) {
    throw new Error(
      'Systemd user-service purge tombstone did not converge to its marker.',
    );
  }
  await readServicePurgeMarker({
    fsOps: options.fsOps,
    root: options.tombstonePath,
    context: options.context,
    filesystemUid: options.filesystemUid,
  });
  await options.fsOps.unlink(
    path.join(options.tombstonePath, SERVICE_PURGE_MARKER_NAME),
  );
  await syncDirectory(options.fsOps, options.tombstonePath);
  await options.fsOps.rmdir(options.tombstonePath);
  await syncDirectory(
    options.fsOps,
    path.dirname(options.context.layout.serviceRoot),
  );
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
 * @param {string} releasesRoot - Exact release namespace root.
 * @param {string} releaseDirectory - Candidate direct child.
 * @returns {void} - Returns only for one canonical direct child path.
 */
function assertReleaseDirectoryPath(releasesRoot, releaseDirectory) {
  if (
    !path.isAbsolute(releaseDirectory) ||
    path.normalize(releaseDirectory) !== releaseDirectory ||
    path.dirname(releaseDirectory) !== releasesRoot ||
    path.basename(releaseDirectory) === '.' ||
    path.basename(releaseDirectory) === '..'
  ) {
    throw new Error(
      'Systemd user-service release directory is outside its fixed namespace.',
    );
  }
}

/**
 * Require the complete immutable two-file release shape before reading or
 * deleting it.
 * @param {{fsOps: typeof fsp, releaseDirectory: string, uid: number}} options - Exact directory boundary.
 * @returns {Promise<void>} - Resolves only for `app` plus `release.json`.
 */
async function assertExactImmutableReleaseContents(options) {
  const names = await readBoundedDirectoryNames(
    options.fsOps,
    options.releaseDirectory,
    2,
    'Systemd user-service release directory',
  );
  if (names.length !== 2 || names[0] !== 'app' || names[1] !== 'release.json') {
    throw new Error(
      'Systemd user-service release directory must contain exactly app and release.json.',
    );
  }
  for (const name of names) {
    const stats = await assertRealPath(
      options.fsOps,
      path.join(options.releaseDirectory, name),
      'file',
      `Systemd user-service release ${name}`,
      options.uid,
    );
    if (typeof stats.nlink === 'number' && stats.nlink !== 1) {
      throw new Error(
        `Systemd user-service release ${name} must have one filesystem link.`,
      );
    }
  }
}

/**
 * Read and validate one immutable release receipt from a canonical directory
 * or an authenticated same-root prune tombstone.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, uid: number, target?: unknown, artifactId: string, revisionId?: string, releaseDirectory?: string, maximumArtifactBytes?: number}} options - Receipt boundary.
 * @returns {Promise<Readonly<Record<string, any>>>} - Validated release record.
 */
async function readImmutableReleaseRecord(options) {
  assertArtifactId(options.artifactId, 'systemd release artifactId');
  if (options.revisionId !== undefined) {
    assertApplicationRevisionId(
      options.revisionId,
      'systemd release revisionId',
    );
  }
  const canonicalReleaseDirectory = path.join(
    options.layout.releasesRoot,
    options.artifactId,
  );
  const releaseDirectory =
    options.releaseDirectory || canonicalReleaseDirectory;
  assertReleaseDirectoryPath(options.layout.releasesRoot, releaseDirectory);
  const releasePath = path.join(releaseDirectory, 'release.json');
  const canonicalArtifactPath = path.join(canonicalReleaseDirectory, 'app');
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
  const releaseStats = await assertRealPath(
    options.fsOps,
    releasePath,
    'file',
    'Systemd user-service release receipt',
    options.uid,
  );
  if (typeof releaseStats.nlink === 'number' && releaseStats.nlink !== 1) {
    throw new Error(
      'Systemd user-service release receipt must have one filesystem link.',
    );
  }
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
    release.artifactPath !== canonicalArtifactPath ||
    (options.target !== undefined &&
      getBuildTargetId(release.target) !== getBuildTargetId(options.target))
  ) {
    throw new Error(
      'Systemd user-service immutable release disagrees with its reference.',
    );
  }
  const maximumArtifactBytes =
    options.maximumArtifactBytes ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(maximumArtifactBytes) ||
    maximumArtifactBytes < 0 ||
    release.size > maximumArtifactBytes
  ) {
    throw new Error(
      'Systemd user-service immutable release exceeds the artifact-byte limit.',
    );
  }
  return release;
}

/**
 * Read and verify one immutable release directory by content identity. The
 * optional revision fence lets the selected-link reader discover its own
 * revision while activation recovery requires an exact stored reference. A
 * physical directory override is accepted only for an authenticated
 * same-root prune tombstone; the receipt must still name its canonical path.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, inspectBytes: typeof inspectArtifactBytes, uid: number, target?: unknown, artifactId: string, revisionId?: string, releaseDirectory?: string, maximumArtifactBytes?: number}} options - Immutable release boundary.
 * @returns {Promise<Readonly<Record<string, any>>>} - Verified release.
 */
async function readImmutableRelease(options) {
  const releaseDirectory =
    options.releaseDirectory ||
    path.join(options.layout.releasesRoot, options.artifactId);
  const releaseArtifactPath = path.join(releaseDirectory, 'app');
  const release = await readImmutableReleaseRecord(options);
  await assertExactImmutableReleaseContents({
    fsOps: options.fsOps,
    releaseDirectory,
    uid: options.uid,
  });
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
 * @param {string} name - Candidate canonical release-directory basename.
 * @returns {string | null} - Exact artifact ID or null.
 */
function parseReleaseDirectoryArtifactId(name) {
  try {
    assertArtifactId(name, 'systemd release directory artifactId');
    return name;
  } catch {
    return null;
  }
}

/**
 * Parse only Wharfie's private unpublished release-stage namespace.
 * @param {string} name - Candidate direct-child basename.
 * @returns {Readonly<{artifactId: string, token: string}> | null} - Exact identity or null.
 */
function parseReleaseStageTemporaryName(name) {
  if (typeof name !== 'string') return null;
  const parts = name.split('.');
  if (
    parts.length !== 4 ||
    parts[0] !== '' ||
    parts[3] !== 'tmp' ||
    !ATOMIC_PUBLICATION_TOKEN_PATTERN.test(parts[2])
  ) {
    return null;
  }
  try {
    assertArtifactId(parts[1], 'systemd user-service release-stage artifactId');
  } catch {
    return null;
  }
  return Object.freeze({ artifactId: parts[1], token: parts[2] });
}

/**
 * Authenticate one unpublished stage directory left by interrupted
 * publication. Publication creates app before release.json. Recovery removes
 * release.json before app, so complete, app-only, and empty are the only
 * reachable states; receipt-only state fails closed.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, uid: number, name: string}} options - Stage-temp boundary.
 * @returns {Promise<Readonly<Record<string, any>>>} - Authenticated temp state.
 */
async function inspectReleaseStageTemporary(options) {
  const identity = parseReleaseStageTemporaryName(options.name);
  if (!identity) {
    throw new Error(
      'Systemd user-service release-stage temporary name is malformed.',
    );
  }
  const directory = path.join(options.layout.releasesRoot, options.name);
  assertReleaseDirectoryPath(options.layout.releasesRoot, directory);
  const directoryStats = await assertRealPath(
    options.fsOps,
    directory,
    'directory',
    'Systemd user-service release-stage temporary directory',
    options.uid,
  );
  if ((directoryStats.mode & 0o077) !== 0) {
    throw new Error(
      'Systemd user-service release-stage temporary directory must be private.',
    );
  }
  const names = await readBoundedDirectoryNames(
    options.fsOps,
    directory,
    2,
    'Systemd user-service release-stage temporary directory',
  );
  const hasArtifact = names.includes('app');
  const hasReceipt = names.includes('release.json');
  if (
    names.some((name) => name !== 'app' && name !== 'release.json') ||
    (hasReceipt && !hasArtifact)
  ) {
    throw new Error(
      'Systemd user-service release-stage temporary directory has an unsupported partial state.',
    );
  }
  for (const name of names) {
    const stats = await options.fsOps.lstat(path.join(directory, name));
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      (typeof stats.uid === 'number' && stats.uid !== options.uid)
    ) {
      throw new Error(
        `Systemd user-service release-stage ${name} must be an owned real file.`,
      );
    }
    if (typeof stats.nlink === 'number' && stats.nlink !== 1) {
      throw new Error(
        `Systemd user-service release-stage ${name} must have one filesystem link.`,
      );
    }
  }
  return Object.freeze({
    ...identity,
    directory,
    hasArtifact,
    hasReceipt,
  });
}

/**
 * Validate one complete or partially removed deterministic prune tombstone.
 * The deletion order is fixed as app, release.json, then the empty directory,
 * so `release.json` alone and an empty directory are the only recoverable
 * partial states.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, inspectBytes: typeof inspectArtifactBytes, uid: number, target?: unknown, name: string, maximumArtifactBytes: number}} options - Tombstone boundary.
 * @returns {Promise<Readonly<Record<string, any>>>} - Authenticated tombstone state.
 */
async function inspectReleasePruneTombstone(options) {
  const identity = parseSystemdUserServiceReleasePruneTombstoneName(
    options.name,
  );
  if (!identity || identity.artifactBytes > options.maximumArtifactBytes) {
    throw new Error(
      'Systemd user-service release-prune tombstone is malformed or exceeds the artifact-byte limit.',
    );
  }
  const directory = path.join(options.layout.releasesRoot, options.name);
  assertReleaseDirectoryPath(options.layout.releasesRoot, directory);
  await assertRealPath(
    options.fsOps,
    directory,
    'directory',
    'Systemd user-service release-prune tombstone',
    options.uid,
  );
  const names = await readBoundedDirectoryNames(
    options.fsOps,
    directory,
    2,
    'Systemd user-service release-prune tombstone',
  );
  const hasArtifact = names.includes('app');
  const hasReceipt = names.includes('release.json');
  if (
    names.some((name) => name !== 'app' && name !== 'release.json') ||
    (hasArtifact && !hasReceipt)
  ) {
    throw new Error(
      'Systemd user-service release-prune tombstone has an unsupported partial state.',
    );
  }
  let release = null;
  if (hasReceipt) {
    release = await readImmutableReleaseRecord({
      fsOps: options.fsOps,
      layout: options.layout,
      uid: options.uid,
      target: options.target,
      artifactId: identity.artifactId,
      revisionId: identity.revisionId,
      releaseDirectory: directory,
      maximumArtifactBytes: options.maximumArtifactBytes,
    });
    if (release.size !== identity.artifactBytes) {
      throw new Error(
        'Systemd user-service release-prune tombstone disagrees with its encoded artifact size.',
      );
    }
  }
  if (hasArtifact) {
    release = await readImmutableRelease({
      fsOps: options.fsOps,
      layout: options.layout,
      inspectBytes: options.inspectBytes,
      uid: options.uid,
      target: options.target,
      artifactId: identity.artifactId,
      revisionId: identity.revisionId,
      releaseDirectory: directory,
      maximumArtifactBytes: options.maximumArtifactBytes,
    });
  }
  return Object.freeze({
    ...identity,
    directory,
    hasArtifact,
    hasReceipt,
    release,
  });
}

/**
 * Preflight the complete bounded release namespace before any deletion.
 * Unknown entries and every malformed canonical or recovery directory abort
 * the whole operation.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, inspectBytes: typeof inspectArtifactBytes, uid: number}} options - Namespace boundary.
 * @returns {Promise<Readonly<{releases: Readonly<Array<Readonly<Record<string, any>>>>, tombstones: Readonly<Array<Readonly<Record<string, any>>>>, stagingTemps: Readonly<Array<Readonly<Record<string, any>>>>, artifactBytes: number}>>} - Verified census.
 */
async function inspectReleasePruneNamespace(options) {
  await assertRealPath(
    options.fsOps,
    options.layout.releasesRoot,
    'directory',
    'Systemd user-service releases root',
    options.uid,
  );
  const names = await readBoundedDirectoryNames(
    options.fsOps,
    options.layout.releasesRoot,
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES,
    'Systemd user-service releases root',
  );
  /** @type {Readonly<Record<string, any>>[]} */
  const releases = [];
  /** @type {Readonly<Record<string, any>>[]} */
  const tombstones = [];
  /** @type {Readonly<Record<string, any>>[]} */
  const stagingTemps = [];
  const claimedArtifactIds = new Set();
  let artifactBytes = 0;
  for (const name of names) {
    const remaining =
      SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES - artifactBytes;
    const stageTemporary = parseReleaseStageTemporaryName(name);
    if (stageTemporary) {
      stagingTemps.push(
        await inspectReleaseStageTemporary({
          fsOps: options.fsOps,
          layout: options.layout,
          uid: options.uid,
          name,
        }),
      );
      continue;
    }
    const tombstone = parseSystemdUserServiceReleasePruneTombstoneName(name);
    if (tombstone) {
      if (claimedArtifactIds.has(tombstone.artifactId)) {
        throw new Error(
          'Systemd user-service release namespace contains a duplicate artifact ID.',
        );
      }
      const inspected = await inspectReleasePruneTombstone({
        ...options,
        name,
        maximumArtifactBytes: remaining,
      });
      artifactBytes += inspected.artifactBytes;
      tombstones.push(inspected);
      claimedArtifactIds.add(inspected.artifactId);
      continue;
    }
    const artifactId = parseReleaseDirectoryArtifactId(name);
    if (!artifactId) {
      throw new Error(
        'Systemd user-service releases root contains an unrecognized entry.',
      );
    }
    if (claimedArtifactIds.has(artifactId)) {
      throw new Error(
        'Systemd user-service release namespace contains a duplicate artifact ID.',
      );
    }
    const release = await readImmutableRelease({
      ...options,
      artifactId,
      maximumArtifactBytes: remaining,
    });
    artifactBytes += release.size;
    releases.push(release);
    claimedArtifactIds.add(release.artifactId);
  }
  return Object.freeze({
    releases: Object.freeze(releases),
    tombstones: Object.freeze(tombstones),
    stagingTemps: Object.freeze(stagingTemps),
    artifactBytes,
  });
}

/**
 * Remove one authenticated unpublished stage directory in the sole
 * crash-recoverable order: receipt -> app -> directory.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, uid: number, name: string}} options - Exact stage-temp boundary.
 * @returns {Promise<void>} - Resolves after namespace removal is durable.
 */
async function removeReleaseStageTemporary(options) {
  const inspected = await inspectReleaseStageTemporary(options);
  if (inspected.hasReceipt) {
    await options.fsOps.unlink(path.join(inspected.directory, 'release.json'));
    await syncDirectory(options.fsOps, inspected.directory);
  }
  if (inspected.hasArtifact) {
    await options.fsOps.unlink(path.join(inspected.directory, 'app'));
    await syncDirectory(options.fsOps, inspected.directory);
  }
  await options.fsOps.rmdir(inspected.directory);
  await syncDirectory(options.fsOps, options.layout.releasesRoot);
}

/**
 * Finish one already authenticated tombstone using the sole supported
 * app -> receipt -> directory deletion order.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, inspectBytes: typeof inspectArtifactBytes, uid: number, target?: unknown, name: string}} options - Exact tombstone boundary.
 * @returns {Promise<void>} - Resolves after the namespace removal is durable.
 */
async function removeReleasePruneTombstone(options) {
  const inspected = await inspectReleasePruneTombstone({
    ...options,
    maximumArtifactBytes: SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES,
  });
  if (inspected.hasArtifact) {
    await options.fsOps.unlink(path.join(inspected.directory, 'app'));
    await syncDirectory(options.fsOps, inspected.directory);
  }
  if (inspected.hasReceipt) {
    await options.fsOps.unlink(path.join(inspected.directory, 'release.json'));
    await syncDirectory(options.fsOps, inspected.directory);
  }
  await options.fsOps.rmdir(inspected.directory);
  await syncDirectory(options.fsOps, options.layout.releasesRoot);
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
  if (
    typeof options.token !== 'string' ||
    !ATOMIC_PUBLICATION_TOKEN_PATTERN.test(options.token)
  ) {
    throw new Error(
      'Systemd user-service release-stage publication token is invalid.',
    );
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

  const namespace = await inspectReleasePruneNamespace({
    fsOps: options.fsOps,
    layout: options.layout,
    inspectBytes: options.inspectBytes,
    uid: options.uid,
  });
  for (const stagingTemporary of namespace.stagingTemps) {
    await removeReleaseStageTemporary({
      fsOps: options.fsOps,
      layout: options.layout,
      uid: options.uid,
      name: path.basename(stagingTemporary.directory),
    });
  }

  const releaseDirectory = path.join(
    options.layout.releasesRoot,
    options.artifact.artifactId,
  );
  const releaseArtifactPath = path.join(releaseDirectory, 'app');
  const existing = namespace.releases.find(
    (release) => release.artifactId === options.artifact.artifactId,
  );
  if (existing) {
    if (
      existing.appId !== options.pair.runtime.appId ||
      existing.revisionId !== options.pair.runtime.revisionId ||
      existing.artifactPath !== releaseArtifactPath ||
      getBuildTargetId(existing.target) !==
        getBuildTargetId(options.pair.runtime.target) ||
      !hasSameArtifactBytes(existing, options.artifact)
    ) {
      throw new Error(
        'Existing systemd user-service release does not match the packaged artifact.',
      );
    }
    return existing;
  }
  if (
    namespace.tombstones.some(
      (tombstone) => tombstone.artifactId === options.artifact.artifactId,
    )
  ) {
    throw new Error(
      'Systemd user-service release artifact has an interrupted prune tombstone; run service prune before staging it again.',
    );
  }
  if (
    namespace.releases.length + namespace.tombstones.length >=
    SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_DIRECTORY_ENTRIES
  ) {
    throw new Error(
      'Systemd user-service release namespace is full; run service prune before staging another release.',
    );
  }
  if (
    !Number.isSafeInteger(options.artifact.size) ||
    options.artifact.size < 0 ||
    options.artifact.size >
      SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES -
        namespace.artifactBytes
  ) {
    throw new Error(
      'Systemd user-service release namespace would exceed its logical artifact-byte limit; run service prune before staging another release.',
    );
  }
  const temporaryDirectory = path.join(
    options.layout.releasesRoot,
    `.${options.artifact.artifactId}.${options.token}.tmp`,
  );
  let temporaryCreated = false;
  try {
    await options.fsOps.mkdir(temporaryDirectory, { mode: 0o700 });
    temporaryCreated = true;
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
    await options.fsOps.rename(temporaryDirectory, releaseDirectory);
    temporaryCreated = false;
    await syncDirectory(options.fsOps, options.layout.releasesRoot);
    return release;
  } catch (error) {
    if (temporaryCreated) {
      await removeReleaseStageTemporary({
        fsOps: options.fsOps,
        layout: options.layout,
        uid: options.uid,
        name: path.basename(temporaryDirectory),
      }).catch(() => undefined);
    }
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
 * @param {{serviceRoot: string, uid: number, createServer?: typeof import('node:net').createServer}} options - Lock identity and test seam.
 * @returns {Promise<() => Promise<void>>} - Idempotent release callback.
 */
async function acquireOperationLock(options) {
  try {
    return await acquireLinuxAbstractOperationLock({
      domain: 'wharfie:systemd-user-service-operation-lock:v1',
      scope: JSON.stringify([String(options.uid), options.serviceRoot]),
      ...(options.createServer === undefined
        ? {}
        : { createServer: options.createServer }),
    });
  } catch (error) {
    if (error instanceof LinuxAbstractOperationLockBusyError) {
      throw new Error(
        'Another systemd user-service operation is already active.',
      );
    }
    throw error;
  }
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
 * @returns {Readonly<{install: () => Promise<Record<string, any>>, converge: () => Promise<Record<string, any>>, update: () => Promise<Record<string, any>>, rollback: () => Promise<Record<string, any>>, recover: () => Promise<Record<string, any>>, prune: () => Promise<Record<string, any>>, purge: (input?: {confirmation?: string}) => Promise<Record<string, any>>, start: () => Promise<Record<string, any>>, stop: () => Promise<Record<string, any>>, restart: () => Promise<Record<string, any>>, status: () => Promise<Record<string, any>>, uninstall: () => Promise<Record<string, any>>}>} - Service operations.
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
   * @returns {Readonly<Record<string, any>>} - JSON-safe unavailable manager view.
   */
  function createUnavailableSystemdObservation() {
    return Object.freeze({
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
   * @param {Readonly<Record<string, any>>} reference - Release identity.
   * @returns {string} - Collision-free in-memory lookup key.
   */
  function releaseObservationKey(reference) {
    return JSON.stringify([reference.artifactId, reference.revisionId]);
  }

  /**
   * @param {Readonly<Record<string, any>>} left - Release record.
   * @param {Readonly<Record<string, any>>} right - Release record.
   * @returns {boolean} - Whether records are byte-for-byte equivalent JSON.
   */
  function hasSameReleaseRecord(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  /**
   * Observe the three mutable runtime roots required by an installed
   * projection without creating any of them.
   * @param {{layout: Readonly<Record<string, string>>, filesystemUid: number}} context - App context.
   * @returns {Promise<Readonly<{state: 'managed'|'absent'|'conflicting'|'unknown', controlExists: boolean}>>} - Root observation.
   */
  async function inspectStatusStateRoots(context) {
    let controlExists = true;
    /** @type {'managed'|'absent'|'conflicting'|'unknown'} */
    let state = 'managed';
    for (const [directory, label] of [
      [context.layout.controlPath, 'Systemd user-service control root'],
      [context.layout.stateRoot, 'Systemd user-service state root'],
      [
        context.layout.applicationStatePath,
        'Systemd user-service application-state root',
      ],
    ]) {
      try {
        await assertRealPath(
          fsOps,
          directory,
          'directory',
          label,
          context.filesystemUid,
        );
      } catch (error) {
        if (
          directory === context.layout.controlPath &&
          hasCode(error, 'ENOENT')
        ) {
          controlExists = false;
        }
        if (hasCode(error, 'ENOENT')) {
          if (state === 'managed') state = 'absent';
          continue;
        }
        if (isTransientObservationError(error)) {
          if (state !== 'conflicting') state = 'unknown';
          continue;
        }
        state = 'conflicting';
      }
    }
    return Object.freeze({ state, controlExists });
  }

  /**
   * Read the selector as an explicit four-way observation. A malformed or
   * unauthorized selector is stable conflict; transient resource failures are
   * retained as unknown.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, filesystemUid: number}} context - App context.
   * @returns {Promise<Readonly<Record<string, any>>>} - Selector observation.
   */
  async function inspectStatusSelection(context) {
    try {
      const release = await readSelectedRelease({
        fsOps,
        layout: context.layout,
        inspectBytes,
        uid: context.filesystemUid,
        target: context.pair.runtime.target,
      });
      return release
        ? Object.freeze({ state: 'verified', release })
        : Object.freeze({ state: 'absent' });
    } catch (error) {
      return Object.freeze({
        state: isTransientObservationError(error) ? 'unknown' : 'conflicting',
      });
    }
  }

  /**
   * Inspect the live manager search path and any lower-priority unit-name
   * claimant without creating the fixed unit directory.
   * @param {{layout: Readonly<Record<string, string>>}} context - App context.
   * @returns {Promise<Readonly<{state: 'available'|'conflicting'|'unknown', includesFixedPath: boolean}>>} - Manager-path observation.
   */
  async function inspectStatusManagerPaths(context) {
    let unitPaths;
    try {
      unitPaths = await readManagerUnitPaths();
    } catch {
      return Object.freeze({
        state: 'unknown',
        includesFixedPath: false,
      });
    }
    for (const unitDirectory of unitPaths) {
      const candidate = path.join(unitDirectory, context.layout.unitName);
      if (candidate === context.layout.unitPath) continue;
      try {
        await fsOps.lstat(candidate);
      } catch (error) {
        if (hasCode(error, 'ENOENT')) continue;
        return Object.freeze({
          state: isTransientObservationError(error) ? 'unknown' : 'conflicting',
          includesFixedPath: unitPaths.includes(
            path.dirname(context.layout.unitPath),
          ),
        });
      }
      return Object.freeze({
        state: 'conflicting',
        includesFixedPath: unitPaths.includes(
          path.dirname(context.layout.unitPath),
        ),
      });
    }
    return Object.freeze({
      state: 'available',
      includesFixedPath: unitPaths.includes(
        path.dirname(context.layout.unitPath),
      ),
    });
  }

  /**
   * Capture every raw input used by status and desired-convergence
   * classification while the existing operation lock is held. The snapshot
   * performs no staging, publication, reload, enablement, or activation write.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {Readonly<Record<string, any>> | null} activation - Durable activation.
   * @param {Readonly<Record<string, any>> | null} installation - Physical receipt.
   * @param {Readonly<Record<string, any>> | null} marker - Uninstall marker.
   * @param {Readonly<{artifactId: string, revisionId: string}>} desired - Invoking SEA identity.
   * @returns {Promise<Readonly<Record<string, any>>>} - Coherent read-only snapshot.
   */
  async function readStatusObservationSnapshot(
    context,
    activation,
    installation,
    marker,
    desired,
  ) {
    const unitFile = await inspectFixedUnitFile({
      fsOps,
      layout: context.layout,
      uid: context.filesystemUid,
    });
    const stateRoots = await inspectStatusStateRoots(context);
    const selected = await inspectStatusSelection(context);

    let systemd;
    let systemdAvailable = true;
    try {
      systemd = await readSystemd(context.layout);
    } catch {
      systemdAvailable = false;
      systemd = createUnavailableSystemdObservation();
    }

    const manager = await inspectStatusManagerPaths(context);
    let linger;
    let lingerAvailable = true;
    try {
      linger = await readLinger(context.uid);
    } catch {
      lingerAvailable = false;
      linger = null;
    }

    let runtime = null;
    let runtimeAvailable = true;
    if (stateRoots.controlExists) {
      try {
        runtime = await (options.readRuntimeState || readRuntimeState)({
          layout: context.layout,
          appId: context.pair.runtime.appId,
          fsOps,
          ...(options.createControlDBClient
            ? { createDB: options.createControlDBClient }
            : {}),
          ...(options.probeLocalServiceSession
            ? { probeSession: options.probeLocalServiceSession }
            : {}),
        });
      } catch {
        runtimeAvailable = false;
        runtime = Object.freeze({
          status: 'UNAVAILABLE',
          session: 'unknown',
        });
      }
    }

    /** @type {Map<string, Readonly<Record<string, any>>>} */
    const releases = new Map();
    const references = [
      activation?.selected,
      activation?.desired,
      activation?.rollbackCandidate,
      activation?.transition?.source,
      activation?.transition?.target,
      installation?.current,
      installation?.previous,
    ].filter(Boolean);
    for (const reference of references) {
      const key = releaseObservationKey(reference);
      if (releases.has(key)) continue;
      try {
        releases.set(
          key,
          Object.freeze({
            state: 'verified',
            release: await readActivationRelease(context, reference),
          }),
        );
      } catch (error) {
        releases.set(
          key,
          Object.freeze({
            state: isTransientObservationError(error)
              ? 'unknown'
              : 'conflicting',
          }),
        );
      }
    }

    return Object.freeze({
      layout: context.layout,
      desired,
      activation,
      installation,
      marker,
      unitFile,
      stateRoots,
      selected,
      systemd,
      systemdAvailable,
      manager,
      linger,
      lingerAvailable,
      runtime,
      runtimeAvailable,
      releases,
    });
  }

  /**
   * @param {Readonly<Record<string, any>>} snapshot - Status snapshot.
   * @param {Readonly<Record<string, any>>} reference - Release identity.
   * @returns {Readonly<Record<string, any>> | undefined} - Release observation.
   */
  function getReleaseObservation(snapshot, reference) {
    return snapshot.releases.get(releaseObservationKey(reference));
  }

  /**
   * @param {Readonly<Record<string, any>>} snapshot - Status snapshot.
   * @param {Readonly<Record<string, any>>} record - Physical release record.
   * @returns {boolean} - Whether immutable bytes and exact metadata verified.
   */
  function hasVerifiedReleaseRecord(snapshot, record) {
    const observation = getReleaseObservation(snapshot, record);
    return (
      observation?.state === 'verified' &&
      hasSameReleaseRecord(observation.release, record)
    );
  }

  /**
   * Derive the legacy public status fields solely from the captured raw
   * snapshot so the attached convergence proof cannot disagree with a second
   * host observation.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>}} context - App context.
   * @param {Readonly<Record<string, any>>} snapshot - Coherent status snapshot.
   * @returns {Record<string, any>} - Public status without activation/proof.
   */
  function createObservedStatusFromSnapshot(context, snapshot) {
    const installation = snapshot.installation;
    const installed =
      installation?.state === 'installed' && snapshot.marker === null;
    const exactSelection =
      installed &&
      snapshot.selected.state === 'verified' &&
      hasSameReleaseReference(snapshot.selected.release, installation.current);
    let integrity = Object.freeze({
      status:
        exactSelection &&
        snapshot.stateRoots.state === 'managed' &&
        snapshot.unitFile.state === 'managed' &&
        hasVerifiedReleaseRecord(snapshot, installation.current)
          ? 'verified'
          : 'invalid',
      ...(exactSelection &&
      snapshot.stateRoots.state === 'managed' &&
      snapshot.unitFile.state === 'managed' &&
      hasVerifiedReleaseRecord(snapshot, installation.current)
        ? {
            artifactId: installation.current.artifactId,
            revisionId: installation.current.revisionId,
          }
        : {}),
    });
    const selection =
      snapshot.selected.state === 'verified'
        ? exactSelection || !installed
          ? 'managed'
          : 'conflicting'
        : snapshot.selected.state === 'absent'
          ? 'absent'
          : 'conflicting';
    const wiring = createWiringView(
      snapshot.unitFile,
      selection,
      snapshot.systemd,
      context.layout,
      installed,
      snapshot.marker !== null,
    );
    if (
      installed &&
      integrity.status === 'verified' &&
      wiring.state !== 'managed'
    ) {
      integrity = Object.freeze({ status: 'invalid' });
    }

    if (installed) {
      const persistence = Object.freeze({
        linger: snapshot.lingerAvailable ? snapshot.linger : null,
        unitEnabled: snapshot.systemd.unitFileState === 'enabled',
        bootEnabled:
          snapshot.linger === true &&
          snapshot.systemd.unitFileState === 'enabled',
      });
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
        systemd: snapshot.systemd,
        runtime: snapshot.runtime,
        integrity,
        wiring,
        persistence,
        health: classifyHealth(
          installation,
          snapshot.systemd,
          snapshot.runtime,
          integrity,
          persistence,
        ),
      };
    }

    return {
      schemaVersion: SERVICE_STATUS_SCHEMA_VERSION,
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
      systemd: snapshot.systemd,
      runtime: snapshot.runtime,
      wiring,
      health: wiring.state === 'absent' ? 'absent' : 'degraded',
    };
  }

  /**
   * @param {Readonly<Record<string, any>> | null} activation - Durable activation.
   * @returns {Readonly<Record<string, any>>[]} - Sole release authority set.
   */
  function getActivationAuthority(activation) {
    if (!activation) return [];
    /** @type {Readonly<Record<string, any>>[]} */
    const authority = [];
    for (const reference of [
      activation.selected,
      activation.desired,
      activation.rollbackCandidate,
      activation.transition?.source,
      activation.transition?.target,
    ]) {
      if (
        reference &&
        !authority.some((candidate) =>
          hasSameReleaseReference(candidate, reference),
        )
      ) {
        authority.push(reference);
      }
    }
    return authority;
  }

  /**
   * @param {Readonly<Record<string, any>> | null | undefined} reference - Physical identity.
   * @param {Readonly<Record<string, any>>[]} authority - Durable identities.
   * @returns {boolean} - Whether strict activation state authorizes the identity.
   */
  function hasActivationAuthority(reference, authority) {
    return (
      reference === null ||
      reference === undefined ||
      authority.some((candidate) =>
        hasSameReleaseReference(candidate, reference),
      )
    );
  }

  /**
   * @param {Readonly<Record<string, any>>} snapshot - Status snapshot.
   * @param {Readonly<Record<string, any>>[]} authority - Activation authority.
   * @returns {'conflict'|'unknown'|null} - Global blocker.
   */
  function classifyStatusSnapshotBlocker(snapshot, authority) {
    if (snapshot.marker !== null) return 'conflict';
    if (
      snapshot.stateRoots.state === 'conflicting' ||
      snapshot.manager.state === 'conflicting' ||
      snapshot.selected.state === 'conflicting'
    ) {
      return 'conflict';
    }
    if (snapshot.unitFile.state === 'conflicting') {
      return isTransientObservationError(snapshot.unitFile.error)
        ? 'unknown'
        : 'conflict';
    }
    if (
      snapshot.stateRoots.state === 'unknown' ||
      snapshot.manager.state === 'unknown' ||
      snapshot.selected.state === 'unknown' ||
      !snapshot.systemdAvailable ||
      !snapshot.lingerAvailable ||
      !snapshot.runtimeAvailable
    ) {
      return 'unknown';
    }
    if (snapshot.linger === false) return 'conflict';

    for (const reference of authority) {
      const observation = getReleaseObservation(snapshot, reference);
      if (observation?.state === 'conflicting') return 'conflict';
      if (observation?.state !== 'verified') return 'unknown';
    }

    const installation = snapshot.installation;
    if (
      installation?.state === 'installed' ||
      (installation?.state === 'uninstalled' &&
        snapshot.activation?.transition?.action ===
          LocalApplicationActivationAction.UPDATE)
    ) {
      for (const release of [
        installation.current,
        installation.previous,
      ].filter(Boolean)) {
        if (!hasActivationAuthority(release, authority)) return 'conflict';
        const observation = getReleaseObservation(snapshot, release);
        if (
          observation?.state === 'conflicting' ||
          (observation?.state === 'verified' &&
            !hasSameReleaseRecord(observation.release, release))
        ) {
          return 'conflict';
        }
        if (observation?.state !== 'verified') return 'unknown';
      }
    }
    if (
      snapshot.selected.state === 'verified' &&
      !hasActivationAuthority(snapshot.selected.release, authority)
    ) {
      return 'conflict';
    }
    if (snapshot.selected.state === 'verified') {
      const observation = getReleaseObservation(
        snapshot,
        snapshot.selected.release,
      );
      if (
        observation?.state === 'verified' &&
        !hasSameReleaseRecord(observation.release, snapshot.selected.release)
      ) {
        return 'conflict';
      }
    }

    const systemd = snapshot.systemd;
    if (
      systemd.dropInPaths !== '' ||
      (systemd.fragmentPath !== '' &&
        systemd.fragmentPath !== snapshot.layout.unitPath)
    ) {
      return 'conflict';
    }
    if (systemd.loadState !== 'not-found' && systemd.loadState !== 'loaded') {
      return 'unknown';
    }
    if (
      systemd.loadState === 'loaded' &&
      !hasExpectedUnitSource(systemd, snapshot.layout)
    ) {
      return 'conflict';
    }

    const runtime = snapshot.runtime;
    const managerHasLiveProcess =
      systemd.mainPid > 0 || systemd.activeState === 'active';
    if (runtime === null) return managerHasLiveProcess ? 'conflict' : null;
    if (
      runtime.status === 'UNKNOWN' ||
      runtime.status === 'UNAVAILABLE' ||
      runtime.session === 'unknown'
    ) {
      return 'unknown';
    }
    const hasArtifact = typeof runtime.artifactId === 'string';
    const hasRevision = typeof runtime.revisionId === 'string';
    if (
      hasArtifact !== hasRevision ||
      (hasArtifact && !hasActivationAuthority(runtime, authority))
    ) {
      return 'conflict';
    }
    if (
      runtime.session === 'manual' ||
      runtime.ownerKind === 'manual' ||
      (runtime.currentOwner === true &&
        (runtime.ownerKind !== LedgerServiceOwnerKind.RESIDENT ||
          runtime.session !== 'active'))
    ) {
      return 'conflict';
    }
    if (
      runtime.session === 'active' &&
      (runtime.ownerKind !== LedgerServiceOwnerKind.RESIDENT ||
        runtime.currentOwner !== true ||
        !hasArtifact ||
        !hasSameReleaseReference(runtime, snapshot.activation?.selected) ||
        !Number.isSafeInteger(runtime.processId) ||
        runtime.processId < 1 ||
        systemd.mainPid < 1 ||
        runtime.processId !== systemd.mainPid)
    ) {
      return 'conflict';
    }
    if (
      managerHasLiveProcess &&
      (runtime.session !== 'active' ||
        runtime.ownerKind !== LedgerServiceOwnerKind.RESIDENT ||
        runtime.currentOwner !== true ||
        (runtime.status !== LedgerServiceLifecycleStatus.READY &&
          runtime.status !== LedgerServiceLifecycleStatus.STARTING))
    ) {
      return 'conflict';
    }
    return null;
  }

  /**
   * @param {Readonly<Record<string, any>>} snapshot - Status snapshot.
   * @param {Readonly<Record<string, any>>} current - Expected current release.
   * @param {Readonly<Record<string, any>> | null} previous - Expected previous release.
   * @returns {boolean} - Whether receipt metadata exactly matches a projection.
   */
  function hasExactReceiptProjection(snapshot, current, previous) {
    const installation = snapshot.installation;
    return (
      installation?.state === 'installed' &&
      hasSameReleaseReference(installation.current, current) &&
      hasSameReleaseReference(installation.previous, previous) &&
      hasVerifiedReleaseRecord(snapshot, installation.current) &&
      (installation.previous === null ||
        hasVerifiedReleaseRecord(snapshot, installation.previous))
    );
  }

  /**
   * @param {Readonly<Record<string, any>>} snapshot - Status snapshot.
   * @param {Readonly<Record<string, any>>} current - Expected selector.
   * @param {Readonly<Record<string, any>> | null} previous - Expected rollback receipt.
   * @returns {boolean} - Exact persistent physical projection.
   */
  function hasExactPhysicalProjection(snapshot, current, previous) {
    return (
      hasExactReceiptProjection(snapshot, current, previous) &&
      snapshot.selected.state === 'verified' &&
      hasSameReleaseReference(snapshot.selected.release, current) &&
      snapshot.stateRoots.state === 'managed' &&
      snapshot.unitFile.state === 'managed' &&
      hasExpectedEffectiveUnit(
        snapshot.systemd,
        snapshot.installation.layout,
      ) &&
      snapshot.systemd.unitFileState === 'enabled' &&
      snapshot.linger === true
    );
  }

  /**
   * ACTIVE repair accepts absence for receipt and selector, but every present
   * component must already be the exact durable selected/rollback projection.
   * @param {Readonly<Record<string, any>>} snapshot - Status snapshot.
   * @param {Readonly<Record<string, any>>} current - Durable selection.
   * @param {Readonly<Record<string, any>> | null} previous - Durable rollback.
   * @returns {boolean} - Whether reinstall can safely consume the snapshot.
   */
  function hasActiveRepairEnvelope(snapshot, current, previous) {
    const installation = snapshot.installation;
    const receiptCompatible =
      installation === null ||
      ((installation.state === 'installed' ||
        installation.state === 'uninstalled') &&
        hasSameReleaseReference(installation.current, current) &&
        hasSameReleaseReference(installation.previous, previous) &&
        hasVerifiedReleaseRecord(snapshot, installation.current) &&
        (installation.previous === null ||
          hasVerifiedReleaseRecord(snapshot, installation.previous)));
    const selectorCompatible =
      snapshot.selected.state === 'absent' ||
      (snapshot.selected.state === 'verified' &&
        hasSameReleaseReference(snapshot.selected.release, current));
    return receiptCompatible && selectorCompatible;
  }

  /**
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>}} context - App context.
   * @param {Readonly<Record<string, any>>} snapshot - Coherent raw snapshot.
   * @returns {Readonly<Record<string, any>>} - Exact V1 convergence proof.
   */
  function createDesiredConvergenceStatus(context, snapshot) {
    /**
     * @param {'authorized'|'conflict'|'unknown'} disposition - Decision.
     * @param {'physical-absence'|'durable-install'|'durable-change'|'durable-active'|null} [basis] - Authority basis.
     * @returns {Readonly<Record<string, any>>} - Exact proof.
     */
    const decision = (disposition, basis = null) =>
      Object.freeze({
        schemaVersion: DESIRED_CONVERGENCE_SCHEMA_VERSION,
        kind: DESIRED_CONVERGENCE_KIND,
        appId: context.pair.runtime.appId,
        unit: context.layout.unitName,
        desired: snapshot.desired,
        disposition,
        basis: disposition === 'authorized' ? basis : null,
      });

    const activation = snapshot.activation;
    const authority = getActivationAuthority(activation);
    const blocker = classifyStatusSnapshotBlocker(snapshot, authority);
    if (blocker !== null) return decision(blocker);
    if (!snapshot.manager.includesFixedPath) return decision('unknown');

    if (activation === null) {
      if (
        snapshot.installation?.state === 'installed' ||
        snapshot.selected.state !== 'absent' ||
        snapshot.unitFile.state !== 'absent' ||
        snapshot.systemd.loadState !== 'not-found' ||
        snapshot.runtime !== null
      ) {
        return decision('conflict');
      }
      if (snapshot.systemd.needDaemonReload !== false) {
        return decision('unknown');
      }
      return decision('authorized', 'physical-absence');
    }

    if (
      activation.transition?.action ===
      LocalApplicationActivationAction.ROLLBACK
    ) {
      return decision('conflict');
    }

    if (activation.phase === LocalApplicationActivationPhase.ACTIVE) {
      if (!activation.selected) {
        return decision('unknown');
      }
      if (
        !hasActiveRepairEnvelope(
          snapshot,
          activation.selected,
          activation.rollbackCandidate,
        )
      ) {
        return decision('conflict');
      }
      return decision('authorized', 'durable-active');
    }

    const transition = activation.transition;
    if (
      !transition ||
      !hasSameReleaseReference(transition.target, snapshot.desired)
    ) {
      return decision('unknown');
    }
    if (
      transition.action !== LocalApplicationActivationAction.INSTALL &&
      transition.action !== LocalApplicationActivationAction.UPDATE
    ) {
      return decision('conflict');
    }

    const selectedPhase =
      activation.phase === LocalApplicationActivationPhase.SELECTED ||
      activation.phase === LocalApplicationActivationPhase.ACTIVATING;
    if (selectedPhase) {
      const previous =
        transition.action === LocalApplicationActivationAction.INSTALL
          ? null
          : getActivationPhysicalPrevious(activation);
      if (
        !activation.selected ||
        previous === undefined ||
        !hasExactPhysicalProjection(snapshot, activation.selected, previous)
      ) {
        return decision('unknown');
      }
    } else if (
      activation.phase === LocalApplicationActivationPhase.QUIESCING &&
      transition.action === LocalApplicationActivationAction.UPDATE &&
      hasSameReleaseReference(activation.desired, transition.target)
    ) {
      if (
        !transition.source ||
        !hasExactPhysicalProjection(
          snapshot,
          transition.source,
          activation.rollbackCandidate,
        )
      ) {
        return decision('unknown');
      }
    } else if (
      activation.phase !== LocalApplicationActivationPhase.QUIESCING &&
      activation.phase !== LocalApplicationActivationPhase.QUIESCENT
    ) {
      return decision('unknown');
    }

    return decision(
      'authorized',
      transition.action === LocalApplicationActivationAction.INSTALL
        ? 'durable-install'
        : 'durable-change',
    );
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
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>}} context - App context.
   * @param {'purged'|'already-purged'} outcome - Converged result.
   * @returns {Record<string, any>} - Destructive app-data purge receipt.
   */
  function createPurgeReceipt(context, outcome) {
    return {
      schemaVersion: SERVICE_RESULT_SCHEMA_VERSION,
      kind: SERVICE_RESULT_KIND,
      action: 'purge',
      requestStatus: 'fulfilled',
      appId: context.pair.runtime.appId,
      outcome,
      unit: context.layout.unitName,
      health: 'absent',
      activeArtifactId: null,
      activeRevisionId: null,
      rollbackArtifactId: null,
      rollbackRevisionId: null,
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

    /**
     * Refresh only a stale cache whose loaded source and local unit bytes are
     * both already exact. Missing local bytes are repaired later by selection
     * convergence, after the exact cached unit has safely stopped.
     * @param {Readonly<Record<string, any>>} observed - Manager observation.
     * @returns {Promise<Readonly<Record<string, any>>>} - Revalidated manager state.
     */
    async function refreshExactStaleUnit(observed) {
      if (
        !hasExpectedUnitSource(observed, context.layout) ||
        observed.needDaemonReload !== true
      ) {
        return observed;
      }
      const unitFile = await inspectFixedUnitFile({
        fsOps,
        layout: context.layout,
        uid: context.filesystemUid,
      });
      if (unitFile.state !== 'managed') return observed;
      await systemctl(['daemon-reload']);
      return await readSystemd(context.layout);
    }

    /**
     * @param {Readonly<Record<string, any>>} observed - Manager observation.
     * @returns {boolean} - Whether loaded source identity is safe for stop proof.
     */
    function hasExpectedStopUnit(observed) {
      return (
        hasExpectedEffectiveUnit(observed, context.layout) ||
        (hasExpectedUnitSource(observed, context.layout) &&
          observed.needDaemonReload === true)
      );
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
        const systemd = await refreshExactStaleUnit(
          await readSystemd(context.layout),
        );
        if (systemd.loadState === 'not-found') {
          if (systemd.activeState !== 'inactive') {
            throw new Error(
              'Systemd reported an active service without loaded unit wiring.',
            );
          }
          return;
        }
        if (!hasExpectedStopUnit(systemd)) {
          throw new Error(
            'Systemd loaded different or stale wiring while activation tried to stop the service.',
          );
        }
        const failed =
          systemd.activeState === 'failed' || systemd.result === 'failed';
        if (systemd.activeState !== 'inactive') {
          await systemctl(['stop', context.layout.unitName]);
          await waitForSystemdInactive(
            { layout: context.layout },
            stopTimeoutMs,
          );
        }
        if (failed) {
          // reset-failed also clears systemd's start-rate counter. Without it,
          // a retry-safe desired-state operation can remain stuck after the
          // selected unit reaches start-limit-hit.
          await systemctl(['reset-failed', context.layout.unitName]);
        }
      },

      /** @param {Readonly<Record<string, any>>} input - Inactivity proof request. @returns {Promise<void>} - Resolves for inactive service. */
      async proveServiceInactive(input) {
        assertApp(input);
        const systemd = await refreshExactStaleUnit(
          await readSystemd(context.layout),
        );
        if (
          systemd.loadState === 'not-found' &&
          systemd.activeState === 'inactive'
        ) {
          return;
        }
        if (!hasExpectedStopUnit(systemd)) {
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
   * @param {{preflightFirstInstall?: boolean, activationRecoveryRemediation?: string}} [runtimeOptions] - First-install host preflight and safe replay guidance.
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
            if (
              hasCode(
                error,
                'systemd-user-service-converge-rollback-recovery-required',
              )
            ) {
              throw error;
            }
            throw createActivationRecoveryRequiredError(
              error,
              runtimeOptions.activationRecoveryRemediation,
            );
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
   * Create the target-enforcing convergence receipt. A fulfilled result is
   * accepted only while the invoking artifact remains independently healthy.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {Readonly<Record<string, any>>} result - Activation result.
   * @param {Readonly<{artifactId: string, revisionId: string}>} target - Exact invoking release.
   * @returns {Promise<Record<string, any>>} - Proven convergence receipt.
   */
  async function createDesiredConvergenceReceipt(context, result, target) {
    let receipt;
    try {
      receipt = await createActivationReceipt(context, result, 'converge');
    } catch (error) {
      throw createConvergeProofRequiredError(error);
    }
    if (
      receipt.requestStatus === 'fulfilled' &&
      (receipt.outcome !== 'target-active' ||
        receipt.health !== 'healthy' ||
        receipt.activeArtifactId !== target.artifactId ||
        receipt.activeRevisionId !== target.revisionId)
    ) {
      throw createConvergeProofRequiredError(
        new Error(
          'Desired-target convergence could not re-prove the exact healthy invoking release.',
        ),
      );
    }
    return receipt;
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
   * @param {{requireInvokingRelease?: boolean, recoveryRemediation?: string}} [options] - Reprojection authority and safe replay guidance.
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
      if (
        observed.health === 'stopped' ||
        observed.health === 'failed' ||
        observed.health === 'degraded'
      ) {
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
        throw createActiveReinstallRecoveryRequiredError(
          error,
          options.recoveryRemediation,
        );
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

  /**
   * Re-prove and, when necessary, repair an ACTIVE source projection before
   * beginning an update to a different invoking release.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, uid: number, filesystemUid: number}} context - App context.
   * @param {{activation: ReturnType<typeof createLocalApplicationActivation>, driver: Readonly<Record<string, Function>>}} runtime - Locked activation runtime.
   * @param {Readonly<Record<string, any>>} current - Exact ACTIVE activation.
   * @param {{repairAuthorizedSource?: boolean, repairRecoveryRemediation?: string}} [options] - Whether target convergence may resume a receipt-backed source repair and its safe replay guidance.
   * @returns {Promise<void>} - Resolves after the source projection is safe.
   */
  async function prepareActiveSourceForUpdate(
    context,
    runtime,
    current,
    options = {},
  ) {
    const installation = await readInstallation(
      context.layout,
      context.uid,
      context.filesystemUid,
      context.pair.runtime.target,
      { allowUninstalledTargetMismatch: true },
    );
    if (
      installation?.state === 'uninstalled' ||
      options.repairAuthorizedSource === true
    ) {
      await reinstallActiveSelection(context, runtime, current, {
        requireInvokingRelease: false,
        recoveryRemediation: options.repairRecoveryRemediation,
      });
      return;
    }
    const projection = Object.freeze({
      appId: context.pair.runtime.appId,
      current: current.selected,
      previous: current.rollbackCandidate,
    });
    const physical = await inspectPhysicalSelectionRepair(context, projection);
    if (physical.needsRepair) {
      throw new Error(
        'The durable activation lacks its exact installed source projection; invoke its exact selected SEA and run service install before service update.',
      );
    }
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

  /**
   * Treat the invoking artifact as the desired resident release. Resume one
   * non-rollback durable transition before making at most one exact-target
   * install, repair, or update attempt.
   * @returns {Promise<Record<string, any>>} - Activation receipt.
   */
  async function converge() {
    const context = await resolveContext();
    await assertLinger(context.uid);
    return await withLockedActivation(
      context,
      async (runtime) => {
        const artifact = await inspectBytes(artifactPath);
        const target = Object.freeze({
          artifactId: artifact.artifactId,
          revisionId: context.pair.runtime.revisionId,
        });
        let current = await runtime.activation.get({
          appId: context.pair.runtime.appId,
        });
        let result;

        if (
          current &&
          current.phase !== LocalApplicationActivationPhase.ACTIVE
        ) {
          if (
            current.transition?.action ===
            LocalApplicationActivationAction.ROLLBACK
          ) {
            throw createConvergeRollbackRecoveryRequiredError();
          }
          const recoveringTarget = current.transition?.target;
          const replaceableFirstInstall =
            current.transition?.action ===
              LocalApplicationActivationAction.INSTALL &&
            current.transition.source === null &&
            recoveringTarget &&
            !hasSameReleaseReference(recoveringTarget, target);
          if (replaceableFirstInstall) {
            result = await runtime.coordinator.install({
              appId: context.pair.runtime.appId,
              target,
            });
            return await createDesiredConvergenceReceipt(
              context,
              result,
              target,
            );
          }
          result = await runtime.coordinator.recover({
            appId: context.pair.runtime.appId,
          });
          if (result.requestStatus !== 'fulfilled') {
            return await createDesiredConvergenceReceipt(
              context,
              result,
              target,
            );
          }
          current = await runtime.activation.get({
            appId: context.pair.runtime.appId,
          });
          if (
            recoveringTarget &&
            hasSameReleaseReference(recoveringTarget, target) &&
            current?.phase === LocalApplicationActivationPhase.ACTIVE &&
            hasSameReleaseReference(current.selected, target)
          ) {
            return await createDesiredConvergenceReceipt(
              context,
              result,
              target,
            );
          }
        }

        if (!current) {
          result = await runtime.coordinator.install({
            appId: context.pair.runtime.appId,
            target,
          });
        } else if (
          current.phase === LocalApplicationActivationPhase.ACTIVE &&
          hasSameReleaseReference(current.selected, target)
        ) {
          result = await reinstallActiveSelection(context, runtime, current, {
            recoveryRemediation: CONVERGE_RECOVERY_REMEDIATION,
          });
        } else if (
          current.phase === LocalApplicationActivationPhase.ACTIVE &&
          current.selected
        ) {
          await prepareActiveSourceForUpdate(context, runtime, current, {
            repairAuthorizedSource: true,
            repairRecoveryRemediation: CONVERGE_RECOVERY_REMEDIATION,
          });
          result = await runtime.coordinator.update({
            appId: context.pair.runtime.appId,
            target,
          });
        } else {
          throw new Error(
            'Systemd service convergence could not recover one exact ACTIVE source release.',
          );
        }
        return await createDesiredConvergenceReceipt(context, result, target);
      },
      {
        preflightFirstInstall: true,
        activationRecoveryRemediation: CONVERGE_RECOVERY_REMEDIATION,
      },
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
        await prepareActiveSourceForUpdate(context, runtime, current);
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

  /**
   * Remove only fully verified local release copies outside the settled ACTIVE
   * selected/rollback authority. The app-scoped kernel lock spans the durable
   * snapshot, complete bounded namespace preflight, rename-first deletion, and
   * final verification.
   * @returns {Promise<Record<string, any>>} - Stable release-prune receipt.
   */
  async function prune() {
    try {
      const context = await resolveContext();
      const releaseLock = await acquireLock({
        serviceRoot: context.layout.serviceRoot,
        uid: context.uid,
      });
      try {
        const artifact = await inspectBytes(artifactPath);
        const invoking = Object.freeze({
          artifactId: artifact.artifactId,
          revisionId: context.pair.runtime.revisionId,
        });
        const activation = await readActivationSnapshot(context);
        if (!activation) {
          throw createReleasePruneError(
            'systemd-user-service-prune-state-conflict',
            'Systemd user-service release pruning requires an existing activation; run service install or service converge from the exact selected SEA.',
            undefined,
            PRUNE_MISSING_ACTIVATION_REMEDIATION,
          );
        }
        if (
          activation.phase !== LocalApplicationActivationPhase.ACTIVE ||
          !activation.selected
        ) {
          throw createReleasePruneError(
            'systemd-user-service-prune-recovery-required',
            'Systemd user-service release pruning requires one settled ACTIVE activation.',
            undefined,
            PRUNE_RECOVERY_REMEDIATION,
          );
        }
        if (!hasSameReleaseReference(activation.selected, invoking)) {
          throw createReleasePruneError(
            'systemd-user-service-prune-state-conflict',
            'Service prune must be invoked by the exact currently selected SEA.',
          );
        }
        const installation = await readInstallation(
          context.layout,
          context.uid,
          context.filesystemUid,
          context.pair.runtime.target,
        );
        if (!installation) {
          throw createReleasePruneError(
            'systemd-user-service-prune-state-conflict',
            'Systemd user-service release pruning requires an exact installation receipt.',
          );
        }
        const marker = await readUninstallMarker(context, installation);
        if (marker) {
          throw createReleasePruneError(
            'systemd-user-service-prune-uninstall-recovery-required',
            'Systemd user-service uninstall is incomplete; rerun service uninstall before pruning releases.',
            undefined,
            PRUNE_UNINSTALL_REMEDIATION,
          );
        }
        const projection = Object.freeze({
          appId: context.pair.runtime.appId,
          current: activation.selected,
          previous: activation.rollbackCandidate,
        });
        const releases = await readProjectionReleases(context, projection);
        if (
          !hasSameReleaseReference(installation.current, projection.current) ||
          !hasSameReleaseReference(
            installation.previous,
            projection.previous,
          ) ||
          JSON.stringify(installation.current) !==
            JSON.stringify(releases.current) ||
          (releases.previous
            ? JSON.stringify(installation.previous) !==
              JSON.stringify(releases.previous)
            : installation.previous !== null)
        ) {
          throw createReleasePruneError(
            'systemd-user-service-prune-state-conflict',
            'Systemd user-service installation receipt disagrees with settled release authority.',
          );
        }
        const snapshot = await readStatusObservationSnapshot(
          context,
          activation,
          installation,
          marker,
          invoking,
        );
        const blocker = classifyStatusSnapshotBlocker(
          snapshot,
          getActivationAuthority(activation),
        );
        if (blocker !== null || !snapshot.manager.includesFixedPath) {
          throw createReleasePruneError(
            'systemd-user-service-prune-state-conflict',
            'Systemd user-service physical state is not coherent enough to prune releases.',
          );
        }
        if (installation.state === 'installed') {
          if (
            !hasExactPhysicalProjection(
              snapshot,
              projection.current,
              projection.previous,
            )
          ) {
            throw createReleasePruneError(
              'systemd-user-service-prune-state-conflict',
              'Installed systemd user-service projection is not exact enough to prune releases.',
            );
          }
        } else if (
          snapshot.stateRoots.state !== 'managed' ||
          snapshot.selected.state !== 'absent' ||
          snapshot.unitFile.state !== 'absent' ||
          snapshot.systemd.loadState !== 'not-found' ||
          snapshot.systemd.activeState !== 'inactive' ||
          snapshot.systemd.mainPid !== 0 ||
          snapshot.systemd.needDaemonReload !== false
        ) {
          throw createReleasePruneError(
            'systemd-user-service-prune-state-conflict',
            'Uninstalled systemd user-service projection is not inert enough to prune releases.',
          );
        }

        let namespace;
        try {
          namespace = await inspectReleasePruneNamespace({
            fsOps,
            layout: context.layout,
            inspectBytes,
            uid: context.filesystemUid,
          });
        } catch (error) {
          throw createReleasePruneError(
            'systemd-user-service-prune-release-invalid',
            'Systemd user-service release namespace failed bounded integrity verification.',
            error,
          );
        }
        const protectedReferences = [
          projection.current,
          projection.previous,
        ].filter(Boolean);
        const retained = namespace.releases.filter((release) =>
          protectedReferences.some((reference) =>
            hasSameReleaseReference(release, reference),
          ),
        );
        if (retained.length !== protectedReferences.length) {
          throw createReleasePruneError(
            'systemd-user-service-prune-state-conflict',
            'Systemd user-service release namespace is missing settled authority.',
          );
        }
        const candidates = namespace.releases.filter(
          (release) =>
            !protectedReferences.some((reference) =>
              hasSameReleaseReference(release, reference),
            ),
        );

        let resumedPruneCount = 0;
        let recoveredStagingCount = 0;
        /** @type {Array<Readonly<{artifactId: string, revisionId: string, artifactBytes: number}>>} */
        const removed = [];
        try {
          for (const stagingTemporary of namespace.stagingTemps) {
            await removeReleaseStageTemporary({
              fsOps,
              layout: context.layout,
              uid: context.filesystemUid,
              name: path.basename(stagingTemporary.directory),
            });
            recoveredStagingCount += 1;
          }
          for (const tombstone of namespace.tombstones) {
            await removeReleasePruneTombstone({
              fsOps,
              layout: context.layout,
              inspectBytes,
              uid: context.filesystemUid,
              name: path.basename(tombstone.directory),
            });
            resumedPruneCount += 1;
          }
          for (const candidate of candidates) {
            const reverified = await readImmutableRelease({
              fsOps,
              layout: context.layout,
              inspectBytes,
              uid: context.filesystemUid,
              artifactId: candidate.artifactId,
              revisionId: candidate.revisionId,
              maximumArtifactBytes:
                SYSTEMD_USER_SERVICE_RELEASE_PRUNE_MAX_ARTIFACT_BYTES,
            });
            if (JSON.stringify(reverified) !== JSON.stringify(candidate)) {
              throw new Error(
                'Systemd user-service release changed after prune preflight.',
              );
            }
            const releaseDirectory = path.join(
              context.layout.releasesRoot,
              candidate.artifactId,
            );
            const tombstoneName =
              createSystemdUserServiceReleasePruneTombstoneName(candidate);
            await fsOps.rename(
              releaseDirectory,
              path.join(context.layout.releasesRoot, tombstoneName),
            );
            await syncDirectory(fsOps, context.layout.releasesRoot);
            await removeReleasePruneTombstone({
              fsOps,
              layout: context.layout,
              inspectBytes,
              uid: context.filesystemUid,
              name: tombstoneName,
            });
            removed.push(
              Object.freeze({
                artifactId: candidate.artifactId,
                revisionId: candidate.revisionId,
                artifactBytes: candidate.size,
              }),
            );
          }
        } catch (error) {
          throw createReleasePruneError(
            'systemd-user-service-prune-incomplete',
            'Systemd user-service release pruning was interrupted and is safe to retry.',
            error,
            PRUNE_RETRY_REMEDIATION,
          );
        }

        let finalNamespace;
        try {
          finalNamespace = await inspectReleasePruneNamespace({
            fsOps,
            layout: context.layout,
            inspectBytes,
            uid: context.filesystemUid,
          });
        } catch (error) {
          throw createReleasePruneError(
            'systemd-user-service-prune-incomplete',
            'Systemd user-service release pruning completed mutations but final verification failed.',
            error,
            PRUNE_RETRY_REMEDIATION,
          );
        }
        if (
          finalNamespace.tombstones.length !== 0 ||
          finalNamespace.stagingTemps.length !== 0 ||
          finalNamespace.releases.length !== protectedReferences.length ||
          finalNamespace.releases.some(
            (release) =>
              !protectedReferences.some((reference) =>
                hasSameReleaseReference(release, reference),
              ),
          )
        ) {
          throw createReleasePruneError(
            'systemd-user-service-prune-incomplete',
            'Systemd user-service release pruning did not converge on the protected release set.',
            undefined,
            PRUNE_RETRY_REMEDIATION,
          );
        }
        const removedArtifactBytes = removed.reduce(
          (total, release) => total + release.artifactBytes,
          0,
        );
        return createSystemdUserServiceReleasePruneReceipt({
          appId: context.pair.runtime.appId,
          outcome:
            removed.length === 0 &&
            resumedPruneCount === 0 &&
            recoveredStagingCount === 0
              ? 'nothing-to-prune'
              : 'pruned',
          installationState: installation.state,
          selected: projection.current,
          rollback: projection.previous,
          scannedReleaseCount: namespace.releases.length,
          retainedReleaseCount: retained.length,
          remainingReleaseCount: finalNamespace.releases.length,
          removed,
          removedCount: removed.length,
          removedArtifactBytes,
          resumedPruneCount,
          recoveredStagingCount,
        });
      } finally {
        await releaseLock();
      }
    } catch (error) {
      if (isReleasePruneError(error)) throw error;
      throw createReleasePruneError(
        'systemd-user-service-prune-operation-failed',
        'Systemd user-service release pruning failed before a safe result was available.',
        error,
      );
    }
  }

  /**
   * Require independently absent systemd wiring before destructive app-data
   * cleanup. Purge never performs uninstall as a side effect.
   * @param {{layout: Readonly<Record<string, string>>, filesystemUid: number}} context - Fixed application context.
   * @returns {Promise<void>} - Resolves only for fresh physical absence.
   */
  async function assertPurgeWiringAbsent(context) {
    const unitFile = await inspectFixedUnitFile({
      fsOps,
      layout: context.layout,
      uid: context.filesystemUid,
    });
    const systemd = await readSystemd(context.layout);
    const wantsPath = path.join(
      path.dirname(context.layout.unitPath),
      'default.target.wants',
      context.layout.unitName,
    );
    const wantsEntry = await lstatIfPresent(fsOps, wantsPath);
    if (
      unitFile.state !== 'absent' ||
      wantsEntry !== null ||
      systemd.loadState !== 'not-found' ||
      systemd.activeState !== 'inactive' ||
      systemd.mainPid !== 0 ||
      systemd.dropInPaths !== '' ||
      systemd.needDaemonReload !== false
    ) {
      throw createServicePurgeError(
        'systemd-user-service-purge-uninstall-required',
        'Systemd user-service purge requires coherently absent service wiring.',
        undefined,
        PURGE_UNINSTALL_REMEDIATION,
      );
    }
    try {
      await assertNoOtherUnitClaims(
        context.layout,
        await readManagerUnitPaths(),
      );
    } catch (error) {
      throw createServicePurgeError(
        'systemd-user-service-purge-state-conflict',
        'Systemd user-service purge found another claim on its unit name.',
        error,
      );
    }
  }

  /**
   * Require no live manual/resident owner before removing its durable store.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>}} context - Fixed application context.
   * @returns {Promise<void>} - Resolves only for absent or stopped ownership.
   */
  async function assertPurgeRuntimeInactive(context) {
    let runtime;
    try {
      runtime = await (options.readRuntimeState || readRuntimeState)({
        layout: context.layout,
        appId: context.pair.runtime.appId,
        fsOps,
        ...(options.createControlDBClient
          ? { createDB: options.createControlDBClient }
          : {}),
        ...(options.probeLocalServiceSession
          ? { probeSession: options.probeLocalServiceSession }
          : {}),
      });
    } catch (error) {
      throw createServicePurgeError(
        'systemd-user-service-purge-runtime-active',
        'Systemd user-service purge could not prove the local runtime inactive.',
        error,
      );
    }
    if (
      runtime !== null &&
      !(
        runtime.status === LedgerServiceLifecycleStatus.STOPPED &&
        runtime.ownerKind === undefined &&
        runtime.session === 'absent' &&
        runtime.currentOwner === false
      )
    ) {
      throw createServicePurgeError(
        'systemd-user-service-purge-runtime-active',
        'Systemd user-service purge requires no live local runtime owner.',
      );
    }
  }

  /**
   * Fully scan the durable run directory and reject every nonterminal run.
   * @param {{pair: import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair, layout: Readonly<Record<string, string>>, filesystemUid: number}} context - Fixed application context.
   * @returns {Promise<void>} - Resolves only for a quiescent app ledger.
   */
  async function assertPurgeDurableWorkQuiescent(context) {
    try {
      await assertRealPath(
        fsOps,
        context.layout.controlPath,
        'directory',
        'Systemd user-service control root',
        context.filesystemUid,
      );
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return;
      throw error;
    }
    const db = await createControlDB('lmdb', {
      path: context.layout.controlPath,
      readOnly: true,
    });
    const report = await withOpenControlDB(db, async () => {
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
      return await inspectLocalApplicationQuiescence({
        ledger,
        appId: context.pair.runtime.appId,
      });
    });
    if (!report.quiescent) {
      throw createServicePurgeError(
        'systemd-user-service-purge-not-quiescent',
        `Systemd user-service purge found ${report.nonterminalRunCount} nonterminal durable run${report.nonterminalRunCount === 1 ? '' : 's'}.`,
        undefined,
        PURGE_QUIESCENCE_REMEDIATION,
      );
    }
  }

  /**
   * Permanently remove one coherently uninstalled application's releases,
   * ledger, payloads, and application state. This command is serialized with
   * service operations and requires no concurrent ordinary SEA command.
   * @param {{confirmation?: string}} [input] - Typed destructive confirmation.
   * @returns {Promise<Record<string, any>>} - Stable app-data purge receipt.
   */
  async function purge(input = {}) {
    let mutationStarted = false;
    try {
      const context = await resolveContext();
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).length !== 1 ||
        input.confirmation !== context.pair.runtime.appId
      ) {
        throw createServicePurgeError(
          'systemd-user-service-purge-confirmation-required',
          'Systemd user-service purge requires the exact embedded application ID with --confirm-data-loss.',
          undefined,
          PURGE_CONFIRMATION_REMEDIATION,
        );
      }
      const releaseLock = await acquireLock({
        serviceRoot: context.layout.serviceRoot,
        uid: context.uid,
      });
      try {
        await assertPurgeWiringAbsent(context);
        let roots = await inspectServicePurgeRoots(
          fsOps,
          context.layout,
          context.filesystemUid,
        );
        if (roots.tombstone !== null) {
          mutationStarted = true;
          await removeServicePurgeTombstone({
            fsOps,
            tombstonePath: roots.tombstonePath,
            context,
            filesystemUid: context.filesystemUid,
            rootDevice: roots.tombstone.dev,
          });
          roots = await inspectServicePurgeRoots(
            fsOps,
            context.layout,
            context.filesystemUid,
          );
          if (roots.applicationRoot !== null || roots.tombstone !== null) {
            throw new Error(
              'Systemd user-service purge retry did not establish absence.',
            );
          }
          return createPurgeReceipt(context, 'purged');
        }
        if (roots.applicationRoot === null) {
          return createPurgeReceipt(context, 'already-purged');
        }

        const installation = await readInstallation(
          context.layout,
          context.uid,
          context.filesystemUid,
          context.pair.runtime.target,
          { allowUninstalledTargetMismatch: true },
        );
        if (!installation || installation.state !== 'uninstalled') {
          throw createServicePurgeError(
            'systemd-user-service-purge-uninstall-required',
            'Systemd user-service purge requires an exact uninstalled receipt.',
            undefined,
            PURGE_UNINSTALL_REMEDIATION,
          );
        }
        for (const [directory, label] of [
          [context.layout.stateRoot, 'Systemd user-service state root'],
          [context.layout.releasesRoot, 'Systemd user-service releases root'],
        ]) {
          await assertRealPath(
            fsOps,
            directory,
            'directory',
            label,
            context.filesystemUid,
          );
        }
        if (await readUninstallMarker(context, installation)) {
          throw createServicePurgeError(
            'systemd-user-service-purge-uninstall-required',
            'Systemd user-service uninstall recovery is incomplete.',
            undefined,
            PURGE_UNINSTALL_REMEDIATION,
          );
        }
        if (
          (await lstatIfPresent(fsOps, context.layout.currentLink)) !== null
        ) {
          throw createServicePurgeError(
            'systemd-user-service-purge-state-conflict',
            'Systemd user-service purge found an unexpected current selector.',
          );
        }
        const activation = await readActivationSnapshot(context);
        if (
          activation !== null &&
          activation.phase !== LocalApplicationActivationPhase.ACTIVE
        ) {
          throw createServicePurgeError(
            'systemd-user-service-purge-recovery-required',
            'Systemd user-service activation is in flight.',
            undefined,
            ACTIVATION_RECOVERY_REMEDIATION,
          );
        }
        await assertPurgeRuntimeInactive(context);
        await assertPurgeDurableWorkQuiescent(context);
        await removeStaleServicePurgeMarkerTemps({
          fsOps,
          root: context.layout.serviceRoot,
          uid: context.filesystemUid,
        });
        let marker = await readServicePurgeMarker({
          fsOps,
          root: context.layout.serviceRoot,
          context,
          filesystemUid: context.filesystemUid,
        });
        await inspectServicePurgeTopLevel(fsOps, context.layout.serviceRoot);
        if (!marker) {
          mutationStarted = true;
          marker = createServicePurgeMarker(context);
          await writeFileAtomic({
            fsOps,
            filePath: path.join(
              context.layout.serviceRoot,
              SERVICE_PURGE_MARKER_NAME,
            ),
            contents: `${JSON.stringify(marker, null, 2)}\n`,
            mode: 0o600,
            token: createToken(),
            uid: context.filesystemUid,
          });
        } else {
          mutationStarted = true;
        }

        // The service-operation lock does not serialize ordinary packaged run
        // commands. Recheck immediately before isolation and require callers
        // not to invoke another SEA command concurrently with purge.
        await assertPurgeRuntimeInactive(context);
        await assertPurgeDurableWorkQuiescent(context);
        const beforeRename = await inspectServicePurgeRoots(
          fsOps,
          context.layout,
          context.filesystemUid,
        );
        if (
          beforeRename.applicationRoot === null ||
          beforeRename.tombstone !== null ||
          beforeRename.applicationRoot.dev !== roots.applicationRoot.dev ||
          beforeRename.applicationRoot.ino !== roots.applicationRoot.ino
        ) {
          throw new Error(
            'Systemd user-service root changed before purge isolation.',
          );
        }
        await fsOps.rename(
          context.layout.serviceRoot,
          beforeRename.tombstonePath,
        );
        await syncDirectory(fsOps, path.dirname(context.layout.serviceRoot));
        const isolated = await fsOps.lstat(beforeRename.tombstonePath);
        if (
          !isolated.isDirectory() ||
          isolated.isSymbolicLink() ||
          isolated.dev !== beforeRename.applicationRoot.dev ||
          isolated.ino !== beforeRename.applicationRoot.ino
        ) {
          throw new Error(
            'Systemd user-service purge tombstone changed during isolation.',
          );
        }
        await removeServicePurgeTombstone({
          fsOps,
          tombstonePath: beforeRename.tombstonePath,
          context,
          filesystemUid: context.filesystemUid,
          rootDevice: isolated.dev,
        });
        const finalRoots = await inspectServicePurgeRoots(
          fsOps,
          context.layout,
          context.filesystemUid,
        );
        if (
          finalRoots.applicationRoot !== null ||
          finalRoots.tombstone !== null
        ) {
          throw new Error(
            'Systemd user-service purge did not establish application-root absence.',
          );
        }
        return createPurgeReceipt(context, 'purged');
      } finally {
        await releaseLock();
      }
    } catch (error) {
      if (isServicePurgeError(error)) throw error;
      throw createServicePurgeError(
        mutationStarted
          ? 'systemd-user-service-purge-incomplete'
          : 'systemd-user-service-purge-state-conflict',
        mutationStarted
          ? 'Systemd user-service purge was interrupted and is safe to retry.'
          : 'Systemd user-service state is not safe to purge.',
        error,
        mutationStarted ? PURGE_RETRY_REMEDIATION : undefined,
      );
    }
  }

  /** @returns {Promise<Record<string, any>>} - Current service status. */
  async function status() {
    const context = await resolveContext();
    const releaseLock = await acquireLock({
      serviceRoot: context.layout.serviceRoot,
      uid: context.uid,
    });
    try {
      const artifact = await inspectBytes(artifactPath);
      const desired = Object.freeze({
        artifactId: artifact.artifactId,
        revisionId: context.pair.runtime.revisionId,
      });
      const activation = await readActivationSnapshot(context);
      const installation = await readInstallation(
        context.layout,
        context.uid,
        context.filesystemUid,
        context.pair.runtime.target,
        { allowUninstalledTargetMismatch: activation === null },
      );
      const marker = await readUninstallMarker(context, installation);
      const snapshot = await readStatusObservationSnapshot(
        context,
        activation,
        installation,
        marker,
        desired,
      );
      const observed = createObservedStatusFromSnapshot(context, snapshot);
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
        desiredConvergence: createDesiredConvergenceStatus(context, snapshot),
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
    converge,
    update,
    rollback,
    recover,
    prune,
    purge,
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
