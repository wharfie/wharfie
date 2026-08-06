import { readEmbeddedRevisionRuntimePair } from '../resources/builds/lib/revision-runtime-assets.js';
import {
  LOCAL_APP_DATA_ROOT_ENVIRONMENT_VARIABLE,
  createLocalAppStorageLayout,
  resolveStableLocalAppDataRoot,
} from './local-app-storage.js';

export const LEGACY_PACKAGED_STORAGE_ENVIRONMENT_VARIABLES = Object.freeze([
  'WHARFIE_APPLICATION_STATE_ADAPTER',
  'WHARFIE_APPLICATION_STATE_PATH',
  'WHARFIE_CONTROL_ADAPTER',
  'WHARFIE_CONTROL_PATH',
  'WHARFIE_DB_ADAPTER',
  'WHARFIE_DB_PATH',
  'WHARFIE_EXECUTION_LEDGER_TABLE',
  'WHARFIE_EXECUTION_PAYLOAD_PATH',
  'WHARFIE_EXECUTION_PAYLOAD_STORE_ID',
  'WHARFIE_LEDGER_SERVICE_SESSION_PATH',
  'WHARFIE_STATE_ADAPTER',
  'WHARFIE_STATE_DB_PATH',
]);

/**
 * A single packaged data root and legacy per-store routing are mutually
 * exclusive. Reject the combination before installing storage context so no
 * packaged command can silently address a split layout.
 * @param {Record<string, string | undefined>} environment - Packaged process environment.
 * @returns {void} - Returns when storage routing is unambiguous.
 */
function assertNoLegacyPackagedStorageOverrides(environment) {
  const conflictingNames = LEGACY_PACKAGED_STORAGE_ENVIRONMENT_VARIABLES.filter(
    (name) => environment[name] !== undefined,
  );
  if (conflictingNames.length === 0) return;
  throw new TypeError(
    `Legacy Wharfie storage overrides are not supported for packaged apps: ${conflictingNames.join(', ')}. Unset those variables; packaged storage is derived only from ${LOCAL_APP_DATA_ROOT_ENVIRONMENT_VARIABLE} or the stable account default.`,
  );
}

/**
 * Resolve app-scoped storage before any packaged developer, operator, or
 * hidden-runtime entrypoint executes. The caller installs the returned
 * immutable layout as async bootstrap context, avoiding process-environment
 * mutation. The default data root is derived from the operating-system account
 * rather than invocation-specific XDG or shell-home variables.
 * @param {{dataRoot?: string, environment?: Record<string, string | undefined>, platform?: string, getHomeDirectory?: () => string, readEmbeddedRevisionRuntimePair?: () => Promise<any>}} [options] - Testable account, foreground environment, and embedded identity reader.
 * @returns {Promise<Readonly<Record<string, string>>>} - Canonical packaged layout.
 */
export async function resolvePackagedAppStorage(options = {}) {
  const environment = options.environment ?? process.env;
  const environmentDataRoot =
    environment[LOCAL_APP_DATA_ROOT_ENVIRONMENT_VARIABLE];
  assertNoLegacyPackagedStorageOverrides(environment);
  if (
    options.dataRoot !== undefined &&
    environmentDataRoot !== undefined &&
    options.dataRoot !== environmentDataRoot
  ) {
    throw new TypeError(
      `resolvePackagedAppStorage dataRoot must agree with active ${LOCAL_APP_DATA_ROOT_ENVIRONMENT_VARIABLE} packaged storage authority.`,
    );
  }
  const readPair =
    options.readEmbeddedRevisionRuntimePair || readEmbeddedRevisionRuntimePair;
  const pair = await readPair();
  return createLocalAppStorageLayout({
    appId: pair.runtime.appId,
    dataRoot:
      options.dataRoot ??
      environmentDataRoot ??
      resolveStableLocalAppDataRoot({
        platform: options.platform,
        homeDirectory: options.getHomeDirectory?.(),
      }),
  });
}

export default resolvePackagedAppStorage;
