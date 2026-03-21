import { promises as fsp } from 'node:fs';
import path from 'node:path';

import ActorSystem from '../../lambdas/lib/actor/resources/builds/actor-system.js';
import SeaBuild from '../../lambdas/lib/actor/resources/builds/sea-build.js';

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
 * @typedef PackageArtifactSummary
 * @property {string} fileName - fileName.
 * @property {string} path - path.
 * @property {{ nodeVersion: string, platform: string, architecture: string, libc?: string }} target - target.
 */

/**
 * @typedef PackageLocalAppResult
 * @property {{ name: string }} app - App metadata.
 * @property {any[]} [targets] - targets.
 * @property {string} outputDir - outputDir.
 * @property {PackageArtifactSummary[]} artifacts - artifacts.
 */

/**
 * @typedef PackageLocalAppOptions
 * @property {string} dir - App directory.
 * @property {string} [outputDir] - outputDir.
 * @property {string[]} [targets] - Build target selectors.
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
 * @param {{ app: { name: string }, targets?: any[] }} manifest - manifest.
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
 * @param {string[] | undefined} targetSelectors - targetSelectors.
 * @returns {string[]} - Result.
 */
function normalizeTargetSelectors(targetSelectors) {
  if (!Array.isArray(targetSelectors)) {
    return [];
  }

  return [
    ...new Set(
      targetSelectors
        .map((selector) => String(selector).trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * @param {any[] | undefined} targets - targets.
 * @returns {string[]} - Result.
 */
function getBuildTargetSelectors(targets) {
  if (!Array.isArray(targets)) {
    return [];
  }

  return Array.from(
    new Set(
      targets.map((target) => ActorSystem.getBuildTargetSelector(target)),
    ),
  );
}

/**
 * @param {string[]} requestedTargetSelectors - requestedTargetSelectors.
 * @param {string[]} availableTargetSelectors - availableTargetSelectors.
 * @returns {void}
 */
function assertKnownTargetSelectors(
  requestedTargetSelectors,
  availableTargetSelectors,
) {
  const missingTargetSelectors = requestedTargetSelectors.filter(
    (targetSelector) => !availableTargetSelectors.includes(targetSelector),
  );
  if (missingTargetSelectors.length === 0) {
    return;
  }

  throw new Error(
    `${
      missingTargetSelectors.length === 1
        ? 'Unknown app build target'
        : 'Unknown app build targets'
    }: ${missingTargetSelectors.join(', ')}. Available targets: ${
      availableTargetSelectors.length > 0
        ? availableTargetSelectors.join(', ')
        : '(none)'
    }`,
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
  const requestedTargetSelectors = normalizeTargetSelectors(options.targets);

  let loadedApp = await loadApp({
    dir: options.dir,
    cacheBust: requestedTargetSelectors.length > 0,
  });

  if (requestedTargetSelectors.length > 0) {
    const availableTargetSelectors = getBuildTargetSelectors(
      loadedApp.manifest.targets,
    );
    assertKnownTargetSelectors(
      requestedTargetSelectors,
      availableTargetSelectors,
    );
    loadedApp = await ActorSystem.withRequestedBuildTargetSelectors(
      requestedTargetSelectors,
      async () =>
        await loadApp({
          dir: options.dir,
          cacheBust: true,
        }),
    );
  }

  const { appExport, manifest } = loadedApp;
  const actorSystem = assertPackageableApp(appExport, manifest);

  if (typeof actorSystem.initializeEnvironment === 'function') {
    await actorSystem.initializeEnvironment();
  }
  await actorSystem.reconcile();

  const builds = getSeaBuildResources(actorSystem);
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

    /** @type {PackageArtifactSummary['target']} */
    const target = {
      nodeVersion: String(build.get('nodeVersion')),
      platform: String(build.get('platform')),
      architecture: String(build.get('architecture')),
    };
    if (build.has('libc')) {
      target.libc = String(build.get('libc'));
    }

    artifacts.push({
      fileName,
      path: artifactPath,
      target,
    });
  }

  artifacts.sort((left, right) => left.fileName.localeCompare(right.fileName));

  return {
    app: manifest.app,
    ...(Array.isArray(manifest.targets) ? { targets: manifest.targets } : {}),
    outputDir,
    artifacts,
  };
}
