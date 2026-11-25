import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
 * @property {string} [sample] - File name of a sample taken of the stuck process before a timeout killed it.
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
 * @param {{sample?: string}} [extra] - File name of a sample taken before a timeout kill.
 * @returns {Error} - The original error.
 */
export function recordCommandFailure(error, executable, result, extra = {}) {
  const name = path.basename(executable).replace(/\.(cmd|exe)$/, '');
  commandFailures.set(error, {
    command: COMMANDS.has(name) ? name : 'packaged-app',
    status: result.status ?? null,
    signal: result.signal ?? null,
    ...(extra.sample ? { sample: extra.sample } : {}),
  });
  return error;
}

const SAMPLE_NAME = /^command-sample-[0-9a-f-]{36}\.txt$/;
const MAX_SAMPLES = 10;
/** How long before a bounded command's deadline its children are sampled. */
const SAMPLE_LEAD_MS = 6_000;
// Runs detached beside a bounded command: shortly before the deadline it
// records every child of the waiting process (and their children) with a
// stack sample: `sample` on macOS, per-thread state, wchan and kernel stack
// (where readable) on Linux. Samples run in parallel, so the command is still
// alive while they run; the kill comes afterwards.
const SAMPLER_SCRIPT = `
parent=$1; delay=$2; out=$3; self=$$
sleep "$delay"
{
  echo "sampled $(date -u +%Y-%m-%dT%H:%M:%SZ), $delay s into a bounded command of pid $parent"
  for pid in $(pgrep -P "$parent"); do
    [ "$pid" = "$self" ] && continue
    echo "=== pid $pid"
    ps -o pid=,ppid=,stat=,etime=,wchan=,command= -p "$pid"
    for child in $(pgrep -P "$pid"); do ps -o pid=,ppid=,stat=,etime=,command= -p "$child"; done
    if [ -x /usr/bin/sample ]; then
      /usr/bin/sample "$pid" 2 -file "$out.$pid" > /dev/null 2>&1 &
    else
      for task in /proc/$pid/task/*; do
        echo "-- task \${task##*/} $(cat "$task/comm" 2>/dev/null) state=$(awk '{print $3}' "$task/stat" 2>/dev/null) wchan=$(cat "$task/wchan" 2>/dev/null)"
        cat "$task/stack" 2>/dev/null
      done
    fi
  done
  wait
  for part in "$out".*; do
    [ -f "$part" ] || continue
    echo "=== sample of pid \${part##*.}"; head -n 800 "$part"; rm -f "$part"
  done
} > "$out" 2>&1
`;

/**
 * Sample a bounded command's children shortly before its deadline, so a
 * timeout leaves evidence of what the stuck process was doing. Call
 * `settle(timedOut)` once the command returns: on a timeout it waits for the
 * sample and returns its file name; otherwise it stops the sampler and
 * discards the file.
 * @param {number} timeoutMs - The command's deadline.
 * @param {{directory?: string}} [options] - Sample destination.
 * @returns {{settle: (timedOut: boolean) => string | undefined} | undefined} - Sampler, or undefined when the deadline is too short or sampling is unavailable.
 */
export function startTimeoutSampler(timeoutMs, options = {}) {
  if (process.platform === 'win32' || timeoutMs < 2 * SAMPLE_LEAD_MS) {
    return undefined;
  }
  try {
    const directory =
      options.directory ?? path.join(DEFAULT_DIRECTORY, 'samples');
    // Staged privately; only a timeout moves it into the reports directory.
    const staging = mkdtempSync(path.join(tmpdir(), 'wharfie-command-sample-'));
    const name = `command-sample-${randomUUID()}.txt`;
    const file = path.join(staging, name);
    const sampler = spawn(
      '/bin/sh',
      [
        '-c',
        SAMPLER_SCRIPT,
        'wharfie-timeout-sampler',
        String(process.pid),
        String((timeoutMs - SAMPLE_LEAD_MS) / 1000),
        file,
      ],
      { detached: true, stdio: 'ignore' },
    );
    sampler.unref();
    return {
      settle: (timedOut) => {
        // A diagnostic never replaces the command's own failure.
        try {
          if (!timedOut) {
            try {
              if (sampler.pid) process.kill(-sampler.pid, 'SIGKILL');
            } catch {}
            rmSync(staging, { recursive: true, force: true });
            return undefined;
          }
          // The sampler started before the kill; give it a bounded while to
          // finish writing.
          spawnSync(
            '/bin/sh',
            [
              '-c',
              'i=0; while kill -0 "$1" 2>/dev/null && [ $i -lt 150 ]; do sleep 0.1; i=$((i+1)); done',
              'wait-for-sampler',
              String(sampler.pid),
            ],
            { stdio: 'ignore', timeout: 20_000 },
          );
          ensureRealDirectory(path.dirname(path.dirname(directory)));
          ensureRealDirectory(path.dirname(directory));
          ensureRealDirectory(directory);
          copyFileSync(
            file,
            path.join(directory, name),
            constants.COPYFILE_EXCL,
          );
          rmSync(staging, { recursive: true, force: true });
          const samples = readdirSync(directory)
            .filter((entry) => SAMPLE_NAME.test(entry))
            .map((entry) => ({
              entry,
              modified: lstatSync(path.join(directory, entry)).mtimeMs,
            }))
            .sort((left, right) => left.modified - right.modified);
          for (const old of samples.slice(
            0,
            Math.max(0, samples.length - MAX_SAMPLES),
          )) {
            unlinkSync(path.join(directory, old.entry));
          }
          return name;
        } catch {
          rmSync(staging, { recursive: true, force: true });
          return undefined;
        }
      },
    };
  } catch {
    return undefined;
  }
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
 * @property {string} [sample] - File name of a timeout sample in samples/.
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
      ...(typeof input.sample === 'string' && SAMPLE_NAME.test(input.sample)
        ? { sample: `samples/${input.sample}` }
        : {}),
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
