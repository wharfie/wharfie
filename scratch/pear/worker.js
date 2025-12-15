// worker.js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPearSemaphore } = require('./semaphore');

const {
  SEM_NAME = 'demo',
  SEM_THRESHOLD = '3',
  STORAGE = './pear-data',
  NAMESPACE = 'dev',
  ITERATIONS = '10',
  WORK_MS_MIN = '200',
  WORK_MS_MAX = '1200',
  KEY_PATH = './semaphore.keys.json',
} = process.env;

const threshold = Number(SEM_THRESHOLD);
const iters = Number(ITERATIONS);
const minMs = Number(WORK_MS_MIN);
const maxMs = Number(WORK_MS_MAX);
const id = process.argv[2] || Math.random().toString(16).slice(2);

const sem = createPearSemaphore({
  storage: STORAGE,
  namespace: NAMESPACE,
  keyPath: KEY_PATH,
  lockLeaseMs: 10000,
});

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < iters; i++) {
    const ok = await sem.increase(SEM_NAME, threshold);
    if (ok) {
      const cur = await sem.get(SEM_NAME);
      process.stdout.write(`[worker ${id}] ENTER (value=${cur})\n`);
      await sleep(rand(minMs, maxMs));
      await sem.release(SEM_NAME);
      const after = await sem.get(SEM_NAME);
      process.stdout.write(`[worker ${id}] LEAVE (value=${after})\n`);
    } else {
      process.stdout.write(`[worker ${id}] BUSY (retrying)\n`);
      await sleep(rand(50, 200));
      i--; // don’t count failed attempt as an iteration
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
