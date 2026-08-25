/* eslint-disable jsdoc/valid-types -- The current JSDoc parser does not understand object method signatures. */

import { spawn as nodeSpawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';

export const BOUNDED_PROCESS_MAX_ARGUMENTS = 256;
export const BOUNDED_PROCESS_MAX_ARGUMENT_BYTES = 64 * 1024;

/**
 * @param {unknown} value - Candidate nonnegative byte bound.
 * @param {string} valuePath - Human-readable value path.
 * @returns {number} - Validated bound.
 */
function validateBound(value, valuePath) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${valuePath} must be a nonnegative safe integer.`);
  }
  return value;
}

/**
 * Validate exact argv without ever rendering argument contents into errors.
 * @param {unknown} value - Candidate argv.
 * @returns {string[]} - Independent argv.
 */
function validateArguments(value) {
  if (!Array.isArray(value) || value.length > BOUNDED_PROCESS_MAX_ARGUMENTS) {
    throw new TypeError(
      `boundedProcess.args must contain at most ${BOUNDED_PROCESS_MAX_ARGUMENTS} strings.`,
    );
  }
  let bytes = 0;
  const args = value.map((argument, index) => {
    if (
      typeof argument !== 'string' ||
      argument.includes('\0') ||
      Buffer.byteLength(argument, 'utf8') > BOUNDED_PROCESS_MAX_ARGUMENT_BYTES
    ) {
      throw new TypeError(
        `boundedProcess.args[${index}] must be a bounded string without NUL.`,
      );
    }
    bytes += Buffer.byteLength(argument, 'utf8');
    return argument;
  });
  if (bytes > BOUNDED_PROCESS_MAX_ARGUMENT_BYTES) {
    throw new TypeError(
      `boundedProcess.args must not exceed ${BOUNDED_PROCESS_MAX_ARGUMENT_BYTES} UTF-8 bytes.`,
    );
  }
  return args;
}

/**
 * Validate an explicit subprocess environment. No ambient values are merged.
 * @param {unknown} value - Candidate environment.
 * @returns {Record<string, string>} - Independent environment.
 */
function validateEnvironment(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(
      'boundedProcess.environment must be an explicit plain object.',
    );
  }
  /** @type {Record<string, string>} */
  const environment = Object.create(null);
  for (const [name, setting] of Object.entries(value)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      typeof setting !== 'string' ||
      name.includes('\0') ||
      setting.includes('\0')
    ) {
      throw new TypeError(
        'boundedProcess.environment must contain only canonical string entries without NUL.',
      );
    }
    environment[name] = setting;
  }
  return environment;
}

/**
 * Validate supported stdin without reading or cloning held bytes.
 * @param {unknown} value - Candidate standard input.
 * @returns {Buffer|Readable|null} - Supported input.
 */
function validateInput(value) {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Readable) return value;
  throw new TypeError(
    'boundedProcess.stdin must be a Buffer, Uint8Array, Readable, or null.',
  );
}

/**
 * @typedef BoundedProcessOutcome
 * @property {'exited'|'ambiguous'} status - Whether a finite process exit was observed without local truncation or timeout.
 * @property {number|null} exitCode - Exact process exit code when available.
 * @property {string|null} signal - Exact terminating signal when available.
 * @property {boolean} timedOut - Whether the local deadline fired.
 * @property {Buffer} stdout - Bounded standard output prefix.
 * @property {Buffer} stderr - Bounded standard error prefix.
 */

/**
 * Create one shell-free subprocess boundary with finite output and duration.
 * @param {{spawn?: typeof nodeSpawn, setTimeout?: typeof globalThis.setTimeout, clearTimeout?: typeof globalThis.clearTimeout}} [dependencies] - Injectable process primitives.
 * @returns {{run(options: unknown): Promise<BoundedProcessOutcome>}} - Process runner.
 */
export function createBoundedProcessRunner(dependencies = {}) {
  const spawn = dependencies.spawn || nodeSpawn;
  const setTimer = dependencies.setTimeout || globalThis.setTimeout;
  const clearTimer = dependencies.clearTimeout || globalThis.clearTimeout;

  return Object.freeze({
    /**
     * @param {unknown} options - Exact process request.
     * @returns {Promise<BoundedProcessOutcome>} - Finite bounded outcome.
     */
    async run(options) {
      if (
        options === null ||
        typeof options !== 'object' ||
        Array.isArray(options)
      ) {
        throw new TypeError('boundedProcess must be an object.');
      }
      const input = /** @type {Record<string, any>} */ (options);
      const expectedKeys = new Set([
        'file',
        'args',
        'stdin',
        'environment',
        'timeoutMilliseconds',
        'maximumStdoutBytes',
        'maximumStderrBytes',
      ]);
      for (const key of Object.keys(input)) {
        if (!expectedKeys.has(key)) {
          throw new TypeError(`boundedProcess.${key} is not supported.`);
        }
      }
      for (const key of expectedKeys) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) {
          throw new TypeError(`boundedProcess.${key} is required.`);
        }
      }
      if (
        typeof input.file !== 'string' ||
        !isAbsolute(input.file) ||
        input.file.includes('\0')
      ) {
        throw new TypeError(
          'boundedProcess.file must be a canonical absolute executable path.',
        );
      }
      const args = validateArguments(input.args);
      const stdin = validateInput(input.stdin);
      const environment = validateEnvironment(input.environment);
      const timeoutMilliseconds = validateBound(
        input.timeoutMilliseconds,
        'boundedProcess.timeoutMilliseconds',
      );
      if (timeoutMilliseconds === 0) {
        throw new TypeError(
          'boundedProcess.timeoutMilliseconds must be greater than zero.',
        );
      }
      const maximumStdoutBytes = validateBound(
        input.maximumStdoutBytes,
        'boundedProcess.maximumStdoutBytes',
      );
      const maximumStderrBytes = validateBound(
        input.maximumStderrBytes,
        'boundedProcess.maximumStderrBytes',
      );

      return await new Promise((resolve) => {
        /** @type {Buffer[]} */
        const stdout = [];
        /** @type {Buffer[]} */
        const stderr = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let ambiguous = false;
        let timedOut = false;
        let settled = false;
        /** @type {import('node:child_process').ChildProcessWithoutNullStreams | undefined} */
        let child;

        /**
         * Preserve only the configured prefix and stop the process on overflow.
         * @param {any} chunk - Process output chunk.
         * @param {Buffer[]} target - Output buffers.
         * @param {'stdout'|'stderr'} streamName - Output stream.
         */
        const collect = (chunk, target, streamName) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const used = streamName === 'stdout' ? stdoutBytes : stderrBytes;
          const maximum =
            streamName === 'stdout' ? maximumStdoutBytes : maximumStderrBytes;
          const remaining = Math.max(0, maximum - used);
          if (remaining > 0) target.push(bytes.subarray(0, remaining));
          const nextUsed = used + Math.min(bytes.byteLength, remaining);
          if (streamName === 'stdout') stdoutBytes = nextUsed;
          else stderrBytes = nextUsed;
          if (bytes.byteLength > remaining) {
            ambiguous = true;
            child?.kill('SIGKILL');
          }
        };

        try {
          child = spawn(input.file, args, {
            env: environment,
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          });
        } catch {
          resolve({
            status: 'ambiguous',
            exitCode: null,
            signal: null,
            timedOut: false,
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
          });
          return;
        }

        const timer = setTimer(() => {
          timedOut = true;
          ambiguous = true;
          child?.kill('SIGKILL');
        }, timeoutMilliseconds);
        timer.unref?.();

        child.stdout.on('data', (chunk) => collect(chunk, stdout, 'stdout'));
        child.stderr.on('data', (chunk) => collect(chunk, stderr, 'stderr'));
        child.once('error', () => {
          ambiguous = true;
        });
        child.once('close', (exitCode, signal) => {
          if (settled) return;
          settled = true;
          clearTimer(timer);
          resolve({
            status: ambiguous ? 'ambiguous' : 'exited',
            exitCode,
            signal,
            timedOut,
            stdout: Buffer.concat(stdout, stdoutBytes),
            stderr: Buffer.concat(stderr, stderrBytes),
          });
        });

        child.stdin.once('error', (error) => {
          if (
            /** @type {NodeJS.ErrnoException} */ (error).code !== 'EPIPE' &&
            !settled
          ) {
            ambiguous = true;
            child?.kill('SIGKILL');
          }
        });
        if (stdin === null) {
          child.stdin.end();
        } else if (Buffer.isBuffer(stdin)) {
          child.stdin.end(stdin);
        } else {
          stdin.once('error', () => {
            if (!settled) {
              ambiguous = true;
              child?.kill('SIGKILL');
            }
          });
          stdin.pipe(child.stdin);
        }
      });
    },
  });
}

export default {
  BOUNDED_PROCESS_MAX_ARGUMENT_BYTES,
  BOUNDED_PROCESS_MAX_ARGUMENTS,
  createBoundedProcessRunner,
};
