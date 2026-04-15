import { Command } from 'commander';

import { packageLocalApp, stringifyJson } from '../../app/local-app.js';
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
 * @param {string} dir - dir.
 * @param {{ outputDir?: string, pretty?: boolean, target?: string[] }} options - options.
 */
async function packageApp(dir, options) {
  const result = await packageLocalApp({
    dir,
    outputDir: options.outputDir,
    targetFilters: Array.isArray(options.target) ? options.target : [],
  });

  process.stdout.write(`${stringifyJson(result, options)}\n`);
}

const packageCommand = new Command('package')
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
      await packageApp(resolvedDir, options);
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default packageCommand;
