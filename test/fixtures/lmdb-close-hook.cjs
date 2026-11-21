'use strict';

// Preloaded with `node --require` into a test child. It wraps the native
// close of every LMDB environment the child opens, so a test can observe
// what happens while a close is still in progress, or when it fails:
// - WHARFIE_TEST_LMDB_CLOSE_GATE=<path>: before closing, create <path>.waiting
//   and wait until <path> exists;
// - WHARFIE_TEST_LMDB_CLOSE_FAIL=1: the close throws instead of closing.
const { existsSync, writeFileSync } = require('node:fs');
const Module = require('node:module');

const gate = process.env.WHARFIE_TEST_LMDB_CLOSE_GATE;
const fail = process.env.WHARFIE_TEST_LMDB_CLOSE_FAIL === '1';
const originalLoad = Module._load;
const wrapped = new WeakSet();

Module._load = function load(request, ...rest) {
  const loaded = originalLoad.call(this, request, ...rest);
  if (
    request === 'lmdb' &&
    loaded &&
    typeof loaded.open === 'function' &&
    !wrapped.has(loaded)
  ) {
    const open = loaded.open;
    loaded.open = function hookedOpen(...args) {
      const env = open.apply(this, args);
      const close = env.close.bind(env);
      env.close = async (...closeArgs) => {
        if (fail) throw new Error('injected native close failure');
        if (gate) {
          writeFileSync(`${gate}.waiting`, '');
          while (!existsSync(gate)) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        return await close(...closeArgs);
      };
      return env;
    };
    wrapped.add(loaded);
  }
  return loaded;
};
