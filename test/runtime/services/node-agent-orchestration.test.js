/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import http from 'node:http';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

const NODE_AGENT_IMPORT = '../../../src/core/runtime/services/node-agent.js';
const NODE_SEA_IMPORT = '../../../src/core/lib/node-sea.js';

let nextPid = 1000;

/**
 * @param {string} name - name.
 * @param {{ exitOnSigterm?: boolean }} [options] - options.
 * @returns {EventEmitter & { pid: number, exitCode: number | null, kill: jest.Mock }} - Result.
 */
function createChild(name, { exitOnSigterm = true } = {}) {
  /** @type {EventEmitter & { pid: number, exitCode: number | null, kill: jest.Mock }} */
  const child = /** @type {any} */ (new EventEmitter());
  child.pid = nextPid++;
  child.exitCode = null;
  child.kill = jest.fn((signal) => {
    if (signal === 'SIGTERM' && exitOnSigterm) {
      child.exitCode = 0;
      child.emit('exit', 0, signal);
    }
    if (signal === 'SIGKILL') {
      child.exitCode = 137;
      child.emit('exit', null, signal);
    }
    return true;
  });
  return child;
}

/**
 * @param {string} serviceName - serviceName.
 * @returns {string} - Result.
 */
function makeEntrypoint(serviceName) {
  return `functions/${serviceName}.js`;
}

/**
 * @param {string} url - url.
 * @returns {Promise<{ statusCode: number | undefined, body: any }>} - Result.
 */
async function getJson(url) {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: JSON.parse(body),
        });
      });
    });
    req.on('error', reject);
  });
}

/**
 * @param {{
 *   spawnImpl?: (cmd: string, args: string[], options: any) => any,
 * }} [options] - options.
 * @returns {Promise<{ NodeAgent: any, spawnMock: any }>} - Result.
 */
async function loadNodeAgent(options = {}) {
  const spawnMock = jest.fn(
    options.spawnImpl ||
      (() => {
        throw new Error('spawnImpl was not provided');
      }),
  );
  await jest.unstable_mockModule(NODE_SEA_IMPORT, () => ({
    getAsset: async () => {
      throw new Error('node:sea getAsset was not expected in this test');
    },
    isSea: () => false,
  }));
  await jest.unstable_mockModule('node:child_process', () => ({
    spawn: spawnMock,
  }));

  const { default: NodeAgent } = await import(NODE_AGENT_IMPORT);
  return { NodeAgent, spawnMock };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('NodeAgent orchestration', () => {
  it('derives an all-role service plan from manifest + resourcesSpec, serves /health, and shuts down children deterministically', async () => {
    const manifest = {
      schemaVersion: 2,
      app: { id: 'node-agent-orchestration' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'cli.js',
          export: 'default',
        },
      },
      resources: {
        db: { adapter: 'vanilla', options: { path: '.wharfie/db' } },
      },
      activities: {
        alpha: {
          entrypoint: {
            kind: 'node',
            path: makeEntrypoint('alpha'),
            export: 'alpha',
          },
        },
      },
    };
    const resourcesSpec = {
      queue: { adapter: 'vanilla', options: { path: '.wharfie/queue' } },
    };
    /** @type {Map<string, { args: string[], options: any, child: any }>} */
    const spawned = new Map();
    const { NodeAgent, spawnMock } = await loadNodeAgent({
      spawnImpl: (cmd, args, options) => {
        const serveIndex = args.indexOf('serve');
        const name =
          serveIndex >= 0 && typeof args[serveIndex + 1] === 'string'
            ? args[serveIndex + 1]
            : `unknown-${spawned.size}`;
        const child = createChild(name, {
          exitOnSigterm: name !== 'queue',
        });
        spawned.set(name, { args, options: { ...options, cmd }, child });
        return child;
      },
    });

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const agent = new NodeAgent({
      nodeId: 'node-all',
      role: 'all',
      resourcesSpec,
      manifest,
      cmd: '/fake/node',
      prefixArgs: ['/fake/cli'],
      lambdaHost: '127.0.0.1',
      lambdaPort: 8787,
      dbHost: '127.0.0.1',
      dbPort: 8788,
      queueHost: '127.0.0.1',
      queuePort: 8789,
      controlHost: '127.0.0.1',
      controlPort: 0,
      dbAddressOverride: null,
      queueAddressOverride: null,
      pollQueueUrls: ['queue://scheduled'],
    });

    await agent.start();

    expect(spawnMock).toHaveBeenCalledTimes(3);

    expect(spawned.get('db')?.args).toEqual(
      expect.arrayContaining([
        '/fake/cli',
        'ctl',
        'state',
        'serve',
        'db',
        '--host',
        '127.0.0.1',
        '--port',
        '8788',
      ]),
    );
    expect(spawned.get('queue')?.args).toEqual(
      expect.arrayContaining([
        '/fake/cli',
        'ctl',
        'state',
        'serve',
        'queue',
        '--host',
        '127.0.0.1',
        '--port',
        '8789',
      ]),
    );
    expect(spawned.get('lambda')?.args).toEqual(
      expect.arrayContaining([
        '/fake/cli',
        'ctl',
        'state',
        'serve',
        'lambda',
        '--host',
        '127.0.0.1',
        '--port',
        '8787',
        '--db-address',
        '127.0.0.1:8788',
        '--queue-address',
        '127.0.0.1:8789',
        '--poll-queue-url',
        'queue://scheduled',
      ]),
    );

    expect(spawned.get('db')?.options.env.WHARFIE_APP_MANIFEST).toBe(
      JSON.stringify(manifest),
    );

    const controlAddress = agent.control?.address();
    if (!controlAddress || typeof controlAddress === 'string') {
      throw new Error('control plane did not expose a usable address');
    }

    const health = await getJson(
      `http://127.0.0.1:${controlAddress.port}/health`,
    );

    expect(health.statusCode).toBe(200);
    expect(health.body).toEqual(
      expect.objectContaining({
        ok: true,
        nodeId: 'node-all',
        role: 'all',
        endpoints: {
          lambda: '127.0.0.1:8787',
          db: '127.0.0.1:8788',
          queue: '127.0.0.1:8789',
        },
      }),
    );
    const services = /** @type {{ name: string, running: boolean }[]} */ (
      health.body.services
    );
    expect(services.map((service) => service.name)).toEqual([
      'db',
      'queue',
      'lambda',
    ]);
    expect(services.every((service) => service.running)).toBe(true);

    const waitPromise = agent.waitForever();
    await agent.stop('SIGTERM');
    await waitPromise;

    expect(spawned.get('db')?.child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawned.get('lambda')?.child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawned.get('queue')?.child.kill.mock.calls).toEqual([
      ['SIGTERM'],
      ['SIGKILL'],
    ]);
    expect(agent.control).toBeNull();
  });

  it('uses normalized remote state overrides for worker nodes and only spawns lambda', async () => {
    const manifest = {
      schemaVersion: 2,
      app: { id: 'node-agent-worker' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'cli.js',
          export: 'default',
        },
      },
      resources: {
        db: { adapter: 'vanilla', options: { path: '.wharfie/db' } },
        queue: { adapter: 'vanilla', options: { path: '.wharfie/queue' } },
      },
      activities: {
        beta: {
          entrypoint: {
            kind: 'node',
            path: makeEntrypoint('beta'),
            export: 'beta',
          },
        },
      },
    };
    /** @type {Array<{ args: string[], child: any }>} */
    const spawned = [];

    const { NodeAgent, spawnMock } = await loadNodeAgent({
      spawnImpl: (_cmd, args) => {
        const child = createChild('lambda');
        spawned.push({ args, child });
        return child;
      },
    });

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const agent = new NodeAgent({
      nodeId: 'node-worker',
      role: 'worker',
      resourcesSpec: {},
      manifest,
      cmd: '/fake/node',
      prefixArgs: ['/fake/cli'],
      lambdaHost: '127.0.0.1',
      lambdaPort: 9887,
      dbHost: '127.0.0.1',
      dbPort: 9888,
      queueHost: '127.0.0.1',
      queuePort: 9889,
      controlHost: '127.0.0.1',
      controlPort: 0,
      dbAddressOverride: 'grpc://db.remote:7777/state',
      queueAddressOverride: 'http://queue.remote:8888/messages',
      pollQueueUrls: [],
    });

    await agent.start();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawned[0].args).toEqual(
      expect.arrayContaining([
        '/fake/cli',
        'ctl',
        'state',
        'serve',
        'lambda',
        '--db-address',
        'db.remote:7777',
        '--queue-address',
        'queue.remote:8888',
      ]),
    );

    const controlAddress = agent.control?.address();
    if (!controlAddress || typeof controlAddress === 'string') {
      throw new Error('control plane did not expose a usable address');
    }

    const health = await getJson(
      `http://127.0.0.1:${controlAddress.port}/health`,
    );

    expect(health.statusCode).toBe(200);
    expect(health.body).toEqual(
      expect.objectContaining({
        ok: true,
        nodeId: 'node-worker',
        role: 'worker',
        endpoints: {
          lambda: '127.0.0.1:9887',
          db: 'db.remote:7777',
          queue: 'queue.remote:8888',
        },
      }),
    );
    const services = /** @type {{ name: string, running: boolean }[]} */ (
      health.body.services
    );
    expect(services).toHaveLength(1);
    expect(services[0]).toEqual(
      expect.objectContaining({ name: 'lambda', running: true }),
    );

    await agent.stop('SIGTERM');

    expect(spawned[0].child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(agent.control).toBeNull();
  });

  it('requires remote state addresses for worker nodes when the packaged manifest declares them', async () => {
    const manifest = {
      schemaVersion: 2,
      app: { id: 'worker-demo' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'cli.js',
          export: 'default',
        },
      },
      resources: {
        db: { adapter: 'vanilla', options: { path: '.wharfie/db' } },
        queue: { adapter: 'vanilla', options: { path: '.wharfie/queue' } },
      },
      activities: {
        alpha: {
          entrypoint: {
            kind: 'node',
            path: makeEntrypoint('alpha'),
            export: 'alpha',
          },
        },
      },
    };
    const { NodeAgent } = await loadNodeAgent();
    const agent = new NodeAgent({
      nodeId: 'node-worker-missing-state',
      role: 'worker',
      resourcesSpec: {},
      manifest,
      cmd: process.execPath,
      prefixArgs: [],
      lambdaHost: '127.0.0.1',
      lambdaPort: 8787,
      dbHost: '127.0.0.1',
      dbPort: 8788,
      queueHost: '127.0.0.1',
      queuePort: 8789,
      controlHost: '127.0.0.1',
      controlPort: 0,
      dbAddressOverride: null,
      queueAddressOverride: null,
      pollQueueUrls: [],
      spawnServices: false,
    });

    await expect(agent.start()).rejects.toThrow(/requires --db-address/);
  });
});
