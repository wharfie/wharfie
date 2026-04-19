import { Command } from 'commander';

import { loadAppForCommand } from '../../app/local-app.js';
import { displayFailure } from '../../output/basic.js';

/**
 * @param {string | undefined} dir - App directory.
 * @param {{ json?: boolean, pretty?: boolean }} options - options.
 */
async function printManifest(dir, options) {
  const { publicManifest } = await loadAppForCommand({
    dir,
    allowEmbedded: typeof dir !== 'string' || !dir.trim(),
  });

  const pretty = options.pretty !== false;
  const output = pretty
    ? JSON.stringify(publicManifest, null, 2)
    : JSON.stringify(publicManifest);

  process.stdout.write(`${output}\n`);
}

const manifestCommand = new Command('manifest')
  .description(
    'Print the public manifest from wharfie.app.js or this SEA artifact',
  )
  .argument('[dir]', 'Directory containing wharfie.app.js (default: cwd)')
  .option('--json', 'Output JSON (default)')
  .option('--no-pretty', 'Disable pretty JSON output')
  .action(async (dir, options) => {
    try {
      await printManifest(dir, options);
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default manifestCommand;
