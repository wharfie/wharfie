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
 * @param {any} resourcesSpec - resourcesSpec.
 * @param {any} manifest - manifest.
 * @returns {{ db: boolean, queue: boolean, lambda: boolean }} - Result.
 */
function createServicePlan(resourcesSpec, manifest) {
  const manifestResources =
    manifest && typeof manifest === 'object'
      ? manifest.resources && typeof manifest.resources === 'object'
        ? manifest.resources
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
  const activities =
    manifest && typeof manifest.activities === 'object' && manifest.activities
      ? Object.keys(manifest.activities)
      : [];
  return {
    db: resourceConfig.db !== undefined,
    queue: resourceConfig.queue !== undefined,
    lambda: manifest ? activities.length > 0 : true,
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

/**
 * @param {string[]} prefixArgs - prefixArgs.
 * @returns {boolean} - Result.
 */
function usesPackagedRuntime(prefixArgs) {
  return !Array.isArray(prefixArgs) || prefixArgs.length === 0;
}

/**
 * @param {string} runtimeCommand - runtimeCommand.
 * @param {string[]} runtimeArgs - runtimeArgs.
 * @param {string[]} prefixArgs - prefixArgs.
 * @returns {string[]} - Result.
 */
function createLegacySpawnArgs(runtimeCommand, runtimeArgs, prefixArgs) {
  if (runtimeCommand === 'start') {
    return [...prefixArgs, 'ctl', 'state', 'start', ...runtimeArgs];
  }

  if (runtimeCommand === 'serve-db') {
    return [...prefixArgs, 'ctl', 'state', 'serve', 'db', ...runtimeArgs];
  }

  if (runtimeCommand === 'serve-queue') {
    return [...prefixArgs, 'ctl', 'state', 'serve', 'queue', ...runtimeArgs];
  }

  if (runtimeCommand === 'serve-lambda') {
    return [...prefixArgs, 'ctl', 'state', 'serve', 'lambda', ...runtimeArgs];
  }

  return [...prefixArgs, ...runtimeArgs];
}

/**
 * @param {string} name - name.
 * @param {NodeAgentOptions} options - options.
 * @param {Record<string, string>} childEnv - childEnv.
 * @param {string} runtimeCommand - runtimeCommand.
 * @param {string[]} runtimeArgs - runtimeArgs.
 * @returns {ServiceChild} - Result.
 */
function spawnManagedService(
  name,
  options,
  childEnv,
  runtimeCommand,
  runtimeArgs,
) {
  if (usesPackagedRuntime(options.prefixArgs)) {
    return spawnService(name, options.cmd, [], {
      ...childEnv,
      WHARFIE_BOOTSTRAP_MODE: 'runtime',
      WHARFIE_RUNTIME_COMMAND: runtimeCommand,
      WHARFIE_RUNTIME_ARGS: JSON.stringify(runtimeArgs),
    });
  }

  return spawnService(
    name,
    options.cmd,
    createLegacySpawnArgs(runtimeCommand, runtimeArgs, options.prefixArgs),
    childEnv,
  );
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
          spawnManagedService('db', o, childEnv, 'serve-db', [
            '--host',
            String(o.dbHost),
            '--port',
            String(o.dbPort),
          ]),
        );
        this.dbAddress = `${o.dbHost}:${o.dbPort}`;
      }

      if (servicePlan.queue && !this.queueAddress) {
        this.children.push(
          spawnManagedService('queue', o, childEnv, 'serve-queue', [
            '--host',
            String(o.queueHost),
            '--port',
            String(o.queuePort),
          ]),
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
      /** @type {string[]} */
      const lambdaArgs = [
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

      this.children.push(
        spawnManagedService('lambda', o, childEnv, 'serve-lambda', lambdaArgs),
      );
    }

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
