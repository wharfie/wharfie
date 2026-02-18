import { createRequire } from 'node:module';
import { loadApp } from '../../app/load-app.js';
const require = createRequire(import.meta.url);

const { Command } = require('commander');
const { displayFailure } = require('../../output/basic');

// Usage:
//   wharfie app manifest                # pretty JSON (default)
//   wharfie app manifest --no-pretty    # compact JSON
//   wharfie app manifest ./path/to/app  # explicit app directory

/**
 * @param {string} dir - App directory.
 * @param {{ json?: boolean, pretty?: boolean }} options - options.
 */
async function printManifest(dir, options) {
  const { manifest } = await loadApp({ dir });

  // Default to pretty JSON.
  const pretty = options.pretty !== false;
  const output = pretty
    ? JSON.stringify(manifest, null, 2)
    : JSON.stringify(manifest);

  process.stdout.write(`${output}\n`);
}

const manifestCommand = new Command('manifest')
  .description('Print the compiled manifest from wharfie.app.js')
  .argument('[dir]', 'Directory containing wharfie.app.js (default: cwd)')
  .option('--json', 'Output JSON (default)')
  .option('--no-pretty', 'Disable pretty JSON output')
  .action(async (dir, options) => {
    const resolvedDir = dir || process.cwd();
    try {
      await printManifest(resolvedDir, options);
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

module.exports = manifestCommand;
