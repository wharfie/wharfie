import { Command } from 'commander';

import { loadApp } from '../../app/load-app.js';
import { displayFailure } from '../../output/basic.js';

/**
 * @param {string} dir - App directory.
 * @param {{ json?: boolean, pretty?: boolean }} options - options.
 */
async function printManifest(dir, options) {
  const { publicManifest } = await loadApp({ dir });

  const pretty = options.pretty !== false;
  const output = pretty
    ? JSON.stringify(publicManifest, null, 2)
    : JSON.stringify(publicManifest);

  process.stdout.write(`${output}\n`);
}

const manifestCommand = new Command('manifest')
  .description('Print the public manifest from wharfie.app.js')
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

export default manifestCommand;
