import assert from 'node:assert/strict';

import {
  parseApplicationPackageReceiptOutput,
  validateApplicationPackageReceipt,
} from '../src/cli/app/package-command-receipt.js';
import { validateAppManifest } from '../src/core/runtime/app-manifest.js';
import { validateSha256Digest } from '../src/core/runtime/application-revision.js';
import {
  ARTIFACT_ID_PREFIX,
  assertArtifactId,
  validateArtifactRecord,
} from '../src/core/runtime/artifact-record.js';
import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import { cloneJsonObject } from '../src/core/runtime/json-value.js';
import { validateEmbeddedRevisionRuntimePair } from '../src/core/resources/builds/lib/revision-runtime-assets.js';

const EMBEDDED_METADATA_KEYS = ['artifact', 'revision', 'runtime'];
const ARTIFACT_OBSERVATION_KEYS = ['artifactId', 'byteDigest', 'size'];

/**
 * Require one exact record shape after the JSON boundary.
 * @param {Record<string, any>} value - Candidate record.
 * @param {string[]} keys - Exact supported keys.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertExactKeys(value, keys, valuePath) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new TypeError(
      `${valuePath} must contain exactly ${keys.join(', ')}.`,
    );
  }
}

/**
 * Recursively freeze one independently validated JSON result.
 * @param {any} value - JSON value.
 * @returns {any} - The same deeply frozen value.
 */
function freezeJsonDocument(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJsonDocument(child);
  return Object.freeze(value);
}

/**
 * Compare validated JSON semantics without treating null-prototype clones as
 * different from ordinary parsed JSON objects.
 * @param {unknown} actual - Observed JSON value.
 * @param {unknown} expected - Expected JSON value.
 * @param {string} message - Assertion message.
 * @returns {void}
 */
function assertSameCanonicalJson(actual, expected, message) {
  assert.equal(
    JSON.stringify(sortCanonicalJsonValue(actual)),
    JSON.stringify(sortCanonicalJsonValue(expected)),
    message,
  );
}

/**
 * Validate the exact-byte observation printed by the packaged metadata
 * command. The sidecar join below independently recomputes the same identity.
 * @param {unknown} raw - Candidate metadata artifact observation.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {Readonly<{artifactId: string, byteDigest: import('../src/core/runtime/application-revision.js').Sha256Digest, size: number}>} - Validated observation.
 */
function validateArtifactObservation(raw, valuePath) {
  const observation = cloneJsonObject(raw, valuePath);
  assertExactKeys(observation, ARTIFACT_OBSERVATION_KEYS, valuePath);
  assertArtifactId(observation.artifactId, `${valuePath}.artifactId`);
  const byteDigest = validateSha256Digest(
    observation.byteDigest,
    `${valuePath}.byteDigest`,
  );
  if (observation.artifactId !== `${ARTIFACT_ID_PREFIX}_${byteDigest.value}`) {
    throw new Error(`${valuePath}.artifactId must name its exact byteDigest.`);
  }
  if (!Number.isSafeInteger(observation.size) || observation.size < 0) {
    throw new TypeError(
      `${valuePath}.size must be a nonnegative safe integer.`,
    );
  }
  return freezeJsonDocument({
    artifactId: observation.artifactId,
    byteDigest,
    size: observation.size,
  });
}

/**
 * Parse the complete one-document stdout contract from source packaging.
 * @param {unknown} stdout - Captured `wharfie app package` stdout.
 * @returns {ReturnType<typeof parseApplicationPackageReceiptOutput>} - Strict frozen receipt.
 */
export function parsePackageSeaReceipt(stdout) {
  return parseApplicationPackageReceiptOutput(
    stdout,
    'package SEA verifier package stdout',
  );
}

/**
 * Join an untrusted public package receipt to independently read executable
 * bytes, its complete canonical sidecar, and metadata observed from the
 * relocated running SEA. The public receipt supplies discovery only; this
 * boundary derives artifact authority from the bytes, sidecar, embedded
 * revision/runtime pair, and embedded manifest together.
 * @param {{
 *   receipt: unknown,
 *   artifactIndex?: number,
 *   artifactBytes: Buffer | Uint8Array | ArrayBuffer,
 *   artifactRecord: unknown,
 *   embeddedManifest: unknown,
 *   embeddedMetadata: unknown
 * }} input - Independent handoff evidence.
 * @returns {Readonly<{
 *   receipt: ReturnType<typeof validateApplicationPackageReceipt>,
 *   artifact: Record<string, any>,
 *   record: import('../src/core/runtime/artifact-record.js').ArtifactRecord,
 *   manifest: Record<string, any>,
 *   revision: import('../src/core/runtime/application-revision.js').ApplicationRevision,
 *   runtime: import('../src/core/resources/builds/lib/revision-runtime-assets.js').ArtifactRuntime,
 *   observation: {artifactId: string, byteDigest: import('../src/core/runtime/application-revision.js').Sha256Digest, size: number}
 * }>} - Cross-checked independent authority snapshot.
 */
export function verifyPackageSeaArtifactHandoff(input) {
  const receipt = validateApplicationPackageReceipt(
    input?.receipt,
    'package SEA verifier receipt',
  );
  const artifactIndex = input?.artifactIndex ?? 0;
  if (
    !Number.isSafeInteger(artifactIndex) ||
    artifactIndex < 0 ||
    artifactIndex >= receipt.artifacts.length
  ) {
    throw new TypeError(
      'package SEA verifier artifactIndex must select one receipt artifact.',
    );
  }
  const artifact = receipt.artifacts[artifactIndex];

  const metadata = cloneJsonObject(
    input?.embeddedMetadata,
    'package SEA verifier embedded metadata',
  );
  assertExactKeys(
    metadata,
    EMBEDDED_METADATA_KEYS,
    'package SEA verifier embedded metadata',
  );
  const pair = validateEmbeddedRevisionRuntimePair(
    metadata.revision,
    metadata.runtime,
    'package SEA verifier embedded metadata',
  );
  const observation = validateArtifactObservation(
    metadata.artifact,
    'package SEA verifier embedded metadata.artifact',
  );
  const manifest = validateAppManifest(
    input?.embeddedManifest,
    'package SEA verifier embedded manifest',
  );
  const targetIndependentManifest = { ...manifest };
  delete targetIndependentManifest.targets;

  assertSameCanonicalJson(
    targetIndependentManifest,
    pair.revision.contract,
    'Embedded manifest behavior must match the embedded logical revision.',
  );
  assertSameCanonicalJson(
    manifest.targets,
    [pair.runtime.target],
    'Embedded manifest must expose exactly its embedded artifact target.',
  );

  const record = validateArtifactRecord(
    input?.artifactRecord,
    {
      bytes: input?.artifactBytes,
      revision: pair.revision,
    },
    'package SEA verifier artifact sidecar',
  );

  assert.equal(receipt.appId, pair.revision.contract.app.id);
  assert.equal(receipt.revisionId, pair.revision.revisionId);
  assert.equal(record.appId, receipt.appId);
  assert.equal(record.revisionId, receipt.revisionId);
  assert.equal(record.artifactId, artifact.artifactId);
  assert.deepEqual(record.byteDigest, artifact.byteDigest);
  assert.equal(record.size, artifact.size);
  assert.deepEqual(record.target, artifact.target);
  assert.deepEqual(pair.runtime.target, record.target);
  assert.deepEqual(observation, {
    artifactId: record.artifactId,
    byteDigest: record.byteDigest,
    size: record.size,
  });

  return freezeJsonDocument({
    receipt,
    artifact,
    record,
    manifest,
    revision: pair.revision,
    runtime: pair.runtime,
    observation,
  });
}

export default {
  parsePackageSeaReceipt,
  verifyPackageSeaArtifactHandoff,
};
