/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- One compact immutable experiment contract is clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX } from './deployment-aws-provider-spec.js';
import { PROVIDER_SCOPE_ID_PREFIX } from './deployment-provider-scope.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_KIND =
  'awsSingleNodeRetainedStorageProviderExperiment';
export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_ID_DOMAIN =
  'wharfie:aws-single-node:retained-storage-provider-experiment:v1';
export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_ID_PREFIX =
  'wre1';
export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_BYTES =
  64 * 1024;
export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_DURATION_MS =
  6 * 60 * 60 * 1000;

const PURPOSE = 'retained-storage-provider-qualification';
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const VOLUME_ROLES = new Set(['application-state', 'control-state']);
const INPUT_KEYS = new Set([
  'sourceCommit',
  'providerScopeId',
  'providerSpecId',
  'volumeRole',
  'notBefore',
  'expiresAt',
]);
const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'purpose',
  'authority',
  ...INPUT_KEYS,
]);
const DOCUMENT_KEYS = new Set(['experimentId', ...PAYLOAD_KEYS]);

/** The evidence-only experiment is not active at the supplied instant. */
export class AwsSingleNodeRetainedStorageProviderExperimentInactiveError extends Error {
  constructor() {
    super('AWS retained-storage provider experiment is not active.');
    this.name = 'AwsSingleNodeRetainedStorageProviderExperimentInactiveError';
    this.code = 'AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_INACTIVE';
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(`${path} must contain only its exact required keys.`);
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

/** @param {unknown} value @param {string} path @returns {number} */
function validateInstant(value, path) {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    throw new TypeError(`${path} must be a canonical ISO-8601 UTC instant.`);
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new TypeError(`${path} must be a canonical ISO-8601 UTC instant.`);
  }
  return milliseconds;
}

/** @param {Record<string, any>} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validatePayload(value, path) {
  assertExactKeys(value, PAYLOAD_KEYS, path);
  if (
    value.schemaVersion !==
      AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_SCHEMA_VERSION ||
    value.kind !== AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_KIND ||
    value.purpose !== PURPOSE ||
    value.authority !== 'none' ||
    typeof value.sourceCommit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(value.sourceCommit) ||
    !VOLUME_ROLES.has(value.volumeRole)
  ) {
    throw new TypeError(
      'AWS retained-storage provider experiment payload is invalid.',
    );
  }
  assertDomainSeparatedSha256Id(
    value.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    `${path}.providerScopeId`,
  );
  assertDomainSeparatedSha256Id(
    value.providerSpecId,
    AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    `${path}.providerSpecId`,
  );
  const notBefore = validateInstant(value.notBefore, `${path}.notBefore`);
  const expiresAt = validateInstant(value.expiresAt, `${path}.expiresAt`);
  if (
    expiresAt <= notBefore ||
    expiresAt - notBefore >
      AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_DURATION_MS
  ) {
    throw new TypeError(
      'AWS retained-storage provider experiment window must be positive and no longer than six hours.',
    );
  }
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_KIND,
      purpose: PURPOSE,
      authority: 'none',
      sourceCommit: value.sourceCommit,
      providerScopeId: value.providerScopeId,
      providerSpecId: value.providerSpecId,
      volumeRole: value.volumeRole,
      notBefore: value.notBefore,
      expiresAt: value.expiresAt,
    }),
  );
  assertManifestIsSecretFree(
    payload,
    'aws retained-storage provider experiment',
  );
  return payload;
}

/**
 * Create one evidence-only, expiring experiment descriptor. This descriptor
 * correlates exact reads and tags; it grants no cloud or host mutation.
 * @param {unknown} value - Exact source, scope, provider spec, role, and window.
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeRetainedStorageProviderExperiment(value) {
  const input = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_BYTES,
    'aws retained-storage provider experiment input',
  );
  assertExactKeys(
    input,
    INPUT_KEYS,
    'aws retained-storage provider experiment input',
  );
  const payload = validatePayload(
    {
      schemaVersion:
        AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_KIND,
      purpose: PURPOSE,
      authority: 'none',
      ...input,
    },
    'aws retained-storage provider experiment',
  );
  const experimentId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_ID_PREFIX,
    value: payload,
    valuePath: 'aws retained-storage provider experiment',
  });
  return deepFreeze(
    sortCanonicalJsonValue({
      ...payload,
      experimentId,
    }),
  );
}

/**
 * Validate one bounded serialized experiment descriptor and recompute its ID.
 * @param {unknown} value - Candidate descriptor.
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsSingleNodeRetainedStorageProviderExperiment(value) {
  const document = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_BYTES,
    'aws retained-storage provider experiment',
  );
  assertExactKeys(
    document,
    DOCUMENT_KEYS,
    'aws retained-storage provider experiment',
  );
  assertDomainSeparatedSha256Id(
    document.experimentId,
    AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_ID_PREFIX,
    'aws retained-storage provider experiment.experimentId',
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validatePayload(
    payloadInput,
    'aws retained-storage provider experiment',
  );
  const experimentId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_ID_PREFIX,
    value: payload,
    valuePath: 'aws retained-storage provider experiment',
  });
  if (document.experimentId !== experimentId) {
    throw new Error(
      'AWS retained-storage provider experiment ID does not match its exact payload.',
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      ...payload,
      experimentId,
    }),
  );
}

/**
 * Require the exact experiment to be active at one caller-supplied instant.
 * The end instant is exclusive so a read cannot begin at expiry.
 * @param {unknown} value - Serialized experiment descriptor.
 * @param {unknown} now - Epoch milliseconds.
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsSingleNodeRetainedStorageProviderExperimentWindow(
  value,
  now,
) {
  const experiment =
    validateAwsSingleNodeRetainedStorageProviderExperiment(value);
  if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0) {
    throw new TypeError(
      'AWS retained-storage provider experiment clock must be nonnegative epoch milliseconds.',
    );
  }
  const notBefore = Date.parse(experiment.notBefore);
  const expiresAt = Date.parse(experiment.expiresAt);
  if (now < notBefore || now >= expiresAt) {
    throw new AwsSingleNodeRetainedStorageProviderExperimentInactiveError();
  }
  return experiment;
}

/** @param {Readonly<Record<string, any>>} experiment @param {string} resourceKind @param {string|null} volumeRole @returns {Readonly<Record<string, string>>} */
function resourceTags(experiment, resourceKind, volumeRole) {
  const tags = {
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': resourceKind,
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '1',
    'wharfie:evidence-experiment-id': experiment.experimentId,
    'wharfie:evidence-purpose': PURPOSE,
    'wharfie:evidence-source-commit': experiment.sourceCommit,
    'wharfie:evidence-expires-at': experiment.expiresAt,
    ...(volumeRole === null
      ? {}
      : { 'wharfie:evidence-volume-role': volumeRole }),
  };
  assertManifestIsSecretFree(
    tags,
    'aws retained-storage provider experiment tags',
  );
  return deepFreeze(sortCanonicalJsonValue(tags));
}

/**
 * Derive the three exact evidence-only tag sets. They deliberately use purge
 * semantics and cannot be mistaken for production retained-state ownership.
 * @param {unknown} value - Serialized experiment descriptor.
 * @returns {Readonly<{instance: Readonly<Record<string, string>>, rootVolume: Readonly<Record<string, string>>, evidenceVolume: Readonly<Record<string, string>>}>}
 */
export function getAwsSingleNodeRetainedStorageProviderExperimentTags(value) {
  const experiment =
    validateAwsSingleNodeRetainedStorageProviderExperiment(value);
  return deepFreeze({
    instance: resourceTags(experiment, 'retained-storage-evidence-host', null),
    rootVolume: resourceTags(
      experiment,
      'retained-storage-evidence-root-volume',
      null,
    ),
    evidenceVolume: resourceTags(
      experiment,
      'retained-storage-evidence-volume',
      experiment.volumeRole,
    ),
  });
}

export default createAwsSingleNodeRetainedStorageProviderExperiment;
