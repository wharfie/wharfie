import { promises as fsp } from 'node:fs';
import path from 'node:path';

import ActorSystem from '../../core/resources/builds/actor-system.js';
import FunctionResource from '../../core/resources/builds/function-resource.js';
import WharfieFunction from '../../core/resources/builds/function.js';
import SeaBuild from '../../core/resources/builds/sea-build.js';
import {
  APP_MANIFEST_ASSET_NAME,
  writeEmbeddedAppManifestAsset,
} from '../../core/resources/builds/lib/app-manifest-asset.js';
import { createPackagedAppEntryCode } from '../../core/resources/builds/lib/packaged-app-entry-code.js';
import { withResourceScope } from '../../core/resources/resource-scope.js';
import { createResourceScope } from '../../core/resources/runtime-config.js';
import { createActorSystemResources } from '../../core/runtime/resources.js';

import { loadApp } from './load-app.js';

/**
 * @typedef JsonPrintOptions
 * @property {boolean} [pretty] - pretty.
 */

/**
 * @typedef RunLocalAppOptions
 * @property {string} dir - App directory.
 * @property {string} activityName - Activity name.
 * @property {string | undefined} [eventInput] - Event JSON string.
 * @property {string | undefined} [contextInput] - Context JSON string.
 * @property {string | undefined} [stdinInput] - STDIN payload.
 */

/**
 * @typedef {import('node:process')['platform']} PackageArtifactPlatform
 * @typedef {import('node:process')['arch']} PackageArtifactArchitecture
 * @typedef {import('detect-libc').GLIBC|import('detect-libc').MUSL} PackageArtifactLibc
 */

/**
 * @typedef PackageArtifactTarget
 * @property {string} nodeVersion - nodeVersion.
 * @property {PackageArtifactPlatform} platform - platform.
 * @property {PackageArtifactArchitecture} architecture - architecture.
 * @property {PackageArtifactLibc} [libc] - libc.
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
 * @param {{ functions?: { name: string }[] }} manifest - manifest.
 * @returns {string[]} - Result.
 */
function getAvailableActivityNames(manifest) {
  if (!Array.isArray(manifest.functions)) {
    return [];
  }

  return manifest.functions
    .map((func) => (typeof func?.name === 'string' ? func.name.trim() : ''))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * @param {{ functions?: any[] }} manifest - manifest.
 * @param {string} activityName - activityName.
 * @returns {any} - Result.
 */
function getManifestActivityDefinition(manifest, activityName) {
  const trimmedName = String(activityName || '').trim();
  const functions = Array.isArray(manifest.functions) ? manifest.functions : [];
  const definition = functions.find(
    (func) =>
      typeof func?.name === 'string' && func.name.trim() === trimmedName,
  );

  if (definition) {
    return definition;
  }

  const availableActivities = getAvailableActivityNames(manifest);
  const suggestions = availableActivities.length
    ? ` Available activities: ${availableActivities.join(', ')}`
    : '';
  throw new Error(`Unknown activity '${trimmedName}'.${suggestions}`);
}

/**
 * @param {any} manifestFunction - manifestFunction.
 * @returns {WharfieFunction} - Result.
 */
function createManifestActivity(manifestFunction) {
  return new WharfieFunction({
    name: manifestFunction.name,
    entrypoint: manifestFunction.entrypoint,
    properties: {
      ...(Array.isArray(manifestFunction.external)
        ? { external: manifestFunction.external }
        : {}),
      ...(isObjectRecord(manifestFunction.environmentVariables)
        ? { environmentVariables: manifestFunction.environmentVariables }
        : {}),
      ...(isObjectRecord(manifestFunction.resources)
        ? { resources: manifestFunction.resources }
        : {}),
    },
  });
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
function getManifestResourceSpecs(manifest) {
  if (isObjectRecord(manifest?.resources)) {
    return manifest.resources;
  }
  if (isObjectRecord(manifest?.capabilities)) {
    return manifest.capabilities;
  }
  return {};
}

/**
 * @param {any} manifest - manifest.
 * @returns {Promise<{ resources: Record<string, any>, close: () => Promise<void> }>} - Result.
 */
function createManifestRuntimeResources(manifest) {
  return createActorSystemResources(getManifestResourceSpecs(manifest));
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
    platform: /** @type {PackageArtifactPlatform} */ (target.platform),
    architecture: /** @type {PackageArtifactArchitecture} */ (
      target.architecture
    ),
    ...(typeof target.libc === 'string'
      ? { libc: /** @type {PackageArtifactLibc} */ (target.libc) }
      : {}),
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
    platform: /** @type {PackageArtifactPlatform} */ (build.get('platform')),
    architecture: /** @type {PackageArtifactArchitecture} */ (
      build.get('architecture')
    ),
    ...(build.has('libc')
      ? { libc: /** @type {PackageArtifactLibc} */ (build.get('libc')) }
      : {}),
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
 * @param {any} manifest - manifest.
 * @returns {void}
 */
function assertPackageableManifest(manifest) {
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) {
    throw new Error(
      'App has no build targets. Define targets in wharfie.app.js before packaging.',
    );
  }
}

/**
 * @param {PackageArtifactTarget} target - target.
 * @returns {boolean} - Result.
 */
function isCurrentHostTarget(target) {
  const targetPlatform = String(target.platform);
  const targetArchitecture = String(target.architecture);
  const targetNodeVersion = String(target.nodeVersion).replace(/^v/, '');
  const currentNodeVersion = String(process.versions.node).replace(/^v/, '');

  return (
    targetPlatform === process.platform &&
    targetArchitecture === process.arch &&
    (targetNodeVersion === currentNodeVersion ||
      targetNodeVersion === currentNodeVersion.split('.')[0])
  );
}

/**
 * @param {PackageArtifactTarget[]} targets - targets.
 * @returns {void}
 */
function assertPlainObjectTargetsAreSupported(targets) {
  const unsupported = targets.filter((target) => !isCurrentHostTarget(target));
  if (unsupported.length === 0) {
    return;
  }

  throw new Error(
    `Manifest-defined CLI app packaging currently supports only the current host target (${ActorSystem.getBuildTargetSelector(
      {
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
      },
    )}). Unsupported target(s): ${unsupported
      .map((target) => ActorSystem.getBuildTargetSelector(target))
      .join(', ')}`,
  );
}

/**
 * @param {any} manifest - manifest.
 * @returns {void}
 */
function assertPlainObjectPackageableManifest(manifest) {
  assertPackageableManifest(manifest);

  if (
    !isObjectRecord(manifest.cli) ||
    typeof manifest.cli.entrypoint !== 'string'
  ) {
    throw new Error(
      'Manifest-defined CLI app packaging requires cli.entrypoint in wharfie.app.js.',
    );
  }
}

/**
 * @param {any} manifest - manifest.
 * @param {PackageArtifactTarget} target - target.
 * @returns {FunctionResource[]} - Result.
 */
function createManifestFunctionResources(manifest, target) {
  /** @type {any[]} */
  const functions = Array.isArray(manifest.functions) ? manifest.functions : [];

  return functions.map(
    (/** @type {any} */ func) =>
      new FunctionResource({
        name: `${func.name}-${target.nodeVersion}-${target.platform}-${target.architecture}`,
        properties: {
          functionName: func.name,
          entrypoint: func.entrypoint,
          ...(Array.isArray(func.external) ? { external: func.external } : {}),
          ...(isObjectRecord(func.environmentVariables)
            ? { environmentVariables: func.environmentVariables }
            : {}),
          ...(isObjectRecord(func.resources)
            ? { resources: func.resources }
            : {}),
          buildTarget: () => cloneTarget(target),
        },
      }),
  );
}

/**
 * @param {any} manifest - manifest.
 * @param {PackageArtifactTarget} target - target.
 * @param {FunctionResource[]} functionResources - functionResources.
 * @returns {SeaBuild} - Result.
 */
function createManifestCliBuild(manifest, target, functionResources) {
  const selector = ActorSystem.getBuildTargetSelector(target);
  return new SeaBuild({
    name: `${manifest.app.name}-build-${selector}`,
    dependsOn: [...functionResources],
    properties: {
      entryCode: () =>
        createPackagedAppEntryCode({
          cliEntrypointPath: manifest.cli.entrypoint,
          cliExportName:
            typeof manifest.cli.export === 'string'
              ? manifest.cli.export
              : undefined,
        }),
      resolveDir: () => path.dirname(manifest.cli.entrypoint),
      nodeBinaryPath: () => process.execPath,
      nodeVersion: target.nodeVersion,
      platform: target.platform,
      architecture: target.architecture,
      ...(typeof target.libc === 'string' ? { libc: target.libc } : {}),
      environmentVariables: () => ({}),
      assets: () =>
        functionResources.reduce(
          (/** @type {Record<string, string>} */ acc, func) => {
            acc[
              func.name.replace(
                `-${target.nodeVersion}-${target.platform}-${target.architecture}`,
                '',
              )
            ] = func.get('singleExecutableAssetPath');
            return acc;
          },
          {},
        ),
    },
  });
}

/**
 * @param {(FunctionResource | SeaBuild)[]} resources - resources.
 * @returns {Promise<void>} - Result.
 */
async function initializeBuildResources(resources) {
  await Promise.all(
    resources.map(async (resource) => {
      const maybeInitializable =
        /** @type {{ initializeEnvironment?: () => Promise<void> }} */ (
          resource
        );
      if (typeof maybeInitializable.initializeEnvironment === 'function') {
        await maybeInitializable.initializeEnvironment();
      }
    }),
  );
}

/**
 * @param {any} manifest - manifest.
 * @param {PackageArtifactTarget[]} selectedTargets - selectedTargets.
 * @returns {Promise<Array<{ build: SeaBuild, functionResources: FunctionResource[] }>>} - Result.
 */
async function buildManifestCliArtifacts(manifest, selectedTargets) {
  assertPlainObjectPackageableManifest(manifest);
  assertPlainObjectTargetsAreSupported(selectedTargets);

  /** @type {{ build: SeaBuild, functionResources: FunctionResource[] }[]} */
  const plans = [];

  for (const target of selectedTargets) {
    const functionResources = createManifestFunctionResources(manifest, target);
    const build = createManifestCliBuild(manifest, target, functionResources);
    const allResources = [...functionResources, build];
    await initializeBuildResources(allResources);
    plans.push({ build, functionResources });
  }

  return plans;
}

/**
 * @param {RunLocalAppOptions} options - options.
 * @returns {Promise<{ manifest: any, result: any }>} - Result.
 */
export async function runLocalApp(options) {
  const { manifest } = await loadApp({ dir: options.dir });
  const activityDefinition = getManifestActivityDefinition(
    manifest,
    options.activityName,
  );
  const activity = createManifestActivity(activityDefinition);
  const appRuntimeResources = await createManifestRuntimeResources(manifest);

  const eventSource = options.eventInput ?? options.stdinInput;
  const event = parseJsonInput(eventSource, 'event', {});
  const context = parseJsonInput(options.contextInput, 'context', {});

  if (!isObjectRecord(context)) {
    throw new Error('Context JSON must be an object.');
  }

  try {
    const result = await activity.fn(event, context, {
      baseResources: appRuntimeResources.resources,
    });
    return { manifest, result };
  } finally {
    await activity.closeRuntimeResources();
    await appRuntimeResources.close();
  }
}

/**
 * @param {PackageLocalAppOptions} options - options.
 * @returns {Promise<PackageLocalAppResult>} - Result.
 */
export async function packageLocalApp(options) {
  let { appExport, manifest } = await loadApp({ dir: options.dir });
  assertPackageableManifest(manifest);

  const selectedTargets = selectTargets(
    /** @type {PackageArtifactTarget[]} */ (manifest.targets || []),
    options.targetFilters,
  );
  if (selectedTargets.length === 0) {
    throw new Error('No targets matched the requested package filter.');
  }

  /** @type {SeaBuild[]} */
  let builds = [];
  /** @type {FunctionResource[]} */
  let plainObjectFunctionResources = [];

  if (appExport instanceof ActorSystem) {
    let actorSystem = appExport;
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
      if (!(appExport instanceof ActorSystem)) {
        throw new Error('Filtered packaging expected an ActorSystem export.');
      }
      actorSystem = appExport;
    }

    applyTargetSelection(actorSystem, selectedTargets);
    manifest.targets = selectedTargets.map((target) => cloneTarget(target));

    builds = getSeaBuildResources(actorSystem);
    await attachEmbeddedManifestAssets(builds, manifest);

    if (typeof actorSystem.initializeEnvironment === 'function') {
      await actorSystem.initializeEnvironment();
    }
    await actorSystem.reconcile();
  } else {
    manifest.targets = selectedTargets.map((target) => cloneTarget(target));
    const buildPlans = await buildManifestCliArtifacts(
      manifest,
      selectedTargets,
    );
    builds = buildPlans.map((plan) => plan.build);
    plainObjectFunctionResources = buildPlans.flatMap(
      (plan) => plan.functionResources,
    );
    await attachEmbeddedManifestAssets(builds, manifest);
    for (const functionResource of plainObjectFunctionResources) {
      await functionResource.reconcile();
    }
    for (const build of builds) {
      await build.reconcile();
    }
  }

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

  const manifestTargets = Array.isArray(manifest.targets)
    ? manifest.targets.map((target) =>
        cloneTarget(/** @type {PackageArtifactTarget} */ (target)),
      )
    : undefined;

  return {
    app: manifest.app,
    ...(manifestTargets ? { targets: manifestTargets } : {}),
    outputDir,
    artifacts,
  };
}
