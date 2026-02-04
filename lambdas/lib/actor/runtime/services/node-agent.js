import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Node Agent
 *
 * This is the supervisor process that lives in the "main thread" of the SEA.
 *
 * Responsibilities (today):
 * - spawn and supervise the data-plane services:
 *    - db service (gRPC)
 *    - queue service (gRPC)
 *    - lambda service (gRPC + queue poll loops)
 * - expose a tiny control-plane health endpoint (HTTP /health)
 *
 * Responsibilities (future):
 * - node discovery / membership (p2p)
 * - placement / routing
 * - metrics, tracing, distributed health
 */

/**
 * @typedef ServiceChild
 * @property {string} name
 * @property {import('node:child_process').ChildProcess} child
 */

/**
 * @typedef NodeAgentOptions
 * @property {string} nodeId
 * @property {'all'|'leader'|'worker'} role
 * @property {any} resourcesSpec
 * @property {string} cmd
 * @property {string[]} prefixArgs
 * @property {string} lambdaHost
 * @property {number} lambdaPort
 * @property {string} dbHost
 * @property {number} dbPort
 * @property {string} queueHost
 * @property {number} queuePort
 * @property {string} controlHost
 * @property {number} controlPort
 * @property {string|null} dbAddressOverride
 * @property {string|null} queueAddressOverride
 * @property {string[]} pollQueueUrls
 */

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {any} body
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body ?? null);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
}

/**
 * @param {string} name
 * @param {string} cmd
 * @param {string[]} args
 * @param {Record<string,string>} env
 * @returns {ServiceChild}
 */
function spawnService(name, cmd, args, env) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

  child.on('exit', (code, signal) => {
    console.error(`[node-agent] service '${name}' exited`, { code, signal });
  });

  return { name, child };
}

/**
 * @param {any} v
 * @returns {string|null}
 */
function normalizeAddress(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  // accept host:port
  if (s.includes('://')) {
    // tolerate accidental urls; strip scheme/path
    try {
      const u = new URL(s);
      return `${u.hostname}:${u.port}`;
    } catch {
      return s;
    }
  }
  return s;
}

export default class NodeAgent {
  /**
   * @param {NodeAgentOptions} options
   */
  constructor(options) {
    this.options = options;

    /** @type {ServiceChild[]} */
    this.children = [];

    /** @type {import('node:http').Server|null} */
    this.control = null;

    this.dbAddress = normalizeAddress(options.dbAddressOverride);
    this.queueAddress = normalizeAddress(options.queueAddressOverride);

    this._stopping = false;
  }

  /**
   * Start services according to role/config.
   */
  async start() {
    const o = this.options;

    // Spawn db/queue unless worker-only or remote override provided.
    if (o.role !== 'worker') {
      if (!this.dbAddress) {
        this.children.push(
          spawnService(
            'db',
            o.cmd,
            [
              ...o.prefixArgs,
              'ctl',
              'state',
              'serve',
              'db',
              '--host',
              String(o.dbHost),
              '--port',
              String(o.dbPort),
              '--resources',
              JSON.stringify(o.resourcesSpec),
            ],
            {},
          ),
        );
        this.dbAddress = `${o.dbHost}:${o.dbPort}`;
      }

      if (!this.queueAddress) {
        this.children.push(
          spawnService(
            'queue',
            o.cmd,
            [
              ...o.prefixArgs,
              'ctl',
              'state',
              'serve',
              'queue',
              '--host',
              String(o.queueHost),
              '--port',
              String(o.queuePort),
              '--resources',
              JSON.stringify(o.resourcesSpec),
            ],
            {},
          ),
        );
        this.queueAddress = `${o.queueHost}:${o.queuePort}`;
      }
    }

    if (o.role === 'worker') {
      if (!this.dbAddress || !this.queueAddress) {
        throw new Error(
          "node-agent role 'worker' requires --db-address and --queue-address (or discovery)",
        );
      }
    }

    // Spawn lambda service (always).
    const lambdaArgs = [
      ...o.prefixArgs,
      'ctl',
      'state',
      'serve',
      'lambda',
      '--host',
      String(o.lambdaHost),
      '--port',
      String(o.lambdaPort),
      '--db-address',
      String(this.dbAddress),
      '--queue-address',
      String(this.queueAddress),
      '--resources',
      JSON.stringify(o.resourcesSpec),
    ];

    for (const qUrl of o.pollQueueUrls || []) {
      lambdaArgs.push('--poll-queue-url', qUrl);
    }

    this.children.push(spawnService('lambda', o.cmd, lambdaArgs, {}));

    // Start control plane health endpoint in this process.
    await this._startControlPlane();
  }

  async _startControlPlane() {
    const o = this.options;

    this.control = http.createServer((req, res) => {
      const pathname = req.url ? req.url.split('?')[0] : '';

      if (pathname === '/health') {
        const status = {
          ok: true,
          nodeId: o.nodeId,
          role: o.role,
          services: this.children.map((c) => ({
            name: c.name,
            pid: c.child.pid,
            running: !!c.child.pid && c.child.exitCode === null,
            exitCode: c.child.exitCode,
          })),
          endpoints: {
            lambda: `${o.lambdaHost}:${o.lambdaPort}`,
            db: this.dbAddress,
            queue: this.queueAddress,
          },
        };
        sendJson(res, 200, status);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    });

    this.control.listen(Number(o.controlPort), String(o.controlHost));
    await once(this.control, 'listening');

    console.log(
      `[node-agent] control plane listening at http://${String(o.controlHost)}:${String(
        o.controlPort,
      )} (GET /health)`,
    );
  }

  /**
   * Stop services (best-effort).
   * @param {string} signal
   */
  async stop(signal = 'SIGTERM') {
    if (this._stopping) return;
    this._stopping = true;

    console.log(`[node-agent] shutting down (${signal})`);

    if (this.control) {
      this.control.close();
      await Promise.race([once(this.control, 'close'), delay(1000)]);
      this.control = null;
    }

    for (const c of this.children) {
      try {
        c.child.kill('SIGTERM');
      } catch {}
    }

    await delay(250);

    for (const c of this.children) {
      if (c.child.exitCode === null) {
        try {
          c.child.kill('SIGKILL');
        } catch {}
      }
    }
  }

  /**
   * Keep process alive (until SIGINT/SIGTERM).
   */
  async waitForever() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await delay(60_000);
    }
  }
}
