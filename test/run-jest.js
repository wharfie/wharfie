import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {object} JestChildResult
 * @property {Error} [error] - Spawn error.
 * @property {NodeJS.Signals | null} [signal] - Terminating signal.
 * @property {number | null} [status] - Child exit status.
 */

/** @typedef {(executable: string, args: string[], options: {env: NodeJS.ProcessEnv, stdio: 'inherit'}) => JestChildResult} JestChildRunner */
/** @typedef {(root: string, options: {recursive: true, force: true}) => void} JestTempRootRemover */

/**
 * @param {unknown} error - Possible filesystem error.
 * @returns {string | undefined} Filesystem error code.
 */
function getErrorCode(error) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = /** @type {{code?: unknown}} */ (error).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * @param {unknown} error - Possible filesystem error.
 * @returns {boolean} Whether cleanup may succeed after restoring owner
 *   permissions.
 */
function isRetryableRemovalError(error) {
  return ['EACCES', 'ENOTEMPTY', 'EPERM'].includes(getErrorCode(error) ?? '');
}

/**
 * Restore owner directory access within a quiescent runner-owned tree.
 *
 * The synchronous child has exited before this runs. Stable symlink entries
 * are not traversed, and files are never chmodded because only their parent
 * directory permissions govern unlinking. Tests must not leave another
 * process concurrently replacing entries in this owned tree.
 *
 * @param {string} entryPath - Owned entry to make removable.
 * @returns {void}
 */
function makeOwnedDirectoriesWritable(entryPath) {
  try {
    const stats = lstatSync(entryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return;

    chmodSync(entryPath, stats.mode | 0o700);
    for (const child of readdirSync(entryPath)) {
      makeOwnedDirectoriesWritable(path.join(entryPath, child));
    }
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return;
    }
    throw error;
  }
}

/**
 * Remove a temporary root created and exclusively owned by this runner.
 *
 * A test may legitimately make snapshot data read-only. Retry after restoring
 * owner access to real entries, while leaving symlink targets untouched.
 *
 * @param {string} root - Runner-owned temporary root.
 * @param {{recursive: true, force: true}} options - Removal options.
 * @param {{
 *   remove?: (root: string, options: {recursive: true, force: true, maxRetries: number, retryDelay: number}) => void
 * }} [dependencies] - Deterministic removal seam.
 * @returns {void}
 */
export function removeOwnedTempRoot(root, options, dependencies = {}) {
  const remove = dependencies.remove || rmSync;
  const retryOptions = {
    ...options,
    maxRetries: 3,
    retryDelay: 20,
  };
  try {
    remove(root, retryOptions);
  } catch (error) {
    if (!isRetryableRemovalError(error)) throw error;
    makeOwnedDirectoriesWritable(root);
    remove(root, retryOptions);
  }
}

/**
 * Preserve one primary failure plus a cleanup failure without discarding
 * either diagnostic.
 * @param {unknown} primary - Child/spawn failure.
 * @param {unknown} cleanup - Cleanup failure.
 * @param {string} message - Aggregate failure context.
 * @returns {never}
 */
function throwAggregateFailure(primary, cleanup, message) {
  throw new AggregateError([primary, cleanup], message, { cause: primary });
}

/**
 * @typedef {object} JestRunnerDependencies
 * @property {JestChildRunner} [spawn] - Synchronous child runner.
 * @property {(prefix: string) => string} [createTempRoot] - Temporary-root
 *   factory.
 * @property {JestTempRootRemover} [removeTempRoot] - Temporary-root remover.
 * @property {() => string} [getTempDirectory] - OS temporary-directory
 *   resolver.
 * @property {(pid: number, signal: NodeJS.Signals) => unknown} [kill] -
 *   Process signal sender.
 * @property {string} [execPath] - Node executable.
 * @property {NodeJS.ProcessEnv} [env] - Child environment.
 * @property {number} [pid] - Current process identifier.
 */

/**
 * @param {string[]} argv - Forwarded Jest arguments.
 * @returns {boolean} Whether the caller chose a worker mode.
 */
export function hasWorkerFlag(argv) {
  const separatorIndex = argv.indexOf('--');
  const options = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  return options.some(
    (arg) =>
      arg === '--runInBand' ||
      arg === '--run-in-band' ||
      arg.startsWith('--runInBand=') ||
      arg.startsWith('--run-in-band=') ||
      arg === '--maxWorkers' ||
      arg === '--max-workers' ||
      arg.startsWith('--maxWorkers=') ||
      arg.startsWith('--max-workers=') ||
      arg.startsWith('-w'),
  );
}

/**
 * @param {string[]} argv - Forwarded Jest arguments.
 * @param {string[]} optionNames - Equivalent long Jest option names.
 * @returns {boolean} Whether the option is present.
 */
function hasDirectoryOption(argv, optionNames) {
  const separatorIndex = argv.indexOf('--');
  const options = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  return options.some((arg) =>
    optionNames.some(
      (option) => arg === option || arg.startsWith(`${option}=`),
    ),
  );
}

/**
 * Run Jest with its cache, coverage, child temporary files, and child tool
 * caches confined to one disposable root.
 *
 * @param {string[]} argv - Forwarded Jest arguments.
 * @param {JestRunnerDependencies} [dependencies] - Test seams.
 * @returns {number} Child exit status.
 */
export function runJest(argv, dependencies = {}) {
  const {
    spawn = spawnSync,
    createTempRoot = mkdtempSync,
    removeTempRoot = removeOwnedTempRoot,
    getTempDirectory = os.tmpdir,
    kill = process.kill.bind(process),
    execPath = process.execPath,
    env = process.env,
    pid = process.pid,
  } = dependencies;

  const ownedRoot = createTempRoot(
    path.join(getTempDirectory(), 'wharfie-jest-'),
  );
  const childEnvironment = { ...env };
  const ownedEnvironment = {
    HOME: ownedRoot,
    USERPROFILE: ownedRoot,
    TMPDIR: ownedRoot,
    TMP: ownedRoot,
    TEMP: ownedRoot,
    APPDATA: path.join(ownedRoot, 'app-data'),
    LOCALAPPDATA: path.join(ownedRoot, 'local-app-data'),
    XDG_CACHE_HOME: path.join(ownedRoot, 'xdg-cache'),
    XDG_CONFIG_HOME: path.join(ownedRoot, 'xdg-config'),
    XDG_DATA_HOME: path.join(ownedRoot, 'xdg-data'),
    XDG_STATE_HOME: path.join(ownedRoot, 'xdg-state'),
    CONFIG_DIR: path.join(ownedRoot, 'xdg-config'),
    npm_config_cache: path.join(ownedRoot, 'npm-cache'),
    WHARFIE_TEST_WORKSPACE: ownedRoot,
  };
  const ownedEnvironmentKeys = new Set(
    Object.keys(ownedEnvironment).map((key) => key.toLowerCase()),
  );
  for (const key of Object.keys(childEnvironment)) {
    if (ownedEnvironmentKeys.has(key.toLowerCase())) {
      delete childEnvironment[key];
    }
  }
  Object.assign(childEnvironment, ownedEnvironment);
  const forwardedArgs = [...argv];
  /** @type {string[]} */
  const ownedArguments = [];

  if (
    !hasDirectoryOption(forwardedArgs, [
      '--cacheDirectory',
      '--cache-directory',
    ])
  ) {
    ownedArguments.push('--cacheDirectory', path.join(ownedRoot, 'cache'));
  }

  if (
    !hasDirectoryOption(forwardedArgs, [
      '--coverageDirectory',
      '--coverage-directory',
    ])
  ) {
    ownedArguments.push(
      '--coverageDirectory',
      path.join(ownedRoot, 'coverage'),
    );
  }

  if (!hasWorkerFlag(forwardedArgs)) {
    // Integration suites spawn their own native and Node child processes; two
    // Jest workers leave enough headroom on constrained hosted runners.
    ownedArguments.push('--maxWorkers=2');
  }
  const separatorIndex = forwardedArgs.indexOf('--');
  forwardedArgs.splice(
    separatorIndex === -1 ? forwardedArgs.length : separatorIndex,
    0,
    ...ownedArguments,
  );

  /** @type {JestChildResult | undefined} */
  let result;
  let spawnFailed = false;
  let spawnFailure;
  try {
    result = spawn(
      execPath,
      [
        '--experimental-vm-modules',
        'node_modules/jest/bin/jest.js',
        ...forwardedArgs,
      ],
      {
        env: childEnvironment,
        stdio: 'inherit',
      },
    );
  } catch (error) {
    spawnFailed = true;
    spawnFailure = error;
  }

  let cleanupFailed = false;
  let cleanupFailure;
  try {
    removeTempRoot(ownedRoot, { recursive: true, force: true });
  } catch (error) {
    cleanupFailed = true;
    cleanupFailure = error;
  }

  if (spawnFailed) {
    if (cleanupFailed) {
      throwAggregateFailure(
        spawnFailure,
        cleanupFailure,
        'Jest child spawn and temporary cleanup both failed.',
      );
    }
    throw spawnFailure;
  }

  if (!result) {
    const missingResult = new Error('Jest child runner returned no result.');
    if (cleanupFailed) {
      throwAggregateFailure(
        missingResult,
        cleanupFailure,
        'Jest child result and temporary cleanup both failed.',
      );
    }
    throw missingResult;
  }

  if (result.error) {
    if (cleanupFailed) {
      throwAggregateFailure(
        result.error,
        cleanupFailure,
        'Jest child spawn and temporary cleanup both failed.',
      );
    }
    throw result.error;
  }

  if (result.signal) {
    const signalError = new Error(
      `Jest child terminated with signal ${result.signal}.`,
    );
    if (cleanupFailed) {
      // A successful self-signal terminates before an aggregate can surface.
      // Retain both diagnostics instead of re-signalling in this rare case.
      throwAggregateFailure(
        signalError,
        cleanupFailure,
        'Jest child termination and temporary cleanup both failed.',
      );
    }
    try {
      kill(pid, result.signal);
    } catch (signalFailure) {
      const forwardingFailure = new AggregateError(
        [signalError, signalFailure],
        'Jest child signal forwarding failed.',
        { cause: signalError },
      );
      throw forwardingFailure;
    }
    return 1;
  }

  const status = result.status ?? 1;
  if (cleanupFailed) {
    if (status !== 0) {
      throwAggregateFailure(
        new Error(`Jest child exited with status ${status}.`),
        cleanupFailure,
        'Jest child execution and temporary cleanup both failed.',
      );
    }
    throw cleanupFailure;
  }

  return status;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (invokedPath === import.meta.url) {
  process.exitCode = runJest(process.argv.slice(2));
}
