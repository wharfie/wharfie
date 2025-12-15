import { parentPort, isMainThread } from 'node:worker_threads';
import { createRequire } from 'module';

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

// const requireCache = new Map();   // pkgFile -> require()

// function getRequire(pkgFile) {
//   let r = requireCache.get(pkgFile);
//   if (!r) {
//     r = createRequire(pkgFile);
//     requireCache.set(pkgFile, r);
//   }
//   return r;
// }

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
    `"use strict";\n${codeString}\n`
  );

  // const moduleObj = { exports: {} };

  bundleFn(
    sandboxRequire,
    // moduleObj,
    // moduleObj.exports,
    entryFile,
    tmpRoot
    // sandboxProcess
  );

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
    const { id, kind } = msg || {};
    if (kind !== 'exec') return;

    const {
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
          `Global entrypoint ${functionName} is not a function`
        );
      }

      const args = Array.isArray(__ENTRY_ARGS__)
        ? __ENTRY_ARGS__
        : [__ENTRY_ARGS__];
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
