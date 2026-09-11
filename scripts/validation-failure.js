import { randomUUID } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIRECTORY = fileURLToPath(
  new URL('../.wharfie/validation-failures/', import.meta.url),
);
const MAX_REPORTS = 10;
const MAX_BYTES = 2048;
const FORMAT = 'wharfie-validation-failure-v1';
const COMMANDS = new Set([
  'jest',
  'npm',
  'node',
  'wharfie',
  'packaged-app',
  'package-sea',
]);

/**
 * @typedef {object} CommandFailure
 * @property {string} command - Safe executable identifier, never its arguments.
 * @property {number | null} status - Child exit status.
 * @property {string | null} signal - Terminating signal.
 */

/** @type {WeakMap<object, CommandFailure>} */
const commandFailures = new WeakMap();

/**
 * Create one directory component without traversing a symlink at that component.
 * @param {string} directory - Directory whose parent already exists.
 * @returns {void} - Throws for a non-directory or symlink destination.
 */
function ensureRealDirectory(directory) {
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST')
      throw error;
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Report destination must be a real directory.');
  }
}

/**
 * Preserve child metadata without changing the original error or retaining
 * its command arguments, environment, output, or stack in a report.
 * @param {Error} error - Original command failure.
 * @param {string} executable - Executable path.
 * @param {{status?: number | null, signal?: string | null}} result - Child result.
 * @returns {Error} - The original error.
 */
export function recordCommandFailure(error, executable, result) {
  const name = path.basename(executable).replace(/\.(cmd|exe)$/, '');
  commandFailures.set(error, {
    command: COMMANDS.has(name) ? name : 'packaged-app',
    status: result.status ?? null,
    signal: result.signal ?? null,
  });
  return error;
}

/**
 * @param {unknown} error - Possible command failure.
 * @returns {CommandFailure | undefined} - Metadata recorded by the command runner.
 */
export function getCommandFailure(error) {
  return typeof error === 'object' && error !== null
    ? commandFailures.get(error)
    : undefined;
}

/**
 * @typedef {object} FailureDiagnostic
 * @property {'jest' | 'package-sea'} runner - Validation entry point.
 * @property {string} phase - Fixed internal phase label.
 * @property {string} command - Fixed executable or validation command identifier.
 * @property {number} durationMs - Total elapsed time.
 * @property {number | null} [status] - Child exit status, if known.
 * @property {string | null} [signal] - Child terminating signal, if known.
 */

/**
 * Retain only small reports produced by this helper. Unknown files,
 * directories, symlinks, and hard links are left untouched. Validation's
 * primary result always survives diagnostic I/O failures.
 * @param {FailureDiagnostic} input - Safe failure metadata.
 * @param {{directory?: string, log?: (message: string) => unknown}} [options] - Report destination and output seam.
 * @returns {string | undefined} - Retained report path, when successful.
 */
export function retainFailureDiagnostic(input, options = {}) {
  const directory = options.directory ?? DEFAULT_DIRECTORY;
  const log =
    options.log ?? ((message) => writeSync(process.stderr.fd, message));
  /** @type {string | undefined} */
  let ownedGuard;
  try {
    if (!['jest', 'package-sea'].includes(input.runner)) {
      throw new TypeError('Unknown validation runner.');
    }
    const report = {
      format: FORMAT,
      runner: input.runner,
      recordedAt: new Date().toISOString(),
      phase: /^[a-z][a-z0-9-]{0,63}$/.test(input.phase)
        ? input.phase
        : 'unknown',
      command: COMMANDS.has(input.command) ? input.command : 'unknown',
      durationMs: Number.isFinite(input.durationMs)
        ? Math.max(
            0,
            Math.min(Number.MAX_SAFE_INTEGER, Math.round(input.durationMs)),
          )
        : null,
      status:
        Number.isSafeInteger(input.status) && Math.abs(input.status ?? 0) <= 255
          ? input.status
          : null,
      signal:
        typeof input.signal === 'string' &&
        /^SIG[A-Z0-9]{1,12}$/.test(input.signal)
          ? input.signal
          : null,
    };
    const bytes = `${JSON.stringify(report, null, 2)}\n`;
    if (Buffer.byteLength(bytes) > MAX_BYTES)
      throw new Error('Report too large.');
    // The checkout is the trusted base. Check .wharfie before creating or
    // pruning anything beneath it; recursive mkdir would follow its symlink.
    ensureRealDirectory(path.dirname(directory));
    ensureRealDirectory(directory);
    const guard = path.join(directory, `.${input.runner}-report.lock`);
    mkdirSync(guard, { mode: 0o700 });
    ownedGuard = guard;
    const prefix = `${input.runner}-`;
    const reports = readdirSync(directory)
      .flatMap((name) => {
        if (
          !name.startsWith(prefix) ||
          !/^(jest|package-sea)-[0-9a-f-]{36}\.json$/.test(name)
        )
          return [];
        const file = path.join(directory, name);
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES)
          return [];
        try {
          const previous = JSON.parse(readFileSync(file, 'utf8'));
          return previous.format === FORMAT && previous.runner === input.runner
            ? [{ file, modified: stat.mtimeMs }]
            : [];
        } catch {
          return [];
        }
      })
      .sort((left, right) => left.modified - right.modified);
    // Prune before writing, so a failed removal never increases retained count.
    for (const report of reports.slice(
      0,
      Math.max(0, reports.length - MAX_REPORTS + 1),
    )) {
      unlinkSync(report.file);
    }
    const destination = path.join(directory, `${prefix}${randomUUID()}.json`);
    writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
    // A closed stderr must not turn a successfully retained diagnostic into a
    // failed validation or hide its original exit status/signal.
    try {
      log(`Validation failure report: ${destination}\n`);
    } catch {}
    return destination;
  } catch {
    try {
      log(
        'Could not retain validation failure report; original failure is unchanged.\n',
      );
    } catch {}
    return undefined;
  } finally {
    if (ownedGuard) {
      try {
        rmdirSync(ownedGuard);
      } catch {
        // Never recursively remove a guard or replace the validation failure.
      }
    }
  }
}
