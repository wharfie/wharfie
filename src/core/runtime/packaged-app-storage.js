import paths from '../lib/paths.js';
import { readEmbeddedRevisionRuntimePair } from '../resources/builds/lib/revision-runtime-assets.js';
import { createLocalAppStorageLayout } from './local-app-storage.js';

/**
 * Resolve app-scoped storage before any packaged developer, operator, or
 * hidden-runtime entrypoint executes. The caller installs the returned
 * immutable layout as async bootstrap context, avoiding process-environment
 * mutation while preserving explicit environment overrides as an advanced
 * foreground configuration surface.
 * @param {{dataRoot?: string, readEmbeddedRevisionRuntimePair?: () => Promise<any>}} [options] - Testable root and embedded identity reader.
 * @returns {Promise<Readonly<Record<string, string>>>} - Canonical packaged layout.
 */
export async function resolvePackagedAppStorage(options = {}) {
  const readPair =
    options.readEmbeddedRevisionRuntimePair || readEmbeddedRevisionRuntimePair;
  const pair = await readPair();
  return createLocalAppStorageLayout({
    appId: pair.runtime.appId,
    dataRoot: options.dataRoot || paths.data,
  });
}

export default resolvePackagedAppStorage;
