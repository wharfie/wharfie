import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
 * Run Jest with all runner-owned artifacts confined to a disposable root.
 *
 * @param {string[]} argv - Forwarded Jest arguments.
 * @param {JestRunnerDependencies} [dependencies] - Test seams.
 * @returns {number} Child exit status.
 */
export function runJest(argv, dependencies = {}) {
  const {
    spawn = spawnSync,
    createTempRoot = mkdtempSync,
    removeTempRoot = rmSync,
    getTempDirectory = os.tmpdir,
    kill = process.kill.bind(process),
    execPath = process.execPath,
    env = process.env,
    pid = process.pid,
  } = dependencies;

  const ownedRoot = createTempRoot(
    path.join(getTempDirectory(), 'wharfie-jest-'),
  );
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
    ownedArguments.push('--maxWorkers=4');
  }
  const separatorIndex = forwardedArgs.indexOf('--');
  forwardedArgs.splice(
    separatorIndex === -1 ? forwardedArgs.length : separatorIndex,
    0,
    ...ownedArguments,
  );

  /** @type {JestChildResult} */
  let result;
  try {
    result = spawn(
      execPath,
      [
        '--experimental-vm-modules',
        'node_modules/jest/bin/jest.js',
        ...forwardedArgs,
      ],
      {
        env,
        stdio: 'inherit',
      },
    );
  } finally {
    removeTempRoot(ownedRoot, { recursive: true, force: true });
  }

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    kill(pid, result.signal);
    return 1;
  }

  return result.status ?? 1;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (invokedPath === import.meta.url) {
  process.exitCode = runJest(process.argv.slice(2));
}
