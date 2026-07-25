/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This boundary owns one exact host-only SDK lifetime behind the V67 adapter. */

import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

import BaseAWS from '../lib/aws/base.js';
import { openAwsSingleNodeHostInstanceCredentialSource } from './deployment-aws-host-instance-credentials.js';
import { createAwsSingleNodeHostRuntimeIdentityAdapter } from './deployment-aws-host-runtime-identity.js';
import { validateProviderScope } from './deployment-provider-scope.js';

const OPEN_OPTIONS_KEYS = new Set(['providerScope']);
const SUPPORTED_PARTITION = 'aws';
const INVALID_OPEN_OPTIONS =
  'AWS single-node host client family options must contain only one exact provider scope.';
const INITIALIZATION_ERROR =
  'AWS single-node host client family initialization failed.';
const CLOSED_ERROR = 'AWS single-node host client family is closed.';
const CLOSE_ERROR = 'AWS single-node host client family close failed.';

const noop = Object.freeze(() => undefined);
const SILENT_LOGGER = Object.freeze({
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
});

/** Host-only AWS client construction failed after exact input validation. */
export class AwsSingleNodeHostClientFamilyInitializationError extends Error {
  constructor() {
    super(INITIALIZATION_ERROR);
    this.name = 'AwsSingleNodeHostClientFamilyInitializationError';
    this.code = 'AWS_SINGLE_NODE_HOST_CLIENT_FAMILY_INITIALIZATION_FAILED';
  }
}

/** A host client-family capability was used after close began. */
export class AwsSingleNodeHostClientFamilyClosedError extends Error {
  constructor() {
    super(CLOSED_ERROR);
    this.name = 'AwsSingleNodeHostClientFamilyClosedError';
    this.code = 'AWS_SINGLE_NODE_HOST_CLIENT_FAMILY_CLOSED';
  }
}

/** Host-only AWS client shutdown failed. */
export class AwsSingleNodeHostClientFamilyCloseError extends Error {
  constructor() {
    super(CLOSE_ERROR);
    this.name = 'AwsSingleNodeHostClientFamilyCloseError';
    this.code = 'AWS_SINGLE_NODE_HOST_CLIENT_FAMILY_CLOSE_FAILED';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reject inherited, accessor-backed, hidden, symbol, and extra opener input
 * before constructing a credential source or SDK client.
 * @param {unknown} value - Candidate exact opener options.
 * @returns {Readonly<import('./deployment-provider-scope.js').AwsProviderScope>} - Canonical provider scope.
 */
function validateOpenOptions(value) {
  if (!isPlainObject(value)) throw new TypeError(INVALID_OPEN_OPTIONS);
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== OPEN_OPTIONS_KEYS.size ||
    keys.some((key) => typeof key !== 'string' || !OPEN_OPTIONS_KEYS.has(key))
  ) {
    throw new TypeError(INVALID_OPEN_OPTIONS);
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'providerScope');
  if (
    !descriptor ||
    !descriptor.enumerable ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    throw new TypeError(INVALID_OPEN_OPTIONS);
  }
  const providerScope = validateProviderScope(
    descriptor.value,
    'awsSingleNodeHostClientFamily options.providerScope',
  );
  if (providerScope.partition !== SUPPORTED_PARTITION) {
    throw new TypeError(INVALID_OPEN_OPTIONS);
  }
  return providerScope;
}

/**
 * Best-effort synchronous cleanup for a client that failed to transfer into a
 * complete family. Actual STS `destroy` is synchronous; the thenable branch
 * safely contains a hostile test double without changing the public opener.
 * @param {Function|undefined} capability - Captured cleanup capability.
 * @param {unknown} receiver - SDK client receiver.
 * @returns {void}
 */
function discardCapability(capability, receiver) {
  if (typeof capability !== 'function') return;
  try {
    const outcome = Reflect.apply(capability, receiver, []);
    if (
      outcome !== null &&
      (typeof outcome === 'object' || typeof outcome === 'function') &&
      typeof outcome.then === 'function'
    ) {
      Promise.resolve(outcome).catch(() => undefined);
    }
  } catch {
    // Preserve the fixed initialization error.
  }
}

/**
 * Open the one host-owned AWS credential and STS lifetime used by the
 * single-node activation runtime. Credentials come directly from the EC2
 * instance metadata provider with IMDSv1 fallback disabled; the operator
 * default credential chain is never consulted.
 * @param {unknown} options - Exact `{providerScope}` options.
 * @returns {Readonly<{providerScope: Readonly<import('./deployment-provider-scope.js').AwsProviderScope>, runtimeIdentity: Readonly<{observe: Function, validateEvidence: Function}>, close: () => Promise<void>}>} - Owned host client family.
 */
export function openAwsSingleNodeHostClientFamily(options) {
  const providerScope = validateOpenOptions(options);
  const lifetimeAbortController = new AbortController();
  /** @type {Set<Promise<unknown>>} */
  const activeSends = new Set();
  /** @type {STSClient|undefined} */
  let sts;
  /** @type {Function|undefined} */
  let destroy;
  /** @type {Readonly<{credentials: () => Promise<Readonly<{accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: Date}>>, close: () => Promise<void>}>|undefined} */
  let credentialSource;
  /** @type {Function|undefined} */
  let closeCredentialSource;
  /** @type {Function} */
  let send;
  /** @type {Readonly<{observe: Function, validateEvidence: Function}>} */
  let identityAdapter;

  /**
   * Preserve V67's bounded backoff while allowing owner close to stop a
   * resident observation between attempts.
   * @param {number} attempt - Completed V67 attempt number.
   * @returns {Promise<void>} - Cancellable retry wait.
   */
  function waitForIdentityRetry(attempt) {
    if (lifetimeAbortController.signal.aborted) {
      return Promise.reject(new AwsSingleNodeHostClientFamilyClosedError());
    }
    const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        lifetimeAbortController.signal.removeEventListener('abort', onAbort);
        resolve(undefined);
      }, delay);
      /** @returns {void} */
      function onAbort() {
        clearTimeout(timeout);
        reject(new AwsSingleNodeHostClientFamilyClosedError());
      }
      lifetimeAbortController.signal.addEventListener('abort', onAbort, {
        once: true,
      });
    });
  }

  try {
    credentialSource = openAwsSingleNodeHostInstanceCredentialSource();
    const credentials = credentialSource.credentials;
    closeCredentialSource = credentialSource.close;
    if (
      typeof credentials !== 'function' ||
      typeof closeCredentialSource !== 'function'
    ) {
      throw new TypeError(INITIALIZATION_ERROR);
    }
    sts = new STSClient({
      ...BaseAWS.config({ maxAttempts: 1 }),
      maxAttempts: 1,
      region: providerScope.region,
      endpoint: `https://sts.${providerScope.region}.amazonaws.com`,
      useDualstackEndpoint: false,
      useFipsEndpoint: false,
      useGlobalEndpoint: false,
      credentials,
      logger: SILENT_LOGGER,
    });
    send = sts.send;
    destroy = sts.destroy;
    if (typeof send !== 'function' || typeof destroy !== 'function') {
      throw new TypeError(INITIALIZATION_ERROR);
    }

    const narrowClient = Object.freeze({
      getCallerIdentity(
        /** @type {Readonly<Record<string, never>>} */ input,
        /** @type {{abortSignal: AbortSignal}} */ callOptions,
      ) {
        const abortSignal = AbortSignal.any([
          callOptions.abortSignal,
          lifetimeAbortController.signal,
        ]);
        const call = Promise.resolve(
          Reflect.apply(send, sts, [
            new GetCallerIdentityCommand(input),
            Object.freeze({ abortSignal }),
          ]),
        );
        activeSends.add(call);
        call.then(
          () => activeSends.delete(call),
          () => activeSends.delete(call),
        );
        return call;
      },
    });
    identityAdapter = createAwsSingleNodeHostRuntimeIdentityAdapter({
      client: narrowClient,
      providerScope,
      waitForRetry: waitForIdentityRetry,
    });
  } catch {
    discardCapability(destroy, sts);
    discardCapability(closeCredentialSource, credentialSource);
    throw new AwsSingleNodeHostClientFamilyInitializationError();
  }

  const adapterObserve = identityAdapter.observe;
  const adapterValidateEvidence = identityAdapter.validateEvidence;
  let closing = false;
  let activeCount = 0;
  /** @type {(() => void)|undefined} */
  let resolveDrained;
  /** @type {Promise<void>|undefined} */
  let closePromise;

  /** @returns {void} */
  function assertOpen() {
    if (closing) throw new AwsSingleNodeHostClientFamilyClosedError();
  }

  /** @returns {void} */
  function leave() {
    activeCount -= 1;
    if (activeCount === 0 && resolveDrained) {
      const resolve = resolveDrained;
      resolveDrained = undefined;
      resolve();
    }
  }

  /**
   * Fence and retain one complete live observation through settlement.
   * @template T
   * @param {() => T|Promise<T>} operation - Entered operation.
   * @returns {Promise<T>} - Settled operation.
   */
  function enter(operation) {
    assertOpen();
    activeCount += 1;
    try {
      return Promise.resolve(operation()).finally(leave);
    } catch (error) {
      leave();
      throw error;
    }
  }

  /**
   * @param {unknown} context - Exact V66 runtime-identity context.
   * @returns {Promise<Readonly<Record<string, any>>>} - Live V67 observation.
   */
  function observe(context) {
    return enter(() =>
      Reflect.apply(adapterObserve, identityAdapter, [context]),
    );
  }

  /**
   * @param {unknown} evidence - Candidate request-bound evidence.
   * @param {unknown} context - Exact V66 runtime-identity context.
   * @returns {Readonly<Record<string, any>>} - Canonical V67 evidence.
   */
  function validateEvidence(evidence, context) {
    assertOpen();
    return Reflect.apply(adapterValidateEvidence, identityAdapter, [
      evidence,
      context,
    ]);
  }

  const runtimeIdentity = Object.freeze({ observe, validateEvidence });

  /** @returns {Promise<void>} - Memoized complete close. */
  function close() {
    if (!closePromise) {
      closing = true;
      lifetimeAbortController.abort();
      let credentialClose;
      try {
        credentialClose = Promise.resolve(
          Reflect.apply(
            /** @type {Function} */ (closeCredentialSource),
            credentialSource,
            [],
          ),
        ).then(
          () => false,
          () => true,
        );
      } catch {
        credentialClose = Promise.resolve(true);
      }
      closePromise = (async () => {
        if (activeCount !== 0) {
          await new Promise((resolve) => {
            resolveDrained = () => resolve(undefined);
          });
        }
        let closeFailed = false;
        try {
          await Reflect.apply(
            /** @type {Function} */ (destroy),
            /** @type {STSClient} */ (sts),
            [],
          );
        } catch {
          closeFailed = true;
        }
        await Promise.allSettled([...activeSends]);
        if (await credentialClose) closeFailed = true;
        if (closeFailed) throw new AwsSingleNodeHostClientFamilyCloseError();
      })();
    }
    return closePromise;
  }

  return Object.freeze({ providerScope, runtimeIdentity, close });
}

export default {
  AwsSingleNodeHostClientFamilyCloseError,
  AwsSingleNodeHostClientFamilyClosedError,
  AwsSingleNodeHostClientFamilyInitializationError,
  openAwsSingleNodeHostClientFamily,
};
