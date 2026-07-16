import { Command } from 'commander';

import { assertManifestIsSecretFree } from '../../lib/manifest-security.js';
import { resolveAppManifest } from '../lib/app-manifest.js';

/**
 * @param {{ pretty?: boolean, manifestFile?: string, manifest_file?: string, manifest?: string }} options - options.
 * @param {{ write?: (text: string) => void, assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [io] - io.
 * @returns {Promise<void>} - Result.
 */
export async function printEmbeddedManifest(options, io = {}) {
  const manifest = await resolveAppManifest(options, {
    assetProvider: io.assetProvider,
  });
  if (!manifest) {
    throw new Error(
      'No app manifest was provided and no embedded app manifest was available.',
    );
  }
  assertManifestIsSecretFree(manifest);
  const pretty = options.pretty !== false;
  const output = pretty
    ? JSON.stringify(manifest, null, 2)
    : JSON.stringify(manifest);

  /** @type {(text: string) => void} */
  const write =
    typeof io.write === 'function'
      ? io.write
      : /** @param {string} text - text. */ (text) => {
          process.stdout.write(text);
        };
  write(`${output}\n`);
}

const manifestCmd = new Command('manifest')
  .description('Print the packaged Wharfie app manifest for this artifact')
  .option(
    '--manifest-file <path>',
    'JSON file containing the packaged app manifest',
  )
  .option('--manifest <json>', 'Inline JSON packaged app manifest')
  .option('--json', 'Output JSON (default)')
  .option('--no-pretty', 'Disable pretty JSON output')
  .action(async (options) => {
    try {
      await printEmbeddedManifest(options);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error || 'Unknown error');
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  });

export default manifestCmd;
