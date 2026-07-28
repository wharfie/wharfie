import path from 'node:path';

import { checkFileStability } from './file-stability.js';

const USAGE = 'Usage: steady-file <file>';

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
  if (args.length !== 1 || !args[0]) {
    throw new TypeError(USAGE);
  }

  const result = await checkFileStability(path.resolve(args[0]));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.stable) process.exitCode = 2;
}
