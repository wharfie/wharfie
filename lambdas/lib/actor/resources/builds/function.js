const { getAsset } = require('node:sea');
const vm = require('../../../vm');
const zlib = require('node:zlib');

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name -
 * @property {string} version -
 */

/**
 * @typedef FunctionProperties
 * @property {ExternalDependencyDescription[]} [external] -
 * @property {Object<string,string>} [environmentVariables] -
 */

/**
 * @typedef FunctionOptions
 * @property {string} name -
 * @property {FunctionProperties} [properties] -
 */

class Function {
  /**
   * @param {function} fn -
   * @param {FunctionOptions} options -
   */
  constructor(fn, { name, properties = {} }) {
    this.fn = fn;
    if (typeof this.fn !== 'function') {
      throw new Error('Actor expects a function as an argument');
    }
    if (!name) {
      throw new Error('Actor expects a name as an argument');
    }
    const { external, environmentVariables } = properties;
    this.name = name;
    this.properties = {
      external: external,
      environmentVariables: environmentVariables,
    };
  }

  /**
   * @param {string} name
   * @param {any} event
   * @param {any} context
   */
  static async run(name, event, context) {
    const functionAssetBuffer = await getAsset(name);
    const functionDescriptionBuffer = Buffer.from(functionAssetBuffer);
    const assetDescription = JSON.parse(functionDescriptionBuffer.toString());
    const functionBuffer = zlib.brotliDecompressSync(
      Buffer.from(assetDescription.codeBundle, 'base64')
    );
    const functionCodeString = functionBuffer.toString();
    console.time('VM time');
    await vm.runInSandbox(name, functionCodeString, [event, context], {
      externalsTar: Buffer.from(assetDescription.externalsTar, 'base64'),
    });
    console.timeEnd('VM time');
  }

  // async recieve() {
  //   await Function.run({}, {});
  // }
}

module.exports = Function;
