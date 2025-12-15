// // @ts-ignore
// const Hyperswarm = require('hyperswarm');
// const crypto = require('crypto');
// const { EventEmitter } = require('events');

// const MSG = {
//   HELLO: 'HELLO', // {type, me, peers: PeerInfo[]}
//   PEERS: 'PEERS', // {type, peers: PeerInfo[]}
//   SYNC_IDS: 'SYNC_IDS', // {type, ids: string[]}
//   BYE: 'BYE', // {type, me}
// };

// const DEFAULTS = {
//   ttlMs: 60000, // drop unseen peers after 60s (refresh happens via gossip)
//   syncIntervalMs: 5000, // do anti-entropy every 5s
//   topic: 'myapp:dir', // change per app/service
// };

// /**
//  * @param {string} topicStr
//  */
// function topicBuffer(topicStr) {
//   return crypto.createHash('sha256').update(topicStr).digest();
// }

// /**
//  *
//  */
// function now() {
//   return Date.now();
// }

// class BasicNode extends EventEmitter {
//   /**
//    * @param {object} opts
//    * @param {string} [opts.topic]
//    * @param {number} [opts.ttlMs]
//    * @param {number} [opts.syncIntervalMs]
//    * @param {object} [opts.swarmOpts]  // forwarded to Hyperswarm (keyPair, bootstrap, etc)
//    * @param {string[]|object[]} [opts.bootstrap] // convenience: merged into swarmOpts.bootstrap
//    */
//   constructor(opts = {}) {
//     super();
//     this.opts = { ...DEFAULTS, ...opts };

//     // Merge user swarmOpts + convenience top-level bootstrap. Do NOT force firewalled=false.
//     const mergedSwarmOpts = {
//       ...(this.opts.swarmOpts || {}),
//       bootstrap: this.opts.bootstrap ?? this.opts.swarmOpts?.bootstrap,
//       // keep ephemeral false unless you truly only want outbound dials
//       ephemeral: this.opts.swarmOpts?.ephemeral ?? false,
//     };

//     this.swarm = new Hyperswarm(mergedSwarmOpts);
//     this.discovery = null;
//     this.started = false;

//     /** @type {Map<string, PeerInfo>} */
//     this.peers = new Map(); // key = peerId (hex), value = { id, lastSeen, firstSeen }

//     /** @type {Set<any>} raw sockets */
//     this.sockets = new Set();

//     this._syncTimer = null;

//     // bind
//     this._onConnection = this._onConnection.bind(this);
//   }

//   /** own identity (hex) after start */
//   get id() {
//     // Hyperswarm exposes the underlying DHT keypair after init; wait until start()
//     const kp = this.swarm?.dht?.defaultKeyPair;
//     return kp ? Buffer.from(kp.publicKey).toString('hex') : null;
//   }

//   /**
//    * Start: join topic, accept connections, gossip until membership converges.
//    */
//   async start() {
//     if (this.started) return;
//     this.started = true;

//     // 1) Make sure the DHT is fully ready before we use id/join
//     await this.swarm.dht.ready();
//     console.log('dht ready');
//     await this.swarm.dht.fullyBootstrapped();
//     console.log('dht bootstraped');

//     // 2) Wire connection handler
//     this.swarm.on('connection', this._onConnection);

//     // 3) Seed self _after_ DHT is ready (id exists now)
//     this._touchSelf();

//     // 4) Join discovery (server + client) and flush
//     const tbuf = topicBuffer(this.opts.topic);
//     this.discovery = this.swarm.join(tbuf, { server: true, client: true });

//     // Wait until our announce/initial lookup has been sent
//     if (this.discovery.flushed) {
//       await this.discovery.flushed();
//       console.log('discovery flushed');
//     }
//     await this.swarm.flush();
//     console.log('swarm flushed');
//     await this.discovery.refresh({ lookup: true });
//     console.log('discovery refreshed');

//     // 5) Periodic anti-entropy
//     this._syncTimer = setInterval(async () => {
//       await Promise.all([
//         this._gc(),
//         this._syncAll(),
//         this.discovery.refresh({ lookup: true }),
//       ]);
//     }, this.opts.syncIntervalMs);

//     this.emit('started', { id: this.id });
//   }

//   async waitForPeers(targetCount, timeoutMs = 15000) {
//     // targetCount includes self
//     const target = Math.max(1, Number(targetCount) || 1);
//     if (this.peers.size >= target) return;

//     await new Promise((resolve, reject) => {
//       const check = () => {
//         if (this.peers.size >= target) done(true);
//       };
//       const onAdd = () => {
//         // nudge discovery each time we see movement; no sleep loops
//         try {
//           this.discovery?.refresh?.({ lookup: true, reannounce: false });
//         } catch {}
//         check();
//       };
//       const timer = setTimeout(() => done(false), timeoutMs);

//       const done = (ok) => {
//         clearTimeout(timer);
//         this.off('peer:add', onAdd);
//         if (ok) resolve();
//         else
//           reject(
//             new Error(`waitForPeers timed out at ${this.peers.size}/${target}`)
//           );
//       };

//       this.on('peer:add', onAdd);
//       // kick once
//       onAdd();
//     });
//   }

//   /**
//    * Stop: announce BYE to live peers, leave topic, close sockets.
//    */
//   async stop() {
//     if (!this.started) return;
//     this.started = false;

//     await this._broadcast({ type: MSG.BYE, me: this.id });

//     try {
//       if (this.discovery) await this.discovery.destroy();
//     } catch {}
//     this.discovery = null;

//     for (const s of this.sockets) {
//       try {
//         s.end();
//         s.destroy();
//       } catch {}
//     }
//     this.sockets.clear();

//     if (this._syncTimer) clearInterval(this._syncTimer);
//     this._syncTimer = null;

//     try {
//       await this.swarm.destroy();
//     } catch {}

//     this.emit('stopped');
//   }

//   /**
//    * Get the current complete set of peers (including self) as array.
//    * Each item: { id, firstSeen, lastSeen }
//    */
//   getPeers() {
//     return Array.from(this.peers.values()).sort((a, b) =>
//       a.id.localeCompare(b.id)
//     );
//   }

//   // -------- internals --------

//   _touchSelf() {
//     if (!this.id) return;
//     const existing = this.peers.get(this.id);
//     const t = now();
//     if (existing) {
//       existing.lastSeen = t;
//     } else {
//       this.peers.set(this.id, { id: this.id, firstSeen: t, lastSeen: t });
//       this.emit('peer:add', { id: this.id, self: true });
//     }
//   }

//   _notePeer(id) {
//     const t = now();
//     const p = this.peers.get(id);
//     if (p) {
//       p.lastSeen = t;
//       return false; // already known
//     } else {
//       this.peers.set(id, { id, firstSeen: t, lastSeen: t });
//       this.emit('peer:add', { id });
//       return true;
//     }
//   }

//   _gc() {
//     const cutoff = now() - this.opts.ttlMs;
//     for (const [id, info] of this.peers) {
//       if (id === this.id) continue;
//       if (info.lastSeen < cutoff) {
//         this.peers.delete(id);
//         this.emit('peer:drop', { id, reason: 'ttl' });
//       }
//     }
//   }

//   _syncAll() {
//     const ids = Array.from(this.peers.keys());
//     for (const s of this.sockets) {
//       this._send(s, { type: MSG.SYNC_IDS, ids });
//     }
//   }

//   async _broadcast(msg) {
//     for (const s of this.sockets) this._send(s, msg);
//   }

//   _onConnection(socket) {
//     console.log('CONNECTION');
//     // normalize duplicate connects: keep the connection owned by lower id
//     const remoteId = socket.remotePublicKey
//       ? Buffer.from(socket.remotePublicKey).toString('hex')
//       : null;

//     if (!remoteId) {
//       // Shouldn't happen, but bail if identity missing
//       socket.destroy();
//       return;
//     }

//     // Dedup symmetric dials: compare ids deterministically
//     const keepOurs = this.id && this.id < remoteId;
//     if (keepOurs && socket.initiator === false) {
//       // we initiated and already have one? rely on Hyperswarm's internal dedup as well
//       console.log('symetric dial');
//     }

//     this.sockets.add(socket);

//     // line-delimited JSON framing
//     let buffer = Buffer.alloc(0);
//     const onData = (chunk) => {
//       buffer = Buffer.concat([buffer, chunk]);
//       let idx;
//       while ((idx = buffer.indexOf(0x0a)) !== -1) {
//         // '\n'
//         const line = buffer.subarray(0, idx).toString('utf8');
//         buffer = buffer.subarray(idx + 1);
//         if (line.length) this._handleMsg(socket, remoteId, safeParse(line));
//       }
//     };

//     socket.on('data', onData);

//     socket.on('close', () => {
//       this.sockets.delete(socket);
//     });
//     socket.on('error', () => {});

//     // Send HELLO with our full view
//     this._send(socket, {
//       type: MSG.HELLO,
//       me: this.id,
//       peers: this.getPeers(),
//     });
//   }

//   _handleMsg(socket, remoteId, msg) {
//     if (!msg || typeof msg !== 'object') return;

//     switch (msg.type) {
//       case MSG.HELLO: {
//         if (typeof msg.me === 'string') this._notePeer(msg.me);
//         if (Array.isArray(msg.peers)) {
//           for (const p of msg.peers) if (p?.id) this._notePeer(p.id);
//         }
//         // Respond with our peers too (push-pull)
//         this._send(socket, { type: MSG.PEERS, peers: this.getPeers() });
//         break;
//       }
//       case MSG.PEERS: {
//         if (Array.isArray(msg.peers)) {
//           let added = 0;
//           for (const p of msg.peers) if (p?.id && this._notePeer(p.id)) added++;
//           if (added) this.emit('peer:merge', { from: remoteId, added });
//         }
//         break;
//       }
//       case MSG.SYNC_IDS: {
//         if (!Array.isArray(msg.ids)) break;
//         // compute peers the remote is missing
//         const mine = this.getPeers();
//         const missing = mine.filter((p) => !msg.ids.includes(p.id));
//         if (missing.length) {
//           this._send(socket, { type: MSG.PEERS, peers: missing });
//         }
//         // refresh lastSeen for any ids the remote told us it knows (keeps them warm)
//         for (const id of msg.ids)
//           if (typeof id === 'string') this._notePeer(id);
//         break;
//       }
//       case MSG.BYE: {
//         if (typeof msg.me === 'string' && msg.me !== this.id) {
//           if (this.peers.delete(msg.me))
//             this.emit('peer:drop', { id: msg.me, reason: 'bye' });
//         }
//         break;
//       }
//       default:
//         // ignore unknown
//         break;
//     }
//   }

//   _send(socket, obj) {
//     try {
//       socket.write(JSON.stringify(obj) + '\n');
//     } catch {}
//   }
// }

// /**
//  * @typedef {object} PeerInfo
//  * @property {string} id       // hex Noise pubkey
//  * @property {number} firstSeen -
//  * @property {number} lastSeen -
//  */

// /**
//  *
//  * @param s
//  */
// function safeParse(s) {
//   try {
//     return JSON.parse(s);
//   } catch {
//     return null;
//   }
// }

// /* -------------------------
//    Example usage:

//    import { Node } from './peer-node.js';

//    const n = new Node({ topic: 'myapp:dir' });

//    n.on('peer:add', ({ id }) => console.log('[add]', id));
//    n.on('peer:drop', ({ id, reason }) => console.log('[drop]', id, reason));
//    n.on('peer:merge', ({ from, added }) => console.log('[merge]', from, added));

//    await n.start();
//    console.log('Self id:', n.id);

//    // later:
//    console.table(n.getPeers());
//    await n.stop();

// -------------------------- */

// module.exports = BasicNode;
