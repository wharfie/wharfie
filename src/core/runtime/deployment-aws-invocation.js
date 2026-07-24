/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This boundary composes heterogeneous exact runtime ports behind one owned invocation. */

import { openAwsDeploymentClientFamily } from './deployment-aws-client-family.js';
import { createAwsSingleNodeDeploymentProviderFromClientFamily } from './deployment-aws-provider-assembly.js';
import { createDeploymentArtifactStager } from './deployment-artifact-stager.js';
import { createDeploymentControlBucket } from './deployment-control-bucket.js';
import { createDeploymentControlStore } from './deployment-control-store.js';
import {
  createDeploymentControlTableLifecycle,
  DEPLOYMENT_CONTROL_TABLE_NAME,
} from './deployment-control-table.js';
import { createDeploymentController } from './deployment-controller.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { cloneJsonObject } from './json-value.js';

const FACTORY_KEYS = new Set([
  'clientFamily',
  'now',
  'maxAttempts',
  'waitForRetry',
]);
const OPEN_KEYS = new Set(['region', 'now', 'maxAttempts', 'waitForRetry']);
const CLIENT_FAMILY_KEYS = new Set([
  'providerScope',
  'scopeResolver',
  'clients',
  'close',
]);
const CLIENT_KEYS = new Set([
  'deploymentStore',
  'dynamoControl',
  's3Control',
  'providerSpecRead',
  'managedArtifact',
  'volume',
  'network',
  'runtimeIdentity',
  'node',
  'volumeAttachment',
]);
const CONTROL_LIFECYCLE_METHODS = Object.freeze([
  'inspect',
  'reconcile',
  'bootstrap',
]);
const TABLE_STATUSES = new Set([
  'absent',
  'creating',
  'bootstrap-required',
  'active',
]);
const BUCKET_STATUSES = new Set(['absent', 'bootstrap-required', 'active']);
const MIN_ATTEMPTS = 2;
const MAX_ATTEMPTS = 10;
const INVALID_FACTORY_OPTIONS =
  'AWS deployment invocation options are invalid.';
const INVALID_OPEN_OPTIONS =
  'AWS deployment invocation open options are invalid.';
const INVALID_CLIENT_FAMILY =
  'AWS deployment invocation client family is invalid.';
const REUSED_CLIENT_FAMILY =
  'AWS deployment invocation client family is already owned.';
const INVALID_CONTROL_STATE = 'AWS deployment control inspection is invalid.';
const CLOSED_ERROR = 'AWS deployment invocation is closed.';
const NOT_READY_ERROR = 'AWS deployment control resources are not active.';

/** A public invocation was used after its owned close began. */
export class AwsDeploymentInvocationClosedError extends Error {
  constructor() {
    super(CLOSED_ERROR);
    this.name = 'AwsDeploymentInvocationClosedError';
    this.code = 'AWS_DEPLOYMENT_INVOCATION_CLOSED';
  }
}

/** One or both retained deployment-control resources are not active. */
export class AwsDeploymentControlNotReadyError extends Error {
  constructor() {
    super(NOT_READY_ERROR);
    this.name = 'AwsDeploymentControlNotReadyError';
    this.code = 'AWS_DEPLOYMENT_CONTROL_NOT_READY';
  }
}

/** @type {WeakSet<object>} */
const CLAIMED_CLIENT_FAMILIES = new WeakSet();

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Require one exact enumerable own-data surface.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} keys - Complete supported key set.
 * @param {Set<string>} required - Required key subset.
 * @param {string} message - Fixed validation failure.
 * @returns {Record<string, any>} - Exact candidate.
 */
function exactDataObject(value, keys, required, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key)) ||
    required.size > ownKeys.length
  ) {
    throw new TypeError(message);
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(message);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(message);
  }
  return value;
}

/** @param {Record<string, any>} options @param {string} message @returns {{now: () => number, maxAttempts?: number, waitForRetry?: Function}} */
function validateSharedOptions(options, message) {
  const now = Object.hasOwn(options, 'now') ? options.now : Date.now;
  if (typeof now !== 'function') throw new TypeError(message);
  const maxAttempts = options.maxAttempts;
  if (
    maxAttempts !== undefined &&
    (!Number.isSafeInteger(maxAttempts) ||
      maxAttempts < MIN_ATTEMPTS ||
      maxAttempts > MAX_ATTEMPTS)
  ) {
    throw new TypeError(message);
  }
  const waitForRetry = options.waitForRetry;
  if (waitForRetry !== undefined && typeof waitForRetry !== 'function') {
    throw new TypeError(message);
  }
  return {
    now,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(waitForRetry === undefined ? {} : { waitForRetry }),
  };
}

/** @param {unknown} value @returns {{clientFamily: Record<string, any>, now: () => number, maxAttempts?: number, waitForRetry?: Function}} */
function validateFactoryOptions(value) {
  const options = exactDataObject(
    value,
    FACTORY_KEYS,
    new Set(['clientFamily']),
    INVALID_FACTORY_OPTIONS,
  );
  return {
    clientFamily: validateClientFamily(options.clientFamily),
    ...validateSharedOptions(options, INVALID_FACTORY_OPTIONS),
  };
}

/** @param {unknown} value @returns {{region: string, now: () => number, maxAttempts?: number, waitForRetry?: Function}} */
function validateOpenOptions(value) {
  const options = exactDataObject(
    value,
    OPEN_KEYS,
    new Set(['region']),
    INVALID_OPEN_OPTIONS,
  );
  if (typeof options.region !== 'string') {
    throw new TypeError(INVALID_OPEN_OPTIONS);
  }
  return {
    region: options.region,
    ...validateSharedOptions(options, INVALID_OPEN_OPTIONS),
  };
}

/** @param {unknown} value @returns {Record<string, any>} */
function validateClientFamily(value) {
  const family = exactDataObject(
    value,
    CLIENT_FAMILY_KEYS,
    CLIENT_FAMILY_KEYS,
    INVALID_CLIENT_FAMILY,
  );
  if (
    !isPlainObject(family.scopeResolver) ||
    !isPlainObject(family.clients) ||
    typeof family.close !== 'function'
  ) {
    throw new TypeError(INVALID_CLIENT_FAMILY);
  }
  const clientKeys = Reflect.ownKeys(family.clients);
  if (
    clientKeys.length !== CLIENT_KEYS.size ||
    clientKeys.some((key) => typeof key !== 'string' || !CLIENT_KEYS.has(key))
  ) {
    throw new TypeError(INVALID_CLIENT_FAMILY);
  }
  for (const key of CLIENT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(family.clients, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      !isPlainObject(descriptor.value)
    ) {
      throw new TypeError(INVALID_CLIENT_FAMILY);
    }
  }
  return family;
}

/** @param {unknown} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Capture one lifecycle's exact methods.
 * @param {unknown} value - Lifecycle owner.
 * @param {string} path - Boundary label.
 * @returns {Readonly<Record<'inspect'|'reconcile'|'bootstrap', () => unknown>>} - Receiver-preserving projections.
 */
function captureControlLifecycle(value, path) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object.`);
  /** @type {Record<string, () => unknown>} */
  const projected = {};
  for (const method of CONTROL_LIFECYCLE_METHODS) {
    const implementation = value[method];
    if (typeof implementation !== 'function') {
      throw new TypeError(`${path}.${method} must be a function.`);
    }
    projected[method] = () => Reflect.apply(implementation, value, []);
  }
  return /** @type {Readonly<Record<'inspect'|'reconcile'|'bootstrap', () => unknown>>} */ (
    Object.freeze(projected)
  );
}

/** @param {unknown} value @param {Set<string>} statuses @param {string} kind @param {string} providerScopeId @returns {Readonly<Record<string, any>>} */
function validateControlState(value, statuses, kind, providerScopeId) {
  if (
    !isPlainObject(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== kind ||
    !statuses.has(value.status) ||
    value.providerScopeId !== providerScopeId
  ) {
    throw new TypeError(INVALID_CONTROL_STATE);
  }
  return deepFreeze(value);
}

/** @param {Readonly<Record<string, any>>} table @param {Readonly<Record<string, any>>} bucket @param {string} providerScopeId @returns {Readonly<Record<string, any>>} */
function createControlInspection(table, bucket, providerScopeId) {
  const canonicalTable = validateControlState(
    table,
    TABLE_STATUSES,
    'deploymentControlTableInspection',
    providerScopeId,
  );
  const canonicalBucket = validateControlState(
    bucket,
    BUCKET_STATUSES,
    'deploymentControlBucketInspection',
    providerScopeId,
  );
  return deepFreeze({
    schemaVersion: 1,
    kind: 'awsDeploymentControlInspection',
    providerScopeId,
    status:
      canonicalTable.status === 'active' && canonicalBucket.status === 'active'
        ? 'active'
        : 'bootstrap-required',
    table: canonicalTable,
    bucket: canonicalBucket,
  });
}

/**
 * Invoke both control operations even when either throws synchronously, wait
 * for both to settle, and select table failure before bucket failure.
 * @param {() => unknown} tableOperation - Table operation.
 * @param {() => unknown} bucketOperation - Bucket operation.
 * @returns {Promise<[unknown, unknown]>} - Ordered successful values.
 */
async function settleControlPair(tableOperation, bucketOperation) {
  /** @param {() => unknown} operation @returns {Promise<unknown>} */
  const attempt = (operation) => {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const results = await Promise.allSettled([
    attempt(tableOperation),
    attempt(bucketOperation),
  ]);
  if (results[0].status === 'rejected') throw results[0].reason;
  if (results[1].status === 'rejected') throw results[1].reason;
  return [results[0].value, results[1].value];
}

/**
 * Compose one complete CLI-free deployment invocation and transfer ownership
 * of the supplied client family only after every pure constructor succeeds.
 * @param {unknown} options - Exact family, shared clock, and retry policy.
 * @returns {Readonly<Record<string, any>>} - Owned invocation API.
 */
export function createAwsSingleNodeDeploymentInvocationFromClientFamily(
  options,
) {
  const { clientFamily, now, maxAttempts, waitForRetry } =
    validateFactoryOptions(options);
  if (CLAIMED_CLIENT_FAMILIES.has(clientFamily)) {
    throw new TypeError(REUSED_CLIENT_FAMILY);
  }

  const providerScope = validateProviderScope(
    clientFamily.providerScope,
    'awsDeploymentInvocation clientFamily.providerScope',
  );
  const tableLifecycle = captureControlLifecycle(
    createDeploymentControlTableLifecycle({
      client: clientFamily.clients.dynamoControl,
      providerScope,
    }),
    'awsDeploymentInvocation tableLifecycle',
  );
  const bucketLifecycle = captureControlLifecycle(
    createDeploymentControlBucket({
      client: clientFamily.clients.s3Control,
      providerScope,
    }),
    'awsDeploymentInvocation bucketLifecycle',
  );
  const store = createDeploymentControlStore({
    db: clientFamily.clients.deploymentStore,
    tableName: DEPLOYMENT_CONTROL_TABLE_NAME,
  });
  const artifactStager = createDeploymentArtifactStager({
    client: clientFamily.clients.s3Control,
    store,
  });
  const provider = createAwsSingleNodeDeploymentProviderFromClientFamily({
    clientFamily,
    now,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(waitForRetry === undefined ? {} : { waitForRetry }),
  });
  const controller = createDeploymentController({
    store,
    provider,
    artifactStager,
    now,
  });
  const controllerOwner = /** @type {Record<string, Function>} */ (
    /** @type {unknown} */ (controller)
  );
  for (const method of ['inspect', 'plan', 'converge', 'resume']) {
    if (typeof controllerOwner[method] !== 'function') {
      throw new TypeError(
        `awsDeploymentInvocation controller.${method} must be a function.`,
      );
    }
  }
  const controllerMethods = Object.freeze({
    inspect: controllerOwner.inspect,
    plan: controllerOwner.plan,
    converge: controllerOwner.converge,
    resume: controllerOwner.resume,
  });
  const familyClose = clientFamily.close;

  let closing = false;
  let activeCount = 0;
  /** @type {(() => void)|undefined} */
  let resolveDrained;
  /** @type {Promise<void>|undefined} */
  let closePromise;

  /** @returns {void} */
  function assertOpen() {
    if (closing) throw new AwsDeploymentInvocationClosedError();
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
   * Fence and retain one complete public call through settlement.
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

  /** @param {'inspect'|'reconcile'|'bootstrap'} method @returns {Promise<Readonly<Record<string, any>>>} */
  async function runControlPair(method) {
    const [table, bucket] = await settleControlPair(
      tableLifecycle[method],
      bucketLifecycle[method],
    );
    return createControlInspection(
      /** @type {Readonly<Record<string, any>>} */ (table),
      /** @type {Readonly<Record<string, any>>} */ (bucket),
      providerScope.providerScopeId,
    );
  }

  /** @returns {Promise<Readonly<Record<string, any>>>} */
  async function requireControlInternal() {
    const inspection = await runControlPair('inspect');
    if (inspection.status !== 'active') {
      throw new AwsDeploymentControlNotReadyError();
    }
    return inspection;
  }

  /** @returns {Promise<Readonly<Record<string, any>>>} */
  function inspectControl() {
    return enter(() => runControlPair('inspect'));
  }

  /** @returns {Promise<Readonly<Record<string, any>>>} */
  function requireControl() {
    return enter(requireControlInternal);
  }

  /** @returns {Promise<Readonly<Record<string, any>>>} */
  function reconcileControl() {
    return enter(async () => {
      await runControlPair('inspect');
      return await runControlPair('reconcile');
    });
  }

  /** @returns {Promise<Readonly<Record<string, any>>>} */
  function bootstrapControl() {
    return enter(async () => {
      await runControlPair('inspect');
      return await runControlPair('bootstrap');
    });
  }

  /** @param {unknown} input @returns {Promise<Readonly<Record<string, any>>>} */
  function inspect(input) {
    return enter(async () => {
      const request = deepFreeze(
        cloneJsonObject(input, 'awsDeploymentInvocation inspect input'),
      );
      await requireControlInternal();
      return await Reflect.apply(controllerMethods.inspect, controller, [
        request,
      ]);
    });
  }

  /** @param {unknown} input @returns {Promise<Readonly<Record<string, any>>>} */
  function plan(input) {
    return enter(async () => {
      const request = deepFreeze(
        cloneJsonObject(input, 'awsDeploymentInvocation plan input'),
      );
      await requireControlInternal();
      return await Reflect.apply(controllerMethods.plan, controller, [request]);
    });
  }

  /** @param {unknown} input @returns {Promise<Readonly<Record<string, any>>>} */
  function converge(input) {
    return enter(async () => {
      const request = deepFreeze(
        cloneJsonObject(input, 'awsDeploymentInvocation converge input'),
      );
      await requireControlInternal();
      return await Reflect.apply(controllerMethods.converge, controller, [
        request,
      ]);
    });
  }

  /** @param {unknown} input @returns {Promise<Readonly<Record<string, any>>>} */
  function resume(input) {
    return enter(async () => {
      const request = deepFreeze(
        cloneJsonObject(input, 'awsDeploymentInvocation resume input'),
      );
      await requireControlInternal();
      return await Reflect.apply(controllerMethods.resume, controller, [
        request,
      ]);
    });
  }

  /** @returns {Promise<void>} */
  function close() {
    if (!closePromise) {
      closing = true;
      const drained =
        activeCount === 0
          ? Promise.resolve()
          : new Promise((resolve) => {
              resolveDrained = () => resolve(undefined);
            });
      closePromise = drained
        .then(() => Reflect.apply(familyClose, clientFamily, []))
        .then(() => undefined);
    }
    return closePromise;
  }

  const invocation = Object.freeze({
    providerScope,
    inspectControl,
    requireControl,
    reconcileControl,
    bootstrapControl,
    inspect,
    plan,
    converge,
    resume,
    close,
  });
  CLAIMED_CLIENT_FAMILIES.add(clientFamily);
  return invocation;
}

/**
 * Open one ordinary-chain AWS family and transfer it into an owned deployment
 * invocation. Transfer failure closes the otherwise unowned family.
 * @param {unknown} options - Exact region, shared clock, and retry policy.
 * @returns {Promise<Readonly<Record<string, any>>>} - Owned invocation API.
 */
export async function openAwsSingleNodeDeploymentInvocation(options) {
  const { region, now, maxAttempts, waitForRetry } =
    validateOpenOptions(options);
  const clientFamily = await openAwsDeploymentClientFamily({ region });
  try {
    return createAwsSingleNodeDeploymentInvocationFromClientFamily({
      clientFamily,
      now,
      ...(maxAttempts === undefined ? {} : { maxAttempts }),
      ...(waitForRetry === undefined ? {} : { waitForRetry }),
    });
  } catch (error) {
    try {
      await Reflect.apply(clientFamily.close, clientFamily, []);
    } catch {
      // Preserve the transfer failure; cleanup is best-effort.
    }
    throw error;
  }
}

export default {
  AwsDeploymentControlNotReadyError,
  AwsDeploymentInvocationClosedError,
  createAwsSingleNodeDeploymentInvocationFromClientFamily,
  openAwsSingleNodeDeploymentInvocation,
};
