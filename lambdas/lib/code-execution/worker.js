// run-in-sandbox.js
'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const { constants: FS } = require('node:fs');
const { Worker } = require('node:worker_threads');
const tar = require('tar');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const paths = require('../paths');
const VM_PATH = path.join(paths.data, 'vms');

// esbuild inlines this file as text (configure: loader { '.worker.js': 'text' })
const workerSource = require('./runner.worker.js');

// --- singleton worker + response router ---
let worker = null;
let nextId = 1;
const pending = new Map();

function ensureWorker(name) {
  if (worker) return worker;
  console.log('ENSURE WORKER');

  const w = new Worker(workerSource, {
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

    const p = msg && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);

    if (msg.ok) {
      p.resolve(msg);
    } else {
      p.reject(new Error(msg.error));
    }

    console.log('message', msg);
  });

  w.on('error', (err) => {
    console.log('error', err);
    for (const { reject } of pending.values()) reject(err);
    pending.clear();
    worker = null;
  });

  w.on('exit', (code) => {
    console.log('EXIT', code);
    if (code !== 0) {
      for (const { reject } of pending.values()) {
        reject(new Error(`Worker exited with code ${code}`));
      }
      pending.clear();
    }
    worker = null;
  });

  worker = w;
  return worker;
}

// --- per-name sandbox cache: avoids recreating/extracting per call ---
/**
 * Map<name, { root, nodeModules, pkgFile, entryFile, prepared: boolean, codeString }>
 */
const sandboxes = new Map();

async function pathExists(p) {
  try {
    await fsp.access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureSandboxForName(name, codeString, externalsTar) {
  let sb = sandboxes.get(name);
  if (sb) return sb;
  console.log('ENSURE SANDBOX');

  await fsp.mkdir(VM_PATH, { recursive: true });

  const root = path.join(VM_PATH, name);
  const nodeModules = path.join(root, 'node_modules');
  const pkgFile = path.join(root, 'package.json');
  const entryFile = path.join(root, `${name}.js`);

  await fsp.mkdir(root, { recursive: true });
  await fsp.mkdir(nodeModules, { recursive: true });

  if (!(await pathExists(pkgFile))) {
    await fsp.writeFile(
      pkgFile,
      JSON.stringify({ name: `${name}-sandbox`, private: true }, null, 2)
    );
  }

  // Extract externals only once per name
  if (externalsTar) {
    const src = Readable.from(externalsTar);
    const extractor = tar.x({ C: root, preserveOwner: false, unlink: true });
    await pipeline(src, extractor);
  }

  sb = { root, nodeModules, pkgFile, entryFile, prepared: true, codeString };
  sandboxes.set(name, sb);
  return sb;
}

/**
 * @typedef VMSandboxOptions
 * @property {Buffer} [externalsTar]
 * @property {Object<string,string>} [env]
 */

/**
 * @param {string} name
 * @param {string} codeString
 * @param {any[] | any} params
 * @param {VMSandboxOptions} options
 * @returns {Promise<void>}  // you don't care about return value
 */
async function runInSandbox(
  name,
  codeString,
  params,
  { externalsTar, env = {} } = {}
) {
  // Prepare once per name (no repeated extraction/packaging or pkg writes)
  const sb = await ensureSandboxForName(name, codeString, externalsTar);

  const __ENTRY_ARGS__ = Array.isArray(params) ? params : [params];

  const w = ensureWorker(name);
  const id = nextId++;

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
  // let runs = 0
  // while (runs < 10) {
  //   await new Promise((resolve, reject) => {
  //     pending.set(id, { resolve, reject });
  //     w.postMessage({
  //       id,
  //       kind: 'exec',
  //       codeString: sb.codeString,
  //       entryFile: sb.entryFile,
  //       tmpRoot: sb.root,
  //       pkgFile: sb.pkgFile,
  //       env,
  //       __ENTRY_ARGS__,
  //       functionName: name,
  //     });
  //   });
  //   runs += 1
  // }

  if (!msg || !msg.ok) {
    throw new Error(msg && msg.error ? msg.error : 'Unknown worker error');
  }
}

module.exports = {
  runInSandbox,
  _destroyWorker: async () => {
    if (worker) {
      try {
        await worker.terminate();
      } finally {
        worker = null;
      }
    }
  },
  _clearSandboxCache: () => {
    sandboxes.clear();
  },
};
