/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This bounded destructive boundary keeps its exact recovery and polling protocol adjacent. */

import { performance } from 'node:perf_hooks';
import { setTimeout as wait } from 'node:timers/promises';

import { sortCanonicalJsonValue } from '../../canonical-order.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import {
  AwsSingleNodeEvidenceConflictError,
  AwsSingleNodeEvidenceTransientError,
  AwsSingleNodeEvidenceUnknownError,
  inspectAwsSingleNodeInstance,
  inspectAwsSingleNodeRootVolume,
  inspectAwsSingleNodeSecurityGroup,
} from './single-node-evidence.js';
import {
  createAwsDeletionRecord,
  createAwsDestructionAttempt,
  validateAwsDeletionRecord,
  validateAwsDestructionAttempt,
} from './single-node-journal-evidence.js';
import { createAwsSingleNodeResourceIdentity } from './resource-identity.js';
import {
  createAwsSingleNodeDeleteSecurityGroupRequest,
  createAwsSingleNodeDeleteVolumeRequest,
  createAwsSingleNodeTerminateInstancesRequest,
} from './single-node-requests.js';
import { validateAwsSingleNodeProvisioningIntent } from './single-node-provisioning-intent.js';

export const AWS_SINGLE_NODE_DESTRUCTION_RESULT_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_DESTRUCTION_RESULT_KIND =
  'awsSingleNodeDestructionResult';
export const AWS_SINGLE_NODE_DESTRUCTION_MAX_ATTEMPTS = 120;
export const AWS_SINGLE_NODE_DESTRUCTION_DEADLINE_MILLISECONDS = 10 * 60 * 1000;
export const AWS_SINGLE_NODE_DESTRUCTION_POLL_INTERVAL_MILLISECONDS = 5000;

const INVALID_DEPENDENCIES =
  'AWS single-node destruction dependencies are invalid.';
const RESOURCE_ROLES = Object.freeze([
  'instance',
  'rootVolume',
  'securityGroup',
]);
const RESOURCE_KEYS = new Set(RESOURCE_ROLES);
const CONVERGE_KEYS = new Set([
  'intent',
  'storedResourceIds',
  'storedDestroyAttempts',
  'storedDeletionRecords',
  'api',
  'recordDestroyAttempt',
  'recordDeletion',
]);
const FACTORY_KEYS = new Set(['now', 'sleep']);
const API_METHODS = Object.freeze([
  'describeSecurityGroups',
  'describeInstanceAttribute',
  'describeInstanceCreditSpecifications',
  'describeInstances',
  'describeVolumes',
  'terminateInstances',
  'deleteVolume',
  'deleteSecurityGroup',
]);
const ID_PATTERNS = Object.freeze({
  instance: /^i-[0-9a-f]{8,32}$/u,
  rootVolume: /^vol-[0-9a-f]{8,32}$/u,
  securityGroup: /^sg-[0-9a-f]{8,32}$/u,
});

/** Exact ownership or lifecycle evidence made deletion unsafe. */
export class AwsSingleNodeDestructionConflictError extends Error {
  /** @param {string} role @param {string} reason */
  constructor(role, reason) {
    super(`AWS single-node ${role} destruction encountered a conflict.`);
    this.name = 'AwsSingleNodeDestructionConflictError';
    this.code = 'AWS_SINGLE_NODE_DESTRUCTION_CONFLICT';
    this.role = role;
    this.reason = reason;
  }
}

/** A durable callback or injected wait failed without exposing its details. */
export class AwsSingleNodeDestructionTransientError extends Error {
  /** @param {string} role @param {string} operation */
  constructor(role, operation) {
    super(`AWS single-node ${role} destruction could not make progress.`);
    this.name = 'AwsSingleNodeDestructionTransientError';
    this.code = 'AWS_SINGLE_NODE_DESTRUCTION_TRANSIENT';
    this.role = role;
    this.operation = operation;
  }
}

/** Bounded exact-resource readback did not establish the next safe state. */
export class AwsSingleNodeDestructionTimeoutError extends Error {
  /** @param {string} role */
  constructor(role) {
    super(`AWS single-node ${role} destruction timed out.`);
    this.name = 'AwsSingleNodeDestructionTimeoutError';
    this.code = 'AWS_SINGLE_NODE_DESTRUCTION_TIMEOUT';
    this.role = role;
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
 * Require one exact own-data object without invoking accessors.
 * @param {unknown} value
 * @param {Set<string>} expected
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactDataObject(value, expected, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const keys = Reflect.ownKeys(object);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== 'string' || !expected.has(key))
  ) {
    throw new TypeError(`${valuePath} fields are invalid.`);
  }
  /** @type {Record<string, any>} */
  const result = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data field.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Snapshot only the exact capabilities this boundary may invoke.
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotApi(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsSingleNodeDestruction.api must be an API client.');
  }
  const object = /** @type {Record<string, any>} */ (value);
  /** @type {Record<string, Function>} */
  const result = {};
  for (const method of API_METHODS) {
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(
        `awsSingleNodeDestruction.api.${method} is required.`,
      );
    }
    result[method] = descriptor.value;
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value
 * @param {string} role
 * @returns {string|null}
 */
function optionalResourceId(value, role) {
  if (value === null) return null;
  const pattern = ID_PATTERNS[/** @type {keyof typeof ID_PATTERNS} */ (role)];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(
      `awsSingleNodeDestruction.storedResourceIds.${role} is invalid.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {Readonly<Record<string, string|null>>}
 */
function storedResourceIds(value) {
  const document = exactDataObject(
    value,
    RESOURCE_KEYS,
    'awsSingleNodeDestruction.storedResourceIds',
  );
  return deepFreeze(
    Object.fromEntries(
      RESOURCE_ROLES.map((role) => [
        role,
        optionalResourceId(document[role], role),
      ]),
    ),
  );
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function storedEvidenceMap(value, valuePath) {
  return exactDataObject(value, RESOURCE_KEYS, valuePath);
}

/**
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} intent
 * @param {Readonly<Record<string, string|null>>} ids
 * @returns {Readonly<Record<string, Readonly<Record<string, any>>|null>>}
 */
function storedAttempts(value, intent, ids) {
  const document = storedEvidenceMap(
    value,
    'awsSingleNodeDestruction.storedDestroyAttempts',
  );
  /** @type {Record<string, Readonly<Record<string, any>>|null>} */
  const result = {};
  for (const role of RESOURCE_ROLES) {
    if (document[role] === null) {
      result[role] = null;
      continue;
    }
    if (ids[role] === null) {
      throw new Error(
        `awsSingleNodeDestruction.storedDestroyAttempts.${role} requires a stored resource ID.`,
      );
    }
    result[role] = validateAwsDestructionAttempt(
      document[role],
      intent,
      role,
      ids[role],
      `awsSingleNodeDestruction.storedDestroyAttempts.${role}`,
    );
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} intent
 * @param {Readonly<Record<string, string|null>>} ids
 * @param {Readonly<Record<string, Readonly<Record<string, any>>|null>>} attempts
 * @returns {Readonly<Record<string, Readonly<Record<string, any>>|null>>}
 */
function storedDeletions(value, intent, ids, attempts) {
  const document = storedEvidenceMap(
    value,
    'awsSingleNodeDestruction.storedDeletionRecords',
  );
  /** @type {Record<string, Readonly<Record<string, any>>|null>} */
  const result = {};
  for (const role of RESOURCE_ROLES) {
    if (document[role] === null) {
      result[role] = null;
      continue;
    }
    if (ids[role] === null) {
      throw new Error(
        `awsSingleNodeDestruction.storedDeletionRecords.${role} requires a stored resource ID.`,
      );
    }
    result[role] = validateAwsDeletionRecord(
      document[role],
      intent,
      role,
      ids[role],
      attempts[role],
      `awsSingleNodeDestruction.storedDeletionRecords.${role}`,
    );
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value
 * @returns {{now: Function, sleep: Function}}
 */
function factoryDependencies(value) {
  const document = exactDataObject(
    value,
    FACTORY_KEYS,
    'awsSingleNodeDestruction dependencies',
  );
  if (
    typeof document.now !== 'function' ||
    typeof document.sleep !== 'function'
  ) {
    throw new TypeError(INVALID_DEPENDENCIES);
  }
  return { now: document.now, sleep: document.sleep };
}

/**
 * @param {Function} now
 * @param {Function} sleep
 * @returns {Readonly<Record<string, Function>>}
 */
function createTiming(now, sleep) {
  let prior = Number.NEGATIVE_INFINITY;

  /** @returns {number} */
  function readClock() {
    let current;
    try {
      current = Reflect.apply(now, undefined, []);
    } catch {
      throw new TypeError(INVALID_DEPENDENCIES);
    }
    if (
      typeof current !== 'number' ||
      !Number.isFinite(current) ||
      current < prior
    ) {
      throw new TypeError(INVALID_DEPENDENCIES);
    }
    prior = current;
    return current;
  }

  /**
   * @param {string} role
   * @param {number} milliseconds
   */
  async function pause(role, milliseconds) {
    try {
      await Reflect.apply(sleep, undefined, [milliseconds]);
    } catch {
      throw new AwsSingleNodeDestructionTransientError(role, 'sleep');
    }
  }

  return Object.freeze({ readClock, pause });
}

/**
 * @param {Readonly<Record<string, Function>>} timing
 * @returns {{deadline: number, attempts: number}}
 */
function createBudget(timing) {
  return {
    deadline:
      timing.readClock() + AWS_SINGLE_NODE_DESTRUCTION_DEADLINE_MILLISECONDS,
    attempts: 0,
  };
}

/**
 * @param {string} role
 * @param {{deadline: number, attempts: number}} budget
 * @param {Readonly<Record<string, Function>>} timing
 */
function consumeAttempt(role, budget, timing) {
  if (
    budget.attempts >= AWS_SINGLE_NODE_DESTRUCTION_MAX_ATTEMPTS ||
    timing.readClock() >= budget.deadline
  ) {
    throw new AwsSingleNodeDestructionTimeoutError(role);
  }
  budget.attempts += 1;
}

/**
 * @param {string} role
 * @param {{deadline: number, attempts: number}} budget
 * @param {Readonly<Record<string, Function>>} timing
 */
async function pauseBeforeRetry(role, budget, timing) {
  const current = timing.readClock();
  if (
    budget.attempts >= AWS_SINGLE_NODE_DESTRUCTION_MAX_ATTEMPTS ||
    current >= budget.deadline
  ) {
    throw new AwsSingleNodeDestructionTimeoutError(role);
  }
  await timing.pause(
    role,
    Math.min(
      AWS_SINGLE_NODE_DESTRUCTION_POLL_INTERVAL_MILLISECONDS,
      Math.max(1, budget.deadline - current),
    ),
  );
  if (timing.readClock() >= budget.deadline) {
    throw new AwsSingleNodeDestructionTimeoutError(role);
  }
}

/**
 * Map only fixed evidence failures; provider details never cross this boundary.
 * @param {string} role
 * @param {unknown} error
 * @returns {'retry'}
 */
function classifyInspectionFailure(role, error) {
  if (error instanceof AwsSingleNodeEvidenceTransientError) return 'retry';
  if (error instanceof AwsSingleNodeEvidenceConflictError) {
    throw new AwsSingleNodeDestructionConflictError(
      role,
      'ownership-ambiguity',
    );
  }
  if (error instanceof AwsSingleNodeEvidenceUnknownError) {
    throw new AwsSingleNodeDestructionConflictError(role, 'unknown-evidence');
  }
  throw new AwsSingleNodeDestructionConflictError(role, 'unknown-evidence');
}

/**
 * @param {string} role
 * @param {Function} inspector
 * @param {Readonly<Record<string, any>>} input
 * @param {{deadline: number, attempts: number}} budget
 * @param {Readonly<Record<string, Function>>} timing
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function inspectBounded(role, inspector, input, budget, timing) {
  for (;;) {
    consumeAttempt(role, budget, timing);
    try {
      return await Reflect.apply(inspector, undefined, [input]);
    } catch (error) {
      classifyInspectionFailure(role, error);
      await pauseBeforeRetry(role, budget, timing);
    }
  }
}

/**
 * @param {Readonly<Record<string, any>>} attempt
 * @param {Function} callback
 */
async function persistAttempt(attempt, callback) {
  try {
    await Reflect.apply(callback, undefined, [attempt]);
  } catch {
    throw new AwsSingleNodeDestructionTransientError(
      attempt.role,
      'record-destroy-attempt',
    );
  }
}

/**
 * @param {Readonly<Record<string, any>>} deletion
 * @param {Function} callback
 */
async function persistDeletion(deletion, callback) {
  try {
    await Reflect.apply(callback, undefined, [deletion]);
  } catch {
    throw new AwsSingleNodeDestructionTransientError(
      deletion.role,
      'record-deletion',
    );
  }
}

/**
 * @param {Readonly<Record<string, any>>} intent
 * @param {string} role
 * @param {string} id
 * @param {Readonly<Record<string, any>>|null} attempt
 * @param {Function} callback
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function recordAbsence(intent, role, id, attempt, callback) {
  const deletion = createAwsDeletionRecord(intent, role, id, attempt);
  await persistDeletion(deletion, callback);
  return deletion;
}

/**
 * @param {string} role
 * @param {Readonly<Record<string, any>>} observation
 * @param {string} expectedId
 * @param {string} idKey
 */
function assertOwnedObservation(role, observation, expectedId, idKey) {
  if (
    observation.ownershipStatus !== 'owned' ||
    observation[idKey] !== expectedId
  ) {
    throw new AwsSingleNodeDestructionConflictError(role, 'ownership-mismatch');
  }
}

/** @param {Readonly<Record<string, any>>} observation @returns {boolean} */
function instanceIsAbsent(observation) {
  return (
    observation.status === 'absent' ||
    (observation.status === 'terminal' &&
      ['shutting-down', 'terminated'].includes(observation.instanceState))
  );
}

/**
 * @param {Readonly<Record<string, any>>} intent
 * @param {string|null} id
 * @param {string|null} securityGroupId
 * @param {Readonly<Record<string, any>>|null} storedAttempt
 * @param {Readonly<Record<string, any>>|null} storedDeletion
 * @param {Readonly<Record<string, Function>>} api
 * @param {Function} recordDestroyAttempt
 * @param {Function} recordDeletion
 * @param {Readonly<Record<string, Function>>} timing
 * @returns {Promise<Readonly<Record<string, any>>|null>}
 */
async function destroyInstance(
  intent,
  id,
  securityGroupId,
  storedAttempt,
  storedDeletion,
  api,
  recordDestroyAttempt,
  recordDeletion,
  timing,
) {
  if (id === null) return null;
  if (securityGroupId === null) {
    throw new AwsSingleNodeDestructionConflictError(
      'instance',
      'security-group-id-required',
    );
  }
  const budget = createBudget(timing);
  const inspectionInput = deepFreeze({
    intent,
    securityGroupId,
    storedResourceId: id,
    api,
  });
  let observation = await inspectBounded(
    'instance',
    inspectAwsSingleNodeInstance,
    inspectionInput,
    budget,
    timing,
  );
  if (!instanceIsAbsent(observation)) {
    assertOwnedObservation('instance', observation, id, 'instanceId');
  }
  if (storedDeletion !== null) {
    if (!instanceIsAbsent(observation)) {
      throw new AwsSingleNodeDestructionConflictError(
        'instance',
        'resource-reappeared',
      );
    }
    return storedDeletion;
  }
  if (instanceIsAbsent(observation)) {
    return await recordAbsence(
      intent,
      'instance',
      id,
      storedAttempt,
      recordDeletion,
    );
  }

  const attempt =
    storedAttempt ?? createAwsDestructionAttempt(intent, 'instance', id);
  if (storedAttempt === null) {
    await persistAttempt(attempt, recordDestroyAttempt);
  }
  const request = createAwsSingleNodeTerminateInstancesRequest({
    provisioningIntent: intent,
    instanceIdentity: createAwsSingleNodeResourceIdentity(intent, 'instance'),
    instanceId: id,
  });
  for (;;) {
    try {
      await Reflect.apply(api.terminateInstances, undefined, [request]);
    } catch {
      // Mutation failure is ambiguous. Only exact readback decides progress.
    }
    observation = await inspectBounded(
      'instance',
      inspectAwsSingleNodeInstance,
      inspectionInput,
      budget,
      timing,
    );
    if (instanceIsAbsent(observation)) {
      return await recordAbsence(
        intent,
        'instance',
        id,
        attempt,
        recordDeletion,
      );
    }
    assertOwnedObservation('instance', observation, id, 'instanceId');
    await pauseBeforeRetry('instance', budget, timing);
  }
}

/**
 * @param {Readonly<Record<string, any>>} observation
 * @param {string} id
 */
function assertRootObservation(observation, id) {
  assertOwnedObservation('rootVolume', observation, id, 'volumeId');
  if (observation.attachmentStatus === 'unexpected') {
    throw new AwsSingleNodeDestructionConflictError(
      'rootVolume',
      'unexpected-attachment',
    );
  }
}

/**
 * Wait until one owned root is absent or safely available.
 * @param {Readonly<Record<string, any>>} initial
 * @param {string} id
 * @param {Function} inspector
 * @param {Readonly<Record<string, any>>} input
 * @param {{deadline: number, attempts: number}} budget
 * @param {Readonly<Record<string, Function>>} timing
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function waitForRootDisposition(
  initial,
  id,
  inspector,
  input,
  budget,
  timing,
) {
  let observation = initial;
  for (;;) {
    if (observation.status === 'absent') return observation;
    assertRootObservation(observation, id);
    if (
      observation.status === 'available' &&
      observation.attachmentStatus === 'none'
    ) {
      return observation;
    }
    await pauseBeforeRetry('rootVolume', budget, timing);
    observation = await inspectBounded(
      'rootVolume',
      inspector,
      input,
      budget,
      timing,
    );
  }
}

/**
 * @param {Readonly<Record<string, any>>} intent
 * @param {string|null} id
 * @param {string|null} instanceId
 * @param {Readonly<Record<string, any>>|null} storedAttempt
 * @param {Readonly<Record<string, any>>|null} storedDeletion
 * @param {Readonly<Record<string, Function>>} api
 * @param {Function} recordDestroyAttempt
 * @param {Function} recordDeletion
 * @param {Readonly<Record<string, Function>>} timing
 * @returns {Promise<Readonly<Record<string, any>>|null>}
 */
async function destroyRootVolume(
  intent,
  id,
  instanceId,
  storedAttempt,
  storedDeletion,
  api,
  recordDestroyAttempt,
  recordDeletion,
  timing,
) {
  if (id === null) return null;
  if (instanceId === null) {
    throw new AwsSingleNodeDestructionConflictError(
      'rootVolume',
      'instance-id-required',
    );
  }
  const budget = createBudget(timing);
  const inspectionInput = deepFreeze({
    intent,
    instanceId,
    rootVolumeId: id,
    api,
  });
  let observation = await inspectBounded(
    'rootVolume',
    inspectAwsSingleNodeRootVolume,
    inspectionInput,
    budget,
    timing,
  );
  if (storedDeletion !== null) {
    if (observation.status !== 'absent') {
      throw new AwsSingleNodeDestructionConflictError(
        'rootVolume',
        'resource-reappeared',
      );
    }
    return storedDeletion;
  }
  observation = await waitForRootDisposition(
    observation,
    id,
    inspectAwsSingleNodeRootVolume,
    inspectionInput,
    budget,
    timing,
  );
  if (observation.status === 'absent') {
    return await recordAbsence(
      intent,
      'rootVolume',
      id,
      storedAttempt,
      recordDeletion,
    );
  }

  const attempt =
    storedAttempt ?? createAwsDestructionAttempt(intent, 'rootVolume', id);
  if (storedAttempt === null) {
    await persistAttempt(attempt, recordDestroyAttempt);
  }
  const request = createAwsSingleNodeDeleteVolumeRequest({
    provisioningIntent: intent,
    rootVolumeIdentity: createAwsSingleNodeResourceIdentity(
      intent,
      'rootVolume',
    ),
    volumeId: id,
  });
  for (;;) {
    try {
      await Reflect.apply(api.deleteVolume, undefined, [request]);
    } catch {
      // Mutation failure is ambiguous. Only exact readback decides progress.
    }
    observation = await inspectBounded(
      'rootVolume',
      inspectAwsSingleNodeRootVolume,
      inspectionInput,
      budget,
      timing,
    );
    observation = await waitForRootDisposition(
      observation,
      id,
      inspectAwsSingleNodeRootVolume,
      inspectionInput,
      budget,
      timing,
    );
    if (observation.status === 'absent') {
      return await recordAbsence(
        intent,
        'rootVolume',
        id,
        attempt,
        recordDeletion,
      );
    }
    await pauseBeforeRetry('rootVolume', budget, timing);
  }
}

/**
 * @param {Readonly<Record<string, any>>} intent
 * @param {string|null} id
 * @param {Readonly<Record<string, any>>|null} storedAttempt
 * @param {Readonly<Record<string, any>>|null} storedDeletion
 * @param {Readonly<Record<string, Function>>} api
 * @param {Function} recordDestroyAttempt
 * @param {Function} recordDeletion
 * @param {Readonly<Record<string, Function>>} timing
 * @returns {Promise<Readonly<Record<string, any>>|null>}
 */
async function destroySecurityGroup(
  intent,
  id,
  storedAttempt,
  storedDeletion,
  api,
  recordDestroyAttempt,
  recordDeletion,
  timing,
) {
  if (id === null) return null;
  const budget = createBudget(timing);
  const inspectionInput = deepFreeze({
    intent,
    storedResourceId: id,
    api,
  });
  let observation = await inspectBounded(
    'securityGroup',
    inspectAwsSingleNodeSecurityGroup,
    inspectionInput,
    budget,
    timing,
  );
  if (observation.status !== 'absent') {
    assertOwnedObservation('securityGroup', observation, id, 'securityGroupId');
  }
  if (storedDeletion !== null) {
    if (observation.status !== 'absent') {
      throw new AwsSingleNodeDestructionConflictError(
        'securityGroup',
        'resource-reappeared',
      );
    }
    return storedDeletion;
  }
  if (observation.status === 'absent') {
    return await recordAbsence(
      intent,
      'securityGroup',
      id,
      storedAttempt,
      recordDeletion,
    );
  }

  const attempt =
    storedAttempt ?? createAwsDestructionAttempt(intent, 'securityGroup', id);
  if (storedAttempt === null) {
    await persistAttempt(attempt, recordDestroyAttempt);
  }
  const request = createAwsSingleNodeDeleteSecurityGroupRequest({
    provisioningIntent: intent,
    securityGroupIdentity: createAwsSingleNodeResourceIdentity(
      intent,
      'securityGroup',
    ),
    securityGroupId: id,
  });
  for (;;) {
    try {
      await Reflect.apply(api.deleteSecurityGroup, undefined, [request]);
    } catch {
      // Dependency and transport failures are ambiguous until exact readback.
    }
    observation = await inspectBounded(
      'securityGroup',
      inspectAwsSingleNodeSecurityGroup,
      inspectionInput,
      budget,
      timing,
    );
    if (observation.status === 'absent') {
      return await recordAbsence(
        intent,
        'securityGroup',
        id,
        attempt,
        recordDeletion,
      );
    }
    assertOwnedObservation('securityGroup', observation, id, 'securityGroupId');
    await pauseBeforeRetry('securityGroup', budget, timing);
  }
}

/**
 * Create one bounded AWS destruction converger using an injected monotonic
 * clock and sleep boundary.
 * @param {unknown} dependencies
 * @returns {(options: unknown) => Promise<Readonly<Record<string, any>>>}
 */
export function createAwsSingleNodeDestructionConverger(dependencies) {
  const { now, sleep } = factoryDependencies(dependencies);

  return async function converge(value) {
    const input = exactDataObject(
      value,
      CONVERGE_KEYS,
      'awsSingleNodeDestruction',
    );
    const intent = validateAwsSingleNodeProvisioningIntent(
      input.intent,
      'awsSingleNodeDestruction.intent',
    );
    const ids = storedResourceIds(input.storedResourceIds);
    const attempts = storedAttempts(input.storedDestroyAttempts, intent, ids);
    const deletions = storedDeletions(
      input.storedDeletionRecords,
      intent,
      ids,
      attempts,
    );
    const api = snapshotApi(input.api);
    if (
      typeof input.recordDestroyAttempt !== 'function' ||
      typeof input.recordDeletion !== 'function'
    ) {
      throw new TypeError(
        'awsSingleNodeDestruction callbacks must be functions.',
      );
    }
    const timing = createTiming(now, sleep);
    /** @type {Record<string, Readonly<Record<string, any>>|null>} */
    const finalDeletions = {};
    finalDeletions.instance = await destroyInstance(
      intent,
      ids.instance,
      ids.securityGroup,
      attempts.instance,
      deletions.instance,
      api,
      input.recordDestroyAttempt,
      input.recordDeletion,
      timing,
    );
    finalDeletions.rootVolume = await destroyRootVolume(
      intent,
      ids.rootVolume,
      ids.instance,
      attempts.rootVolume,
      deletions.rootVolume,
      api,
      input.recordDestroyAttempt,
      input.recordDeletion,
      timing,
    );
    finalDeletions.securityGroup = await destroySecurityGroup(
      intent,
      ids.securityGroup,
      attempts.securityGroup,
      deletions.securityGroup,
      api,
      input.recordDestroyAttempt,
      input.recordDeletion,
      timing,
    );

    const result = deepFreeze(
      sortCanonicalJsonValue({
        schemaVersion: AWS_SINGLE_NODE_DESTRUCTION_RESULT_SCHEMA_VERSION,
        kind: AWS_SINGLE_NODE_DESTRUCTION_RESULT_KIND,
        provisioningIntentId: intent.provisioningIntentId,
        planId: intent.plan.planId,
        providerSpecId: intent.plan.providerSpec.providerSpecId,
        deploymentInstanceId: intent.plan.deploymentInstanceId,
        incarnationId: intent.incarnationId,
        status: 'destroyed',
        resources: Object.fromEntries(
          RESOURCE_ROLES.map((role) => [
            role,
            {
              providerResourceId: ids[role],
              state: 'absent',
              deletionId: finalDeletions[role]?.deletionId ?? null,
            },
          ]),
        ),
      }),
    );
    assertManifestIsSecretFree(result, 'awsSingleNodeDestruction.result');
    return result;
  };
}

const productionConverger = createAwsSingleNodeDestructionConverger({
  now: () => performance.now(),
  sleep: async (/** @type {number} */ milliseconds) => {
    await wait(milliseconds);
  },
});

/**
 * Converge deletion through the production monotonic clock and timer.
 * @param {unknown} options
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function convergeAwsSingleNodeDestruction(options) {
  return await productionConverger(options);
}

export default {
  AWS_SINGLE_NODE_DESTRUCTION_DEADLINE_MILLISECONDS,
  AWS_SINGLE_NODE_DESTRUCTION_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_DESTRUCTION_POLL_INTERVAL_MILLISECONDS,
  AWS_SINGLE_NODE_DESTRUCTION_RESULT_KIND,
  AWS_SINGLE_NODE_DESTRUCTION_RESULT_SCHEMA_VERSION,
  AwsSingleNodeDestructionConflictError,
  AwsSingleNodeDestructionTimeoutError,
  AwsSingleNodeDestructionTransientError,
  convergeAwsSingleNodeDestruction,
  createAwsSingleNodeDestructionConverger,
};
