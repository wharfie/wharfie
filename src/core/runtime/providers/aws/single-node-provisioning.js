/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This bounded recovery state machine keeps its exact injected ports, durable fences, and sanitized outcomes adjacent. */

import { isIPv4 } from 'node:net';

import { sortCanonicalJsonValue } from '../../canonical-order.js';
import { sha256Base64Url } from '../../content-id.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import { SINGLE_NODE_CLOUD_INIT_MAX_BYTES } from '../../single-node-cloud-init.js';
import {
  AwsSingleNodeEvidenceConflictError,
  AwsSingleNodeEvidenceTransientError,
  AwsSingleNodeEvidenceUnknownError,
  inspectAwsSingleNodeInstance,
  inspectAwsSingleNodeRootVolume,
  inspectAwsSingleNodeSecurityGroup,
} from './single-node-evidence.js';
import {
  createAwsProvisionedResourceRecord,
  createAwsProvisioningMutationAttempt,
  validateAwsProvisioningMutationAttempt,
} from './single-node-journal-evidence.js';
import { createAwsSingleNodeResourceIdentity } from './resource-identity.js';
import {
  createAwsSingleNodeAuthorizeSecurityGroupIngressRequest,
  createAwsSingleNodeCreateSecurityGroupRequest,
  createAwsSingleNodeRunInstancesRequest,
} from './single-node-requests.js';
import { validateAwsSingleNodeProvisioningIntent } from './single-node-provisioning-intent.js';

export const AWS_SINGLE_NODE_PROVISIONING_MAX_ATTEMPTS = 90;
export const AWS_SINGLE_NODE_PROVISIONING_DEADLINE_MS = 5 * 60 * 1000;
export const AWS_SINGLE_NODE_PROVISIONING_POLL_INTERVAL_MS = 2 * 1000;
export const AWS_SINGLE_NODE_PROVISIONING_RESULT_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_PROVISIONING_RESULT_KIND =
  'awsSingleNodeProvisioningResult';
export const AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_KIND =
  'awsSingleNodePreparedCreateReconciliationResult';
const RESOURCE_ROLES = Object.freeze([
  'securityGroup',
  'instance',
  'rootVolume',
]);
const RESOURCE_ID_PATTERNS = Object.freeze({
  securityGroup: /^sg-[0-9a-f]{8,32}$/u,
  instance: /^i-[0-9a-f]{8,32}$/u,
  rootVolume: /^vol-[0-9a-f]{8,32}$/u,
});
const CONVERGE_KEYS = new Set([
  'intent',
  'cloudInitBytes',
  'storedResourceIds',
  'storedMutationAttempts',
  'api',
  'recordMutationAttempts',
  'recordResource',
]);
const VERIFY_KEYS = new Set([
  'intent',
  'storedResourceIds',
  'storedMutationAttempts',
  'api',
]);
const FACTORY_KEYS = new Set(['now', 'sleep']);
const RECOVERY_KEYS = new Set(RESOURCE_ROLES);
const READ_METHODS = Object.freeze([
  'describeSecurityGroups',
  'describeInstances',
  'describeVolumes',
  'describeInstanceCreditSpecifications',
]);
const MUTATION_METHODS = Object.freeze([
  'createSecurityGroup',
  'authorizeSecurityGroupIngress',
  'runInstances',
]);

/** A fixed safe stop for ownership, lifecycle, durable-state, or spec drift. */
export class AwsSingleNodeProvisioningConflictError extends Error {
  /** @param {string} stage */
  constructor(stage) {
    super('AWS single-node provisioning encountered a safe conflict.');
    this.name = 'AwsSingleNodeProvisioningConflictError';
    this.code = 'AWS_SINGLE_NODE_PROVISIONING_CONFLICT';
    this.stage = stage;
  }
}

/** A fixed retryable failure outside provider settlement polling. */
export class AwsSingleNodeProvisioningTransientError extends Error {
  /** @param {string} stage */
  constructor(stage) {
    super('AWS single-node provisioning could not be verified safely.');
    this.name = 'AwsSingleNodeProvisioningTransientError';
    this.code = 'AWS_SINGLE_NODE_PROVISIONING_TRANSIENT';
    this.stage = stage;
  }
}

/** The explicit attempt/deadline recovery window was exhausted. */
export class AwsSingleNodeProvisioningTimeoutError extends Error {
  /** @param {string} stage */
  constructor(stage) {
    super('AWS single-node provisioning did not settle in its bounded window.');
    this.name = 'AwsSingleNodeProvisioningTimeoutError';
    this.code = 'AWS_SINGLE_NODE_PROVISIONING_TIMEOUT';
    this.stage = stage;
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.isFrozen(value) ||
    ArrayBuffer.isView(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value
 * @param {Set<string>} expected
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactDataObject(value, expected, valuePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const keys = Reflect.ownKeys(object);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== 'string' || !expected.has(key))
  ) {
    throw new TypeError(`${valuePath} fields are invalid.`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data field.`);
    }
  }
  return object;
}

/**
 * Snapshot functions without retaining a receiver containing sibling powers.
 * @param {unknown} value
 * @param {readonly string[]} methods
 * @param {string} valuePath
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotFunctions(value, methods, valuePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  /** @type {Record<string, Function>} */
  const result = {};
  for (const method of methods) {
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(`${valuePath}.${method} must be an own function.`);
    }
    result[method] = descriptor.value;
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value
 * @param {string} role
 * @param {string} valuePath
 * @returns {string|null}
 */
function optionalResourceId(value, role, valuePath) {
  if (value === null) return null;
  const pattern =
    RESOURCE_ID_PATTERNS[
      /** @type {keyof typeof RESOURCE_ID_PATTERNS} */ (role)
    ];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${valuePath} is not a canonical AWS resource ID.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, string|null>>}
 */
function validateStoredResourceIds(value) {
  const input = exactDataObject(
    value,
    RECOVERY_KEYS,
    'awsProvisioning.storedResourceIds',
  );
  /** @type {Record<string, string|null>} */
  const result = {};
  for (const role of RESOURCE_ROLES) {
    result[role] = optionalResourceId(
      input[role],
      role,
      `awsProvisioning.storedResourceIds.${role}`,
    );
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} intent
 * @returns {Readonly<Record<string, Readonly<Record<string, any>>|null>>}
 */
function validateStoredMutationAttempts(value, intent) {
  const input = exactDataObject(
    value,
    RECOVERY_KEYS,
    'awsProvisioning.storedMutationAttempts',
  );
  /** @type {Record<string, Readonly<Record<string, any>>|null>} */
  const result = {};
  try {
    for (const role of RESOURCE_ROLES) {
      result[role] =
        input[role] === null
          ? null
          : validateAwsProvisioningMutationAttempt(
              input[role],
              intent,
              role,
              `awsProvisioning.storedMutationAttempts.${role}`,
            );
    }
  } catch {
    throw new AwsSingleNodeProvisioningConflictError('recovery');
  }
  if ((result.instance === null) !== (result.rootVolume === null)) {
    throw new AwsSingleNodeProvisioningConflictError('recovery');
  }
  if (result.instance !== null && result.securityGroup === null) {
    throw new AwsSingleNodeProvisioningConflictError('recovery');
  }
  return Object.freeze(result);
}

/**
 * @param {Readonly<Record<string, string|null>>} ids
 * @param {Readonly<Record<string, Readonly<Record<string, any>>|null>>} attempts
 */
function assertStoredAuthority(ids, attempts) {
  for (const role of RESOURCE_ROLES) {
    if (ids[role] !== null && attempts[role] === null) {
      throw new AwsSingleNodeProvisioningConflictError('recovery');
    }
  }
}

/**
 * Copy and bind bootstrap bytes before any asynchronous operation.
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} intent
 * @returns {Buffer}
 */
function snapshotCloudInit(value, intent) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError('awsProvisioning.cloudInitBytes must be bytes.');
  }
  const bytes = Buffer.from(value);
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > SINGLE_NODE_CLOUD_INIT_MAX_BYTES
  ) {
    throw new RangeError(
      `awsProvisioning.cloudInitBytes must contain between 1 and ${SINGLE_NODE_CLOUD_INIT_MAX_BYTES} bytes.`,
    );
  }
  if (sha256Base64Url(bytes) !== intent.cloudInitDigest.value) {
    throw new Error(
      'awsProvisioning.cloudInitBytes do not match the persisted digest.',
    );
  }
  return bytes;
}

/**
 * @param {unknown} value
 * @param {boolean} mutations
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotApi(value, mutations) {
  return snapshotFunctions(
    value,
    mutations ? [...READ_METHODS, ...MUTATION_METHODS] : READ_METHODS,
    'awsProvisioning.api',
  );
}

/**
 * @param {Record<string, any>} input
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotCallbacks(input) {
  if (
    typeof input.recordMutationAttempts !== 'function' ||
    typeof input.recordResource !== 'function'
  ) {
    throw new TypeError('awsProvisioning callbacks must be functions.');
  }
  return Object.freeze({
    recordMutationAttempts: input.recordMutationAttempts,
    recordResource: input.recordResource,
  });
}

/**
 * Parse all synchronous convergence authority before the first await.
 * @param {unknown} value
 * @param {'converge'|'destroy'} mode
 * @returns {Readonly<Record<string, any>>}
 */
function prepareMutationContext(value, mode) {
  const input = exactDataObject(value, CONVERGE_KEYS, 'awsProvisioning');
  const intent = validateAwsSingleNodeProvisioningIntent(
    input.intent,
    'awsProvisioning.intent',
  );
  const storedResourceIds = validateStoredResourceIds(input.storedResourceIds);
  const storedMutationAttempts = validateStoredMutationAttempts(
    input.storedMutationAttempts,
    intent,
  );
  assertStoredAuthority(storedResourceIds, storedMutationAttempts);
  const cloudInitBytes =
    mode === 'destroy' &&
    storedMutationAttempts.instance === null &&
    input.cloudInitBytes === null
      ? null
      : snapshotCloudInit(input.cloudInitBytes, intent);
  return deepFreeze({
    mode,
    intent,
    cloudInitBytes,
    storedResourceIds,
    storedMutationAttempts,
    identities: {
      securityGroup: createAwsSingleNodeResourceIdentity(
        intent,
        'securityGroup',
      ),
      instance: createAwsSingleNodeResourceIdentity(intent, 'instance'),
      rootVolume: createAwsSingleNodeResourceIdentity(intent, 'rootVolume'),
    },
    api: snapshotApi(input.api, true),
    callbacks: snapshotCallbacks(input),
  });
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
function prepareVerificationContext(value) {
  const input = exactDataObject(
    value,
    VERIFY_KEYS,
    'awsProvisioningVerification',
  );
  const intent = validateAwsSingleNodeProvisioningIntent(
    input.intent,
    'awsProvisioningVerification.intent',
  );
  const storedResourceIds = validateStoredResourceIds(input.storedResourceIds);
  const storedMutationAttempts = validateStoredMutationAttempts(
    input.storedMutationAttempts,
    intent,
  );
  assertStoredAuthority(storedResourceIds, storedMutationAttempts);
  return deepFreeze({
    mode: 'verify',
    intent,
    storedResourceIds,
    storedMutationAttempts,
    api: snapshotApi(input.api, false),
  });
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function monotonicTime(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(
      'awsProvisioning clock must return monotonic milliseconds.',
    );
  }
  return value;
}

/**
 * @param {Readonly<Record<string, Function>>} clock
 * @returns {Readonly<Record<string, Function>>}
 */
function createBudget(clock) {
  let last = monotonicTime(Reflect.apply(clock.now, undefined, []));
  const started = last;
  let attempts = 0;

  /** @returns {number} */
  function readNow() {
    const current = monotonicTime(Reflect.apply(clock.now, undefined, []));
    if (current < last) {
      throw new TypeError(
        'awsProvisioning clock must return monotonic milliseconds.',
      );
    }
    last = current;
    return current;
  }

  /** @param {string} stage */
  function enter(stage) {
    const current = readNow();
    if (
      attempts >= AWS_SINGLE_NODE_PROVISIONING_MAX_ATTEMPTS ||
      current - started >= AWS_SINGLE_NODE_PROVISIONING_DEADLINE_MS
    ) {
      throw new AwsSingleNodeProvisioningTimeoutError(stage);
    }
    attempts += 1;
  }

  /** @param {string} stage */
  async function pause(stage) {
    const current = readNow();
    const remaining =
      AWS_SINGLE_NODE_PROVISIONING_DEADLINE_MS - (current - started);
    if (
      attempts >= AWS_SINGLE_NODE_PROVISIONING_MAX_ATTEMPTS ||
      remaining <= 0
    ) {
      throw new AwsSingleNodeProvisioningTimeoutError(stage);
    }
    try {
      await Reflect.apply(clock.sleep, undefined, [
        Math.min(AWS_SINGLE_NODE_PROVISIONING_POLL_INTERVAL_MS, remaining),
      ]);
    } catch {
      throw new AwsSingleNodeProvisioningTransientError(stage);
    }
  }

  return Object.freeze({ enter, pause });
}

/**
 * Normalize an evidence error without exposing provider details.
 * @param {unknown} error
 * @param {string} stage
 * @returns {'transient'}
 */
function classifyEvidenceFailure(error, stage) {
  if (error instanceof AwsSingleNodeEvidenceTransientError) {
    return 'transient';
  }
  if (
    error instanceof AwsSingleNodeEvidenceConflictError ||
    error instanceof AwsSingleNodeEvidenceUnknownError
  ) {
    throw new AwsSingleNodeProvisioningConflictError(stage);
  }
  throw new AwsSingleNodeProvisioningTransientError(stage);
}

/**
 * @param {Function} inspect
 * @param {Readonly<Record<string, any>>} value
 * @param {string} stage
 * @returns {Promise<Readonly<Record<string, any>>|null>}
 */
async function inspectSafely(inspect, value, stage) {
  try {
    return await Reflect.apply(inspect, undefined, [value]);
  } catch (error) {
    classifyEvidenceFailure(error, stage);
    return null;
  }
}

/**
 * Provider mutation responses and errors are hints only. Readback decides.
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} method
 * @param {Readonly<Record<string, any>>} request
 */
async function issueMutationHint(api, method, request) {
  try {
    await Reflect.apply(api[method], undefined, [request]);
  } catch {
    // The operation may have committed before its response was lost.
  }
}

/**
 * @param {Readonly<Record<string, Function>>} callbacks
 * @param {Readonly<Record<string, any>>[]} attempts
 * @param {string} stage
 */
async function recordAttempts(callbacks, attempts, stage) {
  try {
    await Reflect.apply(callbacks.recordMutationAttempts, undefined, [
      deepFreeze([...attempts]),
    ]);
  } catch {
    throw new AwsSingleNodeProvisioningTransientError(stage);
  }
}

/**
 * @param {Readonly<Record<string, any>>} context
 * @param {string} role
 * @param {string} id
 */
async function recordResource(context, role, id) {
  if (context.storedResourceIds[role] !== null) {
    if (context.storedResourceIds[role] !== id) {
      throw new AwsSingleNodeProvisioningConflictError(role);
    }
    return;
  }
  const record = createAwsProvisionedResourceRecord(context.intent, role, id);
  try {
    await Reflect.apply(context.callbacks.recordResource, undefined, [record]);
  } catch {
    throw new AwsSingleNodeProvisioningTransientError(role);
  }
}

/**
 * @param {Readonly<Record<string, any>>} context
 * @param {Readonly<Record<string, Function>>} budget
 * @returns {Promise<string|null>}
 */
async function ensureSecurityGroup(context, budget) {
  let attempt = context.storedMutationAttempts.securityGroup;
  let createIssued = false;
  const issuedIngress = new Set();
  while (true) {
    budget.enter('securityGroup');
    const observed = await inspectSafely(
      inspectAwsSingleNodeSecurityGroup,
      {
        intent: context.intent,
        storedResourceId: context.storedResourceIds.securityGroup,
        api: context.api,
      },
      'securityGroup',
    );
    if (observed === null) {
      await budget.pause('securityGroup');
      continue;
    }
    if (observed.ownershipStatus === 'absent') {
      if (
        observed.status !== 'absent' ||
        observed.specStatus !== 'absent' ||
        observed.securityGroupId !== null ||
        context.storedResourceIds.securityGroup !== null
      ) {
        throw new AwsSingleNodeProvisioningConflictError('securityGroup');
      }
      if (context.mode === 'verify') {
        throw new AwsSingleNodeProvisioningConflictError('securityGroup');
      }
      if (attempt === null) {
        if (context.mode === 'destroy') return null;
        attempt = createAwsProvisioningMutationAttempt(
          context.intent,
          'securityGroup',
        );
        await recordAttempts(context.callbacks, [attempt], 'securityGroup');
      }
      if (!createIssued) {
        await issueMutationHint(
          context.api,
          'createSecurityGroup',
          createAwsSingleNodeCreateSecurityGroupRequest({
            provisioningIntent: context.intent,
            securityGroupIdentity: context.identities.securityGroup,
          }),
        );
        createIssued = true;
        continue;
      }
      await budget.pause('securityGroup');
      createIssued = false;
      continue;
    }
    if (
      observed.status !== 'present' ||
      observed.ownershipStatus !== 'owned' ||
      typeof observed.securityGroupId !== 'string' ||
      attempt === null
    ) {
      throw new AwsSingleNodeProvisioningConflictError('securityGroup');
    }
    const securityGroupId = optionalResourceId(
      observed.securityGroupId,
      'securityGroup',
      'awsProvisioning.securityGroupId',
    );
    if (securityGroupId === null) {
      throw new AwsSingleNodeProvisioningConflictError('securityGroup');
    }
    if (context.mode === 'destroy') {
      await recordResource(context, 'securityGroup', securityGroupId);
      return securityGroupId;
    }
    if (observed.specStatus === 'conflict') {
      throw new AwsSingleNodeProvisioningConflictError('securityGroup');
    }
    if (
      observed.specStatus === 'exact' &&
      Array.isArray(observed.missingIpv4) &&
      observed.missingIpv4.length === 0
    ) {
      if (context.mode === 'converge') {
        await recordResource(context, 'securityGroup', securityGroupId);
      }
      return securityGroupId;
    }
    if (
      observed.specStatus !== 'incomplete' ||
      !Array.isArray(observed.missingIpv4) ||
      observed.missingIpv4.length === 0
    ) {
      throw new AwsSingleNodeProvisioningConflictError('securityGroup');
    }
    if (context.mode === 'converge') {
      const ingressKey = JSON.stringify(observed.missingIpv4);
      if (!issuedIngress.has(ingressKey)) {
        await issueMutationHint(
          context.api,
          'authorizeSecurityGroupIngress',
          createAwsSingleNodeAuthorizeSecurityGroupIngressRequest({
            provisioningIntent: context.intent,
            securityGroupIdentity: context.identities.securityGroup,
            securityGroupId,
            allowedIpv4: observed.missingIpv4,
          }),
        );
        issuedIngress.add(ingressKey);
        continue;
      }
    }
    await budget.pause('securityGroup');
    issuedIngress.delete(JSON.stringify(observed.missingIpv4));
  }
}

/**
 * @param {Readonly<Record<string, any>>} context
 * @param {Readonly<Record<string, Function>>} budget
 * @param {string} securityGroupId
 * @returns {Promise<Readonly<Record<string, any>>|null>}
 */
async function ensureCompute(context, budget, securityGroupId) {
  let instanceAttempt = context.storedMutationAttempts.instance;
  let rootVolumeAttempt = context.storedMutationAttempts.rootVolume;
  let runIssued = false;
  while (true) {
    budget.enter('instance');
    const instance = await inspectSafely(
      inspectAwsSingleNodeInstance,
      {
        intent: context.intent,
        securityGroupId,
        storedResourceId: context.storedResourceIds.instance,
        api: context.api,
      },
      'instance',
    );
    if (instance === null) {
      await budget.pause('instance');
      continue;
    }
    if (instance.ownershipStatus === 'absent') {
      if (
        instance.status !== 'absent' ||
        instance.specStatus !== 'absent' ||
        instance.instanceId !== null ||
        context.storedResourceIds.instance !== null ||
        context.storedResourceIds.rootVolume !== null
      ) {
        throw new AwsSingleNodeProvisioningConflictError('instance');
      }
      if (context.mode === 'verify') {
        throw new AwsSingleNodeProvisioningConflictError('instance');
      }
      if (instanceAttempt === null || rootVolumeAttempt === null) {
        if (instanceAttempt !== null || rootVolumeAttempt !== null) {
          throw new AwsSingleNodeProvisioningConflictError('recovery');
        }
        if (context.mode === 'destroy') return null;
        instanceAttempt = createAwsProvisioningMutationAttempt(
          context.intent,
          'instance',
        );
        rootVolumeAttempt = createAwsProvisioningMutationAttempt(
          context.intent,
          'rootVolume',
        );
        await recordAttempts(
          context.callbacks,
          [instanceAttempt, rootVolumeAttempt],
          'instance',
        );
      }
      if (!runIssued) {
        await issueMutationHint(
          context.api,
          'runInstances',
          createAwsSingleNodeRunInstancesRequest({
            provisioningIntent: context.intent,
            securityGroupIdentity: context.identities.securityGroup,
            instanceIdentity: context.identities.instance,
            rootVolumeIdentity: context.identities.rootVolume,
            securityGroupId,
            cloudInitBytes: context.cloudInitBytes,
          }),
        );
        runIssued = true;
        continue;
      }
      await budget.pause('instance');
      runIssued = false;
      continue;
    }
    if (
      instance.ownershipStatus !== 'owned' ||
      typeof instance.instanceId !== 'string' ||
      instanceAttempt === null ||
      rootVolumeAttempt === null
    ) {
      throw new AwsSingleNodeProvisioningConflictError('instance');
    }
    const instanceId = optionalResourceId(
      instance.instanceId,
      'instance',
      'awsProvisioning.instanceId',
    );
    if (instanceId === null) {
      throw new AwsSingleNodeProvisioningConflictError('instance');
    }
    if (context.mode === 'destroy') {
      await recordResource(context, 'instance', instanceId);
    }
    if (
      context.mode !== 'destroy' &&
      (instance.status === 'terminal' ||
        instance.specStatus === 'conflict' ||
        ['stopping', 'stopped', 'shutting-down', 'terminated'].includes(
          instance.instanceState,
        ))
    ) {
      throw new AwsSingleNodeProvisioningConflictError('instance');
    }
    if (
      instance.rootVolumeId === null ||
      (context.storedResourceIds.rootVolume !== null &&
        instance.rootVolumeId !== context.storedResourceIds.rootVolume)
    ) {
      if (instance.rootVolumeId !== null) {
        throw new AwsSingleNodeProvisioningConflictError('rootVolume');
      }
      await budget.pause('rootVolume');
      continue;
    }
    const rootVolumeId = optionalResourceId(
      instance.rootVolumeId,
      'rootVolume',
      'awsProvisioning.rootVolumeId',
    );
    if (rootVolumeId === null) {
      throw new AwsSingleNodeProvisioningConflictError('rootVolume');
    }
    const rootVolume = await inspectSafely(
      inspectAwsSingleNodeRootVolume,
      {
        intent: context.intent,
        instanceId,
        rootVolumeId,
        api: context.api,
      },
      'rootVolume',
    );
    if (rootVolume === null) {
      await budget.pause('rootVolume');
      continue;
    }
    if (rootVolume.ownershipStatus === 'absent') {
      if (
        rootVolume.status !== 'absent' ||
        rootVolume.specStatus !== 'absent' ||
        rootVolume.volumeId !== null ||
        context.storedResourceIds.rootVolume !== null
      ) {
        throw new AwsSingleNodeProvisioningConflictError('rootVolume');
      }
      await budget.pause('rootVolume');
      continue;
    }
    if (
      rootVolume.ownershipStatus !== 'owned' ||
      rootVolume.volumeId !== rootVolumeId
    ) {
      throw new AwsSingleNodeProvisioningConflictError('rootVolume');
    }
    if (rootVolume.attachmentStatus === 'unexpected') {
      throw new AwsSingleNodeProvisioningConflictError('rootVolume');
    }
    if (context.mode === 'destroy') {
      await recordResource(context, 'rootVolume', rootVolumeId);
      return deepFreeze({
        instanceId,
        rootVolumeId,
        publicIpv4:
          typeof instance.publicIpv4 === 'string' ? instance.publicIpv4 : null,
      });
    }
    if (
      rootVolume.specStatus === 'conflict' ||
      rootVolume.status === 'deleting' ||
      rootVolume.status === 'available'
    ) {
      throw new AwsSingleNodeProvisioningConflictError('rootVolume');
    }
    const settled =
      instance.status === 'present' &&
      instance.instanceState === 'running' &&
      instance.specStatus === 'exact' &&
      typeof instance.publicIpv4 === 'string' &&
      isIPv4(instance.publicIpv4) &&
      rootVolume.status === 'present' &&
      rootVolume.volumeState === 'in-use' &&
      rootVolume.attachmentStatus === 'expected' &&
      rootVolume.specStatus === 'exact';
    if (!settled) {
      await budget.pause('instance');
      continue;
    }
    if (context.mode === 'converge') {
      await recordResource(context, 'instance', instanceId);
      await recordResource(context, 'rootVolume', rootVolumeId);
    }
    return deepFreeze({
      instanceId,
      rootVolumeId,
      publicIpv4: instance.publicIpv4,
    });
  }
}

/**
 * @param {Readonly<Record<string, any>>} intent
 * @param {string} securityGroupId
 * @param {Readonly<Record<string, any>>} compute
 * @returns {Readonly<Record<string, any>>}
 */
function provisioningResult(intent, securityGroupId, compute) {
  const result = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: AWS_SINGLE_NODE_PROVISIONING_RESULT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_PROVISIONING_RESULT_KIND,
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      providerSpecId: intent.plan.providerSpec.providerSpecId,
      desiredRevisionId: intent.plan.desired.desiredRevisionId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      resources: {
        securityGroupId,
        instanceId: compute.instanceId,
        rootVolumeId: compute.rootVolumeId,
      },
      publicIpv4: compute.publicIpv4,
      status: 'provisioned',
    }),
  );
  assertManifestIsSecretFree(result, 'awsProvisioning.result');
  return result;
}

/**
 * @param {Readonly<Record<string, any>>} context
 * @param {string|null} securityGroupId
 * @param {Readonly<Record<string, any>>|null} compute
 * @returns {Readonly<Record<string, any>>}
 */
function reconciliationResult(context, securityGroupId, compute) {
  const result = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_KIND,
      provisioningIntentId: context.intent.provisioningIntentId,
      planId: context.intent.plan.planId,
      deploymentInstanceId: context.intent.plan.deploymentInstanceId,
      incarnationId: context.intent.incarnationId,
      resources: {
        securityGroupId:
          securityGroupId ?? context.storedResourceIds.securityGroup,
        instanceId: compute?.instanceId ?? context.storedResourceIds.instance,
        rootVolumeId:
          compute?.rootVolumeId ?? context.storedResourceIds.rootVolume,
      },
      status: 'reconciled',
    }),
  );
  assertManifestIsSecretFree(
    result,
    'awsProvisioning.preparedCreateReconciliationResult',
  );
  return result;
}

/**
 * Create a testable converger with a monotonic clock and isolated sleep port.
 * @param {unknown} dependencies
 * @returns {Readonly<Record<string, Function>>}
 */
export function createAwsSingleNodeProvisioningConverger(dependencies) {
  const ports = exactDataObject(
    dependencies,
    FACTORY_KEYS,
    'awsProvisioningConverger',
  );
  const clock = snapshotFunctions(
    ports,
    ['now', 'sleep'],
    'awsProvisioningConverger',
  );

  return Object.freeze({
    async converge(/** @type {unknown} */ value) {
      const context = prepareMutationContext(value, 'converge');
      const budget = createBudget(clock);
      const securityGroupId = await ensureSecurityGroup(context, budget);
      if (securityGroupId === null) {
        throw new AwsSingleNodeProvisioningConflictError('securityGroup');
      }
      const compute = await ensureCompute(context, budget, securityGroupId);
      if (compute === null) {
        throw new AwsSingleNodeProvisioningConflictError('instance');
      }
      return provisioningResult(context.intent, securityGroupId, compute);
    },

    async verify(/** @type {unknown} */ value) {
      const context = prepareVerificationContext(value);
      const budget = createBudget(clock);
      const securityGroupId = await ensureSecurityGroup(context, budget);
      if (securityGroupId === null) {
        throw new AwsSingleNodeProvisioningConflictError('securityGroup');
      }
      const compute = await ensureCompute(context, budget, securityGroupId);
      if (compute === null) {
        throw new AwsSingleNodeProvisioningConflictError('instance');
      }
      return provisioningResult(context.intent, securityGroupId, compute);
    },

    async reconcilePreparedCreatesForDestroy(/** @type {unknown} */ value) {
      const context = prepareMutationContext(value, 'destroy');
      const budget = createBudget(clock);
      const securityGroupId = await ensureSecurityGroup(context, budget);
      let compute = null;
      if (context.storedMutationAttempts.instance !== null) {
        if (securityGroupId === null) {
          throw new AwsSingleNodeProvisioningConflictError('securityGroup');
        }
        compute = await ensureCompute(context, budget, securityGroupId);
      }
      return reconciliationResult(context, securityGroupId, compute);
    },
  });
}

const productionConverger = createAwsSingleNodeProvisioningConverger({
  now: () => Number(process.hrtime.bigint() / 1_000_000n),
  sleep: async (/** @type {number} */ milliseconds) =>
    await new Promise((resolve) => setTimeout(resolve, milliseconds)),
});

/**
 * Converge the production AWS single-node provisioning state.
 * @param {unknown} options
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function convergeAwsSingleNodeProvisioning(options) {
  return await Reflect.apply(productionConverger.converge, undefined, [
    options,
  ]);
}

/**
 * Verify an already-provisioned substrate without exposing any write port.
 * @param {unknown} options
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function verifyAwsSingleNodeProvisioning(options) {
  return await Reflect.apply(productionConverger.verify, undefined, [options]);
}

/**
 * Resolve only already-durable prepared creates so destroy can own their IDs.
 * @param {unknown} options
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function reconcileAwsSingleNodePreparedCreatesForDestroy(options) {
  return await Reflect.apply(
    productionConverger.reconcilePreparedCreatesForDestroy,
    undefined,
    [options],
  );
}

export default {
  AWS_SINGLE_NODE_PROVISIONING_DEADLINE_MS,
  AWS_SINGLE_NODE_PROVISIONING_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_PROVISIONING_POLL_INTERVAL_MS,
  AWS_SINGLE_NODE_PROVISIONING_RESULT_KIND,
  AWS_SINGLE_NODE_PROVISIONING_RESULT_SCHEMA_VERSION,
  AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_KIND,
  AWS_SINGLE_NODE_PREPARED_CREATE_RECONCILIATION_RESULT_SCHEMA_VERSION,
  AwsSingleNodeProvisioningConflictError,
  AwsSingleNodeProvisioningTimeoutError,
  AwsSingleNodeProvisioningTransientError,
  convergeAwsSingleNodeProvisioning,
  createAwsSingleNodeProvisioningConverger,
  reconcileAwsSingleNodePreparedCreatesForDestroy,
  verifyAwsSingleNodeProvisioning,
};
