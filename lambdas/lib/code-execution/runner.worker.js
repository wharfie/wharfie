import { parentPort, isMainThread } from 'node:worker_threads';
import { createRequire } from 'module';
import { Readable } from 'node:stream';

if (process.setSourceMapsEnabled) process.setSourceMapsEnabled(true);

// Global guards – shared across any accidental re-evaluations of this script

// @ts-ignore
if (!global.__wharfieWorkerInit) {
  // @ts-ignore
  global.__wharfieWorkerInit = {
    handlerInstalled: false,
    bundleLoaded: false,
  };
}

/**
 * Pending RPC calls made by resource proxies.
 *
 * @type {Map<number, { resolve: (v: any) => void, reject: (e: any) => void }>}
 */
const rpcPending = new Map();
let nextRpcId = 1;

/**
 * @param {any} v
 * @returns {any}
 */
function reviveCloneable(v) {
  if (!v) return v;

  if (Array.isArray(v)) return v.map(reviveCloneable);

  if (v && typeof v === 'object') {
    // Our host-side convention for materialized Node Readable streams.
    if (v.__wharfie_type === 'readable' && v.data) {
      return Readable.from(v.data);
    }

    // Common S3-ish shape: { Body: { __wharfie_type: 'readable', data: ... } }
    if (v.Body && v.Body.__wharfie_type === 'readable' && v.Body.data) {
      return { ...v, Body: Readable.from(v.Body.data) };
    }
  }

  return v;
}

/**
 * @param {string} sessionId
 * @param {string} resource
 * @param {string} method
 * @param {any[]} args
 * @returns {Promise<any>}
 */
function rpcCall(sessionId, resource, method, args) {
  const port = parentPort;
  if (!port) {
    throw new Error('RPC unavailable: parentPort is not defined');
  }

  const id = nextRpcId++;

  return new Promise((resolve, reject) => {
    rpcPending.set(id, { resolve, reject });
    port.postMessage({
      kind: 'rpc',
      id,
      sessionId,
      resource,
      method,
      args,
    });
  });
}

/**
 * @param {string} sessionId
 * @param {string} resourceName
 * @returns {any}
 */
function createRpcProxy(sessionId, resourceName) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        // Prevent await/Promise detection from treating this as a thenable.
        if (prop === 'then') return undefined;

        // Debug/inspection helpers
        if (prop === '__wharfie_isRpcProxy') return true;
        if (prop === 'toJSON') return () => `[rpc:${resourceName}]`;

        // Only string method names are supported over the wire.
        if (typeof prop !== 'string') return undefined;

        /** @type {(...args: any[]) => Promise<any>} */
        const fn = async (...args) => {
          const res = await rpcCall(sessionId, resourceName, prop, args);
          return reviveCloneable(res);
        };
        return fn;
      },
    },
  );
}

/**
 * @param {any} ctx
 * @returns {any}
 */
function hydrateContextResources(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;

  const res = ctx.resources;
  if (!res || typeof res !== 'object') return ctx;

  if (res.__wharfie_rpc !== true) return ctx;

  const sessionId = res.__wharfie_rpc_sessionId;
  const names = res.__wharfie_rpc_resources;

  if (!sessionId || typeof sessionId !== 'string') return ctx;
  if (!Array.isArray(names)) return ctx;

  // Preserve any serializable resources the host included, but strip RPC markers.
  /** @type {Record<string, any>} */
  const extras = { ...res };
  delete extras.__wharfie_rpc;
  delete extras.__wharfie_rpc_sessionId;
  delete extras.__wharfie_rpc_resources;

  /** @type {Record<string, any>} */
  const proxied = { ...extras };

  for (const name of names) {
    if (typeof name !== 'string' || !name) continue;
    proxied[name] = createRpcProxy(sessionId, name);
  }

  return { ...ctx, resources: proxied };
}

/**
 *
 */
async function drainOneTick() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

// Run the esbuild bundle exactly ONCE per codeString
/**
 * @typedef RunBundleOptions
 * @property {string} codeString -
 * @property {string} pkgFile -
 * @property {string} entryFile -
 * @property {string} tmpRoot -
 * @property {Object<string,string>} env -
 */
/**
 * @param {RunBundleOptions} options -
 */
function runBundleOnce({ codeString, pkgFile, entryFile, tmpRoot, env }) {
  // Use codeString as the key – if it’s the same bundle, don’t re-run it
  // @ts-ignore
  if (global.__wharfieWorkerInit.bundleLoaded) return;

  console.log('[worker] REQUIRING WORKER CODE ONCE');

  const sandboxRequire = createRequire(pkgFile);

  const sandboxProcess = Object.create(process);
  Object.defineProperty(sandboxProcess, 'env', {
    value: { ...process.env, ...(env || {}) },
    writable: false,
    enumerable: true,
    configurable: false,
  });
  sandboxProcess.exit = (c = 0) => {
    throw new Error(`process.exit(${c}) called in sandbox`);
  };
  sandboxProcess.abort = () => {
    throw new Error('process.abort() called in sandbox');
  };
  sandboxProcess.kill = () => {
    throw new Error('process.kill() called in sandbox');
  };
  sandboxProcess.cwd = () => tmpRoot;

  // Wrap codeString as a CommonJS module and execute it once.
  // This bundle is responsible for doing require(callerFile)
  // and registering global[Symbol.for(functionName)].
  // eslint-disable-next-line no-new-func
  const bundleFn = new Function(
    'require',
    // 'module',
    // 'exports',
    '__filename',
    '__dirname',
    // 'process',
    `"use strict";\n${codeString}\n`,
  );

  bundleFn(sandboxRequire, entryFile, tmpRoot);

  // @ts-ignore
  global.__wharfieWorkerInit.bundleLoaded = true;
}

if (
  !isMainThread &&
  // @ts-ignore
  !global.__wharfieWorkerInit.handlerInstalled &&
  parentPort
) {
  // @ts-ignore
  global.__wharfieWorkerInit.handlerInstalled = true;
  parentPort.on('message', async (msg) => {
    const { kind } = msg || {};

    // Host -> worker RPC response
    if (kind === 'rpc_response') {
      const p = rpcPending.get(msg.id);
      if (!p) return;
      rpcPending.delete(msg.id);

      if (msg.ok) {
        p.resolve(msg.value);
      } else {
        p.reject(new Error(msg.error));
      }
      return;
    }

    if (kind !== 'exec') return;

    const {
      id,
      codeString,
      entryFile,
      tmpRoot,
      pkgFile,
      env,
      __ENTRY_ARGS__,
      functionName,
    } = msg;

    try {
      runBundleOnce({
        codeString,
        pkgFile,
        entryFile,
        tmpRoot,
        env,
      });

      const sym = Symbol.for(functionName);
      // @ts-ignore
      const fn = global[sym];
      if (typeof fn !== 'function') {
        throw new TypeError(
          `Global entrypoint ${functionName} is not a function`,
        );
      }

      const args = Array.isArray(__ENTRY_ARGS__)
        ? [...__ENTRY_ARGS__]
        : [__ENTRY_ARGS__];

      // Convention: args[1] is the "context" object.
      if (args.length > 1) {
        args[1] = hydrateContextResources(args[1]);
      }

      const result = fn(...args);

      if (result && typeof result.then === 'function') {
        await result;
      }

      await drainOneTick();

      parentPort && parentPort.postMessage({ id, ok: true });
    } catch (err) {
      parentPort &&
        parentPort.postMessage({
          id,
          ok: false,
          // @ts-ignore
          error: err && err.stack ? err.stack : String(err),
        });
    }
  });
}

export default () => {};
