const uuid = require('uuid');
// const Arborist = require('@npmcli/arborist');
const tar = require('tar');

const BuildResource = require('./build-resource');
const paths = require('../../../paths');
const esbuild = require('../../../esbuild');
const { installForTarget } = require('./lib/install-deps');

const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { buffer: streamToBuffer } = require('node:stream/consumers');

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
 * @typedef FunctionProperties
 * @property {string} functionName -
 * @property {string | function(): string} resolveDir -
 * @property {string | function(): string} callerFile -
 * @property {BuildTarget | function(): BuildTarget} buildTarget -
 * @property {ExternalDependencyDescription[]} [external] -
 * @property {Object<string,string>} [environmentVariables] -
 * @property {Object<string,string> | function(): Object<string,string>} [assets] -
 */

/**
 * @typedef FunctionOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {FunctionProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class FunctionResource extends BuildResource {
  /**
   * @param {function} fn -
   * @param {FunctionOptions} options -
   */
  constructor(fn, { name, parent, status, properties, dependsOn }) {
    if (typeof fn !== 'function') {
      throw new Error('Actor expects a function as an argument');
    }
    const propertiesWithDefaults = Object.assign(
      {},
      FunctionResource.DefaultProperties,
      properties
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
    });
    // @ts-ignore
    global[Symbol.for(`${this.get('functionName')}`)] = fn;
    // @ts-ignore
    global[Symbol.for(`${this.get('functionName')}_initializeEnvironment`)] =
      this.initializeEnvironment.bind(this);
  }

  async initializeEnvironment() {
    await super.initializeEnvironment();
  }

  getCallerFile() {
    let callerFile;
    const err = new Error();
    Error.prepareStackTrace = (_err, stack) => stack;
    // Check if the stack property exists and is an array
    if (!err.stack || !Array.isArray(err.stack)) {
      throw new Error('Stack trace is not available');
    }
    const currentFile = err.stack.shift().getFileName();
    while (err.stack.length) {
      callerFile = err.stack.shift().getFileName();
      if (callerFile !== currentFile) break;
    }
    return callerFile;
  }

  /**
   * @returns {Promise<string>} -
   */
  async esbuild() {
    const entryCode = `
      const { once } = require('node:events');
      (async () => {
        // makes sure stack traces point to original files
        require('source-map-support').install();
        // Auto-generated entry file
        require(${JSON.stringify(this.get('callerFile'))});
        const fn = await global[Symbol.for(${JSON.stringify(
          this.get('functionName')
        )})];
        if (typeof fn !== 'function') {
          throw new TypeError('Global entrypoint is not a function');
        }
        const res = await fn(...global.__ENTRY_ARGS__);  
        // blocks return even if user-code was not awaiting async calls
        await once(process, 'beforeExit');
      })();
    `;
    const resolveDir = path.dirname(this.get('callerDirectory') || '');
    const { outputFiles, errors, warnings } = await esbuild.build({
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
                external.name
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
    const tmpBuildDir = path.join(
      FunctionResource.BUILD_DIR,
      `externals-${uuid.v4()}`
    );
    await fs.promises.mkdir(tmpBuildDir, { recursive: true });
    await installForTarget({
      buildTarget: this.get('buildTarget'),
      externals,
      tmpBuildDir,
    });
    const stream = tar.c(
      {
        cwd: tmpBuildDir,
        gzip: { level: 9 }, // gzip compress
        portable: true, // normalize perms/uid/gid
        noMtime: true, // omit mtimes for reproducibility
      },
      ['.']
    );
    const externalsTar = await streamToBuffer(stream);
    return externalsTar.toString('base64');
  }

  async _reconcile() {
    if (!fs.existsSync(FunctionResource.TEMP_ASSET_PATH)) {
      await fs.promises.mkdir(FunctionResource.TEMP_ASSET_PATH, {
        recursive: true,
      });
    }
    const [codeBlob, externalsTar] = await Promise.all([
      this.esbuild(),
      this.bundleExternals(),
    ]);
    const codeBundle = zlib.brotliCompressSync(codeBlob).toString('base64');
    const assetDescription = JSON.stringify({
      codeBundle,
      externalsTar,
    });
    const singleExecutableAssetPath = path.join(
      FunctionResource.TEMP_ASSET_PATH,
      uuid.v4()
    );
    fs.writeFileSync(singleExecutableAssetPath, assetDescription);
    this.set('singleExecutableAssetPath', singleExecutableAssetPath);
  }

  async _destroy() {
    if (!fs.existsSync(this.get('assetPath'))) {
      return;
    }
    await fs.promises.unlink(this.get('assetPath'));
  }
}

FunctionResource.DefaultProperties = {
  environmentVariables: {},
  assets: {},
};
FunctionResource.BUILD_DIR = path.join(paths.temp, 'builds');
FunctionResource.REQUIRED_UNUSED_EXTERNALS = [
  'esbuild',
  'node-gyp/bin/node-gyp.js',
];
FunctionResource.TEMP_ASSET_PATH = path.join(paths.temp, 'function-assets');

module.exports = FunctionResource;
