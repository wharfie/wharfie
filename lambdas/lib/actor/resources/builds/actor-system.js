const uuid = require('uuid');

const BuildResourceGroup = require('./build-resource-group');
const NodeBinary = require('./node-binary');
const BuildResource = require('./build-resource');
const FunctionResource = require('./function-resource');
const SeaBuild = require('./sea-build');
const MacOSBinarySignature = require('./macos-binary-signature');
const cli = require('./actor-system-cli');

const path = require('node:path');

/**
 * @typedef {NodeJS.Process["platform"]} TargetPlatform
 * @typedef {NodeJS.Architecture} TargetArch
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
 * @typedef WharfieActorSystemProperties
 * @property {BuildTarget[] | function(): BuildTarget[]} targets -
 * @property {import('./function')[]} [functions] -
 */

/**
 * @typedef WharfieActorSystemOptions
 * @property {string} name -
 * @property {import('./function')[]} [functions] -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {WharfieActorSystemProperties & import('../../typedefs').SharedProperties} properties -
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
    functions = [],
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
      dependsOn: [...(dependsOn ?? [])],
    });
    this.functions = functions;
    // @ts-ignore
    this.callerFile = module?.parent?.filename;
    this.callerDirectory = this.callerFile
      ? path.dirname(this.callerFile)
      : undefined;
    // normally _defineGroupResources is used but this is a workaround to make sure this.functions and this.callerFile is set before defining things
    this.addResources(this.defineActorSystemResources(parent));
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
   * @param {string|undefined} parent -
   * @param {BuildTarget} target -
   * @returns {(import('../base-resource') | import('../base-resource-group'))[]} -
   */
  _defineTargetResources(
    parent,
    { nodeVersion, platform, architecture, libc }
  ) {
    /** @type {(import('../base-resource') | import('../base-resource-group'))[]} */
    const resources = [];
    const node_binary = new NodeBinary({
      name: `${this.name}-node-binary-${nodeVersion}-${platform}-${architecture}`,
      parent,
      properties: {
        version: nodeVersion,
        platform: platform,
        architecture: architecture,
      },
    });
    const targetFunctions = this.functions.map(
      (/** @type {import('./function')} */ func) => {
        return new FunctionResource(func.fn, {
          name: `${func.name}-${nodeVersion}-${platform}-${architecture}`,
          parent,
          dependsOn: [node_binary],
          properties: {
            functionName: func.name,
            ...func.properties,
            resolveDir: () => path.dirname(this.callerDirectory || ''),
            callerFile: () => this.callerFile,
            buildTarget: () => ({
              nodeVersion: node_binary.get('exactVersion').slice(1),
              platform: platform,
              architecture: architecture,
              libc: libc,
            }),
          },
        });
      }
    );
    const build = new SeaBuild({
      name: `${this.name}-build-${nodeVersion}-${platform}-${architecture}`,
      parent,
      dependsOn: [node_binary, ...targetFunctions],
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
        nodeVersion: () => node_binary.get('exactVersion').slice(1),
        platform: platform,
        architecture: architecture,
        environmentVariables: () => {
          return {};
        },
        assets: () => {
          return targetFunctions.reduce(
            (
              /** @type {{ [x: string]: string; }} */ acc,
              /** @type {import('./function-resource')} */ func
            ) => {
              acc[
                func.name.replace(
                  `-${nodeVersion}-${platform}-${architecture}`,
                  ''
                )
              ] = func.get('singleExecutableAssetPath');
              return acc;
            },
            {}
          );
        },
      },
    });
    /** @type {(import('../base-resource') | import('../base-resource-group'))[]} */
    resources.push(node_binary, build, ...targetFunctions);
    if (platform === 'darwin') {
      const macosBinarySignature = new MacOSBinarySignature({
        name: `${this.name}-macos-binary-signature-${nodeVersion}-${platform}-${architecture}`,
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

  /**
   * @param {string|undefined} parent -
   * @returns {(import('../base-resource') | import('../base-resource-group'))[]} -
   */
  defineActorSystemResources(parent) {
    /** @type {(import('../base-resource') | import('../base-resource-group'))[]} */
    const resources = [];
    this.get('targets', []).map((/** @type {BuildTarget} */ target) => {
      resources.push(...this._defineTargetResources(parent, target));
    });
    return resources;
  }

  getBinaryPath() {
    return this.getResource(`${this.name}-build`).get('binaryPath');
  }

  async run() {
    await cli();
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
