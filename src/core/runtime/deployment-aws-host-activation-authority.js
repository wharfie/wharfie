/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This live authority boundary keeps the exact injected read port and V66 envelope types inline. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { assertDomainSeparatedSha256Id } from './content-id.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
  createAwsSingleNodeHostActivationReceipt,
  validateAwsSingleNodeHostActivationReceipt,
  validateAwsSingleNodeHostActivationRequest,
} from './deployment-aws-host-agent-contract.js';
import {
  isAwsSingleNodeHostActivationAuthorityRecordForRequest,
  isAwsSingleNodeHostActivationRequestAuthorizedByHead,
  validateAwsSingleNodeHostActivationAuthorityRecord,
  validateAwsSingleNodeHostActivationHeadRecord,
} from './deployment-aws-host-activation-authority-contract.js';
import { AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS } from './deployment-aws-host-activation.js';
import {
  getDeploymentControlHeadRecordKey,
  getDeploymentControlHostActivationAuthorityRecordKey,
} from './deployment-control-table.js';
import {
  assertDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';

export const AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS = 10_000;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS = 60_000;

const OPTIONS_KEYS = new Set([
  'client',
  'providerScope',
  'deploymentInstanceId',
  'attemptTimeoutMilliseconds',
]);
const OPTIONS_REQUIRED_KEYS = new Set([
  'client',
  'providerScope',
  'deploymentInstanceId',
]);
const CLIENT_KEYS = new Set(['getControlRecord']);
const READ_KEYS = new Set(['deploymentInstanceId', 'requestId']);
const AUTHORIZE_KEYS = new Set(['request', 'purpose', 'step', 'receipt']);
const PURPOSES = new Set(['claim', 'dispatch', 'settle', 'replay']);
const INTEGRITY_ERROR =
  'AWS single-node host activation authority storage is invalid.';
const UNAVAILABLE_ERROR =
  'AWS single-node host activation authority is unavailable.';

/** A strongly read control item was not one exact Wharfie authority record. */
export class AwsSingleNodeHostActivationAuthorityIntegrityError extends Error {
  constructor() {
    super(INTEGRITY_ERROR);
    this.name = 'AwsSingleNodeHostActivationAuthorityIntegrityError';
    this.code = 'AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_INTEGRITY_FAILED';
  }
}

/** The live controller-authority read could not complete conclusively. */
export class AwsSingleNodeHostActivationAuthorityUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_ERROR);
    this.name = 'AwsSingleNodeHostActivationAuthorityUnavailableError';
    this.code = 'AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_UNAVAILABLE';
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
 * Read exact own enumerable data without invoking accessors or proxies.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} keys - Complete allowed keys.
 * @param {Set<string>} required - Required subset.
 * @param {string} path - Boundary path.
 * @returns {Readonly<Record<string, any>>} - Safe shallow snapshot.
 */
function exactDataObject(value, keys, required, path) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object.`);
  /** @type {Record<string, any>} */
  const snapshot = {};
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key)) ||
    ownKeys.length < required.size
  ) {
    throw new TypeError(`${path} is invalid.`);
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${path} is invalid.`);
    }
    snapshot[/** @type {string} */ (key)] = descriptor.value;
  }
  for (const key of required) {
    if (!Object.hasOwn(snapshot, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
  return Object.freeze(snapshot);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/**
 * Create the authenticated, live, strongly consistent current-head oracle for
 * the V66 host kernel. Every successful decision reads the stable request
 * record first and the current deployment head last. The adapter never caches
 * authority and never turns an unavailable provider into authorization.
 * @param {unknown} value - Exact client, provider scope, deployment, and optional deadline.
 * @returns {Readonly<{readAuthorizedRequest: Function, authorizeRequest: Function}>} - Frozen authority port.
 */
export function createAwsSingleNodeHostActivationAuthorityAdapter(value) {
  const options = exactDataObject(
    value,
    OPTIONS_KEYS,
    OPTIONS_REQUIRED_KEYS,
    'awsSingleNodeHostActivationAuthority options',
  );
  const clientValue = exactDataObject(
    options.client,
    CLIENT_KEYS,
    CLIENT_KEYS,
    'awsSingleNodeHostActivationAuthority options.client',
  );
  if (typeof clientValue.getControlRecord !== 'function') {
    throw new TypeError(
      'awsSingleNodeHostActivationAuthority options.client.getControlRecord must be a function.',
    );
  }
  const getControlRecord = clientValue.getControlRecord.bind(options.client);
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeHostActivationAuthority options.providerScope',
  );
  assertDeploymentInstanceId(
    options.deploymentInstanceId,
    'awsSingleNodeHostActivationAuthority options.deploymentInstanceId',
  );
  const deploymentInstanceId = options.deploymentInstanceId;
  const attemptTimeoutMilliseconds = Object.hasOwn(
    options,
    'attemptTimeoutMilliseconds',
  )
    ? options.attemptTimeoutMilliseconds
    : AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS;
  if (
    !Number.isSafeInteger(attemptTimeoutMilliseconds) ||
    attemptTimeoutMilliseconds < 1 ||
    attemptTimeoutMilliseconds >
      AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS
  ) {
    throw new TypeError(
      `awsSingleNodeHostActivationAuthority options.attemptTimeoutMilliseconds must be an integer from 1 through ${AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS}.`,
    );
  }

  /**
   * Make one deadline-bounded read. The call retains its rejection handler
   * after a timeout so an abort-ignoring client cannot emit an unhandled
   * rejection; the owned family separately tracks and drains its raw send.
   * @param {string} recordKey - One exact control-table key.
   * @returns {Promise<unknown|null>} - Item, conclusive absence, or fixed failure.
   */
  async function readControlRecord(recordKey) {
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve(Object.freeze({ status: 'timeout' }));
      }, attemptTimeoutMilliseconds);
    });
    const call = Promise.resolve()
      .then(() =>
        getControlRecord(
          Object.freeze({ recordKey }),
          Object.freeze({ abortSignal: controller.signal }),
        ),
      )
      .then(
        (item) => Object.freeze({ status: 'response', item }),
        () => Object.freeze({ status: 'failed' }),
      );
    const outcome = /** @type {Readonly<Record<string, any>>} */ (
      await Promise.race([call, timeout])
    );
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (outcome.status !== 'response') {
      throw new AwsSingleNodeHostActivationAuthorityUnavailableError();
    }
    if (outcome.item === null) return null;
    if (outcome.item === undefined) {
      throw new AwsSingleNodeHostActivationAuthorityUnavailableError();
    }
    return outcome.item;
  }

  /** @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readAuthorityRecord() {
    const value = await readControlRecord(
      getDeploymentControlHostActivationAuthorityRecordKey(
        deploymentInstanceId,
      ),
    );
    if (value === null) return null;
    try {
      const record = validateAwsSingleNodeHostActivationAuthorityRecord(value);
      if (record.document.deploymentInstanceId !== deploymentInstanceId) {
        throw new Error(INTEGRITY_ERROR);
      }
      return record;
    } catch {
      throw new AwsSingleNodeHostActivationAuthorityIntegrityError();
    }
  }

  /** @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readHead() {
    const value = await readControlRecord(
      getDeploymentControlHeadRecordKey(deploymentInstanceId),
    );
    if (value === null) return null;
    try {
      const record = validateAwsSingleNodeHostActivationHeadRecord(value);
      if (record.document.deploymentInstanceId !== deploymentInstanceId) {
        throw new Error(INTEGRITY_ERROR);
      }
      return record.document;
    } catch {
      throw new AwsSingleNodeHostActivationAuthorityIntegrityError();
    }
  }

  /** @param {Readonly<Record<string, any>>} request @returns {boolean} */
  function requestMatchesBoundAuthority(request) {
    return (
      request.deploymentInstanceId === deploymentInstanceId &&
      sameJson(request.providerScope, providerScope)
    );
  }

  /**
   * Resolve an identifiers-only wakeup into its complete current request.
   * @param {unknown} value - Exact deployment and request IDs.
   * @returns {Promise<Readonly<Record<string, any>>|null>} - Authorized request or absence/supersession.
   */
  async function readAuthorizedRequest(value) {
    const input = exactDataObject(
      value,
      READ_KEYS,
      READ_KEYS,
      'awsSingleNodeHostActivationAuthority.readAuthorizedRequest',
    );
    assertDeploymentInstanceId(
      input.deploymentInstanceId,
      'awsSingleNodeHostActivationAuthority.readAuthorizedRequest.deploymentInstanceId',
    );
    assertDomainSeparatedSha256Id(
      input.requestId,
      AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
      'awsSingleNodeHostActivationAuthority.readAuthorizedRequest.requestId',
    );
    if (input.deploymentInstanceId !== deploymentInstanceId) return null;
    const authority = await readAuthorityRecord();
    if (
      authority === null ||
      authority.document.requestId !== input.requestId ||
      !requestMatchesBoundAuthority(authority.document)
    ) {
      return null;
    }
    const head = await readHead();
    if (
      head === null ||
      !isAwsSingleNodeHostActivationRequestAuthorizedByHead(
        authority.document,
        head,
      )
    ) {
      return null;
    }
    return authority.document;
  }

  /**
   * Validate the exact four-purpose V66 authorization envelope before any
   * provider read. A valid but differently correlated replay receipt is an
   * ordinary refusal; a malformed envelope is a caller error.
   * @param {unknown} value - Candidate V66 envelope.
   * @returns {{request: Readonly<Record<string, any>>, purpose: string, receiptMatches: boolean}} - Canonical call.
   */
  function validateAuthorizeInput(value) {
    const input = exactDataObject(
      value,
      AUTHORIZE_KEYS,
      AUTHORIZE_KEYS,
      'awsSingleNodeHostActivationAuthority.authorizeRequest',
    );
    const request = validateAwsSingleNodeHostActivationRequest(
      input.request,
      'awsSingleNodeHostActivationAuthority.authorizeRequest.request',
    );
    if (!PURPOSES.has(input.purpose)) {
      throw new TypeError(
        'awsSingleNodeHostActivationAuthority.authorizeRequest.purpose is not supported.',
      );
    }
    if (input.purpose === 'dispatch') {
      if (
        typeof input.step !== 'string' ||
        !AWS_SINGLE_NODE_HOST_ACTIVATION_STEP_KINDS.includes(input.step)
      ) {
        throw new TypeError(
          'awsSingleNodeHostActivationAuthority.authorizeRequest.step must be one exact activation step for dispatch.',
        );
      }
    } else if (input.step !== null) {
      throw new TypeError(
        'awsSingleNodeHostActivationAuthority.authorizeRequest.step must be null outside dispatch.',
      );
    }
    if (input.purpose !== 'replay') {
      if (input.receipt !== null) {
        throw new TypeError(
          'awsSingleNodeHostActivationAuthority.authorizeRequest.receipt must be null outside replay.',
        );
      }
      return { request, purpose: input.purpose, receiptMatches: true };
    }
    const receipt = validateAwsSingleNodeHostActivationReceipt(
      input.receipt,
      'awsSingleNodeHostActivationAuthority.authorizeRequest.receipt',
    );
    let receiptMatches = false;
    try {
      const expected = createAwsSingleNodeHostActivationReceipt({
        request,
        serviceHealthReceipt: receipt.serviceHealthReceipt,
      });
      receiptMatches = sameJson(receipt, expected);
    } catch {
      receiptMatches = false;
    }
    return { request, purpose: input.purpose, receiptMatches };
  }

  /**
   * Independently authenticate and live-authorize one V66 kernel decision.
   * @param {unknown} value - Exact `{request,purpose,step,receipt}` envelope.
   * @returns {Promise<boolean>} - Literal true only for current authority.
   */
  async function authorizeRequest(value) {
    const input = validateAuthorizeInput(value);
    if (!input.receiptMatches || !requestMatchesBoundAuthority(input.request)) {
      return false;
    }
    const authority = await readAuthorityRecord();
    if (
      authority === null ||
      !isAwsSingleNodeHostActivationAuthorityRecordForRequest(
        authority,
        input.request,
      )
    ) {
      return false;
    }
    const head = await readHead();
    return (
      head !== null &&
      isAwsSingleNodeHostActivationRequestAuthorizedByHead(input.request, head)
    );
  }

  return Object.freeze({ readAuthorizedRequest, authorizeRequest });
}

export default {
  AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_DEFAULT_ATTEMPT_TIMEOUT_MILLISECONDS,
  AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_MAX_ATTEMPT_TIMEOUT_MILLISECONDS,
  AwsSingleNodeHostActivationAuthorityIntegrityError,
  AwsSingleNodeHostActivationAuthorityUnavailableError,
  createAwsSingleNodeHostActivationAuthorityAdapter,
};
