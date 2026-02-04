import { createActorSystemResources } from '../resources.js';
import { startGrpcServer, ResourceRpcServiceDefinition } from './rpc-grpc.js';

/**
 * @typedef DbServiceOptions
 * @property {any} dbSpec - ActorSystem-style db resource spec (string | {adapter,options} | instance)
 * @property {string} [host] - host.
 * @property {number} [port] - port.
 * @property {(msg: string, extra?: any) => void} [log] - log.
 */

/**
 * @param {string} method - method.
 * @returns {boolean} - Result.
 */
function isForbiddenMethod(method) {
  return (
    method === '__proto__' ||
    method === 'prototype' ||
    method === 'constructor' ||
    // DB/Queue services are shared; clients must never be allowed to close them.
    method === 'close'
  );
}

/**
 * Start a DB service.
 *
 * This hosts a real DB adapter client in-process and exposes it via a gRPC endpoint.
 * @param {DbServiceOptions} options - options.
 * @returns {Promise<{ address: string, host: string, port: number, close: () => Promise<void> }>} - Result.
 */
export async function startDbService({
  dbSpec,
  host = '127.0.0.1',
  port = 0,
  log,
}) {
  const { resources, close } = await createActorSystemResources({ db: dbSpec });
  const db = resources.db;
  if (!db) {
    throw new Error('DB service: failed to create db client');
  }

  const server = await startGrpcServer({
    host,
    port,
    serviceDefinition: ResourceRpcServiceDefinition,
    log,
    implementation: {
      /**
       * @param {any} call - call.
       * @param {(err: any, resp: any) => void} callback - callback.
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

          const fn = /** @type {any} */ (db)[method];
          if (typeof fn !== 'function') {
            callback(null, {
              ok: false,
              error: `db.${method} is not a function`,
            });
            return;
          }

          const result = fn.apply(db, args);
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
       * @param {any} _call - _call.
       * @param {(err: any, resp: any) => void} callback - callback.
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
