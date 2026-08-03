import { readEmbeddedAppManifest } from '../../lib/app-manifest-asset.js';
import { readEmbeddedRevisionRuntimePair } from '../../lib/revision-runtime-assets.js';

/**
 * Load the immutable manifest and revision/runtime identity embedded in this
 * packaged artifact. Public packaged commands deliberately have no source
 * directory override.
 * @returns {Promise<import('../../../../runtime/operator/durable-run-command.js').DurableRunExecutionHandle>} - Embedded execution handle.
 */
export async function loadEmbeddedDurableExecution() {
  const [manifest, embeddedRevision] = await Promise.all([
    readEmbeddedAppManifest(),
    readEmbeddedRevisionRuntimePair(),
  ]);
  return {
    execution: {
      kind: 'embedded',
      manifest,
      embeddedRevision,
    },
  };
}

export default loadEmbeddedDurableExecution;
