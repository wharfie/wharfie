import { promises as fsp } from 'node:fs';
import path from 'node:path';

import ActorSystem from '../../core/resources/builds/actor-system.js';
import SeaBuild from '../../core/resources/builds/sea-build.js';
import {
  APP_MANIFEST_ASSET_NAME,
  writeEmbeddedAppManifestAsset,
} from '../../core/resources/builds/lib/app-manifest-asset.js';
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
 * @property {string} dir - App directory.
 * @property {string} [activityName] - Activity name.
 * @property {string} [functionName] - Compatibility alias for activity name.
 * @property {string | undefined} [eventInput] - Event JSON string.
 * @property {string | undefined} [contextInput] - Context JSON string.
 * @property {string | undefined} [stdinInput] - STDIN payload.
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
 * @typedef LocalAppPackagingConfig
 * @property {Record<string, any>} [actorSystemProperties] - Additional ActorSystem properties to apply before packaging.
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
 * @returns {Record<string, any>} - Result.
 */
function getPackagingActorSystemProperties(appExport) {
  const config = getLocalAppPackagingConfig(appExport);

  return isObjectRecord(config.actorSystemProperties)
    ? { ...config.actorSystemProperties }
    : {};
}

/**
 * @param {ActorSystem} actorSystem - actorSystem.
 * @param {any} appExport - appExport.
 * @returns {void} - Result.
 */
function applyPackagingActorSystemProperties(actorSystem, appExport) {
  const properties = getPackagingActorSystemProperties(appExport);

  for (const [key, value] of Object.entries(properties)) {
    actorSystem.set(key, value);
  }
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
 * @returns {Record<string, string>} - Result.
 */
function resolvePackagingAssets(options) {
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

  return normalizePackagingAssets(assets);
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
  const safeAppName = String(appName)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
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
 * @param {ActorSystem} actorSystem - actorSystem.
 * @returns {SeaBuild[]} - Result.
 */
function getSeaBuildResources(actorSystem) {
  return actorSystem
    .getResources()
    .filter((resource) => resource instanceof SeaBuild);
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
 * @returns {Promise<void>} - Result.
 */
async function attachEmbeddedManifestAssets(
  builds,
  manifest,
  additionalAssets = {},
) {
  await Promise.all(
    builds.map(async (build) => {
      const buildTarget = getBuildTarget(build);
      const embeddedManifest = {
        ...cloneJson(manifest),
        ...(Array.isArray(manifest.targets)
          ? { targets: [cloneTarget(buildTarget)] }
          : {}),
      };
      const manifestAssetPath =
        await writeEmbeddedAppManifestAsset(embeddedManifest);
      const originalAssets = build.properties?.assets;
      build._setUNSAFE('assets', () => ({
        ...resolveBuildAssets(build, originalAssets),
        ...additionalAssets,
        [APP_MANIFEST_ASSET_NAME]: manifestAssetPath,
      }));
    }),
  );
}

/**
 * @param {RunLocalAppOptions} options - options.
 * @returns {Promise<{ manifest: any, result: any }>} - Result.
 */
export async function runLocalApp(options) {
  const { manifest, publicManifest } = await loadApp({ dir: options.dir });
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
  let actorSystem = toPackageableActorSystem(loaded);
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
  );
  if (selectedTargets.length === 0) {
    throw new Error('No targets matched the requested package filter.');
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
    actorSystem = toPackageableActorSystem(loaded);
    manifest = cloneJson(loaded.publicManifest);
  }

  applyPackagingActorSystemProperties(actorSystem, loaded.appExport);
  applyTargetSelection(actorSystem, selectedTargets);
  manifest.targets = selectedTargets.map((target) => cloneTarget(target));

  const builds = getSeaBuildResources(actorSystem);
  const outputDir = path.resolve(
    options.outputDir || path.join(options.dir, 'dist'),
  );
  await fsp.mkdir(outputDir, { recursive: true });

  const packagingAssets = resolvePackagingAssets({
    appExport: loaded.appExport,
    appDir: path.resolve(options.dir),
    outputDir,
    manifest: loaded.manifest,
    publicManifest: loaded.publicManifest,
  });

  if (typeof actorSystem.initializeEnvironment === 'function') {
    await actorSystem.initializeEnvironment();
  }
  await attachEmbeddedManifestAssets(builds, manifest, packagingAssets);
  await actorSystem.reconcile();

  if (builds.length === 0) {
    throw new Error(
      'App reconcile completed but no packaged binaries were discovered.',
    );
  }

  /** @type {PackageArtifactSummary[]} */
  const artifacts = [];

  for (const build of builds) {
    const sourcePath = build.get('binaryPath');
    if (!sourcePath) {
      throw new Error(`Build '${build.name}' did not expose a binaryPath.`);
    }

    const fileName = getArtifactFileName(build, manifest.app.name);
    const artifactPath = path.join(outputDir, fileName);

    await fsp.copyFile(sourcePath, artifactPath);
    if (build.get('platform') !== 'win32') {
      await fsp.chmod(artifactPath, 0o755);
    }

    artifacts.push({
      fileName,
      path: artifactPath,
      target: getBuildTarget(build),
    });
  }

  return {
    app: manifest.app,
    ...(Array.isArray(manifest.targets) ? { targets: manifest.targets } : {}),
    outputDir,
    artifacts,
  };
}
