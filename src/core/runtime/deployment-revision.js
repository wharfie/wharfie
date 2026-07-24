/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact internal helpers are not understood cleanly by the current JSDoc lint parser. */

import {
  assertApplicationRevisionId,
  validateApplicationRevision,
  validateSha256Digest,
} from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import { getBuildTargetId, validateBuildTarget } from './build-target.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import {
  DEPLOYMENT_PROFILE_ID_PREFIX,
  validateDeploymentProfile,
} from './deployment-profile.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const DEPLOYMENT_REVISION_SCHEMA_VERSION = 1;
export const DEPLOYMENT_REVISION_KIND = 'deploymentRevision';
export const DEPLOYMENT_REVISION_ID_DOMAIN = 'wharfie:deployment-revision:v1';
export const DEPLOYMENT_REVISION_ID_PREFIX = 'wdr1';

const CREATE_INPUT_KEYS = new Set(['deployment', 'profile']);
const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'deployment',
  'appId',
  'revisionId',
  'artifactId',
  'profileRevisionId',
]);
const DOCUMENT_KEYS = new Set(['deploymentRevisionId', ...PAYLOAD_KEYS]);
const DEPLOYMENT_KEYS = new Set(['id']);
const RUNTIME_KEYS = new Set([
  'schemaVersion',
  'kind',
  'appId',
  'revisionId',
  'target',
]);
const ARTIFACT_OBSERVATION_KEYS = new Set(['artifactId', 'byteDigest', 'size']);

/**
 * @typedef DeploymentRevision
 * @property {1} schemaVersion - Schema version.
 * @property {'deploymentRevision'} kind - Document kind.
 * @property {string} deploymentRevisionId - Immutable desired-deployment identity.
 * @property {{id: string}} deployment - Stable human deployment identity.
 * @property {string} appId - Owning application.
 * @property {string} revisionId - Exact embedded logical revision.
 * @property {string} artifactId - Exact held running SEA bytes.
 * @property {string} profileRevisionId - Exact provider fulfillment profile.
 */

/**
 * @typedef RunningDeploymentArtifactDependencies
 * @property {() => Promise<{revision: unknown, runtime: unknown}>} [readEmbeddedRevisionRuntimePair] - Test hook for the embedded metadata reader.
 * @property {() => Promise<{artifactId: string, byteDigest: unknown, size: number}>} [inspectRunningArtifact] - Test hook for held executable observation.
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
 * @param {unknown} value - Candidate small reference payload.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Omit<DeploymentRevision, 'deploymentRevisionId'>} - Canonical payload.
 */
function validatePayload(value, valuePath) {
  const payload = cloneJsonObject(value, valuePath);
  assertAllKeys(payload, PAYLOAD_KEYS, valuePath);
  if (payload.schemaVersion !== DEPLOYMENT_REVISION_SCHEMA_VERSION) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (payload.kind !== DEPLOYMENT_REVISION_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${DEPLOYMENT_REVISION_KIND}'.`,
    );
  }
  const deployment = cloneJsonObject(
    payload.deployment,
    `${valuePath}.deployment`,
  );
  assertAllKeys(deployment, DEPLOYMENT_KEYS, `${valuePath}.deployment`);
  assertLogicalId(deployment.id, `${valuePath}.deployment.id`);
  assertLogicalId(payload.appId, `${valuePath}.appId`);
  assertApplicationRevisionId(payload.revisionId, `${valuePath}.revisionId`);
  assertArtifactId(payload.artifactId, `${valuePath}.artifactId`);
  assertDomainSeparatedSha256Id(
    payload.profileRevisionId,
    DEPLOYMENT_PROFILE_ID_PREFIX,
    `${valuePath}.profileRevisionId`,
  );
  return {
    schemaVersion: DEPLOYMENT_REVISION_SCHEMA_VERSION,
    kind: DEPLOYMENT_REVISION_KIND,
    deployment: { id: deployment.id },
    appId: payload.appId,
    revisionId: payload.revisionId,
    artifactId: payload.artifactId,
    profileRevisionId: payload.profileRevisionId,
  };
}

/**
 * Validate the target metadata returned by the embedded SEA reader even when
 * that reader is injected for a test.
 * @param {unknown} value - Candidate runtime document.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical runtime metadata.
 */
function validateArtifactRuntime(value, valuePath) {
  const runtime = cloneJsonObject(value, valuePath);
  assertAllKeys(runtime, RUNTIME_KEYS, valuePath);
  if (runtime.schemaVersion !== 1 || runtime.kind !== 'artifactRuntime') {
    throw new TypeError(
      `${valuePath} must be artifactRuntime schema version 1.`,
    );
  }
  assertLogicalId(runtime.appId, `${valuePath}.appId`);
  assertApplicationRevisionId(runtime.revisionId, `${valuePath}.revisionId`);
  return deepFreeze({
    schemaVersion: 1,
    kind: 'artifactRuntime',
    appId: runtime.appId,
    revisionId: runtime.revisionId,
    target: validateBuildTarget(runtime.target, `${valuePath}.target`),
  });
}

/**
 * @param {unknown} value - Candidate exact running-byte observation.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Readonly<{artifactId: string, byteDigest: {algorithm: 'sha256', value: string}, size: number}>} - Canonical observation.
 */
function validateArtifactObservation(value, valuePath) {
  const observation = cloneJsonObject(value, valuePath);
  assertAllKeys(observation, ARTIFACT_OBSERVATION_KEYS, valuePath);
  assertArtifactId(observation.artifactId, `${valuePath}.artifactId`);
  const byteDigest = validateSha256Digest(
    observation.byteDigest,
    `${valuePath}.byteDigest`,
  );
  if (observation.artifactId !== `waf1_${byteDigest.value}`) {
    throw new Error(
      `${valuePath}.artifactId must name the exact observed byteDigest.`,
    );
  }
  if (!Number.isSafeInteger(observation.size) || observation.size < 0) {
    throw new TypeError(
      `${valuePath}.size must be a nonnegative safe integer.`,
    );
  }
  return deepFreeze({
    artifactId: observation.artifactId,
    byteDigest,
    size: observation.size,
  });
}

/**
 * Read the validated embedded pair and held executable bytes from this running
 * SEA. Production callers cannot redirect either source to another artifact.
 * @param {RunningDeploymentArtifactDependencies} dependencies - Optional test readers.
 * @returns {Promise<{revision: Readonly<Record<string, any>>, runtime: Readonly<Record<string, any>>, artifact: Readonly<Record<string, any>>}>} - One running-artifact observation.
 */
async function observeRunningDeploymentArtifact(dependencies) {
  let readPair = dependencies.readEmbeddedRevisionRuntimePair;
  let inspectArtifact = dependencies.inspectRunningArtifact;
  if (!readPair) {
    const module =
      await import('../resources/builds/lib/revision-runtime-assets.js');
    readPair = module.readEmbeddedRevisionRuntimePair;
  }
  if (!inspectArtifact) {
    const module = await import('./packaged-artifact.js');
    inspectArtifact = async () =>
      await module.inspectArtifactBytes(module.getRunningExecutablePath());
  }
  const observations = await Promise.allSettled([
    Promise.resolve().then(() => readPair()),
    Promise.resolve().then(() => inspectArtifact()),
  ]);
  for (const observation of observations) {
    if (observation.status === 'rejected') throw observation.reason;
  }
  const [pairObservation, artifactObservation] = observations;
  if (pairObservation.status === 'rejected') throw pairObservation.reason;
  if (artifactObservation.status === 'rejected') {
    throw artifactObservation.reason;
  }
  const pairValue = pairObservation.value;
  const artifactValue = artifactObservation.value;
  const pair = cloneJsonObject(pairValue, 'runningArtifact.embedded');
  assertAllKeys(
    pair,
    new Set(['revision', 'runtime']),
    'runningArtifact.embedded',
  );
  const revision = validateApplicationRevision(
    pair.revision,
    'runningArtifact.embedded.revision',
  );
  const runtime = validateArtifactRuntime(
    pair.runtime,
    'runningArtifact.embedded.runtime',
  );
  if (
    runtime.appId !== revision.contract.app.id ||
    runtime.revisionId !== revision.revisionId
  ) {
    throw new Error(
      'Running artifact embedded runtime does not match its embedded revision.',
    );
  }
  return {
    revision,
    runtime,
    artifact: validateArtifactObservation(
      artifactValue,
      'runningArtifact.artifact',
    ),
  };
}

/**
 * Create a fully cross-checked deployment payload from this exact running SEA.
 * @param {unknown} value - Human deployment and full profile.
 * @param {RunningDeploymentArtifactDependencies} dependencies - Test readers.
 * @returns {Promise<Omit<DeploymentRevision, 'deploymentRevisionId'>>} - Canonical payload.
 */
async function createPayloadFromRunningArtifact(value, dependencies) {
  const input = cloneJsonObject(value, 'deploymentRevision');
  assertAllKeys(input, CREATE_INPUT_KEYS, 'deploymentRevision');
  const deployment = cloneJsonObject(
    input.deployment,
    'deploymentRevision.deployment',
  );
  assertAllKeys(deployment, DEPLOYMENT_KEYS, 'deploymentRevision.deployment');
  assertLogicalId(deployment.id, 'deploymentRevision.deployment.id');
  const profile = validateDeploymentProfile(
    input.profile,
    'deploymentRevision.profile',
  );
  const running = await observeRunningDeploymentArtifact(dependencies);
  const appId = running.revision.contract.app.id;
  if (profile.appId !== appId || running.runtime.appId !== appId) {
    throw new Error(
      'Deployment revision, running artifact, and profile must name the same appId.',
    );
  }
  if (running.runtime.revisionId !== running.revision.revisionId) {
    throw new Error(
      'Running artifact runtime must name its exact embedded revision.',
    );
  }
  if (
    getBuildTargetId(running.runtime.target) !==
    getBuildTargetId(profile.target)
  ) {
    throw new Error(
      'Running artifact target must equal the exact profile target.',
    );
  }
  return {
    schemaVersion: DEPLOYMENT_REVISION_SCHEMA_VERSION,
    kind: DEPLOYMENT_REVISION_KIND,
    deployment: { id: deployment.id },
    appId,
    revisionId: running.revision.revisionId,
    artifactId: running.artifact.artifactId,
    profileRevisionId: profile.profileRevisionId,
  };
}

/**
 * Create one immutable deployment revision from the exact SEA executing this
 * command. The default path reads embedded metadata from this SEA and hashes
 * its held executable descriptor; it never trusts a sidecar or caller path.
 * @param {unknown} value - Deployment identity and exact profile.
 * @param {RunningDeploymentArtifactDependencies} [dependencies] - Test readers only.
 * @returns {Promise<Readonly<DeploymentRevision>>} - Canonical deployment revision.
 */
export async function createRunningDeploymentRevision(
  value,
  dependencies = {},
) {
  const payload = deepFreeze(
    sortCanonicalJsonValue(
      await createPayloadFromRunningArtifact(value, dependencies),
    ),
  );
  const deploymentRevisionId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_REVISION_ID_DOMAIN,
    prefix: DEPLOYMENT_REVISION_ID_PREFIX,
    value: payload,
    valuePath: 'deploymentRevision',
  });
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, deploymentRevisionId }),
  );
}

/**
 * Validate a serialized reference document and recompute its identity. This is
 * sufficient for read-only history and, with ownership receipts, destroy. It
 * is not sufficient for apply/reconcile, which must re-observe the running SEA.
 * @param {unknown} value - Candidate serialized deployment revision.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentRevision>} - Canonical deployment revision.
 */
export function validateDeploymentRevision(
  value,
  valuePath = 'deploymentRevision',
) {
  const document = cloneJsonObject(value, valuePath);
  assertAllKeys(document, DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.deploymentRevisionId,
    DEPLOYMENT_REVISION_ID_PREFIX,
    `${valuePath}.deploymentRevisionId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = deepFreeze(
    sortCanonicalJsonValue(validatePayload(payloadInput, valuePath)),
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_REVISION_ID_DOMAIN,
    prefix: DEPLOYMENT_REVISION_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.deploymentRevisionId !== expectedId) {
    throw new Error(
      `${valuePath}.deploymentRevisionId does not match its exact references.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, deploymentRevisionId: expectedId }),
  );
}

/**
 * Re-observe this running SEA before apply/reconcile and prove it is still the
 * exact deployment target. Destroy deliberately does not require old bytes.
 * @param {unknown} value - Candidate deployment revision.
 * @param {{profile: unknown}} context - Exact profile record.
 * @param {RunningDeploymentArtifactDependencies} [dependencies] - Test readers only.
 * @returns {Promise<Readonly<DeploymentRevision>>} - Fully cross-checked deployment revision.
 */
export async function validateRunningDeploymentRevisionContext(
  value,
  context,
  dependencies = {},
) {
  const deploymentRevision = validateDeploymentRevision(value);
  const expected = await createRunningDeploymentRevision(
    {
      deployment: deploymentRevision.deployment,
      profile: context?.profile,
    },
    dependencies,
  );
  if (
    deploymentRevision.deploymentRevisionId !== expected.deploymentRevisionId
  ) {
    throw new Error(
      'Deployment revision does not match this running artifact and resolved profile.',
    );
  }
  return expected;
}

export default {
  DEPLOYMENT_REVISION_ID_DOMAIN,
  DEPLOYMENT_REVISION_ID_PREFIX,
  DEPLOYMENT_REVISION_KIND,
  DEPLOYMENT_REVISION_SCHEMA_VERSION,
  createRunningDeploymentRevision,
  validateDeploymentRevision,
  validateRunningDeploymentRevisionContext,
};
