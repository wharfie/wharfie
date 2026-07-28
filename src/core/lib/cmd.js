import { spawn, execFile as _execFile, spawnSync } from 'node:child_process';

/**
 * @typedef RunCmdOptions
 * @property {number[]} [sensitiveArgIndexes] - Argument positions to redact from rendered errors.
 */

/**
 * Render a command for diagnostics without exposing marked argument values.
 * @param {string} cmd - The command to execute.
 * @param {string[]} args - Arguments for the command.
 * @param {RunCmdOptions} [options] - Rendering options.
 * @returns {string} - Safe command rendering.
 */
function formatCommandForError(cmd, args, options = {}) {
  const sensitiveArgIndexes = new Set(options.sensitiveArgIndexes || []);
  return [
    cmd,
    ...args.map((arg, index) =>
      sensitiveArgIndexes.has(index) ? '[REDACTED]' : arg,
    ),
  ].join(' ');
}

/**
 * Run a shell command and throw on error.
 * @param {string} cmd - The command to execute.
 * @param {string[]} args - Arguments for the command.
 * @param {RunCmdOptions} [options] - Command options.
 * @returns {Promise<void>} - Result.
 */
async function runCmd(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    /** @type {import('node:child_process').ChildProcess} */
    let proc;
    try {
      proc = spawn(cmd, args, {
        // Build tools are diagnostics. Keep their stdout away from the parent
        // command's machine-readable stdout protocol.
        stdio: ['inherit', process.stderr, process.stderr],
      });
    } catch (err) {
      const errorCode =
        err && typeof err === 'object' && 'code' in err ? ` (${err.code})` : '';
      reject(
        new Error(
          `Command failed to start: ${formatCommandForError(cmd, args, options)}${errorCode}`,
        ),
      );
      return;
    }
    proc.on('exit', (code, signal) => {
      if (code !== null) {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `Command failed: ${formatCommandForError(cmd, args, options)}, exit code ${code}`,
            ),
          );
      } else {
        reject(new Error(`Command terminated with signal ${signal}`));
      }
    });

    proc.on('error', (err) => {
      const errorCode =
        err && typeof err === 'object' && 'code' in err ? ` (${err.code})` : '';
      reject(
        new Error(
          `Command failed to start: ${formatCommandForError(cmd, args, options)}${errorCode}`,
        ),
      );
    });
  });
}

/**
 * Run a command and capture its output.
 * @param {string} filepath - The command to execute.
 * @param {string[]} [args] - Arguments for the command.
 * @param {import('node:child_process').ExecFileOptions} [options] - Process options.
 * @returns {Promise<{ stdout: string, stderr: string }>} - Captured output.
 */
async function execFileOutput(filepath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    _execFile(filepath, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * Run a shell command and throw on error.
 * @param {string} filepath - The command to execute.
 * @param {string[]} [args] - Arguments for the command.
 * @param {import('node:child_process').ExecFileOptions} [options] - Arguments for the command.
 * @param {boolean} silent - If true, don't print output.
 * @returns {Promise<void>} - Result.
 */
async function execFile(filepath, args = [], options = {}, silent = false) {
  return new Promise((resolve, reject) => {
    const proc = _execFile(filepath, args, options, (error, stdout, stderr) => {
      if (error) {
        console.error('Error:', error);
        console.error('stderr:', stderr);
        return;
      }
      if (silent) return;
      console.log('stdout:', stdout);
    });
    proc.on('exit', (code, signal) => {
      if (code !== null) {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `Command failed: ${filepath} ${args.join(' ')}, exit code ${code}`,
            ),
          );
      } else {
        reject(new Error(`Command terminated with signal ${signal}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export { runCmd, execFile, execFileOutput, spawnSync, formatCommandForError };
