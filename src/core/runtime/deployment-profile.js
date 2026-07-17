/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { validateBuildTarget } from './build-target.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const DEPLOYMENT_PROFILE_SCHEMA_VERSION = 1;
export const DEPLOYMENT_PROFILE_KIND = 'deploymentProfile';
export const DEPLOYMENT_PROFILE_ID_DOMAIN = 'wharfie:deployment-profile:v1';
export const DEPLOYMENT_PROFILE_ID_PREFIX = 'wpr1';
/** @type {readonly ('db'|'queue'|'objectStorage')[]} */
export const DEPLOYMENT_PROFILE_BINDING_KINDS = Object.freeze([
  'db',
  'queue',
  'objectStorage',
]);

const INPUT_KEYS = new Set(['profile', 'appId', 'target', 'bindings']);
const DOCUMENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'profileRevisionId',
  ...INPUT_KEYS,
]);
const PROFILE_KEYS = new Set(['id']);
const BINDINGS_KEYS = new Set(DEPLOYMENT_PROFILE_BINDING_KINDS);
const EXTERNAL_BINDING_KEYS = new Set(['kind', 'ref']);

/**
 * @typedef ExternalResourceBinding
 * @property {'external'} kind - Existing resource ownership marker.
 * @property {string} ref - Canonical logical reference resolved outside this profile.
 */

/**
 * @typedef DeploymentProfileBindings
 * @property {ExternalResourceBinding} [db] - External database binding.
 * @property {ExternalResourceBinding} [queue] - External queue binding.
 * @property {ExternalResourceBinding} [objectStorage] - External object-storage binding.
 */

/**
 * @typedef DeploymentProfileInput
 * @property {{ id: string }} profile - Human-addressable profile identity.
 * @property {string} appId - Application allowed to use this profile.
 * @property {import('./build-target.js').BuildTarget} target - Exact artifact target.
 * @property {DeploymentProfileBindings} [bindings] - Current external-only resource bindings.
 */

/**
 * @typedef DeploymentProfilePayload
 * @property {1} schemaVersion - Profile schema version.
 * @property {'deploymentProfile'} kind - Document kind.
 * @property {{ id: string }} profile - Human-addressable profile identity.
 * @property {string} appId - Application allowed to use this profile.
 * @property {import('./build-target.js').BuildTarget} target - Exact artifact target.
 * @property {DeploymentProfileBindings} [bindings] - Current external-only resource bindings.
 */

/**
 * @typedef {DeploymentProfilePayload & { profileRevisionId: string }} DeploymentProfile
 */

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowedKeys - Exact supported keys.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertExactKeys(value, allowedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
}

/**
 * Deeply freeze an independently cloned JSON value.
 * @param {any} value - Canonical JSON value.
 * @returns {any} - The same deeply frozen value.
 */
function freezeJsonSnapshot(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJsonSnapshot(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value - Candidate external binding.
 * @param {string} valuePath - Human-readable value path.
 * @returns {ExternalResourceBinding} - Validated independent binding.
 */
function validateExternalBinding(value, valuePath) {
  const binding = cloneJsonObject(value, valuePath);
  assertExactKeys(binding, EXTERNAL_BINDING_KEYS, valuePath);
  if (binding.kind !== 'external') {
    throw new TypeError(`${valuePath}.kind must be 'external'.`);
  }
  assertLogicalId(binding.ref, `${valuePath}.ref`);
  return { kind: 'external', ref: binding.ref };
}

/**
 * @param {unknown} value - Candidate bindings object.
 * @param {string} valuePath - Human-readable value path.
 * @returns {DeploymentProfileBindings} - Validated independent bindings.
 */
function validateBindings(value, valuePath) {
  const bindings = cloneJsonObject(value, valuePath);
  assertExactKeys(bindings, BINDINGS_KEYS, valuePath);
  if (Object.keys(bindings).length === 0) {
    throw new TypeError(`${valuePath} must not be empty when provided.`);
  }

  /** @type {DeploymentProfileBindings} */
  const normalized = {};
  for (const bindingKind of DEPLOYMENT_PROFILE_BINDING_KINDS) {
    if (!Object.prototype.hasOwnProperty.call(bindings, bindingKind)) continue;
    normalized[bindingKind] = validateExternalBinding(
      bindings[bindingKind],
      `${valuePath}.${bindingKind}`,
    );
  }
  return normalized;
}

/**
 * Validate the revision-free profile fields and construct its identity payload.
 * @param {unknown} value - Candidate profile input.
 * @param {string} valuePath - Human-readable value path.
 * @returns {DeploymentProfilePayload} - Validated independent identity payload.
 */
function createDeploymentProfilePayload(value, valuePath) {
  const input = cloneJsonObject(value, valuePath);
  assertExactKeys(input, INPUT_KEYS, valuePath);

  const profile = cloneJsonObject(input.profile, `${valuePath}.profile`);
  assertExactKeys(profile, PROFILE_KEYS, `${valuePath}.profile`);
  assertLogicalId(profile.id, `${valuePath}.profile.id`);
  assertLogicalId(input.appId, `${valuePath}.appId`);

  /** @type {DeploymentProfilePayload} */
  const payload = {
    schemaVersion: DEPLOYMENT_PROFILE_SCHEMA_VERSION,
    kind: DEPLOYMENT_PROFILE_KIND,
    profile: { id: profile.id },
    appId: input.appId,
    target: validateBuildTarget(input.target, `${valuePath}.target`),
  };

  if (Object.prototype.hasOwnProperty.call(input, 'bindings')) {
    payload.bindings = validateBindings(
      input.bindings,
      `${valuePath}.bindings`,
    );
  }
  return payload;
}

/**
 * Produce the canonical, deeply frozen identity payload for a deployment
 * profile. It deliberately contains no application revision, artifact,
 * provider topology, credentials, environment, or managed-resource fields.
 * @param {unknown} value - Candidate revision-free profile input.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentProfilePayload>} - Canonical immutable snapshot.
 */
export function canonicalizeDeploymentProfilePayload(
  value,
  valuePath = 'deploymentProfile',
) {
  return /** @type {Readonly<DeploymentProfilePayload>} */ (
    freezeJsonSnapshot(
      sortCanonicalJsonValue(createDeploymentProfilePayload(value, valuePath)),
    )
  );
}

/**
 * Compute the immutable identity of one canonical deployment-profile payload.
 * @param {unknown} value - Candidate revision-free profile input.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - `wpr1_<base64url sha256>` identity.
 */
export function getDeploymentProfileRevisionId(
  value,
  valuePath = 'deploymentProfile',
) {
  const payload = canonicalizeDeploymentProfilePayload(value, valuePath);
  return createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_PROFILE_ID_DOMAIN,
    prefix: DEPLOYMENT_PROFILE_ID_PREFIX,
    value: payload,
    valuePath,
  });
}

/**
 * Create one canonical immutable DeploymentProfileV1 snapshot.
 * @param {unknown} value - Candidate revision-free profile input.
 * @returns {Readonly<DeploymentProfile>} - Canonical immutable profile.
 */
export function createDeploymentProfile(value) {
  const payload = canonicalizeDeploymentProfilePayload(value);
  const profileRevisionId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_PROFILE_ID_DOMAIN,
    prefix: DEPLOYMENT_PROFILE_ID_PREFIX,
    value: payload,
    valuePath: 'deploymentProfile',
  });
  return /** @type {Readonly<DeploymentProfile>} */ (
    freezeJsonSnapshot(
      sortCanonicalJsonValue({ ...payload, profileRevisionId }),
    )
  );
}

/**
 * Validate a serialized DeploymentProfileV1, recompute its identity, and
 * return a canonical immutable snapshot independent from the caller.
 * @param {unknown} value - Candidate serialized profile.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentProfile>} - Canonical immutable profile.
 */
export function validateDeploymentProfile(
  value,
  valuePath = 'deploymentProfile',
) {
  const document = cloneJsonObject(value, valuePath);
  assertExactKeys(document, DOCUMENT_KEYS, valuePath);
  if (document.schemaVersion !== DEPLOYMENT_PROFILE_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${DEPLOYMENT_PROFILE_SCHEMA_VERSION}.`,
    );
  }
  if (document.kind !== DEPLOYMENT_PROFILE_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${DEPLOYMENT_PROFILE_KIND}'.`,
    );
  }
  assertDomainSeparatedSha256Id(
    document.profileRevisionId,
    DEPLOYMENT_PROFILE_ID_PREFIX,
    `${valuePath}.profileRevisionId`,
  );

  /** @type {Record<string, any>} */
  const input = {
    profile: document.profile,
    appId: document.appId,
    target: document.target,
  };
  if (Object.prototype.hasOwnProperty.call(document, 'bindings')) {
    input.bindings = document.bindings;
  }
  const payload = canonicalizeDeploymentProfilePayload(input, valuePath);
  const expectedProfileRevisionId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_PROFILE_ID_DOMAIN,
    prefix: DEPLOYMENT_PROFILE_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.profileRevisionId !== expectedProfileRevisionId) {
    throw new Error(
      `${valuePath}.profileRevisionId does not match the canonical profile payload.`,
    );
  }

  return /** @type {Readonly<DeploymentProfile>} */ (
    freezeJsonSnapshot(
      sortCanonicalJsonValue({
        ...payload,
        profileRevisionId: expectedProfileRevisionId,
      }),
    )
  );
}

export default {
  DEPLOYMENT_PROFILE_BINDING_KINDS,
  DEPLOYMENT_PROFILE_ID_DOMAIN,
  DEPLOYMENT_PROFILE_ID_PREFIX,
  DEPLOYMENT_PROFILE_KIND,
  DEPLOYMENT_PROFILE_SCHEMA_VERSION,
  canonicalizeDeploymentProfilePayload,
  createDeploymentProfile,
  getDeploymentProfileRevisionId,
  validateDeploymentProfile,
};
