/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable IAM evidence contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamAttachedPolicies,
  decodeAwsIamJsonDocument,
  decodeAwsIamPolicyNames,
} from './deployment-aws-iam-evidence.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_POLICY_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
  createAwsSingleNodeRuntimePolicy,
} from './deployment-aws-runtime-identity-contract.js';

const RESPONSE_KEYS = new Set(['RoleName', 'PolicyName', 'PolicyDocument']);
const RESPONSE_OPTIONS_KEYS = new Set(['roleName', 'policyAuthority']);
const OBSERVED_STATE_KEYS = new Set(['policyDocument']);

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

/**
 * Hash one readable inline-policy document as provider-observed state.
 * The fixed template digest remains code lineage while the canonical policy
 * document records drift independently from ownership.
 * @param {unknown} value - Exact observed policy state.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function createAwsSingleNodeRuntimeRolePolicyObservedStateDigest(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicy observed state must be an object.',
    );
  }
  assertExactKeys(
    value,
    OBSERVED_STATE_KEYS,
    'awsSingleNodeRuntimeRolePolicy observed state',
  );
  if (!isPlainObject(value.policyDocument)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicy observed state.policyDocument must be an object.',
    );
  }
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeRuntimePolicyState',
    policyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    policyTemplateDigest: AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
    policyDocument: value.policyDocument,
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_RUNTIME_POLICY_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Decode one exact GetRolePolicy response. A readable policy mismatch is drift,
 * not an ownership conflict; the caller chooses whether its current mode may
 * surface that digest.
 * @param {unknown} value - One GetRolePolicy response.
 * @param {unknown} options - Exact deterministic role and policy authority.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeRuntimeRolePolicyResponse(value, options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicy response options must be an object.',
    );
  }
  assertExactKeys(
    options,
    RESPONSE_OPTIONS_KEYS,
    'awsSingleNodeRuntimeRolePolicy response options',
  );
  if (typeof options.roleName !== 'string' || options.roleName.length === 0) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicy response options.roleName must be a non-empty string.',
    );
  }
  if (!isPlainObject(value)) throw new AwsIamEvidenceUnknownError();
  for (const key of RESPONSE_KEYS) {
    if (!Object.hasOwn(value, key) || typeof value[key] !== 'string') {
      throw new AwsIamEvidenceUnknownError();
    }
  }
  if (
    value.RoleName !== options.roleName ||
    value.PolicyName !== AWS_SINGLE_NODE_RUNTIME_POLICY_NAME
  ) {
    throw new AwsIamEvidenceConflictError();
  }
  const policyDocument = decodeAwsIamJsonDocument(
    value.PolicyDocument,
    'awsSingleNodeRuntimeRolePolicy provider response.PolicyDocument',
  );
  const desiredPolicyDocument = createAwsSingleNodeRuntimePolicy(
    options.policyAuthority,
  );
  return deepFreeze({
    roleName: value.RoleName,
    policyName: value.PolicyName,
    policyDocument,
    desired: sameJson(policyDocument, desiredPolicyDocument),
    observedDigest: createAwsSingleNodeRuntimeRolePolicyObservedStateDigest({
      policyDocument,
    }),
  });
}

/**
 * Decode one inline-policy page and reject a foreign natural slot before any
 * later pagination request can obscure that contradiction.
 * @param {unknown} value - One decoded PolicyNames page.
 * @returns {Readonly<string[]>}
 */
export function decodeAwsSingleNodeRuntimeRolePolicyNamesPage(value) {
  const names = decodeAwsIamPolicyNames(value);
  if (
    names.length > 1 ||
    (names.length === 1 && names[0] !== AWS_SINGLE_NODE_RUNTIME_POLICY_NAME)
  ) {
    throw new AwsIamEvidenceConflictError();
  }
  return names;
}

/**
 * Decode one attached-policy page. The runtime role permits no managed policy,
 * so a non-empty earlier page is immediately contradictory.
 * @param {unknown} value - One decoded AttachedPolicies page.
 * @returns {Readonly<Array<Readonly<Record<string, string>>>>}
 */
export function decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage(value) {
  const attached = decodeAwsIamAttachedPolicies(value);
  if (attached.length !== 0) throw new AwsIamEvidenceConflictError();
  return attached;
}

/**
 * Decode the complete inline/attached policy inventory for the exact role.
 * Any policy outside Wharfie's one named natural slot contradicts the role
 * contract.
 * @param {unknown} inlinePolicyNames - Complete ListRolePolicies items.
 * @param {unknown} attachedPolicies - Complete ListAttachedRolePolicies items.
 * @returns {Readonly<{listed: 'present'|'absent'}>}
 */
export function decodeAwsSingleNodeRuntimeRolePolicyInventory(
  inlinePolicyNames,
  attachedPolicies,
) {
  const names =
    decodeAwsSingleNodeRuntimeRolePolicyNamesPage(inlinePolicyNames);
  decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage(attachedPolicies);
  return deepFreeze({
    listed: names.length === 1 ? 'present' : 'absent',
  });
}

/**
 * Corroborate the named inline-policy slot through both IAM projections.
 * Propagation disagreement is retryable rather than absence.
 * @param {Readonly<{listed: 'present'|'absent'}>} inventory - Complete policy-name inventory.
 * @param {Readonly<Record<string, any>>|null} policy - Exact policy read or typed absence.
 * @returns {Readonly<Record<string, any>>}
 */
export function corroborateAwsSingleNodeRuntimeRolePolicyEvidence(
  inventory,
  policy,
) {
  if (
    !isPlainObject(inventory) ||
    (inventory.listed !== 'present' && inventory.listed !== 'absent')
  ) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicy inventory must be exact.',
    );
  }
  const policyPresence = policy === null ? 'absent' : 'present';
  if (inventory.listed !== policyPresence) {
    throw new AwsIamEvidenceTransientError();
  }
  if (policy === null) {
    return deepFreeze({
      presence: 'absent',
      observedDigest: null,
      desired: false,
    });
  }
  if (
    !isPlainObject(policy) ||
    !isPlainObject(policy.observedDigest) ||
    typeof policy.desired !== 'boolean'
  ) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicy policy evidence must be exact.',
    );
  }
  return deepFreeze({
    presence: 'present',
    observedDigest: policy.observedDigest,
    desired: policy.desired,
  });
}

export default {
  corroborateAwsSingleNodeRuntimeRolePolicyEvidence,
  createAwsSingleNodeRuntimeRolePolicyObservedStateDigest,
  decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage,
  decodeAwsSingleNodeRuntimeRolePolicyInventory,
  decodeAwsSingleNodeRuntimeRolePolicyNamesPage,
  decodeAwsSingleNodeRuntimeRolePolicyResponse,
};
