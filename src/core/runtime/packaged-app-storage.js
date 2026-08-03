import { readEmbeddedRevisionRuntimePair } from '../resources/builds/lib/revision-runtime-assets.js';
import {
  createLocalAppStorageLayout,
  resolveStableLocalAppDataRoot,
} from './local-app-storage.js';

/**
 * Resolve app-scoped storage before any packaged developer, operator, or
 * hidden-runtime entrypoint executes. The caller installs the returned
 * immutable layout as async bootstrap context, avoiding process-environment
 * mutation. The default data root is derived from the operating-system account
 * rather than invocation-specific XDG or shell-home variables.
 * @param {{dataRoot?: string, platform?: string, getHomeDirectory?: () => string, readEmbeddedRevisionRuntimePair?: () => Promise<any>}} [options] - Testable account and embedded identity reader.
 * @returns {Promise<Readonly<Record<string, string>>>} - Canonical packaged layout.
 */
export async function resolvePackagedAppStorage(options = {}) {
  const readPair =
    options.readEmbeddedRevisionRuntimePair || readEmbeddedRevisionRuntimePair;
  const pair = await readPair();
  return createLocalAppStorageLayout({
    appId: pair.runtime.appId,
    dataRoot:
      options.dataRoot ??
      resolveStableLocalAppDataRoot({
        platform: options.platform,
        homeDirectory: options.getHomeDirectory?.(),
      }),
  });
}

export default resolvePackagedAppStorage;
