import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  APP_MANIFEST_SCHEMA_VERSION,
  validateAppManifest,
} from '../../core/runtime/app-manifest.js';
import { compareCanonicalStrings } from '../../core/runtime/canonical-order.js';
import { cloneJsonObject } from '../../core/runtime/json-value.js';

const SOURCE_TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'app',
  'cli',
  'targets',
  'activities',
]);
const SOURCE_APP_KEYS = new Set(['id']);
const SOURCE_CLI_KEYS = new Set(['entrypoint']);
const SOURCE_ENTRYPOINT_KEYS = new Set(['kind', 'path', 'export']);
const SOURCE_ACTIVITY_KEYS = new Set(['entrypoint', 'externalPackages']);
const SOURCE_EXTERNAL_PACKAGE_KEYS = new Set(['name', 'version']);

/**
 * @typedef LoadAppOptions
 * @property {string} [dir] - Directory containing `wharfie.app.js`.
 */

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether value is a plain object.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {unknown} value - Candidate object.
 * @param {string} valuePath - Human-readable source path.
 * @returns {asserts value is Record<string, any>}
 */
function assertPlainObject(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
}

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowedKeys - Exact supported property names.
 * @param {string} valuePath - Human-readable source path.
 * @returns {void}
 */
function assertExactKeys(value, allowedKeys, valuePath) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      const propertyPath =
        typeof key === 'string' ? `${valuePath}.${key}` : valuePath;
      throw new TypeError(
        `${propertyPath} is not supported by schemaVersion 2.`,
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${valuePath}.${key} must be a plain data property.`);
    }
  }
}

/**
 * @param {string} parentPath - Parent filesystem path.
 * @param {string} candidatePath - Candidate descendant path.
 * @returns {boolean} - Whether candidate is within parent.
 */
function isWithin(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

/**
 * Resolve and validate an authored entrypoint without exposing build-host paths
 * in the canonical manifest.
 * @param {unknown} value - Source entrypoint.
 * @param {{ appDir: string, realAppDir: string, valuePath: string }} options - Compilation context.
 * @returns {Promise<{ kind: 'node', path: string, export: string }>} - Canonical entrypoint.
 */
async function compileEntrypoint(value, options) {
  assertPlainObject(value, options.valuePath);
  assertExactKeys(value, SOURCE_ENTRYPOINT_KEYS, options.valuePath);
  if (value.kind !== 'node') {
    throw new TypeError(`${options.valuePath}.kind must be 'node'.`);
  }
  if (
    typeof value.path !== 'string' ||
    value.path.trim() !== value.path ||
    !value.path.startsWith('./') ||
    value.path.includes('\\') ||
    value.path
      .slice(2)
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(
      `${options.valuePath}.path must be a canonical './'-prefixed app-relative path without dot segments.`,
    );
  }
  if (
    typeof value.export !== 'string' ||
    value.export.length === 0 ||
    value.export.trim() !== value.export
  ) {
    throw new TypeError(
      `${options.valuePath}.export must be a nonempty canonical string.`,
    );
  }

  const absolutePath = path.resolve(options.appDir, value.path);
  if (!isWithin(options.appDir, absolutePath)) {
    throw new TypeError(
      `${options.valuePath}.path must remain inside the application directory.`,
    );
  }

  let realEntrypointPath;
  let entrypointStat;
  try {
    realEntrypointPath = await fsp.realpath(absolutePath);
    entrypointStat = await fsp.stat(realEntrypointPath);
  } catch {
    throw new TypeError(
      `${options.valuePath}.path must reference an existing file.`,
    );
  }
  if (!entrypointStat.isFile()) {
    throw new TypeError(`${options.valuePath}.path must reference a file.`);
  }
  if (!isWithin(options.realAppDir, realEntrypointPath)) {
    throw new TypeError(
      `${options.valuePath}.path must not escape the application directory through a symbolic link.`,
    );
  }

  const logicalPath = path
    .relative(options.realAppDir, realEntrypointPath)
    .split(path.sep)
    .join('/');
  return {
    kind: 'node',
    path: logicalPath,
    export: value.export,
  };
}

/**
 * @param {unknown} value - Source external package list.
 * @param {string} valuePath - Human-readable source path.
 * @returns {unknown} - Canonically ordered package list.
 */
function compileExternalPackages(value, valuePath) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${valuePath} must be a nonempty array when provided.`);
  }
  const packages = value.map((externalPackage, index) => {
    const packagePath = `${valuePath}[${index}]`;
    assertPlainObject(externalPackage, packagePath);
    assertExactKeys(externalPackage, SOURCE_EXTERNAL_PACKAGE_KEYS, packagePath);
    return { ...externalPackage };
  });
  packages.sort((left, right) =>
    typeof left.name === 'string' && typeof right.name === 'string'
      ? compareCanonicalStrings(left.name, right.name)
      : 0,
  );
  return packages;
}

/**
 * Compile the authored module value into the one serialized runtime manifest.
 * @param {unknown} sourceValue - Default export from `wharfie.app.js`.
 * @param {{ appDir: string }} options - Compilation context.
 * @returns {Promise<Record<string, any>>} - Canonical v2 manifest.
 */
export async function compileAppManifest(sourceValue, options) {
  const source = cloneJsonObject(sourceValue, 'wharfie.app.js default export');
  assertExactKeys(source, SOURCE_TOP_LEVEL_KEYS, 'app');

  if (source.schemaVersion !== APP_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(
      `app.schemaVersion must be the integer ${APP_MANIFEST_SCHEMA_VERSION}.`,
    );
  }
  assertPlainObject(source.app, 'app.app');
  assertExactKeys(source.app, SOURCE_APP_KEYS, 'app.app');
  assertPlainObject(source.cli, 'app.cli');
  assertExactKeys(source.cli, SOURCE_CLI_KEYS, 'app.cli');

  const appDir = path.resolve(options.appDir);
  const realAppDir = await fsp.realpath(appDir);
  const manifest = /** @type {Record<string, any>} */ ({
    schemaVersion: APP_MANIFEST_SCHEMA_VERSION,
    app: { ...source.app },
    cli: {
      entrypoint: await compileEntrypoint(source.cli.entrypoint, {
        appDir,
        realAppDir,
        valuePath: 'app.cli.entrypoint',
      }),
    },
  });

  if (Object.prototype.hasOwnProperty.call(source, 'targets')) {
    manifest.targets = source.targets;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'activities')) {
    assertPlainObject(source.activities, 'app.activities');
    manifest.activities = {};
    for (const activityId of Object.keys(source.activities).sort(
      compareCanonicalStrings,
    )) {
      const activityPath = `app.activities.${activityId}`;
      const activity = source.activities[activityId];
      assertPlainObject(activity, activityPath);
      assertExactKeys(activity, SOURCE_ACTIVITY_KEYS, activityPath);
      const compiledActivity = /** @type {Record<string, any>} */ ({
        entrypoint: await compileEntrypoint(activity.entrypoint, {
          appDir,
          realAppDir,
          valuePath: `${activityPath}.entrypoint`,
        }),
      });
      if (Object.prototype.hasOwnProperty.call(activity, 'externalPackages')) {
        compiledActivity.externalPackages = compileExternalPackages(
          activity.externalPackages,
          `${activityPath}.externalPackages`,
        );
      }
      manifest.activities[activityId] = compiledActivity;
    }
  }

  return validateAppManifest(manifest);
}

/**
 * @param {string} appPath - App module path.
 * @returns {string} - Cache-busted file URL.
 */
function createFreshImportUrl(appPath) {
  const fileUrl = pathToFileURL(appPath);
  fileUrl.searchParams.set(
    'wharfie-load',
    `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  return fileUrl.href;
}

/**
 * Load and compile `<dir>/wharfie.app.js`.
 * @param {LoadAppOptions} [options] - Loader options.
 * @returns {Promise<{ appDir: string, manifest: Record<string, any> }>} - Loaded canonical manifest.
 */
export async function loadApp(options = {}) {
  const appDir = path.resolve(options.dir ?? process.cwd());
  const appPath = path.join(appDir, 'wharfie.app.js');

  try {
    const stat = await fsp.stat(appPath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`Could not find wharfie.app.js in: ${appDir}`);
  }

  const mod = await import(createFreshImportUrl(appPath));
  if (!Object.prototype.hasOwnProperty.call(mod, 'default')) {
    throw new Error(
      'wharfie.app.js must default-export one schemaVersion 2 app definition.',
    );
  }

  return {
    appDir,
    manifest: await compileAppManifest(mod.default, { appDir }),
  };
}

export default loadApp;
