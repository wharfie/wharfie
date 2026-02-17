import { join, dirname } from 'node:path';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants as FS, existsSync, readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { x } from 'tar';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buffer as streamToBuffer } from 'node:stream/consumers';
import { randomUUID } from 'node:crypto';

// esbuild inlines this file as text (configure: loader { '.worker.js': 'text' })
// In normal Node/Jest execution, this import resolves to the module default export (a function),
// NOT the source text. We fall back to reading the file from disk when needed.
// @ts-ignore
// eslint-disable-next-line import/default
import workerSource from './runner.worker.js';

import paths from '../paths.js';
const VM_PATH = join(paths.data, 'vms');

// --- singleton worker + response router ---
/**
 * @type {Worker | null}
 */
let worker = null;
let nextId = 1;
const pending = new Map();

/**
 * Active RPC sessions, keyed by `sessionId`.
 *
 * Each session maps a resource name (db/queue/objectStorage/etc) to an in-process client instance.
 * @type {Map<string, { resources: Record<string, any> }>}
 */
const rpcSessions = new Map();

/**
 * @returns {string} - Result.
 */
function getWorkerSourceText() {
  if (typeof workerSource === 'string') return workerSource;

  // Node/Jest path: load the worker source code from disk.
  const p = findRunnerWorkerPath();
  return readFileSync(p, 'utf8');
}

/**
 * @param {any} v - v.
 * @returns {boolean} - Result.
 */
function isNodeReadable(v) {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof v.pipe === 'function' &&
    typeof v.on === 'function'
  );
}

/**
 * Locate runner.worker.js on disk for non-bundled execution (e.g. Node/Jest).
 *
 * We intentionally avoid module URL APIs so this module can be bundled to CJS
 * (SEA build) without triggering esbuild's `empty-import-meta` warning.
 * @returns {string} - Result.
 */
function findRunnerWorkerPath() {
  const rel = join('lambdas', 'lib', 'code-execution', 'runner.worker.js');
  let dir = process.cwd();
  for (let i = 0; i < 25; i++) {
    const p = join(dir, rel);
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), rel);
}

/**
 * Make a value safe to structured-clone across the worker boundary.
 *
 * Notes:
 * - Buffers are cloneable
 * - Node Readable streams are NOT cloneable; we materialize them into a Buffer and tag them
 * so the worker can rehydrate a Readable.
 * @param {any} value - value.
 * @returns {Promise<any>} - Result.
 */
async function makeCloneable(value) {
  if (value === null || value === undefined) return value;

  // primitives
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;

  // Buffer / ArrayBuffer / typed arrays are cloneable
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value;

  // If it is directly a Readable, materialize
  if (isNodeReadable(value)) {
    const buf = await streamToBuffer(value);
    return { __wharfie_type: 'readable', data: buf };
  }

  // Common S3 shape: { Body: stream }
  if (value && typeof value === 'object' && 'Body' in value) {
    const body = value.Body;

    // AWS SDK v3 adds these mixins
    if (body && typeof body.transformToString === 'function') {
      // Prefer string when possible (smaller + common usage).
      const s = await body.transformToString('utf8');
      return { ...value, Body: s };
    }
    if (body && typeof body.transformToByteArray === 'function') {
      const arr = await body.transformToByteArray();
      return {
        ...value,
        Body: { __wharfie_type: 'readable', data: Buffer.from(arr) },
      };
    }
    if (isNodeReadable(body)) {
      const buf = await streamToBuffer(body);
      return { ...value, Body: { __wharfie_type: 'readable', data: buf } };
    }
  }

  // Best-effort: rely on structured clone, which will throw if unsupported.
  return value;
}

/**
 * @param {Worker} w - w.
 * @param {any} msg - msg.
 * @returns {Promise<void>} - Result.
 */
async function handleRpcMessage(w, msg) {
  const id = msg?.id;
  const sessionId = msg?.sessionId;
  const resourceName = msg?.resource;
  const methodName = msg?.method;
  const args = Array.isArray(msg?.args) ? msg.args : [];

  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

  if (!sessionId || typeof sessionId !== 'string') {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: 'RPC error: missing sessionId',
    });
    return;
  }

  const session = rpcSessions.get(sessionId);
  if (!session) {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: `RPC error: unknown sessionId ${sessionId}`,
    });
    return;
  }

  if (!resourceName || typeof resourceName !== 'string') {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: 'RPC error: missing resource name',
    });
    return;
  }

  const resource = session.resources?.[resourceName];
  if (!resource) {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: `RPC error: unknown resource '${resourceName}'`,
    });
    return;
  }

  if (
    !methodName ||
    typeof methodName !== 'string' ||
    forbidden.has(methodName)
  ) {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: `RPC error: invalid method '${String(methodName)}'`,
    });
    return;
  }

  const fn = resource?.[methodName];
  if (typeof fn !== 'function') {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      error: `RPC error: '${resourceName}.${methodName}' is not a function`,
    });
    return;
  }

  try {
    const result = fn.apply(resource, args);
    const awaited =
      result && typeof result.then === 'function' ? await result : result;

    const cloneable = await makeCloneable(awaited);

    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: true,
      value: cloneable,
    });
  } catch (err) {
    w.postMessage({
      kind: 'rpc_response',
      id,
      ok: false,
      // @ts-ignore
      error: err && err.stack ? err.stack : String(err),
    });
  }
}

/**
 * @param {string} name - name.
 * @returns {Worker} - Result.
 */
function ensureWorker(name) {
  if (worker) return worker;

  const src = getWorkerSourceText();

  // @ts-ignore
  const w = new Worker(src, {
    eval: true,
    stdout: true,
    stderr: true,
  });

  // forward stdio once
  w.stdout.setEncoding('utf8');
  w.stderr.setEncoding('utf8');
  w.stdout.on('data', (c) => process.stdout.write(`[worker:${name}] ${c}`));
  w.stderr.on('data', (c) => process.stderr.write(`[worker:${name}] ${c}`));

  w.on('message', (msg) => {
    // fatal diagnostics from worker (uncaught/unhandled)
    if (msg && msg.type === 'fatal') {
      console.error('[worker:fatal]', msg.error);
      return;
    }

    // Worker -> host RPC requests
    if (msg && msg.kind === 'rpc') {
      handleRpcMessage(w, msg);
      return;
    }

    // Normal exec response path
    const p = msg && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);

    if (msg.ok) {
      p.resolve(msg);
    } else {
      p.reject(new Error(msg.error));
    }
  });

  w.on('error', (err) => {
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
    rpcSessions.clear();
    worker = null;
  });

  w.on('exit', (code) => {
    if (code !== 0) {
      for (const { reject } of pending.values()) {
        reject(new Error(`Worker exited with code ${code}`));
      }
      pending.clear();
    }
    rpcSessions.clear();
    worker = null;
  });

  worker = w;
  return worker;
}

// --- per-name sandbox cache: avoids recreating/extracting per call ---
/**
 * Map<name, { root, nodeModules, pkgFile, entryFile, prepared: boolean, codeString }>
 */

/**
 * @typedef Sandbox
 * @property {string} root - root.
 * @property {string} nodeModules - nodeModules.
 * @property {string} pkgFile - pkgFile.
 * @property {string} entryFile - entryFile.
 * @property {boolean} prepared - prepared.
 * @property {string} codeString - codeString.
 */

/**
 * @type {Map<string,Sandbox>}
 */
const sandboxes = new Map();

/**
 * @param {import("fs").PathLike} p - p.
 * @returns {Promise<boolean>} - Result.
 */
async function pathExists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} name - name.
 * @param {string} codeString - codeString.
 * @param {Iterable<any> | AsyncIterable<any> | undefined} externalsTar - externalsTar.
 * @returns {Promise<Sandbox>} - Result.
 */
async function ensureSandboxForName(name, codeString, externalsTar) {
  let sb = sandboxes.get(name);
  if (sb) return sb;

  await mkdir(VM_PATH, { recursive: true });

  const root = join(VM_PATH, name);
  const nodeModules = join(root, 'node_modules');
  const pkgFile = join(root, 'package.json');
  const entryFile = join(root, `${name}.js`);

  await mkdir(root, { recursive: true });
  await mkdir(nodeModules, { recursive: true });

  if (!(await pathExists(pkgFile))) {
    await writeFile(
      pkgFile,
      JSON.stringify({ name: `${name}-sandbox`, private: true }, null, 2),
    );
  }

  // Extract externals only once per name
  if (externalsTar) {
    // NOTE: Buffers/Uint8Arrays are iterable in JS (yielding numbers), which breaks tar extraction.
    // Wrap them as a single chunk so Readable.from() emits bytes correctly.
    /** @type {Iterable<any> | AsyncIterable<any> | null} */
    let tarInput = externalsTar;

    if (Buffer.isBuffer(externalsTar) || externalsTar instanceof Uint8Array) {
      const buf = Buffer.from(externalsTar);
      tarInput = buf.length > 0 ? [buf] : null;
    }

    if (tarInput) {
      const src = Readable.from(tarInput);
      const extractor = x({ C: root, preserveOwner: false, unlink: true });
      await pipeline(src, extractor);
    }
  }

  sb = { root, nodeModules, pkgFile, entryFile, prepared: true, codeString };
  sandboxes.set(name, sb);
  return sb;
}

/**
 * @typedef ResourceRPCOptions
 * @property {Record<string, any>} resources - resources.
 * @property {number} [contextIndex] - Which arg is treated as the invocation context (default: 1)
 * @property {string} [sessionId] - Optional session id (default: random UUID)
 * @property {string[]} [resourceNames] - Explicit list of resources to expose (default: Object.keys(resources))
 */

/**
 * @typedef VMSandboxOptions
 * @property {Buffer} [externalsTar] - externalsTar.
 * @property {Object<string,string>} [env] - env.
 * @property {ResourceRPCOptions} [rpc] - Optional RPC wiring for `context.resources.*`
 */

/**
 * @param {string} name - name.
 * @param {string} codeString - codeString.
 * @param {any[] | any} params - params.
 * @param {VMSandboxOptions} options - options.
 * @returns {Promise<void>}  // you don't care about return value
 */
async function runInSandbox(
  name,
  codeString,
  params,
  { externalsTar, env = {}, rpc } = {},
) {
  // Prepare once per name (no repeated extraction/packaging or pkg writes)
  const sb = await ensureSandboxForName(name, codeString, externalsTar);

  /** @type {any[]} */
  const __ENTRY_ARGS__ = Array.isArray(params) ? [...params] : [params];

  // Optional resource RPC session for `context.resources`
  let cleanupRpc = null;
  if (rpc && rpc.resources && Object.keys(rpc.resources).length > 0) {
    const sessionId = rpc.sessionId || randomUUID();
    const rawContextIndex =
      typeof rpc.contextIndex === 'number' ? rpc.contextIndex : -1;
    const contextIndex =
      Number.isInteger(rawContextIndex) && rawContextIndex >= 0
        ? rawContextIndex
        : 1;

    rpcSessions.set(sessionId, { resources: rpc.resources });
    cleanupRpc = () => {
      rpcSessions.delete(sessionId);
    };

    while (__ENTRY_ARGS__.length <= contextIndex) __ENTRY_ARGS__.push({});
    const ctx = __ENTRY_ARGS__[contextIndex];
    const safeCtx = ctx && typeof ctx === 'object' ? ctx : {};
    const existingResources =
      safeCtx.resources && typeof safeCtx.resources === 'object'
        ? safeCtx.resources
        : {};

    const resourceNames = Array.isArray(rpc.resourceNames)
      ? rpc.resourceNames
      : Object.keys(rpc.resources);

    __ENTRY_ARGS__[contextIndex] = {
      ...safeCtx,
      resources: {
        ...existingResources,
        __wharfie_rpc: true,
        __wharfie_rpc_sessionId: sessionId,
        __wharfie_rpc_resources: resourceNames,
      },
    };
  }

  const w = ensureWorker(name);
  const id = nextId++;

  try {
    const msg = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({
        id,
        kind: 'exec',
        codeString: sb.codeString,
        entryFile: sb.entryFile,
        tmpRoot: sb.root,
        pkgFile: sb.pkgFile,
        env,
        __ENTRY_ARGS__,
        functionName: name,
      });
    });

    if (!msg || !msg.ok) {
      throw new Error(msg && msg.error ? msg.error : 'Unknown worker error');
    }
  } finally {
    if (cleanupRpc) cleanupRpc();
  }
}

export default {
  runInSandbox,
  _destroyWorker: async () => {
    if (worker) {
      try {
        await worker.terminate();
      } finally {
        worker = null;
        rpcSessions.clear();
      }
    }
  },
  _clearSandboxCache: () => {
    sandboxes.clear();
  },
};
