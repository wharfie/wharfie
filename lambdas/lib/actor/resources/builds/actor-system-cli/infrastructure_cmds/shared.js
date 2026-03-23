import { runProcess } from '../lib/process-runner.js';

/**
 * @typedef CommandIO
 * @property {(text: string) => void} [write] - write.
 * @property {(text: string) => void} [error] - error.
 */

/**
 * @param {CommandIO} [io] - io.
 * @returns {{ write: (text: string) => void, error: (text: string) => void }} - Result.
 */
export function createCommandIO(io = {}) {
  return {
    write:
      typeof io.write === 'function'
        ? io.write
        : /** @param {string} text - text. */ (text) => {
            process.stdout.write(text);
          },
    error:
      typeof io.error === 'function'
        ? io.error
        : /** @param {string} text - text. */ (text) => {
            process.stderr.write(text);
          },
  };
}

/**
 * @param {any} result - result.
 * @param {{ json?: boolean }} options - options.
 * @param {CommandIO} [io] - io.
 * @returns {void} - Result.
 */
export function writeCommandResult(result, options, io = {}) {
  const streams = createCommandIO(io);
  const output = options.json
    ? JSON.stringify(result, null, 2)
    : `${result.summary || JSON.stringify(result)}`;
  streams.write(`${output}\n`);
}

/**
 * @param {unknown} error - error.
 * @param {CommandIO} [io] - io.
 * @returns {never} - Result.
 */
export function failCommand(error, io = {}) {
  const streams = createCommandIO(io);
  const message =
    error instanceof Error ? error.message : String(error || 'Unknown error');
  streams.error(`${message}\n`);
  throw error;
}

/**
 * @typedef ShellLike
 * @property {(command: string, args: string[], options?: import('../lib/process-runner.js').RunProcessOptions) => Promise<{ code: number, stdout: string, stderr: string }>} run - run.
 */

/**
 * @param {ShellLike | undefined} shell - shell.
 * @returns {ShellLike} - Result.
 */
export function resolveShell(shell) {
  if (shell && typeof shell.run === 'function') {
    return shell;
  }

  return { run: runProcess };
}
