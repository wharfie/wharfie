import { isSea } from './core/lib/node-sea.js';
import { readEmbeddedAppManifest } from './core/resources/builds/lib/app-manifest-asset.js';
import { readEmbeddedRevisionRuntimePair } from './core/resources/builds/lib/revision-runtime-assets.js';
import { invokeManifestActivity } from './core/runtime/app-runs.js';

const SOURCE_APP_LOADER_PATH = './cli/app/load-app.js';
const SOURCE_REVISION_COMPILER_PATH =
  './cli/app/compile-application-revision.js';

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
 * @returns {Promise<{ execution: Record<string, any>, cleanup?: () => Promise<void> }>} - Loaded immutable runtime identity.
 */
async function loadRuntimeManifest(dir) {
  if (isSea()) {
    const [manifest, embeddedRevision] = await Promise.all([
      readEmbeddedAppManifest(),
      readEmbeddedRevisionRuntimePair(),
    ]);
    return {
      execution: { kind: 'embedded', manifest, embeddedRevision },
    };
  }

  const [{ loadApp }, { prepareApplicationRevision }] = await Promise.all([
    import(SOURCE_APP_LOADER_PATH),
    import(SOURCE_REVISION_COMPILER_PATH),
  ]);
  const loaded = await loadApp({ dir });
  const prepared = await prepareApplicationRevision({
    appDir: loaded.appDir,
    manifest: loaded.manifest,
  });
  return {
    execution: { kind: 'prepared-source', prepared },
    cleanup: prepared.cleanup,
  };
}

/**
 * Invoke a named Wharfie activity through one API in source and packaged
 * execution. Inside a SEA the immutable embedded revision wins; from source,
 * Wharfie loads `wharfie.app.js` from `dir` or the current working directory.
 * Inputs must be JSON-serializable because activities are durable boundaries.
 * @param {string} activityName - Declared activity name.
 * @param {object} [options] - Invocation options.
 * @param {any} [options.input] - JSON-serializable activity input.
 * @param {Record<string, any>} [options.callerMetadata] - JSON-serializable caller metadata.
 * @param {number} [options.deadlineUnixMs] - Absolute attempt deadline in Unix milliseconds.
 * @param {string} [options.dir] - Source app directory; ignored inside a SEA.
 * @returns {Promise<any>} - Activity result.
 */
export async function invokeActivity(activityName, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'invokeActivity options must be an object when provided.',
    );
  }
  const allowed = new Set(['input', 'callerMetadata', 'deadlineUnixMs', 'dir']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new TypeError(`invokeActivity.${key} is not supported.`);
    }
  }
  const loaded = await loadRuntimeManifest(options.dir);
  try {
    return await invokeManifestActivity({
      activityName,
      execution: loaded.execution,
      ...(Object.prototype.hasOwnProperty.call(options, 'input')
        ? { input: options.input }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(options, 'callerMetadata')
        ? { callerMetadata: options.callerMetadata }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(options, 'deadlineUnixMs')
        ? { deadlineUnixMs: options.deadlineUnixMs }
        : {}),
    });
  } finally {
    if (loaded.cleanup) await loaded.cleanup();
  }
}

export default { defineApp, invokeActivity };
