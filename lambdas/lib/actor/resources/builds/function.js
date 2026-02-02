import { getAsset } from 'node:sea';
import worker from '../../../code-execution/worker.js';
import { brotliDecompressSync } from 'node:zlib';

// import { createRequire } from 'node:module';
import path from 'node:path';

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
 * @typedef FunctionEntrypoint
 * @property {string} path -
 * @property {string} [export] -
 */

/**
 * @typedef FunctionOptions
 * @property {string} name -
 * @property {FunctionEntrypoint} entrypoint -
 * @property {FunctionProperties} [properties] -
 */

class Function {
  /**
   * @param {FunctionOptions} options -
   */
  constructor({ name, entrypoint, properties = {} }) {
    if (!name) {
      throw new Error('Function expects a name as an argument');
    }
    const { external, environmentVariables } = properties;
    this.name = name;
    this.entrypoint = entrypoint;
    this.properties = {
      external,
      environmentVariables,
    };
  }

  /**
   * @param {string} name -
   * @param {any} event -
   * @param {any} context -
   */
  static async run(name, event, context) {
    const functionAssetBuffer = await getAsset(name);
    const functionDescriptionBuffer = Buffer.from(functionAssetBuffer);
    const assetDescription = JSON.parse(functionDescriptionBuffer.toString());
    const functionBuffer = brotliDecompressSync(
      Buffer.from(assetDescription.codeBundle, 'base64'),
    );
    const functionCodeString = functionBuffer.toString();
    console.time('WORKER time');
    await worker.runInSandbox(name, functionCodeString, [event, context], {
      externalsTar: Buffer.from(assetDescription.externalsTar, 'base64'),
    });
    console.timeEnd('WORKER time');
    // let t = 0
    // while (t < 10) {
    //   console.time('WORKER time');
    //   await worker.runInSandbox(name, functionCodeString, [event, context], {
    //     externalsTar: Buffer.from(assetDescription.externalsTar, 'base64'),
    //   });
    //   console.timeEnd('WORKER time');
    //   t += 1
    // }
    await worker._destroyWorker();
  }

  /**
   * Load the function entrypoint and invoke it in-process.
   * This is primarily used by the (single-process) ActorSystem runtime.
   * @param {any} [event] -
   * @param {any} [context] -
   * @returns {Promise<any>} -
   */
  async fn(event = {}, context = {}) {
    const entryPath = path.isAbsolute(this.entrypoint.path)
      ? this.entrypoint.path
      : path.resolve(this.entrypoint.path);

    // CJS: require() exists. ESM: use dynamic import().
    const handler =
      typeof require === 'function'
        ? // eslint-disable-next-line import/no-dynamic-require, no-undef
          require(entryPath)
        : // eslint-disable-next-line node/no-unsupported-features/es-syntax
          await import(entryPath);

    const candidate = this.entrypoint.export
      ? handler?.[this.entrypoint.export]
      : // for ESM default exports
        (handler?.default ?? handler);

    if (typeof candidate !== 'function') {
      throw new TypeError(
        `Invalid function entrypoint: ${this.entrypoint.path} export ${this.entrypoint.export || 'default'} is not a function`,
      );
    }

    // Support both sync and async handlers.
    const result = candidate(event, context);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return result;
  }

  // async recieve() {
  //   await Function.run({}, {});
  // }
}

export default Function;
