// pear-semaphore.js
'use strict';

const Corestore = require('corestore');
const Hypercore = require('hypercore');
const Hyperbee = require('hyperbee');
const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');

const { loadOrCreateKeypair } = require('./keys');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const topicFromString = (s) => crypto.createHash('sha256').update(s).digest();

// ---------- Storage (Hyperbee over Hypercore) ----------
class PearStore {
  constructor({
    storage = './pear-store',
    namespace = 'semaphores',
    keyPath = './semaphore.keys.json',
  } = {}) {
    this.store = new Corestore(storage);
    this.namespace = namespace;
    this.keyPair = loadOrCreateKeypair(keyPath);
    this.swarm = new Hyperswarm();
    this._bee = null;
    this._ready = false;
  }

  async ready() {
    if (this._ready) return;

    // Get a named core from the corestore
    const kvFeed = this.store.get({ keyPair: this.keyPair }); // same writer across processes
    await kvFeed.ready();

    // Hyperbee on top of that core
    this._bee = new Hyperbee(kvFeed, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
    });

    // Swarm discovery + replicate the entire store (handles all cores)
    const topic = topicFromString(`pear-semaphores:${this.namespace}`);
    this.swarm.join(topic, { server: true, client: true });
    this.swarm.on('connection', (socket) => {
      this.store.replicate(socket);
    });

    this._ready = true;
  }

  async get(key) {
    await this.ready();
    const r = await this._bee.get(key);
    return r ? r.value : undefined;
  }

  async batch() {
    await this.ready();
    return this._bee.batch();
  }

  async put(key, value) {
    const b = await this.batch();
    await b.put(key, value);
    await b.flush();
  }

  async del(key) {
    const b = await this.batch();
    await b.del(key);
    await b.flush();
  }
}

// ---------- Leased lock with fencing ----------
class Lock {
  constructor(store, name, leaseMs = 15000, id) {
    this.store = store;
    this.name = name; // logical lock name
    this.leaseMs = leaseMs;
    this.id = id || crypto.randomBytes(16).toString('hex');
  }
  _key() {
    return `/locks/${this.name}`;
  }

  async acquire(backoffMs = 200) {
    const key = this._key();
    while (true) {
      const cur = await this.store.get(key);
      const t = now();
      const expired = !cur || (cur.leaseUntil || 0) < t;
      const fencing = (cur?.fencing || 0) + 1;

      // optimistic write of holder+lease
      const b = await this.store.batch();
      await b.put(key, {
        holder: this.id,
        leaseUntil: t + this.leaseMs,
        fencing,
      });
      await b.flush();

      // verify we won
      const post = await this.store.get(key);
      if (post && post.holder === this.id && post.fencing === fencing) {
        return { fencing };
      }
      await sleep(backoffMs + Math.floor(Math.random() * backoffMs));
    }
  }

  async renew() {
    const key = this._key();
    const cur = await this.store.get(key);
    if (!cur || cur.holder !== this.id) return false;
    const b = await this.store.batch();
    await b.put(key, { ...cur, leaseUntil: now() + this.leaseMs });
    await b.flush();
    return true;
  }

  async release() {
    const key = this._key();
    const cur = await this.store.get(key);
    if (!cur || cur.holder !== this.id) return;
    const b = await this.store.batch();
    await b.put(key, { holder: null, leaseUntil: 0, fencing: cur.fencing });
    await b.flush();
  }
}

// ---------- Public API (Dynamo-compatible) ----------
class PearSemaphore {
  constructor({
    storage = './pear-store',
    namespace = 'semaphores',
    lockLeaseMs = 15000,
    keyPath = './semaphore.keys.json',
  } = {}) {
    this.store = new PearStore({ storage, namespace, keyPath });
    this.lockLeaseMs = lockLeaseMs;
  }

  _key(name) {
    return `/sem/${name}`;
  }
  _limitKey(name) {
    return `/sem/limits/${name}`;
  }
  _lock(name) {
    return new Lock(this.store, `sem:${name}`, this.lockLeaseMs);
  }

  // increase(name, threshold=1) -> boolean
  async increase(semaphore, threshold = 1) {
    await this.store.ready();
    const lock = this._lock(semaphore);
    await lock.acquire();
    try {
      const key = this._key(semaphore);
      const limitKey = this._limitKey(semaphore);

      const [cur, lim] = await Promise.all([
        this.store.get(key),
        this.store.get(limitKey),
      ]);
      const value = Math.max(0, cur?.value ?? 0);
      const limit = lim?.value ?? cur?.limit;
      const ceiling = typeof limit === 'number' ? limit : threshold;

      if (!(value <= ceiling - 1 && value >= 0)) return false;

      const next = { value: value + 1 };
      if (typeof limit === 'number') next.limit = limit;

      const b = await this.store.batch();
      await b.put(key, next);
      await b.flush();
      return true;
    } finally {
      await lock.release();
    }
  }

  // release(name) -> void (no throw on underflow)
  async release(semaphore) {
    await this.store.ready();
    const lock = this._lock(semaphore);
    await lock.acquire();
    try {
      const key = this._key(semaphore);
      const cur = await this.store.get(key);
      const value = cur?.value;

      if (value === undefined) {
        // default 1 + (-1) => 0 (matches your Dynamo behavior)
        await this.store.put(key, { value: 0, limit: cur?.limit });
        return;
      }
      if (value <= 0) return;

      const next = { value: value - 1 };
      if (typeof cur.limit === 'number') next.limit = cur.limit;

      const b = await this.store.batch();
      await b.put(key, next);
      await b.flush();
    } finally {
      await lock.release();
    }
  }

  async get(semaphore) {
    await this.store.ready();
    const cur = await this.store.get(this._key(semaphore));
    return cur?.value ?? 0;
  }

  async deleteSemaphore(semaphore) {
    await this.store.ready();
    let result = await this.get(semaphore);
    while (result > 0) {
      await this.release('wharfie');
      result -= 1;
    }
    await this.store.del(this._key(semaphore));
  }
}

function createPearSemaphore(opts = {}) {
  const impl = new PearSemaphore(opts);
  return {
    increase: impl.increase.bind(impl),
    release: impl.release.bind(impl),
    deleteSemaphore: impl.deleteSemaphore.bind(impl),
    get: impl.get.bind(impl),
    _impl: impl,
  };
}

module.exports = { createPearSemaphore };
