const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');

const topic = crypto.createHash('sha256').update('raft:dev-1').digest(); // 32 bytes

const swarm = new Hyperswarm();

swarm.on('connection', (conn, info) => {
  console.log(
    '[server] connection',
    Buffer.from(info.publicKey).toString('hex').slice(0, 16)
  );
  conn.on('data', (d) => console.log('[server] got:', d.toString()));
  conn.write('hello from server');
});

(async () => {
  const discovery = swarm.join(topic, { server: true, client: false });
  await discovery.flushed(); // ensure we’re announced
  await swarm.listen(); // start listening
  console.log('[server] announced & listening');
  // keep process alive
  await new Promise(() => {}); // or process.stdin.resume()
})();
