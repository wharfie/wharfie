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
import {
  AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import {
  DEPLOYMENT_CAPABILITIES,
  assertDeploymentIncarnationId,
  validateProviderResourceId,
} from './deployment-resource-binding.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const DEPLOYMENT_INSPECTION_SCHEMA_VERSION = 2;
export const DEPLOYMENT_INSPECTION_KIND = 'deploymentInspection';
export const DEPLOYMENT_INSPECTION_ID_DOMAIN =
  'wharfie:deployment-inspection:v2';
export const DEPLOYMENT_INSPECTION_ID_PREFIX = 'win2';
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
  'management',
  'presence',
  'ownership',
  'providerIdentity',
  'desiredDigest',
  'observedDigest',
  'health',
  'service',
]);
const CAPABILITY_KEYS = new Set(['kind', 'version']);
const PROVIDER_IDENTITY_KEYS = new Set(['providerType', 'providerResourceId']);
const SERVICE_KEYS = new Set(['health', 'artifactId', 'revisionId']);
const CONTROL_STATE_KEYS = new Set(['status', 'evidence']);
const CONTROL_STATE_EVIDENCE = Object.freeze({
  absent: 'authoritative-not-found',
  present: 'provider-head-read',
  unknown: 'access-failure',
  conflict: 'identity-conflict',
});
const PRESENCE_VALUES = new Set(['present', 'absent', 'unknown']);
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
const MAX_INSPECTION_RESOURCES = 16;

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
 * @returns {Readonly<Record<string, string>>|null} - Canonical observation.
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
  return Object.freeze({
    health: service.health,
    artifactId: service.artifactId,
    revisionId: service.revisionId,
  });
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
  if (resource.management !== 'managed' && resource.management !== 'external') {
    throw new TypeError(`${path}.management must be 'managed' or 'external'.`);
  }
  if (!PRESENCE_VALUES.has(resource.presence)) {
    throw new TypeError(`${path}.presence is not supported.`);
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
  const providerIdentity = validateProviderIdentity(
    resource.providerIdentity,
    `${path}.providerIdentity`,
  );
  const desiredDigest =
    resource.desiredDigest === null
      ? null
      : validateSha256Digest(resource.desiredDigest, `${path}.desiredDigest`);
  const observedDigest =
    resource.observedDigest === null
      ? null
      : validateSha256Digest(resource.observedDigest, `${path}.observedDigest`);
  const service = validateService(resource.service, `${path}.service`);
  if (resource.capability.kind !== 'resident-node' && service !== null) {
    throw new Error(`${path}.service is supported only for the resident node.`);
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
    management: resource.management,
    presence: resource.presence,
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
          (resource.capability.kind === 'resident-node'
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
 * @param {string} path - Human-readable value path.
 * @returns {void}
 */
function assertInspectionContext(payload, profile, providerSpec, path) {
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
  const expectedCapabilities = new Set();
  for (const [capability, configurationKey] of configurationKeyByCapability) {
    if (
      profile.provider.configuration[configurationKey].management !== 'none'
    ) {
      expectedCapabilities.add(capability);
    }
  }

  if (payload.controlState.status !== 'present') {
    return;
  }

  const observedCapabilities = new Set();
  for (const resource of payload.resources) {
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
    if (observedCapabilities.has(resource.capability.kind)) {
      throw new Error(
        `${path} must report each profile capability exactly once.`,
      );
    }
    observedCapabilities.add(resource.capability.kind);

    if (payload.status === 'destroyed') {
      const retained = configuration.onDestroy === 'retain';
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
  }
  for (const capability of expectedCapabilities) {
    if (!observedCapabilities.has(capability)) {
      throw new Error(
        `${path} does not report required capability '${capability}'.`,
      );
    }
  }
  if (payload.status === 'converged') {
    const resident = payload.resources.find(
      (/** @type {Readonly<Record<string, any>>} */ resource) =>
        resource.capability.kind === 'resident-node',
    );
    if (
      resident?.service?.health !== 'healthy' ||
      resident.service.artifactId !== payload.deploymentRevision.artifactId ||
      resident.service.revisionId !== payload.deploymentRevision.revisionId
    ) {
      throw new Error(
        `${path} converged status requires the exact deployment artifact and revision to be healthy.`,
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
  const resources = input.resources
    .map((resource, index) =>
      validateResource(resource, `${path}.resources[${index}]`),
    )
    .sort((left, right) =>
      compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
  for (let index = 1; index < resources.length; index += 1) {
    if (resources[index - 1].resourceKey === resources[index].resourceKey) {
      throw new Error(`${path}.resources must have unique resourceKey values.`);
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
 * @param {{profile?: unknown, providerSpec?: unknown}} [context] - Exact immutable profile and resolved provider context.
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
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 2.`);
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
 * @param {{profile: unknown, providerSpec: unknown}} context - Exact immutable profile and resolved provider specification.
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
