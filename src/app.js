import { isSea } from './core/lib/node-sea.js';
import { readEmbeddedAppManifest } from './core/resources/builds/lib/app-manifest-asset.js';
import { readEmbeddedRevisionRuntimePair } from './core/resources/builds/lib/revision-runtime-assets.js';
import { invokeManifestActivity } from './core/runtime/app-runs.js';

const SOURCE_APP_LOADER_PATH = './cli/app/load-app.js';
const SOURCE_REVISION_COMPILER_PATH =
  './cli/app/compile-application-revision.js';

/**
 * @typedef {{kind: 'prepared-source', prepared: import('./cli/app/compile-application-revision.js').PreparedApplicationRevision} | {kind: 'embedded', manifest: any, embeddedRevision: import('./core/resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair}} RuntimeExecution
 */

const APP_SHORTHAND_KEYS = new Set([
  'id',
  'main',
  'durable',
  'activityModule',
  'targets',
  'activities',
  'workflows',
  'schedules',
]);
const APP_SHORTHAND_ACTIVITY_KEYS = new Set([
  'path',
  'export',
  'externalPackages',
]);
const CONVENTIONAL_EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/**
 * @param {unknown} value - Candidate plain data object.
 * @returns {value is Record<string, any>} - Whether the value is plain data.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {Record<string, any>} value - Shorthand object to inspect.
 * @param {Set<string>} allowedKeys - Exact supported property names.
 * @param {string} valuePath - Human-readable authoring path.
 * @returns {void} - Returns after exact plain-property validation.
 */
function assertShorthandKeys(value, allowedKeys, valuePath) {
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !allowedKeys.has(key) ||
      !descriptor?.enumerable ||
      !('value' in descriptor)
    ) {
      const propertyPath =
        typeof key === 'string' ? `${valuePath}.${key}` : valuePath;
      throw new TypeError(
        `${propertyPath} is not supported by defineApp shorthand.`,
      );
    }
  }
}

/**
 * Expand the deliberately small source shorthand into the strict v4 source
 * manifest shape. Fully explicit manifests remain unchanged by identity.
 * @param {any} definition - Full v4 source manifest or source shorthand.
 * @returns {any} - The original full manifest or one expanded v4 source manifest.
 */
export function defineApp(definition) {
  if (
    !isPlainObject(definition) ||
    ['schemaVersion', 'app', 'cli'].some((key) =>
      Object.prototype.hasOwnProperty.call(definition, key),
    )
  ) {
    return definition;
  }

  assertShorthandKeys(definition, APP_SHORTHAND_KEYS, 'defineApp');
  if (
    !Object.prototype.hasOwnProperty.call(definition, 'id') ||
    !Object.prototype.hasOwnProperty.call(definition, 'main')
  ) {
    throw new TypeError('defineApp shorthand requires id and main.');
  }
  const hasActivityModule = Object.prototype.hasOwnProperty.call(
    definition,
    'activityModule',
  );
  const hasActivities = Object.prototype.hasOwnProperty.call(
    definition,
    'activities',
  );
  if (
    hasActivityModule &&
    (!hasActivities ||
      (isPlainObject(definition.activities) &&
        Object.keys(definition.activities).length === 0))
  ) {
    throw new TypeError(
      'defineApp.activityModule requires at least one declared activity.',
    );
  }

  const cli = {
    entrypoint: {
      kind: 'node',
      path: definition.main,
      export: 'main',
    },
    ...(Object.prototype.hasOwnProperty.call(definition, 'durable')
      ? {
          durable: {
            workflow: definition.durable,
            export: 'toDurableInput',
          },
        }
      : {}),
  };
  /** @type {Record<string, any>} */
  const expanded = {
    schemaVersion: 4,
    app: { id: definition.id },
    cli,
    ...(Object.prototype.hasOwnProperty.call(definition, 'targets')
      ? { targets: definition.targets }
      : {}),
  };

  if (Object.prototype.hasOwnProperty.call(definition, 'activities')) {
    if (!isPlainObject(definition.activities)) {
      throw new TypeError('defineApp.activities must be a plain object.');
    }
    expanded.activities = {};
    for (const [activityId, activity] of Object.entries(
      definition.activities,
    )) {
      if (!isPlainObject(activity)) {
        throw new TypeError(
          `defineApp.activities.${activityId} must be a plain object.`,
        );
      }
      assertShorthandKeys(
        activity,
        APP_SHORTHAND_ACTIVITY_KEYS,
        `defineApp.activities.${activityId}`,
      );
      const hasEntrypointPath = Object.prototype.hasOwnProperty.call(
        activity,
        'path',
      );
      if (
        hasEntrypointPath &&
        (typeof activity.path !== 'string' || activity.path.length === 0)
      ) {
        throw new TypeError(
          `defineApp.activities.${activityId}.path must be a nonempty string when provided.`,
        );
      }
      const entrypointPath = hasEntrypointPath
        ? activity.path
        : definition.activityModule;
      if (typeof entrypointPath !== 'string' || entrypointPath.length === 0) {
        throw new TypeError(
          `defineApp.activities.${activityId} requires path or defineApp.activityModule.`,
        );
      }
      const hasExportName = Object.prototype.hasOwnProperty.call(
        activity,
        'export',
      );
      if (
        hasExportName &&
        (typeof activity.export !== 'string' || activity.export.length === 0)
      ) {
        throw new TypeError(
          `defineApp.activities.${activityId}.export must be a nonempty string when provided.`,
        );
      }
      const exportName = hasExportName
        ? activity.export
        : CONVENTIONAL_EXPORT_NAME_PATTERN.test(activityId)
          ? activityId
          : undefined;
      if (exportName === undefined) {
        throw new TypeError(
          `defineApp.activities.${activityId}.export is required when the activity ID is not a JavaScript export name.`,
        );
      }
      expanded.activities[activityId] = {
        entrypoint: {
          kind: 'node',
          path: entrypointPath,
          export: exportName,
        },
        ...(Object.prototype.hasOwnProperty.call(activity, 'externalPackages')
          ? { externalPackages: activity.externalPackages }
          : {}),
      };
    }
  }

  for (const key of ['workflows', 'schedules']) {
    if (Object.prototype.hasOwnProperty.call(definition, key)) {
      expanded[key] = definition[key];
    }
  }
  return expanded;
}

/**
 * Resolve the immutable embedded revision inside a SEA and the source manifest
 * everywhere else. Keeping the source loader behind a variable dynamic import
 * prevents packaging-only dependencies from entering the generated runtime's
 * eager module graph.
 * @param {string | undefined} dir - Source application directory.
 * @returns {Promise<{ execution: RuntimeExecution, cleanup?: () => Promise<void> }>} - Loaded immutable runtime identity.
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
