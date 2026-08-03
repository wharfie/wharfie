/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/tag-lines -- The lock deliberately exposes one small injected server seam for deterministic tests. */

import { createHash } from 'node:crypto';
import net from 'node:net';

const LOCK_DOMAIN_PATTERN = /^wharfie:[a-z0-9][a-z0-9:-]{0,126}:v[1-9][0-9]*$/;
const MAX_SCOPE_BYTES = 4096;
const REQUIRED_OPTION_KEYS = new Set(['domain', 'scope']);
const OPTION_KEYS = new Set([...REQUIRED_OPTION_KEYS, 'createServer']);

/**
 * A Linux abstract-socket lock address is already bound in this network
 * namespace. This is an availability conflict, not authority.
 */
export class LinuxAbstractOperationLockBusyError extends Error {
  constructor() {
    super('The requested Wharfie operation lock is already held.');
    this.name = 'LinuxAbstractOperationLockBusyError';
    this.code = 'WHARFIE_LINUX_ABSTRACT_OPERATION_LOCK_BUSY';
  }
}

/** @param {unknown} value @param {string} path @returns {string} */
function nonemptyBoundedString(value, path) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > MAX_SCOPE_BYTES
  ) {
    throw new TypeError(`${path} must be one bounded nonempty string.`);
  }
  return value;
}

/**
 * Close a server after either a successful bind or a failed listen attempt.
 * @param {import('node:net').Server} server - Owned server.
 * @returns {Promise<void>} - Resolves after the close callback or a
 * synchronous already-closed result.
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
 * Bind one Linux abstract AF_UNIX address. Bind is atomic across processes,
 * and the kernel releases the address when the owning process exits, so no
 * timestamp, PID reuse heuristic, or stale-file deletion is involved.
 *
 * Abstract sockets do not provide filesystem ACLs. A peer in the same network
 * namespace can cause denial of service by binding the address first, but
 * possession of the address grants no durable-store or effect authority.
 *
 * @param {{domain: string, scope: string, createServer?: typeof net.createServer}} options - Domain-separated lock identity and test seam.
 * @returns {Promise<() => Promise<void>>} - Idempotent release callback.
 */
export async function acquireLinuxAbstractOperationLock(options) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  ) {
    throw new TypeError('Linux abstract operation lock options are required.');
  }
  const keys = Reflect.ownKeys(options);
  if (
    keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.has(key)) ||
    [...REQUIRED_OPTION_KEYS].some((key) => !keys.includes(key)) ||
    keys.length < REQUIRED_OPTION_KEYS.size ||
    keys.length > OPTION_KEYS.size
  ) {
    throw new TypeError('Linux abstract operation lock options are invalid.');
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError('Linux abstract operation lock options are invalid.');
    }
  }
  if (
    typeof options.domain !== 'string' ||
    !LOCK_DOMAIN_PATTERN.test(options.domain)
  ) {
    throw new TypeError(
      'Linux abstract operation lock domain must be canonical.',
    );
  }
  const scope = nonemptyBoundedString(
    options.scope,
    'Linux abstract operation lock scope',
  );
  if (
    options.createServer !== undefined &&
    typeof options.createServer !== 'function'
  ) {
    throw new TypeError(
      'Linux abstract operation lock createServer must be a function.',
    );
  }
  const digest = createHash('sha256')
    .update(options.domain, 'utf8')
    .update('\0', 'utf8')
    .update(scope, 'utf8')
    .digest('base64url');
  const address = `\0wharfie-lock-${digest}`;
  const createServer = options.createServer ?? net.createServer;
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
      'Linux abstract operation lock server is not supported.',
    );
  }

  // Contain errors emitted after bind rather than allowing an EventEmitter
  // error to become an uncaught process exception.
  server.on('error', () => undefined);
  try {
    await new Promise((resolve, reject) => {
      /** @param {Error} error - Bind failure. @returns {void} */
      function onError(error) {
        cleanup();
        reject(error);
      }
      /** @returns {void} */
      function onListening() {
        cleanup();
        resolve(undefined);
      }
      /** @returns {void} */
      function cleanup() {
        server.removeListener('error', onError);
        server.removeListener('listening', onListening);
      }
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(address);
    });
  } catch (error) {
    await closeServer(server).catch(() => undefined);
    if (
      error &&
      typeof error === 'object' &&
      /** @type {{code?: unknown}} */ (error).code === 'EADDRINUSE'
    ) {
      throw new LinuxAbstractOperationLockBusyError();
    }
    throw error;
  }
  server.unref();

  /** @type {Promise<void>|undefined} */
  let releasePromise;
  return () => {
    if (!releasePromise) releasePromise = closeServer(server);
    return releasePromise;
  };
}

export default {
  LinuxAbstractOperationLockBusyError,
  acquireLinuxAbstractOperationLock,
};
