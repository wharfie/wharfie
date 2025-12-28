// raft-node.js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Corestore = require('corestore');
const Hyperbee = require('hyperbee');
const Hyperswarm = require('hyperswarm');
const HyperDHT = require('hyperdht');
const crypto = require('crypto');
const { set } = require('traverse');
const { peer } = require('hyperdht/lib/messages');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const topicNodes = (clusterId) =>
  crypto.createHash('sha256').update(`raft:nodes:${clusterId}`).digest();

const ROLE = { Follower: 'Follower', Candidate: 'Candidate', Leader: 'Leader' };
const encode = (x) => Buffer.from(JSON.stringify(x));
const decode = (b) => JSON.parse(b.toString());

class RaftNode {
  constructor(opts) {
    Object.assign(this, {
      nodeId: opts.nodeId,
      clusterId: opts.clusterId,
      clusterSize: opts.clusterSize ?? 3,
      electionMin: opts.electionMin ?? 1500,
      electionMax: opts.electionMax ?? 3000,
      heartbeatMs: opts.heartbeatMs ?? 300,
      dhtBootstrap: opts.dhtBootstrap,
    });

    // Persistent
    this.term = 0;
    this.votedFor = null;

    // Volatile
    this.role = ROLE.Follower;
    this.commitIndex = -1;
    this.lastApplied = -1;
    this.leaderId = null;

    // Leader state
    this.nextIndex = new Map();
    this.matchIndex = new Map();

    // Networking
    const dht = new HyperDHT({
      bootstrap: this.dhtBootstrap,
      ephemeral: false,
      firewall: false,
    });
    const seed = crypto
      .createHash('sha256')
      .update(`raft:${this.clusterId}:${this.nodeId}`)
      .digest();
    this.swarm = new Hyperswarm({ dht, seed });
    this.peers = new Map(); // nodeId -> socket
    this.sockets = new Set();
    this._votes = new Set();
    this._prevotes = new Set();

    // Storage
    this.store = new Corestore(opts.storage);
    this.log = this.store.get({ name: 'raft-log' });
    this.meta = new Hyperbee(this.store.get({ name: 'raft-meta' }), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
    });
    this.sm = new Hyperbee(this.store.get({ name: 'state' }), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
    });

    // Timers
    this._stop = false;
    this._discoveryStartedAt = Date.now();
    this._lastLeaderHeard = 0;
    this._joinedAt = 0;
  }

  get lastIndex() {
    return this.log.length - 1;
  }

  async getLogTerm(i) {
    if (i < 0) return -1;
    const len = this.log.length;
    if (i >= len) return -1;
    const e = await this.log.get(i);
    return decode(e).term;
  }

  _electionTimeoutMs() {
    return rand(this.electionMin, this.electionMax);
  }

  async start() {
    await Promise.all([this.log.ready(), this.meta.ready(), this.sm.ready()]);
    const pTerm = await this.meta.get('/term');
    const pVote = await this.meta.get('/votedFor');
    this.term = pTerm?.value ?? 0;
    this.votedFor = pVote?.value ?? null;

    // --- connection handler (NO pre-HELLO pruning) ---
    this.swarm.on('connection', (socket, peerinfo) => {
      console.log('CONNECTION');
      this.sockets.add(socket);
      this.peers.set(peerinfo.publicKey, socket);
      socket.on('error', (err) => {
        if (!err || (err.code !== 'ETIMEDOUT' && err.code !== 'ECONNRESET')) {
          console.error(`[${this.nodeId}] peer socket error`, err);
        }
      });

      // JSON line HELLO (only nodes send HELLO; clients send CLIENT)
      try {
        socket.write(JSON.stringify({ t: 'HELLO', from: this.nodeId }) + '\n');
      } catch {}

      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          this._onMsg(socket, msg);
        }
      });

      socket.on('close', () => {
        for (const [id, s] of this.peers)
          if (s === socket) this.peers.delete(id);
        this.sockets.delete(socket);
      });

      socket.write('this is a server connection');
    });

    // await this.swarm.join(topicNodes(this.clusterId), { server: true, client: true }).flushed();
    // await this.swarm.listen()
    // await this.swarm.flush()
    // Join topics
    this.peerDiscovery = this.swarm.join(topicNodes(this.clusterId), {
      server: true,
      client: true,
    });
    await this.swarm.dht.fullyBootstrapped();
    await this.swarm.dht.refresh();
    // annouce new server to the DHT
    await this.peerDiscovery.flushed();
    // connect to DHT servers
    await this.swarm.flush();
    this._joinedAt = Date.now();

    // this._runElectionLoop();
    // void this._runApplyLoop();

    console.log(`[${this.nodeId}] up. term=${this.term} role=${this.role}`);
  }

  // _swarmHeartBeat

  stop() {
    this._stop = true;
    try {
      this.swarm.destroy();
    } catch {}
  }

  _send(toId, obj) {
    const s = this.peers.get(toId);
    if (!s) return;
    try {
      s.write(JSON.stringify(obj) + '\n');
    } catch {}
  }

  _broadcast(obj) {
    const line = JSON.stringify(obj) + '\n';
    for (const s of this.peers.values())
      try {
        s.write(line);
      } catch {}
  }

  _sendTo(socket, obj) {
    try {
      socket.write(JSON.stringify(obj) + '\n');
    } catch {}
  }

  _onMsg(socket, msg) {
    console.log('HELLO message');
    // ---- post-HELLO dedupe for node-to-node links ----
    if (msg.t === 'HELLO' && typeof msg.from === 'string') {
      // Only use handshakeHash for dedupe if present (clients won’t have this path)
      const existing = this.peers.get(msg.from);
      if (existing && existing !== socket) {
        const a = socket.handshakeHash;
        const b = existing.handshakeHash;
        const keepNew = a && b ? Buffer.compare(a, b) < 0 : false;
        const keep = keepNew ? socket : existing;
        const drop = keepNew ? existing : socket;
        this.peers.set(msg.from, keep);
        if (drop !== keep) {
          try {
            drop.end();
          } catch {}
        }
        if (keepNew)
          console.log(
            `[${this.nodeId}] switched socket for ${msg.from} (peers=${this.peers.size})`,
          );
        return;
      }
      if (!existing) {
        this.peers.set(msg.from, socket);
        console.log(
          `[${this.nodeId}] connected to peer ${msg.from} (peers=${this.peers.size})`,
        );
      }

      if (this.role === ROLE.Candidate) {
        (async () => {
          const req = {
            t: 'RVOTE_REQ',
            term: this.term,
            candidateId: this.nodeId,
            lastIndex: this.lastIndex,
            lastTerm: await this.getLogTerm(this.lastIndex),
          };
          this._send(msg.from, req);
        })().catch(() => {});
      }
      return;
    }

    // ---- client path (followers will proxy to leader) ----
    if (msg.t === 'CLIENT') {
      if (this.role === ROLE.Leader) return void this._onClientReq(socket, msg);
      if (this.leaderId && this.peers.has(this.leaderId)) {
        this._clientProxies.set(msg.id, socket);
        this._send(this.leaderId, msg);
      } else {
        this._sendTo(socket, {
          t: 'CLIENT_RESP',
          id: msg.id,
          notLeader: true,
          leaderId: this.leaderId,
          term: this.term,
        });
      }
      return;
    }
    if (msg.t === 'CLIENT_RESP') {
      const sock = this._clientProxies.get(msg.id);
      if (sock) {
        this._clientProxies.delete(msg.id);
        return this._sendTo(sock, msg);
      }
      return;
    }

    switch (msg.t) {
      case 'PREVOTE_REQ':
        return void this._onPreVoteReq(socket, msg);
      case 'PREVOTE_RESP':
        return void this._onPreVoteResp(msg);
      case 'RVOTE_REQ':
        return void this._onRequestVote(socket, msg);
      case 'RVOTE_RESP':
        return void this._onRequestVoteResp(msg);
      case 'AENTRIES_REQ':
        return void this._onAppendEntries(socket, msg);
      case 'AENTRIES_RESP':
        return void this._onAppendEntriesResp(msg);
      default:
    }
  }

  async _onPreVoteReq(socket, msg) {
    const { term, candidateId, lastIndex, lastTerm } = msg;
    const upToDate = await this._isCandidateLogUpToDate(lastIndex, lastTerm);
    const ok = upToDate && term >= this.term + 1;
    this._sendTo(socket, {
      t: 'PREVOTE_RESP',
      from: this.nodeId,
      term: this.term,
      ok,
    });
  }

  _onPreVoteResp(msg) {
    if ((this.role === ROLE.Candidate || this.role === ROLE.Follower) && msg.ok)
      this._prevotes.add(msg.from);
  }

  async _runElectionLoop() {
    const GATE = 1000;
    while (!this._stop) {
      const now = Date.now();
      const timeout = this._electionTimeoutMs();
      const expired = now - this._lastLeaderHeard > timeout;

      if (this.role !== ROLE.Leader && expired) {
        const needed = Math.floor(this.clusterSize / 2) + 1;
        const seen = this.peers.size + 1;
        if (now - this._discoveryStartedAt < GATE && seen < needed) {
          await sleep(25);
          continue;
        }

        await sleep(Math.floor(Math.random() * 160));

        // PreVote
        this._prevotes.clear();
        const pv = {
          t: 'PREVOTE_REQ',
          term: this.term + 1,
          candidateId: this.nodeId,
          lastIndex: this.lastIndex,
          lastTerm: await this.getLogTerm(this.lastIndex),
        };
        this._broadcast(pv);
        const pvDeadline = Date.now() + Math.min(400, timeout >> 1);
        while (Date.now() < pvDeadline) {
          await sleep(20);
          if (this._prevotes.size + 1 >= needed) break;
        }
        if (this._prevotes.size + 1 < needed) {
          this._lastLeaderHeard = Date.now();
          continue;
        }

        // Election
        this.role = ROLE.Candidate;
        this.term += 1;
        await this.meta.put('/term', this.term);
        this.votedFor = this.nodeId;
        await this.meta.put('/votedFor', this.votedFor);
        this._votes.clear();
        this._votes.add(this.nodeId);

        const req = {
          t: 'RVOTE_REQ',
          term: this.term,
          candidateId: this.nodeId,
          lastIndex: this.lastIndex,
          lastTerm: await this.getLogTerm(this.lastIndex),
        };
        this._broadcast(req);

        const deadline = Date.now() + timeout;
        while (Date.now() < deadline && this.role === ROLE.Candidate) {
          await sleep(18);
          if (this._votes.size >= needed) {
            this.role = ROLE.Leader;
            this.leaderId = this.nodeId;
            const next = this.lastIndex + 1;
            for (const id of this.peers.keys()) {
              this.nextIndex.set(id, next);
              this.matchIndex.set(id, -1);
            }
            void this._runHeartbeatLoop();
            console.log(`[${this.nodeId}] became LEADER term=${this.term}`);
            break;
          }
        }
      }
      await sleep(20);
    }
  }

  _onRequestVoteResp(msg) {
    if (this.role !== ROLE.Candidate) return;
    if (msg.term < this.term) return;
    if (msg.term > this.term) {
      this._becomeFollower(msg.term, null);
      return;
    }
    if (!msg.ok || !msg.voterId) return;
    this._votes.add(msg.voterId);
  }

  async _onRequestVote(socket, msg) {
    const { term, candidateId, lastIndex, lastTerm } = msg;
    if (term < this.term) {
      this._sendTo(socket, {
        t: 'RVOTE_RESP',
        term: this.term,
        ok: false,
        voterId: this.nodeId,
      });
      return;
    }
    const leaderRecentlyHeard =
      Date.now() - this._lastLeaderHeard <
      Math.max(800, Math.floor(this.electionMin * 0.8));
    if (
      leaderRecentlyHeard &&
      (!this.votedFor || this.votedFor === candidateId)
    ) {
      return this._sendTo(socket, {
        t: 'RVOTE_RESP',
        term: this.term,
        ok: false,
        voterId: this.nodeId,
      });
    }
    if (term > this.term) await this._becomeFollower(term, null);

    if (this.votedFor && this.votedFor !== candidateId) {
      return this._sendTo(socket, {
        t: 'RVOTE_RESP',
        term: this.term,
        ok: false,
        voterId: this.nodeId,
      });
    }

    const upToDate = await this._isCandidateLogUpToDate(lastIndex, lastTerm);
    const grant = (!this.votedFor || this.votedFor === candidateId) && upToDate;
    if (grant) {
      this.votedFor = candidateId;
      await this.meta.put('/votedFor', this.votedFor);
    }
    this._sendTo(socket, {
      t: 'RVOTE_RESP',
      term: this.term,
      ok: grant,
      voterId: this.nodeId,
    });
  }

  async _isCandidateLogUpToDate(lastIndex, lastTerm) {
    const myLastTerm = await this.getLogTerm(this.lastIndex);
    if (lastTerm !== myLastTerm) return lastTerm > myLastTerm;
    return lastIndex >= this.lastIndex;
  }

  async _becomeFollower(newTerm, leaderId) {
    const termChanged = newTerm > this.term;
    const leaderChanged = leaderId && leaderId !== this.leaderId;
    this.role = ROLE.Follower;
    if (termChanged) {
      this.term = newTerm;
      await this.meta.put('/term', this.term);
      this.votedFor = null;
      await this.meta.put('/votedFor', this.votedFor);
    }
    this.leaderId = leaderId ?? this.leaderId;
    this._lastLeaderHeard = Date.now();
    if (termChanged || leaderChanged)
      console.log(
        `[${this.nodeId}] -> FOLLOWER term=${this.term} leader=${this.leaderId}`,
      );
  }

  async _runHeartbeatLoop() {
    while (!this._stop && this.role === ROLE.Leader) {
      for (const [peerId] of this.peers) void this._pushEntries(peerId);
      await sleep(this.heartbeatMs);
    }
  }

  async _pushEntries(peerId) {
    if (this.role !== ROLE.Leader) return;
    const next = this.nextIndex.get(peerId) ?? this.lastIndex + 1;
    const prevIndex = next - 1;
    const prevTerm = await this.getLogTerm(prevIndex);
    const entries = [];
    for (let i = next; i <= this.lastIndex; i++)
      entries.push(decode(await this.log.get(i)));
    const req = {
      t: 'AENTRIES_REQ',
      term: this.term,
      leaderId: this.nodeId,
      prevLogIndex: prevIndex,
      prevLogTerm: prevTerm,
      entries,
      leaderCommit: this.commitIndex,
    };
    this._send(peerId, req);
  }

  async _onAppendEntries(socket, msg) {
    const { term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit } =
      msg;
    if (term < this.term)
      return this._sendTo(socket, {
        t: 'AENTRIES_RESP',
        term: this.term,
        ok: false,
        match: -1,
        from: this.nodeId,
      });

    await this._becomeFollower(term, leaderId);

    const myPrevTerm = await this.getLogTerm(prevLogIndex);
    if (myPrevTerm !== prevLogTerm) {
      const conflictIndex = Math.min(this.lastIndex, prevLogIndex);
      return this._sendTo(socket, {
        t: 'AENTRIES_RESP',
        term: this.term,
        ok: false,
        match: conflictIndex,
        from: this.nodeId,
      });
    }

    const base = prevLogIndex + 1;
    const curLen = this.log.length;

    let conflict = null;
    const overlapEnd = Math.min(curLen, base + entries.length);
    for (let i = base; i < overlapEnd; i++) {
      const local = decode(await this.log.get(i));
      const incoming = entries[i - base];
      if (local.term !== incoming.term) {
        conflict = i;
        break;
      }
    }

    if (conflict !== null) {
      const lenNow = this.log.length;
      if (conflict < lenNow) {
        const s = this.log.session({ writable: true });
        await s.truncate(conflict);
        await s.close();
      }
    }

    let start = this.log.length;
    if (start < base) start = base;
    for (let i = start; i < base + entries.length; i++) {
      await this.log.append(encode(entries[i - base]));
    }

    if (leaderCommit > this.commitIndex)
      this.commitIndex = Math.min(leaderCommit, this.lastIndex);
    this._sendTo(socket, {
      t: 'AENTRIES_RESP',
      term: this.term,
      ok: true,
      match: this.lastIndex,
      from: this.nodeId,
    });
  }

  async _onAppendEntriesResp(msg) {
    if (this.role !== ROLE.Leader) return;
    if (msg.term > this.term) {
      await this._becomeFollower(msg.term, null);
      return;
    }
    const { from, ok, match } = msg;
    if (!this.peers.has(from)) return;

    if (ok) {
      this.matchIndex.set(from, match);
      this.nextIndex.set(from, match + 1);

      for (let N = this.lastIndex; N > this.commitIndex; N--) {
        const e = decode(await this.log.get(N));
        if (e.term !== this.term) continue;
        let count = 1;
        for (const v of this.matchIndex.values()) if (v >= N) count++;
        const needed = Math.floor(this.clusterSize / 2) + 1;
        if (count >= needed) {
          this.commitIndex = N;
          break;
        }
      }
    } else {
      const back = Math.max(0, match);
      this.nextIndex.set(from, back + 1);
    }
  }

  async _onClientReq(socket, msg) {
    if (this.role !== ROLE.Leader) {
      return this._sendTo(socket, {
        t: 'CLIENT_RESP',
        id: msg.id,
        notLeader: true,
        leaderId: this.leaderId,
        term: this.term,
      });
    }
    if (msg.cmd === 'GET') {
      const val = await this._smGet(msg.name);
      return this._sendTo(socket, {
        t: 'CLIENT_RESP',
        id: msg.id,
        ok: true,
        value: val,
      });
    }

    const entry = {
      term: this.term,
      type: 'CMD',
      op: {
        cmd: msg.cmd,
        name: msg.name,
        threshold: msg.threshold ?? 1,
        requestId: msg.requestId,
      },
    };
    await this.log.append(encode(entry));
    const index = this.lastIndex;

    for (const [peerId] of this.peers) void this._pushEntries(peerId);

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && this.commitIndex < index) await sleep(10);
    if (this.commitIndex < index)
      return this._sendTo(socket, {
        t: 'CLIENT_RESP',
        id: msg.id,
        ok: false,
        error: 'timeout',
      });

    while (this.lastApplied < index) await sleep(4);
    const res = await this._smResult(msg.requestId);
    this._sendTo(socket, {
      t: 'CLIENT_RESP',
      id: msg.id,
      ok: res?.ok ?? false,
      value: res?.value,
    });
  }
}

module.exports = { RaftNode, ROLE };
