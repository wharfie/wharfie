import { Command } from 'commander';

import { packageLocalApp, stringifyJson } from '../../app/local-app.js';
import { createApplicationPackageReceipt } from '../../app/package-command-receipt.js';
import { displayFailure } from '../../output/basic.js';

/**
 * @param {string} value - value.
 * @param {string[]} previous - previous.
 * @returns {string[]} - Result.
 */
function collectTargetFilter(value, previous) {
  return [...previous, value];
}

/**
 * @typedef {(chunk: string | Uint8Array, encoding?: NodeJS.BufferEncoding | (() => void), callback?: (() => void)) => boolean} StreamWrite
 */

/**
 * Reserve stdout for the package receipt while trusted manifest and build code
 * runs in-process. Diagnostics remain visible on stderr.
 * @template T
 * @param {() => Promise<T>} operation - Package operation.
 * @returns {Promise<T>} - Package result.
 */
async function withPackageStdoutReserved(operation) {
  const originalStdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  /** @type {StreamWrite} */
  const redirectedWrite = function redirectedWrite(chunk, encoding, callback) {
    /** @type {NodeJS.BufferEncoding | undefined} */
    const resolvedEncoding =
      typeof encoding === 'string' ? encoding : undefined;
    /** @type {(() => void) | undefined} */
    let resolvedCallback = typeof encoding === 'function' ? encoding : callback;
    if (typeof resolvedCallback !== 'function') resolvedCallback = undefined;

    const writer = /** @type {StreamWrite} */ (stderrWrite);
    return writer.call(
      process.stderr,
      chunk,
      resolvedEncoding,
      resolvedCallback,
    );
  };

  process.stdout.write = /** @type {typeof process.stdout.write} */ (
    redirectedWrite
  );
  try {
    return await operation();
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
}

/**
 * Create one fresh package command. Injection keeps command serialization
 * independently testable without constructing a native SEA.
 * @param {{
 *   packageApplication?: typeof packageLocalApp,
 *   writeOutput?: (value: string) => unknown
 * }} [dependencies] - Optional command adapters.
 * @returns {Command} - Fresh package command.
 */
export function createPackageCommand(dependencies = {}) {
  const packageApplication = dependencies.packageApplication || packageLocalApp;
  const writeOutput =
    dependencies.writeOutput ||
    ((value) => {
      process.stdout.write(value);
    });

  return new Command('package')
    .description('Package a Wharfie app into executable artifacts')
    .argument('[dir]', 'Directory containing wharfie.app.js (default: cwd)')
    .option(
      '--output-dir <dir>',
      'Directory to copy packaged artifacts into (default: <app dir>/dist)',
    )
    .option(
      '-t, --target <target>',
      'Package only the selected build target (repeatable)',
      collectTargetFilter,
      [],
    )
    .option('--json', 'Output JSON (default)')
    .option('--no-pretty', 'Disable pretty JSON output')
    .action(async (dir, options) => {
      const resolvedDir = dir || process.cwd();

      try {
        const receipt = await withPackageStdoutReserved(async () => {
          const result = await packageApplication({
            dir: resolvedDir,
            outputDir: options.outputDir,
            targetFilters: Array.isArray(options.target) ? options.target : [],
          });
          return createApplicationPackageReceipt(result);
        });
        writeOutput(`${stringifyJson(receipt, options)}\n`);
      } catch (err) {
        displayFailure(err);
        process.exitCode = 1;
      }
    });
}
