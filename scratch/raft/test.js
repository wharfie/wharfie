// test.js (fixed)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fork } = require('child_process');
const { once } = require('events');
const path = require('path');
const fs = require('fs');
const DHT = require('hyperdht');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CLUSTER = process.env.CLUSTER_ID || `dev:${Math.random()}`;
const BASE = process.env.DATA_BASE || './cluster-data';
const NODES = Number(process.env.NODES || '3');
const CLUSTER_SIZE = NODES;
const TOPIC_ID = `demo:123:${Date.now()}`;
// const WORKERS = Number(process.env.WORKERS || '8');
// const THRESH  = Number(process.env.SEM_THRESHOLD || '3');
// const SEM     = process.env.SEM_NAME || 'demo';

fs.mkdirSync(BASE, { recursive: true });

const nodePath = path.join(__dirname, 'node.js');
// const workerPath = path.join(__dirname, 'worker.js');

// Start a local bootstrap via DHT.bootstrapper (no .listen() on DHT instances!)
/**
 *
 */
async function startLocalBootstrap() {
  // Try a few common/high ports; pick the first that binds
  // const candidates = [49737, 49738, 49739, 30001, 30002];
  const candidates = [30002];
  for (const port of candidates) {
    try {
      const bs = DHT.bootstrapper(port, '127.0.0.1', {
        ephemeral: false,
        firewalled: true,
      }); // sync bind
      bs.on('connection', (socket, peerinfo) => {
        console.log('bootsrap connection');
      });
      const cleanup = () => {
        try {
          bs.destroy({ force: true });
        } catch {}
      };
      process.once('exit', cleanup);
      process.once('SIGINT', () => {
        cleanup();
        process.exit(130);
      });
      process.once('SIGTERM', () => {
        cleanup();
        process.exit(143);
      });
      await bs.fullyBootstrapped();
      console.log(`[boot] Local HyperDHT bootstrap on udp://127.0.0.1:${port}`);
      return bs;
    } catch (_) {
      // port in use; try next
    }
  }
  throw new Error('Unable to bind a local HyperDHT bootstrap port');
}

(async () => {
  // const bootstrapNode = await startLocalBootstrap();
  // const bootstrapAddress = bootstrapNode.address()
  // const DHT_BOOTSTRAP_JSON = JSON.stringify([`${bootstrapAddress.host}:${bootstrapAddress.port}`])

  // collect children so we can await/tear them down
  const children = [];
  console.log('starting nodes...');

  for (let i = 1; i <= NODES; i++) {
    const NODE_ID = `n${i}`;
    const STORAGE = path.join(BASE, NODE_ID);
    fs.mkdirSync(STORAGE, { recursive: true });

    const child = fork(nodePath, [], {
      env: {
        ...process.env,
        NODE_ID,
        TOPIC_ID,
        CLUSTER_ID: CLUSTER,
        STORAGE,
        CLUSTER_SIZE,
        // DHT_BOOTSTRAP_JSON
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    children.push(child);
  }
  console.log('nodes launched');

  // forward termination to all children (prevents zombies on Ctrl-C / kill)
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => {
      for (const c of children) {
        if (!c.killed) c.kill(sig);
      }
    });
  }

  // await all exits; reject if any child exits non-zero
  await Promise.all(
    children.map(async (c) => {
      // bubble child process errors
      c.once('error', (err) => {
        throw err;
      });
      const [code, signal] = await once(c, 'exit');
      if (code !== 0) {
        throw new Error(
          `child ${c.pid} exited with code ${code}${
            signal ? ` (signal ${signal})` : ''
          }`
        );
      }
    })
  );
  // await bootstrapNode.destroy();
})();
