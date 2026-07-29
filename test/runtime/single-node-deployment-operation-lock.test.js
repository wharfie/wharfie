import { EventEmitter } from 'node:events';

import { describe, expect, it } from '@jest/globals';

import {
  SingleNodeDeploymentOperationBusyError,
  acquireSingleNodeDeploymentOperationLock,
} from '../../src/core/runtime/single-node-deployment-operation-lock.js';
import { getSingleNodeDeploymentInstanceId } from '../../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../src/core/runtime/single-node-deployment-intent.js';

function makeServerFactory() {
  const bound = new Set();
  const createServer = () => {
    const server = new EventEmitter();
    /** @type {number|undefined} */
    let port;
    return Object.assign(server, {
      /** @param {{port: number}} options */
      listen(options) {
        port = options.port;
        queueMicrotask(() => {
          if (bound.has(port)) {
            const error = new Error('address in use');
            /** @type {NodeJS.ErrnoException} */ (error).code = 'EADDRINUSE';
            server.emit('error', error);
            return;
          }
          bound.add(port);
          server.emit('listening');
        });
      },
      /** @param {(error?: Error) => void} callback */
      close(callback) {
        if (port !== undefined) bound.delete(port);
        queueMicrotask(() => callback());
      },
      unref() {},
    });
  };
  return /** @type {typeof import('node:net').createServer} */ (
    /** @type {unknown} */ (createServer)
  );
}

function deploymentInstanceId(deployment = 'hello-production') {
  return getSingleNodeDeploymentInstanceId(
    createSingleNodeDeploymentIntent({
      deployment: { id: deployment },
      appId: 'hello-app',
      target: {
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
        libc: 'glibc',
      },
      mode: SINGLE_NODE_DEPLOYMENT_MODE,
      machine: SINGLE_NODE_MACHINE,
      access: {
        kind: 'public-ssh',
        allowedIpv4: ['203.0.113.7/32'],
      },
      provider: { kind: 'hetzner', location: 'fsn1' },
    }),
  );
}

describe('single-node deployment operation lock', () => {
  it('excludes another local coordinator and is reaped on release', async () => {
    const id = deploymentInstanceId();
    const createServer = makeServerFactory();
    const release = await acquireSingleNodeDeploymentOperationLock(id, {
      createServer,
    });
    try {
      await expect(
        acquireSingleNodeDeploymentOperationLock(id, { createServer }),
      ).rejects.toBeInstanceOf(SingleNodeDeploymentOperationBusyError);
    } finally {
      await release();
      await release();
    }

    const releaseAgain = await acquireSingleNodeDeploymentOperationLock(id, {
      createServer,
    });
    await releaseAgain();
  });

  it('uses distinct locks for distinct deployment placements', async () => {
    const createServer = makeServerFactory();
    const first = await acquireSingleNodeDeploymentOperationLock(
      deploymentInstanceId('hello-production'),
      { createServer },
    );
    const second = await acquireSingleNodeDeploymentOperationLock(
      deploymentInstanceId('hello-staging'),
      { createServer },
    );
    expect(first).toEqual(expect.any(Function));
    expect(second).toEqual(expect.any(Function));
    await first();
    await second();
  });

  it('rejects a noncanonical deployment identity', async () => {
    await expect(
      acquireSingleNodeDeploymentOperationLock('hello-production'),
    ).rejects.toThrow(/canonical wsnd1_/iu);
  });
});
