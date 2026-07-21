/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact internal helpers are not understood cleanly by the current JSDoc lint parser. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { assertDeploymentPlanId } from './deployment-plan.js';
import {
  assertDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  assertDeploymentActionId,
  assertDeploymentIncarnationId,
  validateDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import { DEPLOYMENT_REVISION_ID_PREFIX } from './deployment-revision.js';
import { cloneJsonObject } from './json-value.js';

export const DEPLOYMENT_HEAD_SCHEMA_VERSION = 1;
export const DEPLOYMENT_HEAD_KIND = 'deploymentHead';
export const DEPLOYMENT_HEAD_ID_DOMAIN = 'wharfie:deployment-head:v1';
export const DEPLOYMENT_HEAD_ID_PREFIX = 'wdh1';
export const DEPLOYMENT_OPERATION_ID_DOMAIN = 'wharfie:deployment-operation:v1';
export const DEPLOYMENT_OPERATION_ID_PREFIX = 'wdo1';
export const DEPLOYMENT_HEAD_PHASES = Object.freeze([
  'CONVERGING',
  'READY',
  'DESTROYING',
  'DESTROYED',
]);
export const DEPLOYMENT_OPERATION_KINDS = Object.freeze([
  'create',
  'update',
  'reconcile',
  'destroy',
]);
export const DEPLOYMENT_OPERATION_STATUSES = Object.freeze([
  'running',
  'blocked',
]);
export const DEPLOYMENT_INTENT_STATUSES = Object.freeze([
  'pending',
  'intended',
  'settled',
]);

const HEAD_INPUT_KEYS = new Set([
  'deploymentInstanceId',
  'providerScope',
  'incarnationId',
  'generation',
  'phase',
  'settledDeploymentRevisionId',
  'targetDeploymentRevisionId',
  'resourceBindings',
  'activeOperation',
  'lastOperation',
]);
const HEAD_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  ...HEAD_INPUT_KEYS,
]);
const HEAD_DOCUMENT_KEYS = new Set(['headId', ...HEAD_PAYLOAD_KEYS]);
const OPERATION_REQUIRED_KEYS = new Set([
  'kind',
  'planId',
  'status',
  'nextActionIndex',
  'intents',
]);
const OPERATION_KEYS = new Set(['operationId', ...OPERATION_REQUIRED_KEYS]);
const INTENT_KEYS = new Set(['actionId', 'status', 'ownershipNonce']);
const SETTLED_OPERATION_REQUIRED_KEYS = new Set(['kind', 'planId', 'intents']);
const SETTLED_OPERATION_KEYS = new Set([
  'operationId',
  ...SETTLED_OPERATION_REQUIRED_KEYS,
]);

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertSupportedKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertRequiredKeys(value, keys, path) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
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
 * @param {unknown} value - Candidate deployment revision identity or null.
 * @param {string} path - Human-readable value path.
 * @returns {string|null} - Exact identity or null.
 */
function validateDeploymentRevisionId(value, path) {
  if (value === null) return null;
  assertDomainSeparatedSha256Id(value, DEPLOYMENT_REVISION_ID_PREFIX, path);
  return value;
}

/**
 * @param {unknown} value - Candidate operation intent.
 * @param {string} path - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical intent.
 */
function validateIntent(value, path) {
  const intent = cloneJsonObject(value, path);
  assertSupportedKeys(intent, INTENT_KEYS, path);
  assertRequiredKeys(intent, INTENT_KEYS, path);
  assertDeploymentActionId(intent.actionId, `${path}.actionId`);
  if (!DEPLOYMENT_INTENT_STATUSES.includes(intent.status)) {
    throw new TypeError(`${path}.status is not supported.`);
  }
  const ownershipNonce =
    intent.ownershipNonce === null
      ? null
      : validateOwnershipNonce(intent.ownershipNonce, `${path}.ownershipNonce`);
  return Object.freeze({
    actionId: intent.actionId,
    status: intent.status,
    ownershipNonce,
  });
}

/**
 * Derive the stable identity of one active operation. Mutable progress and
 * blocking state are deliberately excluded; the exact ordered action set and
 * preallocated ownership nonces remain part of the identity.
 * @param {{deploymentInstanceId: unknown, incarnationId: unknown, kind: unknown, planId: unknown, intents: unknown}} value - Immutable operation identity fields.
 * @returns {string} - `wdo1_` operation identity.
 */
export function getDeploymentOperationId(value) {
  assertDeploymentInstanceId(
    value?.deploymentInstanceId,
    'deploymentOperation.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    value?.incarnationId,
    'deploymentOperation.incarnationId',
  );
  if (
    typeof value?.kind !== 'string' ||
    !(
      /** @type {readonly string[]} */ (DEPLOYMENT_OPERATION_KINDS).includes(
        value.kind,
      )
    )
  ) {
    throw new TypeError('deploymentOperation.kind is not supported.');
  }
  assertDeploymentPlanId(value?.planId, 'deploymentOperation.planId');
  if (!Array.isArray(value?.intents) || value.intents.length === 0) {
    throw new TypeError(
      'deploymentOperation.intents must be a nonempty array.',
    );
  }
  const intents = value.intents.map((intent, index) =>
    validateIntent(intent, `deploymentOperation.intents[${index}]`),
  );
  return createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_OPERATION_ID_DOMAIN,
    prefix: DEPLOYMENT_OPERATION_ID_PREFIX,
    value: {
      deploymentInstanceId: value.deploymentInstanceId,
      incarnationId: value.incarnationId,
      kind: value.kind,
      planId: value.planId,
      intents: intents.map((intent) => ({
        actionId: intent.actionId,
        ownershipNonce: intent.ownershipNonce,
      })),
    },
    valuePath: 'deploymentOperation',
  });
}

/**
 * @param {unknown} value - Candidate active operation.
 * @param {{deploymentInstanceId: string, incarnationId: string, resourceBindings: Readonly<Record<string, any>>[]}} context - Exact head identity and bindings.
 * @param {string} path - Human-readable value path.
 * @param {boolean} requireOperationId - Whether serialized identity is required.
 * @returns {Readonly<Record<string, any>>} - Canonical operation.
 */
function validateOperation(value, context, path, requireOperationId) {
  const operation = cloneJsonObject(value, path);
  assertSupportedKeys(operation, OPERATION_KEYS, path);
  assertRequiredKeys(operation, OPERATION_REQUIRED_KEYS, path);
  if (
    requireOperationId &&
    !Object.prototype.hasOwnProperty.call(operation, 'operationId')
  ) {
    throw new TypeError(`${path}.operationId is required.`);
  }
  if (!DEPLOYMENT_OPERATION_KINDS.includes(operation.kind)) {
    throw new TypeError(`${path}.kind is not supported.`);
  }
  assertDeploymentPlanId(operation.planId, `${path}.planId`);
  if (!DEPLOYMENT_OPERATION_STATUSES.includes(operation.status)) {
    throw new TypeError(`${path}.status is not supported.`);
  }
  if (!Array.isArray(operation.intents) || operation.intents.length === 0) {
    throw new TypeError(`${path}.intents must be a nonempty array.`);
  }
  if (operation.intents.length > 16) {
    throw new TypeError(`${path}.intents must contain at most 16 actions.`);
  }
  const seenActions = new Set();
  const seenNonces = new Set();
  const intents = operation.intents.map((candidate, index) => {
    const intent = validateIntent(candidate, `${path}.intents[${index}]`);
    if (seenActions.has(intent.actionId)) {
      throw new Error(`${path}.intents must have unique actionId values.`);
    }
    seenActions.add(intent.actionId);
    if (intent.ownershipNonce !== null) {
      if (seenNonces.has(intent.ownershipNonce)) {
        throw new Error(
          `${path}.intents must not reuse an ownershipNonce across actions.`,
        );
      }
      seenNonces.add(intent.ownershipNonce);
    }
    return intent;
  });
  if (
    !Number.isSafeInteger(operation.nextActionIndex) ||
    operation.nextActionIndex < 0 ||
    operation.nextActionIndex > intents.length
  ) {
    throw new TypeError(
      `${path}.nextActionIndex must identify a position in intents.`,
    );
  }
  for (let index = 0; index < intents.length; index += 1) {
    const status = intents[index].status;
    const valid =
      (index < operation.nextActionIndex && status === 'settled') ||
      (index === operation.nextActionIndex &&
        operation.nextActionIndex < intents.length &&
        (status === 'pending' || status === 'intended')) ||
      (index > operation.nextActionIndex && status === 'pending');
    if (!valid) {
      throw new Error(
        `${path}.nextActionIndex must exactly separate settled, current, and pending intents.`,
      );
    }
  }
  const intentByAction = new Map(
    intents.map((intent) => [intent.actionId, intent]),
  );
  for (const binding of context.resourceBindings) {
    if (binding.management !== 'managed') continue;
    const intent = intentByAction.get(binding.createdByActionId);
    if (!intent) continue;
    if (
      intent.status !== 'settled' ||
      intent.ownershipNonce !== binding.ownershipNonce
    ) {
      throw new Error(
        `${path} must settle matching managed binding ownership evidence.`,
      );
    }
  }

  const operationId = getDeploymentOperationId({
    deploymentInstanceId: context.deploymentInstanceId,
    incarnationId: context.incarnationId,
    kind: operation.kind,
    planId: operation.planId,
    intents,
  });
  if (
    Object.prototype.hasOwnProperty.call(operation, 'operationId') &&
    operation.operationId !== operationId
  ) {
    throw new Error(`${path}.operationId does not match its exact operation.`);
  }
  return deepFreeze({
    operationId,
    kind: operation.kind,
    planId: operation.planId,
    status: operation.status,
    nextActionIndex: operation.nextActionIndex,
    intents,
  });
}

/**
 * Retain the exact completed operation after active authority is cleared.
 * @param {unknown} value - Candidate completed operation.
 * @param {{deploymentInstanceId: string, incarnationId: string}} context - Exact head identity.
 * @param {string} path - Human-readable value path.
 * @param {boolean} requireOperationId - Whether serialized identity is required.
 * @returns {Readonly<Record<string, any>>} - Canonical settlement.
 */
function validateSettledOperation(value, context, path, requireOperationId) {
  const operation = cloneJsonObject(value, path);
  assertSupportedKeys(operation, SETTLED_OPERATION_KEYS, path);
  assertRequiredKeys(operation, SETTLED_OPERATION_REQUIRED_KEYS, path);
  if (
    requireOperationId &&
    !Object.prototype.hasOwnProperty.call(operation, 'operationId')
  ) {
    throw new TypeError(`${path}.operationId is required.`);
  }
  if (!DEPLOYMENT_OPERATION_KINDS.includes(operation.kind)) {
    throw new TypeError(`${path}.kind is not supported.`);
  }
  assertDeploymentPlanId(operation.planId, `${path}.planId`);
  if (
    !Array.isArray(operation.intents) ||
    operation.intents.length === 0 ||
    operation.intents.length > 16
  ) {
    throw new TypeError(
      `${path}.intents must contain between 1 and 16 actions.`,
    );
  }
  const seenActions = new Set();
  const seenNonces = new Set();
  const intents = operation.intents.map((candidate, index) => {
    const intent = validateIntent(candidate, `${path}.intents[${index}]`);
    if (intent.status !== 'settled') {
      throw new Error(`${path}.intents must all be settled.`);
    }
    if (seenActions.has(intent.actionId)) {
      throw new Error(`${path}.intents must have unique actionId values.`);
    }
    seenActions.add(intent.actionId);
    if (intent.ownershipNonce !== null) {
      if (seenNonces.has(intent.ownershipNonce)) {
        throw new Error(`${path}.intents must not reuse an ownershipNonce.`);
      }
      seenNonces.add(intent.ownershipNonce);
    }
    return intent;
  });
  const operationId = getDeploymentOperationId({
    deploymentInstanceId: context.deploymentInstanceId,
    incarnationId: context.incarnationId,
    kind: operation.kind,
    planId: operation.planId,
    intents,
  });
  if (
    Object.prototype.hasOwnProperty.call(operation, 'operationId') &&
    operation.operationId !== operationId
  ) {
    throw new Error(`${path}.operationId does not match its exact operation.`);
  }
  return deepFreeze({
    operationId,
    kind: operation.kind,
    planId: operation.planId,
    intents,
  });
}

/**
 * @param {Readonly<Record<string, any>>} payload - Canonical head payload.
 * @param {string} path - Human-readable value path.
 * @returns {void} - Returns after all phase invariants hold.
 */
function assertPhaseInvariants(payload, path) {
  const settled = payload.settledDeploymentRevisionId;
  const target = payload.targetDeploymentRevisionId;
  const operation = payload.activeOperation;
  const lastOperation = payload.lastOperation;
  if (payload.phase === 'READY') {
    if (
      operation !== null ||
      settled === null ||
      target !== settled ||
      lastOperation === null ||
      lastOperation.kind === 'destroy'
    ) {
      throw new Error(
        `${path} READY requires a completed non-destroy operation and one equal settled/target revision.`,
      );
    }
    return;
  }
  if (payload.phase === 'DESTROYED') {
    if (
      operation !== null ||
      settled !== null ||
      target !== null ||
      lastOperation?.kind !== 'destroy'
    ) {
      throw new Error(
        `${path} DESTROYED requires a completed destroy operation and no settled or target revision.`,
      );
    }
    return;
  }
  if (operation === null) {
    throw new Error(`${path} ${payload.phase} requires an active operation.`);
  }
  if (settled !== null && lastOperation === null) {
    throw new Error(
      `${path} a settled deployment revision requires its last completed operation.`,
    );
  }
  if (payload.phase === 'DESTROYING') {
    if (operation.kind !== 'destroy' || settled === null || target !== null) {
      throw new Error(
        `${path} DESTROYING requires a destroy operation, a settled revision, and no target revision.`,
      );
    }
    return;
  }
  if (operation.kind === 'destroy') {
    throw new Error(`${path} CONVERGING cannot use a destroy operation.`);
  }
  if (target === null) {
    throw new Error(`${path} CONVERGING requires a target revision.`);
  }
  if (operation.kind === 'create' && settled !== null) {
    throw new Error(`${path} create requires no settled revision.`);
  }
  if (operation.kind === 'update' && (settled === null || settled === target)) {
    throw new Error(
      `${path} update requires distinct settled and target revisions.`,
    );
  }
  if (
    operation.kind === 'reconcile' &&
    (settled === null || settled !== target)
  ) {
    throw new Error(
      `${path} reconcile requires one equal settled/target revision.`,
    );
  }
}

/**
 * @param {unknown} value - Candidate head fields.
 * @param {string} path - Human-readable value path.
 * @param {{serialized: boolean}} options - Canonical serialized-form policy.
 * @returns {Readonly<Record<string, any>>} - Canonical payload.
 */
function createPayload(value, path, options) {
  const input = cloneJsonObject(value, path);
  const expectedKeys = options.serialized ? HEAD_PAYLOAD_KEYS : HEAD_INPUT_KEYS;
  assertSupportedKeys(input, expectedKeys, path);
  assertRequiredKeys(input, expectedKeys, path);
  if (options.serialized) {
    if (input.schemaVersion !== DEPLOYMENT_HEAD_SCHEMA_VERSION) {
      throw new TypeError(`${path}.schemaVersion must be the integer 1.`);
    }
    if (input.kind !== DEPLOYMENT_HEAD_KIND) {
      throw new TypeError(`${path}.kind must be '${DEPLOYMENT_HEAD_KIND}'.`);
    }
  }
  assertDeploymentInstanceId(
    input.deploymentInstanceId,
    `${path}.deploymentInstanceId`,
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    `${path}.providerScope`,
  );
  assertDeploymentIncarnationId(input.incarnationId, `${path}.incarnationId`);
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    throw new TypeError(`${path}.generation must be a positive safe integer.`);
  }
  if (!DEPLOYMENT_HEAD_PHASES.includes(input.phase)) {
    throw new TypeError(`${path}.phase is not supported.`);
  }
  const settledDeploymentRevisionId = validateDeploymentRevisionId(
    input.settledDeploymentRevisionId,
    `${path}.settledDeploymentRevisionId`,
  );
  const targetDeploymentRevisionId = validateDeploymentRevisionId(
    input.targetDeploymentRevisionId,
    `${path}.targetDeploymentRevisionId`,
  );
  if (!Array.isArray(input.resourceBindings)) {
    throw new TypeError(`${path}.resourceBindings must be an array.`);
  }
  if (input.resourceBindings.length > 16) {
    throw new TypeError(
      `${path}.resourceBindings must contain at most 16 bindings.`,
    );
  }
  /** @type {string[]} */
  const originalResourceKeys = [];
  const resourceBindings = input.resourceBindings.map((binding, index) => {
    const validated = validateDeploymentResourceBinding(
      binding,
      `${path}.resourceBindings[${index}]`,
    );
    if (
      validated.deploymentInstanceId !== input.deploymentInstanceId ||
      validated.incarnationId !== input.incarnationId ||
      validated.providerScopeId !== providerScope.providerScopeId
    ) {
      throw new Error(
        `${path}.resourceBindings[${index}] does not match the head instance, incarnation, and provider scope.`,
      );
    }
    originalResourceKeys.push(validated.resourceKey);
    return validated;
  });
  if (
    options.serialized &&
    originalResourceKeys.some(
      (resourceKey, index) =>
        index > 0 &&
        compareCanonicalStrings(originalResourceKeys[index - 1], resourceKey) >=
          0,
    )
  ) {
    throw new Error(
      `${path}.resourceBindings must be strictly sorted by unique resourceKey.`,
    );
  }
  resourceBindings.sort((left, right) =>
    compareCanonicalStrings(left.resourceKey, right.resourceKey),
  );
  for (let index = 1; index < resourceBindings.length; index += 1) {
    if (
      resourceBindings[index - 1].resourceKey ===
      resourceBindings[index].resourceKey
    ) {
      throw new Error(
        `${path}.resourceBindings must have unique resourceKey values.`,
      );
    }
  }
  const activeOperation =
    input.activeOperation === null
      ? null
      : validateOperation(
          input.activeOperation,
          {
            deploymentInstanceId: input.deploymentInstanceId,
            incarnationId: input.incarnationId,
            resourceBindings,
          },
          `${path}.activeOperation`,
          options.serialized,
        );
  const lastOperation =
    input.lastOperation === null
      ? null
      : validateSettledOperation(
          input.lastOperation,
          {
            deploymentInstanceId: input.deploymentInstanceId,
            incarnationId: input.incarnationId,
          },
          `${path}.lastOperation`,
          options.serialized,
        );
  const payload = deepFreeze({
    schemaVersion: DEPLOYMENT_HEAD_SCHEMA_VERSION,
    kind: DEPLOYMENT_HEAD_KIND,
    deploymentInstanceId: input.deploymentInstanceId,
    providerScope,
    incarnationId: input.incarnationId,
    generation: input.generation,
    phase: input.phase,
    settledDeploymentRevisionId,
    targetDeploymentRevisionId,
    resourceBindings,
    activeOperation,
    lastOperation,
  });
  assertPhaseInvariants(payload, path);
  return payload;
}

/**
 * Create one immutable, content-addressed deployment-head generation.
 * @param {unknown} value - Exact head fields without schema/kind/head ID.
 * @returns {Readonly<Record<string, any>>} - Canonical DeploymentHeadV1.
 */
export function createDeploymentHead(value) {
  const payload = deepFreeze(
    sortCanonicalJsonValue(
      createPayload(value, 'deploymentHead', { serialized: false }),
    ),
  );
  const headId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_HEAD_ID_DOMAIN,
    prefix: DEPLOYMENT_HEAD_ID_PREFIX,
    value: payload,
    valuePath: 'deploymentHead',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, headId }));
}

/**
 * Validate, cross-check, and freeze one serialized DeploymentHeadV1.
 * @param {unknown} value - Candidate serialized head.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical DeploymentHeadV1.
 */
export function validateDeploymentHead(value, valuePath = 'deploymentHead') {
  const document = cloneJsonObject(value, valuePath);
  assertSupportedKeys(document, HEAD_DOCUMENT_KEYS, valuePath);
  assertRequiredKeys(document, HEAD_DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.headId,
    DEPLOYMENT_HEAD_ID_PREFIX,
    `${valuePath}.headId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of HEAD_PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = deepFreeze(
    sortCanonicalJsonValue(
      createPayload(payloadInput, valuePath, { serialized: true }),
    ),
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_HEAD_ID_DOMAIN,
    prefix: DEPLOYMENT_HEAD_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.headId !== expectedId) {
    throw new Error(`${valuePath}.headId does not match its exact generation.`);
  }
  return deepFreeze(sortCanonicalJsonValue({ ...payload, headId: expectedId }));
}

/** @param {unknown} value @param {string} [valuePath] @returns {asserts value is string} */
export function assertDeploymentHeadId(value, valuePath = 'headId') {
  assertDomainSeparatedSha256Id(value, DEPLOYMENT_HEAD_ID_PREFIX, valuePath);
}

/** @param {unknown} value @param {string} [valuePath] @returns {asserts value is string} */
export function assertDeploymentOperationId(value, valuePath = 'operationId') {
  assertDomainSeparatedSha256Id(
    value,
    DEPLOYMENT_OPERATION_ID_PREFIX,
    valuePath,
  );
}

export default {
  DEPLOYMENT_HEAD_ID_DOMAIN,
  DEPLOYMENT_HEAD_ID_PREFIX,
  DEPLOYMENT_HEAD_KIND,
  DEPLOYMENT_HEAD_PHASES,
  DEPLOYMENT_HEAD_SCHEMA_VERSION,
  DEPLOYMENT_INTENT_STATUSES,
  DEPLOYMENT_OPERATION_ID_DOMAIN,
  DEPLOYMENT_OPERATION_ID_PREFIX,
  DEPLOYMENT_OPERATION_KINDS,
  DEPLOYMENT_OPERATION_STATUSES,
  assertDeploymentHeadId,
  assertDeploymentOperationId,
  createDeploymentHead,
  getDeploymentOperationId,
  validateDeploymentHead,
};
