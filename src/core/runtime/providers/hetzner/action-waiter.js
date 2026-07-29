const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_POLL_INTERVAL_MS = 30 * 1000;
const INVALID_OPTIONS = 'Hetzner action waiter options are invalid.';
const INVALID_ACTION = 'Hetzner action waiter received an invalid action.';

/** A Hetzner action reached the provider's terminal error state. */
export class HetznerActionFailedError extends Error {
  /**
   * @param {number} actionId - Exact provider action identifier.
   * @param {string|null} providerCode - Safe provider error code.
   */
  constructor(actionId, providerCode) {
    super(`Hetzner action ${actionId} failed.`);
    this.name = 'HetznerActionFailedError';
    this.code = 'HETZNER_ACTION_FAILED';
    this.actionId = actionId;
    if (providerCode !== null) this.providerCode = providerCode;
  }
}

/** Waiting for a Hetzner action exceeded its bounded deadline. */
export class HetznerActionTimeoutError extends Error {
  /** @param {number} actionId - Exact provider action identifier. */
  constructor(actionId) {
    super(`Hetzner action ${actionId} did not finish before the deadline.`);
    this.name = 'HetznerActionTimeoutError';
    this.code = 'HETZNER_ACTION_TIMEOUT';
    this.actionId = actionId;
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
 * @param {unknown} value - Candidate action identifier.
 * @returns {number} - Validated identifier.
 */
function actionIdentifier(value) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 1) {
    throw new TypeError(INVALID_ACTION);
  }
  return /** @type {number} */ (value);
}

/**
 * @param {number} delayMs - Delay in milliseconds.
 * @returns {Promise<void>} - Settles after the delay.
 */
function defaultWait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * @param {unknown} value - Factory options.
 * @returns {{getAction: (id: number) => Promise<any>, now: () => number, wait: (delayMs: number) => Promise<void>, timeoutMs: number, pollIntervalMs: number}} - Validated options.
 */
function validateOptions(value) {
  if (!isPlainObject(value)) throw new TypeError(INVALID_OPTIONS);
  const allowed = new Set([
    'getAction',
    'now',
    'wait',
    'timeoutMs',
    'pollIntervalMs',
  ]);
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || !allowed.has(key),
    ) ||
    !Object.hasOwn(value, 'getAction')
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

  const getAction = value.getAction;
  const now = value.now ?? Date.now;
  const wait = value.wait ?? defaultWait;
  const timeoutMs = value.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = value.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (
    typeof getAction !== 'function' ||
    typeof now !== 'function' ||
    typeof wait !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    pollIntervalMs > MAX_POLL_INTERVAL_MS
  ) {
    throw new TypeError(INVALID_OPTIONS);
  }
  return { getAction, now, wait, timeoutMs, pollIntervalMs };
}

/**
 * @param {unknown} value - Candidate clock reading.
 * @returns {number} - Validated clock reading.
 */
function clockReading(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(INVALID_OPTIONS);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate action.
 * @param {number} expectedId - Exact expected provider ID.
 * @returns {Readonly<Record<string, any>>} - Validated action projection.
 */
function validateAction(value, expectedId) {
  if (
    !isPlainObject(value) ||
    value.id !== expectedId ||
    typeof value.status !== 'string' ||
    !['running', 'success', 'error'].includes(value.status)
  ) {
    throw new TypeError(INVALID_ACTION);
  }
  if (value.status === 'error') {
    if (
      value.error !== null &&
      (!isPlainObject(value.error) ||
        typeof value.error.code !== 'string' ||
        value.error.code.length === 0 ||
        value.error.code.length > 100 ||
        !/^[a-z0-9_-]+$/i.test(value.error.code))
    ) {
      throw new TypeError(INVALID_ACTION);
    }
  }
  return Object.freeze({ ...value });
}

/**
 * Create a bounded exact-ID Hetzner action waiter.
 * @param {unknown} value - Factory options.
 * @returns {Readonly<{waitForAction: (actionId: number) => Promise<Readonly<Record<string, any>>>}>} - Waiter.
 */
export function createHetznerActionWaiter(value) {
  const { getAction, now, wait, timeoutMs, pollIntervalMs } =
    validateOptions(value);

  /**
   * @param {number} rawActionId - Exact provider action identifier.
   * @returns {Promise<Readonly<Record<string, any>>>} - Successful action.
   */
  async function waitForAction(rawActionId) {
    const actionId = actionIdentifier(rawActionId);
    const startedAt = clockReading(now());
    const deadline = startedAt + timeoutMs;

    for (;;) {
      const action = validateAction(await getAction(actionId), actionId);
      if (action.status === 'success') return action;
      if (action.status === 'error') {
        const providerCode =
          isPlainObject(action.error) && typeof action.error.code === 'string'
            ? action.error.code
            : null;
        throw new HetznerActionFailedError(actionId, providerCode);
      }

      const current = clockReading(now());
      if (current >= deadline) {
        throw new HetznerActionTimeoutError(actionId);
      }
      await wait(Math.min(pollIntervalMs, Math.max(1, deadline - current)));
      if (clockReading(now()) >= deadline) {
        throw new HetznerActionTimeoutError(actionId);
      }
    }
  }

  return Object.freeze({ waitForAction });
}
