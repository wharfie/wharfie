// test.js
'use strict';
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

const N_WORKERS = Number(process.env.WORKERS || 8);
const SEM_NAME = process.env.SEM_NAME || 'demo';
const SEM_THRESH = process.env.SEM_THRESHOLD || '3';
const STORAGE_BASE = process.env.STORAGE_BASE || './pear-data';
const NAMESPACE = process.env.NAMESPACE || 'dev';
const ITERATIONS = process.env.ITERATIONS || '8';
const KEY_PATH = process.env.KEY_PATH || './semaphore.keys.json';

console.log(
  `Spawning ${N_WORKERS} workers against semaphore "${SEM_NAME}" (threshold=${SEM_THRESH})`
);
console.log(`Storage base=${STORAGE_BASE} namespace=${NAMESPACE}`);

const workerPath = path.join(__dirname, 'worker.js');

for (let i = 0; i < N_WORKERS; i++) {
  const storage = path.join(STORAGE_BASE, `node-${i}`);
  fs.mkdirSync(storage, { recursive: true });
  fork(workerPath, [String(i)], {
    env: {
      ...process.env,
      SEM_NAME,
      SEM_THRESHOLD: SEM_THRESH,
      STORAGE: storage, // <- unique per worker
      NAMESPACE,
      ITERATIONS,
      KEY_PATH,
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
}
