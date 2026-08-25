/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import {
  assertApplicationRevisionId,
  validateApplicationRevision,
  validateSha256Digest,
} from './application-revision.js';
import {
  assertArtifactId,
  validateArtifactRecordObservation,
} from './artifact-record.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { cloneJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import {
  assertSingleNodeDeploymentInstanceId,
  getSingleNodeDeploymentInstanceId,
} from './single-node-deployment-identity.js';
import { validateSingleNodeDeploymentIntent } from './single-node-deployment-intent.js';

export const SINGLE_NODE_DEPLOYMENT_DESIRED_SCHEMA_VERSION = 1;
export const SINGLE_NODE_DEPLOYMENT_DESIRED_KIND =
  'singleNodeDeploymentDesired';
export const SINGLE_NODE_DEPLOYMENT_DESIRED_ID_DOMAIN =
  'wharfie:single-node-deployment-desired:v1';
export const SINGLE_NODE_DEPLOYMENT_DESIRED_ID_PREFIX = 'wsnr1';

const CREATE_KEYS = new Set([
  'intent',
  'revision',
  'artifactRecord',
  'observation',
]);
const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'deploymentInstanceId',
  'intent',
  'artifact',
]);
const DOCUMENT_KEYS = new Set(['desiredRevisionId', ...PAYLOAD_KEYS]);
const ARTIFACT_KEYS = new Set([
  'artifactId',
  'revisionId',
  'byteDigest',
  'size',
]);

/**
 * @typedef SingleNodeDeploymentDesired
 * @property {1} schemaVersion - Desired-state schema version.
 * @property {'singleNodeDeploymentDesired'} kind - Document kind.
 * @property {string} desiredRevisionId - Immutable exact desired-state identity.
 * @property {string} deploymentInstanceId - Stable human deployment identity.
 * @property {import('./single-node-deployment-intent.js').SingleNodeDeploymentIntent} intent - Exact provider-neutral intent.
 * @property {{artifactId: string, revisionId: string, byteDigest: {algorithm: 'sha256', value: string}, size: number}} artifact - Exact held Linux SEA observation.
 */

/**
 * @param {any} value - JSON value.
 * @returns {any} - Deeply frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} expectedKeys - Exact required fields.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertAllKeys(value, expectedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate compact artifact reference.
 * @param {string} valuePath - Human-readable value path.
 * @returns {SingleNodeDeploymentDesired['artifact']} - Canonical artifact reference.
 */
function validateArtifactReference(value, valuePath) {
  const artifact = cloneJsonObject(value, valuePath);
  assertAllKeys(artifact, ARTIFACT_KEYS, valuePath);
  assertArtifactId(artifact.artifactId, `${valuePath}.artifactId`);
  assertApplicationRevisionId(artifact.revisionId, `${valuePath}.revisionId`);
  const byteDigest = validateSha256Digest(
    artifact.byteDigest,
    `${valuePath}.byteDigest`,
  );
  if (artifact.artifactId !== `waf1_${byteDigest.value}`) {
    throw new Error(`${valuePath}.artifactId must name the exact byteDigest.`);
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
    throw new TypeError(`${valuePath}.size must be a positive safe integer.`);
  }
  return {
    artifactId: artifact.artifactId,
    revisionId: artifact.revisionId,
    byteDigest,
    size: artifact.size,
  };
}

/**
 * Canonicalize one complete desired-state payload.
 * @param {unknown} value - Candidate payload.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Readonly<Omit<SingleNodeDeploymentDesired, 'desiredRevisionId'>>} - Canonical payload.
 */
function canonicalizePayload(value, valuePath) {
  const payload = cloneJsonObject(value, valuePath);
  assertAllKeys(payload, PAYLOAD_KEYS, valuePath);
  if (payload.schemaVersion !== SINGLE_NODE_DEPLOYMENT_DESIRED_SCHEMA_VERSION) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (payload.kind !== SINGLE_NODE_DEPLOYMENT_DESIRED_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${SINGLE_NODE_DEPLOYMENT_DESIRED_KIND}'.`,
    );
  }
  const intent = validateSingleNodeDeploymentIntent(
    payload.intent,
    `${valuePath}.intent`,
  );
  assertSingleNodeDeploymentInstanceId(
    payload.deploymentInstanceId,
    `${valuePath}.deploymentInstanceId`,
  );
  const expectedInstanceId = getSingleNodeDeploymentInstanceId(intent);
  if (payload.deploymentInstanceId !== expectedInstanceId) {
    throw new Error(
      `${valuePath}.deploymentInstanceId does not match the exact intent.`,
    );
  }
  const artifact = validateArtifactReference(
    payload.artifact,
    `${valuePath}.artifact`,
  );
  assertManifestIsSecretFree(
    { deploymentInstanceId: expectedInstanceId, intent, artifact },
    valuePath,
  );
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: SINGLE_NODE_DEPLOYMENT_DESIRED_SCHEMA_VERSION,
      kind: SINGLE_NODE_DEPLOYMENT_DESIRED_KIND,
      deploymentInstanceId: expectedInstanceId,
      intent,
      artifact,
    }),
  );
}

/**
 * Create exact desired state from a fully validated application revision,
 * artifact record, and held-byte observation.
 * @param {unknown} value - Intent and trusted artifact validation context.
 * @returns {Readonly<SingleNodeDeploymentDesired>} - Canonical desired state.
 */
export function createSingleNodeDeploymentDesired(value) {
  const input = cloneJsonObject(value, 'singleNodeDeploymentDesired');
  assertAllKeys(input, CREATE_KEYS, 'singleNodeDeploymentDesired');
  const intent = validateSingleNodeDeploymentIntent(
    input.intent,
    'singleNodeDeploymentDesired.intent',
  );
  const revision = validateApplicationRevision(
    input.revision,
    'singleNodeDeploymentDesired.revision',
  );
  const record = validateArtifactRecordObservation(
    input.artifactRecord,
    {
      observation: input.observation,
      revision,
    },
    'singleNodeDeploymentDesired.artifactRecord',
  );
  if (
    record.appId !== intent.appId ||
    record.revisionId !== revision.revisionId
  ) {
    throw new Error(
      'singleNodeDeploymentDesired artifact must belong to the intended application revision.',
    );
  }
  if (
    record.target.nodeVersion !== intent.target.nodeVersion ||
    record.target.platform !== intent.target.platform ||
    record.target.architecture !== intent.target.architecture ||
    record.target.libc !== intent.target.libc
  ) {
    throw new Error(
      'singleNodeDeploymentDesired artifact target must exactly match the deployment intent.',
    );
  }

  const payload = canonicalizePayload(
    {
      schemaVersion: SINGLE_NODE_DEPLOYMENT_DESIRED_SCHEMA_VERSION,
      kind: SINGLE_NODE_DEPLOYMENT_DESIRED_KIND,
      deploymentInstanceId: getSingleNodeDeploymentInstanceId(intent),
      intent,
      artifact: {
        artifactId: record.artifactId,
        revisionId: record.revisionId,
        byteDigest: record.byteDigest,
        size: record.size,
      },
    },
    'singleNodeDeploymentDesired',
  );
  const desiredRevisionId = createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_DEPLOYMENT_DESIRED_ID_DOMAIN,
    prefix: SINGLE_NODE_DEPLOYMENT_DESIRED_ID_PREFIX,
    value: payload,
    valuePath: 'singleNodeDeploymentDesired',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, desiredRevisionId }));
}

/**
 * Validate serialized desired state and recompute its immutable identity.
 * @param {unknown} value - Candidate serialized desired state.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<SingleNodeDeploymentDesired>} - Canonical desired state.
 */
export function validateSingleNodeDeploymentDesired(
  value,
  valuePath = 'singleNodeDeploymentDesired',
) {
  const document = cloneJsonObject(value, valuePath);
  assertAllKeys(document, DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.desiredRevisionId,
    SINGLE_NODE_DEPLOYMENT_DESIRED_ID_PREFIX,
    `${valuePath}.desiredRevisionId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = canonicalizePayload(payloadInput, valuePath);
  const expectedId = createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_DEPLOYMENT_DESIRED_ID_DOMAIN,
    prefix: SINGLE_NODE_DEPLOYMENT_DESIRED_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.desiredRevisionId !== expectedId) {
    throw new Error(
      `${valuePath}.desiredRevisionId does not match the canonical desired state.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, desiredRevisionId: expectedId }),
  );
}

export default {
  SINGLE_NODE_DEPLOYMENT_DESIRED_ID_DOMAIN,
  SINGLE_NODE_DEPLOYMENT_DESIRED_ID_PREFIX,
  SINGLE_NODE_DEPLOYMENT_DESIRED_KIND,
  SINGLE_NODE_DEPLOYMENT_DESIRED_SCHEMA_VERSION,
  createSingleNodeDeploymentDesired,
  validateSingleNodeDeploymentDesired,
};
