import http from 'node:http';

const IMDS_HOST = '169.254.169.254';
const IMDS_PORT = 80;
const IMDS_TOKEN_PATH = '/latest/api/token';
const IMDS_ROLE_PATH = '/latest/meta-data/iam/security-credentials/';
const IMDS_TOKEN_TTL_SECONDS = '21600';
const REQUEST_TIMEOUT_MILLISECONDS = 1000;
const REFRESH_WINDOW_MILLISECONDS = 5 * 60 * 1000;
const MAX_RESPONSE_HEADER_BYTES = 8 * 1024;
const MAX_TOKEN_BYTES = 1024;
const MAX_ROLE_NAME_BYTES = 256;
const MAX_CREDENTIAL_DOCUMENT_BYTES = 16 * 1024;
const MAX_ACCESS_KEY_ID_BYTES = 128;
const MAX_SECRET_ACCESS_KEY_BYTES = 256;
const MAX_SESSION_TOKEN_BYTES = 8 * 1024;

const REQUIRED_CREDENTIAL_DOCUMENT_KEYS = new Set([
  'Code',
  'LastUpdated',
  'Type',
  'AccessKeyId',
  'SecretAccessKey',
  'Token',
  'Expiration',
]);
const SUPPORTED_CREDENTIAL_DOCUMENT_KEYS = new Set([
  ...REQUIRED_CREDENTIAL_DOCUMENT_KEYS,
  'AccountId',
]);
const IAM_ROLE_NAME_PATTERN = /^[A-Za-z0-9+=,.@_-]{1,64}$/;
const ACCESS_KEY_ID_PATTERN = /^[A-Z0-9]+$/;
const VISIBLE_ASCII_PATTERN = /^[\x21-\x7e]+$/;
const ISO_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const RETRIEVAL_ERROR =
  'AWS single-node host instance credentials are unavailable.';
const CLOSED_ERROR =
  'AWS single-node host instance credential source is closed.';
const CLOSE_ERROR =
  'AWS single-node host instance credential source could not close cleanly.';
const INVALID_OPEN_ERROR =
  'AWS single-node host instance credential source does not accept options.';

/** An IMDSv2 refresh did not produce one valid instance-role credential set. */
export class AwsSingleNodeHostInstanceCredentialRetrievalError extends Error {
  constructor() {
    super(RETRIEVAL_ERROR);
    this.name = 'AwsSingleNodeHostInstanceCredentialRetrievalError';
    this.code = 'AWS_SINGLE_NODE_HOST_INSTANCE_CREDENTIAL_RETRIEVAL_FAILED';
  }
}

/** The owned credential provider was called after close began. */
export class AwsSingleNodeHostInstanceCredentialSourceClosedError extends Error {
  constructor() {
    super(CLOSED_ERROR);
    this.name = 'AwsSingleNodeHostInstanceCredentialSourceClosedError';
    this.code = 'AWS_SINGLE_NODE_HOST_INSTANCE_CREDENTIAL_SOURCE_CLOSED';
  }
}

/** At least one owned transport could not be destroyed during close. */
export class AwsSingleNodeHostInstanceCredentialSourceCloseError extends Error {
  constructor() {
    super(CLOSE_ERROR);
    this.name = 'AwsSingleNodeHostInstanceCredentialSourceCloseError';
    this.code = 'AWS_SINGLE_NODE_HOST_INSTANCE_CREDENTIAL_SOURCE_CLOSE_FAILED';
  }
}

/**
 * @param {unknown} error - Raw internal failure.
 * @returns {Error} - Fixed public failure.
 */
function normalizeRetrievalError(error) {
  if (error instanceof AwsSingleNodeHostInstanceCredentialSourceClosedError) {
    return error;
  }
  if (error instanceof AwsSingleNodeHostInstanceCredentialRetrievalError) {
    return error;
  }
  return new AwsSingleNodeHostInstanceCredentialRetrievalError();
}

/**
 * Destroy one transport without allowing its error to replace a fixed public
 * boundary error.
 * @param {unknown} value - Candidate destroyable transport.
 * @returns {boolean} - Whether destruction threw.
 */
function destroyTransport(value) {
  try {
    if (
      value === null ||
      typeof value !== 'object' ||
      typeof (/** @type {{destroy?: unknown}} */ (value).destroy) !== 'function'
    ) {
      return false;
    }
    Reflect.apply(
      /** @type {{destroy: Function}} */ (value).destroy,
      value,
      [],
    );
    return false;
  } catch {
    return true;
  }
}

/**
 * @param {unknown} value - Candidate parsed value.
 * @returns {value is Record<string, unknown>} - Whether it is a plain object.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Accept only the documented IMDS instance-role credential document surface.
 * @param {string} body - Bounded UTF-8 JSON response body.
 * @param {number} now - Validation time in epoch milliseconds.
 * @returns {{credentials: Readonly<{accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: Date}>, expirationMilliseconds: number}} - Narrow credentials and immutable cache expiry.
 */
function decodeCredentialDocument(body, now) {
  /** @type {unknown} */
  let decoded;
  try {
    decoded = JSON.parse(body);
  } catch {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }
  if (!isPlainObject(decoded)) {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }
  const keys = Reflect.ownKeys(decoded);
  if (
    keys.length < REQUIRED_CREDENTIAL_DOCUMENT_KEYS.size ||
    keys.length > SUPPORTED_CREDENTIAL_DOCUMENT_KEYS.size ||
    keys.some(
      (key) =>
        typeof key !== 'string' || !SUPPORTED_CREDENTIAL_DOCUMENT_KEYS.has(key),
    )
  ) {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }
  for (const key of REQUIRED_CREDENTIAL_DOCUMENT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(decoded, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string'
    ) {
      throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
    }
  }
  if (Object.hasOwn(decoded, 'AccountId')) {
    const accountIdDescriptor = Object.getOwnPropertyDescriptor(
      decoded,
      'AccountId',
    );
    if (
      accountIdDescriptor === undefined ||
      !accountIdDescriptor.enumerable ||
      !Object.hasOwn(accountIdDescriptor, 'value') ||
      typeof accountIdDescriptor.value !== 'string' ||
      !/^\d{12}$/.test(accountIdDescriptor.value)
    ) {
      throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
    }
  }

  const document = /** @type {Record<string, string>} */ (decoded);
  if (document.Code !== 'Success' || document.Type !== 'AWS-HMAC') {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }
  if (
    !ISO_UTC_TIMESTAMP_PATTERN.test(document.LastUpdated) ||
    !Number.isFinite(Date.parse(document.LastUpdated))
  ) {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }
  if (
    !ACCESS_KEY_ID_PATTERN.test(document.AccessKeyId) ||
    Buffer.byteLength(document.AccessKeyId) < 16 ||
    Buffer.byteLength(document.AccessKeyId) > MAX_ACCESS_KEY_ID_BYTES
  ) {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }
  if (
    !VISIBLE_ASCII_PATTERN.test(document.SecretAccessKey) ||
    Buffer.byteLength(document.SecretAccessKey) > MAX_SECRET_ACCESS_KEY_BYTES
  ) {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }
  if (
    !VISIBLE_ASCII_PATTERN.test(document.Token) ||
    Buffer.byteLength(document.Token) > MAX_SESSION_TOKEN_BYTES
  ) {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }
  if (!ISO_UTC_TIMESTAMP_PATTERN.test(document.Expiration)) {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }
  const expirationMilliseconds = Date.parse(document.Expiration);
  if (
    !Number.isFinite(expirationMilliseconds) ||
    expirationMilliseconds <= now
  ) {
    throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
  }

  const expiration = Object.freeze(new Date(expirationMilliseconds));
  return {
    expirationMilliseconds,
    credentials: Object.freeze({
      accessKeyId: document.AccessKeyId,
      secretAccessKey: document.SecretAccessKey,
      sessionToken: document.Token,
      expiration,
    }),
  };
}

/**
 * Open one process-owned IMDSv2 credential source for a single-node host.
 *
 * The source deliberately has no options: its IPv4 destination, port,
 * protocol, token policy, timeouts, response limits, and refresh policy are
 * code-owned. It never consults ambient AWS configuration or a default
 * credential chain.
 * @returns {Readonly<{credentials: () => Promise<Readonly<{accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: Date}>>, close: () => Promise<void>}>} - Exact owned source.
 */
export function openAwsSingleNodeHostInstanceCredentialSource() {
  if (arguments.length !== 0) {
    throw new TypeError(INVALID_OPEN_ERROR);
  }
  /** @type {Set<import('node:http').ClientRequest>} */
  const activeRequests = new Set();
  /** @type {Map<import('node:http').ClientRequest, () => boolean>} */
  const cancelRequests = new Map();

  let closing = false;
  /** @type {Readonly<{accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: Date}>|undefined} */
  let cachedCredentials;
  /** @type {number|undefined} */
  let cachedExpirationMilliseconds;
  /** @type {Promise<Readonly<{accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: Date}>>|undefined} */
  let refreshPromise;
  /** @type {Promise<void>|undefined} */
  let closePromise;

  /** @returns {void} */
  function assertOpen() {
    if (closing) {
      throw new AwsSingleNodeHostInstanceCredentialSourceClosedError();
    }
  }

  /**
   * Perform one fixed-destination, connection-closing IMDS request.
   * @param {'GET'|'PUT'} method - Fixed HTTP method.
   * @param {string} path - Fixed IMDS path.
   * @param {Readonly<Record<string, string>>} headers - Request-specific headers.
   * @param {number} maximumBytes - Maximum accepted response bytes.
   * @returns {Promise<string>} - Bounded UTF-8 response body.
   */
  function requestText(method, path, headers, maximumBytes) {
    assertOpen();
    return new Promise((resolve, reject) => {
      /** @type {import('node:http').ClientRequest|undefined} */
      let request;
      /** @type {import('node:http').IncomingMessage|undefined} */
      let response;
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let deadline;
      /** @type {Buffer[]} */
      const chunks = [];
      let receivedBytes = 0;
      let settled = false;

      /** @returns {void} */
      function release() {
        if (deadline !== undefined) {
          clearTimeout(deadline);
          deadline = undefined;
        }
        if (request !== undefined) {
          activeRequests.delete(request);
          cancelRequests.delete(request);
        }
        chunks.length = 0;
      }

      /** @param {Error} error @returns {void} */
      function fail(error) {
        if (settled) return;
        settled = true;
        release();
        reject(error);
      }

      /** @param {string} body @returns {void} */
      function succeed(body) {
        if (settled) return;
        settled = true;
        release();
        resolve(body);
      }

      /**
       * Reject first so even a broken destroy implementation cannot strand
       * the active refresh.
       * @param {Error} error - Fixed public error.
       * @returns {boolean} - Whether destruction threw.
       */
      function failAndDestroy(error) {
        if (settled) return false;
        fail(error);
        const responseDestroyFailed = destroyTransport(response);
        const requestDestroyFailed = destroyTransport(request);
        return responseDestroyFailed || requestDestroyFailed;
      }

      /** @param {import('node:http').IncomingMessage} incoming @returns {void} */
      function receiveResponse(incoming) {
        if (settled) {
          destroyTransport(incoming);
          return;
        }
        response = incoming;
        if (incoming.statusCode !== 200) {
          failAndDestroy(
            new AwsSingleNodeHostInstanceCredentialRetrievalError(),
          );
          return;
        }
        incoming.on('data', (chunk) => {
          if (settled) return;
          try {
            const bytes = Buffer.from(chunk);
            receivedBytes += bytes.length;
            if (receivedBytes > maximumBytes) {
              failAndDestroy(
                new AwsSingleNodeHostInstanceCredentialRetrievalError(),
              );
              return;
            }
            chunks.push(bytes);
          } catch {
            failAndDestroy(
              new AwsSingleNodeHostInstanceCredentialRetrievalError(),
            );
          }
        });
        incoming.once('aborted', () => {
          failAndDestroy(
            new AwsSingleNodeHostInstanceCredentialRetrievalError(),
          );
        });
        incoming.once('error', () => {
          failAndDestroy(
            new AwsSingleNodeHostInstanceCredentialRetrievalError(),
          );
        });
        incoming.once('end', () => {
          if (settled) return;
          if (receivedBytes === 0) {
            failAndDestroy(
              new AwsSingleNodeHostInstanceCredentialRetrievalError(),
            );
            return;
          }
          try {
            succeed(Buffer.concat(chunks, receivedBytes).toString('utf8'));
          } catch {
            failAndDestroy(
              new AwsSingleNodeHostInstanceCredentialRetrievalError(),
            );
          }
        });
      }

      try {
        request = http.request(
          Object.freeze({
            hostname: IMDS_HOST,
            port: IMDS_PORT,
            family: 4,
            method,
            path,
            agent: false,
            maxHeaderSize: MAX_RESPONSE_HEADER_BYTES,
            headers: Object.freeze({
              connection: 'close',
              ...headers,
            }),
          }),
          receiveResponse,
        );
        activeRequests.add(request);
        cancelRequests.set(request, () =>
          failAndDestroy(
            new AwsSingleNodeHostInstanceCredentialSourceClosedError(),
          ),
        );
        request.once('error', () => {
          failAndDestroy(
            new AwsSingleNodeHostInstanceCredentialRetrievalError(),
          );
        });
        deadline = setTimeout(() => {
          failAndDestroy(
            new AwsSingleNodeHostInstanceCredentialRetrievalError(),
          );
        }, REQUEST_TIMEOUT_MILLISECONDS);
        request.setTimeout(REQUEST_TIMEOUT_MILLISECONDS, () => {
          failAndDestroy(
            new AwsSingleNodeHostInstanceCredentialRetrievalError(),
          );
        });
        request.end();
      } catch {
        failAndDestroy(new AwsSingleNodeHostInstanceCredentialRetrievalError());
      }
    });
  }

  /**
   * Perform a complete token-authenticated IMDSv2 refresh.
   * @returns {Promise<{credentials: Readonly<{accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: Date}>, expirationMilliseconds: number}>} - Fresh validated credential state.
   */
  async function refresh() {
    const token = await requestText(
      'PUT',
      IMDS_TOKEN_PATH,
      Object.freeze({
        'x-aws-ec2-metadata-token-ttl-seconds': IMDS_TOKEN_TTL_SECONDS,
      }),
      MAX_TOKEN_BYTES,
    );
    if (
      !VISIBLE_ASCII_PATTERN.test(token) ||
      Buffer.byteLength(token) > MAX_TOKEN_BYTES
    ) {
      throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
    }

    const rawRoleName = await requestText(
      'GET',
      IMDS_ROLE_PATH,
      Object.freeze({
        'x-aws-ec2-metadata-token': token,
      }),
      MAX_ROLE_NAME_BYTES,
    );
    const roleName = rawRoleName.trim();
    if (!IAM_ROLE_NAME_PATTERN.test(roleName)) {
      throw new AwsSingleNodeHostInstanceCredentialRetrievalError();
    }

    const document = await requestText(
      'GET',
      `${IMDS_ROLE_PATH}${roleName}`,
      Object.freeze({
        'x-aws-ec2-metadata-token': token,
      }),
      MAX_CREDENTIAL_DOCUMENT_BYTES,
    );
    return decodeCredentialDocument(document, Date.now());
  }

  /**
   * Resolve cached credentials or coalesce one refresh.
   * @returns {Promise<Readonly<{accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: Date}>>} - Current credential set.
   */
  function credentials() {
    assertOpen();
    const now = Date.now();
    if (
      cachedCredentials !== undefined &&
      cachedExpirationMilliseconds !== undefined &&
      cachedExpirationMilliseconds - now > REFRESH_WINDOW_MILLISECONDS
    ) {
      return Promise.resolve(cachedCredentials);
    }
    if (
      cachedExpirationMilliseconds !== undefined &&
      cachedExpirationMilliseconds <= now
    ) {
      cachedCredentials = undefined;
      cachedExpirationMilliseconds = undefined;
    }
    if (refreshPromise === undefined) {
      const pending = refresh()
        .catch((error) => {
          if (
            !closing &&
            cachedCredentials !== undefined &&
            cachedExpirationMilliseconds !== undefined &&
            cachedExpirationMilliseconds > Date.now()
          ) {
            return {
              credentials: cachedCredentials,
              expirationMilliseconds: cachedExpirationMilliseconds,
            };
          }
          throw normalizeRetrievalError(error);
        })
        .then((result) => {
          assertOpen();
          cachedCredentials = result.credentials;
          cachedExpirationMilliseconds = result.expirationMilliseconds;
          return result.credentials;
        });
      refreshPromise = pending.finally(() => {
        refreshPromise = undefined;
      });
    }
    return refreshPromise;
  }

  /** @returns {Promise<void>} */
  function close() {
    if (closePromise === undefined) {
      closing = true;
      cachedCredentials = undefined;
      cachedExpirationMilliseconds = undefined;
      const draining = refreshPromise;
      let destroyFailed = false;
      for (const cancel of [...cancelRequests.values()]) {
        try {
          if (cancel()) destroyFailed = true;
        } catch {
          destroyFailed = true;
        }
      }
      closePromise = Promise.resolve(draining)
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => {
          cachedCredentials = undefined;
          cachedExpirationMilliseconds = undefined;
          if (destroyFailed) {
            throw new AwsSingleNodeHostInstanceCredentialSourceCloseError();
          }
        });
    }
    return closePromise;
  }

  Object.freeze(credentials);
  Object.freeze(close);
  return Object.freeze({ credentials, close });
}

export default {
  AwsSingleNodeHostInstanceCredentialRetrievalError,
  AwsSingleNodeHostInstanceCredentialSourceCloseError,
  AwsSingleNodeHostInstanceCredentialSourceClosedError,
  openAwsSingleNodeHostInstanceCredentialSource,
};
