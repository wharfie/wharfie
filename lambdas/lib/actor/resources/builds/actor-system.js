const uuid = require('uuid');

const BuildResourceGroup = require('./build-resource-group');
const NodeBinary = require('./node-binary');
const BuildResource = require('./build-resource');
const SeaBuild = require('./sea-build');
const MacOSBinarySignature = require('./macos-binary-signature');
const Actor = require('./actor/');
const paths = require('../../../paths');
const cli = require('./actor-system-cli');

const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');

/**
 * @typedef {('darwin'|'win32'|'linux')} SeaBinaryPlatform
 */
/**
 * @typedef {('x64'|'arm64')} SeaBinaryArch
 */

/**
 * @typedef WharfieActorSystemTarget
 * @property {string | function(): string} nodeVersion -
 * @property {SeaBinaryPlatform | function(): SeaBinaryPlatform} platform -
 * @property {SeaBinaryArch | function(): SeaBinaryArch} architecture -
 */

/**
 * @typedef WharfieActorSystemProperties
 * @property {WharfieActorSystemTarget[] | function(): WharfieActorSystemTarget[]} targets -
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
    this.functions = functions || ActorSystem.DefaultProperties.functions;
    this.functionMap = this.functions.reduce((acc, func) => {
      acc.set(func.name, func);
      return acc;
    }, new Map());
    // @ts-ignore
    this.callerFile = module?.parent?.filename;
    this.callerDirectory = this.callerFile
      ? path.dirname(this.callerFile)
      : undefined;

    // @ts-ignore
    global[Symbol.for('functionMap')] = this.functionMap;
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
    const { nodeVersion, platform, architecture } = this.get('targets')[0];
    const node_binary = new NodeBinary({
      name: `${this.name}-node-binary`,
      parent,
      properties: {
        version: nodeVersion,
        platform: platform,
        architecture: architecture,
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
                console.log("hello");
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
        nodeVersion: nodeVersion,
        platform: platform,
        architecture: architecture,
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
    /** @type {(import('../base-resource') | import('../base-resource-group'))[]} */
    const resources = [node_binary, build];
    if (platform === 'darwin') {
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
    let argv = process.argv;
    let stdinData = '';
    if (!process.stdin.isTTY) {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        stdinData += chunk;
      });
      process.stdin.on('end', () => {
        process.env.STDIN_DATA = stdinData;
      });
    }
    console.log(argv);
    console.log('RUNNING');
    await cli(argv);
    //   if (process.argv.length <= 2) {
    //     // this should spin up polling actor/workqueues
    //     console.log('starting system');

    //     const controller = new AbortController();
    //     const { signal } = controller;
    //     const child = fork('start', ['hello'], { signal });
    //     child.on('error', (err) => {
    //       // This will be called with err being an AbortError if the controller aborts
    //     });
    //     const [exitCode] = await once(child, 'exit');
    //     console.log('exited with ', exitCode);
    //     // c
    //     // controller.abort();
    //   } else {
    //     // assume that we are passing some work to a specific function
    //     const binary = process.argv[0];
    //     const filteredArgs = process.argv.filter((arg) => arg !== binary);
    //     console.log(filteredArgs);
    //     const functionName = filteredArgs[0];
    //     console.log(`running function ${functionName}`);
    //     const func = this.functionMap.get(functionName);
    //     await func.run(filteredArgs[1], { context: 'foo' });
    //   }
  }
}
ActorSystem.DefaultProperties = {
  functions: [],
};

module.exports = ActorSystem;
