import { Command } from 'commander';

import { stringifyAppManifest } from '../../../core/runtime/app-manifest.js';
import { loadAppForCommand } from '../../app/local-app.js';
import { displayFailure } from '../../output/basic.js';

/**
 * @param {string | undefined} dir - App directory.
 * @param {{ json?: boolean, pretty?: boolean }} options - options.
 */
async function printManifest(dir, options) {
  const { manifest } = await loadAppForCommand({
    dir,
    allowEmbedded: typeof dir !== 'string' || !dir.trim(),
  });

  const output = stringifyAppManifest(manifest, {
    pretty: options.pretty,
  });

  process.stdout.write(`${output}\n`);
}

/**
 * Build one source application-manifest command. Commander commands retain
 * mutable parent and parse state, so every program tree must own a fresh leaf.
 * @returns {Command} - Fresh manifest command.
 */
export function createSourceAppManifestCommand() {
  return new Command('manifest')
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
}
