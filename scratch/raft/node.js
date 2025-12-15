// node.js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { BasicNode } = require('./basic-node');

const HyperDHT = require('hyperdht');
const crypto = require('crypto');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const TOPIC_ID = process.env.TOPIC_ID || `default:topic`;
  const NODE_ID = process.env.NODE_ID || `n${Math.floor(Math.random() * 1e6)}`;
  const CLUSTER = process.env.CLUSTER_ID || 'dev';
  const CLUSTER_SIZE = process.env.CLUSTER_SIZE || 1;
  const DHT_BOOTSTRAP = process.env.DHT_BOOTSTRAP_JSON
    ? JSON.parse(process.env.DHT_BOOTSTRAP_JSON)
    : undefined;
  const seed = crypto
    .createHash('sha256')
    .update(`swarm:${CLUSTER}:${NODE_ID}`)
    .digest();
  const keyPair = HyperDHT.keyPair(seed);
  const dht = new HyperDHT({
    keyPair, // stable identity per process
    firewalled: true,
    ephemeral: false, // skip adaptive mode so you become persistent fast
    // no 'bootstrap' => uses public hyperdht.org nodes
  });
  await dht.ready();
  await dht.fullyBootstrapped();

  const n = new BasicNode({
    topic: TOPIC_ID,
    swarmOpts: { keyPair, dht },
    // swarmOpts: { keyPair,
    // bootstrap: DHT_BOOTSTRAP,
    //   ephemeral: false
    // },
    // bootstrap: DHT_BOOTSTRAP
  });

  // n.on('peer:add', ({ id }) => console.log(`[add ${n.id.slice(0, 5)}]`, id));
  // n.on('peer:drop', ({ id, reason }) => console.log(`[drop ${n.id.slice(0, 5)}]`, id, reason));
  // n.on('peer:merge', ({ from, added }) => console.log(`[merge ${n.id.slice(0, 5)}]`, from, added));

  console.log('Self id:', n.id);
  await n.start();
  console.log('waiting for peers...');

  await n.waitForPeers(CLUSTER_SIZE, 60000);

  console.log('CONNECTED: peers=', n.getPeers().length);
  console.table(n.getPeers());

  await sleep(1000);
  // later:
  await n.stop();

  console.log('node terminated');
  // keep process alive
  // await new Promise(() => {});
})();
