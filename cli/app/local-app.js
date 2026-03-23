import { promises as fsp } from 'node:fs';
import path from 'node:path';

import ActorSystem from '../../lambdas/lib/actor/resources/builds/actor-system.js';
import SeaBuild from '../../lambdas/lib/actor/resources/builds/sea-build.js';
import { withResourceScope } from '../../lambdas/lib/actor/resources/resource-scope.js';
import { createResourceScope } from '../../lambdas/lib/actor/resources/runtime-config.js';
import {
  APP_MANIFEST_ASSET_NAME,
  writeEmbeddedAppManifestAsset,
} from '../../lambdas/lib/actor/resources/builds/lib/app-manifest-asset.js';

import { loadApp } from './load-app.js';

/**
 * @typedef JsonPrintOptions
 * @property {boolean} [pretty] - pretty.
 */

/**
 * @typedef RunLocalAppOptions
 * @property {string} dir - App directory.
 * @property {string} functionName - Function name.
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
 * @param {any} appExport - appExport.
 * @returns {void}
 */
function assertRunnableApp(appExport) {
  if (!appExport || typeof appExport.invoke !== 'function') {
    throw new Error(
      'App is not runnable. Expected a default export with invoke(functionName, event, context).',
    );
  }
}

/**
 * @param {any} appExport - appExport.
 * @param {{ app: { name: string }, targets?: PackageArtifactTarget[] }} manifest - manifest.
 * @returns {ActorSystem} - Result.
 */
function assertPackageableApp(appExport, manifest) {
  if (!(appExport instanceof ActorSystem)) {
    throw new Error(
      'App packaging currently supports ActorSystem exports only.',
    );
  }

  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) {
    throw new Error(
      'App has no build targets. Define properties.targets in wharfie.app.js before packaging.',
    );
  }

  return appExport;
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
 * @returns {Promise<void>} - Result.
 */
async function attachEmbeddedManifestAssets(builds, manifest) {
  await Promise.all(
    builds.map(async (build) => {
      const buildTarget = getBuildTarget(build);
      const embeddedManifest = {
        ...manifest,
        ...(Array.isArray(manifest.targets)
          ? { targets: [cloneTarget(buildTarget)] }
          : {}),
      };
      const manifestAssetPath =
        await writeEmbeddedAppManifestAsset(embeddedManifest);
      const originalAssets = build.properties?.assets;
      build._setUNSAFE('assets', () => ({
        ...resolveBuildAssets(build, originalAssets),
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
  const { appExport, manifest } = await loadApp({ dir: options.dir });
  assertRunnableApp(appExport);

  const eventSource = options.eventInput ?? options.stdinInput;
  const event = parseJsonInput(eventSource, 'event', {});
  const context = parseJsonInput(options.contextInput, 'context', {});

  if (!isObjectRecord(context)) {
    throw new Error('Context JSON must be an object.');
  }

  try {
    const result = await appExport.invoke(options.functionName, event, context);
    return { manifest, result };
  } finally {
    if (typeof appExport.closeRuntimeResources === 'function') {
      await appExport.closeRuntimeResources();
    }
  }
}

/**
 * @param {PackageLocalAppOptions} options - options.
 * @returns {Promise<PackageLocalAppResult>} - Result.
 */
export async function packageLocalApp(options) {
  let { appExport, manifest } = await loadApp({ dir: options.dir });
  let actorSystem = assertPackageableApp(appExport, manifest);

  const selectedTargets = selectTargets(
    manifest.targets || [],
    options.targetFilters,
  );
  if (selectedTargets.length === 0) {
    throw new Error('No targets matched the requested package filter.');
  }

  const requestedTargetSelectors = selectedTargets.map((target) =>
    ActorSystem.getBuildTargetSelector(target),
  );
  if (
    Array.isArray(options.targetFilters) &&
    options.targetFilters.length > 0 &&
    requestedTargetSelectors.length > 0
  ) {
    ({ appExport, manifest } = await loadApp({
      dir: options.dir,
      requestedTargetSelectors,
    }));
    actorSystem = assertPackageableApp(appExport, manifest);
  }

  applyTargetSelection(actorSystem, selectedTargets);
  manifest.targets = selectedTargets.map((target) => cloneTarget(target));

  const builds = getSeaBuildResources(actorSystem);
  await attachEmbeddedManifestAssets(builds, manifest);

  if (typeof actorSystem.initializeEnvironment === 'function') {
    await actorSystem.initializeEnvironment();
  }
  await actorSystem.reconcile();

  if (builds.length === 0) {
    throw new Error(
      'App reconcile completed but no packaged binaries were discovered.',
    );
  }

  const outputDir = path.resolve(
    options.outputDir || path.join(options.dir, 'dist'),
  );
  await fsp.mkdir(outputDir, { recursive: true });

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
