/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This pure boundary keeps exact control-record and successor-authority types inline. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { validateAwsSingleNodeHostActivationRequest } from './deployment-aws-host-agent-contract.js';
import {
  getDeploymentControlHeadRecordKey,
  getDeploymentControlHostActivationAuthorityRecordKey,
} from './deployment-control-table.js';
import { validateDeploymentHead } from './deployment-head.js';
import { cloneBoundedJsonObject } from './json-value.js';

export const AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_RECORD_KIND =
  'aws-single-node-host-activation-authority';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_STORAGE_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_MAX_BYTES = 128 * 1024;

const DEPLOYMENT_HEAD_RECORD_KIND = 'deployment-head';
const RECORD_KEYS = new Set([
  'record_key',
  'storage_schema_version',
  'record_kind',
  'document_id',
  'document',
]);
const REQUIRED_BINDINGS = Object.freeze([
  Object.freeze({
    resourceKey: 'artifact',
    requestBindingId: (/** @type {Readonly<Record<string, any>>} */ request) =>
      request.artifact.bindingId,
    requestProviderResourceId: (
      /** @type {Readonly<Record<string, any>>} */ request,
    ) => request.artifact.providerResourceId,
  }),
  Object.freeze({
    resourceKey: 'substrate',
    requestBindingId: (/** @type {Readonly<Record<string, any>>} */ request) =>
      request.nodeBindingId,
    requestProviderResourceId: (
      /** @type {Readonly<Record<string, any>>} */ request,
    ) => request.nodeProviderResourceId,
  }),
  Object.freeze({
    resourceKey: 'runtime-role',
    requestBindingId: (/** @type {Readonly<Record<string, any>>} */ request) =>
      request.runtimeRoleBindingId,
    requestProviderResourceId: (
      /** @type {Readonly<Record<string, any>>} */ request,
    ) => request.runtimeRoleId,
  }),
]);

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function cloneRecord(value, path) {
  const record = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_MAX_BYTES,
    path,
  );
  assertExactKeys(record, RECORD_KEYS, path);
  if (
    record.storage_schema_version !==
    AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_STORAGE_SCHEMA_VERSION
  ) {
    throw new TypeError(
      `${path}.storage_schema_version must be the integer 1.`,
    );
  }
  return record;
}

/**
 * Create the complete stable control-table authority item for one immutable
 * V65 request. The item itself is mutable at its deployment-scoped key; its
 * contained request remains content-addressed and immutable.
 * @param {unknown} value - Candidate V65 request.
 * @returns {Readonly<Record<string, any>>} - Canonical physical record.
 */
export function createAwsSingleNodeHostActivationAuthorityRecord(value) {
  const request = validateAwsSingleNodeHostActivationRequest(
    value,
    'awsSingleNodeHostActivationAuthorityRecord.document',
  );
  return deepFreeze(
    sortCanonicalJsonValue({
      record_key: getDeploymentControlHostActivationAuthorityRecordKey(
        request.deploymentInstanceId,
      ),
      storage_schema_version:
        AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_STORAGE_SCHEMA_VERSION,
      record_kind: AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_RECORD_KIND,
      document_id: request.requestId,
      document: request,
    }),
  );
}

/**
 * Strictly validate one physical host-activation authority record.
 * @param {unknown} value - Candidate DynamoDB document item.
 * @param {string} [valuePath] - Human-readable boundary path.
 * @returns {Readonly<Record<string, any>>} - Canonical physical record.
 */
export function validateAwsSingleNodeHostActivationAuthorityRecord(
  value,
  valuePath = 'awsSingleNodeHostActivationAuthorityRecord',
) {
  const record = cloneRecord(value, valuePath);
  if (
    record.record_kind !== AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_RECORD_KIND
  ) {
    throw new TypeError(
      `${valuePath}.record_kind must be '${AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_RECORD_KIND}'.`,
    );
  }
  const request = validateAwsSingleNodeHostActivationRequest(
    record.document,
    `${valuePath}.document`,
  );
  const expected = createAwsSingleNodeHostActivationAuthorityRecord(request);
  if (
    record.record_key !== expected.record_key ||
    record.document_id !== expected.document_id
  ) {
    throw new Error(`${valuePath} does not match its exact request key.`);
  }
  return expected;
}

/**
 * Strictly validate the existing deployment-head control record used as the
 * host's final freshness observation.
 * @param {unknown} value - Candidate DynamoDB document item.
 * @param {string} [valuePath] - Human-readable boundary path.
 * @returns {Readonly<Record<string, any>>} - Canonical physical record.
 */
export function validateAwsSingleNodeHostActivationHeadRecord(
  value,
  valuePath = 'awsSingleNodeHostActivationHeadRecord',
) {
  const record = cloneRecord(value, valuePath);
  if (record.record_kind !== DEPLOYMENT_HEAD_RECORD_KIND) {
    throw new TypeError(
      `${valuePath}.record_kind must be '${DEPLOYMENT_HEAD_RECORD_KIND}'.`,
    );
  }
  const head = validateDeploymentHead(record.document, `${valuePath}.document`);
  const expectedRecordKey = getDeploymentControlHeadRecordKey(
    head.deploymentInstanceId,
  );
  if (
    record.record_key !== expectedRecordKey ||
    record.document_id !== head.headId
  ) {
    throw new Error(`${valuePath} does not match its exact head key.`);
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      record_key: expectedRecordKey,
      storage_schema_version:
        AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_STORAGE_SCHEMA_VERSION,
      record_kind: DEPLOYMENT_HEAD_RECORD_KIND,
      document_id: head.headId,
      document: head,
    }),
  );
}

/**
 * Compare one strict authority item with one strict V65 request.
 * @param {unknown} recordValue - Candidate authority record.
 * @param {unknown} requestValue - Candidate request.
 * @returns {boolean} - Exact canonical equality.
 */
export function isAwsSingleNodeHostActivationAuthorityRecordForRequest(
  recordValue,
  requestValue,
) {
  const record =
    validateAwsSingleNodeHostActivationAuthorityRecord(recordValue);
  const request = validateAwsSingleNodeHostActivationRequest(requestValue);
  return sameJson(record.document, request);
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, any>>} head @returns {boolean} */
function hasExactRequestBindings(request, head) {
  const bindingByResourceKey = new Map(
    head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  for (const definition of REQUIRED_BINDINGS) {
    const binding = bindingByResourceKey.get(definition.resourceKey);
    if (
      binding === undefined ||
      binding.bindingId !== definition.requestBindingId(request) ||
      binding.providerResourceId !==
        definition.requestProviderResourceId(request)
    ) {
      return false;
    }
  }
  for (const volume of request.volumes) {
    const volumeBinding = bindingByResourceKey.get(volume.capabilityKind);
    const attachmentBinding = bindingByResourceKey.get(
      `${volume.capabilityKind}-attachment`,
    );
    if (
      volumeBinding === undefined ||
      volumeBinding.bindingId !== volume.volumeBindingId ||
      volumeBinding.providerResourceId !== volume.volumeProviderResourceId ||
      attachmentBinding === undefined ||
      attachmentBinding.bindingId !== volume.attachmentBindingId ||
      attachmentBinding.providerResourceId !==
        volume.attachmentProviderResourceId
    ) {
      return false;
    }
  }
  return true;
}

/** @param {Readonly<Record<string, any>>} operation @param {Readonly<Record<string, any>>} request @returns {boolean} */
function operationMatchesRequest(operation, request) {
  return (
    operation.kind !== 'destroy' &&
    operation.planId === request.planId &&
    operation.operationId === request.deploymentOperationId &&
    operation.intents.length > 0 &&
    operation.intents.every(
      (/** @type {Readonly<Record<string, any>>} */ intent) =>
        intent.status === 'settled',
    )
  );
}

/**
 * Decide whether one immutable V65 request remains live controller authority
 * at one strict current HeadV2. A higher head may preserve the exact
 * all-settled operation while running or blocked, or consume it into its
 * READY successor. Other progress, operations, revisions, incarnations, and
 * critical resource bindings supersede the request.
 * @param {unknown} requestValue - Candidate V65 request.
 * @param {unknown} headValue - Candidate current HeadV2.
 * @returns {boolean} - Whether the request remains current authority.
 */
export function isAwsSingleNodeHostActivationRequestAuthorizedByHead(
  requestValue,
  headValue,
) {
  const request = validateAwsSingleNodeHostActivationRequest(requestValue);
  const head = validateDeploymentHead(headValue);
  if (
    request.deploymentInstanceId !== head.deploymentInstanceId ||
    request.incarnationId !== head.incarnationId ||
    !sameJson(request.providerScope, head.providerScope) ||
    head.generation < request.authorizedHeadGeneration ||
    (head.generation === request.authorizedHeadGeneration &&
      head.headId !== request.authorizedHeadId) ||
    !hasExactRequestBindings(request, head)
  ) {
    return false;
  }

  if (head.phase === 'CONVERGING') {
    const operation = head.activeOperation;
    return (
      operation !== null &&
      operation.nextActionIndex === operation.intents.length &&
      operationMatchesRequest(operation, request) &&
      head.targetDeploymentRevisionId === request.deploymentRevisionId
    );
  }

  if (head.phase === 'READY') {
    return (
      head.activeOperation === null &&
      head.lastOperation !== null &&
      operationMatchesRequest(head.lastOperation, request) &&
      head.settledDeploymentRevisionId === request.deploymentRevisionId &&
      head.targetDeploymentRevisionId === request.deploymentRevisionId
    );
  }

  return false;
}

export default {
  AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_RECORD_KIND,
  AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_STORAGE_SCHEMA_VERSION,
  createAwsSingleNodeHostActivationAuthorityRecord,
  isAwsSingleNodeHostActivationAuthorityRecordForRequest,
  isAwsSingleNodeHostActivationRequestAuthorizedByHead,
  validateAwsSingleNodeHostActivationAuthorityRecord,
  validateAwsSingleNodeHostActivationHeadRecord,
};
