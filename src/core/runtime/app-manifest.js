/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import path from 'node:path';

import semver from 'semver';

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const APP_MANIFEST_SCHEMA_VERSION = 2;

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'app',
  'cli',
  'targets',
  'resources',
  'activities',
]);
const APP_KEYS = new Set(['id']);
const CLI_KEYS = new Set(['entrypoint']);
const ENTRYPOINT_KEYS = new Set(['kind', 'path', 'export']);
const TARGET_KEYS = new Set([
  'nodeVersion',
  'platform',
  'architecture',
  'libc',
]);
const EXACT_RELEASE_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RESOURCE_KINDS = ['db', 'queue', 'objectStorage'];
const RESOURCE_SPEC_KEYS = new Set(['adapter', 'options']);
const ACTIVITY_KEYS = new Set(['entrypoint', 'externalPackages', 'resources']);
const EXTERNAL_PACKAGE_KEYS = new Set(['name', 'version']);
const NPM_PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;

const RESOURCE_ADAPTER_OPTIONS = {
  db: {
    vanilla: new Set(['path']),
    dynamodb: new Set(['region']),
  },
  queue: {
    vanilla: new Set(['path']),
    sqs: new Set(['region']),
  },
  objectStorage: {
    vanilla: new Set(['path', 'region']),
    s3: new Set(['region']),
  },
};

/**
 * @param {unknown} value - Candidate value.
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
 * @param {string} valuePath - Human-readable schema path.
 * @returns {asserts value is Record<string, any>}
 */
function assertPlainObject(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
}

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowed - Exact allowed property names.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertExactKeys(value, allowed, valuePath) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
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
 * @param {unknown} value - Candidate required string.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {asserts value is string}
 */
function assertNonemptyCanonicalString(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new TypeError(`${valuePath} must be a nonempty canonical string.`);
  }
}

/**
 * Canonical manifest paths use forward slashes, stay relative to the app root,
 * and never contain dot segments. Source compilation is responsible for
 * checking that the referenced file exists.
 * @param {unknown} value - Candidate canonical path.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {asserts value is string}
 */
function assertCanonicalEntrypointPath(value, valuePath) {
  assertNonemptyCanonicalString(value, valuePath);
  const candidate = /** @type {string} */ (value);
  const segments = candidate.split('/');
  if (
    path.posix.isAbsolute(candidate) ||
    candidate.includes('\\') ||
    candidate.startsWith('./') ||
    candidate.endsWith('/') ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  ) {
    throw new TypeError(
      `${valuePath} must be a normalized app-relative path using forward slashes.`,
    );
  }
}

/**
 * @param {unknown} value - Entrypoint definition.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertEntrypoint(value, valuePath) {
  assertPlainObject(value, valuePath);
  assertExactKeys(value, ENTRYPOINT_KEYS, valuePath);
  if (value.kind !== 'node') {
    throw new TypeError(`${valuePath}.kind must be 'node'.`);
  }
  assertCanonicalEntrypointPath(value.path, `${valuePath}.path`);
  assertNonemptyCanonicalString(value.export, `${valuePath}.export`);
}

/**
 * @param {unknown} value - Target definitions.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertTargets(value, valuePath) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${valuePath} must be a nonempty array when provided.`);
  }

  const targetKeys = new Set();
  value.forEach((target, index) => {
    const targetPath = `${valuePath}[${index}]`;
    assertPlainObject(target, targetPath);
    assertExactKeys(target, TARGET_KEYS, targetPath);
    assertNonemptyCanonicalString(
      target.nodeVersion,
      `${targetPath}.nodeVersion`,
    );
    if (
      semver.valid(target.nodeVersion) !== target.nodeVersion ||
      !EXACT_RELEASE_SEMVER_PATTERN.test(target.nodeVersion)
    ) {
      throw new TypeError(
        `${targetPath}.nodeVersion must be an exact canonical semantic version in x.y.z form.`,
      );
    }
    if (!['darwin', 'linux'].includes(target.platform)) {
      throw new TypeError(
        `${targetPath}.platform must be 'darwin' or 'linux'. Windows SEA targets are deferred until private core-runtime extraction is hardened and tested.`,
      );
    }
    if (!['arm64', 'x64'].includes(target.architecture)) {
      throw new TypeError(
        `${targetPath}.architecture must be 'arm64' or 'x64'.`,
      );
    }
    if (target.platform === 'linux') {
      if (target.libc !== 'glibc') {
        throw new TypeError(`${targetPath}.libc must be 'glibc' for Linux.`);
      }
    } else if (Object.prototype.hasOwnProperty.call(target, 'libc')) {
      throw new TypeError(
        `${targetPath}.libc is supported only for Linux targets.`,
      );
    }

    const targetKey = [
      target.nodeVersion,
      target.platform,
      target.architecture,
      target.libc || '',
    ].join('#');
    if (targetKeys.has(targetKey)) {
      throw new TypeError(`${targetPath} duplicates an earlier target.`);
    }
    targetKeys.add(targetKey);
  });
}

/**
 * @param {unknown} value - Resource definitions.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertResources(value, valuePath) {
  assertPlainObject(value, valuePath);
  assertExactKeys(value, new Set(RESOURCE_KINDS), valuePath);

  for (const kind of RESOURCE_KINDS) {
    if (!Object.prototype.hasOwnProperty.call(value, kind)) continue;
    const spec = value[kind];
    const specPath = `${valuePath}.${kind}`;
    assertPlainObject(spec, specPath);
    assertExactKeys(spec, RESOURCE_SPEC_KEYS, specPath);
    assertNonemptyCanonicalString(spec.adapter, `${specPath}.adapter`);

    const kindAdapters = /** @type {Record<string, Set<string>>} */ (
      RESOURCE_ADAPTER_OPTIONS[
        /** @type {'db'|'queue'|'objectStorage'} */ (kind)
      ]
    );
    const optionKeys = kindAdapters[spec.adapter];
    if (!optionKeys) {
      throw new TypeError(
        `${specPath}.adapter is not a supported portable ${kind} adapter.`,
      );
    }

    if (!Object.prototype.hasOwnProperty.call(spec, 'options')) continue;
    const optionsPath = `${specPath}.options`;
    const options = cloneJsonObject(spec.options, optionsPath);
    assertExactKeys(options, optionKeys, optionsPath);
    for (const optionName of Object.keys(options)) {
      assertNonemptyCanonicalString(
        options[optionName],
        `${optionsPath}.${optionName}`,
      );
    }
  }
}

/**
 * @param {unknown} value - Canonical external package list.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertExternalPackages(value, valuePath) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${valuePath} must be a nonempty array when provided.`);
  }

  let previousName = '';
  value.forEach((externalPackage, index) => {
    const packagePath = `${valuePath}[${index}]`;
    assertPlainObject(externalPackage, packagePath);
    assertExactKeys(externalPackage, EXTERNAL_PACKAGE_KEYS, packagePath);
    assertNonemptyCanonicalString(externalPackage.name, `${packagePath}.name`);
    if (!NPM_PACKAGE_NAME_PATTERN.test(externalPackage.name)) {
      throw new TypeError(
        `${packagePath}.name must be a lowercase npm registry package name.`,
      );
    }
    assertNonemptyCanonicalString(
      externalPackage.version,
      `${packagePath}.version`,
    );
    if (semver.valid(externalPackage.version) !== externalPackage.version) {
      throw new TypeError(
        `${packagePath}.version must be an exact canonical semantic version.`,
      );
    }
    if (
      previousName &&
      compareCanonicalStrings(externalPackage.name, previousName) <= 0
    ) {
      throw new TypeError(
        `${valuePath} must contain unique packages sorted by name.`,
      );
    }
    previousName = externalPackage.name;
  });
}

/**
 * Validate the one serialized Wharfie v2 runtime manifest shape. The returned
 * value is an independent JSON clone, so callers never retain mutable input.
 * @param {unknown} value - Candidate canonical manifest.
 * @param {string} [valuePath] - Human-readable boundary label.
 * @returns {Record<string, any>} - Validated independent manifest clone.
 */
export function validateAppManifest(value, valuePath = 'manifest') {
  const manifest = cloneJsonObject(value, valuePath);
  assertExactKeys(manifest, TOP_LEVEL_KEYS, valuePath);

  if (manifest.schemaVersion !== APP_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${APP_MANIFEST_SCHEMA_VERSION}.`,
    );
  }

  assertPlainObject(manifest.app, `${valuePath}.app`);
  assertExactKeys(manifest.app, APP_KEYS, `${valuePath}.app`);
  assertLogicalId(manifest.app.id, `${valuePath}.app.id`);

  assertPlainObject(manifest.cli, `${valuePath}.cli`);
  assertExactKeys(manifest.cli, CLI_KEYS, `${valuePath}.cli`);
  assertEntrypoint(manifest.cli.entrypoint, `${valuePath}.cli.entrypoint`);

  if (Object.prototype.hasOwnProperty.call(manifest, 'targets')) {
    assertTargets(manifest.targets, `${valuePath}.targets`);
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'resources')) {
    assertResources(manifest.resources, `${valuePath}.resources`);
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'activities')) {
    assertPlainObject(manifest.activities, `${valuePath}.activities`);
    const activityIds = Object.keys(manifest.activities);
    if (activityIds.length === 0) {
      throw new TypeError(
        `${valuePath}.activities must not be empty when provided.`,
      );
    }
    for (const activityId of activityIds) {
      const activityPath = `${valuePath}.activities.${activityId}`;
      assertLogicalId(activityId, activityPath);
      const activity = manifest.activities[activityId];
      assertPlainObject(activity, activityPath);
      assertExactKeys(activity, ACTIVITY_KEYS, activityPath);
      assertEntrypoint(activity.entrypoint, `${activityPath}.entrypoint`);
      if (Object.prototype.hasOwnProperty.call(activity, 'externalPackages')) {
        assertExternalPackages(
          activity.externalPackages,
          `${activityPath}.externalPackages`,
        );
      }
      if (Object.prototype.hasOwnProperty.call(activity, 'resources')) {
        assertResources(activity.resources, `${activityPath}.resources`);
      }
    }
  }

  assertManifestIsSecretFree(manifest, valuePath);
  return manifest;
}

/**
 * Serialize one validated manifest with deterministic object-key ordering.
 * @param {unknown} value - Candidate canonical manifest.
 * @param {{ pretty?: boolean, valuePath?: string }} [options] - Serialization options.
 * @returns {string} - Canonical JSON.
 */
export function stringifyAppManifest(value, options = {}) {
  const manifest = validateAppManifest(value, options.valuePath || 'manifest');
  const ordered = sortCanonicalJsonValue(manifest);
  return options.pretty === false
    ? JSON.stringify(ordered)
    : JSON.stringify(ordered, null, 2);
}

export default {
  APP_MANIFEST_SCHEMA_VERSION,
  stringifyAppManifest,
  validateAppManifest,
};
