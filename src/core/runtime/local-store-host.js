import { createHash, randomBytes } from 'node:crypto';
import { promises as fsp, realpathSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import v8 from 'node:v8';

import { DB_ADAPTER_NAMES, brandDBClient } from '../lib/db/base.js';
import { LMDBReadOnlyStoreNotFoundError } from '../lib/db/adapters/lmdb.js';
import {
  ensureLocalServiceSocketDirectory,
  getLocalServiceSessionPrincipalId,
  getLocalServiceSocketDirectory,
} from './local-service-session.js';

/**
 * A long-lived LMDB writer must be the only process that opens and closes its
 * store while it writes: lmdb-js #370 loses or corrupts a writer's
 * transactions when another process opens and then closes the same
 * environment. A *host* is that writer. It binds a per-process endpoint before
 * its native open, releases it after its native close, and meanwhile answers
 * other processes' reads from a read-only facade on its own environment.
 *
 * Endpoints live in the private per-user socket directory, so the connecting
 * principal is the one that could already read the store files directly. The
 * host offers reads only.
 */

/** The only supported local store host protocol version. */
export const LOCAL_STORE_HOST_PROTOCOL_VERSION = 1;
/** Maximum client request frame. Read parameters are small. */
export const LOCAL_STORE_HOST_MAX_REQUEST_BYTES = 1024 * 1024;
/** Maximum host response frame; query() can return a whole partition. */
export const LOCAL_STORE_HOST_MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
/** How long a client waits for a starting or stopping host before failing. */
export const LOCAL_STORE_HOST_ACCEPT_TIMEOUT_MS = 10_000;
/**
 * Delay between binding a host endpoint and the host's native open. A direct
 * reader that probed just before the bind normally finishes within it.
 */
export const LOCAL_STORE_HOST_SETTLE_MS = 100;

const STORE_TOKEN_DOMAIN = 'wharfie:local-store-host:v1';
const STORE_TOKEN_LENGTH = 24;
const ENDPOINT_PREFIX = 'h-';
const ENDPOINT_SUFFIX = '.sock';
const STALE_ENDPOINT_MIN_AGE_MS = 10_000;
const RETRY_INTERVAL_MS = 25;
const FRAME_HEADER_BYTES = 4;
const READ_METHODS = new Set(['get', 'query', 'queryPage']);

/** @type {Map<string, LocalStoreHost>} */
const hostsInProcess = new Map();
/** @type {WeakSet<object>} */
const hostClients = new WeakSet();

/**
 * @typedef {{storeRoot: string, endpoint: string, serve: (openFacade: () => Promise<import('../lib/db/base.js').DBClient>) => void, stopServing: () => Promise<void>, release: () => Promise<void>}} LocalStoreHost
 */

/**
 * Another process serves this store, so this process must not open it
 * natively for writing (or must route the operation through that process).
 */
export class LocalStoreHostedError extends Error {
  /**
   * @param {string} message - Safe operator-facing diagnostic.
   * @param {{processId?: number, cause?: unknown}} [options] - Safe context.
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'LocalStoreHostedError';
    this.code = 'local-store-hosted';
    if (options.processId !== undefined) this.processId = options.processId;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * The host for a store could not serve a read. Callers fail closed: they never
 * fall back to opening a store that another process is writing.
 */
export class LocalStoreHostReadError extends Error {
  /**
   * @param {string} message - Safe operator-facing diagnostic.
   * @param {{cause?: unknown}} [options] - Safe context.
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'LocalStoreHostReadError';
    this.code = 'local-store-host-read';
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * @param {string} storePath - Facade path of the LMDB store.
 * @returns {string | undefined} - Canonical store root, or undefined if absent.
 */
function resolveStoreRoot(storePath) {
  try {
    return realpathSync(storePath);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * @param {string} storeRoot - Canonical store root.
 * @returns {string} - Endpoint filename prefix shared by every host of it.
 */
function endpointPrefix(storeRoot) {
  const token = createHash('sha256')
    .update(STORE_TOKEN_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(getLocalServiceSessionPrincipalId(), 'utf8')
    .update('\0', 'utf8')
    .update(storeRoot, 'utf8')
    .digest('hex')
    .slice(0, STORE_TOKEN_LENGTH);
  return `${ENDPOINT_PREFIX}${token}-`;
}

/**
 * @param {unknown} error - Candidate system error.
 * @returns {boolean} - Whether no listener answered at the endpoint.
 */
function isAbsentEndpointError(error) {
  const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
  return code === 'ECONNREFUSED' || code === 'ENOENT';
}

/**
 * @param {Buffer} body - Frame body.
 * @returns {Buffer} - Length-prefixed frame.
 */
function frame(body) {
  const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
  header.writeUInt32BE(body.byteLength, 0);
  return Buffer.concat([header, body]);
}

/**
 * Deliver complete length-prefixed frames from a socket.
 * @param {import('node:net').Socket} socket - Connected socket.
 * @param {number} maxBytes - Largest accepted frame body.
 * @param {(body: Buffer) => void} onFrame - Complete frame callback.
 * @param {(error: Error) => void} onOversize - Oversized frame callback.
 * @returns {void}
 */
function readFrames(socket, maxBytes, onFrame, onOversize) {
  /** @type {Buffer[]} */
  let chunks = [];
  let buffered = 0;
  socket.on('data', (chunk) => {
    chunks.push(chunk);
    buffered += chunk.byteLength;
    for (;;) {
      if (buffered < FRAME_HEADER_BYTES) return;
      const pending = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      chunks = [pending];
      const length = pending.readUInt32BE(0);
      if (length > maxBytes) {
        chunks = [];
        buffered = 0;
        onOversize(new RangeError(`Frame exceeds the ${maxBytes}-byte limit.`));
        return;
      }
      if (buffered < FRAME_HEADER_BYTES + length) return;
      const body = pending.subarray(
        FRAME_HEADER_BYTES,
        FRAME_HEADER_BYTES + length,
      );
      const rest = pending.subarray(FRAME_HEADER_BYTES + length);
      chunks = rest.byteLength > 0 ? [rest] : [];
      buffered = rest.byteLength;
      onFrame(body);
    }
  });
}

/**
 * @param {unknown} error - Facade error.
 * @returns {{name: string, message: string, code?: string}} - Transportable error.
 */
function describeError(error) {
  const candidate =
    /** @type {{name?: unknown, message?: unknown, code?: unknown}} */ (
      error && typeof error === 'object' ? error : {}
    );
  return {
    name: typeof candidate.name === 'string' ? candidate.name : 'Error',
    message:
      typeof candidate.message === 'string' ? candidate.message : String(error),
    ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
  };
}

/**
 * @param {{name?: unknown, message?: unknown, code?: unknown}} described - Transported error.
 * @returns {Error} - Equivalent local error.
 */
function rebuildError(described) {
  const message =
    typeof described?.message === 'string' ? described.message : 'Error';
  if (described?.code === 'WHARFIE_READ_ONLY_STORE_NOT_FOUND') {
    return new LMDBReadOnlyStoreNotFoundError(message);
  }
  const ErrorClass =
    described?.name === 'TypeError'
      ? TypeError
      : described?.name === 'RangeError'
        ? RangeError
        : Error;
  const error = new ErrorClass(message);
  if (typeof described?.name === 'string') error.name = described.name;
  if (typeof described?.code === 'string') {
    Object.assign(error, { code: described.code });
  }
  return error;
}

/**
 * Serve one client connection: one read-only facade, serial calls.
 * @param {import('node:net').Socket} socket - Accepted connection.
 * @param {{storeRoot: string, isServing: () => boolean, openFacade: () => (() => Promise<import('../lib/db/base.js').DBClient>) | undefined, track: (opening: Promise<import('../lib/db/base.js').DBClient>) => () => void}} context - Host state.
 * @returns {void}
 */
function serveConnection(socket, context) {
  /** @type {import('../lib/db/base.js').DBClient | undefined} */
  let facade;
  /** @type {(() => void) | undefined} */
  let untrack;
  let queue = Promise.resolve();
  /** @param {Record<string, any>} message - Response. */
  const send = (message) => {
    if (socket.destroyed || !socket.writable) return;
    let body;
    try {
      body = v8.serialize({
        version: LOCAL_STORE_HOST_PROTOCOL_VERSION,
        ...message,
      });
    } catch (error) {
      body = v8.serialize({
        version: LOCAL_STORE_HOST_PROTOCOL_VERSION,
        kind: 'error',
        ...(message.id === undefined ? {} : { id: message.id }),
        error: describeError(error),
      });
    }
    if (body.byteLength > LOCAL_STORE_HOST_MAX_RESPONSE_BYTES) {
      body = v8.serialize({
        version: LOCAL_STORE_HOST_PROTOCOL_VERSION,
        kind: 'error',
        ...(message.id === undefined ? {} : { id: message.id }),
        error: {
          name: 'RangeError',
          message: `Local store host response exceeds the ${LOCAL_STORE_HOST_MAX_RESPONSE_BYTES}-byte limit.`,
        },
      });
    }
    socket.write(frame(body));
  };
  /** @type {Promise<import('../lib/db/base.js').DBClient> | undefined} */
  let opening;
  // The open stays tracked until its facade has closed, so the host's
  // stopServing always waits for every remote reference to its environment.
  const releaseFacade = () => {
    const current = opening;
    opening = undefined;
    facade = undefined;
    current
      ?.then(async (opened) => await opened.close?.())
      .catch(() => undefined)
      .finally(() => untrack?.());
  };
  socket.on('error', () => socket.destroy());
  socket.once('close', releaseFacade);

  /** @param {Buffer} body - One request frame. */
  const handle = async (body) => {
    /** @type {Record<string, any>} */
    let request;
    try {
      request = JSON.parse(body.toString('utf8'));
    } catch {
      socket.destroy();
      return;
    }
    if (
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      request.version !== LOCAL_STORE_HOST_PROTOCOL_VERSION
    ) {
      socket.destroy();
      return;
    }
    if (request.kind === 'open') {
      if (opening || request.storeRoot !== context.storeRoot) {
        socket.destroy();
        return;
      }
      const openFacade = context.openFacade();
      if (!context.isServing() || !openFacade) {
        send({ kind: 'unavailable' });
        socket.end();
        return;
      }
      opening = openFacade();
      untrack = context.track(opening);
      try {
        const opened = await opening;
        if (socket.destroyed || !context.isServing()) return;
        facade = opened;
      } catch (error) {
        send({ kind: 'error', error: describeError(error) });
        socket.end();
        return;
      }
      send({ kind: 'opened', processId: process.pid });
      return;
    }
    if (
      request.kind !== 'call' ||
      !facade ||
      !Number.isSafeInteger(request.id) ||
      !READ_METHODS.has(request.method) ||
      !request.params ||
      typeof request.params !== 'object' ||
      Array.isArray(request.params)
    ) {
      socket.destroy();
      return;
    }
    const method = /** @type {'get'|'query'|'queryPage'} */ (request.method);
    try {
      const value = await /** @type {any} */ (facade)[method](request.params);
      send({ kind: 'result', id: request.id, value });
    } catch (error) {
      send({ kind: 'error', id: request.id, error: describeError(error) });
    }
  };

  readFrames(
    socket,
    LOCAL_STORE_HOST_MAX_REQUEST_BYTES,
    (body) => {
      queue = queue
        .then(() => handle(body))
        .catch(() => {
          socket.destroy();
        });
    },
    () => socket.destroy(),
  );
}

/**
 * @param {import('node:net').Server} server - Server to bind.
 * @param {string} endpoint - Exact socket path.
 * @returns {Promise<void>} - Resolves after bind.
 */
function listen(server, endpoint) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

/**
 * @param {string} endpoint - Candidate host endpoint.
 * @returns {Promise<'live'|'absent'>} - Whether a listener answers.
 */
function probeEndpoint(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    socket.once('connect', () => {
      socket.destroy();
      resolve('live');
    });
    socket.once('error', (error) => {
      socket.destroy();
      if (isAbsentEndpointError(error)) resolve('absent');
      else reject(error);
    });
  });
}

/**
 * Remove endpoints of dead hosts for this store. Paths are never reused, so a
 * refused connect is final; the age rule avoids a host between bind and
 * listen.
 * @param {string} directory - Private socket directory.
 * @param {string} prefix - This store's endpoint prefix.
 * @param {string} own - This host's endpoint.
 * @returns {Promise<void>}
 */
async function removeStaleEndpoints(directory, prefix, own) {
  const names = await fsp.readdir(directory);
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(ENDPOINT_SUFFIX)) continue;
    const endpoint = join(directory, name);
    if (endpoint === own) continue;
    try {
      const stats = await fsp.lstat(endpoint);
      if (Date.now() - stats.mtimeMs < STALE_ENDPOINT_MIN_AGE_MS) continue;
      if ((await probeEndpoint(endpoint)) === 'absent') {
        await fsp.unlink(endpoint);
      }
    } catch {
      // Best-effort cleanup only; a client treats a stale entry as absent.
    }
  }
}

/**
 * Become the host of one local LMDB store. Call before the native open of the
 * store; `serve` once it is open; `stopServing` before the host closes its
 * own facade; `release` after that close.
 * @param {{storePath: string}} options - Facade path of the hosted store.
 * @returns {Promise<LocalStoreHost | undefined>} - Host, or undefined where unsupported.
 */
export async function acquireLocalStoreHost(options) {
  if (process.platform === 'win32') return undefined;
  await fsp.mkdir(options.storePath, { recursive: true, mode: 0o700 });
  const storeRoot = realpathSync(options.storePath);
  if (hostsInProcess.has(storeRoot)) {
    throw new Error('This process already hosts the local store.');
  }
  const directory = await ensureLocalServiceSocketDirectory();
  const prefix = endpointPrefix(storeRoot);
  const endpoint = join(
    directory,
    `${prefix}${process.pid}-${randomBytes(4).toString('hex')}${ENDPOINT_SUFFIX}`,
  );

  /** @type {(() => Promise<import('../lib/db/base.js').DBClient>) | undefined} */
  let openFacade;
  let serving = false;
  /** @type {Set<import('node:net').Socket>} */
  const sockets = new Set();
  /** @type {Set<Promise<import('../lib/db/base.js').DBClient>>} */
  const facades = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    serveConnection(socket, {
      storeRoot,
      isServing: () => serving,
      openFacade: () => openFacade,
      track: (opening) => {
        facades.add(opening);
        return () => facades.delete(opening);
      },
    });
  });
  server.on('error', () => {
    // Bind failures surface from listen(); accepted sockets handle their own.
  });
  await listen(server, endpoint);
  await removeStaleEndpoints(directory, prefix, endpoint).catch(
    () => undefined,
  );

  /** @type {Promise<void> | undefined} */
  let stopPromise;
  /** @type {Promise<void> | undefined} */
  let releasePromise;
  /** @type {LocalStoreHost} */
  const host = Object.freeze({
    storeRoot,
    endpoint,
    serve: (open) => {
      if (stopPromise)
        throw new Error('A stopped local store host cannot serve.');
      openFacade = open;
      serving = true;
    },
    stopServing: () => {
      stopPromise ??= (async () => {
        serving = false;
        openFacade = undefined;
        for (const socket of sockets) socket.destroy();
        const open = [...facades];
        facades.clear();
        await Promise.allSettled(
          open.map(async (pending) => await (await pending).close?.()),
        );
      })();
      return stopPromise;
    },
    release: () => {
      releasePromise ??= (async () => {
        await host.stopServing();
        await new Promise((resolve) => server.close(() => resolve(undefined)));
        await fsp.unlink(endpoint).catch(() => undefined);
        if (hostsInProcess.get(storeRoot) === host) {
          hostsInProcess.delete(storeRoot);
        }
      })();
      return releasePromise;
    },
  });
  hostsInProcess.set(storeRoot, host);
  await delay(LOCAL_STORE_HOST_SETTLE_MS);
  return host;
}

/**
 * @param {string} storeRoot - Canonical store root.
 * @returns {Promise<string[]>} - Candidate host endpoints of other processes.
 */
async function listHostEndpoints(storeRoot) {
  const directory = getLocalServiceSocketDirectory();
  let names;
  try {
    names = await fsp.readdir(directory);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const prefix = endpointPrefix(storeRoot);
  const own = hostsInProcess.get(storeRoot)?.endpoint;
  const endpoints = names
    .filter((name) => name.startsWith(prefix) && name.endsWith(ENDPOINT_SUFFIX))
    .sort()
    .map((name) => join(directory, name))
    .filter((endpoint) => endpoint !== own);
  if (endpoints.length > 0) {
    // Trust a host listing only from the verified private directory.
    await ensureLocalServiceSocketDirectory();
  }
  return endpoints;
}

/**
 * @typedef {{kind: 'absent'} | {kind: 'unavailable'} | {kind: 'opened', processId: number, socket: import('node:net').Socket, call: (method: string, params: Record<string, any>) => Promise<any>, close: () => void}} HostConnection
 */

/**
 * Open one remote facade on one host endpoint.
 * @param {string} endpoint - Host endpoint.
 * @param {string} storeRoot - Canonical store root.
 * @returns {Promise<HostConnection>} - Connection outcome.
 */
function connectHost(endpoint, storeRoot) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    let connected = false;
    let settled = false;
    let nextId = 1;
    /** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void}>} */
    const pending = new Map();
    /** @type {Error | undefined} */
    let broken;
    /** @param {Error} error - Transport failure. */
    const fail = (error) => {
      broken ??= error;
      for (const waiter of pending.values()) waiter.reject(broken);
      pending.clear();
      if (!settled) {
        settled = true;
        if (!connected && isAbsentEndpointError(error.cause)) {
          resolve({ kind: 'absent' });
        } else if (!connected) {
          reject(error);
        } else {
          resolve({ kind: 'unavailable' });
        }
      }
    };
    socket.once('connect', () => {
      connected = true;
      socket.write(
        frame(
          Buffer.from(
            JSON.stringify({
              version: LOCAL_STORE_HOST_PROTOCOL_VERSION,
              kind: 'open',
              storeRoot,
            }),
            'utf8',
          ),
        ),
      );
    });
    socket.on('error', (cause) =>
      fail(
        new LocalStoreHostReadError(
          'The connection to the local store host failed.',
          { cause },
        ),
      ),
    );
    socket.once('close', () =>
      fail(
        new LocalStoreHostReadError(
          'The local store host closed the connection.',
        ),
      ),
    );
    readFrames(
      socket,
      LOCAL_STORE_HOST_MAX_RESPONSE_BYTES,
      (body) => {
        /** @type {Record<string, any>} */
        let message;
        try {
          message = v8.deserialize(body);
        } catch (cause) {
          socket.destroy();
          fail(
            new LocalStoreHostReadError(
              'The local store host sent a malformed response.',
              { cause },
            ),
          );
          return;
        }
        if (!settled) {
          settled = true;
          if (message?.kind === 'opened') {
            resolve({
              kind: 'opened',
              processId: message.processId,
              socket,
              call: (method, params) =>
                new Promise((resolve, reject) => {
                  if (broken) {
                    reject(broken);
                    return;
                  }
                  const id = nextId++;
                  pending.set(id, { resolve, reject });
                  socket.write(
                    frame(
                      Buffer.from(
                        JSON.stringify({
                          version: LOCAL_STORE_HOST_PROTOCOL_VERSION,
                          kind: 'call',
                          id,
                          method,
                          params,
                        }),
                        'utf8',
                      ),
                    ),
                  );
                }),
              close: () => {
                broken ??= new Error('LMDB client is closed.');
                socket.end();
              },
            });
            return;
          }
          socket.destroy();
          if (message?.kind === 'unavailable') {
            resolve({ kind: 'unavailable' });
            return;
          }
          reject(
            message?.kind === 'error'
              ? rebuildError(message.error)
              : new LocalStoreHostReadError(
                  'The local store host refused the connection.',
                ),
          );
          return;
        }
        const waiter = pending.get(message?.id);
        if (!waiter) {
          socket.destroy();
          return;
        }
        pending.delete(message.id);
        if (message.kind === 'result') waiter.resolve(message.value);
        else waiter.reject(rebuildError(message.error));
      },
      (cause) => {
        socket.destroy();
        fail(
          new LocalStoreHostReadError(
            'The local store host sent an oversized response.',
            { cause },
          ),
        );
      },
    );
  });
}

/** Transport losses tolerated per read before it fails closed. */
const MAX_READ_REROUTES = 3;

/**
 * Wrap one remote facade as a read-only LMDB DB client. If the host goes away
 * mid-operation (it stops, or crashes and restarts), the failed read is
 * re-resolved through `reopen`: that waits for a stopping host to unbind,
 * routes to a host that serves, and opens natively only when no host is left.
 * Each read is independent, so a reroute between reads gives the same
 * per-read consistency as a direct open.
 * @param {Extract<HostConnection, {kind: 'opened'}>} connection - Opened remote facade.
 * @param {(() => Promise<import('../lib/db/base.js').DBClient>) | undefined} reopen - Re-resolve the store after a lost host.
 * @returns {import('../lib/db/base.js').DBClient} - Remote read-only client.
 */
function createHostClient(connection, reopen) {
  const readOnly = async () => {
    throw new Error('LMDB client is read-only.');
  };
  let closed = false;
  /** @type {import('../lib/db/base.js').DBClient | undefined} */
  let rerouted;
  /**
   * @param {'get'|'query'|'queryPage'} method - Read method.
   * @returns {(params: any) => Promise<any>} - Remote call.
   */
  const remote = (method) => async (params) => {
    for (let attempt = 0; ; attempt += 1) {
      if (closed) throw new Error('LMDB client is closed.');
      try {
        if (rerouted)
          return await /** @type {any} */ (rerouted)[method](params);
        return await connection.call(method, params);
      } catch (error) {
        // Only a lost transport is rerouted; an error the host answered is
        // the read's own result.
        if (
          !reopen ||
          !(error instanceof LocalStoreHostReadError) ||
          attempt >= MAX_READ_REROUTES
        ) {
          throw error;
        }
        const previous = rerouted;
        rerouted = undefined;
        if (previous) await previous.close?.().catch(() => undefined);
        else connection.close();
        rerouted = await reopen();
      }
    }
  };
  const client = brandDBClient(
    {
      query: remote('query'),
      queryPage: remote('queryPage'),
      batchWrite: readOnly,
      transactionWrite: readOnly,
      update: readOnly,
      put: readOnly,
      get: remote('get'),
      remove: readOnly,
      close: async () => {
        if (closed) return;
        closed = true;
        connection.close();
        await rerouted?.close?.();
      },
    },
    DB_ADAPTER_NAMES.LMDB,
  );
  hostClients.add(client);
  return /** @type {import('../lib/db/base.js').DBClient} */ (client);
}

/**
 * @param {unknown} db - Candidate DB client.
 * @returns {boolean} - Whether reads go through another process's host.
 */
export function isLocalStoreHostClient(db) {
  return !!db && typeof db === 'object' && hostClients.has(db);
}

/**
 * Connect a read-only client to another live host of a store. Returns
 * undefined when no other process hosts it, which is the only case in which a
 * caller may open the store natively. A host that is starting or stopping is
 * retried; one that never accepts fails closed.
 * @param {{storePath: string, timeoutMs?: number, reopen?: () => Promise<import('../lib/db/base.js').DBClient>}} options - Facade path of the store, and how to re-resolve it if its host is lost mid-operation.
 * @returns {Promise<import('../lib/db/base.js').DBClient | undefined>} - Remote client or undefined.
 */
export async function connectLocalStoreHost(options) {
  if (process.platform === 'win32') return undefined;
  const storeRoot = resolveStoreRoot(options.storePath);
  if (storeRoot === undefined) return undefined;
  const deadline =
    Date.now() + (options.timeoutMs ?? LOCAL_STORE_HOST_ACCEPT_TIMEOUT_MS);
  for (;;) {
    const endpoints = await listHostEndpoints(storeRoot);
    let unavailable = false;
    for (const endpoint of endpoints) {
      const connection = await connectHost(endpoint, storeRoot);
      if (connection.kind === 'opened') {
        return createHostClient(connection, options.reopen);
      }
      if (connection.kind === 'unavailable') unavailable = true;
    }
    if (!unavailable) return undefined;
    if (Date.now() >= deadline) {
      throw new LocalStoreHostReadError(
        `The process serving this local store did not accept reads within ${options.timeoutMs ?? LOCAL_STORE_HOST_ACCEPT_TIMEOUT_MS}ms; retry when it is ready.`,
      );
    }
    await delay(RETRY_INTERVAL_MS);
  }
}

/**
 * Find another live host of a store without opening a remote facade.
 * @param {{storePath: string}} options - Facade path of the store.
 * @returns {Promise<string | undefined>} - One live endpoint, if any.
 */
export async function findLocalStoreHost(options) {
  if (process.platform === 'win32') return undefined;
  const storeRoot = resolveStoreRoot(options.storePath);
  if (storeRoot === undefined) return undefined;
  for (const endpoint of await listHostEndpoints(storeRoot)) {
    if ((await probeEndpoint(endpoint)) === 'live') return endpoint;
  }
  return undefined;
}

/**
 * Refuse a native writable open while another process hosts the store. The
 * hosting process itself is exempt: it binds its endpoint first.
 * @param {{storePath: string}} options - Facade path of the store.
 * @returns {Promise<void>} - Resolves when no other process hosts it.
 */
export async function assertLocalStoreNotHosted(options) {
  const endpoint = await findLocalStoreHost(options);
  if (endpoint === undefined) return;
  const match = /-(\d+)-[0-9a-f]+\.sock$/.exec(endpoint);
  const processId = match ? Number(match[1]) : undefined;
  throw new LocalStoreHostedError(
    `Another Wharfie process${processId === undefined ? '' : ` (pid ${processId})`} is serving this local control store, so this command cannot open it for writing. Route the change through that process, or stop it first.`,
    processId === undefined ? {} : { processId },
  );
}

export default {
  LOCAL_STORE_HOST_ACCEPT_TIMEOUT_MS,
  LOCAL_STORE_HOST_MAX_REQUEST_BYTES,
  LOCAL_STORE_HOST_MAX_RESPONSE_BYTES,
  LOCAL_STORE_HOST_PROTOCOL_VERSION,
  LOCAL_STORE_HOST_SETTLE_MS,
  LocalStoreHostReadError,
  LocalStoreHostedError,
  acquireLocalStoreHost,
  assertLocalStoreNotHosted,
  connectLocalStoreHost,
  findLocalStoreHost,
  isLocalStoreHostClient,
};
