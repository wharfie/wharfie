const { createRequire } = require('module');
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const tar = require('tar');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const paths = require('./paths');

const VM_PATH = path.join(paths.data, 'vms');

/**
 * @typedef VMSandboxOptions
 * @property {Buffer} [externalsTar] -
 * @property {Object<string,string>} [env] -
 */

/**
 * @param {string} name -
 * @param {string} codeString -
 * @param {VMSandboxOptions} options -
 * @returns {Promise<any>} -
 */
async function runInSandbox(name, codeString, { externalsTar, env = {} }) {
  await fsp.mkdir(VM_PATH, { recursive: true });
  const tmpRoot = fs.mkdtempSync(path.join(VM_PATH, `${name}-sandbox`));
  const nodeModules = path.join(tmpRoot, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });

  const entryFile = path.join(tmpRoot, `${name}.js`);
  const pkgFile = path.join(tmpRoot, 'package.json');
  // Write package.json and entry
  if (externalsTar) {
    const src = Readable.from(externalsTar);
    const extractor = tar.x({
      C: tmpRoot, // extraction root
      preserveOwner: false,
      unlink: true, // replace existing files
      // strip: 1,        // optionally strip the top-level folder
      // onentry: e => { /* observe each entry */ },
    });
    await pipeline(src, extractor);
  }

  const sandboxRequire = createRequire(pkgFile);

  // 3) Build a fresh context (a “sandbox”) that injects exactly the globals we want:
  const sandboxTemplate = {
    // ─── CommonJS environment ───────────────────────────────────────────────
    require: sandboxRequire,
    module: { exports: {} },
    exports: {},

    // ─── JS built‐ins ────────────────────────────────────────────────────────
    Object,
    Function,
    Boolean,
    Symbol,
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,
    Number,
    BigInt,
    Math,
    Date,
    String,
    RegExp,
    Array,
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    ArrayBuffer,
    SharedArrayBuffer,
    DataView,
    Map,
    WeakMap,
    Set,
    WeakSet,
    Promise,
    // Generator,
    // GeneratorFunction,
    AsyncFunction: async function () {}.constructor,
    Reflect,
    Proxy,
    JSON,
    Intl,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    performance,
    queueMicrotask,

    // ─── Node‐specific globals ────────────────────────────────────────────────
    console,
    process: {
      ...process,
      env: { ...env },
    },
    Buffer,

    // Make “global” refer to this sandbox itself
    global: undefined, // will assign below

    // __dirname / __filename so relative requires still work
    __filename: entryFile,
    __dirname: tmpRoot,

    // ─── Timer APIs ─────────────────────────────────────────────────────────
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,

    // If you need fetch or other globals, add them here.
  };
  // 4) Assign sandboxTemplate.global → sandboxTemplate (so “global === sandbox”)
  // @ts-ignore
  sandboxTemplate.global = sandboxTemplate;

  const contextified = vm.createContext(sandboxTemplate);

  // 5) Compile & run the code inside that context
  //    We pass `{ filename: 'start.js' }` strictly for stack traces / debugging.
  const script = new vm.Script(codeString, { filename: name });
  const result = script.runInContext(contextified);

  // 5) If result is a Promise, await it. If it’s not, skip immediately.
  if (result && typeof result.then === 'function') {
    await result;
  }

  // 6) By now, all async tasks kicked off at top‐level have resolved/awaited.
  return contextified.module.exports;
}

module.exports = {
  runInSandbox,
};
