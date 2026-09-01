import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_MESSAGES = 128;
const MESSAGE_TIMEOUT_MS = 5_000;
const EXIT_TIMEOUT_MS = 2_000;

/** @typedef {{code: number | null, signal: NodeJS.Signals | null}} ChildExit */
/** @typedef {{child: import('node:child_process').ChildProcess, done: Promise<ChildExit>, exit?: ChildExit, spawnError?: Error, messages: Record<string, any>[], stdout: string, stderr: string}} CrashChild */

/**
 * Spawn one Node fixture with JSON argv and IPC diagnostics.
 * @param {{childPath: string, options: unknown, cwd: string}} input
 * @returns {CrashChild}
 */
export function spawnCrashChild(input) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { NODE_ENV: 'test', TZ: process.env.TZ || 'UTC' };
  for (const key of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  const child = spawn(
    process.execPath,
    [input.childPath, JSON.stringify(input.options)],
    {
      cwd: input.cwd,
      // Do not let NODE_OPTIONS, NODE_PATH, cloud credentials, or repository
      // routing variables change the crash fixture's process boundary.
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  /** @type {(exit: ChildExit) => void} */
  let resolveExit = () => {};
  /** @type {CrashChild} */
  const handle = {
    child,
    done: new Promise((resolve) => {
      resolveExit = resolve;
    }),
    messages: [],
    stdout: '',
    stderr: '',
  };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    handle.stdout += chunk;
    if (Buffer.byteLength(handle.stdout, 'utf8') > MAX_OUTPUT_BYTES) {
      handle.spawnError ??= new Error('Crash child stdout exceeded its bound.');
      handle.child.kill('SIGKILL');
    }
  });
  child.stderr?.on('data', (chunk) => {
    handle.stderr += chunk;
    if (Buffer.byteLength(handle.stderr, 'utf8') > MAX_OUTPUT_BYTES) {
      handle.spawnError ??= new Error('Crash child stderr exceeded its bound.');
      handle.child.kill('SIGKILL');
    }
  });
  child.on('message', (message) => {
    if (!message || typeof message !== 'object') return;
    if (handle.messages.length >= MAX_MESSAGES) {
      handle.spawnError ??= new Error('Crash child IPC exceeded its bound.');
      handle.child.kill('SIGKILL');
      return;
    }
    handle.messages.push(message);
  });
  child.once('error', (error) => {
    handle.spawnError = error;
  });
  // `close` observes shutdown of stdio and IPC in addition to process exit.
  child.once('close', (code, signal) => {
    handle.exit = { code, signal };
    resolveExit(handle.exit);
  });
  return handle;
}

/** @param {CrashChild} handle @param {string} label */
export function crashChildFailure(handle, label) {
  const fatal = handle.messages.find((message) => message.kind === 'fatal');
  return new Error(
    `${label}: ${handle.spawnError?.message || fatal?.error || JSON.stringify(handle.exit)} stdout=${handle.stdout} stderr=${handle.stderr}`,
  );
}

/** @param {CrashChild} handle @param {number} [timeoutMs] */
export async function waitForCrashChildExit(
  handle,
  timeoutMs = EXIT_TIMEOUT_MS,
) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      handle.done,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(crashChildFailure(handle, 'Child did not exit')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait for one child message within the crash matrix's explicit per-case
 * deadline.
 * @param {CrashChild} handle
 * @param {(message: Record<string, any>) => boolean} predicate
 * @param {string} label
 * @param {number} [timeoutMs]
 */
export async function waitForCrashChildMessage(
  handle,
  predicate,
  label,
  timeoutMs = MESSAGE_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = handle.messages.find(predicate);
    if (message) return message;
    if (
      handle.exit ||
      handle.spawnError ||
      handle.messages.some((candidate) => candidate.kind === 'fatal')
    ) {
      throw crashChildFailure(handle, `Child exited before ${label}`);
    }
    await delay(10);
  }
  throw crashChildFailure(handle, `Timed out waiting for ${label}`);
}

/** @param {CrashChild} handle @param {NodeJS.Signals} [signal] */
export async function killCrashChild(handle, signal = 'SIGKILL') {
  if (!handle.exit) handle.child.kill(signal);
  return await waitForCrashChildExit(handle);
}

/** @param {CrashChild} handle */
export async function cleanupCrashChild(handle) {
  if (handle.exit) return handle.exit;
  handle.child.kill('SIGKILL');
  return await waitForCrashChildExit(handle);
}
