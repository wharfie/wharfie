import { v4 } from 'uuid';
import { c } from 'tar';

import BuildResource from './build-resource.js';
import paths from '../../../paths.js';
import { build } from '../../../esbuild.js';
import { installForTarget } from './lib/install-deps.js';

import { dirname, join } from 'node:path';
import { promises, existsSync, writeFileSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { buffer as streamToBuffer } from 'node:stream/consumers';

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name -
 * @property {string} version -
 */

/**
 * @typedef {import('node:process')['platform']} TargetPlatform
 * @typedef {import('node:process')['arch']} TargetArch
 * @typedef {import('detect-libc').GLIBC|import('detect-libc').MUSL} TargetLibc
 */

/**
 * @typedef BuildTarget
 * @property {string | function(): string} nodeVersion -
 * @property {TargetPlatform | function(): TargetPlatform} platform -
 * @property {TargetArch | function(): TargetArch} architecture -
 * @property {TargetLibc | function(): TargetLibc} [libc] -
 */

/**
 * @typedef FunctionEntrypoint
 * @property {string} path -
 * @property {string} [export] -
 */

/**
 * @typedef FunctionProperties
 * @property {string} functionName -
 * @property {FunctionEntrypoint} entrypoint -
 * @property {BuildTarget | function(): BuildTarget} buildTarget -
 * @property {ExternalDependencyDescription[]} [external] -
 * @property {Object<string,string>} [environmentVariables] -
 * @property {Object<string,string> | function(): Object<string,string>} [assets] -
 */

/**
 * @typedef FunctionOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {FunctionProperties & import('../../typedefs.js').SharedProperties} properties -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 */

class FunctionResource extends BuildResource {
  /**
   * @param {FunctionOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn }) {
    const propertiesWithDefaults = Object.assign(
      {},
      FunctionResource.DefaultProperties,
      properties,
    );
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
   * @returns {Promise<string>} -
   */
  async esbuild() {
    console.log('HELLO');
    const entryCode = `
      import { ${
        this.get('entrypoint').export || 'default'
      } as entrypoint } from ${JSON.stringify(this.get('entrypoint').path)};
      global[Symbol.for('${this.get('functionName')}')] = entrypoint
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
   * @returns {Promise<string>} -
   */
  async bundleExternals() {
    const externals = this.get('external', []);
    const tmpBuildDir = join(FunctionResource.BUILD_DIR, `externals-${v4()}`);
    await promises.mkdir(tmpBuildDir, { recursive: true });
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
  }

  async _reconcile() {
    if (!existsSync(FunctionResource.TEMP_ASSET_PATH)) {
      await promises.mkdir(FunctionResource.TEMP_ASSET_PATH, {
        recursive: true,
      });
    }
    const [codeBlob, externalsTar] = await Promise.all([
      this.esbuild(),
      this.bundleExternals(),
    ]);
    const codeBundle = brotliCompressSync(codeBlob).toString('base64');
    const assetDescription = JSON.stringify({
      codeBundle,
      externalsTar,
    });
    const singleExecutableAssetPath = join(
      FunctionResource.TEMP_ASSET_PATH,
      v4(),
    );
    writeFileSync(singleExecutableAssetPath, assetDescription);
    this.set('singleExecutableAssetPath', singleExecutableAssetPath);
  }

  async _destroy() {
    if (!existsSync(this.get('assetPath'))) {
      return;
    }
    await promises.unlink(this.get('assetPath'));
  }
}

FunctionResource.DefaultProperties = {
  environmentVariables: {},
  assets: {},
};
FunctionResource.BUILD_DIR = join(paths.temp, 'builds');
FunctionResource.REQUIRED_UNUSED_EXTERNALS = [
  'esbuild',
  'node-gyp/bin/node-gyp.js',
];
FunctionResource.TEMP_ASSET_PATH = join(paths.temp, 'function-assets');

export default FunctionResource;
