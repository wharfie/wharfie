const uuid = require('uuid');
const Arborist = require('@npmcli/arborist');
const tar = require('tar');

const BuildResource = require('./build-resource');
const paths = require('../../../paths');
const esbuild = require('../../../esbuild');
const vm = require('../../../vm');

const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { getAsset } = require('node:sea');
const { buffer: streamToBuffer } = require('node:stream/consumers');

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name -
 * @property {string} version -
 */

/**
 * @typedef {('darwin'|'win32'|'linux')} Platform
 */

/**
 * @typedef {('x64'|'arm64')} Arch
 */

/**
 * @typedef FunctionBuildTarget
 * @property {string | function(): string} nodeVersion -
 * @property {Platform | function(): Platform} platform -
 * @property {Arch | function(): Arch} architecture -
 */

/**
 * @typedef FunctionProperties
 * @property {FunctionBuildTarget | function(): FunctionBuildTarget} buildTarget -
 * @property {ExternalDependencyDescription[]} external -
 * @property {Object<string,string>} environmentVariables -
 * @property {Object<string,string> | function(): Object<string,string>} assets -
 */

/**
 * @typedef FunctionOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {FunctionProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class Function extends BuildResource {
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
      Function.DefaultProperties,
      properties
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
    });
    this.fn = fn;
    // @ts-ignore
    this.callerFile = module?.parent?.filename;
    this.callerDirectory = this.callerFile
      ? path.dirname(this.callerFile)
      : undefined;

    // @ts-ignore
    global[Symbol.for(`${this.getName()}`)] = this.fn;
    // @ts-ignore
    global[Symbol.for(`${this.getName()}_initializeEnvironment`)] =
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
   * @returns {Promise<string>}
   */
  async esbuild() {
    const entryCode = `
      const { once } = require('node:events');
      (async () => {
        // makes sure stack traces point to original files
        require('source-map-support').install();
        // Auto-generated entry file
        require(${JSON.stringify(this.callerFile)});
        const fn = await global[Symbol.for('${this.getName()}')];
        if (typeof fn !== 'function') {
          throw new TypeError('Global entrypoint is not a function');
        }
        const res = await fn(...global.__ENTRY_ARGS__);  
        // blocks return even if user-code was not awaiting async calls
        await once(process, 'beforeExit');
      })();
    `;
    const resolveDir = path.dirname(this.callerDirectory || '');
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
            ...Function.REQUIRED_UNUSED_EXTERNALS,
            ...this.get('external', []).map(
              (/** @type {ExternalDependencyDescription} */ external) =>
                external.name
            ),
          ]
        : Function.REQUIRED_UNUSED_EXTERNALS,
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
   * @returns {Promise<string>}
   */
  async bundleExternals() {
    const externals = this.get('external', []);
    const tmpBuildDir = path.join(Function.BUILD_DIR, `externals-${uuid.v4()}`);
    await fs.promises.mkdir(tmpBuildDir, { recursive: true });

    const current_platform = process.env.npm_config_platform;
    const current_arch = process.env.npm_config_arch;
    process.env.npm_config_platform = this.get('buildTarget').platform;
    process.env.npm_config_arch = this.get('buildTarget').architecture;
    const arb = new Arborist({ path: tmpBuildDir });
    await arb.buildIdealTree({
      add: externals.map(
        (/** @type {ExternalDependencyDescription} */ external) =>
          `${external.name}@${external.version}`
      ),
      saveType: 'prod',
    });
    await arb.reify({ save: true });
    process.env.npm_config_platform = current_platform;
    process.env.npm_config_arch = current_arch;
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
    if (!fs.existsSync(Function.TEMP_ASSET_PATH)) {
      await fs.promises.mkdir(Function.TEMP_ASSET_PATH, {
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
      externalsTar: externalsTar,
    });
    const singleExecutableAssetPath = path.join(
      Function.TEMP_ASSET_PATH,
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

  /**
   * @param {any} event
   * @param {any} context
   */
  async run(event, context) {
    const functionAssetBuffer = await getAsset(this.name);
    const functionDescriptionBuffer = Buffer.from(functionAssetBuffer);
    const assetDescription = JSON.parse(functionDescriptionBuffer.toString());
    const functionBuffer = zlib.brotliDecompressSync(
      Buffer.from(assetDescription.codeBundle, 'base64')
    );
    const functionCodeString = functionBuffer.toString();
    console.time('sandbox');
    await vm.runInSandbox(this.name, functionCodeString, [event, context], {
      externalsTar: Buffer.from(assetDescription.externalsTar, 'base64'),
    });
    console.timeEnd('sandbox');
  }

  async recieve() {
    await this.run({}, {});
  }
}

Function.DefaultProperties = {
  environmentVariables: {},
  assets: {},
};
Function.BUILD_DIR = path.join(paths.temp, 'builds');
Function.REQUIRED_UNUSED_EXTERNALS = ['esbuild', 'node-gyp/bin/node-gyp.js'];
Function.TEMP_ASSET_PATH = path.join(paths.temp, 'function-assets');

module.exports = Function;
