const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');

const topic = crypto.createHash('sha256').update('raft:dev-1').digest(); // 32 bytes

const swarm = new Hyperswarm();

swarm.on('connection', (conn, info) => {
  console.log(
    '[client] connection',
    Buffer.from(info.publicKey).toString('hex').slice(0, 16),
  );
  conn.on('data', (d) => console.log('[client] got:', d.toString()));
  conn.write('hello from client');
});

(async () => {
  // join as client only
  swarm.join(topic, { server: false, client: true });

  // Wait for current discovery + connection attempts to be queued/done
  await swarm.flush();
  console.log('[client] flushed lookups');

  // *** Keep the process alive so the connection can actually arrive ***
  await new Promise(() => {}); // or process.stdin.resume()
})();
