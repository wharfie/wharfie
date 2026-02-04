import { getAsset } from 'node:sea';
import worker from '../../../code-execution/worker.js';
import { brotliDecompressSync } from 'node:zlib';

import path from 'node:path';

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name - name.
 * @property {string} version - version.
 */

/**
 * @typedef FunctionProperties
 * @property {ExternalDependencyDescription[]} [external] - external.
 * @property {Object<string,string>} [environmentVariables] - environmentVariables.
 */

/**
 * @typedef FunctionEntrypoint
 * @property {string} path - path.
 * @property {string} [export] - export.
 */

/**
 * @typedef FunctionOptions
 * @property {string} name - name.
 * @property {FunctionEntrypoint} entrypoint - entrypoint.
 * @property {FunctionProperties} [properties] - properties.
 */

/**
 * @typedef FunctionRunOptions
 * @property {Record<string, any>} [resources] - In-process resource instances to expose to the sandbox via RPC.
 */

/**
 * @param {any} v - v.
 * @returns {boolean} - Result.
 */
function isObject(v) {
  return !!v && typeof v === 'object';
}

/**
 * Split a context object into:
 * - a clone-safe context (no resource client instances)
 * - an RPC resource map to be hosted in the parent process
 *
 * We conservatively treat `context.resources.{db,queue,objectStorage}` as RPC candidates
 * when the value looks like a client instance (has at least one function property).
 * @param {any} context - context.
 * @returns {{ safeContext: any, rpcResources: Record<string, any> | null }} - Result.
 */
function splitContextForWorker(context) {
  if (!isObject(context)) return { safeContext: context, rpcResources: null };

  const res = context.resources;
  if (!isObject(res)) return { safeContext: context, rpcResources: null };

  /** @type {Record<string, any>} */
  const rpcResources = {};
  const safeResources = { ...res };

  for (const key of ['db', 'queue', 'objectStorage']) {
    const v = res[key];
    if (!isObject(v)) continue;

    // Heuristic: client instances have at least one function property.
    const hasFn = Object.values(v).some((x) => typeof x === 'function');
    if (!hasFn) continue;

    rpcResources[key] = v;
    delete safeResources[key];
  }

  if (Object.keys(rpcResources).length === 0) {
    return { safeContext: context, rpcResources: null };
  }

  return {
    safeContext: { ...context, resources: safeResources },
    rpcResources,
  };
}

class Function {
  /**
   * @param {FunctionOptions} options - options.
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
   * Run a bundled function in the sandbox worker.
   *
   * If `options.resources` (or `context.resources.{db,queue,objectStorage}`) contains
   * in-process resource client instances, they are exposed to the worker via an RPC
   * bridge, and the worker sees them as `context.resources.*` proxies.
   * @param {string} name - name.
   * @param {any} event - event.
   * @param {any} context - context.
   * @param {FunctionRunOptions} [options] - options.
   */
  static async run(name, event, context = {}, options = {}) {
    const functionAssetBuffer = await getAsset(name);
    const functionDescriptionBuffer = Buffer.from(functionAssetBuffer);
    const assetDescription = JSON.parse(functionDescriptionBuffer.toString());
    const functionBuffer = brotliDecompressSync(
      Buffer.from(assetDescription.codeBundle, 'base64'),
    );
    const functionCodeString = functionBuffer.toString();

    const externalsTarB64 = assetDescription.externalsTar;
    const externalsTar =
      typeof externalsTarB64 === 'string' && externalsTarB64.length > 0
        ? Buffer.from(externalsTarB64, 'base64')
        : null;

    let rpcResources = options?.resources || null;
    let safeContext = context;

    if (rpcResources && Object.keys(rpcResources).length > 0) {
      // Ensure we don't try to structured-clone the client instances inside context.
      if (isObject(safeContext) && isObject(safeContext.resources)) {
        const safeRes = { ...safeContext.resources };
        for (const k of Object.keys(rpcResources)) delete safeRes[k];
        safeContext = { ...safeContext, resources: safeRes };
      }
    } else {
      const split = splitContextForWorker(context);
      safeContext = split.safeContext;
      rpcResources = split.rpcResources;
    }

    console.time('WORKER time');
    await worker.runInSandbox(name, functionCodeString, [event, safeContext], {
      ...(externalsTar && externalsTar.length > 0 ? { externalsTar } : {}),
      rpc:
        rpcResources && Object.keys(rpcResources).length > 0
          ? { resources: rpcResources, contextIndex: 1 }
          : undefined,
    });
    console.timeEnd('WORKER time');

    await worker._destroyWorker();
  }

  /**
   * Load the function entrypoint and invoke it in-process.
   *
   * This is primarily used by the (single-process) ActorSystem runtime.
   * @param {any} [event] - event.
   * @param {any} [context] - context.
   * @returns {Promise<any>} - Result.
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
        `Invalid function entrypoint: ${this.entrypoint.path} export ${
          this.entrypoint.export || 'default'
        } is not a function`,
      );
    }

    // Support both sync and async handlers.
    const result = candidate(event, context);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return result;
  }
}

export default Function;
