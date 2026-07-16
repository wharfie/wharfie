import { v4 } from 'uuid';
import { c } from 'tar';

import BuildResource from './build-resource.js';
import paths from '../../lib/paths.js';
import { build } from '../../lib/esbuild.js';
import { installForTarget } from './lib/install-deps.js';
import { assertNoActivityEnvironmentVariables } from './lib/activity-environment.js';
import { normalizeExternalDependencies } from './lib/resolve-externals.js';

import { dirname, join } from 'node:path';
import { promises, existsSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { buffer as streamToBuffer } from 'node:stream/consumers';

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name - name.
 * @property {string} version - version.
 */

/**
 * @typedef ExternalDependencyInput
 * @property {string} name - name.
 * @property {string} [version] - version.
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
 * @property {Record<string, any>} [resources] - Function-scoped runtime resource specs.
 * @property {Object<string,string> | function(): Object<string,string>} [assets] - assets.
 */

/**
 * @typedef FunctionOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {FunctionProperties & import('../../actors/typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class FunctionResource extends BuildResource {
  /**
   * @param {FunctionOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn }) {
    const untypedProperties = /** @type {Record<string, any>} */ (properties);
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
  }

  async initializeEnvironment() {
    await super.initializeEnvironment();
  }

  /**
   * @returns {Promise<string>} - Result.
   */
  async esbuild() {
    const functionName = String(this.get('functionName'));
    const exportName = String(this.get('entrypoint').export || 'default');
    const entryCode = `
      import * as activityModule from ${JSON.stringify(this.get('entrypoint').path)};
      const entrypoint = activityModule[${JSON.stringify(exportName)}];
      if (typeof entrypoint !== 'function') {
        throw new TypeError(${JSON.stringify(
          `Activity '${functionName}' export '${exportName}' is not a function.`,
        )});
      }
      globalThis[Symbol.for(${JSON.stringify(functionName)})] = entrypoint;
    `;
    const resolveDir = dirname(this.get('entrypoint').path || '');
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
      target: `node${this.get('buildTarget').nodeVersion}`,
      logLevel: 'silent',
      external: this.get('external', []).length
        ? [
            ...FunctionResource.REQUIRED_UNUSED_EXTERNALS,
            ...this.get('external', []).map(
              (/** @type {ExternalDependencyDescription} */ external) =>
                external.name,
            ),
          ]
        : FunctionResource.REQUIRED_UNUSED_EXTERNALS,
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
   * @returns {Promise<string>} - Result.
   */
  async bundleExternals() {
    const externals = this.get('external', []);
    const tmpBuildDir = join(FunctionResource.BUILD_DIR, `externals-${v4()}`);
    await promises.mkdir(tmpBuildDir, { recursive: true });
    try {
      await installForTarget({
        buildTarget: this.get('buildTarget'),
        externals,
        tmpBuildDir,
      });
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
      return externalsTar.toString('base64');
    } finally {
      await promises.rm(tmpBuildDir, { force: true, recursive: true });
    }
  }

  async _reconcile() {
    if (!existsSync(FunctionResource.TEMP_ASSET_PATH)) {
      await promises.mkdir(FunctionResource.TEMP_ASSET_PATH, {
        mode: 0o700,
        recursive: true,
      });
    }
    await promises.chmod(FunctionResource.TEMP_ASSET_PATH, 0o700);
    const [codeBlob, externalsTar] = await Promise.all([
      this.esbuild(),
      this.bundleExternals(),
    ]);
    const codeBundle = brotliCompressSync(codeBlob).toString('base64');
    const assetDescription = JSON.stringify({
      codeBundle,
      externalsTar,
      resourceSpecs: this.get('resources', {}),
    });
    const singleExecutableAssetPath = join(
      FunctionResource.TEMP_ASSET_PATH,
      v4(),
    );
    await promises.writeFile(singleExecutableAssetPath, assetDescription, {
      flag: 'wx',
      mode: 0o600,
    });
    this.set('singleExecutableAssetPath', singleExecutableAssetPath);
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
  resources: {},
  assets: {},
};
FunctionResource.BUILD_DIR = join(paths.temp, 'builds');
FunctionResource.REQUIRED_UNUSED_EXTERNALS = [
  'esbuild',
  'node-gyp/bin/node-gyp.js',
];
FunctionResource.TEMP_ASSET_PATH = join(paths.temp, 'function-assets');

export default FunctionResource;
