const uuid = require('uuid');

const BuildResourceGroup = require('./build-resource-group');
const NodeBinary = require('./node-binary');
const BuildResource = require('./build-resource');
const SeaBuild = require('./sea-build');
const MacOSBinarySignature = require('./macos-binary-signature');
// const { execFile } = require('../../../cmd');
const paths = require('../../../paths');
const vm = require('../../../vm');

const path = require('node:path');
const zlib = require('node:zlib');
const fs = require('node:fs');
const { getAsset } = require('node:sea');

/**
 * @typedef {('local'|'aws')} InfrastructurePlatform
 */

/**
 * @typedef {('darwin'|'win'|'linux')} SeaBinaryPlatform
 */
/**
 * @typedef {('x64'|'arm64')} SeaBinaryArch
 */

/**
 * @typedef WharfieActorSystemProperties
 * @property {InfrastructurePlatform | function(): InfrastructurePlatform} infrastructure -
 * @property {string | function(): string} nodeVersion -
 * @property {SeaBinaryPlatform | function(): SeaBinaryPlatform} platform -
 * @property {SeaBinaryArch | function(): SeaBinaryArch} architecture -
 */

/**
 * @typedef WharfieActorSystemOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {WharfieActorSystemProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('./function')[]} functions -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('../base-resource') | import('../base-resource-group')>} [resources] -
 */

class ActorSystem extends BuildResourceGroup {
  /**
   * @param {WharfieActorSystemOptions} options -
   */
  constructor({
    name,
    parent,
    status,
    properties,
    resources,
    dependsOn,
    functions,
  }) {
    const propertiesWithDefaults = Object.assign(
      {},
      ActorSystem.DefaultProperties,
      properties
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      resources,
      dependsOn: [...(dependsOn ?? []), ...(functions ?? [])],
    });
    this.functions = functions;
    // @ts-ignore
    this.callerFile = module?.parent?.filename;
    this.callerDirectory = this.callerFile
      ? path.dirname(this.callerFile)
      : undefined;

    // @ts-ignore
    global[Symbol.for(`${this.getName()}`)] = this.run.bind(this);
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
    const build = new SeaBuild({
      name: `${this.name}-build`,
      parent,
      dependsOn: [node_binary],
      properties: {
        entryCode: () => {
          return `
              (async () => {
                console.time('overall');
                require('source-map-support').install();
                // Auto-generated entry file
                require(${JSON.stringify(this.callerFile)});
                await global[Symbol.for('${this.getName()}')]();
                console.timeEnd('overall');
              })();
          `;
        },
        resolveDir: () => path.dirname(this.callerDirectory || ''),
        nodeBinaryPath: () => node_binary.get('binaryPath'),
        nodeVersion: this.get('nodeVersion'),
        platform: this.get('platform'),
        architecture: this.get('architecture'),
        environmentVariables: () => {
          return {};
        },
        assets: () => {
          const functions = this.functions;
          return functions.reduce(
            (
              /** @type {{ [x: string]: any; }} */ acc,
              /** @type {import('./function')} */ func
            ) => {
              // i don't know why this doesn't work
              // const filePath = func.get('codeBundlePath');
              // const filePath = func.properties.codeBundlePath;
              // if (!fs.existsSync(filePath)) { return acc }
              const bundledAssetPath = path.join(
                ActorSystem.TEMP_ASSET_PATH,
                uuid.v4()
              );
              const codeBundle = zlib
                .brotliCompressSync(func.properties.codeBlob)
                .toString('base64');
              const assetDescription = JSON.stringify({
                codeBundle,
                externalsTar: func.properties.externalsTar,
              });
              fs.writeFileSync(bundledAssetPath, assetDescription);
              acc[func.name] = bundledAssetPath;
              return acc;
            },
            {}
          );
        },
      },
    });
    /** @type {(import('../base-resource') | import('../base-resource-group'))[]} */
    const resources = [node_binary, build];
    if (this.get('platform') === 'darwin') {
      const macosBinarySignature = new MacOSBinarySignature({
        name: `${this.name}-macos-binary-signature`,
        parent,
        dependsOn: [build],
        properties: {
          binaryPath: () => build.get('binaryPath'),
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

  async _reconcile() {
    if (!fs.existsSync(ActorSystem.TEMP_ASSET_PATH)) {
      await fs.promises.mkdir(ActorSystem.TEMP_ASSET_PATH, {
        recursive: true,
      });
    }
    await super._reconcile();
  }

  /**
   * @param {string} functionName -
   */
  async runLocalFunction(functionName) {
    const functionAssetBuffer = await getAsset(functionName);
    const functionDescriptionBuffer = Buffer.from(functionAssetBuffer);
    const assetDescription = JSON.parse(functionDescriptionBuffer.toString());
    const functionBuffer = zlib.brotliDecompressSync(
      Buffer.from(assetDescription.codeBundle, 'base64')
    );
    const functionCodeString = functionBuffer.toString();
    console.time('sandbox');
    await vm.runInSandbox(functionName, functionCodeString, {
      externalsTar: Buffer.from(assetDescription.externalsTar, 'base64'),
    });
    console.timeEnd('sandbox');
  }

  // /**
  //  * @param {string} functionName -
  //  */
  // async runRemoteFunction(functionName) {
  //   const functionAssetBuffer = await getAsset(functionName);
  //   const compressedFunctionBuffer = Buffer.from(functionAssetBuffer);
  //   const functionBuffer = zlib.brotliDecompressSync(compressedFunctionBuffer);
  //   const functionCodeString = functionBuffer.toString();
  //   console.time('sandbox')
  //   await vm.runInSandbox(functionName, functionCodeString, {});
  //   console.timeEnd('sandbox')
  // }

  async run() {
    console.time('run');
    await this.runLocalFunction('start');
    console.timeEnd('run');
  }
}
ActorSystem.DefaultProperties = {
  infrastructure: 'local',
  functions: [],
};
ActorSystem.TEMP_ASSET_PATH = path.join(paths.temp, 'actor-system-assets');

module.exports = ActorSystem;
