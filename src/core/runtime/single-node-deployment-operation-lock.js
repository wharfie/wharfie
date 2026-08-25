import { createHash } from 'node:crypto';
import net from 'node:net';

import { assertSingleNodeDeploymentInstanceId } from './single-node-deployment-identity.js';

const FIRST_DYNAMIC_PORT = 49_152;
const DYNAMIC_PORT_COUNT = 16_384;
const LOCK_DOMAIN = 'wharfie:single-node-deployment-operation-lock:v1';

/** Another local coordinator currently owns this deployment operation. */
export class SingleNodeDeploymentOperationBusyError extends Error {
  constructor() {
    super('Another local Wharfie process is operating this deployment.');
    this.name = 'SingleNodeDeploymentOperationBusyError';
    this.code = 'WHARFIE_SINGLE_NODE_DEPLOYMENT_OPERATION_BUSY';
  }
}

/**
 * @param {import('node:net').Server} server - Bound server.
 * @returns {Promise<void>} - Settles after close.
 */
function closeServer(server) {
  return new Promise((resolve, reject) => {
    try {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        /** @type {{code?: unknown}} */ (error).code ===
          'ERR_SERVER_NOT_RUNNING'
      ) {
        resolve();
      } else {
        reject(error);
      }
    }
  });
}

/**
 * A loopback TCP bind is an automatically reaped cross-platform process lock.
 * A digest-derived dynamic port makes every coordinator for the same
 * deployment contend on the same kernel object without leaving a stale lock
 * file after a crash.
 *
 * Port occupation grants no deployment authority; it can only cause a clear
 * availability conflict. The durable journal and provider ownership evidence
 * remain the effect authority.
 * @param {unknown} deploymentInstanceId - Stable deployment identity.
 * @param {{createServer?: typeof net.createServer}} [dependencies] - Test seam.
 * @returns {Promise<() => Promise<void>>} - Idempotent release callback.
 */
export async function acquireSingleNodeDeploymentOperationLock(
  deploymentInstanceId,
  dependencies = {},
) {
  assertSingleNodeDeploymentInstanceId(
    deploymentInstanceId,
    'singleNodeDeploymentOperationLock.deploymentInstanceId',
  );
  if (
    dependencies === null ||
    typeof dependencies !== 'object' ||
    Array.isArray(dependencies) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(dependencies)) ||
    Reflect.ownKeys(dependencies).some((key) => key !== 'createServer') ||
    (dependencies.createServer !== undefined &&
      typeof dependencies.createServer !== 'function')
  ) {
    throw new TypeError(
      'singleNodeDeploymentOperationLock dependencies are invalid.',
    );
  }
  const digest = createHash('sha256')
    .update(LOCK_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(/** @type {string} */ (deploymentInstanceId), 'utf8')
    .digest();
  const port =
    FIRST_DYNAMIC_PORT + (digest.readUInt16BE(0) % DYNAMIC_PORT_COUNT);
  const createServer = dependencies.createServer ?? net.createServer;
  const server = createServer((socket) => socket.destroy());
  if (
    !server ||
    typeof server !== 'object' ||
    typeof server.listen !== 'function' ||
    typeof server.close !== 'function' ||
    typeof server.once !== 'function' ||
    typeof server.on !== 'function' ||
    typeof server.removeListener !== 'function' ||
    typeof server.unref !== 'function'
  ) {
    throw new TypeError(
      'singleNodeDeploymentOperationLock server is not supported.',
    );
  }
  server.on('error', () => undefined);
  try {
    await new Promise((resolve, reject) => {
      /** @param {Error} error - Bind failure. */
      function onError(error) {
        cleanup();
        reject(error);
      }
      /** Finish a successful bind. */
      function onListening() {
        cleanup();
        resolve(undefined);
      }
      /** Remove temporary bind listeners. */
      function cleanup() {
        server.removeListener('error', onError);
        server.removeListener('listening', onListening);
      }
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({
        host: '127.0.0.1',
        port,
        exclusive: true,
      });
    });
  } catch (error) {
    await closeServer(server).catch(() => undefined);
    if (
      error &&
      typeof error === 'object' &&
      /** @type {{code?: unknown}} */ (error).code === 'EADDRINUSE'
    ) {
      throw new SingleNodeDeploymentOperationBusyError();
    }
    throw error;
  }
  server.unref();

  /** @type {Promise<void>|undefined} */
  let releasePromise;
  return () => {
    if (releasePromise === undefined) {
      releasePromise = closeServer(server);
    }
    return releasePromise;
  };
}

export default {
  SingleNodeDeploymentOperationBusyError,
  acquireSingleNodeDeploymentOperationLock,
};
