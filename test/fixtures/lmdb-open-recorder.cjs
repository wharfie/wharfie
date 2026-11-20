'use strict';

// Preloaded with `node --require` into CLI processes under test. It records
// every native LMDB environment open, so a test can prove that a process never
// opened (and therefore never closed) a store that a resident was writing.
const { appendFileSync } = require('node:fs');
const Module = require('node:module');

const logPath = process.env.WHARFIE_TEST_LMDB_OPEN_LOG;
const originalLoad = Module._load;
const wrapped = new WeakSet();

Module._load = function load(request, ...rest) {
  const loaded = originalLoad.call(this, request, ...rest);
  if (
    logPath &&
    request === 'lmdb' &&
    loaded &&
    typeof loaded.open === 'function' &&
    !wrapped.has(loaded)
  ) {
    const open = loaded.open;
    loaded.open = function recordedOpen(options, ...args) {
      appendFileSync(
        logPath,
        `${JSON.stringify({
          pid: process.pid,
          path: options && options.path,
          readOnly: options && options.readOnly === true,
        })}\n`,
      );
      return open.call(this, options, ...args);
    };
    wrapped.add(loaded);
  }
  return loaded;
};
