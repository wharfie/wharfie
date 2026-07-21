/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact internal helpers are not understood cleanly by the current JSDoc lint parser. */

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from './application-revision.js';
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
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  DEPLOYMENT_CAPABILITY_IDS,
  validateDeploymentProfile,
} from './deployment-profile.js';
import { validateDeploymentHead } from './deployment-head.js';
import {
  AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import {
  DEPLOYMENT_CAPABILITIES,
  DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
  assertDeploymentIncarnationId,
  validateDeploymentResourceBinding,
  validateDeploymentResourceRole,
  validateProviderResourceId,
} from './deployment-resource-binding.js';
import {
  AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES,
  getAwsSingleNodeResourceApplyOrder,
  getAwsSingleNodeResourceDefinition,
} from './deployment-resource-graph.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import {
  getDeploymentServiceHealthObjectLocation,
  validateDeploymentServiceHealthReceiptContext,
} from './deployment-service-health.js';
import {
  validateDeploymentServiceHealthObservation,
  validateDeploymentServiceHealthObservationFreshness,
} from './deployment-service-health-s3.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const DEPLOYMENT_INSPECTION_SCHEMA_VERSION = 5;
export const DEPLOYMENT_INSPECTION_KIND = 'deploymentInspection';
export const DEPLOYMENT_INSPECTION_ID_DOMAIN =
  'wharfie:deployment-inspection:v5';
export const DEPLOYMENT_INSPECTION_ID_PREFIX = 'win5';
export const DEPLOYMENT_INSPECTION_STATUSES = Object.freeze([
  'absent',
  'converged',
  'drifted',
  'in-flight',
  'degraded',
  'conflict',
  'unknown',
  'destroyed',
]);

const INPUT_KEYS = new Set([
  'deploymentRevision',
  'providerScope',
  'providerSpecId',
  'deploymentInstanceId',
  'controlState',
  'incarnationId',
  'headGeneration',
  'status',
  'resources',
]);
const PAYLOAD_KEYS = new Set(['schemaVersion', 'kind', ...INPUT_KEYS]);
const DOCUMENT_KEYS = new Set(['inspectionId', ...PAYLOAD_KEYS]);
const RESOURCE_KEYS = new Set([
  'resourceKey',
  'capability',
  'role',
  'management',
  'ownershipMode',
  'dependsOn',
  'onDestroy',
  'bindingId',
  'dependencyBindings',
  'presence',
  'presenceEvidence',
  'ownership',
  'providerIdentity',
  'desiredDigest',
  'observedDigest',
  'health',
  'service',
]);
const CAPABILITY_KEYS = new Set(['kind', 'version']);
const PROVIDER_IDENTITY_KEYS = new Set(['providerType', 'providerResourceId']);
const DEPENDENCY_BINDING_KEYS = new Set(['resourceKey', 'bindingId']);
const SERVICE_KEYS = new Set([
  'health',
  'artifactId',
  'revisionId',
  'healthReceipt',
]);
const CONTROL_STATE_KEYS = new Set(['status', 'evidence']);
const CONTROL_STATE_EVIDENCE = Object.freeze({
  absent: 'authoritative-not-found',
  present: 'provider-head-read',
  unknown: 'access-failure',
  conflict: 'identity-conflict',
});
const PRESENCE_VALUES = new Set(['present', 'absent', 'unknown']);
const PRESENCE_EVIDENCE = Object.freeze({
  present: 'exact-read',
  absent: 'authoritative-not-found',
  unknown: 'access-failure',
});
const OWNERSHIP_VALUES = new Set([
  'verified',
  'external',
  'missing',
  'conflict',
  'unknown',
]);
const HEALTH_VALUES = new Set([
  'healthy',
  'starting',
  'degraded',
  'stopped',
  'failed',
  'absent',
  'unknown',
  'not-applicable',
]);
const MAX_INSPECTION_RESOURCES = AWS_SINGLE_NODE_RESOURCE_GRAPH_MAX_RESOURCES;

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

/** @param {unknown} value @param {string} path @returns {{kind: string, version: 1}} */
function validateCapability(value, path) {
  const capability = cloneJsonObject(value, path);
  assertAllKeys(capability, CAPABILITY_KEYS, path);
  if (!DEPLOYMENT_CAPABILITIES.includes(capability.kind)) {
    throw new TypeError(`${path}.kind is not a supported capability.`);
  }
  if (capability.version !== 1) {
    throw new TypeError(`${path}.version must be the integer 1.`);
  }
  return { kind: capability.kind, version: 1 };
}

/** @param {unknown} value @param {string} path @returns {Record<string, string>|null} */
function validateProviderIdentity(value, path) {
  if (value === null) return null;
  const identity = cloneJsonObject(value, path);
  assertAllKeys(identity, PROVIDER_IDENTITY_KEYS, path);
  assertLogicalId(identity.providerType, `${path}.providerType`);
  const providerResourceId = validateProviderResourceId(
    identity.providerResourceId,
    `${path}.providerResourceId`,
  );
  assertManifestIsSecretFree(identity, path);
  return {
    providerType: identity.providerType,
    providerResourceId,
  };
}

/**
 * Record how the provider-backed deployment head was observed. This makes an
 * authoritative not-found distinct from access failure or an empty resource
 * list. The provider driver remains the authority that obtains this evidence.
 * @param {unknown} value - Candidate head observation.
 * @param {string} path - Human-readable value path.
 * @returns {Readonly<{status: string, evidence: string}>} - Canonical evidence.
 */
function validateControlState(value, path) {
  const observation = cloneJsonObject(value, path);
  assertAllKeys(observation, CONTROL_STATE_KEYS, path);
  const expectedEvidence = /** @type {Readonly<Record<string, string>>} */ (
    CONTROL_STATE_EVIDENCE
  )[observation.status];
  if (
    expectedEvidence === undefined ||
    observation.evidence !== expectedEvidence
  ) {
    throw new TypeError(
      `${path} must contain one supported status and its exact evidence kind.`,
    );
  }
  return Object.freeze({
    status: observation.status,
    evidence: expectedEvidence,
  });
}

/**
 * Validate the existing packaged service proof projected by the provider.
 * @param {unknown} value - Candidate resident service observation.
 * @param {string} path - Human-readable value path.
 * @returns {Readonly<Record<string, any>>|null} - Canonical observation.
 */
function validateService(value, path) {
  if (value === null) return null;
  const service = cloneJsonObject(value, path);
  assertAllKeys(service, SERVICE_KEYS, path);
  if (
    !['healthy', 'starting', 'degraded', 'stopped', 'failed'].includes(
      service.health,
    )
  ) {
    throw new TypeError(`${path}.health is not a supported service status.`);
  }
  assertArtifactId(service.artifactId, `${path}.artifactId`);
  assertApplicationRevisionId(service.revisionId, `${path}.revisionId`);
  const healthReceipt =
    service.healthReceipt === null
      ? null
      : validateDeploymentServiceHealthObservation(
          service.healthReceipt,
          `${path}.healthReceipt`,
        );
  if (service.health === 'healthy' && healthReceipt === null) {
    throw new Error(
      `${path}.healthReceipt is required for provider-visible healthy status.`,
    );
  }
  if (service.health !== 'healthy' && healthReceipt !== null) {
    throw new Error(
      `${path}.healthReceipt can prove only provider-visible healthy status.`,
    );
  }
  if (
    healthReceipt !== null &&
    (healthReceipt.receipt.health !== service.health ||
      healthReceipt.receipt.artifactId !== service.artifactId ||
      healthReceipt.receipt.revisionId !== service.revisionId)
  ) {
    throw new Error(
      `${path}.healthReceipt must prove the exact reported health and release.`,
    );
  }
  return Object.freeze({
    health: service.health,
    artifactId: service.artifactId,
    revisionId: service.revisionId,
    healthReceipt,
  });
}

/**
 * @param {unknown} value - Candidate exact dependency binding lineage.
 * @param {string} ownerResourceKey - Resource carrying the lineage.
 * @param {string} path - Human-readable value path.
 * @returns {Readonly<Array<{resourceKey: string, bindingId: string}>>|null} - Canonical lineage.
 */
function validateDependencyBindings(value, ownerResourceKey, path) {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be null or an array.`);
  }
  if (value.length > MAX_INSPECTION_RESOURCES) {
    throw new TypeError(
      `${path} must contain at most ${MAX_INSPECTION_RESOURCES} references.`,
    );
  }
  /** @type {string|null} */
  let previousResourceKey = null;
  return value.map((candidate, index) => {
    const valuePath = `${path}[${index}]`;
    const dependency = cloneJsonObject(candidate, valuePath);
    assertAllKeys(dependency, DEPENDENCY_BINDING_KEYS, valuePath);
    assertLogicalId(dependency.resourceKey, `${valuePath}.resourceKey`);
    if (dependency.resourceKey === ownerResourceKey) {
      throw new Error(`${path} cannot reference its own resourceKey.`);
    }
    if (
      previousResourceKey !== null &&
      compareCanonicalStrings(previousResourceKey, dependency.resourceKey) >= 0
    ) {
      throw new Error(`${path} must be strictly sorted by unique resourceKey.`);
    }
    previousResourceKey = dependency.resourceKey;
    assertDomainSeparatedSha256Id(
      dependency.bindingId,
      DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
      `${valuePath}.bindingId`,
    );
    return Object.freeze({
      resourceKey: dependency.resourceKey,
      bindingId: dependency.bindingId,
    });
  });
}

/** @param {unknown} value @param {string} path @returns {string|null} */
function validateBindingId(value, path) {
  if (value === null) return null;
  assertDomainSeparatedSha256Id(
    value,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    path,
  );
  return value;
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateResource(value, path) {
  const resource = cloneJsonObject(value, path);
  assertAllKeys(resource, RESOURCE_KEYS, path);
  assertLogicalId(resource.resourceKey, `${path}.resourceKey`);
  const capability = validateCapability(
    resource.capability,
    `${path}.capability`,
  );
  const role = validateDeploymentResourceRole(resource.role, `${path}.role`);
  const resourceDefinition = getAwsSingleNodeResourceDefinition(
    resource.resourceKey,
  );
  if (resourceDefinition === null) {
    throw new TypeError(
      `${path}.resourceKey is not supported by the AWS single-node resource graph.`,
    );
  }
  if (resource.management !== 'managed' && resource.management !== 'external') {
    throw new TypeError(`${path}.management must be 'managed' or 'external'.`);
  }
  if (
    resource.ownershipMode !== 'direct' &&
    resource.ownershipMode !== 'derived'
  ) {
    throw new TypeError(`${path}.ownershipMode must be 'direct' or 'derived'.`);
  }
  if (!Array.isArray(resource.dependsOn)) {
    throw new TypeError(`${path}.dependsOn must be an array.`);
  }
  const dependencyKeys = new Set();
  const dependsOn = resource.dependsOn.map((dependency, index) => {
    assertLogicalId(dependency, `${path}.dependsOn[${index}]`);
    if (dependencyKeys.has(dependency)) {
      throw new Error(`${path}.dependsOn must contain unique resource keys.`);
    }
    dependencyKeys.add(dependency);
    return dependency;
  });
  if (resource.onDestroy !== 'retain' && resource.onDestroy !== 'purge') {
    throw new TypeError(`${path}.onDestroy must be 'retain' or 'purge'.`);
  }
  if (
    capability.kind !== resourceDefinition.capability.kind ||
    capability.version !== resourceDefinition.capability.version ||
    role.kind !== resourceDefinition.role.kind ||
    role.version !== resourceDefinition.role.version ||
    resource.ownershipMode !== resourceDefinition.ownershipMode ||
    resource.onDestroy !== resourceDefinition.onDestroy ||
    dependsOn.length !== resourceDefinition.dependsOn.length ||
    dependsOn.some(
      (dependency, index) => dependency !== resourceDefinition.dependsOn[index],
    )
  ) {
    throw new Error(
      `${path} does not match the exact AWS single-node resource graph role.`,
    );
  }
  if (!PRESENCE_VALUES.has(resource.presence)) {
    throw new TypeError(`${path}.presence is not supported.`);
  }
  const expectedPresenceEvidence =
    /** @type {Readonly<Record<string, string>>} */ (PRESENCE_EVIDENCE)[
      resource.presence
    ];
  if (resource.presenceEvidence !== expectedPresenceEvidence) {
    throw new TypeError(
      `${path}.presenceEvidence must be '${expectedPresenceEvidence}' when presence is '${resource.presence}'.`,
    );
  }
  if (!OWNERSHIP_VALUES.has(resource.ownership)) {
    throw new TypeError(`${path}.ownership is not supported.`);
  }
  if (!HEALTH_VALUES.has(resource.health)) {
    throw new TypeError(`${path}.health is not supported.`);
  }
  if (resource.management === 'external' && resource.ownership !== 'external') {
    throw new Error(
      `${path} external resources must report external ownership.`,
    );
  }
  if (resource.management === 'managed' && resource.ownership === 'external') {
    throw new Error(
      `${path} managed resources cannot report external ownership.`,
    );
  }
  if (
    resource.management === 'managed' &&
    resource.presence === 'absent' &&
    resource.ownership !== 'missing'
  ) {
    throw new Error(
      `${path} absent managed resources must report missing ownership.`,
    );
  }
  if (
    resource.management === 'managed' &&
    resource.presence === 'unknown' &&
    resource.ownership !== 'unknown'
  ) {
    throw new Error(
      `${path} unknown managed resources must report unknown ownership.`,
    );
  }
  const providerIdentity = validateProviderIdentity(
    resource.providerIdentity,
    `${path}.providerIdentity`,
  );
  if (
    providerIdentity !== null &&
    providerIdentity.providerType !== resourceDefinition.providerType
  ) {
    throw new Error(
      `${path}.providerIdentity.providerType does not match resource graph role '${role.kind}'.`,
    );
  }
  const dependencyBindings = validateDependencyBindings(
    resource.dependencyBindings,
    resource.resourceKey,
    `${path}.dependencyBindings`,
  );
  const bindingId = validateBindingId(resource.bindingId, `${path}.bindingId`);
  const hasExactBindingEvidence =
    resource.presence === 'present' &&
    ((resource.management === 'managed' && resource.ownership === 'verified') ||
      (resource.management === 'external' &&
        resource.ownership === 'external'));
  if (
    (hasExactBindingEvidence &&
      (bindingId === null || dependencyBindings === null)) ||
    (!hasExactBindingEvidence &&
      (bindingId !== null || dependencyBindings !== null))
  ) {
    throw new Error(
      `${path} exact present ownership evidence requires bindingId and dependencyBindings; other evidence requires both to be null.`,
    );
  }
  if (
    dependencyBindings !== null &&
    (dependencyBindings.length !== resourceDefinition.dependsOn.length ||
      dependencyBindings.some(
        (dependency) =>
          !resourceDefinition.dependsOn.includes(dependency.resourceKey),
      ))
  ) {
    throw new Error(
      `${path}.dependencyBindings does not match the exact graph dependencies.`,
    );
  }
  const desiredDigest =
    resource.desiredDigest === null
      ? null
      : validateSha256Digest(resource.desiredDigest, `${path}.desiredDigest`);
  const observedDigest =
    resource.observedDigest === null
      ? null
      : validateSha256Digest(resource.observedDigest, `${path}.observedDigest`);
  const service = validateService(resource.service, `${path}.service`);
  if (resource.resourceKey !== 'substrate' && service !== null) {
    throw new Error(
      `${path}.service is supported only for the substrate node.`,
    );
  }
  if (service !== null && resource.health !== service.health) {
    throw new Error(`${path}.health must match the resident service proof.`);
  }
  if (resource.presence === 'present' && providerIdentity === null) {
    throw new Error(`${path}.providerIdentity is required when present.`);
  }
  if (
    resource.presence !== 'present' &&
    (providerIdentity !== null || observedDigest !== null)
  ) {
    throw new Error(
      `${path} cannot claim provider identity or observed state unless present.`,
    );
  }
  if (resource.presence === 'absent' && resource.health !== 'absent') {
    throw new Error(
      `${path}.health must be absent when the resource is absent.`,
    );
  }
  if (resource.presence === 'unknown' && resource.health !== 'unknown') {
    throw new Error(`${path}.health must be unknown when presence is unknown.`);
  }
  return deepFreeze({
    resourceKey: resource.resourceKey,
    capability,
    role,
    management: resource.management,
    ownershipMode: resource.ownershipMode,
    dependsOn,
    onDestroy: resource.onDestroy,
    bindingId,
    dependencyBindings,
    presence: resource.presence,
    presenceEvidence: expectedPresenceEvidence,
    ownership: resource.ownership,
    providerIdentity,
    desiredDigest,
    observedDigest,
    health: resource.health,
    service,
  });
}

/** @param {Record<string, any>} left @param {Record<string, any>} right @returns {boolean} */
function digestsEqual(left, right) {
  return left.algorithm === right.algorithm && left.value === right.value;
}

/** @param {string} status @param {Readonly<Record<string, any>>[]} resources @param {Readonly<Record<string, string>>} controlState @param {string|null} incarnationId @param {number} generation @param {string} path @returns {void} */
function assertStatusEvidence(
  status,
  resources,
  controlState,
  incarnationId,
  generation,
  path,
) {
  if (controlState.status === 'absent') {
    if (status !== 'absent') {
      throw new Error(
        `${path} authoritative head absence requires absent status.`,
      );
    }
    if (generation !== 0 || incarnationId !== null || resources.length !== 0) {
      throw new Error(
        `${path} absent status requires generation zero, no incarnation, and no resources.`,
      );
    }
    return;
  }
  if (controlState.status === 'unknown') {
    if (
      status !== 'unknown' ||
      generation !== 0 ||
      incarnationId !== null ||
      resources.length !== 0
    ) {
      throw new Error(
        `${path} unknown head access requires unknown status and no invented deployment state.`,
      );
    }
    return;
  }
  if (controlState.status === 'conflict') {
    if (status !== 'conflict' || generation !== 0 || incarnationId !== null) {
      throw new Error(
        `${path} conflicting head identity requires conflict status and no invented incarnation.`,
      );
    }
    return;
  }
  if (status === 'absent') {
    throw new Error(
      `${path} cannot infer absence after a provider head was observed.`,
    );
  }
  if (incarnationId === null) {
    throw new Error(`${path} status '${status}' requires an incarnationId.`);
  }
  if (generation === 0) {
    throw new Error(`${path} status '${status}' requires a durable head.`);
  }
  const hasConflict = resources.some(
    (resource) => resource.ownership === 'conflict',
  );
  const hasUnknown = resources.some(
    (resource) =>
      resource.presence === 'unknown' || resource.ownership === 'unknown',
  );
  if (hasConflict && status !== 'conflict') {
    throw new Error(`${path} ownership conflict requires conflict status.`);
  }
  if (status === 'conflict' && !hasConflict) {
    throw new Error(
      `${path} conflict status requires ownership conflict evidence.`,
    );
  }
  if (
    hasUnknown &&
    status !== 'unknown' &&
    status !== 'in-flight' &&
    status !== 'conflict'
  ) {
    throw new Error(
      `${path} unknown provider evidence cannot prove '${status}'.`,
    );
  }
  if (status === 'unknown' && !hasUnknown) {
    throw new Error(
      `${path} unknown status requires unknown provider evidence.`,
    );
  }
  if (status === 'converged') {
    if (
      resources.length === 0 ||
      resources.some(
        (resource) =>
          resource.presence !== 'present' ||
          (resource.ownership !== 'verified' &&
            resource.ownership !== 'external') ||
          resource.desiredDigest === null ||
          resource.observedDigest === null ||
          !digestsEqual(resource.desiredDigest, resource.observedDigest) ||
          (resource.resourceKey === 'substrate'
            ? resource.health !== 'healthy' || resource.service === null
            : resource.health !== 'healthy' &&
              resource.health !== 'not-applicable'),
      )
    ) {
      throw new Error(
        `${path} converged status requires exact present, owned, healthy resource evidence.`,
      );
    }
  }
  if (status === 'drifted') {
    const hasDrift = resources.some(
      (resource) =>
        resource.presence === 'absent' ||
        resource.ownership === 'missing' ||
        resource.desiredDigest === null ||
        resource.observedDigest === null ||
        !digestsEqual(resource.desiredDigest, resource.observedDigest),
    );
    if (!hasDrift) {
      throw new Error(
        `${path} drifted status requires concrete drift evidence.`,
      );
    }
  }
  if (
    status === 'degraded' &&
    !resources.some((resource) =>
      ['degraded', 'stopped', 'failed'].includes(resource.health),
    )
  ) {
    throw new Error(
      `${path} degraded status requires unhealthy resource evidence.`,
    );
  }
}

/**
 * Prove that a live inspection covers the exact finite profile capabilities.
 * @param {Readonly<Record<string, any>>} payload - Canonical inspection payload.
 * @param {Readonly<Record<string, any>>} profile - Exact deployment profile.
 * @param {unknown} providerSpec - Exact resolved provider specification.
 * @param {unknown} head - Optional exact durable head for full receipt lineage validation.
 * @param {unknown} pendingBinding - Optional just-settled binding not yet published in the durable head.
 * @param {unknown} now - Explicit sampled epoch milliseconds for health freshness validation.
 * @param {string} path - Human-readable value path.
 * @returns {void}
 */
function assertInspectionContext(
  payload,
  profile,
  providerSpec,
  head,
  pendingBinding,
  now,
  path,
) {
  const canonicalHead =
    head === undefined || head === null
      ? head
      : validateDeploymentHead(head, `${path} context.head`);
  if (
    canonicalHead !== undefined &&
    canonicalHead !== null &&
    (canonicalHead.deploymentInstanceId !== payload.deploymentInstanceId ||
      canonicalHead.providerScope.providerScopeId !==
        payload.providerScope.providerScopeId ||
      canonicalHead.incarnationId !== payload.incarnationId ||
      canonicalHead.generation !== payload.headGeneration)
  ) {
    throw new Error(
      `${path} context.head does not match the exact inspection authority.`,
    );
  }
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    providerSpec,
    { profile, providerScope: payload.providerScope },
  );
  if (payload.providerSpecId !== canonicalProviderSpec.providerSpecId) {
    throw new Error(
      `${path}.providerSpecId does not match the exact provider specification.`,
    );
  }
  if (
    payload.deploymentRevision.profileRevisionId !==
      profile.profileRevisionId ||
    payload.deploymentRevision.appId !== profile.appId
  ) {
    throw new Error(`${path} profile does not match the deployment revision.`);
  }
  if (
    profile.provider.kind !== payload.providerScope.provider ||
    profile.provider.scope.region !== payload.providerScope.region
  ) {
    throw new Error(
      `${path} provider scope does not match the exact profile provider and region.`,
    );
  }

  const configurationKeyByCapability = new Map(
    Object.entries(DEPLOYMENT_CAPABILITY_IDS).map(([key, capability]) => [
      capability,
      key,
    ]),
  );

  const bindingByResourceKey =
    canonicalHead !== undefined && canonicalHead !== null
      ? new Map(
          canonicalHead.resourceBindings.map(
            (/** @type {Readonly<Record<string, any>>} */ binding) => [
              binding.resourceKey,
              binding,
            ],
          ),
        )
      : null;
  const canonicalPendingBinding =
    pendingBinding === undefined || pendingBinding === null
      ? null
      : validateDeploymentResourceBinding(
          pendingBinding,
          `${path} context.pendingBinding`,
        );
  if (canonicalPendingBinding !== null) {
    if (canonicalHead === undefined || canonicalHead === null) {
      throw new Error(
        `${path} context.pendingBinding requires an exact durable head.`,
      );
    }
    const operation = canonicalHead.activeOperation;
    const currentIntent =
      operation !== null && operation.nextActionIndex < operation.intents.length
        ? operation.intents[operation.nextActionIndex]
        : null;
    if (currentIntent === null || currentIntent.status !== 'intended') {
      throw new Error(
        `${path} context.pendingBinding requires an active intended current intent.`,
      );
    }
    if (
      canonicalPendingBinding.deploymentInstanceId !==
        payload.deploymentInstanceId ||
      canonicalPendingBinding.providerScopeId !==
        payload.providerScope.providerScopeId ||
      canonicalPendingBinding.incarnationId !== payload.incarnationId
    ) {
      throw new Error(
        `${path} context.pendingBinding does not match the inspection deployment, provider scope, and incarnation.`,
      );
    }
    if (
      bindingByResourceKey === null ||
      bindingByResourceKey.has(canonicalPendingBinding.resourceKey)
    ) {
      throw new Error(
        `${path} context.pendingBinding resourceKey must not already exist in the durable head.`,
      );
    }
    if (
      canonicalPendingBinding.management !== 'managed' ||
      canonicalPendingBinding.ownershipNonce !== currentIntent.ownershipNonce ||
      canonicalPendingBinding.createdByActionId !== currentIntent.actionId
    ) {
      throw new Error(
        `${path} context.pendingBinding does not match the current intent ownership authority.`,
      );
    }
    for (const dependency of canonicalPendingBinding.dependencyBindings) {
      if (
        bindingByResourceKey.get(dependency.resourceKey)?.bindingId !==
        dependency.bindingId
      ) {
        throw new Error(
          `${path} context.pendingBinding dependency '${dependency.resourceKey}' does not resolve to the exact durable head binding.`,
        );
      }
    }
    bindingByResourceKey.set(
      canonicalPendingBinding.resourceKey,
      canonicalPendingBinding,
    );
  }

  if (bindingByResourceKey !== null) {
    for (const binding of bindingByResourceKey.values()) {
      const resourceDefinition = getAwsSingleNodeResourceDefinition(
        binding.resourceKey,
      );
      const configurationKey =
        resourceDefinition === null
          ? undefined
          : configurationKeyByCapability.get(
              resourceDefinition.capability.kind,
            );
      const configuration =
        configurationKey === undefined
          ? undefined
          : profile.provider.configuration[configurationKey];
      const expectedDependencyKeys =
        resourceDefinition === null
          ? []
          : [...resourceDefinition.dependsOn].sort(compareCanonicalStrings);
      if (
        resourceDefinition === null ||
        !configuration ||
        configuration.management === 'none' ||
        binding.management !== configuration.management ||
        JSON.stringify(binding.capability) !==
          JSON.stringify(resourceDefinition.capability) ||
        JSON.stringify(binding.role) !==
          JSON.stringify(resourceDefinition.role) ||
        binding.ownershipMode !==
          (binding.management === 'external'
            ? 'external'
            : resourceDefinition.ownershipMode) ||
        binding.onDestroy !== resourceDefinition.onDestroy ||
        binding.providerType !== resourceDefinition.providerType ||
        binding.dependencyBindings.length !== expectedDependencyKeys.length ||
        binding.dependencyBindings.some(
          (
            /** @type {Readonly<Record<string, any>>} */ dependency,
            /** @type {number} */ index,
          ) => dependency.resourceKey !== expectedDependencyKeys[index],
        )
      ) {
        throw new Error(
          `${path} binding '${binding.resourceKey}' does not match the exact AWS single-node resource graph and profile.`,
        );
      }
    }
  }

  if (payload.controlState.status !== 'present') {
    return;
  }
  for (const resource of payload.resources) {
    const resourceDefinition = getAwsSingleNodeResourceDefinition(
      resource.resourceKey,
    );
    if (resourceDefinition === null) {
      throw new Error(
        `${path} resource '${resource.resourceKey}' is absent from the exact provider graph.`,
      );
    }
    const configurationKey = configurationKeyByCapability.get(
      resource.capability.kind,
    );
    const configuration =
      configurationKey === undefined
        ? undefined
        : profile.provider.configuration[configurationKey];
    if (!configuration || configuration.management === 'none') {
      throw new Error(
        `${path} resource '${resource.resourceKey}' is not authorized by the profile.`,
      );
    }
    if (resource.management !== configuration.management) {
      throw new Error(
        `${path} resource '${resource.resourceKey}' management does not match the profile.`,
      );
    }

    if (payload.status === 'destroyed') {
      const retained = resource.onDestroy === 'retain';
      if (
        retained &&
        (resource.presence !== 'present' ||
          (resource.management === 'managed' &&
            resource.ownership !== 'verified') ||
          (resource.management === 'external' &&
            resource.ownership !== 'external'))
      ) {
        throw new Error(
          `${path} destroyed status requires retained capability '${resource.capability.kind}' to remain present with exact ownership evidence.`,
        );
      }
      if (!retained && resource.presence !== 'absent') {
        throw new Error(
          `${path} destroyed status requires purged capability '${resource.capability.kind}' to be absent.`,
        );
      }
    }

    const hasExactBindingEvidence =
      resource.presence === 'present' &&
      ((resource.management === 'managed' &&
        resource.ownership === 'verified') ||
        (resource.management === 'external' &&
          resource.ownership === 'external'));
    if (
      hasExactBindingEvidence &&
      canonicalHead !== undefined &&
      canonicalHead !== null
    ) {
      const exactBinding = bindingByResourceKey?.get(resource.resourceKey);
      if (
        bindingByResourceKey === null ||
        exactBinding === undefined ||
        resource.bindingId === null ||
        resource.dependencyBindings === null
      ) {
        throw new Error(
          `${path} present owned resource '${resource.resourceKey}' requires exact binding evidence.`,
        );
      }
      const expectedDependencyKeys = [...resourceDefinition.dependsOn].sort(
        compareCanonicalStrings,
      );
      if (
        exactBinding.bindingId !== resource.bindingId ||
        JSON.stringify(exactBinding.capability) !==
          JSON.stringify(resource.capability) ||
        JSON.stringify(exactBinding.role) !== JSON.stringify(resource.role) ||
        exactBinding.management !== resource.management ||
        exactBinding.ownershipMode !==
          (resource.management === 'external'
            ? 'external'
            : resource.ownershipMode) ||
        exactBinding.onDestroy !== resource.onDestroy ||
        exactBinding.providerType !== resource.providerIdentity?.providerType ||
        exactBinding.providerResourceId !==
          resource.providerIdentity?.providerResourceId ||
        JSON.stringify(exactBinding.dependencyBindings) !==
          JSON.stringify(resource.dependencyBindings) ||
        resource.dependencyBindings.length !== expectedDependencyKeys.length ||
        resource.dependencyBindings.some(
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
          `${path} resource '${resource.resourceKey}' binding evidence does not match the exact head.`,
        );
      }
    }
  }
  const expectedResourceOrder = getAwsSingleNodeResourceApplyOrder();
  if (
    payload.resources.length !== expectedResourceOrder.length ||
    payload.resources.some(
      (
        /** @type {Readonly<Record<string, any>>} */ resource,
        /** @type {number} */ index,
      ) => resource.resourceKey !== expectedResourceOrder[index],
    )
  ) {
    throw new Error(
      `${path} must report the complete AWS single-node resource graph in topological apply order.`,
    );
  }
  const resident = payload.resources.find(
    (/** @type {Readonly<Record<string, any>>} */ resource) =>
      resource.resourceKey === 'substrate',
  );
  const runtimeRole = payload.resources.find(
    (/** @type {Readonly<Record<string, any>>} */ resource) =>
      resource.resourceKey === 'runtime-role',
  );
  const healthObservation = resident?.service?.healthReceipt ?? null;
  if (healthObservation !== null) {
    const receipt = healthObservation.receipt;
    const expectedLocation = getDeploymentServiceHealthObjectLocation(
      payload.providerScope,
      receipt,
    );
    if (
      receipt.providerScopeId !== payload.providerScope.providerScopeId ||
      receipt.providerSpecId !== payload.providerSpecId ||
      receipt.deploymentInstanceId !== payload.deploymentInstanceId ||
      receipt.incarnationId !== payload.incarnationId ||
      receipt.deploymentRevisionId !==
        payload.deploymentRevision.deploymentRevisionId ||
      receipt.appId !== payload.deploymentRevision.appId ||
      receipt.artifactId !== payload.deploymentRevision.artifactId ||
      receipt.revisionId !== payload.deploymentRevision.revisionId ||
      receipt.nodeBindingId !== resident?.bindingId ||
      receipt.nodeProviderResourceId !==
        resident?.providerIdentity?.providerResourceId ||
      receipt.runtimeRoleBindingId !== runtimeRole?.bindingId ||
      receipt.runtimeRoleId !==
        runtimeRole?.providerIdentity?.providerResourceId ||
      receipt.authorizedHeadGeneration > payload.headGeneration ||
      healthObservation.object.bucketName !== expectedLocation.bucketName ||
      healthObservation.object.key !== expectedLocation.key
    ) {
      throw new Error(
        `${path} resident health receipt does not match the exact inspection authority.`,
      );
    }
    if (canonicalHead !== undefined && canonicalHead !== null) {
      validateDeploymentServiceHealthReceiptContext(
        receipt,
        {
          deploymentRevision: payload.deploymentRevision,
          profile,
          providerScope: payload.providerScope,
          providerSpec: canonicalProviderSpec,
          head: canonicalHead,
        },
        `${path}.residentHealthReceipt`,
      );
    }
    validateDeploymentServiceHealthObservationFreshness(
      healthObservation,
      {
        now,
        maxAgeSeconds:
          canonicalProviderSpec.capabilities.serviceHealth.maxAgeSeconds,
        clockSkewSeconds:
          canonicalProviderSpec.capabilities.serviceHealth.clockSkewSeconds,
      },
      `${path}.residentHealthReceipt`,
    );
  }
  if (payload.status === 'converged') {
    if (
      resident?.service?.health !== 'healthy' ||
      resident.service.artifactId !== payload.deploymentRevision.artifactId ||
      resident.service.revisionId !== payload.deploymentRevision.revisionId ||
      resident.service.healthReceipt === null
    ) {
      throw new Error(
        `${path} converged status requires a provider-visible receipt proving the exact deployment artifact and revision healthy.`,
      );
    }
  }
}

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function createPayload(value, path) {
  const input = cloneJsonObject(value, path);
  assertAllKeys(input, INPUT_KEYS, path);
  const deploymentRevision = validateDeploymentRevision(
    input.deploymentRevision,
    `${path}.deploymentRevision`,
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    `${path}.providerScope`,
  );
  assertDomainSeparatedSha256Id(
    input.providerSpecId,
    AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    `${path}.providerSpecId`,
  );
  const controlState = validateControlState(
    input.controlState,
    `${path}.controlState`,
  );
  assertDeploymentInstanceId(
    input.deploymentInstanceId,
    `${path}.deploymentInstanceId`,
  );
  if (
    input.deploymentInstanceId !==
    getDeploymentInstanceId({ deploymentRevision, providerScope })
  ) {
    throw new Error(
      `${path}.deploymentInstanceId does not match the deployment and provider scope.`,
    );
  }
  if (input.incarnationId !== null) {
    assertDeploymentIncarnationId(input.incarnationId, `${path}.incarnationId`);
  }
  if (!Number.isSafeInteger(input.headGeneration) || input.headGeneration < 0) {
    throw new TypeError(
      `${path}.headGeneration must be a nonnegative safe integer.`,
    );
  }
  if (!DEPLOYMENT_INSPECTION_STATUSES.includes(input.status)) {
    throw new TypeError(`${path}.status is not supported.`);
  }
  if (
    !Array.isArray(input.resources) ||
    input.resources.length > MAX_INSPECTION_RESOURCES
  ) {
    throw new TypeError(
      `${path}.resources must contain at most ${MAX_INSPECTION_RESOURCES} resources.`,
    );
  }
  const resources = input.resources.map((resource, index) =>
    validateResource(resource, `${path}.resources[${index}]`),
  );
  const seenResourceKeys = new Set();
  for (const resource of resources) {
    if (seenResourceKeys.has(resource.resourceKey)) {
      throw new Error(`${path}.resources must have unique resourceKey values.`);
    }
    seenResourceKeys.add(resource.resourceKey);
  }
  if (controlState.status === 'present') {
    const expectedResourceOrder = getAwsSingleNodeResourceApplyOrder();
    if (
      resources.length !== expectedResourceOrder.length ||
      resources.some(
        (resource, index) =>
          resource.resourceKey !== expectedResourceOrder[index],
      )
    ) {
      throw new Error(
        `${path}.resources must report the complete AWS single-node resource graph in topological apply order.`,
      );
    }
  }
  assertStatusEvidence(
    input.status,
    resources,
    controlState,
    input.incarnationId,
    input.headGeneration,
    path,
  );
  return {
    schemaVersion: DEPLOYMENT_INSPECTION_SCHEMA_VERSION,
    kind: DEPLOYMENT_INSPECTION_KIND,
    deploymentRevision,
    providerScope,
    providerSpecId: input.providerSpecId,
    deploymentInstanceId: input.deploymentInstanceId,
    controlState,
    incarnationId: input.incarnationId,
    headGeneration: input.headGeneration,
    status: input.status,
    resources,
  };
}

/**
 * Create a deterministic redacted provider inspection.
 * @param {unknown} value - Inspection evidence without derived ID.
 * @param {{profile?: unknown, providerSpec?: unknown, head?: unknown, pendingBinding?: unknown, now?: unknown}} [context] - Exact immutable profile, resolved provider context, optional durable/pending binding authority, and explicit sampled time when health evidence is present.
 * @returns {Readonly<Record<string, any>>} - Canonical inspection.
 */
export function createDeploymentInspection(value, context = {}) {
  if (!Object.prototype.hasOwnProperty.call(context, 'profile')) {
    throw new TypeError(
      'deploymentInspection context.profile is required to bind provider evidence.',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(context, 'providerSpec')) {
    throw new TypeError(
      'deploymentInspection context.providerSpec is required to bind provider evidence.',
    );
  }
  const profile = validateDeploymentProfile(
    context.profile,
    'deploymentInspection context.profile',
  );
  const payload = deepFreeze(
    sortCanonicalJsonValue(createPayload(value, 'deploymentInspection')),
  );
  assertInspectionContext(
    payload,
    profile,
    context.providerSpec,
    context.head,
    context.pendingBinding,
    context.now,
    'deploymentInspection',
  );
  const inspectionId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_INSPECTION_ID_DOMAIN,
    prefix: DEPLOYMENT_INSPECTION_ID_PREFIX,
    value: payload,
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, inspectionId }));
}

/**
 * Validate and recompute a serialized inspection.
 * @param {unknown} value - Candidate inspection.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical inspection.
 */
export function validateDeploymentInspection(
  value,
  valuePath = 'deploymentInspection',
) {
  const document = cloneJsonObject(value, valuePath);
  assertAllKeys(document, DOCUMENT_KEYS, valuePath);
  if (document.schemaVersion !== DEPLOYMENT_INSPECTION_SCHEMA_VERSION) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 5.`);
  }
  if (document.kind !== DEPLOYMENT_INSPECTION_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${DEPLOYMENT_INSPECTION_KIND}'.`,
    );
  }
  assertDomainSeparatedSha256Id(
    document.inspectionId,
    DEPLOYMENT_INSPECTION_ID_PREFIX,
    `${valuePath}.inspectionId`,
  );
  const payload = deepFreeze(
    sortCanonicalJsonValue(
      createPayload(
        {
          deploymentRevision: document.deploymentRevision,
          providerScope: document.providerScope,
          providerSpecId: document.providerSpecId,
          deploymentInstanceId: document.deploymentInstanceId,
          controlState: document.controlState,
          incarnationId: document.incarnationId,
          headGeneration: document.headGeneration,
          status: document.status,
          resources: document.resources,
        },
        valuePath,
      ),
    ),
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_INSPECTION_ID_DOMAIN,
    prefix: DEPLOYMENT_INSPECTION_ID_PREFIX,
    value: payload,
  });
  if (document.inspectionId !== expectedId) {
    throw new Error(
      `${valuePath}.inspectionId does not match its exact provider evidence.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, inspectionId: expectedId }),
  );
}

/**
 * Re-resolve the immutable profile before using inspection evidence to mutate.
 * @param {unknown} value - Candidate inspection.
 * @param {{profile: unknown, providerSpec: unknown, head?: unknown, pendingBinding?: unknown, now?: unknown}} context - Exact immutable profile, resolved provider specification, optional durable/pending binding authority, and explicit sampled time when health evidence is present.
 * @returns {Readonly<Record<string, any>>} - Fully cross-checked inspection.
 */
export function validateDeploymentInspectionContext(value, context) {
  const inspection = validateDeploymentInspection(value);
  const profile = validateDeploymentProfile(
    context?.profile,
    'deploymentInspection context.profile',
  );
  assertInspectionContext(
    inspection,
    profile,
    context?.providerSpec,
    context?.head,
    context?.pendingBinding,
    context?.now,
    'deploymentInspection',
  );
  return inspection;
}

export default {
  DEPLOYMENT_INSPECTION_ID_DOMAIN,
  DEPLOYMENT_INSPECTION_ID_PREFIX,
  DEPLOYMENT_INSPECTION_KIND,
  DEPLOYMENT_INSPECTION_SCHEMA_VERSION,
  DEPLOYMENT_INSPECTION_STATUSES,
  createDeploymentInspection,
  validateDeploymentInspection,
  validateDeploymentInspectionContext,
};
