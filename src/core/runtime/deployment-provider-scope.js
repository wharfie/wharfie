/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact internal helpers are not understood cleanly by the current JSDoc lint parser. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import { cloneJsonObject } from './json-value.js';

export const PROVIDER_SCOPE_SCHEMA_VERSION = 1;
export const PROVIDER_SCOPE_KIND = 'providerScope';
export const PROVIDER_SCOPE_ID_DOMAIN = 'wharfie:provider-scope:v1';
export const PROVIDER_SCOPE_ID_PREFIX = 'wps1';
export const DEPLOYMENT_INSTANCE_ID_DOMAIN = 'wharfie:deployment-instance:v1';
export const DEPLOYMENT_INSTANCE_ID_PREFIX = 'wdi1';

const SCOPE_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provider',
  'partition',
  'accountId',
  'region',
]);
const SCOPE_DOCUMENT_KEYS = new Set(['providerScopeId', ...SCOPE_PAYLOAD_KEYS]);
const AWS_PARTITION_PATTERN = /^aws(?:-[a-z0-9]+)*$/;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const AWS_REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/**
 * @typedef AwsProviderScope
 * @property {1} schemaVersion - Schema version.
 * @property {'providerScope'} kind - Document kind.
 * @property {string} providerScopeId - Redacted immutable scope identity.
 * @property {'aws'} provider - Provider driver identity.
 * @property {string} partition - Resolved AWS partition.
 * @property {string} accountId - Resolved 12-digit AWS account.
 * @property {string} region - Explicit resolved region.
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

/**
 * @param {unknown} value - Candidate scope fields.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Omit<AwsProviderScope, 'providerScopeId'>} - Canonical payload.
 */
function validateScopePayload(value, valuePath) {
  const scope = cloneJsonObject(value, valuePath);
  assertAllKeys(scope, SCOPE_PAYLOAD_KEYS, valuePath);
  if (scope.schemaVersion !== PROVIDER_SCOPE_SCHEMA_VERSION) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (scope.kind !== PROVIDER_SCOPE_KIND) {
    throw new TypeError(`${valuePath}.kind must be '${PROVIDER_SCOPE_KIND}'.`);
  }
  if (scope.provider !== 'aws') {
    throw new TypeError(`${valuePath}.provider must be 'aws'.`);
  }
  if (
    typeof scope.partition !== 'string' ||
    scope.partition.length > 32 ||
    !AWS_PARTITION_PATTERN.test(scope.partition)
  ) {
    throw new TypeError(
      `${valuePath}.partition must be a canonical AWS partition.`,
    );
  }
  if (
    typeof scope.accountId !== 'string' ||
    !AWS_ACCOUNT_ID_PATTERN.test(scope.accountId)
  ) {
    throw new TypeError(
      `${valuePath}.accountId must be a 12-digit AWS account ID.`,
    );
  }
  if (
    typeof scope.region !== 'string' ||
    scope.region.length > 63 ||
    !AWS_REGION_PATTERN.test(scope.region)
  ) {
    throw new TypeError(`${valuePath}.region must be a canonical AWS region.`);
  }
  return {
    schemaVersion: PROVIDER_SCOPE_SCHEMA_VERSION,
    kind: PROVIDER_SCOPE_KIND,
    provider: 'aws',
    partition: scope.partition,
    accountId: scope.accountId,
    region: scope.region,
  };
}

/**
 * Create the redacted durable identity of one AWS credential scope.
 * @param {{partition: string, accountId: string, region: string}} value - Values resolved through the normal AWS credential chain.
 * @returns {Readonly<AwsProviderScope>} - Canonical scope.
 */
export function createAwsProviderScope(value) {
  const payload = deepFreeze(
    sortCanonicalJsonValue(
      validateScopePayload(
        {
          schemaVersion: PROVIDER_SCOPE_SCHEMA_VERSION,
          kind: PROVIDER_SCOPE_KIND,
          provider: 'aws',
          partition: value?.partition,
          accountId: value?.accountId,
          region: value?.region,
        },
        'providerScope',
      ),
    ),
  );
  const providerScopeId = createCanonicalJsonSha256Id({
    domain: PROVIDER_SCOPE_ID_DOMAIN,
    prefix: PROVIDER_SCOPE_ID_PREFIX,
    value: payload,
    valuePath: 'providerScope',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, providerScopeId }));
}

/**
 * Validate a serialized provider scope and recompute its identity.
 * @param {unknown} value - Candidate scope.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<AwsProviderScope>} - Canonical scope.
 */
export function validateProviderScope(value, valuePath = 'providerScope') {
  const document = cloneJsonObject(value, valuePath);
  assertAllKeys(document, SCOPE_DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    `${valuePath}.providerScopeId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of SCOPE_PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = deepFreeze(
    sortCanonicalJsonValue(validateScopePayload(payloadInput, valuePath)),
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: PROVIDER_SCOPE_ID_DOMAIN,
    prefix: PROVIDER_SCOPE_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.providerScopeId !== expectedId) {
    throw new Error(
      `${valuePath}.providerScopeId does not match the resolved AWS scope.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, providerScopeId: expectedId }),
  );
}

/**
 * Derive the stable identity of one human deployment in one provider scope.
 * Artifact/profile updates preserve this identity; destroy then fresh apply
 * creates a new incarnation under it.
 * @param {{deploymentRevision: unknown, providerScope: unknown}} value - Exact deployment and resolved scope.
 * @returns {string} - `wdi1_` identity.
 */
export function getDeploymentInstanceId(value) {
  const deploymentRevision = validateDeploymentRevision(
    value?.deploymentRevision,
  );
  const providerScope = validateProviderScope(value?.providerScope);
  return createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_INSTANCE_ID_DOMAIN,
    prefix: DEPLOYMENT_INSTANCE_ID_PREFIX,
    value: {
      appId: deploymentRevision.appId,
      deployment: deploymentRevision.deployment,
      providerScopeId: providerScope.providerScopeId,
    },
    valuePath: 'deploymentInstance',
  });
}

/** @param {unknown} value @param {string} [valuePath] @returns {asserts value is string} */
export function assertDeploymentInstanceId(
  value,
  valuePath = 'deploymentInstanceId',
) {
  assertDomainSeparatedSha256Id(
    value,
    DEPLOYMENT_INSTANCE_ID_PREFIX,
    valuePath,
  );
}

export default {
  DEPLOYMENT_INSTANCE_ID_DOMAIN,
  DEPLOYMENT_INSTANCE_ID_PREFIX,
  PROVIDER_SCOPE_ID_DOMAIN,
  PROVIDER_SCOPE_ID_PREFIX,
  PROVIDER_SCOPE_KIND,
  PROVIDER_SCOPE_SCHEMA_VERSION,
  assertDeploymentInstanceId,
  createAwsProviderScope,
  getDeploymentInstanceId,
  validateProviderScope,
};
