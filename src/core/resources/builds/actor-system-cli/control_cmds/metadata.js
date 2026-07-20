import { Command } from 'commander';

import { sortCanonicalJsonValue } from '../../../../runtime/canonical-order.js';
import {
  getRunningExecutablePath,
  inspectArtifactBytes,
} from '../../../../runtime/packaged-artifact.js';
import { readEmbeddedRevisionRuntimePair } from '../../lib/revision-runtime-assets.js';

/**
 * Print immutable embedded metadata plus an observation of the exact executable
 * bytes running this command. Artifact provenance is deliberately not inferred
 * from those bytes.
 * @param {{ pretty?: boolean }} options - Output options.
 * @param {{ write?: (text: string) => void, assetProvider?: import('../../lib/revision-runtime-assets.js').EmbeddedRevisionRuntimeAssetProvider, artifactPath?: string }} [io] - Injected test I/O. `artifactPath` is intentionally not a CLI option.
 * @returns {Promise<void>} - Resolves after writing canonical JSON.
 */
export async function printEmbeddedMetadata(options, io = {}) {
  const pair = await readEmbeddedRevisionRuntimePair({
    assetProvider: io.assetProvider,
  });
  const artifact = await inspectArtifactBytes(
    io.artifactPath || getRunningExecutablePath(),
  );
  const metadata = sortCanonicalJsonValue({
    revision: pair.revision,
    runtime: pair.runtime,
    artifact,
  });
  const output =
    options.pretty === false
      ? JSON.stringify(metadata)
      : JSON.stringify(metadata, null, 2);

  /** @type {(text: string) => void} */
  const write =
    typeof io.write === 'function'
      ? io.write
      : /** @param {string} text - Output text. */ (text) => {
          process.stdout.write(text);
        };
  write(`${output}\n`);
}

const metadataCmd = new Command('metadata')
  .description(
    'Print the packaged revision, runtime target, and exact artifact-byte identity',
  )
  .option('--json', 'Output JSON (default)')
  .option('--no-pretty', 'Disable pretty JSON output')
  .action(async (options) => {
    try {
      await printEmbeddedMetadata(options);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error || 'Unknown error');
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    }
  });

export default metadataCmd;
