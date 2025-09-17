const uuid = require('uuid');

const BuildResourceGroup = require('./build-resource-group');
const NodeBinary = require('./node-binary');
const BuildResource = require('./build-resource');
const SeaBuild = require('./sea-build');
const MacOSBinarySignature = require('./macos-binary-signature');
const Actor = require('./actor/');
const paths = require('../../../paths');

const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');

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
    this.functionMap = functions.reduce((acc, func) => {
      acc.set(func.name, func);
      return acc;
    }, new Map());
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
          return this.functions.reduce(
            (
              /** @type {{ [x: string]: string; }} */ acc,
              /** @type {import('./function')} */ func
            ) => {
              acc[func.name] = func.get('singleExecutableAssetPath');
              return acc;
            },
            {}
          );
        },
      },
    });
    // const actors = this.functions.map(func =>
    //   new Actor({
    //     name: `${func.name}-actor`,
    //     func,
    //     properties: {
    //       infrastructure: 'local'
    //     }
    //   })
    // )
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

  async run() {
    console.log(process.argv);
    if (process.argv.length <= 2) {
      // this should spin up polling actor/workqueues
      console.log('starting system');

      const controller = new AbortController();
      const { signal } = controller;
      const child = fork('start', ['hello'], { signal });
      child.on('error', (err) => {
        // This will be called with err being an AbortError if the controller aborts
      });
      const [exitCode] = await once(child, 'exit');
      console.log('exited with ', exitCode);
      // c
      // controller.abort();
    } else {
      // assume that we are passing some work to a specific function
      const binary = process.argv[0];
      const filteredArgs = process.argv.filter((arg) => arg != binary);
      console.log(filteredArgs);
      const functionName = filteredArgs[0];
      console.log(`running function ${functionName}`);
      const func = this.functionMap.get(functionName);
      await func.run(filteredArgs[1], { context: 'foo' });
    }
  }
}
ActorSystem.DefaultProperties = {
  infrastructure: 'local',
  functions: [],
};

module.exports = ActorSystem;
