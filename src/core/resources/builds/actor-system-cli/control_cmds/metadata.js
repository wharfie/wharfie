import { Command } from 'commander';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';

import { ARTIFACT_ID_PREFIX } from '../../../../runtime/artifact-record.js';
import { sortCanonicalJsonValue } from '../../../../runtime/canonical-order.js';
import { readEmbeddedRevisionRuntimePair } from '../../lib/revision-runtime-assets.js';

/**
 * Stream-hash one artifact through a single opened file handle. Comparing the
 * same handle's stat before and after prevents reporting a size that differs
 * from the byte sequence consumed by the hash.
 * @param {string} artifactPath - Executable path.
 * @returns {Promise<{ artifactId: string, byteDigest: { algorithm: 'sha256', value: string }, size: number }>} - Exact byte observation.
 */
async function inspectArtifactBytes(artifactPath) {
  const artifactFile = await fsp.open(artifactPath, 'r');
  try {
    const before = await artifactFile.stat();
    const hash = createHash('sha256');
    let streamedSize = 0;
    const stream = artifactFile.createReadStream({
      autoClose: false,
      start: 0,
    });
    for await (const chunk of stream) {
      hash.update(chunk);
      streamedSize += chunk.length;
    }
    const after = await artifactFile.stat();
    if (
      streamedSize !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new Error('Artifact bytes changed while metadata was being read.');
    }

    const digest = hash.digest('base64url');
    return {
      artifactId: `${ARTIFACT_ID_PREFIX}_${digest}`,
      byteDigest: { algorithm: 'sha256', value: digest },
      size: streamedSize,
    };
  } finally {
    await artifactFile.close();
  }
}

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
    io.artifactPath || process.execPath,
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
