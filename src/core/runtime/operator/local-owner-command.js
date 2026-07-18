import { createHmac, timingSafeEqual } from 'node:crypto';
import net from 'node:net';

import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import {
  decodeCanonicalJsonPayload,
  encodeCanonicalJsonPayload,
} from '../execution-payload.js';
import { assertLogicalId } from '../logical-id.js';
import {
  getLocalServiceSessionEndpoint,
  getLocalServiceSessionOwnerCommandEndpoint,
  isAcquiredLocalServiceSession,
  probeLocalServiceSession,
} from '../local-service-session.js';

/** The only supported local owner-command protocol version. */
export const LOCAL_OWNER_COMMAND_PROTOCOL_VERSION = 1;
/** Maximum exact canonical request envelope size. */
export const LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES = 64 * 1024;
/** Maximum exact canonical response envelope size. */
export const LOCAL_OWNER_COMMAND_MAX_RESPONSE_BYTES = 64 * 1024;
/** Default bounded local socket and owner-handler wait. */
export const LOCAL_OWNER_COMMAND_DEFAULT_TIMEOUT_MS = 1_500;
/** Absolute upper bound for a caller-configured local command timeout. */
export const LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS = 10_000;

const MIN_PROTOCOL_BYTES = 256;
const REQUEST_MAC_DOMAIN = 'wharfie:local-owner-command:v1:request';
const RESPONSE_MAC_DOMAIN = 'wharfie:local-owner-command:v1:response';
const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RESPONSE_STATUSES = new Set([
  'ok',
  'stale',
  'auth',
  'malformed',
  'timeout',
  'rejected',
]);

/**
 * A bounded local owner-command result was not authoritatively accepted.
 * `kind` intentionally distinguishes a stale owner from a malformed or
 * unauthenticated peer. A timeout only means that the client cannot know
 * whether a valid handler eventually acted; callers must use the durable
 * request ID to reconcile that case.
 */
export class LocalOwnerCommandError extends Error {
  /**
   * @param {'stale'|'auth'|'malformed'|'unreachable'|'timeout'|'rejected'} kind - Exact safe classification.
   * @param {string} message - Safe operator-facing diagnostic.
   * @param {{cause?: unknown, endpoint?: string, requestId?: string}} [options] - Additional safe context.
   */
  constructor(kind, message, options = {}) {
    super(message);
    this.name = 'LocalOwnerCommandError';
    this.code = `local-owner-command-${kind}`;
    this.kind = kind;
    if (options.endpoint !== undefined) this.endpoint = options.endpoint;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * @param {unknown} value - Candidate bounded timeout.
 * @param {string} label - Option label.
 * @param {number} fallback - Default duration.
 * @returns {number} - Valid timeout.
 */
function normalizeTimeout(value, label, fallback) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS
  ) {
    throw new TypeError(
      `${label} must be a positive safe integer no greater than ${LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS}.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate protocol byte cap.
 * @param {string} label - Option label.
 * @param {number} maximum - Hard protocol ceiling.
 * @returns {number} - Valid byte cap.
 */
function normalizeByteLimit(value, label, maximum) {
  if (value === undefined) return maximum;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < MIN_PROTOCOL_BYTES ||
    value > maximum
  ) {
    throw new TypeError(
      `${label} must be a safe integer between ${MIN_PROTOCOL_BYTES} and ${maximum}.`,
    );
  }
  return value;
}

/**
 * @param {Record<string, any>} value - Candidate envelope.
 * @param {string[]} keys - Exact supported fields.
 * @param {string} label - Boundary label.
 * @returns {void} - Returns after exact field validation.
 */
function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
  const expected = new Set(keys);
  for (const key of actual) {
    if (!expected.has(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate command name.
 * @param {string} label - Boundary label.
 * @returns {string} - Canonical command name.
 */
function normalizeCommand(value, label) {
  assertLogicalId(value, label);
  return value;
}

/**
 * @param {unknown} value - Candidate exact MAC value.
 * @param {string} label - Boundary label.
 * @returns {string} - Canonical base64url SHA-256 MAC.
 */
function normalizeMac(value, label) {
  if (typeof value !== 'string' || !MAC_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a canonical base64url SHA-256 MAC.`);
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.byteLength !== 32 || bytes.toString('base64url') !== value) {
    throw new TypeError(`${label} must be a canonical base64url SHA-256 MAC.`);
  }
  return value;
}

/**
 * @param {string} sessionId - Per-session HMAC key material.
 * @param {string} domain - Domain-separated direction label.
 * @param {Record<string, any>} unsigned - Exact unsigned protocol object.
 * @returns {string} - Canonical base64url HMAC-SHA-256.
 */
function signEnvelope(sessionId, domain, unsigned) {
  const bytes = encodeCanonicalJsonPayload(unsigned, 'owner command MAC input');
  return createHmac('sha256', Buffer.from(sessionId, 'utf8'))
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(bytes)
    .digest('base64url');
}

/**
 * @param {string} sessionId - Per-session HMAC key material.
 * @param {string} domain - Domain-separated direction label.
 * @param {Record<string, any>} unsigned - Exact unsigned protocol object.
 * @param {string} received - Candidate received MAC.
 * @returns {boolean} - Whether the MAC exactly authenticates the envelope.
 */
function hasValidMac(sessionId, domain, unsigned, received) {
  const expected = Buffer.from(signEnvelope(sessionId, domain, unsigned));
  const actual = Buffer.from(received);
  return (
    actual.byteLength === expected.byteLength &&
    timingSafeEqual(actual, expected)
  );
}

/**
 * @param {Record<string, any>} value - Parsed protocol request.
 * @param {string} sessionId - Expected HMAC key material.
 * @returns {Readonly<{requestId: string, command: string, request: Record<string, any>}>} - Validated authenticated request.
 */
function normalizeAuthenticatedRequest(value, sessionId) {
  assertExactKeys(
    value,
    ['version', 'requestId', 'command', 'request', 'mac'],
    'local owner command request',
  );
  if (value.version !== LOCAL_OWNER_COMMAND_PROTOCOL_VERSION) {
    throw new TypeError(
      `local owner command request.version must be ${LOCAL_OWNER_COMMAND_PROTOCOL_VERSION}.`,
    );
  }
  const requestId = assertLedgerOpaqueId(
    value.requestId,
    'local owner command request.requestId',
  );
  const command = normalizeCommand(
    value.command,
    'local owner command request.command',
  );
  if (
    !value.request ||
    typeof value.request !== 'object' ||
    Array.isArray(value.request)
  ) {
    throw new TypeError(
      'local owner command request.request must be an object.',
    );
  }
  const request = /** @type {Record<string, any>} */ (value.request);
  const mac = normalizeMac(value.mac, 'local owner command request.mac');
  const unsigned = { version: value.version, requestId, command, request };
  if (!hasValidMac(sessionId, REQUEST_MAC_DOMAIN, unsigned, mac)) {
    throw new LocalOwnerCommandError(
      'auth',
      'The local owner command request could not be authenticated.',
      { requestId },
    );
  }
  return Object.freeze({ requestId, command, request });
}

/**
 * @param {Buffer} bytes - Exact received request bytes.
 * @param {string} sessionId - Expected HMAC key material.
 * @returns {Readonly<{requestId: string, command: string, request: Record<string, any>}>} - Authenticated request.
 */
function decodeAuthenticatedRequest(bytes, sessionId) {
  let parsed;
  try {
    parsed = decodeCanonicalJsonPayload(bytes, 'local owner command request');
  } catch (cause) {
    throw new LocalOwnerCommandError(
      'malformed',
      'The local owner command request is malformed.',
      { cause },
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LocalOwnerCommandError(
      'malformed',
      'The local owner command request is malformed.',
    );
  }
  try {
    return normalizeAuthenticatedRequest(
      /** @type {Record<string, any>} */ (parsed),
      sessionId,
    );
  } catch (cause) {
    if (cause instanceof LocalOwnerCommandError) throw cause;
    throw new LocalOwnerCommandError(
      'malformed',
      'The local owner command request is malformed.',
      { cause },
    );
  }
}

/**
 * @param {string} requestId - Validated opaque request identity.
 * @param {'ok'|'stale'|'auth'|'malformed'|'timeout'|'rejected'} status - Response status.
 * @param {Record<string, any> | undefined} result - Handler result for accepted requests.
 * @param {string} sessionId - Per-session HMAC key material.
 * @param {number} maxBytes - Exact response byte ceiling.
 * @returns {Buffer} - Exact canonical authenticated response bytes.
 */
function encodeAuthenticatedResponse(
  requestId,
  status,
  result,
  sessionId,
  maxBytes,
) {
  const unsigned =
    status === 'ok'
      ? {
          version: LOCAL_OWNER_COMMAND_PROTOCOL_VERSION,
          requestId,
          status,
          result,
        }
      : { version: LOCAL_OWNER_COMMAND_PROTOCOL_VERSION, requestId, status };
  const mac = signEnvelope(sessionId, RESPONSE_MAC_DOMAIN, unsigned);
  const bytes = encodeCanonicalJsonPayload(
    { ...unsigned, mac },
    'local owner command response',
  );
  if (bytes.byteLength > maxBytes) {
    throw new RangeError(
      `local owner command response exceeds the ${maxBytes}-byte limit.`,
    );
  }
  return bytes;
}

/**
 * @param {Buffer} bytes - Exact received response bytes.
 * @param {{sessionId: string, requestId: string}} expected - Expected authenticated identity.
 * @returns {Record<string, any>} - Accepted handler result.
 */
function decodeAuthenticatedResponse(bytes, expected) {
  let parsed;
  try {
    parsed = decodeCanonicalJsonPayload(bytes, 'local owner command response');
  } catch (cause) {
    throw new LocalOwnerCommandError(
      'malformed',
      'The local owner command response is malformed.',
      { cause, requestId: expected.requestId },
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LocalOwnerCommandError(
      'malformed',
      'The local owner command response is malformed.',
      { requestId: expected.requestId },
    );
  }

  const value = /** @type {Record<string, any>} */ (parsed);
  try {
    const status = value.status;
    if (typeof status !== 'string' || !RESPONSE_STATUSES.has(status)) {
      throw new TypeError('status is invalid');
    }
    assertExactKeys(
      value,
      status === 'ok'
        ? ['version', 'requestId', 'status', 'result', 'mac']
        : ['version', 'requestId', 'status', 'mac'],
      'local owner command response',
    );
    if (value.version !== LOCAL_OWNER_COMMAND_PROTOCOL_VERSION) {
      throw new TypeError('version is invalid');
    }
    const requestId = assertLedgerOpaqueId(
      value.requestId,
      'local owner command response.requestId',
    );
    const mac = normalizeMac(value.mac, 'local owner command response.mac');
    const unsigned =
      status === 'ok'
        ? {
            version: value.version,
            requestId,
            status,
            result: value.result,
          }
        : { version: value.version, requestId, status };
    if (!hasValidMac(expected.sessionId, RESPONSE_MAC_DOMAIN, unsigned, mac)) {
      throw new LocalOwnerCommandError(
        'auth',
        'The local owner command response could not be authenticated.',
        { requestId: expected.requestId },
      );
    }
    if (requestId !== expected.requestId) {
      throw new LocalOwnerCommandError(
        'stale',
        'The local owner command response belongs to a different request.',
        { requestId: expected.requestId },
      );
    }
    if (status === 'ok') {
      if (
        !value.result ||
        typeof value.result !== 'object' ||
        Array.isArray(value.result)
      ) {
        throw new TypeError('result is invalid');
      }
      return /** @type {Record<string, any>} */ (value.result);
    }
    throw new LocalOwnerCommandError(
      /** @type {'stale'|'auth'|'malformed'|'timeout'|'rejected'} */ (status),
      `The local owner command was not accepted (${status}).`,
      { requestId: expected.requestId },
    );
  } catch (cause) {
    if (cause instanceof LocalOwnerCommandError) throw cause;
    throw new LocalOwnerCommandError(
      'malformed',
      'The local owner command response is malformed.',
      { cause, requestId: expected.requestId },
    );
  }
}

/**
 * @param {unknown} value - Candidate acquired local service session.
 * @returns {Readonly<{serviceId: string, sessionId: string, sessionRoot: string, endpoint: string, ownerCommandEndpoint: string}>} - Immutable verified session metadata.
 */
function normalizeLiveSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'local owner command session must be an acquired session object.',
    );
  }
  if (!isAcquiredLocalServiceSession(value)) {
    throw new TypeError(
      'local owner command session must be the exact locally held acquired session.',
    );
  }
  const candidate = /** @type {Record<string, unknown>} */ (value);
  if (typeof candidate.sessionRoot !== 'string') {
    throw new TypeError(
      'local owner command session.sessionRoot must come from an acquired session.',
    );
  }
  const identity = {
    serviceId: /** @type {string} */ (candidate.serviceId),
    sessionId: /** @type {string} */ (candidate.sessionId),
    sessionRoot: candidate.sessionRoot,
  };
  const endpoint = getLocalServiceSessionEndpoint(identity);
  const ownerCommandEndpoint =
    getLocalServiceSessionOwnerCommandEndpoint(identity);
  if (
    candidate.endpoint !== endpoint ||
    candidate.ownerCommandEndpoint !== ownerCommandEndpoint
  ) {
    throw new TypeError(
      'local owner command session must be the exact acquired local session.',
    );
  }
  return Object.freeze({
    serviceId: /** @type {string} */ (identity.serviceId),
    sessionId: /** @type {string} */ (identity.sessionId),
    sessionRoot: identity.sessionRoot,
    endpoint,
    ownerCommandEndpoint,
  });
}

/**
 * @param {unknown} error - Candidate system error.
 * @param {string} code - Expected system error code.
 * @returns {boolean} - Whether the candidate has the expected code.
 */
function hasErrorCode(error, code) {
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code === code
  );
}

/**
 * @param {unknown} error - Candidate bind error.
 * @returns {boolean} - Whether an endpoint is already occupied.
 */
function isAddressInUse(error) {
  return hasErrorCode(error, 'EADDRINUSE') || hasErrorCode(error, 'EEXIST');
}

/**
 * @param {unknown} error - Candidate connection error.
 * @returns {boolean} - Whether a local endpoint cannot be reached.
 */
function isUnreachableEndpointError(error) {
  return (
    hasErrorCode(error, 'ECONNREFUSED') ||
    hasErrorCode(error, 'ENOENT') ||
    hasErrorCode(error, 'ECONNRESET') ||
    hasErrorCode(error, 'EPIPE')
  );
}

/**
 * @param {import('node:net').Server} server - Server to bind.
 * @param {string} endpoint - Exact local endpoint.
 * @returns {Promise<void>} - Resolves after bind succeeds.
 */
function listen(server, endpoint) {
  return new Promise((resolve, reject) => {
    /** @param {Error} error - Bind failure. */
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(endpoint);
  });
}

/**
 * @template T
 * @param {() => T | Promise<T>} operation - Host operation to await.
 * @param {number} timeoutMs - Finite wait bound.
 * @returns {Promise<{kind: 'value', value: T} | {kind: 'error', error: unknown} | {kind: 'timeout'}>} - Settled bounded result.
 */
async function settleWithin(operation, timeoutMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const work = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ kind: /** @type {const} */ ('value'), value }),
      (error) => ({ kind: /** @type {const} */ ('error'), error }),
    );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: /** @type {const} */ ('timeout') }),
      timeoutMs,
    );
  });
  const result = await Promise.race([work, timeout]);
  if (timer) clearTimeout(timer);
  if (result.kind === 'timeout') {
    // A timed-out host callback can settle after the caller has received a
    // timeout response. Consume that late rejection and rely on the durable
    // request ID, rather than treating timeout as proof of non-execution.
    work.then(
      () => {},
      () => {},
    );
  }
  return /** @type {any} */ (result);
}

/**
 * @param {import('node:net').Socket} socket - Open peer socket.
 * @param {Buffer} bytes - Exact response bytes.
 * @returns {void} - Starts the one response and closes the writable side.
 */
function endSocket(socket, bytes) {
  if (socket.destroyed || !socket.writable) return;
  try {
    socket.end(bytes);
  } catch {
    socket.destroy();
  }
}

/**
 * @param {import('node:net').Socket} socket - Open peer socket.
 * @param {{session: Readonly<{serviceId: string, sessionId: string, sessionRoot: string, endpoint: string, ownerCommandEndpoint: string}>, isCurrentOwner: (session: Readonly<Record<string, string>>) => boolean | Promise<boolean>, handleCommand: (request: Readonly<{requestId: string, command: string, request: Record<string, any>}>, session: Readonly<Record<string, string>>) => Record<string, any> | Promise<Record<string, any>>, timeoutMs: number, maxRequestBytes: number, maxResponseBytes: number, isClosed: () => boolean}} context - Server dependencies.
 * @returns {Promise<void>} - Resolves after one socket is handled.
 */
async function serveOneOwnerCommand(socket, context) {
  /** @type {Buffer[]} */
  const chunks = [];
  let byteLength = 0;
  let settled = false;
  let requestId = 'invalid';

  /**
   * @param {'ok'|'stale'|'auth'|'malformed'|'timeout'|'rejected'} status - Exact response status.
   * @param {Record<string, any> | undefined} [result] - Accepted handler result.
   * @returns {void} - Sends at most one response.
   */
  const respond = (status, result) => {
    if (settled) return;
    settled = true;
    try {
      endSocket(
        socket,
        encodeAuthenticatedResponse(
          requestId,
          status,
          result,
          context.session.sessionId,
          context.maxResponseBytes,
        ),
      );
    } catch {
      socket.destroy();
    }
  };

  socket.setTimeout(context.timeoutMs);
  socket.once('timeout', () => respond('timeout'));
  socket.once('error', () => {
    settled = true;
  });
  socket.on('data', (chunk) => {
    if (settled) return;
    byteLength += chunk.byteLength;
    if (byteLength > context.maxRequestBytes) {
      respond('malformed');
      return;
    }
    chunks.push(Buffer.from(chunk));
  });
  socket.once('end', () => {
    if (settled) return;
    socket.setTimeout(0);
    const bytes = Buffer.concat(chunks, byteLength);
    let command;
    try {
      command = decodeAuthenticatedRequest(bytes, context.session.sessionId);
      requestId = command.requestId;
    } catch (error) {
      if (
        error instanceof LocalOwnerCommandError &&
        typeof error.requestId === 'string'
      ) {
        requestId = error.requestId;
      }
      respond(
        error instanceof LocalOwnerCommandError && error.kind !== 'unreachable'
          ? error.kind
          : 'malformed',
      );
      return;
    }

    const dispatch = (async () => {
      if (context.isClosed()) {
        respond('stale');
        return;
      }
      const owner = await settleWithin(
        () => context.isCurrentOwner(context.session),
        context.timeoutMs,
      );
      if (
        owner.kind !== 'value' ||
        owner.value !== true ||
        context.isClosed()
      ) {
        respond(owner.kind === 'timeout' ? 'timeout' : 'stale');
        return;
      }
      const outcome = await settleWithin(
        () => context.handleCommand(command, context.session),
        context.timeoutMs,
      );
      if (outcome.kind === 'timeout') {
        respond('timeout');
        return;
      }
      if (outcome.kind === 'error') {
        respond('rejected');
        return;
      }
      const result = outcome.value;
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        respond('rejected');
        return;
      }
      respond('ok', result);
    })();
    dispatch.catch(() => respond('rejected'));
  });
}

/**
 * @param {{session: unknown, handleCommand: unknown, isCurrentOwner?: unknown, timeoutMs?: unknown, maxRequestBytes?: unknown, maxResponseBytes?: unknown}} options - Candidate server options.
 * @returns {{session: Readonly<{serviceId: string, sessionId: string, sessionRoot: string, endpoint: string, ownerCommandEndpoint: string}>, handleCommand: (request: Readonly<{requestId: string, command: string, request: Record<string, any>}>, session: Readonly<Record<string, string>>) => Record<string, any> | Promise<Record<string, any>>, isCurrentOwner: (session: Readonly<Record<string, string>>) => boolean | Promise<boolean>, timeoutMs: number, maxRequestBytes: number, maxResponseBytes: number}} - Normalized server options.
 */
function normalizeServerOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'local owner command server options must be an object.',
    );
  }
  const candidate = /** @type {Record<string, unknown>} */ (options);
  const supported = new Set([
    'session',
    'handleCommand',
    'isCurrentOwner',
    'timeoutMs',
    'maxRequestBytes',
    'maxResponseBytes',
  ]);
  for (const key of Object.keys(candidate)) {
    if (!supported.has(key)) {
      throw new TypeError(
        `local owner command server options.${key} is not supported.`,
      );
    }
  }
  if (typeof candidate.handleCommand !== 'function') {
    throw new TypeError(
      'local owner command server options.handleCommand must be a function.',
    );
  }
  if (
    candidate.isCurrentOwner !== undefined &&
    typeof candidate.isCurrentOwner !== 'function'
  ) {
    throw new TypeError(
      'local owner command server options.isCurrentOwner must be a function when provided.',
    );
  }
  const session = normalizeLiveSession(candidate.session);
  const durableOwnerFence =
    /** @type {((session: Readonly<Record<string, string>>) => boolean | Promise<boolean>) | undefined} */ (
      candidate.isCurrentOwner
    );
  /**
   * A caller-provided durable-generation check augments rather than replaces
   * the liveness endpoint proof. Otherwise a server left briefly bound during
   * teardown could accept a command after its acquired local session ended.
   * @param {Readonly<Record<string, string>>} owner - Exact acquired session metadata.
   * @returns {Promise<boolean>} - Whether both local and durable fences hold.
   */
  const isCurrentOwner = async (owner) => {
    const observed = await probeLocalServiceSession({
      serviceId: owner.serviceId,
      sessionId: owner.sessionId,
      sessionRoot: owner.sessionRoot,
    });
    if (observed.status !== 'active' || observed.endpoint !== owner.endpoint) {
      return false;
    }
    return durableOwnerFence ? (await durableOwnerFence(owner)) === true : true;
  };
  return {
    session,
    handleCommand:
      /** @type {(request: Readonly<{requestId: string, command: string, request: Record<string, any>}>, session: Readonly<Record<string, string>>) => Record<string, any> | Promise<Record<string, any>>} */ (
        candidate.handleCommand
      ),
    isCurrentOwner,
    timeoutMs: normalizeTimeout(
      candidate.timeoutMs,
      'local owner command server options.timeoutMs',
      LOCAL_OWNER_COMMAND_DEFAULT_TIMEOUT_MS,
    ),
    maxRequestBytes: normalizeByteLimit(
      candidate.maxRequestBytes,
      'local owner command server options.maxRequestBytes',
      LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES,
    ),
    maxResponseBytes: normalizeByteLimit(
      candidate.maxResponseBytes,
      'local owner command server options.maxResponseBytes',
      LOCAL_OWNER_COMMAND_MAX_RESPONSE_BYTES,
    ),
  };
}

/**
 * Named pipes do not yet have the same verified same-principal ACL contract
 * as the private POSIX socket directory. Refuse the owner command plane on
 * Windows rather than making the session ID MAC carry an OS-authorization
 * promise it cannot provide by itself.
 * @param {{endpoint?: string, requestId?: string}} [context] - Safe error context.
 * @returns {void} - Returns on supported local socket platforms.
 */
function assertOwnerCommandPlatform(context = {}) {
  if (process.platform === 'win32') {
    throw new LocalOwnerCommandError(
      'unreachable',
      'Local owner commands are unavailable on Windows until named-pipe access control is verified.',
      context,
    );
  }
}

/**
 * Start the distinct one-request authenticated command endpoint for one
 * acquired local service session. The liveness endpoint is neither modified
 * nor multiplexed. The server fails closed if the matching liveness session
 * cannot currently be proven active, and callers must close this companion
 * before releasing the local service session.
 *
 * The handler gets only the independently validated command envelope and
 * immutable session metadata. It never receives a socket or untrusted raw
 * bytes. `isCurrentOwner` is optional but should check the caller's durable
 * ownership generation in addition to the default local liveness fence.
 * @param {{session: unknown, handleCommand: (request: Readonly<{requestId: string, command: string, request: Record<string, any>}>, session: Readonly<Record<string, string>>) => Record<string, any> | Promise<Record<string, any>>, isCurrentOwner?: (session: Readonly<Record<string, string>>) => boolean | Promise<boolean>, timeoutMs?: number, maxRequestBytes?: number, maxResponseBytes?: number}} options - Server behavior.
 * @returns {Promise<Readonly<{endpoint: string, session: Readonly<{serviceId: string, sessionId: string, sessionRoot: string, endpoint: string, ownerCommandEndpoint: string}>, close: () => Promise<void>}>>} - Bound owner-command endpoint.
 */
export async function createLocalOwnerCommandServer(options) {
  assertOwnerCommandPlatform();
  const normalized = normalizeServerOptions(options);
  const observed = await probeLocalServiceSession({
    serviceId: normalized.session.serviceId,
    sessionId: normalized.session.sessionId,
    sessionRoot: normalized.session.sessionRoot,
  });
  if (
    observed.status !== 'active' ||
    observed.endpoint !== normalized.session.endpoint
  ) {
    throw new LocalOwnerCommandError(
      'stale',
      'Cannot start a local owner command endpoint for an inactive session.',
      { endpoint: normalized.session.ownerCommandEndpoint },
    );
  }

  /** @type {Set<import('node:net').Socket>} */
  const sockets = new Set();
  let closed = false;
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    serveOneOwnerCommand(socket, {
      ...normalized,
      isClosed: () => closed,
    }).catch(() => socket.destroy());
  });
  server.on('error', () => {
    // The bind listener below owns startup failures. After a successful bind,
    // individual command sockets are already bounded and classified locally.
  });

  try {
    await listen(server, normalized.session.ownerCommandEndpoint);
  } catch (cause) {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    throw new LocalOwnerCommandError(
      isAddressInUse(cause) ? 'stale' : 'unreachable',
      'Could not bind the local owner command endpoint without replacing it.',
      { cause, endpoint: normalized.session.ownerCommandEndpoint },
    );
  }

  /** @type {Promise<void> | undefined} */
  let closePromise;
  const close = () => {
    if (!closePromise) {
      closed = true;
      for (const socket of sockets) socket.destroy();
      closePromise = new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    return closePromise;
  };
  return Object.freeze({
    endpoint: normalized.session.ownerCommandEndpoint,
    session: normalized.session,
    close,
  });
}

/**
 * @param {{serviceId: unknown, sessionId: unknown, sessionRoot?: unknown, requestId: unknown, command: unknown, request: unknown, timeoutMs?: unknown, maxResponseBytes?: unknown}} options - Candidate client options.
 * @returns {{serviceId: string, sessionId: string, sessionRoot?: string, requestId: string, command: string, request: Record<string, any>, timeoutMs: number, maxResponseBytes: number, endpoint: string, bytes: Buffer}} - Normalized client request.
 */
function normalizeClientOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('local owner command options must be an object.');
  }
  const candidate = /** @type {Record<string, unknown>} */ (options);
  const supported = new Set([
    'serviceId',
    'sessionId',
    'sessionRoot',
    'requestId',
    'command',
    'request',
    'timeoutMs',
    'maxResponseBytes',
  ]);
  for (const key of Object.keys(candidate)) {
    if (!supported.has(key)) {
      throw new TypeError(
        `local owner command options.${key} is not supported.`,
      );
    }
  }
  const identity = {
    serviceId: /** @type {string} */ (candidate.serviceId),
    sessionId: /** @type {string} */ (candidate.sessionId),
    ...(candidate.sessionRoot === undefined
      ? {}
      : { sessionRoot: /** @type {string} */ (candidate.sessionRoot) }),
  };
  const endpoint = getLocalServiceSessionOwnerCommandEndpoint(identity);
  const requestId = assertLedgerOpaqueId(
    candidate.requestId,
    'local owner command options.requestId',
  );
  const command = normalizeCommand(
    candidate.command,
    'local owner command options.command',
  );
  if (
    !candidate.request ||
    typeof candidate.request !== 'object' ||
    Array.isArray(candidate.request)
  ) {
    throw new TypeError(
      'local owner command options.request must be an object.',
    );
  }
  const request = /** @type {Record<string, any>} */ (candidate.request);
  const unsigned = {
    version: LOCAL_OWNER_COMMAND_PROTOCOL_VERSION,
    requestId,
    command,
    request,
  };
  const mac = signEnvelope(identity.sessionId, REQUEST_MAC_DOMAIN, unsigned);
  const bytes = encodeCanonicalJsonPayload(
    { ...unsigned, mac },
    'local owner command request',
  );
  if (bytes.byteLength > LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES) {
    throw new RangeError(
      `local owner command request exceeds the ${LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES}-byte limit.`,
    );
  }
  return {
    serviceId: /** @type {string} */ (identity.serviceId),
    sessionId: /** @type {string} */ (identity.sessionId),
    ...(typeof identity.sessionRoot === 'string'
      ? { sessionRoot: identity.sessionRoot }
      : {}),
    requestId,
    command,
    request,
    timeoutMs: normalizeTimeout(
      candidate.timeoutMs,
      'local owner command options.timeoutMs',
      LOCAL_OWNER_COMMAND_DEFAULT_TIMEOUT_MS,
    ),
    maxResponseBytes: normalizeByteLimit(
      candidate.maxResponseBytes,
      'local owner command options.maxResponseBytes',
      LOCAL_OWNER_COMMAND_MAX_RESPONSE_BYTES,
    ),
    endpoint,
    bytes,
  };
}

/**
 * @param {{endpoint: string, bytes: Buffer, timeoutMs: number, maxResponseBytes: number, requestId: string}} options - Exact local exchange inputs.
 * @returns {Promise<Buffer>} - Exact bounded response bytes.
 */
function exchangeLocalOwnerCommand(options) {
  return new Promise((resolve, reject) => {
    /** @type {import('node:net').Socket | undefined} */
    let socket;
    /** @type {Buffer[]} */
    const chunks = [];
    let byteLength = 0;
    let settled = false;
    /** @param {Buffer} bytes - Received exact response bytes. */
    const finish = (bytes) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(bytes);
    };
    /** @param {LocalOwnerCommandError} error - Classified exchange failure. */
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      reject(error);
    };

    try {
      socket = net.createConnection(options.endpoint);
      socket.once('connect', () => {
        try {
          socket?.end(options.bytes);
        } catch (cause) {
          fail(
            new LocalOwnerCommandError(
              'unreachable',
              'Could not write to the local owner command endpoint.',
              {
                cause,
                endpoint: options.endpoint,
                requestId: options.requestId,
              },
            ),
          );
        }
      });
      socket.on('data', (chunk) => {
        if (settled) return;
        byteLength += chunk.byteLength;
        if (byteLength > options.maxResponseBytes) {
          fail(
            new LocalOwnerCommandError(
              'malformed',
              'The local owner command response exceeded its byte limit.',
              { endpoint: options.endpoint, requestId: options.requestId },
            ),
          );
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      socket.once('end', () => {
        if (settled) return;
        if (byteLength === 0) {
          fail(
            new LocalOwnerCommandError(
              'unreachable',
              'The local owner command endpoint closed without a response.',
              { endpoint: options.endpoint, requestId: options.requestId },
            ),
          );
          return;
        }
        finish(Buffer.concat(chunks, byteLength));
      });
      socket.once('timeout', () => {
        fail(
          new LocalOwnerCommandError(
            'timeout',
            `Timed out after ${options.timeoutMs}ms waiting for the local owner command endpoint.`,
            { endpoint: options.endpoint, requestId: options.requestId },
          ),
        );
      });
      socket.once('error', (cause) => {
        fail(
          new LocalOwnerCommandError(
            'unreachable',
            isUnreachableEndpointError(cause)
              ? 'The local owner command endpoint is unreachable.'
              : 'The local owner command endpoint failed.',
            { cause, endpoint: options.endpoint, requestId: options.requestId },
          ),
        );
      });
      socket.setTimeout(options.timeoutMs);
    } catch (cause) {
      fail(
        new LocalOwnerCommandError(
          'unreachable',
          'Could not open the local owner command endpoint.',
          { cause, endpoint: options.endpoint, requestId: options.requestId },
        ),
      );
    }
  });
}

/**
 * Send one authenticated bounded command to the exact current local owner.
 * The caller is responsible for reading durable ownership first and rejecting
 * a different local scope/principal/session before it invokes this transport.
 * A timeout is intentionally not a negative acknowledgement: reconcile the
 * retained request ID against durable state before retrying or reporting it.
 * @param {{serviceId: string, sessionId: string, sessionRoot?: string, requestId: string, command: string, request: Record<string, any>, timeoutMs?: number, maxResponseBytes?: number}} options - Exact command request.
 * @returns {Promise<Record<string, any>>} - Authenticated bounded handler result.
 */
export async function sendLocalOwnerCommand(options) {
  const normalized = normalizeClientOptions(options);
  assertOwnerCommandPlatform({
    endpoint: normalized.endpoint,
    requestId: normalized.requestId,
  });
  const bytes = await exchangeLocalOwnerCommand(normalized);
  return decodeAuthenticatedResponse(bytes, {
    sessionId: normalized.sessionId,
    requestId: normalized.requestId,
  });
}

export default {
  LOCAL_OWNER_COMMAND_DEFAULT_TIMEOUT_MS,
  LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES,
  LOCAL_OWNER_COMMAND_MAX_RESPONSE_BYTES,
  LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS,
  LOCAL_OWNER_COMMAND_PROTOCOL_VERSION,
  LocalOwnerCommandError,
  createLocalOwnerCommandServer,
  sendLocalOwnerCommand,
};
