import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

import { Client, credentials } from '@grpc/grpc-js';

import { grpcUnary, LambdaServiceDefinition } from './rpc-grpc.js';
import { startSchedulerService } from './scheduler-service.js';
import { extractCronTriggers } from '../../resources/builds/actor-system-cli/lib/runtime-bootstrap.js';

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
 * @property {string} name - name.
 * @property {import('node:child_process').ChildProcess} child - child.
 */

/**
 * @typedef NodeAgentOptions
 * @property {string} nodeId - nodeId.
 * @property {'all'|'leader'|'worker'} role - role.
 * @property {any} resourcesSpec - resourcesSpec.
 * @property {any} [manifest] - Embedded or provided app manifest.
 * @property {string} cmd - cmd.
 * @property {string[]} prefixArgs - prefixArgs.
 * @property {string} lambdaHost - lambdaHost.
 * @property {number} lambdaPort - lambdaPort.
 * @property {string} dbHost - dbHost.
 * @property {number} dbPort - dbPort.
 * @property {string} queueHost - queueHost.
 * @property {number} queuePort - queuePort.
 * @property {string} controlHost - controlHost.
 * @property {number} controlPort - controlPort.
 * @property {string|null} dbAddressOverride - dbAddressOverride.
 * @property {string|null} queueAddressOverride - queueAddressOverride.
 * @property {string[]} pollQueueUrls - pollQueueUrls.
 * @property {boolean} [spawnServices] - Spawn child services (db/queue/lambda). Default: true.
 * @property {(actor: string, payload: any) => Promise<void>} [schedulerInvoke] - Optional override for cron trigger invocations (tests).
 */

/**
 * @param {import('node:http').ServerResponse} res - res.
 * @param {number} status - status.
 * @param {any} body - body.
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body ?? null);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', Buffer.byteLength(payload));
  res.end(payload);
}

/**
 * @param {string} name - name.
 * @param {string} cmd - cmd.
 * @param {string[]} args - args.
 * @param {Record<string,string>} env - env.
 * @returns {ServiceChild} - Result.
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
 * @param {any} v - v.
 * @returns {string|null} - Result.
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

/**
 * @param {'all'|'leader'|'worker'} role - role.
 * @returns {boolean} - Result.
 */
function hasLeaderRole(role) {
  return role === 'leader' || role === 'all';
}

/**
 * @param {string} host - host.
 * @returns {string} - Result.
 */
function normalizeLocalClientHost(host) {
  const h = String(host || '').trim();
  if (!h) return '127.0.0.1';
  // 0.0.0.0 / :: are bind-all addresses; clients should dial loopback.
  if (h === '0.0.0.0' || h === '::' || h === '::0') return '127.0.0.1';
  return h;
}

/**
 * @param {any} resourcesSpec - resourcesSpec.
 * @param {any} manifest - manifest.
 * @returns {{ db: boolean, queue: boolean, lambda: boolean, scheduler: boolean }} - Result.
 */
function createServicePlan(resourcesSpec, manifest) {
  const manifestResources =
    manifest && typeof manifest === 'object'
      ? manifest.resources && typeof manifest.resources === 'object'
        ? manifest.resources
        : manifest.capabilities && typeof manifest.capabilities === 'object'
          ? manifest.capabilities
          : {}
      : {};
  const resourceConfig = {
    ...(manifestResources && typeof manifestResources === 'object'
      ? manifestResources
      : {}),
    ...(resourcesSpec && typeof resourcesSpec === 'object'
      ? resourcesSpec
      : {}),
  };
  const functions = Array.isArray(manifest?.functions)
    ? manifest.functions
    : [];
  const schedulerTriggers = extractCronTriggers(manifest || resourceConfig);

  return {
    db: resourceConfig.db !== undefined,
    queue: resourceConfig.queue !== undefined,
    lambda: manifest ? functions.length > 0 : true,
    scheduler: schedulerTriggers.length > 0,
  };
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, string>} - Result.
 */
function createChildManifestEnv(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return {};
  }

  return { WHARFIE_APP_MANIFEST: JSON.stringify(manifest) };
}

export default class NodeAgent {
  /**
   * @param {NodeAgentOptions} options - options.
   */
  constructor(options) {
    this.options = options;

    /** @type {ServiceChild[]} */
    this.children = [];

    /** @type {import('node:http').Server|null} */
    this.control = null;

    /** @type {any|null} */
    this.scheduler = null;

    /** @type {import('@grpc/grpc-js').Client|null} */
    this._lambdaClient = null;

    this.dbAddress = normalizeAddress(options.dbAddressOverride);
    this.queueAddress = normalizeAddress(options.queueAddressOverride);

    this._stopping = false;
    /** @type {null | ((value?: any) => void)} */
    this._resolveStop = null;
    this._stopPromise = new Promise((resolve) => {
      this._resolveStop = resolve;
    });
  }

  /**
   * Start services according to role/config.
   */
  async start() {
    const o = this.options;
    const spawnServices = o.spawnServices !== false;
    const servicePlan = createServicePlan(o.resourcesSpec, o.manifest);
    const childEnv = createChildManifestEnv(o.manifest);

    // Spawn db/queue unless worker-only or remote override provided.
    if (spawnServices && o.role !== 'worker') {
      if (servicePlan.db && !this.dbAddress) {
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
            ],
            childEnv,
          ),
        );
        this.dbAddress = `${o.dbHost}:${o.dbPort}`;
      }

      if (servicePlan.queue && !this.queueAddress) {
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
            ],
            childEnv,
          ),
        );
        this.queueAddress = `${o.queueHost}:${o.queuePort}`;
      }
    }

    if (o.role === 'worker') {
      if (servicePlan.db && !this.dbAddress) {
        throw new Error(
          "node-agent role 'worker' requires --db-address when the app manifest declares a db capability.",
        );
      }

      if (servicePlan.queue && !this.queueAddress) {
        throw new Error(
          "node-agent role 'worker' requires --queue-address when the app manifest declares a queue capability.",
        );
      }
    }

    if (spawnServices && servicePlan.lambda) {
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
      ];

      if (this.dbAddress) {
        lambdaArgs.push('--db-address', String(this.dbAddress));
      }
      if (this.queueAddress) {
        lambdaArgs.push('--queue-address', String(this.queueAddress));
      }

      for (const qUrl of o.pollQueueUrls || []) {
        lambdaArgs.push('--poll-queue-url', qUrl);
      }

      this.children.push(spawnService('lambda', o.cmd, lambdaArgs, childEnv));
    }

    await this._maybeStartScheduler();
    await this._startControlPlane();
  }

  async _maybeStartScheduler() {
    const o = this.options;

    if (!hasLeaderRole(o.role)) return;

    const triggers = extractCronTriggers(o.manifest || o.resourcesSpec);
    if (!triggers.length) return;

    const invoke =
      typeof o.schedulerInvoke === 'function'
        ? o.schedulerInvoke
        : this._createLocalLambdaInvoker();

    this.scheduler = await startSchedulerService({
      role: o.role,
      triggers,
      invoke,
      log: (msg, extra) =>
        console.error('[node-agent:scheduler]', msg, extra ?? ''),
    });
  }

  /**
   * @returns {(actor: string, payload: any) => Promise<void>} - Invoker.
   */
  _createLocalLambdaInvoker() {
    const o = this.options;

    const host = normalizeLocalClientHost(o.lambdaHost);
    const port = Number(o.lambdaPort);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(
        `node-agent: invalid lambdaPort for scheduler invocation: ${o.lambdaPort}`,
      );
    }

    const address = `${host}:${port}`;

    const client = new Client(address, credentials.createInsecure());
    this._lambdaClient = client;

    return async (actor, payload) => {
      const resp = await grpcUnary(
        client,
        LambdaServiceDefinition.Invoke.path,
        {
          functionName: actor,
          event: payload,
          context: { source: 'cron', nodeId: o.nodeId },
        },
        { deadlineMs: 60_000 },
      );

      if (!resp || resp.ok !== true) {
        const msg =
          resp && typeof resp === 'object' && 'error' in resp
            ? String(resp.error)
            : 'Lambda Invoke failed';
        throw new Error(msg);
      }
    };
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
   * @param {string} signal - signal.
   */
  async stop(signal = 'SIGTERM') {
    if (this._stopping) return;
    this._stopping = true;
    if (this._resolveStop) {
      this._resolveStop();
      this._resolveStop = null;
    }

    console.log(`[node-agent] shutting down (${signal})`);

    if (this.scheduler) {
      try {
        await this.scheduler.stop();
      } catch {}
      this.scheduler = null;
    }

    if (this._lambdaClient) {
      try {
        this._lambdaClient.close();
      } catch {}
      this._lambdaClient = null;
    }

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
    await this._stopPromise;
  }
}
