/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal recovery contracts are clearer than parser-specific expansions. */

import {
  AwsTaggedEc2EvidenceConflictError as AwsTaggedEc2RecoveryConflictError,
  AwsTaggedEc2EvidenceTransientError as AwsTaggedEc2RecoveryTransientError,
  AwsTaggedEc2EvidenceUnknownError as AwsTaggedEc2RecoveryUnknownError,
  createAwsTaggedEc2EvidenceKernel,
} from './deployment-aws-tagged-ec2-evidence.js';

export {
  AwsTaggedEc2EvidenceConflictError as AwsTaggedEc2RecoveryConflictError,
  AwsTaggedEc2EvidenceTransientError as AwsTaggedEc2RecoveryTransientError,
  AwsTaggedEc2EvidenceUnknownError as AwsTaggedEc2RecoveryUnknownError,
} from './deployment-aws-tagged-ec2-evidence.js';

const IDENTITY_EVIDENCE_KEYS = new Set(['useDiscoveredId']);

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

/** @param {unknown} value @param {string} path @returns {string} */
function requiredString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

/**
 * Create the common recovery mechanics for one directly owned, atomically
 * tagged EC2 resource. AWS response envelopes, typed NotFound handling, and
 * resource-specific evidence remain in the supplied adapters and caller.
 * @param {unknown} options - Exact tagged-resource mechanics and read adapters.
 * @returns {Readonly<Record<string, any>>} - Internal recovery operations.
 */
export function createAwsTaggedEc2RecoveryKernel(options) {
  const evidence = createAwsTaggedEc2EvidenceKernel(options);
  const idPattern = /** @type {Readonly<Record<string, any>>} */ (options)
    .idPattern;

  /** Successful create responses are only ephemeral candidate locators. */
  const candidateIds = new Map();
  /** A crossed non-idempotent create boundary cannot be replayed in-process. */
  const attemptedEffects = new Set();

  /** @param {Readonly<Record<string, any>>} authority @returns {string} */
  function effectKey(authority) {
    const actionId = requiredString(
      authority?.action?.actionId,
      'awsTaggedEc2Recovery authority.action.actionId',
    );
    const ownershipNonce = requiredString(
      authority?.ownershipNonce,
      'awsTaggedEc2Recovery authority.ownershipNonce',
    );
    return `${actionId}\0${ownershipNonce}`;
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
  function locator(authority) {
    return {
      capabilityKind: authority?.action?.capability?.kind,
      roleKind: authority?.action?.role?.kind,
      providerScopeId: authority?.plan?.providerScope?.providerScopeId,
      deploymentInstanceId: authority?.plan?.deploymentInstanceId,
      incarnationId: authority?.plan?.incarnationId,
      resourceKey: authority?.action?.resourceKey,
    };
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
  function requiredTags(authority) {
    return evidence.ownershipTags({
      ...locator(authority),
      createdByActionId:
        authority?.priorBinding?.createdByActionId ??
        authority?.action?.actionId,
      ownershipNonce: authority?.ownershipNonce,
      stateDigestValue: authority?.stateDigest?.value,
    });
  }

  /** @param {Readonly<Record<string, any>>} authority @param {unknown} value @returns {Promise<Readonly<{discovered: Readonly<Record<string, any>>|null, exact: Readonly<Record<string, any>>|null, exactId: string|null}>>} */
  async function readIdentityEvidence(authority, value) {
    if (!isPlainObject(value)) {
      throw new TypeError(
        'awsTaggedEc2Recovery identity evidence options must be an object.',
      );
    }
    assertExactKeys(
      value,
      IDENTITY_EVIDENCE_KEYS,
      'awsTaggedEc2Recovery identity evidence options',
    );
    if (typeof value.useDiscoveredId !== 'boolean') {
      throw new TypeError(
        'awsTaggedEc2Recovery useDiscoveredId must be a boolean.',
      );
    }
    const key = effectKey(authority);
    requiredTags(authority);
    const discoveredRecords = await evidence.discoverMany(locator(authority));
    if (discoveredRecords.length > 1) {
      throw new AwsTaggedEc2RecoveryConflictError();
    }
    const discovered = discoveredRecords[0] ?? null;
    let exactId =
      authority?.priorBinding?.providerResourceId ??
      candidateIds.get(key) ??
      null;
    if (exactId !== null) {
      if (typeof exactId !== 'string' || !idPattern.test(exactId)) {
        throw new AwsTaggedEc2RecoveryConflictError();
      }
    } else if (value.useDiscoveredId && discovered !== null) {
      exactId = evidence.resourceId(discovered);
    }
    if (
      discovered !== null &&
      exactId !== null &&
      evidence.resourceId(discovered) !== exactId
    ) {
      throw new AwsTaggedEc2RecoveryConflictError();
    }
    const exact =
      exactId === null ? null : await evidence.readExactSafely(exactId);
    return Object.freeze({ discovered, exact, exactId });
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {boolean} */
  function claimCreateAttempt(authority) {
    const key = effectKey(authority);
    if (attemptedEffects.has(key)) return false;
    attemptedEffects.add(key);
    return true;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {string} id @returns {void} */
  function rememberCandidate(authority, id) {
    const key = effectKey(authority);
    if (!attemptedEffects.has(key)) {
      throw new TypeError(
        'awsTaggedEc2Recovery create attempt must be claimed before remembering its candidate.',
      );
    }
    if (typeof id !== 'string' || !idPattern.test(id)) {
      throw new AwsTaggedEc2RecoveryUnknownError();
    }
    const priorId = candidateIds.get(key);
    if (priorId !== undefined && priorId !== id) {
      throw new AwsTaggedEc2RecoveryConflictError();
    }
    candidateIds.set(key, id);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {void} */
  function clearCandidate(authority) {
    candidateIds.delete(effectKey(authority));
  }

  return Object.freeze({
    claimCreateAttempt,
    clearCandidate,
    readIdentityEvidence,
    rememberCandidate,
    requiredTags,
    sortedTags: evidence.sortedTags,
    validateTags: evidence.validateTags,
  });
}

export default {
  AwsTaggedEc2RecoveryConflictError,
  AwsTaggedEc2RecoveryTransientError,
  AwsTaggedEc2RecoveryUnknownError,
  createAwsTaggedEc2RecoveryKernel,
};
