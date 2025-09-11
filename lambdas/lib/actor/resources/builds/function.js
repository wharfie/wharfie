const uuid = require('uuid');

const paths = require('../../../paths');
const esbuild = require('../../../esbuild');
const BuildResource = require('./build-resource');
const path = require('node:path');
const fs = require('node:fs');
const Arborist = require('@npmcli/arborist');
const tar = require('tar');
const { buffer: streamToBuffer } = require('node:stream/consumers');

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name -
 * @property {string} version -
 */

/**
 * @typedef FunctionProperties
 * @property {string} nodeVersion -
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
   *
   */
  async esbuild() {
    const entryCode = `
      (async () => {
        require('source-map-support').install();
        // Auto-generated entry file
        require(${JSON.stringify(this.callerFile)});
        await global[Symbol.for('${this.getName()}')]();
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
      target: `node${this.get('nodeVersion')}`,
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
      throw new Error('Esbuild output not as expected');
    }

    if (warnings.length > 0) {
      console.warn(warnings);
    }
    this.set('codeBlob', outputFiles[0].text);
  }

  async bundleExternals() {
    const externals = this.get('external', []);
    const tmpBuildDir = path.join(Function.BUILD_DIR, `externals-${uuid.v4()}`);
    await fs.promises.mkdir(tmpBuildDir, { recursive: true });

    const arb = new Arborist({ path: tmpBuildDir });
    await arb.buildIdealTree({
      add: externals.map(
        (/** @type {ExternalDependencyDescription} */ external) =>
          `${external.name}@${external.version}`
      ), // e.g. ['lodash@^4.17.21']
      saveType: 'prod',
    });
    await arb.reify({ save: true });
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
    this.set('externalsTar', externalsTar.toString('base64'));
  }

  async _reconcile() {
    await Promise.all([this.esbuild(), this.bundleExternals()]);
  }

  async _destroy() {
    // if (!fs.existsSync(this.get('codeBundlePath'))) {
    //   return;
    // }
    // await fs.promises.unlink(this.get('codeBundlePath'));
  }

  async run() {
    if (!this.isStable()) throw new Error('Actor is not stable');
  }

  async recieve() {
    await this.run();
  }
}

Function.DefaultProperties = {
  environmentVariables: {},
  assets: {},
};
Function.BUILD_DIR = path.join(paths.temp, 'builds');
Function.REQUIRED_UNUSED_EXTERNALS = ['esbuild', 'node-gyp/bin/node-gyp.js'];

module.exports = Function;
