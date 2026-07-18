import { v4 } from 'uuid';
import { c } from 'tar';

import BuildResource from './build-resource.js';
import paths from '../../lib/paths.js';
import { build } from '../../lib/esbuild.js';
import { installForTarget } from './lib/install-deps.js';
import { assertNoActivityEnvironmentVariables } from './lib/activity-environment.js';
import {
  FUNCTION_ASSET_SCHEMA_VERSION,
  serializeFunctionAssetDescription,
} from './lib/function-asset.js';
import { normalizeExternalDependencies } from './lib/resolve-externals.js';
import {
  getBuildTargetId,
  validateBuildTarget,
} from '../../runtime/build-target.js';
import { getActivityAttemptProtocolSymbol } from '../../runtime/activity-attempt.js';
import { cloneJsonObject } from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';

import { dirname, join } from 'node:path';
import { promises, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync } from 'node:zlib';
import { buffer as streamToBuffer } from 'node:stream/consumers';

const WHARFIE_PUBLIC_APP_SPECIFIER = '@wharfie/wharfie/app';

/**
 * Resolve the source-tree public app API only when a nested function build is
 * requested. Packaged CommonJS/SEA bundles must be able to boot without
 * evaluating a file URL against their filesystem-style __filename value.
 * @returns {string} - Absolute source module path.
 */
function getWharfiePublicAppEntrypoint() {
  const moduleUrl = import.meta.url;
  if (typeof moduleUrl !== 'string' || !moduleUrl.startsWith('file:')) {
    throw new Error(
      'This packaged Wharfie runtime cannot resolve source build modules.',
    );
  }
  return fileURLToPath(new URL('../../../app.js', moduleUrl));
}

/**
 * Resolve the source-tree attempt adapter only while building a nested
 * function bundle. As with the public app entrypoint above, doing this at
 * module initialization would make packaged CommonJS/SEA boot depend on a
 * filesystem-style file URL.
 * @returns {string} - Absolute source module path.
 */
function getWharfieActivityAttemptEntrypoint() {
  const moduleUrl = import.meta.url;
  if (typeof moduleUrl !== 'string' || !moduleUrl.startsWith('file:')) {
    throw new Error(
      'This packaged Wharfie runtime cannot resolve source activity-attempt modules.',
    );
  }
  return fileURLToPath(new URL('../../runtime/activity-attempt.js', moduleUrl));
}

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name - name.
 * @property {string} version - version.
 */

/**
 * @typedef ExternalDependencyInput
 * @property {string} name - name.
 * @property {string} version - Exact canonical semantic version.
 */

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
 * @typedef FunctionEntrypoint
 * @property {string} path - path.
 * @property {string} [export] - export.
 */

/**
 * @typedef FunctionProperties
 * @property {string} functionName - functionName.
 * @property {FunctionEntrypoint} entrypoint - entrypoint.
 * @property {BuildTarget | function(): BuildTarget} buildTarget - buildTarget.
 * @property {(string | ExternalDependencyInput)[]} [external] - external.
 * @property {Object<string,string> | function(): Object<string,string>} [assets] - assets.
 */

/**
 * @typedef FunctionOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {FunctionProperties & import('../../actors/typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 * @property {{ path: string, input: import('../../runtime/application-revision.js').LockedInputDescriptor }} [dependencyLock] - Transient sealed dependency lock.
 */

class FunctionResource extends BuildResource {
  /**
   * @param {FunctionOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn, dependencyLock }) {
    const untypedProperties = /** @type {Record<string, any>} */ (properties);
    if (Object.prototype.hasOwnProperty.call(untypedProperties, 'resources')) {
      throw new TypeError(
        `Activity '${properties.functionName || name}' no longer supports properties.resources.`,
      );
    }
    assertNoActivityEnvironmentVariables(
      untypedProperties.environmentVariables,
      properties.functionName || name,
    );
    const propertiesWithDefaults = Object.assign(
      {},
      FunctionResource.DefaultProperties,
      properties,
    );
    const untypedPropertiesWithDefaults = /** @type {Record<string, any>} */ (
      propertiesWithDefaults
    );
    delete untypedPropertiesWithDefaults.environmentVariables;
    const normalizedExternal = normalizeExternalDependencies(
      propertiesWithDefaults.external,
      propertiesWithDefaults.entrypoint?.path,
    );
    if (normalizedExternal) {
      propertiesWithDefaults.external = normalizedExternal;
    } else {
      delete propertiesWithDefaults.external;
    }
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
    });
    this._dependencyLock = dependencyLock;
  }

  /**
   * Resolve every behavior-bearing build property once for a reconciliation.
   * @returns {{functionName: string, entrypoint: {path: string, export?: string}, buildTarget: import('../../runtime/build-target.js').BuildTarget, external: ExternalDependencyDescription[]}} - Coherent build inputs.
   */
  captureBuildInputs() {
    const functionName = String(this.get('functionName'));
    assertLogicalId(functionName, 'functionName');
    const entrypoint = cloneJsonObject(this.get('entrypoint'), 'entrypoint');
    if (
      typeof entrypoint.path !== 'string' ||
      entrypoint.path.length === 0 ||
      (Object.prototype.hasOwnProperty.call(entrypoint, 'export') &&
        (typeof entrypoint.export !== 'string' ||
          entrypoint.export.length === 0))
    ) {
      throw new TypeError(
        `Activity '${functionName}' requires a nonempty entrypoint path and optional nonempty export.`,
      );
    }
    const external = normalizeExternalDependencies(
      this.get('external', []),
      entrypoint.path,
    );
    const canonicalEntrypoint = /** @type {{path: string, export?: string}} */ (
      entrypoint
    );
    return {
      functionName,
      entrypoint: canonicalEntrypoint,
      buildTarget: validateBuildTarget(
        this.get('buildTarget'),
        `Activity '${functionName}' build target`,
      ),
      external: external || [],
    };
  }

  async initializeEnvironment() {
    await super.initializeEnvironment();
  }

  /**
   * @param {ReturnType<FunctionResource['captureBuildInputs']>} inputs - One coherent reconciliation input snapshot.
   * @returns {Promise<string>} - Result.
   */
  async esbuild(inputs = this.captureBuildInputs()) {
    const functionName = inputs.functionName;
    const exportName = String(inputs.entrypoint.export || 'default');
    const activityAttemptSymbol =
      getActivityAttemptProtocolSymbol(functionName);
    const entryCode = `
      import * as activityModule from ${JSON.stringify(inputs.entrypoint.path)};
      import { runNodeActivityAttempt } from ${JSON.stringify(
        getWharfieActivityAttemptEntrypoint(),
      )};
      const entrypoint = activityModule[${JSON.stringify(exportName)}];
      if (typeof entrypoint !== 'function') {
        throw new TypeError(${JSON.stringify(
          `Activity '${functionName}' export '${exportName}' is not a function.`,
        )});
      }
      const runActivityAttempt = (request) => {
        if (
          request === null ||
          typeof request !== 'object' ||
          Array.isArray(request) ||
          !Object.prototype.hasOwnProperty.call(request, 'startFrame') ||
          !Object.prototype.hasOwnProperty.call(request, 'transport') ||
          Object.keys(request).length !== 2
        ) {
          throw new TypeError(${JSON.stringify(
            `Activity '${functionName}' protocol wrapper expects exactly { startFrame, transport }.`,
          )});
        }
        if (
          request.startFrame === null ||
          typeof request.startFrame !== 'object' ||
          Array.isArray(request.startFrame) ||
          request.startFrame.activityId !== ${JSON.stringify(functionName)}
        ) {
          throw new TypeError(${JSON.stringify(
            `Activity '${functionName}' protocol wrapper requires startFrame.activityId to match its selected entrypoint.`,
          )});
        }
        const transport = request.transport;
        const hasEffectHandler =
          transport !== null &&
          typeof transport === 'object' &&
          !Array.isArray(transport) &&
          Object.prototype.hasOwnProperty.call(transport, 'handleEffect');
        if (
          transport === null ||
          typeof transport !== 'object' ||
          Array.isArray(transport) ||
          Object.getPrototypeOf(transport) !== Object.prototype ||
          !Object.prototype.hasOwnProperty.call(transport, 'onComponentFrame') ||
          !Object.prototype.hasOwnProperty.call(transport, 'signal') ||
          !Object.prototype.hasOwnProperty.call(transport, 'forceTerminate') ||
          Object.keys(transport).length !== (hasEffectHandler ? 4 : 3)
        ) {
          throw new TypeError(${JSON.stringify(
            `Activity '${functionName}' protocol wrapper requires a runner-owned transport with exactly { onComponentFrame, signal, forceTerminate } and an optional own handleEffect.`,
          )});
        }
        if (
          typeof transport.onComponentFrame !== 'function' ||
          (hasEffectHandler && typeof transport.handleEffect !== 'function') ||
          typeof transport.forceTerminate !== 'function' ||
          transport.signal === null ||
          typeof transport.signal !== 'object' ||
          typeof transport.signal.addEventListener !== 'function' ||
          typeof transport.signal.removeEventListener !== 'function'
        ) {
          throw new TypeError(${JSON.stringify(
            `Activity '${functionName}' protocol wrapper requires transport.onComponentFrame and transport.forceTerminate functions, an optional handleEffect function, plus an AbortSignal-like transport.signal.`,
          )});
        }
        return runNodeActivityAttempt({
          startFrame: request.startFrame,
          handler: entrypoint,
          onComponentFrame: transport.onComponentFrame,
          ...(hasEffectHandler ? { handleEffect: transport.handleEffect } : {}),
          signal: transport.signal,
          forceTerminate: transport.forceTerminate,
        });
      };
      globalThis[Symbol.for(${JSON.stringify(activityAttemptSymbol)})] = runActivityAttempt;
    `;
    const resolveDir = dirname(inputs.entrypoint.path);
    const { outputFiles, errors, warnings } = await build({
      stdin: {
        contents: entryCode,
        resolveDir,
        sourcefile: 'index.js',
      },
      write: false,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      minify: true,
      keepNames: false,
      sourcemap: 'inline',
      target: `node${inputs.buildTarget.nodeVersion}`,
      logLevel: 'silent',
      external: inputs.external.length
        ? [
            ...FunctionResource.REQUIRED_UNUSED_EXTERNALS,
            ...inputs.external.map(
              (/** @type {ExternalDependencyDescription} */ external) =>
                external.name,
            ),
          ]
        : FunctionResource.REQUIRED_UNUSED_EXTERNALS,
      alias: {
        [WHARFIE_PUBLIC_APP_SPECIFIER]: getWharfiePublicAppEntrypoint(),
      },
      define: {
        __WILLEM_BUILD_RECONCILE_TERMINATOR: '1', // injects this variable definition into the global scope
        'import.meta.url': '__filename',
        'import.meta.dirname': '__dirname',
      },
    });

    if (errors.length > 0) {
      throw new Error(JSON.stringify(errors));
    }

    if (!outputFiles || outputFiles.length !== 1) {
      throw new Error('esbuild output not as expected');
    }

    if (warnings.length > 0) {
      console.warn(warnings);
    }
    return outputFiles[0].text;
  }

  /**
   * @param {ReturnType<FunctionResource['captureBuildInputs']>} inputs - One coherent reconciliation input snapshot.
   * @returns {Promise<{ externalsTar: string, receipt: { dependencyLockInput: import('../../runtime/application-revision.js').LockedInputDescriptor, closureDigest: import('../../runtime/application-revision.js').Sha256Digest, plan: Readonly<Record<string, any>> } | null }>} - Exact archived closure and semantic receipt.
   */
  async bundleExternals(inputs = this.captureBuildInputs()) {
    const externals = inputs.external;
    if (externals.length === 0) {
      return { externalsTar: '', receipt: null };
    }
    const tmpBuildDir = join(FunctionResource.BUILD_DIR, `externals-${v4()}`);
    await promises.mkdir(tmpBuildDir, { mode: 0o700, recursive: true });
    await promises.chmod(tmpBuildDir, 0o700);
    try {
      const receipt = await installForTarget({
        activity: inputs.functionName,
        buildTarget: inputs.buildTarget,
        dependencyLock: this._dependencyLock,
        externals,
        tmpBuildDir,
      });
      if (!receipt) {
        throw new Error(
          `Activity '${inputs.functionName}' declared externals but produced no frozen closure receipt.`,
        );
      }
      const stream = c(
        {
          cwd: tmpBuildDir,
          gzip: { level: 9 }, // gzip compress
          portable: true, // normalize perms/uid/gid
          noMtime: true, // omit mtimes for reproducibility
        },
        ['.'],
      );
      const externalsTar = await streamToBuffer(stream);
      return {
        externalsTar: externalsTar.toString('base64'),
        receipt,
      };
    } finally {
      await promises.rm(tmpBuildDir, { force: true, recursive: true });
    }
  }

  async _reconcile() {
    // A previous successful reconcile must never be mistaken for the asset or
    // archive produced by a later failed attempt.
    const previousAssetPath = this.has('singleExecutableAssetPath')
      ? this.get('singleExecutableAssetPath')
      : undefined;
    delete this.properties.singleExecutableAssetPath;
    delete this.properties.singleExecutableAssetDigest;
    delete this.properties.externalArchiveDigest;
    delete this.properties.externalClosureDigest;
    delete this.properties.externalDependencyLockInput;
    if (typeof previousAssetPath === 'string' && previousAssetPath) {
      try {
        await promises.unlink(previousAssetPath);
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        ) {
          throw error;
        }
      }
    }
    if (!existsSync(FunctionResource.TEMP_ASSET_PATH)) {
      await promises.mkdir(FunctionResource.TEMP_ASSET_PATH, {
        mode: 0o700,
        recursive: true,
      });
    }
    await promises.chmod(FunctionResource.TEMP_ASSET_PATH, 0o700);
    const inputs = this.captureBuildInputs();
    const [codeBlob, bundledExternals] = await Promise.all([
      this.esbuild(inputs),
      this.bundleExternals(inputs),
    ]);
    const hasDeclaredExternals = inputs.external.length > 0;
    if (
      hasDeclaredExternals &&
      (!bundledExternals.receipt || !bundledExternals.externalsTar)
    ) {
      throw new Error(
        `Activity '${inputs.functionName}' declared external dependencies but produced no external archive.`,
      );
    }
    const externalsTar = bundledExternals.externalsTar;
    const externalArchiveBytes = Buffer.from(externalsTar, 'base64');
    if (externalArchiveBytes.toString('base64') !== externalsTar) {
      throw new Error(
        `Activity '${inputs.functionName}' produced a noncanonical external archive encoding.`,
      );
    }
    const codeBundle = brotliCompressSync(codeBlob).toString('base64');
    const externalArchiveDigest = {
      algorithm: 'sha256',
      value: createHash('sha256')
        .update(externalArchiveBytes)
        .digest('base64url'),
    };
    const planRoots = hasDeclaredExternals
      ? bundledExternals.receipt?.plan?.roots?.map(
          (/** @type {{name: string, version: string}} */ root) => ({
            name: root.name,
            version: root.version,
          }),
        )
      : [];
    if (hasDeclaredExternals && bundledExternals.receipt) {
      const plan = bundledExternals.receipt.plan;
      if (
        plan.activity !== inputs.functionName ||
        getBuildTargetId(plan.target) !==
          getBuildTargetId(inputs.buildTarget) ||
        !Array.isArray(planRoots) ||
        planRoots.length !== inputs.external.length ||
        planRoots.some(
          (/** @type {{name: string, version: string}} */ root, index) =>
            root.name !== inputs.external[index].name ||
            root.version !== inputs.external[index].version,
        )
      ) {
        throw new Error(
          `Activity '${inputs.functionName}' frozen closure plan does not match its reconciliation inputs.`,
        );
      }
    }
    const externalDependencyReceipt =
      hasDeclaredExternals && bundledExternals.receipt
        ? {
            dependencyLockInput: bundledExternals.receipt.plan.lock,
            closureDigest: bundledExternals.receipt.closureDigest,
            archiveDigest: externalArchiveDigest,
          }
        : null;
    const assetBytes = serializeFunctionAssetDescription(
      {
        schemaVersion: FUNCTION_ASSET_SCHEMA_VERSION,
        activity: inputs.functionName,
        target: inputs.buildTarget,
        externals: inputs.external,
        codeBundle,
        externalsTar,
        externalDependencyReceipt,
      },
      `Activity '${inputs.functionName}' function asset`,
    );
    const singleExecutableAssetDigest = {
      algorithm: 'sha256',
      value: createHash('sha256').update(assetBytes).digest('base64url'),
    };
    const singleExecutableAssetPath = join(
      FunctionResource.TEMP_ASSET_PATH,
      v4(),
    );
    await promises.writeFile(singleExecutableAssetPath, assetBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    await promises.chmod(singleExecutableAssetPath, 0o400);
    this._setUNSAFE('singleExecutableAssetPath', singleExecutableAssetPath);
    this._setUNSAFE('singleExecutableAssetDigest', singleExecutableAssetDigest);
    if (hasDeclaredExternals && bundledExternals.receipt) {
      this._setUNSAFE('externalDependencyLockInput', {
        ...bundledExternals.receipt.plan.lock,
      });
      this._setUNSAFE('externalClosureDigest', {
        ...bundledExternals.receipt.closureDigest,
      });
      this._setUNSAFE('externalArchiveDigest', externalArchiveDigest);
    }
  }

  async _destroy() {
    const assetPath = this.get('singleExecutableAssetPath');
    if (!assetPath || !existsSync(assetPath)) {
      return;
    }
    await promises.unlink(assetPath);
  }
}

FunctionResource.DefaultProperties = {
  assets: {},
};
FunctionResource.BUILD_DIR = join(paths.temp, 'builds');
FunctionResource.REQUIRED_UNUSED_EXTERNALS = [
  'esbuild',
  'node-gyp/bin/node-gyp.js',
];
FunctionResource.TEMP_ASSET_PATH = join(paths.temp, 'function-assets');

export default FunctionResource;
