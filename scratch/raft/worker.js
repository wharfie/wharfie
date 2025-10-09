// worker.js
'use strict';
const { Client } = require('./client');

const SEM_NAME = process.env.SEM_NAME || 'demo';
const THRESH = Number(process.env.SEM_THRESHOLD || '3');
const ITER = Number(process.env.ITERATIONS || '10');
const MIN_MS = Number(process.env.WORK_MS_MIN || '200');
const MAX_MS = Number(process.env.WORK_MS_MAX || '900');
const ID = process.argv[2] || Math.random().toString(16).slice(2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

(async () => {
  const c = new Client();
  for (let i = 0; i < ITER; i++) {
    let r = await c.increase(SEM_NAME, THRESH);
    let tries = 0;
    while (!r.ok && tries < 10) {
      // be persistent but bounded
      await sleep(rand(60, 140));
      r = await c.increase(SEM_NAME, THRESH);
      tries++;
    }
    if (r.ok) {
      const cur = await c.get(SEM_NAME);
      process.stdout.write(`[worker ${ID}] ENTER (value=${cur})\n`);
      await sleep(rand(MIN_MS, MAX_MS));
      // Robust release: ensure it actually decrements
      let rel = await c.release(SEM_NAME);
      let rtries = 0;
      while (!(rel && rel.ok) && rtries < 10) {
        await sleep(rand(60, 140));
        rel = await c.release(SEM_NAME);
        rtries++;
      }
      const after = await c.get(SEM_NAME);
      process.stdout.write(`[worker ${ID}] LEAVE (value=${after})\n`);
    } else {
      process.stdout.write(`[worker ${ID}] BUSY\n`);
      await sleep(rand(50, 150));
      i--;
    }
  }
  process.exit(0);
})();
