import BuildResourceGroup from './build-resource-group.js';
import NodeBinary from './node-binary.js';
import BuildResource from './build-resource.js';
import CoreRuntimeDependenciesResource from './core-runtime-dependencies.js';
import FunctionResource from './function-resource.js';
import SeaBuild from './sea-build.js';
import MacOSBinarySignature from './macos-binary-signature.js';
import {
  getMacOSSigningCredentials,
  setMacOSSigningCredentials,
} from './lib/macos-signing-credentials.js';
import { assertCoreRuntimeDependencyTargetSupported } from './lib/core-runtime-dependency-asset.js';
import operatorCli from './actor-system-cli/index.js';
import { withResourceScope } from '../resource-scope.js';
import { createResourceScope } from '../runtime-config.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const actorSystemMetaUrl =
  typeof import.meta.url === 'string' ? import.meta.url : '';
const actorSystemFilePath = actorSystemMetaUrl.startsWith('file:')
  ? fileURLToPath(actorSystemMetaUrl)
  : actorSystemMetaUrl;
const actorSystemDir =
  typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : path.dirname(actorSystemFilePath);

/**
 * @typedef {import('node:process')['platform']} TargetPlatform
 * @typedef {import('node:process')['arch']} TargetArch
 * @typedef {'glibc'|'musl'} TargetLibc
 */

/**
 * @typedef BuildTarget
 * @property {string | function(): string} nodeVersion - nodeVersion.
 * @property {TargetPlatform | function(): TargetPlatform} platform - platform.
 * @property {TargetArch | function(): TargetArch} architecture - architecture.
 * @property {TargetLibc | function(): TargetLibc} [libc] - libc.
 */

/**
 * @typedef WharfieActorSystemProperties
 * @property {BuildTarget[] | function(): BuildTarget[]} targets - targets.
 * @property {import('./function.js').default[]} [functions] - functions.
 * @property {{ entrypoint: string, export?: string }} [cli] - CLI entrypoint config.
 */

/**
 * @typedef ResolvedBuildTarget
 * @property {string} nodeVersion - nodeVersion.
 * @property {TargetPlatform} platform - platform.
 * @property {TargetArch} architecture - architecture.
 * @property {TargetLibc} [libc] - libc.
 */

/**
 * @typedef BuildTargetSelectorInput
 * @property {string} nodeVersion - nodeVersion.
 * @property {string} platform - platform.
 * @property {string} architecture - architecture.
 * @property {string} [libc] - libc.
 */

/**
 * @param {BuildTarget | ResolvedBuildTarget | BuildTargetSelectorInput | null | undefined} target - target.
 * @returns {ResolvedBuildTarget | null} - Result.
 */
function resolveBuildTarget(target) {
  if (!target || typeof target !== 'object') return null;

  const nodeVersionValue =
    typeof target.nodeVersion === 'function'
      ? target.nodeVersion()
      : target.nodeVersion;
  const platformValue =
    typeof target.platform === 'function' ? target.platform() : target.platform;
  const architectureValue =
    typeof target.architecture === 'function'
      ? target.architecture()
      : target.architecture;
  const libcValue =
    typeof target.libc === 'function' ? target.libc() : target.libc;

  if (!nodeVersionValue || !platformValue || !architectureValue) {
    return null;
  }

  const normalizedPlatform = String(platformValue).trim().toLowerCase();
  const normalizedArchitecture = String(architectureValue).trim().toLowerCase();

  /** @type {ResolvedBuildTarget} */
  const resolved = {
    nodeVersion: String(nodeVersionValue).trim().replace(/^v/, ''),
    platform: /** @type {TargetPlatform} */ (normalizedPlatform),
    architecture: /** @type {TargetArch} */ (normalizedArchitecture),
  };

  if (normalizedPlatform === 'linux') {
    resolved.libc = /** @type {TargetLibc} */ (
      libcValue ? String(libcValue).trim().toLowerCase() : 'glibc'
    );
  } else if (libcValue) {
    resolved.libc = /** @type {TargetLibc} */ (
      String(libcValue).trim().toLowerCase()
    );
  }

  return resolved;
}

/**
 * @param {BuildTarget[] | function(): BuildTarget[] | undefined} targets - targets.
 * @returns {ResolvedBuildTarget[]} - Result.
 */
function resolveConfiguredTargets(targets) {
  const resolvedTargets = typeof targets === 'function' ? targets() : targets;
  if (!Array.isArray(resolvedTargets)) {
    return [];
  }

  return resolvedTargets.reduce((acc, target) => {
    const resolved = resolveBuildTarget(target);
    if (resolved) {
      acc.push(resolved);
    }
    return acc;
  }, /** @type {ResolvedBuildTarget[]} */ ([]));
}

/**
 * @param {ResolvedBuildTarget} target - target.
 * @returns {string} - Result.
 */
function buildTargetSelector(target) {
  return `node${target.nodeVersion}-${target.platform}-${target.architecture}${
    target.libc ? `-${target.libc}` : ''
  }`;
}

/**
 * @param {NodeBinary} nodeBinary - nodeBinary.
 * @param {string | function(): string} configuredVersion - configuredVersion.
 * @returns {string} - Result.
 */
function resolveNodeBinaryVersion(nodeBinary, configuredVersion) {
  const exactVersion = nodeBinary.has('exactVersion')
    ? nodeBinary.get('exactVersion')
    : '';
  const candidate =
    typeof exactVersion === 'string' && exactVersion.trim()
      ? exactVersion.trim()
      : typeof configuredVersion === 'function'
        ? configuredVersion()
        : configuredVersion;

  return String(candidate).replace(/^v/, '');
}

/**
 * @typedef WharfieActorSystemOptions
 * @property {string} name - name.
 * @property {import('./function.js').default[]} [functions] - functions.
 * @property {{ certificateBase64?: string, certificatePassword?: string, keychainPassword?: string }} [macosSigningCredentials] - Ephemeral macOS signing credentials.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {WharfieActorSystemProperties & import('../../actors/typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 * @property {Object<string, import('../base-resource.js').default | import('../base-resource-group.js').default>} [resources] - resources.
 * @property {any} [stateDB] - Compatibility alias for the scoped state store.
 * @property {import('node:events').EventEmitter} [emitter] - Compatibility alias for the scoped telemetry emitter.
 * @property {import('../runtime-config.js').WharfieRuntimeConfig} [runtime] - Structured runtime configuration.
 * @property {{ path: string, input: import('../../runtime/application-revision.js').LockedInputDescriptor }} [dependencyLock] - Transient sealed dependency lock for target packaging.
 */

class ActorSystem extends BuildResourceGroup {
  /**
   * @param {WharfieActorSystemOptions} options - options.
   */
  constructor({
    name,
    parent,
    status,
    properties,
    resources,
    dependsOn,
    functions = [],
    macosSigningCredentials,
    stateDB,
    emitter,
    runtime,
    dependencyLock,
  }) {
    if (
      properties &&
      Object.prototype.hasOwnProperty.call(properties, 'resources')
    ) {
      throw new TypeError(
        `ActorSystem '${name}' no longer supports properties.resources.`,
      );
    }
    const propertiesWithDefaults = /** @type {Record<string, any>} */ (
      Object.assign({}, ActorSystem.DefaultProperties, properties)
    );
    delete propertiesWithDefaults.macosCertBase64;
    delete propertiesWithDefaults.macosCertPassword;
    delete propertiesWithDefaults.macosKeychainPassword;
    delete propertiesWithDefaults.macosSigningCredentials;
    const requestedTargetSelectors =
      ActorSystem.getRequestedBuildTargetSelectors();
    propertiesWithDefaults.targets = ActorSystem.resolveBuildTargets(
      propertiesWithDefaults.targets,
    );
    if (requestedTargetSelectors) {
      propertiesWithDefaults.targets = ActorSystem.filterBuildTargets(
        propertiesWithDefaults.targets,
        requestedTargetSelectors,
      );
    }
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      resources,
      dependsOn: [...(dependsOn ?? [])],
      stateDB,
      emitter,
      runtime,
    });
    this.functions = functions;
    this._dependencyLock = dependencyLock;
    setMacOSSigningCredentials(this, macosSigningCredentials);
    // normally _defineGroupResources is used but this is a workaround to make sure this.functions is set before defining things
    this.addResources(
      withResourceScope(createResourceScope(this.getRuntimeConfig()), () =>
        this.defineActorSystemResources(parent),
      ),
    );
    // @ts-ignore
    global[Symbol.for(`${this.getName()}`)] = this.run.bind(this);
  }

  /**
   * @param {{ certificateBase64?: string, certificatePassword?: string, keychainPassword?: string }} credentials - credentials.
   * @returns {this} - Actor system.
   */
  setMacOSSigningCredentials(credentials) {
    setMacOSSigningCredentials(this, credentials);
    return this;
  }

  /**
   * @returns {Readonly<{ certificateBase64: string, certificatePassword: string, keychainPassword: string }>} - credentials.
   */
  getMacOSSigningCredentials() {
    return getMacOSSigningCredentials(this);
  }

  async initializeEnvironment() {
    await Promise.all(
      this.getResources().map((resource) => {
        if (resource instanceof BuildResource) {
          return resource.initializeEnvironment();
        }
        return Promise.resolve();
      }),
    );
  }

  /**
   * @param {string|undefined} parent - parent.
   * @param {ResolvedBuildTarget} target - target.
   * @returns {(import('../base-resource.js').default | import('../base-resource-group.js').default)[]} - Result.
   */
  _defineTargetResources(
    parent,
    { nodeVersion, platform, architecture, libc },
  ) {
    /** @type {(import('../base-resource.js').default | import('../base-resource-group.js').default)[]} */
    const resources = [];
    const node_binary = new NodeBinary({
      name: `${this.name}-node-binary-${nodeVersion}-${platform}-${architecture}`,
      parent,
      properties: {
        version: nodeVersion,
        platform,
        architecture,
      },
    });
    const resolvedPlatform = /** @type {'darwin'|'linux'|'win32'} */ (platform);
    const resolvedArchitecture = /** @type {'arm64'|'x64'} */ (architecture);
    const resolvedLibc = /** @type {'glibc'} */ (libc);
    /** @returns {import('../../runtime/build-target.js').BuildTarget} - Exact resolved target. */
    const buildTarget = () => ({
      nodeVersion: resolveNodeBinaryVersion(node_binary, nodeVersion),
      platform: resolvedPlatform,
      architecture: resolvedArchitecture,
      ...(platform === 'linux' ? { libc: resolvedLibc } : {}),
    });
    const coreRuntimeDependencies = new CoreRuntimeDependenciesResource({
      name: `${this.name}-core-runtime-dependencies-${nodeVersion}-${platform}-${architecture}`,
      parent,
      dependsOn: [node_binary],
      properties: {
        buildTarget,
      },
    });
    const targetFunctions = this.functions.map(
      (/** @type {import('./function.js').default} */ func) => {
        return new FunctionResource({
          name: `${func.name}-${nodeVersion}-${platform}-${architecture}`,
          parent,
          dependsOn: [node_binary],
          properties: {
            functionName: func.name,
            entrypoint: func.entrypoint,
            ...func.properties,
            buildTarget,
          },
          dependencyLock: this._dependencyLock,
        });
      },
    );
    const build = new SeaBuild({
      name: `${this.name}-build-${nodeVersion}-${platform}-${architecture}`,
      parent,
      dependsOn: [node_binary, coreRuntimeDependencies, ...targetFunctions],
      properties: {
        entryCode: () => {
          const developerCliEntrypoint =
            typeof this.get('cli', {})?.entrypoint === 'string' &&
            this.get('cli', {}).entrypoint
              ? path.resolve(this.get('cli', {}).entrypoint)
              : null;
          const developerCliExportName =
            typeof this.get('cli', {})?.export === 'string' &&
            this.get('cli', {}).export
              ? this.get('cli', {}).export
              : null;
          const packagedAppEntryPath = path.resolve(
            actorSystemDir,
            'packaged-app-entry.js',
          );
          const runtimeCliPath = path.resolve(
            actorSystemDir,
            'actor-system-cli',
            'index.js',
          );
          const runtimeLedgerServicePath = path.resolve(
            actorSystemDir,
            '..',
            '..',
            'runtime',
            'services',
            'ledger-service-command.js',
          );
          const developerCliLoader = developerCliEntrypoint
            ? `const loadDeveloperCliModule = () => import(${JSON.stringify(
                developerCliEntrypoint,
              )});`
            : 'const loadDeveloperCliModule = null;';

          return `
              import sourceMapSupport from 'source-map-support';
              import { preparePackagedCoreRuntimeDependencies } from ${JSON.stringify(
                path.resolve(
                  actorSystemDir,
                  '..',
                  '..',
                  'runtime',
                  'core-runtime-dependencies.js',
                ),
              )};
              import { runPackagedApp } from ${JSON.stringify(
                packagedAppEntryPath,
              )};
              import runtimeOperatorCli from ${JSON.stringify(runtimeCliPath)};
              import ledgerServiceCmd from ${JSON.stringify(
                runtimeLedgerServicePath,
              )};
              ${developerCliLoader}
              (async () => {
                sourceMapSupport.install();
                await preparePackagedCoreRuntimeDependencies();
                const developerCliModule = loadDeveloperCliModule
                  ? await loadDeveloperCliModule()
                  : null;
                await runPackagedApp({
                  developerCliModule,
                  ${
                    developerCliExportName
                      ? `cliExportName: ${JSON.stringify(developerCliExportName)},`
                      : ''
                  }
                  runtimeModules: {
                    operatorCli: runtimeOperatorCli,
                    'ledger-service': ledgerServiceCmd,
                  },
                });
              })();
          `;
        },
        resolveDir: () => path.dirname(actorSystemDir),
        nodeBinaryPath: () => node_binary.get('binaryPath'),
        nodeVersion: () => resolveNodeBinaryVersion(node_binary, nodeVersion),
        platform,
        architecture,
        ...(libc ? { libc } : {}),
        environmentVariables: () => {
          return {};
        },
        assets: () => {
          const activityAssets = targetFunctions.reduce(
            (
              /** @type {{ [x: string]: string; }} */ acc,
              /** @type {import('./function-resource.js').default} */ func,
            ) => {
              acc[String(func.get('functionName'))] = func.get(
                'singleExecutableAssetPath',
              );
              return acc;
            },
            {},
          );
          return {
            ...activityAssets,
            ...coreRuntimeDependencies.get('assets', {}),
          };
        },
        assetDigests: () => coreRuntimeDependencies.get('assetDigests', {}),
        functionAssetDigests: () => {
          return targetFunctions.reduce(
            (
              /** @type {{ [x: string]: import('../../runtime/application-revision.js').Sha256Digest; }} */ acc,
              /** @type {import('./function-resource.js').default} */ func,
            ) => {
              acc[String(func.get('functionName'))] = func.get(
                'singleExecutableAssetDigest',
              );
              return acc;
            },
            {},
          );
        },
      },
    });
    /** @type {(import('../base-resource.js').default | import('../base-resource-group.js').default)[]} */
    resources.push(
      node_binary,
      coreRuntimeDependencies,
      build,
      ...targetFunctions,
    );
    if (platform === 'darwin') {
      const macosBinarySignature = new MacOSBinarySignature({
        name: `${this.name}-macos-binary-signature-${nodeVersion}-${platform}-${architecture}`,
        parent,
        dependsOn: [build],
        credentials: () => this.getMacOSSigningCredentials(),
        properties: {
          binaryPath: () => build.get('binaryPath'),
        },
      });
      resources.push(macosBinarySignature);
    }
    return resources;
  }

  /**
   * @param {string|undefined} parent - parent.
   * @returns {(import('../base-resource.js').default | import('../base-resource-group.js').default)[]} - Result.
   */
  defineActorSystemResources(parent) {
    /** @type {(import('../base-resource.js').default | import('../base-resource-group.js').default)[]} */
    const resources = [];
    this.get('targets', []).forEach(
      (/** @type {ResolvedBuildTarget} */ target) => {
        resources.push(...this._defineTargetResources(parent, target));
      },
    );
    return resources;
  }

  getBinaryPath() {
    return this.getResource(`${this.name}-build`).get('binaryPath');
  }

  /**
   * @param {BuildTarget[] | function(): BuildTarget[] | undefined} targets - targets.
   * @returns {ResolvedBuildTarget[]} - Result.
   */
  static resolveBuildTargets(targets) {
    return resolveConfiguredTargets(targets).map((target) =>
      assertCoreRuntimeDependencyTargetSupported(target, 'ActorSystem target'),
    );
  }

  /**
   * @param {BuildTarget | ResolvedBuildTarget | BuildTargetSelectorInput} target - target.
   * @returns {string} - Result.
   */
  static getBuildTargetSelector(target) {
    const resolvedTarget = resolveBuildTarget(target);
    if (!resolvedTarget) {
      throw new Error(
        'Build target must include nodeVersion, platform, and architecture.',
      );
    }
    return buildTargetSelector(resolvedTarget);
  }

  /**
   * @param {BuildTarget[] | function(): BuildTarget[] | undefined} targets - targets.
   * @param {string[] | null | undefined} [requestedTargetSelectors] - requestedTargetSelectors.
   * @returns {ResolvedBuildTarget[]} - Result.
   */
  static filterBuildTargets(
    targets,
    requestedTargetSelectors = ActorSystem.getRequestedBuildTargetSelectors(),
  ) {
    const resolvedTargets = resolveConfiguredTargets(targets);
    if (
      !Array.isArray(requestedTargetSelectors) ||
      requestedTargetSelectors.length === 0
    ) {
      return resolvedTargets;
    }

    const requested = new Set(
      requestedTargetSelectors
        .map((selector) => String(selector).trim())
        .filter(Boolean),
    );
    return resolvedTargets.filter((target) =>
      requested.has(buildTargetSelector(target)),
    );
  }

  /**
   * @returns {string[] | null} - Result.
   */
  static getRequestedBuildTargetSelectors() {
    return ActorSystem.RequestedBuildTargetSelectors;
  }

  /**
   * @template T
   * @param {string[] | null | undefined} requestedTargetSelectors - requestedTargetSelectors.
   * @param {() => Promise<T>} fn - fn.
   * @returns {Promise<T>} - Result.
   */
  static async withRequestedBuildTargetSelectors(requestedTargetSelectors, fn) {
    const previousSelectors = ActorSystem.RequestedBuildTargetSelectors;
    ActorSystem.RequestedBuildTargetSelectors =
      Array.isArray(requestedTargetSelectors) &&
      requestedTargetSelectors.length > 0
        ? [
            ...new Set(
              requestedTargetSelectors
                .map((selector) => String(selector).trim())
                .filter(Boolean),
            ),
          ]
        : null;
    try {
      return await fn();
    } finally {
      ActorSystem.RequestedBuildTargetSelectors = previousSelectors;
    }
  }

  async run() {
    await operatorCli();
  }
}
ActorSystem.DefaultProperties = {
  functions: [],
};
/** @type {string[] | null} */
ActorSystem.RequestedBuildTargetSelectors = null;

export default ActorSystem;
