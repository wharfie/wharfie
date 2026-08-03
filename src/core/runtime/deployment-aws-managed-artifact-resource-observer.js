/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS,
  AwsSingleNodeManagedArtifactEvidenceConflictError,
  AwsSingleNodeManagedArtifactEvidenceTransientError,
  AwsSingleNodeManagedArtifactEvidenceUnknownError,
  createAwsSingleNodeManagedArtifactHistoryEvidence,
  decodeAwsSingleNodeManagedArtifactHead,
  decodeAwsSingleNodeManagedArtifactHistoryPage,
  getAwsSingleNodeManagedArtifactStateDigest,
  isAwsSingleNodeManagedArtifactCurrentMissingError,
  isAwsSingleNodeManagedArtifactErrorNamed,
} from './deployment-aws-managed-artifact-evidence.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from './deployment-aws-runtime-identity-contract.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['headObject', 'listObjectVersions']);
const AUTHORITY_KEYS = new Set([
  'operation',
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
  'head',
  'plan',
  'settledPlan',
  'target',
  'binding',
  'currentAction',
]);
const RESOURCE_KEY = 'artifact';
const PROVIDER_TYPE = 's3-object';
const AUTHORITY_ERROR =
  'AWS single-node managed-artifact observation authority does not match the exact managed object contract.';

/** Exact durable authority cannot select this managed artifact read mode. */
export class AwsSingleNodeManagedArtifactResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeManagedArtifactResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_MANAGED_ARTIFACT_RESOURCE_OBSERVER_AUTHORITY';
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
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function revalidateAuthority(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifactResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    value,
    AUTHORITY_KEYS,
    'awsSingleNodeManagedArtifactResourceObserver context',
  );
  const authority = createAwsSingleNodeResourceObservationAuthority({
    operation: value.operation,
    deploymentRevision: value.deploymentRevision,
    profile: value.profile,
    providerScope: value.providerScope,
    providerSpec: value.providerSpec,
    deploymentInstanceId: value.deploymentInstanceId,
    incarnationId: value.incarnationId,
    head: value.head,
    plan: value.plan,
    settledPlan: value.settledPlan,
    target: value.target,
  });
  if (
    !sameJson(value.binding, authority.binding) ||
    !sameJson(value.currentAction, authority.currentAction)
  ) {
    throw new AwsSingleNodeManagedArtifactResourceObserverAuthorityError();
  }
  return authority;
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function assertManagedArtifactAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'artifact-storage' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'object' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'purge' ||
    target.dependsOn.length !== 0 ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeManagedArtifactResourceObserverAuthorityError();
  }
  const location = getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope: authority.providerScope,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  });
  const desiredDigest = getAwsSingleNodeManagedArtifactStateDigest({
    deploymentRevision: authority.deploymentRevision,
    profile: authority.profile,
    providerScope: authority.providerScope,
    providerSpec: authority.providerSpec,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  });
  if (
    target.target.providerResourceId !== location.arn ||
    !sameJson(target.target.stateDigest, desiredDigest)
  ) {
    throw new AwsSingleNodeManagedArtifactResourceObserverAuthorityError();
  }

  const binding = authority.binding;
  const currentAction = authority.currentAction;
  if (
    (binding !== null && currentAction?.action.action === 'create') ||
    (binding === null &&
      currentAction !== null &&
      currentAction.action.action !== 'create')
  ) {
    throw new AwsSingleNodeManagedArtifactResourceObserverAuthorityError();
  }
  if (
    binding !== null &&
    (binding.resourceKey !== RESOURCE_KEY ||
      !sameJson(binding.capability, target.capability) ||
      !sameJson(binding.role, target.role) ||
      binding.management !== 'managed' ||
      binding.ownershipMode !== 'direct' ||
      binding.onDestroy !== 'purge' ||
      binding.dependencyBindings.length !== 0 ||
      binding.providerType !== PROVIDER_TYPE ||
      binding.providerResourceId !== location.arn ||
      binding.providerScopeId !== authority.providerScope.providerScopeId ||
      binding.deploymentInstanceId !== authority.deploymentInstanceId ||
      binding.incarnationId !== authority.incarnationId)
  ) {
    throw new AwsSingleNodeManagedArtifactResourceObserverAuthorityError();
  }

  const isCurrentCreate =
    binding === null && currentAction?.action.action === 'create';
  const isCurrentDelete =
    binding !== null && currentAction?.action.action === 'delete';
  const ownershipAuthority =
    binding !== null || isCurrentCreate
      ? deepFreeze({
          providerScope: authority.providerScope,
          artifactStorage: authority.providerSpec.capabilities.artifactStorage,
          deploymentInstanceId: authority.deploymentInstanceId,
          incarnationId: authority.incarnationId,
          createdByActionId:
            binding?.createdByActionId ?? currentAction.action.actionId,
          ownershipNonce:
            binding?.ownershipNonce ?? currentAction.ownershipNonce,
          appId: authority.deploymentRevision.appId,
        })
      : null;
  return deepFreeze({
    binding,
    currentAction,
    desiredDigest,
    isCurrentCreate,
    isCurrentDelete,
    location,
    ownershipAuthority,
  });
}

/** @returns {Readonly<Record<string, any>>} */
function absentObservation() {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'absent',
    ownership: 'missing',
    providerIdentity: null,
    observedDigest: null,
    health: 'absent',
    execution: 'none',
  });
}

/** @returns {Readonly<Record<string, any>>} */
function unknownObservation() {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution: 'none',
  });
}

/** @param {string} providerResourceId @param {Readonly<Record<string, any>>} observedDigest @returns {Readonly<Record<string, any>>} */
function verifiedObservation(providerResourceId, observedDigest) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'present',
    ownership: 'verified',
    providerIdentity: { providerType: PROVIDER_TYPE, providerResourceId },
    observedDigest,
    health: 'not-applicable',
    execution: 'none',
  });
}

/** @param {string} providerResourceId @returns {Readonly<Record<string, any>>} */
function conflictObservation(providerResourceId) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'present',
    ownership: 'conflict',
    providerIdentity: { providerType: PROVIDER_TYPE, providerResourceId },
    observedDigest: null,
    health: 'not-applicable',
    execution: 'none',
  });
}

/**
 * Bind a read-only observer to one exact versioned S3 artifact namespace.
 * The caller owns the two-method S3 read port.
 * @param {unknown} options - Exact reads, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeManagedArtifactResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifactResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeManagedArtifactResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeManagedArtifactResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifactResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeManagedArtifactResourceObserver client',
  );
  for (const method of CLIENT_KEYS) {
    if (typeof options.client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeManagedArtifactResourceObserver client.${method} is required.`,
      );
    }
  }
  const client = Object.freeze({
    headObject: options.client.headObject,
    listObjectVersions: options.client.listObjectVersions,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeManagedArtifactResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeManagedArtifactResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeManagedArtifactResourceObserver waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<boolean>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
      return true;
    } catch {
      return false;
    }
  }

  /** @param {Readonly<Record<string, any>>} dependencies @param {string|undefined} versionId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readHead(dependencies, versionId) {
    if (dependencies.ownershipAuthority === null && versionId !== undefined) {
      throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
    }
    let response;
    try {
      response = await client.headObject(
        deepFreeze({
          Bucket: dependencies.location.bucketName,
          Key: dependencies.location.key,
          ...(versionId === undefined ? {} : { VersionId: versionId }),
          ChecksumMode: 'ENABLED',
          ExpectedBucketOwner: providerScope.accountId,
        }),
      );
    } catch (error) {
      if (
        versionId === undefined &&
        isAwsSingleNodeManagedArtifactCurrentMissingError(error)
      ) {
        return null;
      }
      if (
        versionId !== undefined &&
        (isAwsSingleNodeManagedArtifactErrorNamed(error, 'NoSuchVersion') ||
          isAwsSingleNodeManagedArtifactCurrentMissingError(error))
      ) {
        throw new AwsSingleNodeManagedArtifactEvidenceTransientError();
      }
      throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
    }
    if (dependencies.ownershipAuthority === null) {
      throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
    }
    return decodeAwsSingleNodeManagedArtifactHead(
      response,
      dependencies.ownershipAuthority,
      versionId,
    );
  }

  /** @param {Readonly<Record<string, any>>} dependencies @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function observeAttempt(dependencies) {
    let unboundVersionCount = 0;
    let unboundMarkerCount = 0;
    const evidence = createAwsSingleNodeManagedArtifactHistoryEvidence({
      readHistoryPage: async (
        /** @type {Readonly<Record<string, any>>} */ request,
      ) => {
        let response;
        try {
          response = await client.listObjectVersions(request);
        } catch {
          throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
        }
        if (dependencies.binding === null) {
          const page = decodeAwsSingleNodeManagedArtifactHistoryPage(
            response,
            dependencies.location,
          );
          unboundVersionCount += page.versions.length;
          unboundMarkerCount += page.markers.length;
          if (
            (!dependencies.isCurrentCreate &&
              unboundVersionCount + unboundMarkerCount !== 0) ||
            (dependencies.isCurrentCreate &&
              (unboundVersionCount > 1 || unboundMarkerCount !== 0))
          ) {
            throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
          }
        }
        return response;
      },
      readHead: (/** @type {string|undefined} */ versionId) =>
        readHead(dependencies, versionId),
    });
    const history = await evidence.readHistory({
      location: dependencies.location,
      accountId: providerScope.accountId,
    });
    if (history.current === null) {
      if (
        dependencies.binding === null &&
        (history.versions.length !== 0 || history.markers.length !== 0)
      ) {
        throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
      }
      return null;
    }
    if (
      dependencies.isCurrentCreate &&
      (history.versions.length !== 1 ||
        history.markers.length !== 0 ||
        !sameJson(history.current.stateDigest, dependencies.desiredDigest))
    ) {
      throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
    }
    return history.current;
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeManagedArtifactResourceObserverAuthorityError();
    }
    const dependencies = assertManagedArtifactAuthority(authority);
    let allAttemptsCleanAbsent = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const current = await observeAttempt(dependencies);
        if (current !== null) {
          return verifiedObservation(
            dependencies.location.arn,
            current.stateDigest,
          );
        }
        if (attempt === maxAttempts) {
          return !dependencies.isCurrentCreate && allAttemptsCleanAbsent
            ? absentObservation()
            : unknownObservation();
        }
      } catch (error) {
        allAttemptsCleanAbsent = false;
        if (
          error instanceof AwsSingleNodeManagedArtifactEvidenceConflictError
        ) {
          return conflictObservation(dependencies.location.arn);
        }
        if (
          !(
            error instanceof AwsSingleNodeManagedArtifactEvidenceUnknownError
          ) &&
          !(error instanceof AwsSingleNodeManagedArtifactEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) return unknownObservation();
      }
      if (!(await wait(attempt))) return unknownObservation();
    }
    return unknownObservation();
  }

  return Object.freeze({ observe });
}

export default {
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS,
  AwsSingleNodeManagedArtifactResourceObserverAuthorityError,
  createAwsSingleNodeManagedArtifactResourceObserver,
};
