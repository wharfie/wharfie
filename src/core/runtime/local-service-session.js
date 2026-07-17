import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import net from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';

const SESSION_ENDPOINT_HASH_LENGTH = 24;
const LOCAL_ENDPOINT_PROBE_TIMEOUT_MS = 250;
const LOCAL_SOCKET_DIRECTORY_PREFIX = 'wharfie-';
const LOCAL_SOCKET_FILENAME_PREFIX = 's-';
const LOCAL_SOCKET_FILENAME_SUFFIX = '.sock';
const LOCAL_SESSION_SCOPE_HASH_LENGTH = 48;
const LOCAL_SESSION_PRINCIPAL_HASH_LENGTH = 48;

/**
 * Raised when another live process already owns the deterministic local
 * endpoint for one exact service session. This is intentionally distinct so
 * a CLI can report a normal "already running" condition without treating it
 * as a corrupt durable-control failure.
 */
export class LocalServiceSessionActiveError extends Error {
  /**
   * @param {string} serviceId - Stable service identity.
   * @param {string} sessionId - Opaque endpoint key for this service session.
   * @param {string} endpoint - Process-held local endpoint.
   */
  constructor(serviceId, sessionId, endpoint) {
    super(
      `Local service session is already active for ${serviceId}/${sessionId}.`,
    );
    this.name = 'LocalServiceSessionActiveError';
    this.code = 'local-service-session-active';
    this.serviceId = serviceId;
    this.sessionId = sessionId;
    this.endpoint = endpoint;
  }
}

/**
 * Raised when an occupied endpoint cannot be proven to belong to a live
 * session. Failing closed deliberately leaves stale sockets, regular files,
 * symlinks, and other filesystem objects untouched.
 */
export class LocalServiceSessionEndpointError extends Error {
  /**
   * @param {string} message - Safe operator-facing diagnostic.
   * @param {string} endpoint - Process-held local endpoint.
   * @param {{cause?: unknown}} [options] - Optional local error cause.
   */
  constructor(message, endpoint, options = {}) {
    super(message);
    this.name = 'LocalServiceSessionEndpointError';
    this.code = 'local-service-session-endpoint';
    this.endpoint = endpoint;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * @param {unknown} value - Candidate service identity.
 * @returns {string} - Exact stable service identity.
 */
function normalizeServiceId(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('\0')
  ) {
    throw new TypeError(
      'Local service session serviceId must be a nonempty canonical string without NUL characters.',
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate opaque session endpoint key.
 * @returns {string} - Exact stable session endpoint key.
 */
function normalizeSessionId(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('\0')
  ) {
    throw new TypeError(
      'Local service session sessionId must be a nonempty canonical string without NUL characters.',
    );
  }
  return value;
}

/**
 * Normalize a logical local-session namespace. This namespace is not the
 * Unix socket's physical parent: deriving the physical path from a short
 * per-user /tmp directory keeps long control paths below OS socket limits.
 * @param {unknown} value - Candidate logical namespace.
 * @returns {string} - Absolute logical namespace path.
 */
function normalizeSessionRoot(value) {
  const candidate =
    value === undefined ? join(tmpdir(), 'wharfie-service-sessions') : value;
  if (
    typeof candidate !== 'string' ||
    candidate.length === 0 ||
    candidate.trim() !== candidate ||
    candidate.includes('\0')
  ) {
    throw new TypeError(
      'Local service session sessionRoot must be a nonempty canonical path string without NUL characters.',
    );
  }
  return resolve(candidate);
}

/**
 * @param {unknown} value - Candidate platform spelling.
 * @returns {string} - Platform spelling.
 */
function normalizePlatform(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new TypeError(
      'Local service session platform must be a nonempty canonical string.',
    );
  }
  return value;
}

/**
 * @param {unknown} options - Candidate endpoint options.
 * @returns {{serviceId: string, sessionId: string, sessionRoot: string, platform: string}} - Normalized options.
 */
function normalizeEndpointOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Local service session options must be an object.');
  }
  const candidate = /** @type {Record<string, unknown>} */ (options);
  const allowed = new Set([
    'serviceId',
    'sessionId',
    'sessionRoot',
    'platform',
  ]);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `Local service session options.${key} is not supported.`,
      );
    }
  }
  if (
    !Object.prototype.hasOwnProperty.call(candidate, 'serviceId') ||
    !Object.prototype.hasOwnProperty.call(candidate, 'sessionId')
  ) {
    throw new TypeError(
      'Local service session options.serviceId and options.sessionId are required.',
    );
  }

  return {
    serviceId: normalizeServiceId(candidate.serviceId),
    sessionId: normalizeSessionId(candidate.sessionId),
    sessionRoot: normalizeSessionRoot(candidate.sessionRoot),
    platform: normalizePlatform(candidate.platform ?? process.platform),
  };
}

/**
 * @param {unknown} options - Candidate acquire/probe options.
 * @returns {{serviceId: string, sessionId: string, sessionRoot: string}} - Normalized session identity.
 */
function normalizeServiceSessionOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Local service session options must be an object.');
  }
  const candidate = /** @type {Record<string, unknown>} */ (options);
  const allowed = new Set(['serviceId', 'sessionId', 'sessionRoot']);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `Local service session options.${key} is not supported.`,
      );
    }
  }
  if (
    !Object.prototype.hasOwnProperty.call(candidate, 'serviceId') ||
    !Object.prototype.hasOwnProperty.call(candidate, 'sessionId')
  ) {
    throw new TypeError(
      'Local service session options.serviceId and options.sessionId are required.',
    );
  }
  return {
    serviceId: normalizeServiceId(candidate.serviceId),
    sessionId: normalizeSessionId(candidate.sessionId),
    sessionRoot: normalizeSessionRoot(candidate.sessionRoot),
  };
}

/**
 * @param {unknown} options - Candidate logical-scope options.
 * @returns {string} - Normalized logical session namespace.
 */
function normalizeScopeOptions(options) {
  if (options === undefined) return normalizeSessionRoot(undefined);
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Local service session scope options must be an object.',
    );
  }
  const candidate = /** @type {Record<string, unknown>} */ (options);
  for (const key of Object.keys(candidate)) {
    if (key !== 'sessionRoot') {
      throw new TypeError(
        `Local service session scope options.${key} is not supported.`,
      );
    }
  }
  return normalizeSessionRoot(candidate.sessionRoot);
}

/**
 * @param {string} domain - Controlled semantic hashing domain.
 * @param {string} value - Exact local identity input.
 * @returns {string} - Lowercase SHA-256 digest.
 */
function createScopedSha256Hex(domain, value) {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

/**
 * Return the stable local execution scope for a logical session namespace.
 * The raw path never crosses this API boundary, so durable ownership records
 * can reject a different local namespace without exposing an operator's
 * filesystem layout.
 * @param {{sessionRoot?: string}} [options] - Logical session namespace.
 * @returns {string} - Canonical logical ownership scope identifier.
 */
export function getLocalServiceSessionScopeId(options) {
  const sessionRoot = normalizeScopeOptions(options);
  return `scope-${createScopedSha256Hex(
    'wharfie:local-service-session-scope:v1',
    sessionRoot,
  ).slice(0, LOCAL_SESSION_SCOPE_HASH_LENGTH)}`;
}

/**
 * Return the stable current operating-system principal identifier used to
 * partition local endpoint names and durable local ownership records. POSIX
 * UIDs are already canonical identifiers. Other platforms use a
 * domain-separated hash of the OS username so records do not expose it.
 * @returns {string} - Canonical logical ownership principal identifier.
 */
export function getLocalServiceSessionPrincipalId() {
  if (typeof process.getuid === 'function') {
    return `uid-${String(process.getuid())}`;
  }

  /** @type {string | undefined} */
  let username;
  try {
    username = userInfo().username;
  } catch {
    username = process.env.USERNAME || process.env.USER;
  }
  if (typeof username !== 'string' || username.length === 0) {
    throw new LocalServiceSessionEndpointError(
      'Could not determine the current local service session principal.',
      'local-principal',
    );
  }
  return `user-${createScopedSha256Hex(
    'wharfie:local-service-session-principal:v1',
    username,
  ).slice(0, LOCAL_SESSION_PRINCIPAL_HASH_LENGTH)}`;
}

/**
 * @param {string} serviceId - Stable service identity.
 * @param {string} sessionId - Opaque endpoint key for this service session.
 * @param {string} sessionRoot - Logical session namespace.
 * @param {string} principalId - Current local OS principal identity.
 * @returns {string} - Short collision-resistant endpoint token.
 */
function createEndpointToken(serviceId, sessionId, sessionRoot, principalId) {
  return createHash('sha256')
    .update('wharfie:local-service-session:v3', 'utf8')
    .update('\0', 'utf8')
    .update(sessionRoot, 'utf8')
    .update('\0', 'utf8')
    .update(serviceId, 'utf8')
    .update('\0', 'utf8')
    .update(sessionId, 'utf8')
    .update('\0', 'utf8')
    .update(principalId, 'utf8')
    .digest('hex')
    .slice(0, SESSION_ENDPOINT_HASH_LENGTH);
}

/**
 * @returns {string} - A short per-user physical directory under /tmp.
 */
function getUnixSocketDirectory() {
  const uid =
    typeof process.getuid === 'function' ? String(process.getuid()) : 'local';
  return join('/tmp', `${LOCAL_SOCKET_DIRECTORY_PREFIX}${uid}`);
}

/**
 * Derive the deterministic process-held endpoint for one exact service
 * session. On POSIX, the logical namespace is deliberately hashed into a
 * short per-user /tmp socket path rather than used as the socket parent,
 * because control paths can exceed Unix-domain socket limits. On Windows, the
 * same namespace and principal hashes partition the named-pipe endpoint. A
 * unique sessionId prevents a newly-created session from ever reusing an old
 * session's path.
 * @param {{serviceId: string, sessionId: string, sessionRoot?: string, platform?: string}} options - Endpoint inputs.
 * @returns {string} - Unix-domain socket path or Windows named-pipe path.
 */
export function getLocalServiceSessionEndpoint(options) {
  const { serviceId, sessionId, sessionRoot, platform } =
    normalizeEndpointOptions(options);
  const token = createEndpointToken(
    serviceId,
    sessionId,
    sessionRoot,
    getLocalServiceSessionPrincipalId(),
  );
  if (platform === 'win32') return `\\\\.\\pipe\\w-${token}`;
  return join(
    getUnixSocketDirectory(),
    `${LOCAL_SOCKET_FILENAME_PREFIX}${token}${LOCAL_SOCKET_FILENAME_SUFFIX}`,
  );
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
 * @param {unknown} error - Candidate system error.
 * @returns {boolean} - Whether binding found an occupied endpoint.
 */
function isAddressInUse(error) {
  return hasErrorCode(error, 'EADDRINUSE') || hasErrorCode(error, 'EEXIST');
}

/**
 * @param {unknown} error - Candidate local connect error.
 * @returns {boolean} - Whether no listener answered at the endpoint.
 */
function isDefinitelyAbsentLocalEndpoint(error) {
  return hasErrorCode(error, 'ECONNREFUSED') || hasErrorCode(error, 'ENOENT');
}

/**
 * @param {string} directory - Required private socket parent.
 * @returns {Promise<void>} - Resolves after the directory is safe to own.
 */
async function ensurePrivateUnixSocketDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await fsp.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new LocalServiceSessionEndpointError(
      'Local service session socket directory must be a real directory, not a link or other filesystem object.',
      directory,
    );
  }
  if ((stats.mode & 0o022) !== 0) {
    throw new LocalServiceSessionEndpointError(
      'Local service session socket directory must not be writable by group or other users.',
      directory,
    );
  }
  if (
    typeof process.getuid === 'function' &&
    typeof stats.uid === 'number' &&
    stats.uid !== process.getuid()
  ) {
    throw new LocalServiceSessionEndpointError(
      'Local service session socket directory must be owned by the current user.',
      directory,
    );
  }
}

/**
 * @param {import('node:net').Server} server - New local session server.
 * @param {string} endpoint - Endpoint to bind.
 * @returns {Promise<void>} - Resolves when the process owns the endpoint.
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
 * @param {import('node:net').Server} server - Server to close.
 * @returns {Promise<void>} - Resolves once the held endpoint is released.
 */
function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * @typedef {{kind: 'active'} | {kind: 'absent'} | {kind: 'unknown', error: unknown}} LocalEndpointProbe
 */

/**
 * Connect once to an occupied Unix socket or Windows named pipe. A successful
 * connect is enough to prove another live process owns it; deliberately no
 * application-level handshake is attempted because a parent process may be
 * synchronously spawning the child that will serve the rest of its lifecycle.
 * `ECONNREFUSED` and `ENOENT` mean absent; every other failure is unknown.
 * No probe result ever triggers path cleanup.
 * @param {string} endpoint - Candidate process-held endpoint.
 * @returns {Promise<LocalEndpointProbe>} - Conservative liveness classification.
 */
function probeLocalEndpoint(endpoint) {
  return new Promise((resolve) => {
    /** @type {import('node:net').Socket | undefined} */
    let socket;
    let settled = false;
    /** @param {LocalEndpointProbe} result - Final probe result. */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(result);
    };

    try {
      socket = net.createConnection(endpoint);
      socket.once('connect', () => finish({ kind: 'active' }));
      socket.once('error', (error) => {
        if (isDefinitelyAbsentLocalEndpoint(error)) {
          finish({ kind: 'absent' });
        } else {
          finish({ kind: 'unknown', error });
        }
      });
      socket.once('timeout', () => {
        finish({
          kind: 'unknown',
          error: new Error(
            'Timed out while probing an occupied local endpoint.',
          ),
        });
      });
      socket.setTimeout(LOCAL_ENDPOINT_PROBE_TIMEOUT_MS);
    } catch (error) {
      finish({ kind: 'unknown', error });
    }
  });
}

/**
 * Probe one exact local service session without binding, unlinking, or
 * otherwise changing the endpoint. This is suitable for a durable lifecycle
 * owner to decide whether an existing session is still locally live before it
 * attempts its own compare-and-set recovery transition.
 * @param {{serviceId: string, sessionId: string, sessionRoot?: string}} options - Exact session identity.
 * @returns {Promise<Readonly<{serviceId: string, sessionId: string, sessionRoot: string, endpoint: string, status: 'active'|'absent'|'unknown'}>>} - Safe local liveness observation.
 */
export async function probeLocalServiceSession(options) {
  const { serviceId, sessionId, sessionRoot } =
    normalizeServiceSessionOptions(options);
  const endpoint = getLocalServiceSessionEndpoint({
    serviceId,
    sessionId,
    sessionRoot,
    platform: process.platform,
  });
  const probe = await probeLocalEndpoint(endpoint);
  return Object.freeze({
    serviceId,
    sessionId,
    sessionRoot,
    endpoint,
    status: probe.kind,
  });
}

/**
 * @returns {import('node:net').Server} - A server that owns and drains probes.
 */
function createSessionServer() {
  const server = net.createServer((socket) => {
    // Ownership probes only need the TCP/Unix connect to succeed. Closing
    // immediately prevents a probe from delaying graceful session release.
    socket.destroy();
  });
  server.on('error', () => {
    // A bind failure is handled by the one-shot listener in listen(). Once
    // bound, no caller-owned request channel exists on this private socket.
  });
  return server;
}

/**
 * Acquire exclusive, process-held ownership of a deterministic local service
 * session. The held Unix socket (or Windows named pipe) is not a lease and
 * does not claim distributed coordinator leadership. `sessionId` is a unique,
 * durable-session endpoint key: an old path is never reused or deleted by a
 * newer recovery session.
 * @param {{serviceId: string, sessionId: string, sessionRoot?: string}} options - Exact session inputs.
 * @returns {Promise<Readonly<{serviceId: string, sessionId: string, sessionRoot: string, endpoint: string, release: () => Promise<void>}>>} - Acquired local session.
 */
export async function acquireLocalServiceSession(options) {
  const { serviceId, sessionId, sessionRoot } =
    normalizeServiceSessionOptions(options);
  const platform = process.platform;
  const endpoint = getLocalServiceSessionEndpoint({
    serviceId,
    sessionId,
    sessionRoot,
    platform,
  });

  if (platform !== 'win32') {
    await ensurePrivateUnixSocketDirectory(getUnixSocketDirectory());
  }

  const server = createSessionServer();
  try {
    await listen(server, endpoint);

    /** @type {Promise<void> | undefined} */
    let releasePromise;
    const release = () => {
      if (!releasePromise) releasePromise = closeServer(server);
      return releasePromise;
    };
    return Object.freeze({
      serviceId,
      sessionId,
      sessionRoot,
      endpoint,
      release,
    });
  } catch (error) {
    await closeServer(server);
    if (!isAddressInUse(error)) throw error;

    const probe = await probeLocalEndpoint(endpoint);
    if (probe.kind === 'active') {
      throw new LocalServiceSessionActiveError(serviceId, sessionId, endpoint);
    }
    throw new LocalServiceSessionEndpointError(
      'Could not acquire an occupied local service session endpoint without deleting it.',
      endpoint,
      { cause: probe.kind === 'unknown' ? probe.error : error },
    );
  }
}
