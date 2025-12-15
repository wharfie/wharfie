// client.js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Hyperswarm = require('hyperswarm');
const HyperDHT = require('hyperdht');
const crypto = require('crypto');

const CLUSTER = process.env.CLUSTER_ID || 'dev';
const TOPIC = crypto
  .createHash('sha256')
  .update(`raft:clients:${CLUSTER}`)
  .digest();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const race = (p, ms) => Promise.race([p, sleep(ms)]);

class Client {
  constructor() {
    const bootstrap = process.env.DHT_BOOTSTRAP
      ? JSON.parse(process.env.DHT_BOOTSTRAP)
      : undefined;
    const dht = new HyperDHT({ bootstrap });
    this.swarm = new Hyperswarm({ dht });
    this.swarm.on('connection', () => console.log('[client] connected'));
    this.swarm.setMaxListeners(0); // no warnings; we only attconnectedach once anyway
    this.conn = null;
    this.buf = '';
    this.pending = new Map(); // id -> {resolve}
    this._connectPromise = null;

    this.swarm.on('connection', (s) => this._attach(s));
  }

  _attach(s) {
    this.conn = s;
    s.on('error', (err) => {
      // ECONNRESET happens on reconnects/dupes; ignore it
      if (!err || err.code !== 'ECONNRESET')
        console.error('[client socket error]', err);
    });
    s.on('data', (chunk) => {
      this.buf += chunk.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.t === 'CLIENT_RESP') {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p.resolve(msg);
          }
        }
      }
    });
    s.on('close', () => {
      this.conn = null;
    });
  }

  async connect() {
    if (this.conn) return;
    if (!this._connectPromise) {
      this._connectPromise = (async () => {
        await this.swarm.listen().catch(() => {}); // ensure UDP socket bound
        this.swarm.join(TOPIC, { client: true, server: false }); // join clients topic
        await race(this.swarm.flush(), 500);
        await race(this.swarm.flush(), 500);
        const start = Date.now();
        while (!this.conn && Date.now() - start < 4000) await sleep(50);
      })().finally(() => {
        this._connectPromise = null;
      });
    }
    await this._connectPromise;
  }

  async _req(body, attempt = 0) {
    await this.connect();
    const id = crypto.randomUUID();
    const msg = { t: 'CLIENT', id, ...body };
    const timeoutMs = 2500;

    if (!this.conn) {
      await sleep(80);
      return this._req(body, attempt + 1);
    }
    try {
      this.conn.write(JSON.stringify(msg) + '\n');
    } catch {}

    const resp = await Promise.race([
      new Promise((resolve) => this.pending.set(id, { resolve })),
      (async () => {
        await sleep(timeoutMs);
        return { t: 'CLIENT_RESP', id, ok: false, error: 'timeout' };
      })(),
    ]);

    if (resp && resp.notLeader) {
      await sleep(60);
      return this._req(body, attempt + 1);
    }
    if (!resp || resp.error === 'timeout') {
      if (attempt < 6) {
        await sleep(80 + Math.floor(Math.random() * 120));
        return this._req(body, attempt + 1);
      }
    }
    return resp;
  }

  increase(name, threshold = 1) {
    return this._req({
      cmd: 'INCREASE',
      name,
      threshold,
      requestId: crypto.randomUUID(),
    });
  }

  release(name) {
    return this._req({ cmd: 'RELEASE', name, requestId: crypto.randomUUID() });
  }

  async get(name) {
    const r = await this._req({ cmd: 'GET', name });
    if (!r || r.notLeader || r.error || r.ok === false)
      throw new Error('GET failed');
    return r.value ?? 0;
  }
}

module.exports = { Client };
