// dht-bootstrap.js
'use strict';
const DHT = require('hyperdht');

const PORT = Number(process.env.DHT_PORT || 49737);

(async () => {
  const dht = new DHT({ ephemeral: false }); // full DHT node
  await dht.bind(PORT);
  const addr = dht.address();
  console.log(`[bootstrap] HyperDHT up on udp://${addr.host}:${addr.port}`);
  // keep process alive
  await new Promise(() => {});
})();
