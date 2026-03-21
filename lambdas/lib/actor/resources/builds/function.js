import { getAsset } from 'node:sea';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

import worker from '../../../code-execution/worker.js';
import { createActorSystemResources } from '../../runtime/resources.js';
import { normalizeExternalDependencies } from './lib/resolve-externals.js';

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name - name.
 * @property {string} version - version.
 */

/**
 * @typedef ExternalDependencyInput
 * @property {string} name - name.
 * @property {string} [version] - version.
 */

/**
 * @typedef FunctionProperties
 * @property {(string | ExternalDependencyInput)[]} [external] - external.
 * @property {Object<string,string>} [environmentVariables] - environmentVariables.
 * @property {Record<string, any>} [resources] - Function-scoped runtime resources or specs.
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
 * @typedef FunctionInvokeOptions
 * @property {Record<string, any>} [baseResources] - Base resources to merge beneath function-scoped resources.
 */

/**
 * @param {any} v - v.
 * @returns {boolean} - Result.
 */
function isObject(v) {
  return !!v && typeof v === 'object';
}

/**
 * @param {Record<string, any> | null | undefined} resources - resources.
 * @returns {boolean} - Result.
 */
function hasAnyResources(resources) {
  return !!resources && Object.keys(resources).length > 0;
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
    const { external, environmentVariables, resources } = properties;
    const normalizedExternal = normalizeExternalDependencies(
      external,
      entrypoint?.path,
    );
    this.name = name;
    this.entrypoint = entrypoint;
    this.properties = {
      ...(normalizedExternal ? { external: normalizedExternal } : {}),
      ...(environmentVariables ? { environmentVariables } : {}),
      ...(resources ? { resources } : {}),
    };
    /** @type {Promise<{ resources: Record<string, any>, close: () => Promise<void> }> | null} */
    this._runtimeResourcesPromise = null;
  }

  /**
   * Lazily create and cache runtime resources from `properties.resources`.
   * @returns {Promise<{ resources: Record<string, any>, close: () => Promise<void> }>} - Result.
   */
  async _ensureRuntimeResources() {
    if (this._runtimeResourcesPromise) return this._runtimeResourcesPromise;

    const specs = isObject(this.properties?.resources)
      ? this.properties.resources
      : {};

    if (!hasAnyResources(specs)) {
      this._runtimeResourcesPromise = Promise.resolve({
        resources: {},
        close: async () => {},
      });
      return this._runtimeResourcesPromise;
    }

    this._runtimeResourcesPromise = createActorSystemResources(specs);
    return this._runtimeResourcesPromise;
  }

  /**
   * Get the instantiated runtime resources for this Function.
   * @returns {Promise<Record<string, any>>} - Result.
   */
  async getRuntimeResources() {
    const { resources } = await this._ensureRuntimeResources();
    return resources;
  }

  /**
   * Close all cached runtime resources (best-effort).
   * @returns {Promise<void>} - Result.
   */
  async closeRuntimeResources() {
    if (!this._runtimeResourcesPromise) return;
    const { close } = await this._ensureRuntimeResources();
    await close();
    this._runtimeResourcesPromise = null;
  }

  /**
   * Build a context object for function invocation.
   *
   * Precedence is: base resources < function resources < caller-provided resources.
   * @param {any} [context] - context.
   * @param {Record<string, any>} [baseResources] - baseResources.
   * @returns {Promise<any>} - Result.
   */
  async createContext(context = {}, baseResources = {}) {
    const functionResources = await this.getRuntimeResources();
    const overrideResources = isObject(context?.resources)
      ? context.resources
      : {};
    const mergedResources = {
      ...(baseResources || {}),
      ...(functionResources || {}),
      ...(overrideResources || {}),
    };

    const shouldAttachResources =
      hasAnyResources(mergedResources) ||
      (isObject(context) &&
        Object.prototype.hasOwnProperty.call(context, 'resources'));

    if (!shouldAttachResources) {
      return context;
    }

    return {
      ...context,
      resources: mergedResources,
    };
  }

  /**
   * Run a bundled function in the sandbox worker.
   *
   * If `options.resources` (or `context.resources.{db,queue,objectStorage}`) contains
   * in-process resource client instances, they are exposed to the worker via an RPC
   * bridge, and the worker sees them as `context.resources.*` proxies.
   *
   * Bundled functions can also embed `resourceSpecs`; Wharfie will instantiate those
   * resources per invocation and merge them between host resources and caller overrides.
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

    const split = splitContextForWorker(context);
    const safeContext = split.safeContext;
    const contextRpcResources = split.rpcResources || {};

    /** @type {{ resources: Record<string, any>, close: () => Promise<void> } | null} */
    let scopedResources = null;
    const bundledResourceSpecs = isObject(assetDescription.resourceSpecs)
      ? assetDescription.resourceSpecs
      : null;

    try {
      if (bundledResourceSpecs && hasAnyResources(bundledResourceSpecs)) {
        scopedResources =
          await createActorSystemResources(bundledResourceSpecs);
      }

      const rpcResources = {
        ...((options?.resources && isObject(options.resources)
          ? options.resources
          : {}) || {}),
        ...(scopedResources?.resources || {} || {}),
        ...(contextRpcResources || {}),
      };

      console.time('WORKER time');
      await worker.runInSandbox(
        name,
        functionCodeString,
        [event, safeContext],
        {
          ...(externalsTar && externalsTar.length > 0 ? { externalsTar } : {}),
          rpc: hasAnyResources(rpcResources)
            ? { resources: rpcResources, contextIndex: 1 }
            : undefined,
        },
      );
      console.timeEnd('WORKER time');
    } finally {
      if (scopedResources) {
        await scopedResources.close();
      }
      await worker._destroyWorker();
    }
  }

  /**
   * Load the function entrypoint and invoke it in-process.
   *
   * This is primarily used by the (single-process) ActorSystem runtime.
   * @param {any} [event] - event.
   * @param {any} [context] - context.
   * @param {FunctionInvokeOptions} [options] - options.
   * @returns {Promise<any>} - Result.
   */
  async fn(event = {}, context = {}, options = {}) {
    const entryPath = path.isAbsolute(this.entrypoint.path)
      ? this.entrypoint.path
      : path.resolve(this.entrypoint.path);
    const invocationContext = await this.createContext(
      context,
      options.baseResources || {},
    );

    // CJS: require() exists. ESM: use dynamic import().
    const handler =
      typeof require === 'function'
        ? // eslint-disable-next-line import/no-dynamic-require, no-undef
          require(entryPath)
        : await import(entryPath);

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
    const result = candidate(event, invocationContext);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return result;
  }
}

export default Function;
