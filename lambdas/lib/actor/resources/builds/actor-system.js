const NodeBinary = require('./node-binary');
const BuildResource = require('./build-resource');
const JSBundle = require('./js-bundle');
const NodeSingleExecutableApplication = require('./node-single-executable-application');
const PackageBinary = require('./package-binary');
const MacOSBinarySignature = require('./macos-binary-signature');
const BaseResourceGroup = require('../base-resource-group');
const { execFile } = require('../../../cmd');
const {
  packages: {
    'node_modules/esbuild': { version: ESBUILD_VERSION },
  },
} = require('../../../../../package-lock.json');
const path = require('node:path');

/**
 * @typedef ExtendedWharfieActorProperties
 * @property {string[] | function(): string[]} actorPolicyArns -
 * @property {string | function(): string} artifactBucket -
 * @property {Object<string,string> | function(): Object<string,string>} environmentVariables -
 */

/**
 * @typedef WharfieActorProperties
 * @property {string} nodeVersion -
 * @property {string} platform -
 * @property {string} architecture -
 */

/**
 * @typedef WharfieActorOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {WharfieActorProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('../base-resource') | import('../base-resource-group')>} [resources] -
 */

// @ts-ignore
global.__wharfieActorFunctions = {};

// @ts-ignore
global.__wharfieActorInitializeEnvironmentFunctions = {};

class Actor extends BaseResourceGroup {
  /**
   * @param {function} fn -
   * @param {WharfieActorOptions} options -
   */
  constructor(fn, { name, parent, status, properties, resources, dependsOn }) {
    if (typeof fn !== 'function') {
      throw new Error('Actor expects a function as an argument');
    }
    super({
      name,
      parent,
      status,
      properties,
      resources,
      dependsOn,
    });
    this.fn = fn;
    this.callerFile = this.getCallerFile();
    this.callerDirectory = path.dirname(this.callerFile);
    // @ts-ignore
    global.__wharfieActorFunctions[`${this.getName()}`] = this.fn;

    // @ts-ignore
    global.__wharfieActorInitializeEnvironmentFunctions[`${this.getName()}`] =
      this.initializeEnvironment.bind(this);
  }

  async initializeEnvironment() {
    await Promise.all(
      this.getResources().map((resource) => {
        if (resource instanceof BuildResource) {
          return resource.initializeEnvironment();
        }
        return Promise.resolve();
      })
    );
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
   * @param {string} parent -
   * @returns {(import('../base-resource') | import('../base-resource-group'))[]} -
   */
  _defineGroupResources(parent) {
    const node_binary = new NodeBinary({
      name: `${this.name}-node-binary`,
      parent,
      properties: {
        version: this.get('nodeVersion'),
        platform: this.get('platform'),
        architecture: this.get('architecture'),
      },
    });
    const esbuild_binary = new PackageBinary({
      name: `${this.name}-esbuild-binary`,
      properties: {
        version: ESBUILD_VERSION,
        platform: this.get('platform'),
        architecture: this.get('architecture'),
        packageName: () => {
          /** @type {Object<string, string>} */
          const packageMap = {
            'darwin-x64': '@esbuild/darwin-x64',
            'darwin-arm64': '@esbuild/darwin-arm64',
            'win-x64': '@esbuild/win32-x64',
            'win-arm64': '@esbuild/win32-arm64',
            'linux-x64': '@esbuild/linux-x64',
            'linux-arm64': '@esbuild/linux-arm64',
          };
          if (
            !packageMap[`${this.get('platform')}-${this.get('architecture')}`]
          ) {
            throw new Error(
              `No esbuild package for ${this.get('platform')}-${this.get(
                'architecture'
              )}`
            );
          }
          return packageMap[
            `${this.get('platform')}-${this.get('architecture')}`
          ];
        },
        binaryRelativePath: () =>
          this.get('platform') === 'win' ? 'esbuild.exe' : 'bin/esbuild',
      },
    });
    const main_bundle = new JSBundle({
      name: `${this.name}-bundle`,
      parent,
      dependsOn: [],
      properties: {
        entryCode: () => {
          return `
              (async () => {
                require('source-map-support').install();
                // Auto-generated entry file
                require(${JSON.stringify(this.callerFile)});
                await global.__wharfieActorInitializeEnvironmentFunctions['${this.getName()}']();
                // Execute the actor function captured from the original context.
                await global.__wharfieActorFunctions['${this.getName()}']();
              })();
          `;
        },
        resolveDir: () => path.dirname(this.callerDirectory),
        nodeVersion: this.get('nodeVersion'),
      },
    });
    const application = new NodeSingleExecutableApplication({
      name: `${this.name}-application`,
      parent,
      dependsOn: [main_bundle],
      properties: {
        bundlePath: () => main_bundle.get('bundlePath'),
        nodeBinaryPath: () => node_binary.get('binaryPath'),
        nodeVersion: this.get('nodeVersion'),
        platform: this.get('platform'),
        architecture: this.get('architecture'),
        assets: () => {
          return {
            [esbuild_binary.name]: esbuild_binary.get('binaryPath'),
          };
        },
      },
    });
    /** @type {(import('../base-resource') | import('../base-resource-group'))[]} */
    const resources = [node_binary, esbuild_binary, application];
    if (this.get('platform') === 'darwin') {
      const macosBinarySignature = new MacOSBinarySignature({
        name: `${this.name}-macos-binary-signature`,
        parent,
        dependsOn: [application],
        properties: {
          binaryPath: () => application.get('binaryPath'),
          macosCertBase64: this.get('macosCertBase64'),
          macosCertPassword: this.get('macosCertPassword'),
          macosKeychainPassword: this.get('macosKeychainPassword'),
        },
      });
      resources.push(macosBinarySignature);
    }
    return resources;
  }

  getBinaryPath() {
    return this.getResource(`${this.name}-build`).get('binaryPath');
  }

  async reconcile() {
    if (
      // @ts-ignore
      typeof __WILLEM_BUILD_RECONCILE_TERMINATOR !== 'undefined' &&
      /* eslint-disable no-undef */
      // @ts-ignore
      __WILLEM_BUILD_RECONCILE_TERMINATOR
      /* eslint-enable no-undef */
    ) {
      return;
    }
    await super.reconcile();
  }

  async run() {
    if (!this.isStable()) throw new Error('Actor is not stable');
    console.log(this.getBinaryPath());
    await execFile(this.getBinaryPath(), [], {});
  }
}

module.exports = Actor;
