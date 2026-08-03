/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  sha256Base64Url,
} from './content-id.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  DEPLOYMENT_ACTION_ID_PREFIX,
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import {
  AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN,
  AwsSingleNodeVolumeEvidenceConflictError,
  AwsSingleNodeVolumeEvidenceTransientError,
  AwsSingleNodeVolumeEvidenceUnknownError,
  AwsSingleNodeVolumeLifecycleUnknownError,
  createAwsSingleNodeVolumeStateDigest,
  decodeAwsSingleNodeExactVolumeResponse,
  decodeAwsSingleNodeVolumeActualState,
  decodeAwsSingleNodeVolumeDiscoveryPage,
  decodeAwsSingleNodeVolumeEvidence,
  getAwsSingleNodeVolumeDiscoveryFilters,
  getAwsSingleNodeVolumeOwnershipTags,
} from './deployment-aws-volume-evidence.js';

export {
  AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN,
};
export const AWS_SINGLE_NODE_VOLUME_CREATE_CLIENT_TOKEN_DOMAIN =
  'wharfie:aws-single-node-ebs-volume-create-client-token:v1';

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const ACTION_CONTEXT_KEYS = new Set([
  'operation',
  'plan',
  'action',
  'actionIndex',
  'ownershipNonce',
  'head',
  'profile',
  'artifactStage',
]);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'createVolume',
  'describeVolumes',
]);
const VOLUME_CAPABILITIES = new Set(['application-state', 'control-state']);
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/;

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeVolumeResourceConflictError extends Error {
  constructor() {
    super('AWS single-node volume resource conflicts with its exact contract.');
    this.name = 'AwsSingleNodeVolumeResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeVolumeResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node volume resource state is unknown.');
    this.name = 'AwsSingleNodeVolumeResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_RESOURCE_UNKNOWN';
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

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertSupportedKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertRequiredKeys(value, keys, path) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
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

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {unknown} error @param {string} name @returns {boolean} */
function errorNamed(error, name) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {Record<string, any>} */ (error).name === name
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {Readonly<Record<string, any>>} providerSpec @param {string} capabilityKind @returns {Readonly<Record<string, any>>} */
function volumeConfiguration(providerSpec, capabilityKind) {
  if (!VOLUME_CAPABILITIES.has(capabilityKind)) {
    throw new TypeError('AWS single-node volume capability is not supported.');
  }
  return capabilityKind === 'application-state'
    ? providerSpec.capabilities.applicationState
    : providerSpec.capabilities.controlState;
}

/**
 * Derive the provider-observable volume configuration digest. Attachment is a
 * later independently recoverable effect, so device and instance identity are
 * deliberately excluded from this physical-volume state.
 * @param {unknown} value - Provider specification.
 * @param {unknown} capabilityKind - Application or control state capability.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - Exact state digest.
 */
export function getAwsSingleNodeVolumeStateDigest(value, capabilityKind) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeVolumeState providerSpec',
  );
  if (typeof capabilityKind !== 'string') {
    throw new TypeError(
      'awsSingleNodeVolumeState capabilityKind must be a string.',
    );
  }
  const volume = volumeConfiguration(providerSpec, capabilityKind);
  return createAwsSingleNodeVolumeStateDigest({
    availabilityZoneId: providerSpec.placement.availabilityZoneId,
    kmsKeyArn: providerSpec.storage.ebsKmsKeyArn,
    volumeType: volume.volumeType,
    sizeGiB: volume.sizeGiB,
    iops: volume.iops,
    throughputMiBps: volume.throughputMiBps,
    multiAttach: volume.multiAttach,
    encrypted: volume.encrypted,
    onDestroy: volume.onDestroy,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function ownershipTags(authority) {
  return getAwsSingleNodeVolumeOwnershipTags({
    capabilityKind: authority.action.capability.kind,
    roleKind: authority.action.role.kind,
    providerScopeId: authority.plan.providerScope.providerScopeId,
    deploymentInstanceId: authority.plan.deploymentInstanceId,
    incarnationId: authority.plan.incarnationId,
    resourceKey: authority.action.resourceKey,
    createdByActionId:
      authority.priorBinding?.createdByActionId ?? authority.action.actionId,
    ownershipNonce: authority.ownershipNonce,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function requiredTags(authority) {
  return deepFreeze({
    ...ownershipTags(authority),
    'wharfie:state-digest': authority.stateDigest.value,
  });
}

/** @param {Readonly<Record<string, string>>} tags @returns {Readonly<Array<{Key: string, Value: string}>>} */
function sortedTags(tags) {
  return deepFreeze(
    Object.entries(tags)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([Key, Value]) => ({ Key, Value })),
  );
}

/**
 * Give each durable create intent its own replay-stable provider token. An
 * action ID can recur across identical reconcile plans, while the persisted
 * unpredictable ownership nonce is unique to the exact intended effect.
 * Lowercase hexadecimal is accepted by both EC2 and Cloud Control token
 * grammars and preserves all 256 digest bits in 64 ASCII characters.
 * @param {unknown} actionId - Exact deployment action identity.
 * @param {unknown} ownershipNonce - Exact durable effect nonce.
 * @returns {string} - Domain-separated lowercase SHA-256 token.
 */
export function getAwsSingleNodeVolumeCreateClientToken(
  actionId,
  ownershipNonce,
) {
  assertDomainSeparatedSha256Id(
    actionId,
    DEPLOYMENT_ACTION_ID_PREFIX,
    'awsSingleNodeVolume clientToken actionId',
  );
  const canonicalOwnershipNonce = validateOwnershipNonce(
    ownershipNonce,
    'awsSingleNodeVolume clientToken ownershipNonce',
  );
  const payload = JSON.stringify(
    sortCanonicalJsonValue({
      actionId,
      ownershipNonce: canonicalOwnershipNonce,
    }),
  );
  return Buffer.from(
    sha256Base64Url(
      `${AWS_SINGLE_NODE_VOLUME_CREATE_CLIENT_TOKEN_DOMAIN}\0${payload}`,
    ),
    'base64url',
  ).toString('hex');
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<import('@aws-sdk/client-ec2').CreateVolumeCommandInput>} */
function createVolumeRequest(authority) {
  const configuration = authority.volumeConfiguration;
  return deepFreeze({
    AvailabilityZoneId:
      authority.plan.providerSpec.placement.availabilityZoneId,
    ClientToken: getAwsSingleNodeVolumeCreateClientToken(
      authority.action.actionId,
      authority.ownershipNonce,
    ),
    Encrypted: configuration.encrypted,
    Iops: configuration.iops,
    KmsKeyId: authority.plan.providerSpec.storage.ebsKmsKeyArn,
    Size: configuration.sizeGiB,
    TagSpecifications: [
      {
        ResourceType: 'volume',
        Tags: sortedTags(requiredTags(authority)),
      },
    ],
    Throughput: configuration.throughputMiBps,
    VolumeType: configuration.volumeType,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Array<Readonly<{Name: string, Values: readonly string[]}>>>} */
function discoveryFilters(authority) {
  return getAwsSingleNodeVolumeDiscoveryFilters({
    capabilityKind: authority.action.capability.kind,
    roleKind: authority.action.role.kind,
    providerScopeId: authority.plan.providerScope.providerScopeId,
    deploymentInstanceId: authority.plan.deploymentInstanceId,
    incarnationId: authority.plan.incarnationId,
    resourceKey: authority.action.resourceKey,
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeVolume action context must be an object.',
    );
  }
  assertExactKeys(value, ACTION_CONTEXT_KEYS, 'awsSingleNodeVolume context');
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeVolume context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeVolume context.head',
  );
  const expectedOperationKind =
    plan.operation === 'destroy'
      ? 'destroy'
      : head.settledDeploymentRevisionId === null
        ? 'create'
        : head.settledDeploymentRevisionId ===
            plan.deploymentRevision.deploymentRevisionId
          ? 'reconcile'
          : 'update';
  if (
    value.operation !== plan.operation ||
    plan.providerScope.providerScopeId !== providerScope.providerScopeId ||
    canonicalProviderSpec.providerSpecId !== plan.providerSpec.providerSpecId ||
    head.deploymentInstanceId !== plan.deploymentInstanceId ||
    head.incarnationId !== plan.incarnationId ||
    head.providerScope.providerScopeId !== providerScope.providerScopeId ||
    head.activeOperation === null ||
    head.activeOperation.planId !== plan.planId ||
    head.activeOperation.status !== 'running' ||
    head.activeOperation.kind !== expectedOperationKind ||
    plan.basis.headGeneration >= head.generation ||
    plan.basis.settledDeploymentRevisionId !==
      head.settledDeploymentRevisionId ||
    head.targetDeploymentRevisionId !==
      (expectedOperationKind === 'destroy'
        ? null
        : plan.deploymentRevision.deploymentRevisionId) ||
    head.activeOperation.intents.length !== plan.actions.length ||
    head.activeOperation.intents.some(
      (
        /** @type {Readonly<Record<string, any>>} */ candidate,
        /** @type {number} */ index,
      ) => candidate.actionId !== plan.actions[index].actionId,
    )
  ) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.management !== 'managed' ||
    action.role.kind !== 'volume' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'retain' ||
    action.dependsOn.length !== 0 ||
    action.after?.providerType !== 'ebs-volume' ||
    !VOLUME_CAPABILITIES.has(action.capability.kind)
  ) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeVolume context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  const stateDigest = getAwsSingleNodeVolumeStateDigest(
    canonicalProviderSpec,
    action.capability.kind,
  );
  if (!sameJson(action.after.stateDigest, stateDigest)) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  const configuration = volumeConfiguration(
    canonicalProviderSpec,
    action.capability.kind,
  );
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (action.action === 'create') {
    if (
      plan.operation === 'destroy' ||
      action.before !== null ||
      action.after.providerResourceId !== null ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeVolumeResourceConflictError();
    }
  } else if (action.action === 'noop') {
    if (
      priorBinding === undefined ||
      action.before === null ||
      action.before.providerType !== 'ebs-volume' ||
      action.before.providerResourceId !== priorBinding.providerResourceId ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.before.stateDigest, stateDigest) ||
      priorBinding.management !== 'managed' ||
      priorBinding.providerType !== 'ebs-volume' ||
      priorBinding.deploymentInstanceId !== plan.deploymentInstanceId ||
      priorBinding.resourceKey !== action.resourceKey ||
      priorBinding.providerScopeId !== providerScope.providerScopeId ||
      priorBinding.incarnationId !== plan.incarnationId ||
      !sameJson(priorBinding.capability, action.capability) ||
      !sameJson(priorBinding.role, action.role) ||
      priorBinding.ownershipMode !== action.ownershipMode ||
      priorBinding.onDestroy !== action.onDestroy ||
      priorBinding.dependencyBindings.length !== 0 ||
      priorBinding.ownershipNonce !== ownershipNonce
    ) {
      throw new AwsSingleNodeVolumeResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  return deepFreeze({
    operation: plan.operation,
    plan,
    action,
    actionIndex: value.actionIndex,
    ownershipNonce,
    head,
    profile,
    providerSpec: canonicalProviderSpec,
    volumeConfiguration: configuration,
    stateDigest,
    priorBinding: priorBinding ?? null,
  });
}

/** @param {unknown} value @returns {string|null} */
function candidateVolumeId(value) {
  if (!isPlainObject(value)) return null;
  return typeof value.VolumeId === 'string' &&
    VOLUME_ID_PATTERN.test(value.VolumeId)
    ? value.VolumeId
    : null;
}

/**
 * Validate only the retained volume's intrinsic identity, ownership, and
 * lifecycle. Attachment evidence belongs to the separate attachment resource;
 * coupling it here would make the earlier volume action depend on a downstream
 * graph effect.
 * @param {Readonly<Record<string, any>>} volume - Exact DescribeVolumes item.
 * @param {Readonly<Record<string, any>>} authority - Canonical action authority.
 * @returns {void}
 */
function validateVolumeEvidence(volume, authority) {
  const actualState = decodeAwsSingleNodeVolumeActualState(
    volume,
    authority.plan.providerScope.region,
  );
  if (!sameJson(actualState.observedDigest, authority.stateDigest)) {
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  try {
    decodeAwsSingleNodeVolumeEvidence(volume, {
      allowTagPropagation: authority.action.action === 'create',
      expectedOwnershipTags: ownershipTags(authority),
      expectedStateDigestValue: authority.stateDigest.value,
      region: authority.plan.providerScope.region,
    });
  } catch (error) {
    if (error instanceof AwsSingleNodeVolumeLifecycleUnknownError) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
    throw error;
  }
}

/**
 * Bind exact retained gp3 volume effects to one credential scope. The factory
 * never owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeVolumeResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsSingleNodeVolume options must be an object.');
  }
  assertSupportedKeys(options, FACTORY_KEYS, 'awsSingleNodeVolume options');
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeVolume options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsSingleNodeVolume client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(`awsSingleNodeVolume client.${method} is required.`);
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeVolume providerScope',
  );
  const maxAttempts =
    options.maxAttempts ?? AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeVolume maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError('awsSingleNodeVolume waitForRetry must be a function.');
  }
  /** Successful create responses are only ephemeral candidate locators. */
  const candidateIds = new Map();

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeVolumeResourceUnknownError();
    }
  }

  /** @param {string} volumeId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(volumeId) {
    let response;
    try {
      response = await client.describeVolumes(
        deepFreeze({ VolumeIds: [volumeId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVolume.NotFound')) return null;
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    return decodeAwsSingleNodeExactVolumeResponse(response, volumeId);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function discoverOnce(authority) {
    const filters = discoveryFilters(authority);
    const volumes = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.describeVolumes(
          deepFreeze({
            Filters: filters,
            MaxResults: AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new AwsSingleNodeVolumeEvidenceUnknownError();
      }
      const observed = decodeAwsSingleNodeVolumeDiscoveryPage(response);
      for (const volume of observed.volumes) {
        if (volumes.has(volume.VolumeId)) {
          throw new AwsSingleNodeVolumeEvidenceConflictError();
        }
        volumes.set(volume.VolumeId, volume);
      }
      if (observed.nextToken === null) break;
      if (
        page === AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new AwsSingleNodeVolumeEvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    if (volumes.size === 0) return null;
    if (volumes.size !== 1) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
    return [...volumes.values()][0];
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let response;
    try {
      response = await client.createVolume(createVolumeRequest(authority));
    } catch (error) {
      if (errorNamed(error, 'IdempotentParameterMismatch')) {
        throw new AwsSingleNodeVolumeResourceConflictError();
      }
      throw new AwsSingleNodeVolumeResourceUnknownError();
    }
    const volumeId = candidateVolumeId(response);
    if (volumeId === null) {
      throw new AwsSingleNodeVolumeResourceUnknownError();
    }
    const priorCandidateId = candidateIds.get(authority.action.actionId);
    if (priorCandidateId !== undefined && priorCandidateId !== volumeId) {
      throw new AwsSingleNodeVolumeResourceConflictError();
    }
    candidateIds.set(authority.action.actionId, volumeId);
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    const exactVolumeId =
      authority.priorBinding?.providerResourceId ??
      candidateIds.get(authority.action.actionId) ??
      null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const volume =
          exactVolumeId === null
            ? await discoverOnce(authority)
            : await describeExactOnce(exactVolumeId);
        if (volume !== null) {
          validateVolumeEvidence(volume, authority);
          const binding =
            authority.priorBinding ??
            createDeploymentResourceBinding({
              schemaVersion: 2,
              kind: 'deploymentResourceBinding',
              deploymentInstanceId: authority.plan.deploymentInstanceId,
              incarnationId: authority.plan.incarnationId,
              resourceKey: authority.action.resourceKey,
              capability: authority.action.capability,
              role: authority.action.role,
              management: 'managed',
              ownershipMode: authority.action.ownershipMode,
              onDestroy: authority.action.onDestroy,
              dependencyBindings: [],
              providerType: 'ebs-volume',
              providerResourceId: volume.VolumeId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          candidateIds.delete(authority.action.actionId);
          return deepFreeze({ status: 'converged', binding });
        }
      } catch (error) {
        if (error instanceof AwsSingleNodeVolumeEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof AwsSingleNodeVolumeEvidenceUnknownError) &&
          !(error instanceof AwsSingleNodeVolumeEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof AwsSingleNodeVolumeEvidenceUnknownError) {
            throw new AwsSingleNodeVolumeResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
        await wait(attempt);
        continue;
      }
      if (attempt < maxAttempts) {
        await wait(attempt);
      }
    }
    return authority.action.action === 'noop'
      ? Object.freeze({ status: 'blocked' })
      : Object.freeze({ status: 'not-converged' });
  }

  return Object.freeze({ executeAction, verifySettlement });
}

export default {
  AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VOLUME_CREATE_CLIENT_TOKEN_DOMAIN,
  AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN,
  AwsSingleNodeVolumeResourceConflictError,
  AwsSingleNodeVolumeResourceUnknownError,
  createAwsSingleNodeVolumeResource,
  getAwsSingleNodeVolumeCreateClientToken,
  getAwsSingleNodeVolumeStateDigest,
};
