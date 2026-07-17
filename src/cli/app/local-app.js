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
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
  createEmbeddedRevisionRuntimeAssets,
} from '../../core/resources/builds/lib/revision-runtime-assets.js';
import FunctionResource from '../../core/resources/builds/function-resource.js';
import { assertSeaNodeVersionCompatible } from '../../core/resources/builds/lib/sea-node-version.js';
import { withResourceScope } from '../../core/resources/resource-scope.js';
import { WHARFIE_VERSION } from '../../core/lib/version.js';
import { validateAppManifest } from '../../core/runtime/app-manifest.js';
import { sortCanonicalJsonValue } from '../../core/runtime/canonical-order.js';
import {
  createArtifactRecord,
  validateArtifactRecord,
} from '../../core/runtime/artifact-record.js';
import {
  createManifestActivityFunction,
  getManifestActivityNames,
  getManifestResourcesSpec,
  invokeManifestActivity,
} from '../../core/runtime/app-runs.js';

import { prepareApplicationRevision } from './compile-application-revision.js';
import { createArtifactProvenance } from './artifact-provenance.js';
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
 * @property {string | undefined} [eventInput] - Event JSON string.
 * @property {string | undefined} [contextInput] - Context JSON string.
 * @property {string | undefined} [stdinInput] - STDIN payload.
 */

/**
 * @typedef LoadedAppForCommand
 * @property {string} [appDir] - Source application directory.
 * @property {any} manifest - manifest.
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
 * @property {string} recordPath - Canonical artifact-record sidecar path.
 * @property {PackageArtifactTarget} target - target.
 * @property {string} artifactId - Exact final-byte identity.
 * @property {string} revisionId - Owning logical revision.
 * @property {{ algorithm: 'sha256', value: string }} byteDigest - Exact final-byte digest.
 * @property {number} size - Exact artifact byte length.
 * @property {import('../../core/runtime/artifact-record.js').ArtifactRecord} record - Immutable artifact record and provenance.
 */

/**
 * @typedef PackageLocalAppOptions
 * @property {string} dir - dir.
 * @property {string} [outputDir] - outputDir.
 * @property {string[]} [targetFilters] - targetFilters.
 * @property {LocalAppBuildConfig} [build] - Ephemeral build request; never embedded in the app manifest.
 */

/**
 * @typedef LocalAppBuildContext
 * @property {string} appDir - App directory.
 * @property {string} outputDir - Output directory.
 * @property {Record<string, any>} manifest - Canonical compiled manifest.
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
 * @typedef LocalAppBuildConfig
 * @property {LocalAppSigningConfig} [signing] - Artifact signing configuration.
 * @property {Record<string, string> | ((context: LocalAppBuildContext) => Record<string, string>)} [assets] - Additional SEA assets to embed.
 */

/**
 * @typedef PackageLocalAppResult
 * @property {{ id: string }} app - App identity.
 * @property {import('../../core/runtime/application-revision.js').ApplicationRevision} revision - Immutable target-independent application revision.
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
    manifest,
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
 * @param {LocalAppBuildConfig | undefined} build - Ephemeral build request.
 * @returns {LocalAppMacOSSigningConfig | undefined} - Result.
 */
function getPackagingMacOSSigningConfig(build) {
  if (!isObjectRecord(build?.signing)) {
    return undefined;
  }

  return isObjectRecord(build.signing.macos)
    ? /** @type {LocalAppMacOSSigningConfig} */ (build.signing.macos)
    : undefined;
}

/**
 * @param {ActorSystem} actorSystem - actorSystem.
 * @param {LocalAppBuildConfig | undefined} build - Ephemeral build request.
 * @returns {void} - Result.
 */
function applyPackagingSigningConfig(actorSystem, build) {
  const signing = getPackagingMacOSSigningConfig(build);
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
 * @param {{ build?: LocalAppBuildConfig, appDir: string, outputDir: string, manifest: Record<string, any> }} options - options.
 * @returns {Promise<Record<string, string>>} - Validated absolute asset paths.
 */
async function resolvePackagingAssets(options) {
  const config = options.build || {};
  const assets =
    typeof config.assets === 'function'
      ? config.assets({
          appDir: options.appDir,
          outputDir: options.outputDir,
          manifest: options.manifest,
        })
      : config.assets;

  const normalized = normalizePackagingAssets(assets);
  const reservedNames = new Set([
    APP_MANIFEST_ASSET_NAME,
    ...Object.keys(
      isObjectRecord(options.manifest.activities)
        ? options.manifest.activities
        : {},
    ),
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
 * @returns {string} - Result.
 */
function resolveActivityName(options, manifest) {
  const activityName =
    typeof options.activityName === 'string' ? options.activityName : '';

  if (activityName) {
    return activityName;
  }

  const availableActivities = getManifestActivityNames(manifest);
  if (availableActivities.length === 1) {
    return availableActivities[0];
  }

  throw new Error('Activity name is required.');
}

/**
 * @param {any} manifest - Public application manifest.
 * @returns {void}
 */
function assertPortableManifestContract(manifest) {
  validateAppManifest(manifest);
}

/**
 * @param {{ appDir: string, manifest: any }} loaded - loaded.
 * @returns {ActorSystem} - Result.
 */
function toPackageableActorSystem(loaded) {
  const manifest = loaded.manifest;
  const cliEntrypoint =
    typeof manifest?.cli?.entrypoint?.path === 'string' &&
    manifest.cli.entrypoint.path
      ? path.resolve(loaded.appDir, manifest.cli.entrypoint.path)
      : undefined;
  const cliExportName =
    typeof manifest?.cli?.entrypoint?.export === 'string' &&
    manifest.cli.entrypoint.export
      ? manifest.cli.entrypoint.export
      : undefined;

  if (!cliEntrypoint) {
    throw new Error(
      'Manifest-defined app packaging requires cli.entrypoint in wharfie.app.js.',
    );
  }

  const functions = getManifestActivityNames(manifest).map((activityName) =>
    createManifestActivityFunction({
      manifest,
      activityName,
      appDir: loaded.appDir,
    }),
  );

  const properties = /** @type {any} */ ({
    targets: Array.isArray(manifest.targets) ? manifest.targets : [],
    resources: getManifestResourcesSpec(manifest),
    cli: {
      entrypoint: cliEntrypoint,
      export: cliExportName,
    },
  });

  return new ActorSystem({
    name: manifest.app.id,
    functions,
    properties,
  });
}

/**
 * @param {import('../../core/runtime/artifact-record.js').ArtifactRecord} record - Exact artifact record.
 * @param {string} appName - appName.
 * @returns {string} - Result.
 */
function getArtifactFileName(record, appName) {
  const safeAppName = getSafeArtifactAppName(appName);
  const digestHex = Buffer.from(record.byteDigest.value, 'base64url').toString(
    'hex',
  );
  const extension = record.target.platform === 'win32' ? '.exe' : '';
  return `${safeAppName}-sha256-${digestHex}${extension}`;
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
 * @property {string} stagedRecordPath - Private canonical record sidecar.
 * @property {string} finalRecordPath - Public record sidecar destination.
 * @property {PackageArtifactTarget} target - Artifact target.
 * @property {import('../../core/runtime/artifact-record.js').ArtifactRecord} record - Exact artifact record.
 */

/**
 * @typedef PackageArtifactTransaction
 * @property {string} stagingDir - Private transaction directory.
 * @property {import('../../core/runtime/application-revision.js').ApplicationRevision} revision - Owning application revision.
 * @property {StagedPackageArtifact[]} artifacts - Fully staged artifacts.
 */

/**
 * Publication failed and one or more newly created immutable artifacts could
 * not be removed. The transaction directory is retained for inspection.
 */
class ArtifactPublicationRecoveryError extends AggregateError {
  /**
   * @param {unknown[]} errors - Publication and rollback errors.
   * @param {string} recoveryPath - Preserved transaction directory.
   */
  constructor(errors, recoveryPath) {
    super(
      errors,
      `Artifact publication failed and one or more newly published immutable artifacts could not be removed. Recovery files have been preserved at '${recoveryPath}'.`,
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
 * @param {unknown} value - JSON value.
 * @returns {string} - Canonical compact JSON for equality checks.
 */
function stringifyCanonicalJson(value) {
  return JSON.stringify(sortCanonicalJsonValue(value));
}

/**
 * Read, validate, and compare one durable artifact-record sidecar.
 * @param {string} recordPath - Record sidecar path.
 * @param {import('../../core/runtime/artifact-record.js').ArtifactRecord} expectedRecord - Newly derived immutable association.
 * @param {Buffer} artifactBytes - Exact associated artifact bytes.
 * @param {import('../../core/runtime/application-revision.js').ApplicationRevision} revision - Trusted owning revision.
 * @param {string} label - Human-readable record label.
 * @returns {Promise<void>}
 */
async function assertMatchingArtifactRecordSidecar(
  recordPath,
  expectedRecord,
  artifactBytes,
  revision,
  label,
) {
  await assertRegularArtifactFile(recordPath, label);
  let candidate;
  try {
    candidate = JSON.parse(await fsp.readFile(recordPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid JSON: ${message}`);
  }
  const validated = validateArtifactRecord(
    candidate,
    { bytes: artifactBytes, revision },
    label,
  );
  if (
    stringifyCanonicalJson(validated) !== stringifyCanonicalJson(expectedRecord)
  ) {
    throw new Error(
      `${label} conflicts with the immutable artifact association being published.`,
    );
  }
}

/**
 * Copy every reconciled binary into a private directory on the destination
 * filesystem. Public output paths remain untouched until the entire artifact
 * set has been copied and verified.
 * @param {{ builds: SeaBuild[], appName: string, outputDir: string, actorSystem: ActorSystem, revision: import('../../core/runtime/application-revision.js').ApplicationRevision }} options - Staging inputs.
 * @returns {Promise<PackageArtifactTransaction>} - Result.
 */
async function stagePackageArtifacts(options) {
  const { builds, appName, outputDir, actorSystem, revision } = options;
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

      const artifactBytes = await fsp.readFile(sourcePath);
      const target = getBuildTarget(build);
      const provenance = await createArtifactProvenance({
        build,
        actorSystem,
        revision,
        builderVersion: WHARFIE_VERSION,
      });
      const record = createArtifactRecord({
        bytes: artifactBytes,
        revision,
        target,
        provenance,
      });
      const fileName = getArtifactFileName(record, appName);
      if (fileNames.has(fileName)) {
        throw new Error(
          `Multiple builds resolved to artifact file name '${fileName}'.`,
        );
      }
      fileNames.add(fileName);

      const stagedPath = path.join(readyDir, fileName);
      const finalPath = path.join(outputDir, fileName);
      const stagedRecordPath = `${stagedPath}.artifact.json`;
      const finalRecordPath = `${finalPath}.artifact.json`;
      await fsp.copyFile(sourcePath, stagedPath);
      if (build.get('platform') !== 'win32') {
        await fsp.chmod(stagedPath, 0o755);
      }
      await assertRegularArtifactFile(
        stagedPath,
        `Staged artifact '${fileName}'`,
      );
      validateArtifactRecord(
        record,
        { bytes: await fsp.readFile(stagedPath), revision },
        `Staged artifact '${fileName}' record`,
      );
      await fsp.writeFile(
        stagedRecordPath,
        `${JSON.stringify(sortCanonicalJsonValue(record), null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      await assertMatchingArtifactRecordSidecar(
        stagedRecordPath,
        record,
        await fsp.readFile(stagedPath),
        revision,
        `Staged artifact '${fileName}' record sidecar`,
      );

      artifacts.push({
        fileName,
        stagedPath,
        finalPath,
        stagedRecordPath,
        finalRecordPath,
        target,
        record,
      });
    }

    return { stagingDir, revision, artifacts };
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
 * Publish a fully staged immutable artifact set. A matching content-addressed
 * destination is verified and reused; it is never overwritten. If a later
 * create-if-absent link fails, only destinations created by this transaction
 * are removed.
 * @param {PackageArtifactTransaction} transaction - transaction.
 * @returns {Promise<PackageArtifactSummary[]>} - Published artifact summaries.
 */
async function publishStagedArtifacts(transaction) {
  /** @type {{ artifact: StagedPackageArtifact, artifactReused: boolean, recordReused: boolean }[]} */
  const publicationPlan = [];

  for (const artifact of transaction.artifacts) {
    await assertRegularArtifactFile(
      artifact.stagedPath,
      `Staged artifact '${artifact.fileName}'`,
    );
    await assertRegularArtifactFile(
      artifact.stagedRecordPath,
      `Staged artifact '${artifact.fileName}' record sidecar`,
    );
    const destinationStats = await lstatIfExists(artifact.finalPath);
    const destinationRecordStats = await lstatIfExists(
      artifact.finalRecordPath,
    );
    if (destinationStats && !destinationStats.isFile()) {
      throw new Error(
        `Artifact destination '${artifact.finalPath}' must be a regular file when it already exists.`,
      );
    }
    if (destinationRecordStats && !destinationRecordStats.isFile()) {
      throw new Error(
        `Artifact record destination '${artifact.finalRecordPath}' must be a regular file when it already exists.`,
      );
    }
    if (destinationRecordStats && !destinationStats) {
      throw new Error(
        `Artifact record '${artifact.finalRecordPath}' exists without its immutable artifact '${artifact.finalPath}'.`,
      );
    }
    if (destinationStats) {
      const destinationBytes = await fsp.readFile(artifact.finalPath);
      validateArtifactRecord(
        artifact.record,
        {
          bytes: destinationBytes,
          revision: transaction.revision,
        },
        `Existing artifact '${artifact.fileName}' record`,
      );
      if (destinationRecordStats) {
        await assertMatchingArtifactRecordSidecar(
          artifact.finalRecordPath,
          artifact.record,
          destinationBytes,
          transaction.revision,
          `Existing artifact '${artifact.fileName}' record sidecar`,
        );
      }
    }
    publicationPlan.push({
      artifact,
      artifactReused: !!destinationStats,
      recordReused: !!destinationRecordStats,
    });
  }

  /** @type {string[]} */
  const publishedPaths = [];

  try {
    for (const item of publicationPlan) {
      if (!item.artifactReused) {
        await fsp.link(item.artifact.stagedPath, item.artifact.finalPath);
        publishedPaths.push(item.artifact.finalPath);
      }
      await fsp.rm(item.artifact.stagedPath, { force: true });

      if (!item.recordReused) {
        await fsp.link(
          item.artifact.stagedRecordPath,
          item.artifact.finalRecordPath,
        );
        publishedPaths.push(item.artifact.finalRecordPath);
      }
      await fsp.rm(item.artifact.stagedRecordPath, { force: true });
    }
  } catch (error) {
    /** @type {unknown[]} */
    const rollbackErrors = [];

    for (const publishedPath of [...publishedPaths].reverse()) {
      try {
        await fsp.rm(publishedPath, { force: true });
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
    recordPath: artifact.finalRecordPath,
    target: artifact.target,
    artifactId: artifact.record.artifactId,
    revisionId: artifact.record.revisionId,
    byteDigest: artifact.record.byteDigest,
    size: artifact.record.size,
    record: artifact.record,
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
 * @param {import('../../core/runtime/application-revision.js').ApplicationRevision} revision - Target-independent application revision.
 * @param {Record<string, string>} [additionalAssets] - additionalAssets.
 * @returns {Promise<Array<{ cleanup: () => Promise<void> }>>} - Temporary asset handles.
 */
async function attachEmbeddedManifestAssets(
  builds,
  manifest,
  revision,
  additionalAssets = {},
) {
  /** @type {Array<{ cleanup: () => Promise<void> }>} */
  const temporaryAssets = [];

  try {
    for (const build of builds) {
      const buildTarget = getBuildTarget(build);
      const embeddedManifest = {
        ...cloneJson(manifest),
        ...(Array.isArray(manifest.targets)
          ? { targets: [cloneTarget(buildTarget)] }
          : {}),
      };
      const manifestAsset =
        await createEmbeddedAppManifestAsset(embeddedManifest);
      temporaryAssets.push(manifestAsset);
      const revisionRuntimeAssets = await createEmbeddedRevisionRuntimeAssets({
        revision,
        runtime: {
          schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
          kind: ARTIFACT_RUNTIME_KIND,
          appId: revision.contract.app.id,
          revisionId: revision.revisionId,
          target: buildTarget,
        },
      });
      temporaryAssets.push(revisionRuntimeAssets);
      const originalAssets = build.properties?.assets;
      build._setUNSAFE('assets', () => ({
        ...resolveBuildAssets(build, originalAssets),
        ...additionalAssets,
        [APP_MANIFEST_ASSET_NAME]: manifestAsset.path,
        ...revisionRuntimeAssets.assets,
      }));
    }
  } catch (error) {
    const cleanupResults = await Promise.allSettled(
      temporaryAssets.map((asset) => asset.cleanup()),
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

  return temporaryAssets;
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
  const { manifest } = loaded;
  const activityName = resolveActivityName(options, manifest);
  const eventSource = options.eventInput ?? options.stdinInput;
  const event = parseJsonInput(eventSource, 'event', {});
  const context = parseJsonInput(options.contextInput, 'context', {});

  if (!isObjectRecord(context)) {
    throw new Error('Context JSON must be an object.');
  }

  const result = await invokeManifestActivity({
    manifest,
    appDir: loaded.appDir,
    activityName,
    event,
    context,
    executionMode: loaded.source === 'embedded' ? 'embedded' : 'source',
  });

  return {
    manifest,
    result,
  };
}

/**
 * @param {PackageLocalAppOptions} options - options.
 * @returns {Promise<PackageLocalAppResult>} - Result.
 */
export async function packageLocalApp(options) {
  const loaded = await loadApp({ dir: options.dir });
  const manifest = cloneJson(loaded.manifest);

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

  assertPortableManifestContract(manifest);

  const outputDir = path.resolve(
    options.outputDir || path.join(options.dir, 'dist'),
  );
  await fsp.mkdir(outputDir, { recursive: true });

  const packagingAssets = await resolvePackagingAssets({
    build: options.build,
    appDir: path.resolve(options.dir),
    outputDir,
    manifest: loaded.manifest,
  });
  const preparedRevision = await prepareApplicationRevision({
    appDir: loaded.appDir,
    manifest: loaded.manifest,
    outputDir,
    assets: packagingAssets,
  });
  const { revision } = preparedRevision;

  let actorSystem;
  try {
    actorSystem = toPackageableActorSystem({
      appDir: preparedRevision.appDir,
      manifest: preparedRevision.manifest,
    });
    applyPackagingSigningConfig(actorSystem, options.build);
    applyTargetSelection(actorSystem, selectedTargets);
    manifest.targets = selectedTargets.map((target) => cloneTarget(target));
  } catch (error) {
    await preparedRevision.cleanup();
    throw error;
  }

  const builds = getSeaBuildResources(actorSystem);

  /** @type {Array<{ cleanup: () => Promise<void> }>} */
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
      manifest.app.id,
      outputDir,
    );
    if (typeof actorSystem.initializeEnvironment === 'function') {
      await actorSystem.initializeEnvironment();
    }
    manifestAssets = await attachEmbeddedManifestAssets(
      builds,
      manifest,
      revision,
      preparedRevision.assets,
    );
    await actorSystem.reconcile();
    await preparedRevision.verifyRuntime();

    if (builds.length === 0) {
      throw new Error(
        'App reconcile completed but no packaged binaries were discovered.',
      );
    }

    artifactTransaction = await stagePackageArtifacts({
      builds,
      appName: manifest.app.id,
      outputDir,
      actorSystem,
      revision,
    });
    await removePackageOwnedSeaBuildOutputs(builds);
    const artifacts = await publishStagedArtifacts(artifactTransaction);

    packageResult = {
      app: manifest.app,
      revision,
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
    preparedRevision.cleanup(),
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
