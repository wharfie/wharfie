/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact internal boundary helpers are not understood cleanly by the current JSDoc lint parser. */

import { assertApplicationRevisionId } from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import {
  AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { getDeploymentControlBucketName } from './deployment-artifact-stage.js';
import {
  assertDeploymentHeadId,
  assertDeploymentOperationId,
  validateDeploymentHead,
} from './deployment-head.js';
import {
  DEPLOYMENT_CAPABILITY_IDS,
  validateDeploymentProfile,
} from './deployment-profile.js';
import { getAwsSingleNodeResourceDefinition } from './deployment-resource-graph.js';
import {
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  PROVIDER_SCOPE_ID_PREFIX,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
  assertDeploymentIncarnationId,
  validateProviderResourceId,
} from './deployment-resource-binding.js';
import {
  DEPLOYMENT_REVISION_ID_PREFIX,
  validateDeploymentRevision,
} from './deployment-revision.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import {
  assertLedgerServiceId,
  assertLedgerServiceSessionId,
  createLedgerServiceId,
} from '../lib/db/tables/ledger-service-lifecycle.js';
import {
  DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES,
  DEPLOYMENT_SERVICE_HEALTH_OBJECT_PREFIX,
} from './deployment-service-health-contract.js';

export const DEPLOYMENT_SERVICE_HEALTH_RECEIPT_SCHEMA_VERSION = 2;
export const DEPLOYMENT_SERVICE_HEALTH_RECEIPT_KIND =
  'deploymentServiceHealthReceipt';
export const DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_DOMAIN =
  'wharfie:deployment-service-health-receipt:v2';
export const DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_PREFIX = 'whr2';
export const DEPLOYMENT_SERVICE_HEALTH_RECEIPT_MAX_BYTES =
  DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES;
export const DEPLOYMENT_SERVICE_HEALTH_CONTEXT_MAX_BYTES = 128 * 1024;

const CREATE_KEYS = new Set([
  'providerScopeId',
  'providerSpecId',
  'deploymentInstanceId',
  'incarnationId',
  'deploymentOperationId',
  'authorizedHeadId',
  'authorizedHeadGeneration',
  'nodeBindingId',
  'nodeProviderResourceId',
  'deploymentRevisionId',
  'appId',
  'artifactId',
  'revisionId',
  'serviceId',
  'sessionId',
  'lifecycleGeneration',
  'ownerGeneration',
  'activationRecordVersion',
  'activationSelectionGeneration',
  'processId',
  'sequence',
  'health',
]);
const PAYLOAD_KEYS = new Set(['schemaVersion', 'kind', ...CREATE_KEYS]);
const DOCUMENT_KEYS = new Set(['receiptId', ...PAYLOAD_KEYS]);
const CONTEXT_KEYS = new Set([
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'head',
]);
const SUCCESSOR_AUTHORITY_KEYS = Object.freeze([
  'providerScopeId',
  'providerSpecId',
  'deploymentInstanceId',
  'incarnationId',
  'nodeBindingId',
  'nodeProviderResourceId',
  'appId',
  'serviceId',
  'health',
]);
const SUCCESSOR_REVISION_KEYS = Object.freeze([
  'deploymentRevisionId',
  'artifactId',
  'revisionId',
]);

/**
 * @typedef DeploymentServiceHealthReceiptV2
 * @property {2} schemaVersion - Schema version.
 * @property {'deploymentServiceHealthReceipt'} kind - Document kind.
 * @property {string} receiptId - Immutable content identity.
 * @property {string} providerScopeId - Exact provider credential scope.
 * @property {string} providerSpecId - Exact provider behavior contract.
 * @property {string} deploymentInstanceId - Stable deployment identity.
 * @property {string} incarnationId - One create-to-destroy lifetime.
 * @property {string} deploymentOperationId - Non-destroy operation authorizing this service.
 * @property {string} authorizedHeadId - Exact head observed by the host boundary.
 * @property {number} authorizedHeadGeneration - Head generation observed by the host boundary.
 * @property {string} nodeBindingId - Exact resident-node binding.
 * @property {string} nodeProviderResourceId - Exact provider node identity.
 * @property {string} deploymentRevisionId - Exact deployed revision.
 * @property {string} appId - Owning application.
 * @property {string} artifactId - Exact running SEA bytes.
 * @property {string} revisionId - Exact application revision.
 * @property {string} serviceId - Stable resident service identity.
 * @property {string} sessionId - Current process-session fence.
 * @property {number} lifecycleGeneration - Durable service lifecycle generation.
 * @property {number} ownerGeneration - Durable resident-owner generation.
 * @property {number} activationRecordVersion - Durable activation record version.
 * @property {number} activationSelectionGeneration - Durable selected-release generation.
 * @property {number} processId - Exact healthy process ID observed locally.
 * @property {number} sequence - Monotonic heartbeat sequence within a session.
 * @property {'healthy'} health - Only a completely healthy service may publish.
 */

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertAllKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
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

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function cloneReceipt(value, path) {
  return cloneBoundedJsonObject(
    value,
    DEPLOYMENT_SERVICE_HEALTH_RECEIPT_MAX_BYTES,
    path,
  );
}

/** @param {unknown} value @param {string} path @returns {number} */
function positiveSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * Derive the one mutable current-health object key for a deployment node.
 * Versioned object storage retains each immutable receipt written to this key.
 * @param {unknown} value - Deployment instance, incarnation, and node binding.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - Canonical current-health object key.
 */
export function getDeploymentServiceHealthObjectKey(
  value,
  valuePath = 'deploymentServiceHealth',
) {
  const identity = /** @type {Record<string, any>} */ (value);
  assertDeploymentInstanceId(
    identity?.deploymentInstanceId,
    `${valuePath}.deploymentInstanceId`,
  );
  assertDeploymentIncarnationId(
    identity?.incarnationId,
    `${valuePath}.incarnationId`,
  );
  assertDomainSeparatedSha256Id(
    identity?.nodeBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${valuePath}.nodeBindingId`,
  );
  return `${DEPLOYMENT_SERVICE_HEALTH_OBJECT_PREFIX}${identity.deploymentInstanceId}/${identity.incarnationId}/${identity.nodeBindingId}`;
}

/**
 * Derive the complete provider-visible current-health lookup.
 * @param {unknown} providerScope - Exact resolved provider scope.
 * @param {unknown} value - Deployment instance, incarnation, and node binding.
 * @returns {Readonly<{bucketName: string, key: string}>} - Canonical location.
 */
export function getDeploymentServiceHealthObjectLocation(providerScope, value) {
  return deepFreeze({
    bucketName: getDeploymentControlBucketName(providerScope, 'providerScope'),
    key: getDeploymentServiceHealthObjectKey(value),
  });
}

/** @param {unknown} value @param {string} path @returns {Omit<DeploymentServiceHealthReceiptV2, 'receiptId'>} */
function validatePayload(value, path) {
  const receipt = cloneReceipt(value, path);
  assertAllKeys(receipt, PAYLOAD_KEYS, path);
  if (
    receipt.schemaVersion !== DEPLOYMENT_SERVICE_HEALTH_RECEIPT_SCHEMA_VERSION
  ) {
    throw new TypeError(`${path}.schemaVersion must be the integer 2.`);
  }
  if (receipt.kind !== DEPLOYMENT_SERVICE_HEALTH_RECEIPT_KIND) {
    throw new TypeError(
      `${path}.kind must be '${DEPLOYMENT_SERVICE_HEALTH_RECEIPT_KIND}'.`,
    );
  }
  assertDomainSeparatedSha256Id(
    receipt.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    `${path}.providerScopeId`,
  );
  assertDomainSeparatedSha256Id(
    receipt.providerSpecId,
    AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    `${path}.providerSpecId`,
  );
  assertDeploymentInstanceId(
    receipt.deploymentInstanceId,
    `${path}.deploymentInstanceId`,
  );
  assertDeploymentIncarnationId(receipt.incarnationId, `${path}.incarnationId`);
  assertDeploymentOperationId(
    receipt.deploymentOperationId,
    `${path}.deploymentOperationId`,
  );
  assertDeploymentHeadId(receipt.authorizedHeadId, `${path}.authorizedHeadId`);
  assertDomainSeparatedSha256Id(
    receipt.nodeBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${path}.nodeBindingId`,
  );
  assertDomainSeparatedSha256Id(
    receipt.deploymentRevisionId,
    DEPLOYMENT_REVISION_ID_PREFIX,
    `${path}.deploymentRevisionId`,
  );
  assertLogicalId(receipt.appId, `${path}.appId`);
  assertArtifactId(receipt.artifactId, `${path}.artifactId`);
  assertApplicationRevisionId(receipt.revisionId, `${path}.revisionId`);
  assertLedgerServiceId(receipt.serviceId, `${path}.serviceId`);
  assertLedgerServiceSessionId(receipt.sessionId, `${path}.sessionId`);
  const normalized = {
    schemaVersion: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_SCHEMA_VERSION,
    kind: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_KIND,
    providerScopeId: receipt.providerScopeId,
    providerSpecId: receipt.providerSpecId,
    deploymentInstanceId: receipt.deploymentInstanceId,
    incarnationId: receipt.incarnationId,
    deploymentOperationId: receipt.deploymentOperationId,
    authorizedHeadId: receipt.authorizedHeadId,
    authorizedHeadGeneration: positiveSafeInteger(
      receipt.authorizedHeadGeneration,
      `${path}.authorizedHeadGeneration`,
    ),
    nodeBindingId: receipt.nodeBindingId,
    nodeProviderResourceId: validateProviderResourceId(
      receipt.nodeProviderResourceId,
      `${path}.nodeProviderResourceId`,
    ),
    deploymentRevisionId: receipt.deploymentRevisionId,
    appId: receipt.appId,
    artifactId: receipt.artifactId,
    revisionId: receipt.revisionId,
    serviceId: receipt.serviceId,
    sessionId: receipt.sessionId,
    lifecycleGeneration: positiveSafeInteger(
      receipt.lifecycleGeneration,
      `${path}.lifecycleGeneration`,
    ),
    ownerGeneration: positiveSafeInteger(
      receipt.ownerGeneration,
      `${path}.ownerGeneration`,
    ),
    activationRecordVersion: positiveSafeInteger(
      receipt.activationRecordVersion,
      `${path}.activationRecordVersion`,
    ),
    activationSelectionGeneration: positiveSafeInteger(
      receipt.activationSelectionGeneration,
      `${path}.activationSelectionGeneration`,
    ),
    processId: positiveSafeInteger(receipt.processId, `${path}.processId`),
    sequence: positiveSafeInteger(receipt.sequence, `${path}.sequence`),
    health: receipt.health,
  };
  if (
    normalized.serviceId !== createLedgerServiceId({ appId: receipt.appId })
  ) {
    throw new Error(`${path}.serviceId must bind its exact appId.`);
  }
  if (normalized.health !== 'healthy') {
    throw new TypeError(`${path}.health must be 'healthy'.`);
  }
  assertManifestIsSecretFree(normalized, path);
  return /** @type {Omit<DeploymentServiceHealthReceiptV2, 'receiptId'>} */ (
    deepFreeze(sortCanonicalJsonValue(normalized))
  );
}

/**
 * Create one immutable service-health observation. Provider freshness is
 * deliberately not part of these host-authored bytes; the object store's
 * version and LastModified observation supply that independent evidence.
 * @param {unknown} value - Exact receipt fields without schema, kind, or ID.
 * @returns {Readonly<DeploymentServiceHealthReceiptV2>} - Canonical receipt.
 */
export function createDeploymentServiceHealthReceipt(value) {
  const input = cloneReceipt(value, 'deploymentServiceHealthReceipt');
  assertAllKeys(input, CREATE_KEYS, 'deploymentServiceHealthReceipt');
  const payload = validatePayload(
    {
      schemaVersion: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_SCHEMA_VERSION,
      kind: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_KIND,
      ...input,
    },
    'deploymentServiceHealthReceipt',
  );
  const receiptId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_DOMAIN,
    prefix: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath: 'deploymentServiceHealthReceipt',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, receiptId }));
}

/**
 * Validate, reidentify, and freeze one serialized health receipt.
 * @param {unknown} value - Candidate receipt.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentServiceHealthReceiptV2>} - Canonical receipt.
 */
export function validateDeploymentServiceHealthReceipt(
  value,
  valuePath = 'deploymentServiceHealthReceipt',
) {
  const document = cloneReceipt(value, valuePath);
  assertAllKeys(document, DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.receiptId,
    DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_PREFIX,
    `${valuePath}.receiptId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validatePayload(payloadInput, valuePath);
  const expectedId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_DOMAIN,
    prefix: DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.receiptId !== expectedId) {
    throw new Error(
      `${valuePath}.receiptId does not match its exact health observation.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, receiptId: expectedId }),
  );
}

/**
 * Cross-check host-authored health against the complete current deployment
 * authority. An older authorized head may remain useful only while its exact
 * non-destroy operation and deployed-revision lineage are still represented
 * by the current head.
 * @param {unknown} value - Candidate receipt.
 * @param {unknown} context - Exact deployment, provider, and head authority.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentServiceHealthReceiptV2>} - Context-bound receipt.
 */
export function validateDeploymentServiceHealthReceiptContext(
  value,
  context,
  valuePath = 'deploymentServiceHealthReceipt',
) {
  const receipt = validateDeploymentServiceHealthReceipt(value, valuePath);
  const trusted = cloneBoundedJsonObject(
    context,
    DEPLOYMENT_SERVICE_HEALTH_CONTEXT_MAX_BYTES,
    `${valuePath}.context`,
  );
  assertAllKeys(trusted, CONTEXT_KEYS, `${valuePath}.context`);
  const deploymentRevision = validateDeploymentRevision(
    trusted.deploymentRevision,
    `${valuePath}.context.deploymentRevision`,
  );
  const profile = validateDeploymentProfile(
    trusted.profile,
    `${valuePath}.context.profile`,
  );
  const providerScope = validateProviderScope(
    trusted.providerScope,
    `${valuePath}.context.providerScope`,
  );
  const providerSpec = validateAwsSingleNodeProviderSpecContext(
    trusted.providerSpec,
    { profile, providerScope },
  );
  const head = validateDeploymentHead(
    trusted.head,
    `${valuePath}.context.head`,
  );

  if (
    deploymentRevision.profileRevisionId !== profile.profileRevisionId ||
    deploymentRevision.appId !== profile.appId
  ) {
    throw new Error(
      `${valuePath}.context deploymentRevision and profile do not match.`,
    );
  }
  const deploymentInstanceId = getDeploymentInstanceId({
    deploymentRevision,
    providerScope,
  });
  if (
    head.deploymentInstanceId !== deploymentInstanceId ||
    JSON.stringify(head.providerScope) !== JSON.stringify(providerScope)
  ) {
    throw new Error(`${valuePath}.context head authority does not match.`);
  }
  if (head.phase === 'DESTROYING' || head.phase === 'DESTROYED') {
    throw new Error(`${valuePath} cannot authorize health during destroy.`);
  }

  const substrateBindings = head.resourceBindings.filter(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.resourceKey === 'substrate',
  );
  if (substrateBindings.length !== 1) {
    throw new Error(
      `${valuePath}.context head must contain exactly one substrate binding.`,
    );
  }
  const node = substrateBindings[0];
  const nodeDefinition = getAwsSingleNodeResourceDefinition('substrate');
  if (nodeDefinition === null) {
    throw new Error(
      `${valuePath}.context AWS single-node graph lacks the substrate definition.`,
    );
  }
  const bindingByResourceKey = new Map(
    head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  const configurationKeyByCapability = new Map(
    Object.entries(DEPLOYMENT_CAPABILITY_IDS).map(([key, capability]) => [
      capability,
      key,
    ]),
  );
  /** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} definition @param {string} path @returns {void} */
  function assertExactGraphBinding(binding, definition, path) {
    const configurationKey = configurationKeyByCapability.get(
      definition.capability.kind,
    );
    const configuration =
      configurationKey === undefined
        ? undefined
        : profile.provider.configuration[configurationKey];
    const expectedDependencyKeys = [...definition.dependsOn].sort(
      compareCanonicalStrings,
    );
    if (
      binding.resourceKey !== definition.resourceKey ||
      binding.capability.kind !== definition.capability.kind ||
      binding.capability.version !== definition.capability.version ||
      binding.role.kind !== definition.role.kind ||
      binding.role.version !== definition.role.version ||
      configuration === undefined ||
      configuration.management === 'none' ||
      binding.management !== configuration.management ||
      binding.ownershipMode !== definition.ownershipMode ||
      binding.onDestroy !== definition.onDestroy ||
      binding.providerType !== definition.providerType ||
      binding.dependencyBindings.length !== expectedDependencyKeys.length ||
      binding.dependencyBindings.some(
        (
          /** @type {Readonly<Record<string, any>>} */ dependency,
          /** @type {number} */ index,
        ) =>
          dependency.resourceKey !== expectedDependencyKeys[index] ||
          bindingByResourceKey.get(dependency.resourceKey)?.bindingId !==
            dependency.bindingId,
      )
    ) {
      throw new Error(
        `${path} does not match its exact graph definition, profile management, and head dependency bindings.`,
      );
    }
  }
  const validatedResourceKeys = new Set();
  const visitingResourceKeys = new Set();
  /** @param {string} resourceKey @returns {void} */
  function assertExactGraphBindingClosure(resourceKey) {
    if (validatedResourceKeys.has(resourceKey)) return;
    if (visitingResourceKeys.has(resourceKey)) {
      throw new Error(
        `${valuePath}.context graph dependency closure must be acyclic.`,
      );
    }
    const binding = bindingByResourceKey.get(resourceKey);
    const definition = getAwsSingleNodeResourceDefinition(resourceKey);
    if (binding === undefined || definition === null) {
      throw new Error(
        `${valuePath}.context graph dependency '${resourceKey}' lacks exact graph and head authority.`,
      );
    }
    visitingResourceKeys.add(resourceKey);
    assertExactGraphBinding(
      binding,
      definition,
      resourceKey === 'substrate'
        ? `${valuePath}.context substrate binding`
        : `${valuePath}.context graph dependency '${resourceKey}'`,
    );
    for (const dependencyKey of definition.dependsOn) {
      assertExactGraphBindingClosure(dependencyKey);
    }
    visitingResourceKeys.delete(resourceKey);
    validatedResourceKeys.add(resourceKey);
  }
  assertExactGraphBindingClosure(nodeDefinition.resourceKey);

  /** @type {Array<[string, string]>} */
  const exactMatches = [
    ['providerScopeId', providerScope.providerScopeId],
    ['providerSpecId', providerSpec.providerSpecId],
    ['deploymentInstanceId', deploymentInstanceId],
    ['incarnationId', head.incarnationId],
    ['nodeBindingId', node.bindingId],
    ['nodeProviderResourceId', node.providerResourceId],
    ['deploymentRevisionId', deploymentRevision.deploymentRevisionId],
    ['appId', deploymentRevision.appId],
    ['artifactId', deploymentRevision.artifactId],
    ['revisionId', deploymentRevision.revisionId],
    ['serviceId', createLedgerServiceId({ appId: deploymentRevision.appId })],
  ];
  const receiptRecord = /** @type {Readonly<Record<string, any>>} */ (receipt);
  for (const [field, expected] of exactMatches) {
    if (receiptRecord[field] !== expected) {
      throw new Error(`${valuePath}.${field} does not match context.`);
    }
  }

  if (receipt.authorizedHeadGeneration > head.generation) {
    throw new Error(
      `${valuePath}.authorizedHeadGeneration cannot exceed the current head generation.`,
    );
  }
  if (
    receipt.authorizedHeadGeneration === head.generation &&
    receipt.authorizedHeadId !== head.headId
  ) {
    throw new Error(
      `${valuePath}.authorizedHeadId must equal the current head at its generation.`,
    );
  }

  const allowedOperationIds = new Set();
  if (
    head.targetDeploymentRevisionId ===
      deploymentRevision.deploymentRevisionId &&
    head.activeOperation !== null &&
    head.activeOperation.kind !== 'destroy'
  ) {
    allowedOperationIds.add(head.activeOperation.operationId);
  }
  if (
    head.settledDeploymentRevisionId ===
      deploymentRevision.deploymentRevisionId &&
    head.lastOperation !== null &&
    head.lastOperation.kind !== 'destroy'
  ) {
    allowedOperationIds.add(head.lastOperation.operationId);
  }
  if (allowedOperationIds.size === 0) {
    throw new Error(
      `${valuePath}.deploymentRevisionId is not in current target or settled lineage.`,
    );
  }
  if (!allowedOperationIds.has(receipt.deploymentOperationId)) {
    throw new Error(
      `${valuePath}.deploymentOperationId is not current non-destroy authority for its revision.`,
    );
  }
  return receipt;
}

/** @param {DeploymentServiceHealthReceiptV2} previous @param {DeploymentServiceHealthReceiptV2} next @param {string} path @returns {void} */
function assertSuccessor(previous, next, path) {
  const previousRecord = /** @type {Readonly<Record<string, any>>} */ (
    previous
  );
  const nextRecord = /** @type {Readonly<Record<string, any>>} */ (next);
  for (const field of SUCCESSOR_AUTHORITY_KEYS) {
    if (nextRecord[field] !== previousRecord[field]) {
      throw new Error(`${path}.${field} cannot change across successors.`);
    }
  }
  if (next.authorizedHeadGeneration < previous.authorizedHeadGeneration) {
    throw new Error(`${path}.authorizedHeadGeneration cannot regress.`);
  }
  if (
    next.authorizedHeadGeneration === previous.authorizedHeadGeneration &&
    next.authorizedHeadId !== previous.authorizedHeadId
  ) {
    throw new Error(
      `${path}.authorizedHeadId cannot change without a newer head generation.`,
    );
  }
  if (
    next.authorizedHeadGeneration > previous.authorizedHeadGeneration &&
    next.authorizedHeadId === previous.authorizedHeadId
  ) {
    throw new Error(
      `${path}.authorizedHeadId must change with a newer head generation.`,
    );
  }
  const operationChanged =
    next.deploymentOperationId !== previous.deploymentOperationId;
  if (
    operationChanged &&
    next.authorizedHeadGeneration <= previous.authorizedHeadGeneration
  ) {
    throw new Error(
      `${path}.deploymentOperationId can change only with a newer authorized head generation.`,
    );
  }
  const revisionChanged = SUCCESSOR_REVISION_KEYS.some(
    (field) => nextRecord[field] !== previousRecord[field],
  );
  for (const field of [
    'activationRecordVersion',
    'activationSelectionGeneration',
  ]) {
    if (nextRecord[field] < previousRecord[field]) {
      throw new Error(`${path}.${field} cannot regress.`);
    }
  }

  if (revisionChanged) {
    if (!operationChanged) {
      throw new Error(
        `${path}.deploymentOperationId must change with deployed revision authority.`,
      );
    }
    if (next.authorizedHeadGeneration <= previous.authorizedHeadGeneration) {
      throw new Error(
        `${path}.authorizedHeadGeneration must increase with deployed revision authority.`,
      );
    }
    if (next.sessionId === previous.sessionId) {
      throw new Error(
        `${path}.sessionId must change with deployed revision authority.`,
      );
    }
    if (
      next.activationRecordVersion <= previous.activationRecordVersion ||
      next.activationSelectionGeneration <=
        previous.activationSelectionGeneration
    ) {
      throw new Error(
        `${path} deployed revision changes require strictly newer activation record and selection generations.`,
      );
    }
  }

  if (next.sessionId === previous.sessionId) {
    if (next.ownerGeneration !== previous.ownerGeneration) {
      throw new Error(
        `${path}.ownerGeneration cannot change within one session.`,
      );
    }
    if (next.lifecycleGeneration !== previous.lifecycleGeneration) {
      throw new Error(
        `${path}.lifecycleGeneration cannot change within one session.`,
      );
    }
    if (next.processId !== previous.processId) {
      throw new Error(`${path}.processId cannot change within one session.`);
    }
    if (
      previous.sequence === Number.MAX_SAFE_INTEGER ||
      next.sequence !== previous.sequence + 1
    ) {
      throw new Error(
        `${path}.sequence must be the exact next safe integer within one session.`,
      );
    }
    return;
  }

  if (next.lifecycleGeneration <= previous.lifecycleGeneration) {
    throw new Error(
      `${path}.lifecycleGeneration must increase for a new session.`,
    );
  }
  if (next.sequence !== 1) {
    throw new Error(`${path}.sequence must restart at 1 for a new session.`);
  }
}

/**
 * Validate one receipt as the only admissible successor to another receipt.
 * This is a writer-fencing relation, not freshness evidence: provider-owned
 * object metadata remains responsible for proving when the write occurred.
 * @param {unknown} previousValue - Current receipt.
 * @param {unknown} nextValue - Proposed replacement receipt.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentServiceHealthReceiptV2>} - Canonical successor.
 */
export function validateDeploymentServiceHealthReceiptSuccessor(
  previousValue,
  nextValue,
  valuePath = 'deploymentServiceHealthReceiptSuccessor',
) {
  const previous = validateDeploymentServiceHealthReceipt(
    previousValue,
    `${valuePath}.previous`,
  );
  const next = validateDeploymentServiceHealthReceipt(
    nextValue,
    `${valuePath}.next`,
  );
  assertSuccessor(previous, next, `${valuePath}.next`);
  return next;
}

export default {
  DEPLOYMENT_SERVICE_HEALTH_CONTEXT_MAX_BYTES,
  DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_DOMAIN,
  DEPLOYMENT_SERVICE_HEALTH_RECEIPT_ID_PREFIX,
  DEPLOYMENT_SERVICE_HEALTH_RECEIPT_KIND,
  DEPLOYMENT_SERVICE_HEALTH_RECEIPT_MAX_BYTES,
  DEPLOYMENT_SERVICE_HEALTH_RECEIPT_SCHEMA_VERSION,
  createDeploymentServiceHealthReceipt,
  getDeploymentServiceHealthObjectKey,
  getDeploymentServiceHealthObjectLocation,
  validateDeploymentServiceHealthReceipt,
  validateDeploymentServiceHealthReceiptContext,
  validateDeploymentServiceHealthReceiptSuccessor,
};
