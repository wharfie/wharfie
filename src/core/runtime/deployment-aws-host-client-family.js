/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This boundary owns one exact host-only SDK lifetime behind the V67 and V70 adapters. */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

import BaseAWS from '../lib/aws/base.js';
import { createAwsSingleNodeHostActivationAuthorityAdapter } from './deployment-aws-host-activation-authority.js';
import { openAwsSingleNodeHostInstanceCredentialSource } from './deployment-aws-host-instance-credentials.js';
import { createAwsSingleNodeHostRuntimeIdentityAdapter } from './deployment-aws-host-runtime-identity.js';
import {
  DEPLOYMENT_CONTROL_TABLE_NAME,
  DEPLOYMENT_CONTROL_TABLE_RECORD_KEY,
} from './deployment-control-table.js';
import {
  assertDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';

const OPEN_OPTIONS_KEYS = new Set(['providerScope', 'deploymentInstanceId']);
const SUPPORTED_PARTITION = 'aws';
const INVALID_OPEN_OPTIONS =
  'AWS single-node host client family options must contain only one exact provider scope and deployment instance.';
const INITIALIZATION_ERROR =
  'AWS single-node host client family initialization failed.';
const CLOSED_ERROR = 'AWS single-node host client family is closed.';
const CLOSE_ERROR = 'AWS single-node host client family close failed.';
const ARTIFACT_READ_ERROR = 'AWS single-node host artifact read failed.';
const S3_BODY_TERMINAL_POLL_MILLISECONDS = 10;

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

/** A host artifact read failed without exposing raw provider detail. */
export class AwsSingleNodeHostArtifactReadError extends Error {
  constructor() {
    super(ARTIFACT_READ_ERROR);
    this.name = 'AwsSingleNodeHostArtifactReadError';
    this.code = 'AWS_SINGLE_NODE_HOST_ARTIFACT_READ_FAILED';
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
 * @returns {{providerScope: Readonly<import('./deployment-provider-scope.js').AwsProviderScope>, deploymentInstanceId: string}} - Canonical bound options.
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
  const providerScopeDescriptor = Object.getOwnPropertyDescriptor(
    value,
    'providerScope',
  );
  const deploymentInstanceIdDescriptor = Object.getOwnPropertyDescriptor(
    value,
    'deploymentInstanceId',
  );
  if (
    !providerScopeDescriptor ||
    !providerScopeDescriptor.enumerable ||
    !Object.hasOwn(providerScopeDescriptor, 'value') ||
    !deploymentInstanceIdDescriptor ||
    !deploymentInstanceIdDescriptor.enumerable ||
    !Object.hasOwn(deploymentInstanceIdDescriptor, 'value')
  ) {
    throw new TypeError(INVALID_OPEN_OPTIONS);
  }
  const providerScope = validateProviderScope(
    providerScopeDescriptor.value,
    'awsSingleNodeHostClientFamily options.providerScope',
  );
  if (providerScope.partition !== SUPPORTED_PARTITION) {
    throw new TypeError(INVALID_OPEN_OPTIONS);
  }
  assertDeploymentInstanceId(
    deploymentInstanceIdDescriptor.value,
    'awsSingleNodeHostClientFamily options.deploymentInstanceId',
  );
  return {
    providerScope,
    deploymentInstanceId: deploymentInstanceIdDescriptor.value,
  };
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
 * Open the one host-owned AWS credential, STS, DynamoDB, and S3 lifetime used
 * by the single-node activation runtime. Credentials come directly from the
 * EC2 instance metadata provider with IMDSv1 fallback disabled; the operator
 * default credential chain is never consulted.
 * @param {unknown} options - Exact `{providerScope,deploymentInstanceId}` options.
 * @returns {Readonly<{providerScope: Readonly<import('./deployment-provider-scope.js').AwsProviderScope>, runtimeIdentity: Readonly<{observe: Function, validateEvidence: Function}>, activationAuthority: Readonly<{readAuthorizedRequest: Function, authorizeRequest: Function}>, artifactStorage: Readonly<{getObject: Function}>, close: () => Promise<void>}>} - Owned host client family.
 */
export function openAwsSingleNodeHostClientFamily(options) {
  const { providerScope, deploymentInstanceId } = validateOpenOptions(options);
  const lifetimeAbortController = new AbortController();
  /** @type {Set<Promise<unknown>>} */
  const activeSends = new Set();
  /** @type {Set<Readonly<{abort: () => void}>>} */
  const activeS3Bodies = new Set();
  /** @type {STSClient|undefined} */
  let sts;
  /** @type {DynamoDBClient|undefined} */
  let dynamo;
  /** @type {DynamoDBDocumentClient|undefined} */
  let dynamoDocument;
  /** @type {S3Client|undefined} */
  let s3;
  /** @type {Function|undefined} */
  let destroySts;
  /** @type {Function|undefined} */
  let destroyDynamo;
  /** @type {Function|undefined} */
  let destroyS3;
  /** @type {Readonly<{credentials: () => Promise<Readonly<{accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: Date}>>, close: () => Promise<void>}>|undefined} */
  let credentialSource;
  /** @type {Function|undefined} */
  let closeCredentialSource;
  /** @type {Function} */
  let sendSts;
  /** @type {Function} */
  let sendDynamo;
  /** @type {Function} */
  let sendS3;
  /** @type {Readonly<{observe: Function, validateEvidence: Function}>} */
  let identityAdapter;
  /** @type {Readonly<{readAuthorizedRequest: Function, authorizeRequest: Function}>} */
  let authorityAdapter;

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
    sendSts = sts.send;
    destroySts = sts.destroy;
    if (typeof sendSts !== 'function' || typeof destroySts !== 'function') {
      throw new TypeError(INITIALIZATION_ERROR);
    }

    dynamo = new DynamoDBClient({
      ...BaseAWS.config({ maxAttempts: 1 }),
      maxAttempts: 1,
      region: providerScope.region,
      endpoint: `https://dynamodb.${providerScope.region}.amazonaws.com`,
      useDualstackEndpoint: false,
      useFipsEndpoint: false,
      accountIdEndpointMode: 'disabled',
      credentials,
      logger: SILENT_LOGGER,
    });
    destroyDynamo = dynamo.destroy;
    if (typeof destroyDynamo !== 'function') {
      throw new TypeError(INITIALIZATION_ERROR);
    }
    dynamoDocument = DynamoDBDocumentClient.from(dynamo, {
      marshallOptions: {
        convertClassInstanceToMap: false,
        convertEmptyValues: false,
        removeUndefinedValues: false,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });
    sendDynamo = dynamoDocument.send;
    if (typeof sendDynamo !== 'function') {
      throw new TypeError(INITIALIZATION_ERROR);
    }

    s3 = new S3Client({
      ...BaseAWS.config({ maxAttempts: 1 }),
      maxAttempts: 1,
      region: providerScope.region,
      endpoint: `https://s3.${providerScope.region}.amazonaws.com`,
      useDualstackEndpoint: false,
      useFipsEndpoint: false,
      forcePathStyle: false,
      bucketEndpoint: false,
      useAccelerateEndpoint: false,
      useArnRegion: false,
      disableMultiregionAccessPoints: true,
      followRegionRedirects: false,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_SUPPORTED',
      credentials,
      logger: SILENT_LOGGER,
    });
    sendS3 = s3.send;
    destroyS3 = s3.destroy;
    if (typeof sendS3 !== 'function' || typeof destroyS3 !== 'function') {
      throw new TypeError(INITIALIZATION_ERROR);
    }

    const narrowIdentityClient = Object.freeze({
      getCallerIdentity(
        /** @type {Readonly<Record<string, never>>} */ input,
        /** @type {{abortSignal: AbortSignal}} */ callOptions,
      ) {
        const abortSignal = AbortSignal.any([
          callOptions.abortSignal,
          lifetimeAbortController.signal,
        ]);
        const call = Promise.resolve(
          Reflect.apply(sendSts, sts, [
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
      client: narrowIdentityClient,
      providerScope,
      waitForRetry: waitForIdentityRetry,
    });

    const narrowAuthorityClient = Object.freeze({
      async getControlRecord(
        /** @type {{recordKey: string}} */ input,
        /** @type {{abortSignal: AbortSignal}} */ callOptions,
      ) {
        const abortSignal = AbortSignal.any([
          callOptions.abortSignal,
          lifetimeAbortController.signal,
        ]);
        const commandInput = Object.freeze({
          TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
          Key: Object.freeze({
            [DEPLOYMENT_CONTROL_TABLE_RECORD_KEY]: input.recordKey,
          }),
          ConsistentRead: true,
        });
        const call = Promise.resolve(
          Reflect.apply(sendDynamo, dynamoDocument, [
            new GetCommand(commandInput),
            Object.freeze({ abortSignal }),
          ]),
        );
        activeSends.add(call);
        call.then(
          () => activeSends.delete(call),
          () => activeSends.delete(call),
        );
        const response = await call;
        if (!isPlainObject(response)) {
          throw new TypeError(INITIALIZATION_ERROR);
        }
        const item = Object.getOwnPropertyDescriptor(response, 'Item');
        if (item === undefined) return null;
        if (
          !item.enumerable ||
          !Object.hasOwn(item, 'value') ||
          !isPlainObject(item.value)
        ) {
          throw new TypeError(INITIALIZATION_ERROR);
        }
        return item.value;
      },
    });
    authorityAdapter = createAwsSingleNodeHostActivationAuthorityAdapter({
      client: narrowAuthorityClient,
      providerScope,
      deploymentInstanceId,
    });
  } catch {
    discardCapability(closeCredentialSource, credentialSource);
    discardCapability(destroyS3, s3);
    discardCapability(destroyDynamo, dynamo);
    discardCapability(destroySts, sts);
    throw new AwsSingleNodeHostClientFamilyInitializationError();
  }

  const adapterObserve = identityAdapter.observe;
  const adapterValidateEvidence = identityAdapter.validateEvidence;
  const adapterReadAuthorizedRequest = authorityAdapter.readAuthorizedRequest;
  const adapterAuthorizeRequest = authorityAdapter.authorizeRequest;
  let closing = false;
  let activeCount = 0;
  let bodyCleanupFailed = false;
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
   * Retain a family lease beyond the promise that admitted an operation.
   * S3 GetObject resolves at headers, while the returned stream remains owned
   * provider state that must reach terminal completion before family teardown.
   * @returns {() => void} - Idempotent lease release.
   */
  function retain() {
    activeCount += 1;
    let retained = true;
    return () => {
      if (!retained) return;
      retained = false;
      leave();
    };
  }

  /**
   * Keep one Node SDK response body inside the family lifetime without
   * replacing or widening the adapter-visible response. Non-stream bodies
   * cannot outlive the send and therefore need no retained lease.
   * @param {unknown} response - Raw GetObject response.
   * @param {AbortSignal} abortSignal - Composed caller and family lifetime.
   * @returns {boolean} - Whether terminal body ownership was retained.
   */
  function retainS3ResponseBody(response, abortSignal) {
    if (
      response === null ||
      (typeof response !== 'object' && typeof response !== 'function')
    ) {
      return false;
    }
    /** @type {unknown} */
    let body;
    /** @type {unknown} */
    let once;
    /** @type {unknown} */
    let removeListener;
    /** @type {unknown} */
    let destroy;
    try {
      body = /** @type {{Body?: unknown}} */ (response).Body;
      if (
        body === null ||
        (typeof body !== 'object' && typeof body !== 'function')
      ) {
        return false;
      }
    } catch {
      throw new TypeError(ARTIFACT_READ_ERROR);
    }
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      return false;
    }
    try {
      destroy = /** @type {{destroy?: unknown}} */ (body).destroy;
    } catch {
      throw new TypeError(ARTIFACT_READ_ERROR);
    }
    try {
      once = /** @type {{once?: unknown}} */ (body).once;
      removeListener = /** @type {{removeListener?: unknown}} */ (body)
        .removeListener;
    } catch {
      discardUnownedBody();
      throw new TypeError(ARTIFACT_READ_ERROR);
    }

    /**
     * Contain a non-standard asynchronous cleanup result without allowing its
     * rejection to escape the fixed family boundary.
     * @param {unknown} outcome - Candidate thenable cleanup result.
     * @returns {boolean} - Whether the outcome was thenable.
     */
    function containDiscardedOutcome(outcome) {
      if (
        outcome === null ||
        (typeof outcome !== 'object' && typeof outcome !== 'function')
      ) {
        return false;
      }
      let then;
      try {
        then = /** @type {{then?: unknown}} */ (outcome).then;
      } catch {
        return true;
      }
      if (typeof then !== 'function') return false;
      try {
        Promise.resolve(outcome).then(noop, noop);
      } catch {
        // The fixed read/close failure remains authoritative.
      }
      return true;
    }

    /**
     * A partially stream-like body may still own provider state. Request one
     * best-effort destruction before rejecting an unusable ownership surface.
     * @returns {void}
     */
    function discardUnownedBody() {
      bodyCleanupFailed = true;
      if (typeof destroy !== 'function') return;
      const releaseDiscardLease = retain();
      let discardLeaseReleased = false;
      /** @returns {void} */
      function releaseDiscard() {
        if (discardLeaseReleased) return;
        discardLeaseReleased = true;
        releaseDiscardLease();
      }
      /** @returns {void} */
      function releaseIfDiscardTerminal() {
        try {
          if (
            /** @type {{readableEnded?: unknown}} */ (body).readableEnded ===
              true ||
            /** @type {{closed?: unknown}} */ (body).closed === true
          ) {
            releaseDiscard();
          }
        } catch {
          releaseDiscard();
        }
      }
      let outcome;
      try {
        outcome = Reflect.apply(destroy, body, []);
      } catch {
        releaseDiscard();
        return;
      }
      if (
        outcome !== null &&
        (typeof outcome === 'object' || typeof outcome === 'function')
      ) {
        let then;
        try {
          then = /** @type {{then?: unknown}} */ (outcome).then;
        } catch {
          releaseDiscard();
          return;
        }
        if (typeof then === 'function') {
          try {
            Promise.resolve(outcome).then(releaseDiscard, releaseDiscard);
          } catch {
            releaseDiscard();
          }
          releaseIfDiscardTerminal();
          return;
        }
      }
      releaseDiscard();
    }

    if (
      typeof once !== 'function' ||
      typeof removeListener !== 'function' ||
      typeof destroy !== 'function'
    ) {
      if (
        once === undefined &&
        removeListener === undefined &&
        destroy === undefined
      ) {
        bodyCleanupFailed = true;
        throw new TypeError(ARTIFACT_READ_ERROR);
      }
      discardUnownedBody();
      throw new TypeError(ARTIFACT_READ_ERROR);
    }

    let bodyInitiallyEnded;
    try {
      bodyInitiallyEnded =
        /** @type {{readableEnded?: unknown}} */ (body).readableEnded === true;
      if (/** @type {{closed?: unknown}} */ (body).closed === true)
        return false;
    } catch {
      discardUnownedBody();
      throw new TypeError(ARTIFACT_READ_ERROR);
    }

    const releaseLease = retain();
    let settled = false;
    let terminal = false;
    let dataEnded = bodyInitiallyEnded;
    let destroyRequested = false;
    let destroyOutcomePending = false;
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let terminalPoll;
    /** @type {Array<readonly [string, Function]>} */
    const installedListeners = [];
    /** @returns {void} */
    function settle() {
      if (settled) return;
      settled = true;
      if (terminalPoll !== undefined) {
        clearTimeout(terminalPoll);
        terminalPoll = undefined;
      }
      for (const [event, listener] of installedListeners) {
        try {
          const outcome = Reflect.apply(
            /** @type {Function} */ (removeListener),
            body,
            [event, listener],
          );
          if (containDiscardedOutcome(outcome)) {
            bodyCleanupFailed = true;
          }
        } catch {
          bodyCleanupFailed = true;
        }
      }
      installedListeners.length = 0;
      activeS3Bodies.delete(tracker);
      abortSignal.removeEventListener('abort', abortBody);
      releaseLease();
    }
    /** @returns {void} */
    function failCleanup() {
      bodyCleanupFailed = true;
      settle();
    }
    /** @returns {void} */
    function settleIfTerminal() {
      if (terminal && !destroyOutcomePending) settle();
    }
    /**
     * @param {boolean} [allowCompletedData] - Whether one deferred turn has
     * elapsed to rule out Node's synchronous post-`end` auto-destroy start.
     * @returns {void}
     */
    function observeTerminalState(allowCompletedData = false) {
      if (settled) return;
      try {
        const closed = /** @type {{closed?: unknown}} */ (body).closed === true;
        const readableEnded =
          /** @type {{readableEnded?: unknown}} */ (body).readableEnded ===
          true;
        const destroyed =
          /** @type {{destroyed?: unknown}} */ (body).destroyed === true;
        if (readableEnded) dataEnded = true;
        if (
          closed ||
          (allowCompletedData && dataEnded && !destroyed && !destroyRequested)
        ) {
          terminal = true;
          settleIfTerminal();
        }
      } catch {
        failCleanup();
      }
    }
    /** @returns {void} */
    function scheduleTerminalPoll() {
      if (
        settled ||
        terminal ||
        terminalPoll !== undefined ||
        (!destroyRequested && !dataEnded)
      ) {
        return;
      }
      terminalPoll = setTimeout(() => {
        terminalPoll = undefined;
        observeTerminalState(true);
        if (!settled && !terminal) scheduleTerminalPoll();
      }, S3_BODY_TERMINAL_POLL_MILLISECONDS);
    }
    /** @returns {void} */
    function abortBody() {
      tracker.abort();
    }
    /** @returns {void} */
    function finishBody() {
      terminal = true;
      settleIfTerminal();
    }
    /** @returns {void} */
    function finishData() {
      dataEnded = true;
      observeTerminalState();
      scheduleTerminalPoll();
    }
    /** @returns {void} */
    function interruptBody() {
      observeTerminalState();
      if (settled) return;
      tracker.abort();
      observeTerminalState();
      scheduleTerminalPoll();
    }
    const tracker = Object.freeze({
      abort() {
        if (settled || destroyRequested) return;
        destroyRequested = true;
        let alreadyDestroyed;
        try {
          alreadyDestroyed =
            /** @type {{destroyed?: unknown}} */ (body).destroyed === true;
        } catch {
          failCleanup();
          return;
        }
        if (alreadyDestroyed) {
          observeTerminalState();
          scheduleTerminalPoll();
          return;
        }
        let outcome;
        try {
          outcome = Reflect.apply(destroy, body, []);
        } catch {
          failCleanup();
          return;
        }
        if (
          outcome !== null &&
          (typeof outcome === 'object' || typeof outcome === 'function')
        ) {
          let then;
          try {
            then = /** @type {{then?: unknown}} */ (outcome).then;
          } catch {
            failCleanup();
            return;
          }
          if (typeof then === 'function') {
            destroyOutcomePending = true;
            try {
              Promise.resolve(outcome).then(
                () => {
                  destroyOutcomePending = false;
                  terminal = true;
                  observeTerminalState();
                  settleIfTerminal();
                },
                () => {
                  destroyOutcomePending = false;
                  failCleanup();
                },
              );
            } catch {
              destroyOutcomePending = false;
              failCleanup();
              return;
            }
          }
        }
        observeTerminalState();
        settleIfTerminal();
        if (!destroyOutcomePending) scheduleTerminalPoll();
      },
    });
    activeS3Bodies.add(tracker);
    try {
      for (const [event, listener] of [
        ['error', interruptBody],
        ['close', finishBody],
        ['end', finishData],
        ['aborted', interruptBody],
      ]) {
        installedListeners.push(
          /** @type {readonly [string, Function]} */ ([event, listener]),
        );
        const outcome = Reflect.apply(once, body, [event, listener]);
        if (containDiscardedOutcome(outcome)) {
          throw new TypeError(ARTIFACT_READ_ERROR);
        }
        if (settled) break;
      }
      if (!settled) {
        abortSignal.addEventListener('abort', abortBody, { once: true });
        observeTerminalState();
        scheduleTerminalPoll();
      }
      if (!settled && abortSignal.aborted) {
        abortBody();
      }
    } catch {
      bodyCleanupFailed = true;
      tracker.abort();
      settleIfTerminal();
      throw new TypeError(ARTIFACT_READ_ERROR);
    }
    return true;
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

  /**
   * @param {unknown} value - Exact deployment and request identifiers.
   * @returns {Promise<Readonly<Record<string, any>>|null>} - Current request or absence.
   */
  function readAuthorizedRequest(value) {
    return enter(() =>
      Reflect.apply(adapterReadAuthorizedRequest, authorityAdapter, [value]),
    );
  }

  /**
   * @param {unknown} value - Exact V66 authorization envelope.
   * @returns {Promise<boolean>} - Literal live-authority decision.
   */
  function authorizeRequest(value) {
    return enter(() =>
      Reflect.apply(adapterAuthorizeRequest, authorityAdapter, [value]),
    );
  }

  const activationAuthority = Object.freeze({
    readAuthorizedRequest,
    authorizeRequest,
  });

  /**
   * Send one adapter-owned exact artifact GetObject request. This family adds
   * only the composed cancellation signal and retains a returned Node body
   * until its terminal event; the artifact adapter owns request derivation and
   * response validation.
   * @param {unknown} input - Exact adapter-owned GetObject input.
   * @param {{abortSignal: AbortSignal}} callOptions - Caller cancellation.
   * @returns {Promise<unknown>} - Raw SDK response.
   */
  function getArtifactObject(input, callOptions) {
    return enter(async () => {
      try {
        const abortSignal = AbortSignal.any([
          callOptions.abortSignal,
          lifetimeAbortController.signal,
        ]);
        const call = Promise.resolve(
          Reflect.apply(sendS3, s3, [
            new GetObjectCommand(
              /** @type {import('@aws-sdk/client-s3').GetObjectCommandInput} */ (
                input
              ),
            ),
            Object.freeze({ abortSignal }),
          ]),
        );
        activeSends.add(call);
        call.then(
          () => activeSends.delete(call),
          () => activeSends.delete(call),
        );
        const response = await call;
        retainS3ResponseBody(response, abortSignal);
        return response;
      } catch {
        if (closing) throw new AwsSingleNodeHostClientFamilyClosedError();
        throw new AwsSingleNodeHostArtifactReadError();
      }
    });
  }

  const artifactStorage = Object.freeze({ getObject: getArtifactObject });

  /** @returns {Promise<boolean>} - Whether credential close failed. */
  function closeCredentials() {
    try {
      return Promise.resolve(
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
      return Promise.resolve(true);
    }
  }

  /** @returns {Promise<void>} - Memoized complete close. */
  function close() {
    if (!closePromise) {
      closing = true;
      /** @type {(() => void)|undefined} */
      let resolveClose;
      /** @type {((error: Error) => void)|undefined} */
      let rejectClose;
      closePromise = new Promise((resolve, reject) => {
        resolveClose = resolve;
        rejectClose = reject;
      });
      const credentialClose = closeCredentials();
      let closeSetupFailed = false;
      try {
        lifetimeAbortController.abort();
      } catch {
        closeSetupFailed = true;
      }
      for (const body of [...activeS3Bodies]) {
        try {
          body.abort();
        } catch {
          bodyCleanupFailed = true;
        }
      }
      const completeClose = (async () => {
        if (activeCount !== 0) {
          await new Promise((resolve) => {
            resolveDrained = () => resolve(undefined);
          });
        }
        let closeFailed = false;
        const destroyed = await Promise.allSettled([
          Promise.resolve().then(() =>
            Reflect.apply(
              /** @type {Function} */ (destroyS3),
              /** @type {S3Client} */ (s3),
              [],
            ),
          ),
          Promise.resolve().then(() =>
            Reflect.apply(
              /** @type {Function} */ (destroySts),
              /** @type {STSClient} */ (sts),
              [],
            ),
          ),
          Promise.resolve().then(() =>
            Reflect.apply(
              /** @type {Function} */ (destroyDynamo),
              /** @type {DynamoDBClient} */ (dynamo),
              [],
            ),
          ),
        ]);
        if (destroyed.some((result) => result.status === 'rejected')) {
          closeFailed = true;
        }
        await Promise.allSettled([...activeSends]);
        if (closeSetupFailed) closeFailed = true;
        if (bodyCleanupFailed) closeFailed = true;
        if (await credentialClose) closeFailed = true;
        if (closeFailed) throw new AwsSingleNodeHostClientFamilyCloseError();
      })();
      completeClose.then(
        () => /** @type {() => void} */ (resolveClose)(),
        () =>
          /** @type {(error: Error) => void} */ (rejectClose)(
            new AwsSingleNodeHostClientFamilyCloseError(),
          ),
      );
    }
    return closePromise;
  }

  return Object.freeze({
    providerScope,
    runtimeIdentity,
    activationAuthority,
    artifactStorage,
    close,
  });
}

export default {
  AwsSingleNodeHostArtifactReadError,
  AwsSingleNodeHostClientFamilyCloseError,
  AwsSingleNodeHostClientFamilyClosedError,
  AwsSingleNodeHostClientFamilyInitializationError,
  openAwsSingleNodeHostClientFamily,
};
