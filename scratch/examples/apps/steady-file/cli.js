import path from 'node:path';

import { checkFileStability } from './file-stability.js';

const USAGE = 'Usage: steady-file <file>';

/**
 * Parse the application-owned CLI arguments into workflow input.
 * @param {readonly string[]} args - Application arguments without Node argv.
 * @returns {{path: string}} - Absolute file input shared by both paths.
 */
function parseFileInput(args) {
  if (
    args.length !== 1 ||
    !args[0] ||
    args[0] === '--help' ||
    args[0] === '-h'
  ) {
    throw new TypeError(USAGE);
  }
  return { path: path.resolve(args[0]) };
}

/**
 * Project ordinary application arguments into durable workflow input.
 * @param {readonly string[]} args - Application arguments after `--`.
 * @returns {{path: string}} - JSON workflow input.
 */
export function toDurableInput(args) {
  return parseFileInput(args);
}

/**
 * Run the ordinary developer-owned CLI.
 * @param {string[]} [argv] - Node-style process arguments.
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv) {
  const args = argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const input = parseFileInput(args);
  const result = await checkFileStability(input.path);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.stable) process.exitCode = 2;
}
