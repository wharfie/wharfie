import { createActorSystemResources } from '../resources.js';
import { startGrpcServer, ResourceRpcServiceDefinition } from './rpc-grpc.js';

/**
 * @typedef QueueServiceOptions
 * @property {any} queueSpec - ActorSystem-style queue resource spec (string | {adapter,options} | instance)
 * @property {string} [host]
 * @property {number} [port]
 * @property {(msg: string, extra?: any) => void} [log]
 */

/**
 * @param {string} method
 * @returns {boolean}
 */
function isForbiddenMethod(method) {
  return (
    method === '__proto__' ||
    method === 'prototype' ||
    method === 'constructor' ||
    // Queue service is shared; do not allow callers to close it.
    method === 'close'
  );
}

/**
 * Start a Queue service.
 *
 * This hosts a real Queue adapter client in-process and exposes it via a gRPC endpoint.
 *
 * @param {QueueServiceOptions} options
 * @returns {Promise<{ address: string, host: string, port: number, close: () => Promise<void> }>}
 */
export async function startQueueService({
  queueSpec,
  host = '127.0.0.1',
  port = 0,
  log,
}) {
  const { resources, close } = await createActorSystemResources({
    queue: queueSpec,
  });
  const queue = resources.queue;
  if (!queue) {
    throw new Error('Queue service: failed to create queue client');
  }

  const server = await startGrpcServer({
    host,
    port,
    serviceDefinition: ResourceRpcServiceDefinition,
    log,
    implementation: {
      /**
       * @param {any} call
       * @param {(err: any, resp: any) => void} callback
       */
      Call: async (call, callback) => {
        try {
          const method = call?.request?.method;
          const args = Array.isArray(call?.request?.args)
            ? call.request.args
            : [];

          if (!method || typeof method !== 'string') {
            callback(null, { ok: false, error: 'Missing method' });
            return;
          }
          if (isForbiddenMethod(method)) {
            callback(null, { ok: false, error: `Forbidden method: ${method}` });
            return;
          }

          const fn = /** @type {any} */ (queue)[method];
          if (typeof fn !== 'function') {
            callback(null, {
              ok: false,
              error: `queue.${method} is not a function`,
            });
            return;
          }

          const result = fn.apply(queue, args);
          const value =
            result && typeof result.then === 'function' ? await result : result;

          callback(null, { ok: true, value });
        } catch (err) {
          const msg =
            err && typeof err === 'object' && 'stack' in err
              ? // @ts-ignore
                String(err.stack)
              : String(err);
          callback(null, { ok: false, error: msg });
        }
      },

      /**
       * @param {any} _call
       * @param {(err: any, resp: any) => void} callback
       */
      Health: async (_call, callback) => {
        callback(null, { ok: true });
      },
    },
  });

  return {
    address: server.address,
    host: server.host,
    port: server.port,
    close: async () => {
      await server.close();
      await close();
    },
  };
}
