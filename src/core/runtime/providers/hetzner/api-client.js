import {
  decodeHetznerActionResponse,
  decodeHetznerFirewallCreationResponse,
  decodeHetznerFirewallResponse,
  decodeHetznerFirewallsResponse,
  decodeHetznerImageResponse,
  decodeHetznerImagesResponse,
  decodeHetznerLocationResponse,
  decodeHetznerLocationsResponse,
  decodeHetznerPagination,
  decodeHetznerPrimaryIpCreationResponse,
  decodeHetznerPrimaryIpResponse,
  decodeHetznerPrimaryIpsResponse,
  decodeHetznerServerCreationResponse,
  decodeHetznerServerResponse,
  decodeHetznerServersResponse,
  decodeHetznerServerTypeResponse,
  decodeHetznerServerTypesResponse,
} from './api-documents.js';

const PRODUCTION_BASE_URL = 'https://api.hetzner.cloud/v1';
const USER_AGENT = 'wharfie-self-deployment/1';
const DEFAULT_MAX_GET_ATTEMPTS = 3;
const MAX_MAX_GET_ATTEMPTS = 5;
const MAX_LIST_PAGES = 100;
const MAX_LIST_ITEMS = 5000;
const MAX_TOKEN_LENGTH = 512;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const MAX_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const LIST_QUERY_KEYS = new Map([
  ['name', 'name'],
  ['labelSelector', 'label_selector'],
  ['status', 'status'],
  ['type', 'type'],
  ['architecture', 'architecture'],
  ['includeDeprecated', 'include_deprecated'],
  ['perPage', 'per_page'],
  ['sort', 'sort'],
]);
const INVALID_OPTIONS = 'Hetzner API client options are invalid.';
const INVALID_REQUEST = 'Hetzner API request is invalid.';

/** A safe, body-free Hetzner transport or protocol failure. */
export class HetznerApiError extends Error {
  /**
   * @param {string} code - Stable local error code.
   * @param {string} message - Safe fixed message.
   * @param {{status?: number, providerCode?: string, requestId?: string, retryable?: boolean}} [details] - Safe metadata.
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HetznerApiError';
    this.code = code;
    if (details.status !== undefined) this.status = details.status;
    if (details.providerCode !== undefined) {
      this.providerCode = details.providerCode;
    }
    if (details.requestId !== undefined) this.requestId = details.requestId;
    this.retryable = details.retryable === true;
  }
}

/**
 * @param {unknown} value - Candidate plain object.
 * @returns {value is Record<string, any>} - Whether the value is plain.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {unknown} value - Candidate provider identifier.
 * @returns {number} - Validated identifier.
 */
function providerId(value) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 1) {
    throw new TypeError(INVALID_REQUEST);
  }
  return /** @type {number} */ (value);
}

/**
 * @param {number} status - HTTP response status.
 * @returns {boolean} - Whether a safe GET can be retried.
 */
function retryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * @param {string} value - Candidate header value.
 * @returns {boolean} - Whether it contains an ASCII control character.
 */
function containsControlCharacter(value) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code <= 31 || code === 127);
  });
}

/**
 * Create the single safe signal for any mutation whose final provider state
 * cannot be proven from its response.
 * @param {{status?: number, requestId?: string}} [details] - Safe metadata.
 * @returns {HetznerApiError} - Outcome-unknown error.
 */
function mutationOutcomeUnknown(details = {}) {
  return new HetznerApiError(
    'HETZNER_API_MUTATION_OUTCOME_UNKNOWN',
    'Hetzner API mutation outcome is unknown.',
    { ...details, retryable: false },
  );
}

/**
 * @param {unknown} value - Candidate list query.
 * @returns {URLSearchParams} - Validated query.
 */
function listQuery(value) {
  if (value === undefined) return new URLSearchParams();
  if (!isPlainObject(value)) throw new TypeError(INVALID_REQUEST);
  const search = new URLSearchParams();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !LIST_QUERY_KEYS.has(key)) {
      throw new TypeError(INVALID_REQUEST);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(INVALID_REQUEST);
    }
    const item = descriptor.value;
    if (
      key === 'perPage' &&
      (!Number.isSafeInteger(item) || item < 1 || item > 50)
    ) {
      throw new TypeError(INVALID_REQUEST);
    }
    if (
      (typeof item !== 'string' || item.length === 0) &&
      typeof item !== 'boolean' &&
      (!Number.isSafeInteger(item) || item < 1)
    ) {
      throw new TypeError(INVALID_REQUEST);
    }
    search.append(
      /** @type {string} */ (LIST_QUERY_KEYS.get(key)),
      String(item),
    );
  }
  return search;
}

/**
 * Snapshot a JSON request body before the first effect.
 * @param {unknown} value - Candidate body.
 * @returns {string} - JSON body.
 */
function requestBody(value) {
  if (!isPlainObject(value)) throw new TypeError(INVALID_REQUEST);
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new TypeError(INVALID_REQUEST);
  }
  if (
    encoded === undefined ||
    Buffer.byteLength(encoded, 'utf8') > MAX_REQUEST_BYTES
  ) {
    throw new TypeError(INVALID_REQUEST);
  }
  return encoded;
}

/**
 * Cancel a response body that will not be consumed.
 * @param {Response} response - Fetch response.
 * @returns {Promise<void>} - Settles after cancellation is attempted.
 */
async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort and must not obscure the request result.
  }
}

/**
 * Read one bounded JSON response without retaining an unbounded string.
 * @param {Response} response - Fetch response.
 * @returns {Promise<unknown>} - Parsed JSON.
 */
async function readBoundedJson(response) {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number.parseInt(contentLength, 10) > MAX_RESPONSE_BYTES)
  ) {
    await discardBody(response);
    throw new HetznerApiError(
      'HETZNER_API_RESPONSE_TOO_LARGE',
      'Hetzner API response exceeded the safe size limit.',
    );
  }

  if (response.body === null) {
    throw new HetznerApiError(
      'HETZNER_API_RESPONSE_INVALID',
      'Hetzner API response was not valid JSON.',
    );
  }

  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new HetznerApiError(
          'HETZNER_API_RESPONSE_TOO_LARGE',
          'Hetzner API response exceeded the safe size limit.',
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HetznerApiError) throw error;
    throw new HetznerApiError(
      'HETZNER_API_RESPONSE_INVALID',
      'Hetzner API response body could not be read safely.',
    );
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof HetznerApiError) throw error;
    throw new HetznerApiError(
      'HETZNER_API_RESPONSE_INVALID',
      'Hetzner API response was not valid JSON.',
    );
  }
}

/**
 * Extract safe metadata from an API error document.
 * @param {unknown} document - Parsed response.
 * @returns {{providerCode?: string}} - Safe metadata.
 */
function safeProviderError(document) {
  if (
    !isPlainObject(document) ||
    !isPlainObject(document.error) ||
    typeof document.error.code !== 'string' ||
    document.error.code.length === 0 ||
    document.error.code.length > 100 ||
    !/^[a-z0-9_-]+$/i.test(document.error.code)
  ) {
    return {};
  }
  return { providerCode: document.error.code };
}

/**
 * Accept only one bounded opaque request identifier.
 * @param {string|null} value - Candidate header value.
 * @returns {string|undefined} - Safe request identifier.
 */
function safeRequestId(value) {
  if (
    value === null ||
    value.length === 0 ||
    value.length > 200 ||
    !/^[a-z0-9._:/-]+$/i.test(value)
  ) {
    return undefined;
  }
  return value;
}

/**
 * @param {number} attempt - One-based attempt number.
 * @returns {Promise<void>} - Delay.
 */
function defaultWaitForRetry(attempt) {
  const delay = Math.min(250 * 2 ** (attempt - 1), 2_000);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * @param {unknown} value - Internal client options.
 * @returns {{token: string, fetchImplementation: typeof fetch, baseUrl: string, maxGetAttempts: number, requestTimeoutMs: number, waitForRetry: (attempt: number, status: number|null) => Promise<void>}} - Validated options.
 */
function clientOptions(value) {
  if (!isPlainObject(value)) throw new TypeError(INVALID_OPTIONS);
  const allowed = new Set([
    'token',
    'fetchImplementation',
    'baseUrl',
    'maxGetAttempts',
    'requestTimeoutMs',
    'waitForRetry',
  ]);
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || !allowed.has(key),
    )
  ) {
    throw new TypeError(INVALID_OPTIONS);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(INVALID_OPTIONS);
    }
  }

  const token = value.token;
  const fetchImplementation = value.fetchImplementation ?? globalThis.fetch;
  const baseUrl = value.baseUrl ?? PRODUCTION_BASE_URL;
  const maxGetAttempts = value.maxGetAttempts ?? DEFAULT_MAX_GET_ATTEMPTS;
  const requestTimeoutMs = value.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const waitForRetry = value.waitForRetry ?? defaultWaitForRetry;
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    token.trim() !== token ||
    containsControlCharacter(token) ||
    typeof fetchImplementation !== 'function' ||
    typeof baseUrl !== 'string' ||
    !/^https?:\/\/[^/]+(?:\/[^?#]*)?$/.test(baseUrl) ||
    !Number.isSafeInteger(maxGetAttempts) ||
    maxGetAttempts < 1 ||
    maxGetAttempts > MAX_MAX_GET_ATTEMPTS ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS ||
    typeof waitForRetry !== 'function'
  ) {
    throw new TypeError(INVALID_OPTIONS);
  }
  return {
    token,
    fetchImplementation,
    baseUrl: baseUrl.replace(/\/$/, ''),
    maxGetAttempts,
    requestTimeoutMs,
    waitForRetry,
  };
}

/**
 * Build one client. Injection is intentionally reachable only through the
 * explicitly internal test constructor exported below.
 * @param {unknown} rawOptions - Internal options.
 * @returns {Readonly<Record<string, Function>>} - API client.
 */
function createClient(rawOptions) {
  const {
    token,
    fetchImplementation,
    baseUrl,
    maxGetAttempts,
    requestTimeoutMs,
    waitForRetry,
  } = clientOptions(rawOptions);

  /**
   * @param {'GET'|'POST'|'DELETE'} method - HTTP method.
   * @param {string} path - Fixed path.
   * @param {{search?: URLSearchParams, body?: unknown}} [options] - Request options.
   * @returns {Promise<unknown>} - JSON response, or undefined for deletion.
   */
  async function request(method, path, options = {}) {
    const query =
      options.search === undefined
        ? new URLSearchParams()
        : new URLSearchParams(options.search);
    const suffix = query.size === 0 ? '' : `?${query.toString()}`;
    const url = `${baseUrl}${path}${suffix}`;
    const body = method === 'POST' ? requestBody(options.body) : undefined;
    const attemptLimit = method === 'GET' ? maxGetAttempts : 1;

    for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
      /** @type {Response} */
      let response;
      try {
        response = await Reflect.apply(fetchImplementation, undefined, [
          url,
          {
            method,
            redirect: 'error',
            signal: AbortSignal.timeout(requestTimeoutMs),
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${token}`,
              'user-agent': USER_AGENT,
              ...(body === undefined
                ? {}
                : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body }),
          },
        ]);
      } catch {
        if (method === 'GET' && attempt < attemptLimit) {
          await waitForRetry(attempt, null);
          continue;
        }
        if (method !== 'GET') throw mutationOutcomeUnknown();
        throw new HetznerApiError(
          'HETZNER_API_TRANSPORT_FAILED',
          'Hetzner API request could not be completed.',
          { retryable: true },
        );
      }

      if (
        method === 'GET' &&
        retryableStatus(response.status) &&
        attempt < attemptLimit
      ) {
        await discardBody(response);
        await waitForRetry(attempt, response.status);
        continue;
      }

      const requestId = safeRequestId(
        response.headers.get('x-request-id') ??
          response.headers.get('request-id'),
      );
      if (!response.ok) {
        let providerDetails = {};
        try {
          providerDetails = safeProviderError(await readBoundedJson(response));
        } catch {
          // Error bodies are optional and must never replace the safe status.
        }
        const hasUnknownMutationOutcome =
          method !== 'GET' && retryableStatus(response.status);
        throw new HetznerApiError(
          hasUnknownMutationOutcome
            ? 'HETZNER_API_MUTATION_OUTCOME_UNKNOWN'
            : 'HETZNER_API_REQUEST_FAILED',
          hasUnknownMutationOutcome
            ? 'Hetzner API mutation outcome is unknown.'
            : `Hetzner API request failed with status ${response.status}.`,
          {
            status: response.status,
            requestId,
            retryable: method === 'GET' && retryableStatus(response.status),
            ...providerDetails,
          },
        );
      }

      if (response.status === 204) {
        await discardBody(response);
        return undefined;
      }
      try {
        return await readBoundedJson(response);
      } catch (error) {
        if (method !== 'GET') {
          throw mutationOutcomeUnknown({ status: response.status, requestId });
        }
        throw error;
      }
    }

    throw new HetznerApiError(
      'HETZNER_API_TRANSPORT_FAILED',
      'Hetzner API request could not be completed.',
    );
  }

  /**
   * @param {string} path - Collection path.
   * @param {unknown} query - List query.
   * @param {(document: unknown) => unknown} decode - Decoder.
   * @returns {Promise<Readonly<any[]>>} - Complete decoded list.
   */
  async function list(path, query, decode) {
    const originalSearch = listQuery(query);
    /** @type {any[]} */
    const items = [];
    const seenPages = new Set();
    const seenIds = new Set();
    let nextPage = 1;
    let expectedLastPage;
    let expectedTotalEntries;

    for (let pageCount = 0; ; pageCount += 1) {
      if (pageCount >= MAX_LIST_PAGES || seenPages.has(nextPage)) {
        throw new HetznerApiError(
          'HETZNER_API_PAGINATION_INVALID',
          'Hetzner API pagination exceeded its safe bounds.',
        );
      }
      seenPages.add(nextPage);
      const search = new URLSearchParams(originalSearch);
      search.set('page', String(nextPage));
      const document = await request('GET', path, { search });
      const pageItems = decode(document);
      const pagination = decodeHetznerPagination(document);
      if (
        !Array.isArray(pageItems) ||
        pagination.page !== nextPage ||
        (expectedLastPage !== undefined &&
          pagination.lastPage !== expectedLastPage) ||
        (expectedTotalEntries !== undefined &&
          pagination.totalEntries !== expectedTotalEntries) ||
        pagination.totalEntries > MAX_LIST_ITEMS ||
        items.length + pageItems.length > MAX_LIST_ITEMS
      ) {
        throw new HetznerApiError(
          'HETZNER_API_PAGINATION_INVALID',
          'Hetzner API pagination was inconsistent.',
        );
      }
      expectedLastPage = pagination.lastPage;
      expectedTotalEntries = pagination.totalEntries;
      for (const item of pageItems) {
        if (
          !isPlainObject(item) ||
          !Number.isSafeInteger(item.id) ||
          seenIds.has(item.id)
        ) {
          throw new HetznerApiError(
            'HETZNER_API_PAGINATION_INVALID',
            'Hetzner API pagination was inconsistent.',
          );
        }
        seenIds.add(item.id);
        items.push(item);
      }
      if (pagination.nextPage === null) {
        if (items.length !== pagination.totalEntries) {
          throw new HetznerApiError(
            'HETZNER_API_PAGINATION_INVALID',
            'Hetzner API pagination was inconsistent.',
          );
        }
        return Object.freeze(items);
      }
      nextPage = pagination.nextPage;
    }
  }

  /**
   * @param {string} path - Collection path.
   * @param {unknown} id - Provider identifier.
   * @param {(document: unknown) => unknown} decode - Decoder.
   * @returns {Promise<unknown>} - Decoded resource.
   */
  async function get(path, id, decode) {
    return decode(await request('GET', `${path}/${providerId(id)}`));
  }

  /**
   * @param {string} path - Collection path.
   * @param {unknown} document - Creation document.
   * @param {(value: unknown) => unknown} decode - Decoder.
   * @returns {Promise<unknown>} - Decoded creation response.
   */
  async function create(path, document, decode) {
    const response = await request('POST', path, { body: document });
    try {
      return decode(response);
    } catch {
      throw mutationOutcomeUnknown();
    }
  }

  /**
   * @param {string} path - Collection path.
   * @param {unknown} id - Exact provider identifier.
   * @param {(document: unknown) => unknown} [decode] - Optional response decoder.
   * @returns {Promise<unknown>} - Deletion action, or undefined for 204.
   */
  async function remove(path, id, decode) {
    const document = await request('DELETE', `${path}/${providerId(id)}`);
    if (decode === undefined) {
      if (document !== undefined) {
        throw mutationOutcomeUnknown();
      }
      return undefined;
    }
    if (document === undefined) {
      throw mutationOutcomeUnknown();
    }
    try {
      return decode(document);
    } catch {
      throw mutationOutcomeUnknown();
    }
  }

  /**
   * @param {string} path - Collection path.
   * @param {(document: unknown) => unknown} decode - Response decoder.
   * @returns {(query?: unknown) => Promise<unknown>} - Bound list method.
   */
  function listMethod(path, decode) {
    return (query) => list(path, query, decode);
  }

  /**
   * @param {string} path - Collection path.
   * @param {(document: unknown) => unknown} decode - Response decoder.
   * @returns {(id: unknown) => Promise<unknown>} - Bound get method.
   */
  function getMethod(path, decode) {
    return (id) => get(path, id, decode);
  }

  /**
   * @param {string} path - Collection path.
   * @param {(document: unknown) => unknown} decode - Response decoder.
   * @returns {(document: unknown) => Promise<unknown>} - Bound create method.
   */
  function createMethod(path, decode) {
    return (document) => create(path, document, decode);
  }

  /**
   * @param {string} path - Collection path.
   * @param {(document: unknown) => unknown} [decode] - Response decoder.
   * @returns {(id: unknown) => Promise<unknown>} - Bound delete method.
   */
  function deleteMethod(path, decode) {
    return (id) => remove(path, id, decode);
  }

  return Object.freeze({
    listLocations: listMethod('/locations', decodeHetznerLocationsResponse),
    getLocation: getMethod('/locations', decodeHetznerLocationResponse),
    listServerTypes: listMethod(
      '/server_types',
      decodeHetznerServerTypesResponse,
    ),
    getServerType: getMethod('/server_types', decodeHetznerServerTypeResponse),
    listImages: listMethod('/images', decodeHetznerImagesResponse),
    getImage: getMethod('/images', decodeHetznerImageResponse),
    listFirewalls: listMethod('/firewalls', decodeHetznerFirewallsResponse),
    getFirewall: getMethod('/firewalls', decodeHetznerFirewallResponse),
    createFirewall: createMethod(
      '/firewalls',
      decodeHetznerFirewallCreationResponse,
    ),
    deleteFirewall: deleteMethod('/firewalls'),
    listPrimaryIps: listMethod('/primary_ips', decodeHetznerPrimaryIpsResponse),
    getPrimaryIp: getMethod('/primary_ips', decodeHetznerPrimaryIpResponse),
    createPrimaryIp: createMethod(
      '/primary_ips',
      decodeHetznerPrimaryIpCreationResponse,
    ),
    deletePrimaryIp: deleteMethod('/primary_ips'),
    listServers: listMethod('/servers', decodeHetznerServersResponse),
    getServer: getMethod('/servers', decodeHetznerServerResponse),
    createServer: createMethod('/servers', decodeHetznerServerCreationResponse),
    deleteServer: deleteMethod('/servers', decodeHetznerActionResponse),
    getAction: getMethod('/actions', decodeHetznerActionResponse),
  });
}

/**
 * Create a production Hetzner client. The endpoint and native fetch authority
 * are deliberately not configurable through this public constructor.
 * @param {unknown} value - Exact `{token}` options.
 * @returns {Readonly<Record<string, Function>>} - API client.
 */
export function createHetznerApiClient(value) {
  if (
    !isPlainObject(value) ||
    Reflect.ownKeys(value).length !== 1 ||
    !Object.hasOwn(value, 'token')
  ) {
    throw new TypeError(INVALID_OPTIONS);
  }
  const tokenDescriptor = Object.getOwnPropertyDescriptor(value, 'token');
  if (
    !tokenDescriptor ||
    !tokenDescriptor.enumerable ||
    !Object.hasOwn(tokenDescriptor, 'value')
  ) {
    throw new TypeError(INVALID_OPTIONS);
  }
  return createClient({ token: tokenDescriptor.value });
}

/**
 * Internal test seam. Application code must use createHetznerApiClient.
 * @param {unknown} options - Injectable client options.
 * @returns {Readonly<Record<string, Function>>} - API client.
 */
export function createHetznerApiClientForTest(options) {
  return createClient(options);
}
