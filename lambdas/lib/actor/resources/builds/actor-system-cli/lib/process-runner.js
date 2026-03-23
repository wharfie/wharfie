import { spawn } from 'node:child_process';
import { once } from 'node:events';

/**
 * @typedef RunProcessOptions
 * @property {string} [cwd] - cwd.
 * @property {Record<string, string>} [env] - env.
 * @property {boolean} [captureOutput] - captureOutput.
 * @property {boolean} [inheritStdio] - inheritStdio.
 */

/**
 * @param {string} command - command.
 * @param {string[]} args - args.
 * @param {RunProcessOptions} [options] - options.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} - Result.
 */
export async function runProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: options.inheritStdio
      ? 'inherit'
      : options.captureOutput !== false
        ? ['ignore', 'pipe', 'pipe']
        : 'inherit',
  });

  let stdout = '';
  let stderr = '';
  if (!options.inheritStdio && options.captureOutput !== false) {
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
  }

  const [code, signal] = /** @type {[number | null, string | null]} */ (
    await once(child, 'exit')
  );

  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with ${signal || code}: ${
        stderr || stdout || 'Unknown error'
      }`,
    );
  }

  return {
    code: code || 0,
    stdout,
    stderr,
  };
}

export default {
  runProcess,
};
