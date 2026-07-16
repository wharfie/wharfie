import { isSea } from './core/lib/node-sea.js';
import { readEmbeddedAppManifest } from './core/resources/builds/lib/app-manifest-asset.js';
import { invokeManifestActivity } from './core/runtime/app-runs.js';

const SOURCE_APP_LOADER_PATH = './cli/app/load-app.js';

/**
 * Preserve a manifest's literal TypeScript shape while checking it against the
 * public Wharfie application contract.
 * @template T
 * @param {T} definition - Application definition.
 * @returns {T} - The unchanged application definition.
 */
export function defineApp(definition) {
  return definition;
}

/**
 * Resolve the immutable embedded revision inside a SEA and the source manifest
 * everywhere else. Keeping the source loader behind a variable dynamic import
 * prevents packaging-only dependencies from entering the generated runtime's
 * eager module graph.
 * @param {string | undefined} dir - Source application directory.
 * @returns {Promise<{ manifest: any, appDir?: string, executionMode: 'source' | 'embedded' }>} - Loaded runtime manifest.
 */
async function loadRuntimeManifest(dir) {
  if (isSea()) {
    const manifest = await readEmbeddedAppManifest();
    return {
      manifest,
      executionMode: 'embedded',
    };
  }

  const { loadApp } = await import(SOURCE_APP_LOADER_PATH);
  const loaded = await loadApp({ dir });
  return {
    manifest: loaded.manifest,
    appDir: loaded.appDir,
    executionMode: 'source',
  };
}

/**
 * Invoke a named Wharfie activity through one API in source and packaged
 * execution. Inside a SEA the immutable embedded revision wins; from source,
 * Wharfie loads `wharfie.app.js` from `dir` or the current working directory.
 * Inputs must be JSON-serializable because activities are durable boundaries.
 * @param {string} activityName - Declared activity name.
 * @param {object} [options] - Invocation options.
 * @param {any} [options.event] - JSON-serializable activity event.
 * @param {Record<string, any>} [options.context] - JSON-serializable activity context.
 * @param {string} [options.dir] - Source app directory; ignored inside a SEA.
 * @returns {Promise<any>} - Activity result.
 */
export async function invokeActivity(activityName, options = {}) {
  const loaded = await loadRuntimeManifest(options.dir);
  return await invokeManifestActivity({
    manifest: loaded.manifest,
    appDir: loaded.appDir,
    activityName,
    ...(Object.prototype.hasOwnProperty.call(options, 'event')
      ? { event: options.event }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'context')
      ? { context: options.context }
      : {}),
    executionMode: loaded.executionMode,
  });
}

export default { defineApp, invokeActivity };
