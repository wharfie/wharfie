import { promises as fsp } from 'node:fs';
import path from 'node:path';

import ActorSystem from '../../core/resources/builds/actor-system.js';
import SeaBuild from '../../core/resources/builds/sea-build.js';
import {
  APP_MANIFEST_ASSET_PREFIX,
  APP_MANIFEST_ASSET_NAME,
  createEmbeddedAppManifestAsset,
  readEmbeddedAppManifest,
} from '../../core/resources/builds/lib/app-manifest-asset.js';
import FunctionResource from '../../core/resources/builds/function-resource.js';
import { assertManifestIsSecretFree } from '../../core/resources/builds/lib/manifest-security.js';
import { assertSeaNodeVersionCompatible } from '../../core/resources/builds/lib/sea-node-version.js';
import { withResourceScope } from '../../core/resources/resource-scope.js';
import { createResourceScope } from '../../core/resources/runtime-config.js';
import {
  createManifestActivityFunction,
  getManifestActivityNames,
  getManifestResourcesSpec,
  invokeManifestActivity,
} from '../../core/runtime/app-runs.js';

import { loadApp } from './load-app.js';

/**
 * @typedef JsonPrintOptions
 * @property {boolean} [pretty] - pretty.
 */

/**
 * @typedef RunLocalAppOptions
 * @property {string} [dir] - App directory.
 * @property {boolean} [allowEmbedded] - Fall back to the embedded SEA app manifest when no local app exists.
 * @property {string} [activityName] - Activity name.
 * @property {string} [functionName] - Compatibility alias for activity name.
 * @property {string | undefined} [eventInput] - Event JSON string.
 * @property {string | undefined} [contextInput] - Context JSON string.
 * @property {string | undefined} [stdinInput] - STDIN payload.
 */

/**
 * @typedef LoadedAppForCommand
 * @property {any | null} appExport - appExport.
 * @property {any} manifest - manifest.
 * @property {any} publicManifest - publicManifest.
 * @property {'disk' | 'embedded'} source - source.
 */

/**
 * @typedef PackageArtifactTarget
 * @property {string} nodeVersion - nodeVersion.
 * @property {string} platform - platform.
 * @property {string} architecture - architecture.
 * @property {string} [libc] - libc.
 */

/**
 * @typedef PackageArtifactSummary
 * @property {string} fileName - fileName.
 * @property {string} path - path.
 * @property {PackageArtifactTarget} target - target.
 */

/**
 * @typedef PackageLocalAppOptions
 * @property {string} dir - dir.
 * @property {string} [outputDir] - outputDir.
 * @property {string[]} [targetFilters] - targetFilters.
 */

/**
 * @typedef LocalAppPackagingContext
 * @property {string} appDir - App directory.
 * @property {string} outputDir - Output directory.
 * @property {Record<string, any>} manifest - Full compiled manifest.
 * @property {Record<string, any>} publicManifest - Public compiled manifest.
 */

/**
 * @typedef LocalAppMacOSSigningConfig
 * @property {string} [certificateBase64] - Base64-encoded PKCS #12 signing certificate.
 * @property {string} [certificatePassword] - Signing certificate password.
 * @property {string} [keychainPassword] - Temporary keychain password.
 */

/**
 * @typedef LocalAppSigningConfig
 * @property {LocalAppMacOSSigningConfig} [macos] - macOS signing configuration.
 */

/**
 * @typedef LocalAppPackagingConfig
 * @property {LocalAppSigningConfig} [signing] - Artifact signing configuration.
 * @property {Record<string, string> | ((context: LocalAppPackagingContext) => Record<string, string>)} [assets] - Additional SEA assets to embed.
 */

/**
 * @typedef PackageLocalAppResult
 * @property {{ name: string }} app - App metadata.
 * @property {PackageArtifactTarget[]} [targets] - targets.
 * @property {string} outputDir - outputDir.
 * @property {PackageArtifactSummary[]} artifacts - artifacts.
 */

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string | undefined} input - input.
 * @param {string} label - label.
 * @param {any} defaultValue - defaultValue.
 * @returns {any} - Result.
 */
export function parseJsonInput(input, label, defaultValue) {
  if (typeof input !== 'string') return defaultValue;

  const trimmed = input.trim();
  if (!trimmed) return defaultValue;

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ${label} JSON: ${message}`);
  }
}

/**
 * @param {unknown} value - value.
 * @param {JsonPrintOptions} [options] - options.
 * @returns {string} - Result.
 */
export function stringifyJson(value, options = {}) {
  const pretty = options.pretty !== false;
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

/**
 * @param {any} value - value.
 * @returns {any} - Result.
 */
function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Replace build-host entrypoint paths with stable logical locations used only
 * by the embedded manifest. Embedded activity execution resolves the activity
 * by its SEA asset name rather than importing this path.
 *
 * @param {Record<string, any>} manifest - Public manifest.
 * @returns {Record<string, any>} - Sanitized embedded manifest.
 */
function sanitizeEmbeddedManifestEntrypoints(manifest) {
  const embeddedManifest = cloneJson(manifest);

  if (
    isObjectRecord(embeddedManifest.cli) &&
    typeof embeddedManifest.cli.entrypoint === 'string'
  ) {
    embeddedManifest.cli.entrypoint = 'wharfie:embedded/cli';
  }

  if (isObjectRecord(embeddedManifest.activities)) {
    for (const [activityName, definition] of Object.entries(
      embeddedManifest.activities,
    )) {
      if (isObjectRecord(definition) && isObjectRecord(definition.entrypoint)) {
        definition.entrypoint.path = `wharfie:embedded/activity/${encodeURIComponent(
          activityName,
        )}`;
      }
    }
  }

  if (Array.isArray(embeddedManifest.functions)) {
    for (const definition of embeddedManifest.functions) {
      if (
        isObjectRecord(definition) &&
        typeof definition.name === 'string' &&
        isObjectRecord(definition.entrypoint)
      ) {
        definition.entrypoint.path = `wharfie:embedded/activity/${encodeURIComponent(
          definition.name,
        )}`;
      }
    }
  }

  return embeddedManifest;
}

/**
 * @param {unknown} error - error.
 * @returns {string} - Result.
 */
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || '');
}

/**
 * @param {unknown} error - error.
 * @returns {boolean} - Result.
 */
function isMissingEmbeddedAppError(error) {
  const message = getErrorMessage(error);
  return (
    message.includes('only available inside a packaged SEA artifact') ||
    message.includes(
      `Embedded app manifest asset '${APP_MANIFEST_ASSET_NAME}' was not found`,
    ) ||
    message.includes('node:sea is unavailable')
  );
}

/**
 * @returns {Promise<LoadedAppForCommand>} - Result.
 */
async function loadEmbeddedAppForCommand() {
  const manifest = await readEmbeddedAppManifest();
  return {
    appExport: null,
    manifest,
    publicManifest: manifest,
    source: 'embedded',
  };
}

/**
 * @param {{ dir?: string, allowEmbedded?: boolean }} [options] - options.
 * @returns {Promise<LoadedAppForCommand>} - Result.
 */
export async function loadAppForCommand(options = {}) {
  const hasExplicitDir = typeof options.dir === 'string' && options.dir.trim();
  const dir = hasExplicitDir ? String(options.dir) : process.cwd();

  if (!hasExplicitDir && options.allowEmbedded) {
    try {
      return await loadEmbeddedAppForCommand();
    } catch (embeddedError) {
      if (!isMissingEmbeddedAppError(embeddedError)) {
        throw embeddedError;
      }
    }
  }

  const loaded = await loadApp({ dir });
  return { ...loaded, source: 'disk' };
}

/**
 * @param {any} appExport - appExport.
 * @returns {LocalAppPackagingConfig} - Result.
 */
function getLocalAppPackagingConfig(appExport) {
  if (!isObjectRecord(appExport)) {
    return {};
  }

  const packaging = appExport.packaging;
  return isObjectRecord(packaging)
    ? /** @type {LocalAppPackagingConfig} */ (packaging)
    : {};
}

/**
 * @param {any} appExport - appExport.
 * @returns {LocalAppMacOSSigningConfig | undefined} - Result.
 */
function getPackagingMacOSSigningConfig(appExport) {
  const config = getLocalAppPackagingConfig(appExport);
  if (!isObjectRecord(config.signing)) {
    return undefined;
  }

  return isObjectRecord(config.signing.macos)
    ? /** @type {LocalAppMacOSSigningConfig} */ (config.signing.macos)
    : undefined;
}

/**
 * @param {ActorSystem} actorSystem - actorSystem.
 * @param {any} appExport - appExport.
 * @returns {void} - Result.
 */
function applyPackagingSigningConfig(actorSystem, appExport) {
  const signing = getPackagingMacOSSigningConfig(appExport);
  if (!signing) return;

  actorSystem.setMacOSSigningCredentials({
    certificateBase64: signing.certificateBase64,
    certificatePassword: signing.certificatePassword,
    keychainPassword: signing.keychainPassword,
  });
}

/**
 * @param {unknown} assetSource - assetSource.
 * @returns {Record<string, string>} - Result.
 */
function normalizePackagingAssets(assetSource) {
  if (!isObjectRecord(assetSource)) {
    return {};
  }

  return Object.entries(assetSource).reduce(
    (/** @type {Record<string, string>} */ acc, [name, value]) => {
      if (typeof value === 'string' && value) {
        acc[name] = value;
      }
      return acc;
    },
    {},
  );
}

/**
 * @param {{ appExport: any, appDir: string, outputDir: string, manifest: Record<string, any>, publicManifest: Record<string, any> }} options - options.
 * @returns {Promise<Record<string, string>>} - Validated absolute asset paths.
 */
async function resolvePackagingAssets(options) {
  const config = getLocalAppPackagingConfig(options.appExport);
  const assets =
    typeof config.assets === 'function'
      ? config.assets({
          appDir: options.appDir,
          outputDir: options.outputDir,
          manifest: options.manifest,
          publicManifest: options.publicManifest,
        })
      : config.assets;

  const normalized = normalizePackagingAssets(assets);
  const reservedNames = new Set([
    APP_MANIFEST_ASSET_NAME,
    ...Object.keys(
      isObjectRecord(options.publicManifest.activities)
        ? options.publicManifest.activities
        : {},
    ),
    ...(Array.isArray(options.manifest.functions)
      ? options.manifest.functions
          .map((definition) => definition?.name)
          .filter((name) => typeof name === 'string' && name)
      : []),
  ]);
  /** @type {Record<string, string>} */
  const validated = {};

  for (const [name, assetPath] of Object.entries(normalized)) {
    if (!name.trim()) {
      throw new Error('Packaging asset names must not be empty.');
    }
    if (reservedNames.has(name) || name.startsWith(APP_MANIFEST_ASSET_PREFIX)) {
      throw new Error(
        `Packaging asset name '${name}' is reserved for Wharfie runtime content.`,
      );
    }

    const absolutePath = path.isAbsolute(assetPath)
      ? assetPath
      : path.resolve(options.appDir, assetPath);
    let assetStat;
    try {
      assetStat = await fsp.stat(absolutePath);
    } catch {
      throw new Error(`Packaging asset '${name}' does not exist.`);
    }
    if (!assetStat.isFile()) {
      throw new Error(`Packaging asset '${name}' must reference a file.`);
    }
    validated[name] = absolutePath;
  }

  return validated;
}

/**
 * @param {RunLocalAppOptions} options - options.
 * @param {any} manifest - manifest.
 * @param {any} publicManifest - publicManifest.
 * @returns {string} - Result.
 */
function resolveActivityName(options, manifest, publicManifest) {
  const activityName =
    typeof options.activityName === 'string' && options.activityName.trim()
      ? options.activityName.trim()
      : typeof options.functionName === 'string' && options.functionName.trim()
        ? options.functionName.trim()
        : '';

  if (activityName) {
    return activityName;
  }

  const availableActivities = getManifestActivityNames(
    manifest,
    publicManifest,
  );
  if (availableActivities.length === 1) {
    return availableActivities[0];
  }

  throw new Error('Activity name is required.');
}

/**
 * @param {unknown} spec - Resource adapter specification.
 * @returns {string | undefined} - Normalized adapter name.
 */
function getResourceAdapterName(spec) {
  if (typeof spec === 'string') return spec.trim().toLowerCase();
  if (
    isObjectRecord(spec) &&
    typeof spec.adapter === 'string' &&
    spec.adapter.trim()
  ) {
    return spec.adapter.trim().toLowerCase();
  }
  return undefined;
}

/** @type {Record<string, Record<string, Set<string>>>} */
const PORTABLE_RESOURCE_OPTION_KEYS = {
  db: {
    dynamodb: new Set(['region']),
    vanilla: new Set(['path']),
  },
  queue: {
    sqs: new Set(['region']),
    vanilla: new Set(['path']),
  },
  objectStorage: {
    s3: new Set(['region']),
    vanilla: new Set(['path', 'region']),
  },
};

/**
 * Native host adapters must not be advertised as portable until their
 * target-specific runtime files are embedded in the generated SEA.
 * @param {unknown} resources - Resource specifications.
 * @param {string} location - Manifest location for diagnostics.
 * @returns {void}
 */
function assertPortableResourceSpecs(resources, location) {
  if (!isObjectRecord(resources)) return;

  for (const kind of ['db', 'queue', 'objectStorage']) {
    const spec = resources[kind];
    if (spec === undefined) continue;

    const adapter = getResourceAdapterName(spec);
    if (adapter === 'lmdb') {
      throw new Error(
        `Cannot package ${location}.${kind} with adapter 'lmdb': its native runtime is not embedded in Wharfie SEA artifacts yet. Use a portable adapter or declare the native dependency inside an activity until host-native resource assets are implemented.`,
      );
    }

    const allowedOptionKeys =
      PORTABLE_RESOURCE_OPTION_KEYS[
        /** @type {'db' | 'queue' | 'objectStorage'} */ (kind)
      ]?.[adapter || ''];
    if (!allowedOptionKeys) {
      throw new Error(
        `Cannot package ${location}.${kind} with adapter '${adapter || '(missing)'}': it has no reviewed portable public configuration schema.`,
      );
    }

    if (!isObjectRecord(spec) || spec.options === undefined) continue;
    if (!isObjectRecord(spec.options)) {
      throw new Error(
        `Cannot package ${location}.${kind}.options: portable resource options must be a public configuration object.`,
      );
    }

    for (const [optionName, optionValue] of Object.entries(spec.options)) {
      if (!allowedOptionKeys.has(optionName)) {
        throw new Error(
          `Cannot package ${location}.${kind}.options.${optionName}: this option is not part of the adapter's portable public configuration schema. Packaged manifests are inspectable; use ambient credentials until first-class secret references exist.`,
        );
      }
      if (typeof optionValue !== 'string' || !optionValue.trim()) {
        throw new Error(
          `Cannot package ${location}.${kind}.options.${optionName}: portable public option values must be non-empty strings.`,
        );
      }
    }
  }
}

/**
 * @param {any} manifest - Public application manifest.
 * @returns {void}
 */
function assertPortableManifestContract(manifest) {
  const appName =
    typeof manifest?.app?.name === 'string' ? manifest.app.name.trim() : '';
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(appName)) {
    throw new Error(
      'Cannot package app: app.name must be a lowercase portable identifier of 1-64 letters, numbers, dots, underscores, or hyphens, and must begin and end with a letter or number.',
    );
  }

  const activities = isObjectRecord(manifest?.activities)
    ? manifest.activities
    : {};

  for (const [activityName, definition] of Object.entries(activities)) {
    if (activityName.startsWith(APP_MANIFEST_ASSET_PREFIX)) {
      throw new Error(
        `Cannot package activity '${activityName}': names beginning with '${APP_MANIFEST_ASSET_PREFIX}' are reserved for Wharfie runtime assets.`,
      );
    }
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(activityName)) {
      throw new Error(
        `Cannot package activity '${activityName}': names must be lowercase portable identifiers of 1-64 letters, numbers, dots, underscores, or hyphens, and must begin and end with a letter or number.`,
      );
    }
    if (isObjectRecord(definition)) {
      assertPortableResourceSpecs(
        definition.resources,
        `manifest.activities.${activityName}.resources`,
      );
    }
  }

  assertPortableResourceSpecs(manifest?.resources, 'manifest.resources');

  if (Array.isArray(manifest?.workflows) && manifest.workflows.length > 0) {
    throw new Error(
      'Cannot package workflows yet: workflow inputs and durable execution semantics do not have a reviewed portable public schema. Invoke activities explicitly until the durable workflow contract is implemented.',
    );
  }

  if (
    isObjectRecord(manifest?.scheduler) &&
    Array.isArray(manifest.scheduler.triggers) &&
    manifest.scheduler.triggers.length > 0
  ) {
    throw new Error(
      'Cannot package scheduler triggers yet: the generated SEA does not have a portable, manifest-derived durable operations store. Run activities explicitly until the durable scheduler contract is implemented.',
    );
  }
}

/**
 * @param {{ appExport: any, manifest: any, publicManifest: any }} loaded - loaded.
 * @returns {ActorSystem} - Result.
 */
function toPackageableActorSystem(loaded) {
  if (loaded.appExport instanceof ActorSystem) {
    return loaded.appExport;
  }

  const manifest = loaded.manifest;
  const publicManifest = loaded.publicManifest;
  const cliEntrypoint =
    typeof publicManifest?.cli?.entrypoint === 'string' &&
    publicManifest.cli.entrypoint
      ? publicManifest.cli.entrypoint
      : undefined;
  const cliExportName =
    typeof publicManifest?.cli?.export === 'string' && publicManifest.cli.export
      ? publicManifest.cli.export
      : undefined;

  if (!cliEntrypoint) {
    throw new Error(
      'Manifest-defined app packaging requires cli.entrypoint in wharfie.app.js.',
    );
  }

  const functions = getManifestActivityNames(manifest, publicManifest).map(
    (activityName) =>
      createManifestActivityFunction({
        manifest,
        publicManifest,
        activityName,
      }),
  );

  const properties = /** @type {any} */ ({
    targets: Array.isArray(publicManifest.targets)
      ? publicManifest.targets
      : Array.isArray(manifest.targets)
        ? manifest.targets
        : [],
    resources: getManifestResourcesSpec(manifest, publicManifest),
    ...(Array.isArray(manifest.workflows)
      ? { workflows: manifest.workflows }
      : {}),
    ...(isObjectRecord(manifest.scheduler)
      ? { scheduler: manifest.scheduler }
      : {}),
    cli: {
      entrypoint: cliEntrypoint,
      ...(cliExportName ? { export: cliExportName } : {}),
    },
  });

  return new ActorSystem({
    name: manifest.app.name,
    functions,
    properties,
  });
}

/**
 * @param {SeaBuild} build - build.
 * @param {string} appName - appName.
 * @returns {string} - Result.
 */
function getArtifactFileName(build, appName) {
  const safeAppName = getSafeArtifactAppName(appName);
  const nodeVersion = String(build.get('nodeVersion'));
  const platform = String(build.get('platform'));
  const architecture = String(build.get('architecture'));
  const libc = build.has('libc') ? String(build.get('libc')) : '';
  const extension = platform === 'win32' ? '.exe' : '';

  return `${safeAppName}-node${nodeVersion}-${platform}-${architecture}${
    libc ? `-${libc}` : ''
  }${extension}`;
}

/**
 * @param {unknown} appName - Application name.
 * @returns {string} - File-system-safe application name.
 */
function getSafeArtifactAppName(appName) {
  return String(appName)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * @param {ActorSystem} actorSystem - actorSystem.
 * @returns {SeaBuild[]} - Result.
 */
function getSeaBuildResources(actorSystem) {
  return actorSystem
    .getResources()
    .filter((resource) => resource instanceof SeaBuild);
}

/**
 * @typedef StagedPackageArtifact
 * @property {string} fileName - Public artifact file name.
 * @property {string} stagedPath - Private, fully prepared artifact path.
 * @property {string} finalPath - Public destination path.
 * @property {PackageArtifactTarget} target - Artifact target.
 */

/**
 * @typedef PackageArtifactTransaction
 * @property {string} stagingDir - Private transaction directory.
 * @property {StagedPackageArtifact[]} artifacts - Fully staged artifacts.
 */

/**
 * Publication failed and one or more previous artifacts could not be restored.
 * The transaction directory must be retained for manual recovery.
 */
class ArtifactPublicationRecoveryError extends AggregateError {
  /**
   * @param {unknown[]} errors - Publication and rollback errors.
   * @param {string} recoveryPath - Preserved transaction directory.
   */
  constructor(errors, recoveryPath) {
    super(
      errors,
      `Artifact publication failed and its previous output set could not be fully restored. Recovery files have been preserved at '${recoveryPath}'.`,
    );
    this.name = 'ArtifactPublicationRecoveryError';
    this.recoveryPath = recoveryPath;
  }
}

/**
 * @param {unknown} error - error.
 * @returns {boolean} - Result.
 */
function isFileNotFoundError(error) {
  return isObjectRecord(error) && error.code === 'ENOENT';
}

/**
 * @param {unknown} error - error.
 * @returns {boolean} - Result.
 */
function isFileAlreadyExistsError(error) {
  return isObjectRecord(error) && error.code === 'EEXIST';
}

/**
 * @param {string} appName - Application name.
 * @param {string} outputDir - Public output directory.
 * @returns {Promise<string>} - Acquired lock directory path.
 */
async function acquirePackagePublicationLock(appName, outputDir) {
  const lockPath = path.join(
    outputDir,
    `.wharfie-${getSafeArtifactAppName(appName)}.publish.lock`,
  );

  try {
    await fsp.mkdir(lockPath, { mode: 0o700 });
    await fsp.chmod(lockPath, 0o700);
  } catch (error) {
    if (isFileAlreadyExistsError(error)) {
      throw new Error(
        `Cannot publish app '${appName}' to '${outputDir}': another Wharfie publisher holds '${lockPath}'. Wait for it to finish, or remove the stale lock directory after verifying that no package process is running.`,
      );
    }

    try {
      await fsp.rmdir(lockPath);
    } catch (cleanupError) {
      if (!isFileNotFoundError(cleanupError)) {
        throw new AggregateError(
          [error, cleanupError],
          `Could not acquire publication lock '${lockPath}', and its partial lock directory could not be removed.`,
        );
      }
    }
    throw error;
  }

  return lockPath;
}

/**
 * @param {string} lockPath - Acquired lock directory path.
 * @returns {Promise<void>}
 */
async function releasePackagePublicationLock(lockPath) {
  await fsp.rmdir(lockPath);
}

/**
 * @param {string} filePath - Candidate file path.
 * @returns {boolean} - Whether the path is a direct child owned by SeaBuild.
 */
function isPackageOwnedSeaBuildBinaryPath(filePath) {
  const binaryPath = path.resolve(filePath);
  const binariesDir = path.resolve(SeaBuild.BINARIES_DIR);
  const binaryParent = path.dirname(binaryPath);

  return process.platform === 'win32'
    ? binaryParent.toLowerCase() === binariesDir.toLowerCase()
    : binaryParent === binariesDir;
}

/**
 * Remove the private, uniquely named SeaBuild outputs after every artifact has
 * been copied into the output-local staging transaction. External and mocked
 * binary paths are deliberately left untouched.
 *
 * @param {SeaBuild[]} builds - Reconciled builds.
 * @returns {Promise<void>}
 */
async function removePackageOwnedSeaBuildOutputs(builds) {
  const ownedPaths = Array.from(
    new Set(
      builds
        .map((build) => build.get('binaryPath'))
        .filter(
          (binaryPath) =>
            typeof binaryPath === 'string' &&
            binaryPath &&
            isPackageOwnedSeaBuildBinaryPath(binaryPath),
        ),
    ),
  );
  const cleanupResults = await Promise.allSettled(
    ownedPaths.map((binaryPath) => fsp.rm(binaryPath, { force: true })),
  );
  const cleanupErrors = cleanupResults
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'Packaged SEA artifacts were staged, but one or more private SeaBuild outputs could not be removed.',
    );
  }
}

/**
 * @param {string} filePath - filePath.
 * @returns {Promise<import('node:fs').Stats | null>} - Result.
 */
async function lstatIfExists(filePath) {
  try {
    return await fsp.lstat(filePath);
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
}

/**
 * @param {string} filePath - filePath.
 * @param {string} label - Human-readable path label.
 * @returns {Promise<void>}
 */
async function assertRegularArtifactFile(filePath, label) {
  const stats = await lstatIfExists(filePath);
  if (!stats) {
    throw new Error(`${label} does not exist.`);
  }
  if (!stats.isFile()) {
    throw new Error(`${label} must be a regular file.`);
  }
}

/**
 * Copy every reconciled binary into a private directory on the destination
 * filesystem. Public output paths remain untouched until the entire artifact
 * set has been copied and verified.
 *
 * @param {SeaBuild[]} builds - builds.
 * @param {string} appName - appName.
 * @param {string} outputDir - outputDir.
 * @returns {Promise<PackageArtifactTransaction>} - Result.
 */
async function stagePackageArtifacts(builds, appName, outputDir) {
  const stagingDir = await fsp.mkdtemp(
    path.join(outputDir, '.wharfie-package-'),
  );

  try {
    await fsp.chmod(stagingDir, 0o700);
    const readyDir = path.join(stagingDir, 'ready');
    await fsp.mkdir(readyDir, { mode: 0o700 });
    await fsp.chmod(readyDir, 0o700);

    /** @type {StagedPackageArtifact[]} */
    const artifacts = [];
    const fileNames = new Set();

    for (const build of builds) {
      const sourcePath = build.get('binaryPath');
      if (typeof sourcePath !== 'string' || !sourcePath) {
        throw new Error(`Build '${build.name}' did not expose a binaryPath.`);
      }
      await assertRegularArtifactFile(
        sourcePath,
        `Build '${build.name}' binaryPath`,
      );

      const fileName = getArtifactFileName(build, appName);
      if (fileNames.has(fileName)) {
        throw new Error(
          `Multiple builds resolved to artifact file name '${fileName}'.`,
        );
      }
      fileNames.add(fileName);

      const stagedPath = path.join(readyDir, fileName);
      const finalPath = path.join(outputDir, fileName);
      await fsp.copyFile(sourcePath, stagedPath);
      if (build.get('platform') !== 'win32') {
        await fsp.chmod(stagedPath, 0o755);
      }
      await assertRegularArtifactFile(
        stagedPath,
        `Staged artifact '${fileName}'`,
      );

      artifacts.push({
        fileName,
        stagedPath,
        finalPath,
        target: getBuildTarget(build),
      });
    }

    return { stagingDir, artifacts };
  } catch (error) {
    try {
      await fsp.rm(stagingDir, { force: true, recursive: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Artifact staging failed and its private transaction directory could not be removed.',
      );
    }
    throw error;
  }
}

/**
 * Publish a fully staged artifact set. Existing regular-file outputs are moved
 * into the private transaction directory first and restored if any rename
 * fails, so a failed publication does not leave a partial new set behind.
 *
 * @param {PackageArtifactTransaction} transaction - transaction.
 * @returns {Promise<PackageArtifactSummary[]>} - Published artifact summaries.
 */
async function publishStagedArtifacts(transaction) {
  /** @type {{ artifact: StagedPackageArtifact, existed: boolean, backupPath: string }[]} */
  const publicationPlan = [];
  const backupDir = path.join(transaction.stagingDir, 'backups');

  for (const [index, artifact] of transaction.artifacts.entries()) {
    await assertRegularArtifactFile(
      artifact.stagedPath,
      `Staged artifact '${artifact.fileName}'`,
    );
    const destinationStats = await lstatIfExists(artifact.finalPath);
    if (destinationStats && !destinationStats.isFile()) {
      throw new Error(
        `Artifact destination '${artifact.finalPath}' must be a regular file when it already exists.`,
      );
    }
    publicationPlan.push({
      artifact,
      existed: !!destinationStats,
      backupPath: path.join(backupDir, String(index)),
    });
  }

  await fsp.mkdir(backupDir, { mode: 0o700 });
  await fsp.chmod(backupDir, 0o700);

  /** @type {typeof publicationPlan} */
  const backedUp = [];
  /** @type {typeof publicationPlan} */
  const published = [];

  try {
    for (const item of publicationPlan) {
      if (item.existed) {
        await fsp.rename(item.artifact.finalPath, item.backupPath);
        backedUp.push(item);
      }
      await fsp.rename(item.artifact.stagedPath, item.artifact.finalPath);
      published.push(item);
    }
  } catch (error) {
    /** @type {unknown[]} */
    const rollbackErrors = [];

    for (const item of [...published].reverse()) {
      try {
        await fsp.rm(item.artifact.finalPath, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const item of [...backedUp].reverse()) {
      try {
        await fsp.rename(item.backupPath, item.artifact.finalPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new ArtifactPublicationRecoveryError(
        [error, ...rollbackErrors],
        transaction.stagingDir,
      );
    }
    throw error;
  }

  return transaction.artifacts.map((artifact) => ({
    fileName: artifact.fileName,
    path: artifact.finalPath,
    target: artifact.target,
  }));
}

/**
 * @param {PackageArtifactTarget} target - target.
 * @returns {PackageArtifactTarget} - Result.
 */
function cloneTarget(target) {
  return {
    nodeVersion: String(target.nodeVersion),
    platform: String(target.platform),
    architecture: String(target.architecture),
    ...(typeof target.libc === 'string' ? { libc: target.libc } : {}),
  };
}

/**
 * Official Node.js Linux distribution archives target glibc. Do not label
 * those bytes as musl-compatible or attach a libc qualifier to non-Linux
 * artifacts.
 * @param {PackageArtifactTarget} target - target.
 * @returns {PackageArtifactTarget} - Validated target.
 */
function assertSupportedSeaTarget(target) {
  const normalized = {
    ...target,
    platform: String(target.platform).trim().toLowerCase(),
    architecture: String(target.architecture).trim().toLowerCase(),
    ...(target.libc ? { libc: String(target.libc).trim().toLowerCase() } : {}),
  };

  if (!['darwin', 'linux', 'win32'].includes(normalized.platform)) {
    throw new Error(
      `Unsupported SEA platform '${target.platform}'. Expected darwin, linux, or win32.`,
    );
  }
  if (!['arm64', 'x64'].includes(normalized.architecture)) {
    throw new Error(
      `Unsupported SEA architecture '${target.architecture}'. Expected arm64 or x64.`,
    );
  }

  if (normalized.platform === 'linux') {
    if (normalized.libc && normalized.libc !== 'glibc') {
      throw new Error(
        `Unsupported SEA target ${normalized.platform}/${normalized.architecture}/${normalized.libc}: official Node.js Linux binaries require glibc. A verified musl Node distribution source is not implemented yet.`,
      );
    }
    return { ...normalized, libc: 'glibc' };
  }

  if (normalized.libc) {
    throw new Error(
      `Unsupported SEA target ${normalized.platform}/${normalized.architecture}: libc may only be specified for Linux targets.`,
    );
  }

  return normalized;
}

/**
 * @param {PackageArtifactTarget} target - target.
 * @returns {string} - Result.
 */
function getTargetKey(target) {
  return [
    String(target.nodeVersion),
    String(target.platform),
    String(target.architecture),
    typeof target.libc === 'string' ? target.libc : '',
  ].join('|');
}

/**
 * @param {PackageArtifactTarget} target - target.
 * @returns {string[]} - Result.
 */
function getTargetAliases(target) {
  const libcSuffix = typeof target.libc === 'string' ? `-${target.libc}` : '';
  const libcPath = typeof target.libc === 'string' ? `/${target.libc}` : '';

  return [
    `${target.platform}-${target.architecture}`,
    `${target.nodeVersion}-${target.platform}-${target.architecture}`,
    `${target.platform}-${target.architecture}${libcSuffix}`,
    `${target.nodeVersion}-${target.platform}-${target.architecture}${libcSuffix}`,
    `node${target.nodeVersion}-${target.platform}-${target.architecture}${libcSuffix}`,
    `${target.platform}/${target.architecture}${libcPath}`,
    `${target.nodeVersion}/${target.platform}/${target.architecture}${libcPath}`,
  ];
}

/**
 * @param {PackageArtifactTarget[]} targets - targets.
 * @param {string[] | undefined} targetFilters - targetFilters.
 * @returns {PackageArtifactTarget[]} - Result.
 */
function selectTargets(targets, targetFilters) {
  if (!Array.isArray(targetFilters) || targetFilters.length === 0) {
    return targets;
  }

  /** @type {PackageArtifactTarget[]} */
  const selected = [];
  const seen = new Set();

  for (const rawFilter of targetFilters) {
    const filter = String(rawFilter).trim();
    if (!filter) continue;

    const matches = targets.filter((target) =>
      getTargetAliases(target).includes(filter),
    );

    if (matches.length === 0) {
      throw new Error(
        `Unknown target '${filter}'. Available targets: ${targets
          .map((target) => getTargetAliases(target)[4])
          .join(', ')}`,
      );
    }

    if (matches.length > 1) {
      throw new Error(
        `Target '${filter}' is ambiguous. Use one of: ${matches
          .map((target) => getTargetAliases(target)[4])
          .join(', ')}`,
      );
    }

    const match = cloneTarget(matches[0]);
    const key = getTargetKey(match);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(match);
  }

  return selected;
}

/**
 * @param {ActorSystem} actorSystem - actorSystem.
 * @param {PackageArtifactTarget[]} selectedTargets - selectedTargets.
 * @returns {void}
 */
function applyTargetSelection(actorSystem, selectedTargets) {
  actorSystem.set(
    'targets',
    selectedTargets.map((target) => cloneTarget(target)),
  );

  const usesDefaultReconcile =
    actorSystem.reconcile === ActorSystem.prototype.reconcile;
  const usesDefaultGetResources =
    actorSystem.getResources === ActorSystem.prototype.getResources;

  if (!usesDefaultReconcile || !usesDefaultGetResources) {
    return;
  }

  actorSystem.resources = {};
  actorSystem.addResources(
    withResourceScope(
      {
        stateDB: actorSystem.getStateDB(),
        emitter: actorSystem.getEmitter(),
      },
      () => actorSystem.defineActorSystemResources(actorSystem.parent),
    ),
  );
}

/**
 * @param {SeaBuild} build - build.
 * @returns {PackageArtifactTarget} - Result.
 */
function getBuildTarget(build) {
  return {
    nodeVersion: String(build.get('nodeVersion')),
    platform: String(build.get('platform')),
    architecture: String(build.get('architecture')),
    ...(build.has('libc') ? { libc: String(build.get('libc')) } : {}),
  };
}

/**
 * @param {SeaBuild} build - build.
 * @param {unknown} assetSource - assetSource.
 * @returns {Record<string, string>} - Result.
 */
function resolveBuildAssets(build, assetSource) {
  if (typeof assetSource === 'function') {
    return resolveBuildAssets(build, assetSource.call(build));
  }

  if (!isObjectRecord(assetSource)) {
    return {};
  }

  return Object.entries(assetSource).reduce(
    (/** @type {Record<string, string>} */ acc, [name, value]) => {
      if (typeof value === 'string' && value) {
        acc[name] = value;
      }
      return acc;
    },
    {},
  );
}

/**
 * @param {SeaBuild[]} builds - builds.
 * @param {Record<string, any>} manifest - manifest.
 * @param {Record<string, string>} [additionalAssets] - additionalAssets.
 * @returns {Promise<import('../../core/resources/builds/lib/app-manifest-asset.js').EmbeddedAppManifestAsset[]>} - Temporary asset handles.
 */
async function attachEmbeddedManifestAssets(
  builds,
  manifest,
  additionalAssets = {},
) {
  /** @type {import('../../core/resources/builds/lib/app-manifest-asset.js').EmbeddedAppManifestAsset[]} */
  const manifestAssets = [];

  try {
    for (const build of builds) {
      const buildTarget = getBuildTarget(build);
      const embeddedManifest = {
        ...sanitizeEmbeddedManifestEntrypoints(manifest),
        ...(Array.isArray(manifest.targets)
          ? { targets: [cloneTarget(buildTarget)] }
          : {}),
      };
      const manifestAsset =
        await createEmbeddedAppManifestAsset(embeddedManifest);
      manifestAssets.push(manifestAsset);
      const originalAssets = build.properties?.assets;
      build._setUNSAFE('assets', () => ({
        ...resolveBuildAssets(build, originalAssets),
        ...additionalAssets,
        [APP_MANIFEST_ASSET_NAME]: manifestAsset.path,
      }));
    }
  } catch (error) {
    const cleanupResults = await Promise.allSettled(
      manifestAssets.map((asset) => asset.cleanup()),
    );
    const cleanupErrors = cleanupResults
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'Preparing embedded manifests failed and temporary asset cleanup was incomplete.',
      );
    }
    throw error;
  }

  return manifestAssets;
}

/**
 * @param {RunLocalAppOptions} options - options.
 * @returns {Promise<{ manifest: any, result: any }>} - Result.
 */
export async function runLocalApp(options) {
  const loaded = await loadAppForCommand({
    dir: options.dir,
    allowEmbedded: options.allowEmbedded,
  });
  const { manifest, publicManifest } = loaded;
  const activityName = resolveActivityName(options, manifest, publicManifest);
  const eventSource = options.eventInput ?? options.stdinInput;
  const event = parseJsonInput(eventSource, 'event', {});
  const context = parseJsonInput(options.contextInput, 'context', {});

  if (!isObjectRecord(context)) {
    throw new Error('Context JSON must be an object.');
  }

  const result = await invokeManifestActivity({
    manifest,
    publicManifest,
    activityName,
    event,
    context,
    executionMode: loaded.source === 'embedded' ? 'embedded' : 'source',
  });

  return {
    manifest: publicManifest,
    result,
  };
}

/**
 * @param {PackageLocalAppOptions} options - options.
 * @returns {Promise<PackageLocalAppResult>} - Result.
 */
export async function packageLocalApp(options) {
  let loaded = await loadApp({ dir: options.dir });
  let manifest = cloneJson(loaded.publicManifest);

  const availableTargets = Array.isArray(manifest.targets)
    ? manifest.targets
    : [];
  if (availableTargets.length === 0) {
    throw new Error(
      'App has no build targets. Define targets in wharfie.app.js before packaging.',
    );
  }

  const selectedTargets = selectTargets(
    availableTargets,
    options.targetFilters,
  ).map((target) =>
    assertSupportedSeaTarget({
      ...target,
      nodeVersion: assertSeaNodeVersionCompatible(target.nodeVersion),
    }),
  );
  if (selectedTargets.length === 0) {
    throw new Error('No targets matched the requested package filter.');
  }
  const selectedTargetKeys = selectedTargets.map((target) =>
    getTargetKey(target),
  );
  if (new Set(selectedTargetKeys).size !== selectedTargetKeys.length) {
    throw new Error(
      'App build targets must be unique after platform and architecture normalization.',
    );
  }

  const requestedTargetSelectors = selectedTargets.map((target) =>
    ActorSystem.getBuildTargetSelector(target),
  );
  if (
    loaded.appExport instanceof ActorSystem &&
    Array.isArray(options.targetFilters) &&
    options.targetFilters.length > 0 &&
    requestedTargetSelectors.length > 0
  ) {
    loaded = await loadApp({
      dir: options.dir,
      requestedTargetSelectors,
    });
    manifest = cloneJson(loaded.publicManifest);
  }

  assertPortableManifestContract(manifest);

  const actorSystem = toPackageableActorSystem(loaded);
  applyPackagingSigningConfig(actorSystem, loaded.appExport);
  applyTargetSelection(actorSystem, selectedTargets);
  manifest.targets = selectedTargets.map((target) => cloneTarget(target));
  assertManifestIsSecretFree(loaded.manifest);
  assertManifestIsSecretFree(manifest);

  const builds = getSeaBuildResources(actorSystem);
  const outputDir = path.resolve(
    options.outputDir || path.join(options.dir, 'dist'),
  );
  await fsp.mkdir(outputDir, { recursive: true });

  const packagingAssets = await resolvePackagingAssets({
    appExport: loaded.appExport,
    appDir: path.resolve(options.dir),
    outputDir,
    manifest: loaded.manifest,
    publicManifest: loaded.publicManifest,
  });

  /** @type {import('../../core/resources/builds/lib/app-manifest-asset.js').EmbeddedAppManifestAsset[]} */
  let manifestAssets = [];
  /** @type {PackageLocalAppResult | undefined} */
  let packageResult;
  /** @type {PackageArtifactTransaction | undefined} */
  let artifactTransaction;
  /** @type {string | undefined} */
  let publicationLockPath;
  let preserveArtifactTransaction = false;
  /** @type {unknown} */
  let packageError;

  try {
    publicationLockPath = await acquirePackagePublicationLock(
      manifest.app.name,
      outputDir,
    );
    if (typeof actorSystem.initializeEnvironment === 'function') {
      await actorSystem.initializeEnvironment();
    }
    manifestAssets = await attachEmbeddedManifestAssets(
      builds,
      manifest,
      packagingAssets,
    );
    await actorSystem.reconcile();

    if (builds.length === 0) {
      throw new Error(
        'App reconcile completed but no packaged binaries were discovered.',
      );
    }

    artifactTransaction = await stagePackageArtifacts(
      builds,
      manifest.app.name,
      outputDir,
    );
    await removePackageOwnedSeaBuildOutputs(builds);
    const artifacts = await publishStagedArtifacts(artifactTransaction);

    packageResult = {
      app: manifest.app,
      ...(Array.isArray(manifest.targets) ? { targets: manifest.targets } : {}),
      outputDir,
      artifacts,
    };
  } catch (error) {
    packageError = error;
    preserveArtifactTransaction =
      error instanceof ArtifactPublicationRecoveryError;
  }

  const functionAssetPaths = Array.from(
    new Set(
      actorSystem
        .getResources()
        .filter((resource) => resource instanceof FunctionResource)
        .map((resource) => resource.get('singleExecutableAssetPath'))
        .filter((assetPath) => typeof assetPath === 'string' && assetPath),
    ),
  );
  const cleanupResults = await Promise.allSettled([
    ...manifestAssets.map((asset) => asset.cleanup()),
    ...functionAssetPaths.map((assetPath) =>
      fsp.rm(assetPath, { force: true }),
    ),
    ...(artifactTransaction && !preserveArtifactTransaction
      ? [
          fsp.rm(artifactTransaction.stagingDir, {
            force: true,
            recursive: true,
          }),
        ]
      : []),
  ]);
  const cleanupErrors = cleanupResults
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);

  if (publicationLockPath) {
    try {
      await releasePackagePublicationLock(publicationLockPath);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (packageError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [packageError, ...cleanupErrors],
      'Application packaging failed and temporary asset cleanup was incomplete.',
    );
  }
  if (packageError) throw packageError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'Application packaging completed but temporary asset cleanup was incomplete.',
    );
  }

  return /** @type {PackageLocalAppResult} */ (packageResult);
}
