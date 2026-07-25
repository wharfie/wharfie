import { openAwsSingleNodeDeploymentInvocation } from './deployment-aws-invocation.js';
import { cloneJsonObject } from './json-value.js';

const REQUEST_KEYS = Object.freeze([
  'region',
  'controlPolicy',
  'operation',
  'input',
]);
const INVOCATION_KEYS = Object.freeze([
  'providerScope',
  'inspectControl',
  'requireControl',
  'reconcileControl',
  'bootstrapControl',
  'inspect',
  'plan',
  'stageClaimedArtifact',
  'converge',
  'convergePreStaged',
  'resume',
  'close',
]);
const INVOCATION_METHODS = Object.freeze(INVOCATION_KEYS.slice(1));
/** @type {Readonly<Record<string, 'requireControl'|'reconcileControl'|'bootstrapControl'>>} */
const CONTROL_METHOD_BY_POLICY = Object.freeze({
  'require-active': 'requireControl',
  'reconcile-existing': 'reconcileControl',
  bootstrap: 'bootstrapControl',
});
/** @type {Readonly<Record<string, 'inspect'|'plan'|'converge'|'convergePreStaged'|'resume'>>} */
const OPERATION_METHOD_BY_NAME = Object.freeze({
  inspect: 'inspect',
  plan: 'plan',
  converge: 'converge',
  'converge-pre-staged': 'convergePreStaged',
  resume: 'resume',
});
const INVALID_REQUEST = 'AWS deployment operation request is invalid.';
const INVALID_INVOCATION = 'AWS deployment operation invocation is invalid.';
const OPERATION_AND_CLEANUP_FAILED =
  'AWS deployment operation and invocation cleanup both failed.';

/**
 * @param {unknown} value - Candidate value.
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
 * Snapshot one exact enumerable own-data object without invoking accessors.
 * @param {unknown} value - Candidate object.
 * @param {Readonly<string[]>} keys - Complete ordered key surface.
 * @param {string} message - Fixed validation failure.
 * @returns {Readonly<Record<string, any>>} - Descriptor-snapshotted values.
 */
function snapshotExactObject(value, keys, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some(
      (key) =>
        typeof key !== 'string' || !keys.includes(/** @type {string} */ (key)),
    )
  ) {
    throw new TypeError(message);
  }

  /** @type {Record<string, any>} */
  const snapshot = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(message);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

/**
 * @param {any} value - Canonical JSON value.
 * @returns {any} - Deeply frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Validate and snapshot the public request before any credential authority is
 * opened.
 * @param {unknown} value - Exact runner request.
 * @returns {Readonly<{region: string, controlMethod: 'requireControl'|'reconcileControl'|'bootstrapControl', operationMethod: 'inspect'|'plan'|'converge'|'convergePreStaged'|'resume', input: Readonly<Record<string, any>>}>} - Canonical request.
 */
function validateRequest(value) {
  const request = snapshotExactObject(value, REQUEST_KEYS, INVALID_REQUEST);
  const controlMethod =
    typeof request.controlPolicy === 'string' &&
    Object.hasOwn(CONTROL_METHOD_BY_POLICY, request.controlPolicy)
      ? CONTROL_METHOD_BY_POLICY[request.controlPolicy]
      : undefined;
  const operationMethod =
    typeof request.operation === 'string' &&
    Object.hasOwn(OPERATION_METHOD_BY_NAME, request.operation)
      ? OPERATION_METHOD_BY_NAME[request.operation]
      : undefined;
  if (
    typeof request.region !== 'string' ||
    request.region.length === 0 ||
    request.region.trim() !== request.region ||
    controlMethod === undefined ||
    operationMethod === undefined
  ) {
    throw new TypeError(INVALID_REQUEST);
  }

  let input;
  try {
    input = deepFreeze(
      cloneJsonObject(request.input, 'AWS deployment operation input'),
    );
  } catch {
    throw new TypeError(INVALID_REQUEST);
  }

  return Object.freeze({
    region: request.region,
    controlMethod,
    operationMethod,
    input,
  });
}

/**
 * Validate and capture one exact frozen invocation before taking ownership.
 * @param {unknown} invocation - Opened invocation owner.
 * @returns {{owner: Readonly<Record<string, any>>, methods: Readonly<Record<string, Function>>}} - Stable invocation projection.
 */
function captureInvocation(invocation) {
  if (!isPlainObject(invocation) || !Object.isFrozen(invocation)) {
    throw new TypeError(INVALID_INVOCATION);
  }
  const snapshot = snapshotExactObject(
    invocation,
    INVOCATION_KEYS,
    INVALID_INVOCATION,
  );
  /** @type {Record<string, Function>} */
  const methods = {};
  for (const method of INVOCATION_METHODS) {
    if (typeof snapshot[method] !== 'function') {
      throw new TypeError(INVALID_INVOCATION);
    }
    methods[method] = snapshot[method];
  }
  return {
    owner: /** @type {Readonly<Record<string, any>>} */ (invocation),
    methods: Object.freeze(methods),
  };
}

/**
 * Run against an invocation once its opener settles.
 * @param {unknown} opening - In-flight invocation open.
 * @param {Readonly<{region: string, controlMethod: 'requireControl'|'reconcileControl'|'bootstrapControl', operationMethod: 'inspect'|'plan'|'converge'|'convergePreStaged'|'resume', input: Readonly<Record<string, any>>}>} request - Canonical request.
 * @returns {Promise<any>} - Exact operation result after owned cleanup.
 */
async function runOpenedInvocation(opening, request) {
  const { owner: invocation, methods } = captureInvocation(await opening);
  /** @type {unknown} */
  let primaryError;
  /** @type {unknown} */
  let result;
  let succeeded = false;

  try {
    await Reflect.apply(methods[request.controlMethod], invocation, []);
    result = await Reflect.apply(methods[request.operationMethod], invocation, [
      request.input,
    ]);
    succeeded = true;
  } catch (error) {
    primaryError = error;
  }

  /** @type {unknown} */
  let cleanupError;
  let cleanupFailed = false;
  try {
    await Reflect.apply(methods.close, invocation, []);
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  }

  if (!succeeded) {
    if (cleanupFailed) {
      throw new AggregateError(
        [primaryError, cleanupError],
        OPERATION_AND_CLEANUP_FAILED,
      );
    }
    throw primaryError;
  }
  if (cleanupFailed) throw cleanupError;
  return result;
}

/**
 * Open, execute, and unconditionally close one AWS single-node deployment
 * invocation.
 * @param {unknown} request - Exact region, control policy, operation, and input.
 * @returns {Promise<any>} - Exact operation result after cleanup.
 */
export function runAwsSingleNodeDeploymentOperation(request) {
  const canonicalRequest = validateRequest(request);

  let opening;
  try {
    opening = openAwsSingleNodeDeploymentInvocation(
      Object.freeze({ region: canonicalRequest.region }),
    );
  } catch (error) {
    return Promise.reject(error);
  }
  return runOpenedInvocation(opening, canonicalRequest);
}

export default {
  runAwsSingleNodeDeploymentOperation,
};
