import grpc from '@grpc/grpc-js';

/**
 * Minimal gRPC helpers for Wharfie services.
 *
 * We intentionally use JSON as the wire format inside gRPC unary calls.
 * That keeps the interface flexible while we iterate on the service surface.
 *
 * NOTE: This is still real gRPC over HTTP/2 via @grpc/grpc-js.
 */

/**
 * @param {any} _key
 * @param {any} value
 * @returns {any}
 */
function jsonReplacer(_key, value) {
  // Preserve Buffers/Uint8Arrays as base64 so we don't blow up JSON.stringify.
  if (Buffer.isBuffer(value)) {
    return { __wharfie_type: 'buffer', data: value.toString('base64') };
  }
  // Uint8Array (but not Buffer)
  if (
    value &&
    typeof value === 'object' &&
    value.constructor &&
    value.constructor.name === 'Uint8Array' &&
    !Buffer.isBuffer(value)
  ) {
    return {
      __wharfie_type: 'uint8array',
      data: Buffer.from(value).toString('base64'),
    };
  }
  if (value instanceof ArrayBuffer) {
    return {
      __wharfie_type: 'arraybuffer',
      data: Buffer.from(value).toString('base64'),
    };
  }
  return value;
}

/**
 * @param {any} _key
 * @param {any} value
 * @returns {any}
 */
function jsonReviver(_key, value) {
  if (!value || typeof value !== 'object') return value;
  if (value.__wharfie_type === 'buffer' && typeof value.data === 'string') {
    return Buffer.from(value.data, 'base64');
  }
  if (value.__wharfie_type === 'uint8array' && typeof value.data === 'string') {
    return new Uint8Array(Buffer.from(value.data, 'base64'));
  }
  if (
    value.__wharfie_type === 'arraybuffer' &&
    typeof value.data === 'string'
  ) {
    const b = Buffer.from(value.data, 'base64');
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  return value;
}

/**
 * @param {any} v
 * @returns {Buffer}
 */
export function encodeJson(v) {
  const s = JSON.stringify(v ?? null, jsonReplacer);
  return Buffer.from(s, 'utf8');
}

/**
 * @param {Buffer} buf
 * @returns {any}
 */
export function decodeJson(buf) {
  if (!buf) return null;
  const s = Buffer.from(buf).toString('utf8').trim();
  if (!s) return null;
  return JSON.parse(s, jsonReviver);
}

/**
 * Service definition: Resource RPC (generic method dispatch).
 *
 * Path names follow standard gRPC convention: "/<package>.<Service>/<Method>"
 *
 * @type {import('@grpc/grpc-js').ServiceDefinition<any>}
 */
export const ResourceRpcServiceDefinition = {
  Call: {
    path: '/wharfie.ResourceRpc/Call',
    requestStream: false,
    responseStream: false,
    requestSerialize: encodeJson,
    requestDeserialize: decodeJson,
    responseSerialize: encodeJson,
    responseDeserialize: decodeJson,
  },
  Health: {
    path: '/wharfie.ResourceRpc/Health',
    requestStream: false,
    responseStream: false,
    requestSerialize: encodeJson,
    requestDeserialize: decodeJson,
    responseSerialize: encodeJson,
    responseDeserialize: decodeJson,
  },
};

/**
 * Service definition: Lambda execution plane.
 *
 * @type {import('@grpc/grpc-js').ServiceDefinition<any>}
 */
export const LambdaServiceDefinition = {
  Invoke: {
    path: '/wharfie.LambdaService/Invoke',
    requestStream: false,
    responseStream: false,
    requestSerialize: encodeJson,
    requestDeserialize: decodeJson,
    responseSerialize: encodeJson,
    responseDeserialize: decodeJson,
  },
  Health: {
    path: '/wharfie.LambdaService/Health',
    requestStream: false,
    responseStream: false,
    requestSerialize: encodeJson,
    requestDeserialize: decodeJson,
    responseSerialize: encodeJson,
    responseDeserialize: decodeJson,
  },
};

/**
 * @typedef StartGrpcServerOptions
 * @property {string} [host]
 * @property {number} [port]
 * @property {import('@grpc/grpc-js').ServiceDefinition<any>} serviceDefinition
 * @property {import('@grpc/grpc-js').UntypedServiceImplementation} implementation
 * @property {(msg: string, extra?: any) => void} [log]
 */

/**
 * Start a gRPC server.
 *
 * @param {StartGrpcServerOptions} options
 * @returns {Promise<{ address: string, host: string, port: number, close: () => Promise<void> }>}
 */
export async function startGrpcServer({
  host = '127.0.0.1',
  port = 0,
  serviceDefinition,
  implementation,
  log,
}) {
  const server = new grpc.Server();

  // grpc-js types are strict; our implementations are dynamic/untyped by design.
  server.addService(serviceDefinition, /** @type {any} */ (implementation));

  const address = `${host}:${port}`;
  const boundPort = await new Promise((resolve, reject) => {
    server.bindAsync(
      address,
      grpc.ServerCredentials.createInsecure(),
      (err, actualPort) => {
        if (err) return reject(err);
        resolve(actualPort);
      },
    );
  });

  // `server.start()` is deprecated and unnecessary in newer grpc-js versions.
  const boundAddress = `${host}:${boundPort}`;

  log && log('grpc server listening', boundAddress);

  return {
    address: boundAddress,
    host,
    port: /** @type {number} */ (boundPort),
    close: async () => {
      await new Promise((resolve) => {
        server.tryShutdown(() => resolve(null));
      });
    },
  };
}

/**
 * @typedef GrpcUnaryOptions
 * @property {number} [deadlineMs]
 */

/**
 * Make a unary gRPC request using a raw grpc.Client.
 *
 * @param {import('@grpc/grpc-js').Client} client
 * @param {string} path
 * @param {any} request
 * @param {GrpcUnaryOptions} [options]
 * @returns {Promise<any>}
 */
export function grpcUnary(client, path, request, options = {}) {
  const deadlineMs =
    Number.isFinite(options.deadlineMs) && Number(options.deadlineMs) > 0
      ? Number(options.deadlineMs)
      : 60_000;

  // grpc-js expects a Metadata instance when passing CallOptions.
  const metadata = new grpc.Metadata();

  return new Promise((resolve, reject) => {
    client.makeUnaryRequest(
      path,
      encodeJson,
      decodeJson,
      request,
      metadata,
      { deadline: new Date(Date.now() + deadlineMs) },
      (err, resp) => {
        if (err) return reject(err);
        resolve(resp);
      },
    );
  });
}

/**
 * Create a generic gRPC RPC client that exposes remote methods as async functions.
 *
 * The remote service must implement ResourceRpcServiceDefinition.
 *
 * @typedef CreateGrpcRpcClientOptions
 * @property {string} address - "host:port"
 * @property {(msg: string, extra?: any) => void} [log]
 *
 * @param {CreateGrpcRpcClientOptions} options
 * @returns {any} - Proxy with dynamic async methods + __wharfie_closeTransport()
 */
export function createGrpcRpcClient({ address, log }) {
  if (!address || typeof address !== 'string') {
    throw new TypeError(
      'createGrpcRpcClient: address must be a string (host:port)',
    );
  }

  const client = new grpc.Client(address, grpc.credentials.createInsecure());

  /**
   * @param {string} method
   * @param {any[]} args
   * @returns {Promise<any>}
   */
  const call = async (method, args) => {
    const isReceive = method === 'receiveMessage';
    const waitSeconds =
      isReceive && args && args[0] && typeof args[0] === 'object'
        ? Number(args[0].WaitTimeSeconds || 0)
        : 0;

    // Long-poll calls should have a longer deadline than the wait time.
    const deadlineMs = Math.max(5_000, (waitSeconds + 10) * 1000);

    const resp = await grpcUnary(
      client,
      ResourceRpcServiceDefinition.Call.path,
      { method, args },
      { deadlineMs },
    );

    if (!resp || resp.ok !== true) {
      const errMsg =
        resp && resp.error ? String(resp.error) : `RPC error calling ${method}`;
      throw new Error(errMsg);
    }
    return resp.value;
  };

  return new Proxy(
    {},
    {
      get(_t, prop) {
        // prevent thenable detection
        if (prop === 'then') return undefined;

        // internal: close transport channel
        if (prop === '__wharfie_closeTransport') {
          return () => {
            try {
              client.close();
            } catch {}
          };
        }

        // debug: expose address
        if (prop === '__wharfie_address') return address;

        if (typeof prop !== 'string') return undefined;

        /** @type {(...args: any[]) => Promise<any>} */
        const fn = async (...args) => {
          try {
            return await call(prop, args);
          } catch (err) {
            log && log('grpc rpc client error', { address, method: prop, err });
            throw err;
          }
        };

        return fn;
      },
    },
  );
}

/**
 * Create a Lambda service client.
 *
 * @param {{ address: string }} options
 * @returns {{ invoke: (req: { functionName: string, event?: any, context?: any }) => Promise<void>, close: () => void }}
 */
export function createLambdaClient({ address }) {
  const client = new grpc.Client(address, grpc.credentials.createInsecure());

  return {
    invoke: async ({ functionName, event, context }) => {
      const resp = await grpcUnary(
        client,
        LambdaServiceDefinition.Invoke.path,
        { functionName, event, context },
        { deadlineMs: 120_000 },
      );
      if (!resp || resp.ok !== true) {
        throw new Error(
          resp && resp.error ? String(resp.error) : 'Lambda invoke failed',
        );
      }
    },
    close: () => {
      try {
        client.close();
      } catch {}
    },
  };
}
