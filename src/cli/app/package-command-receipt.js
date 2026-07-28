import path from 'node:path';

import {
  assertApplicationRevisionId,
  validateApplicationRevision,
  validateSha256Digest,
} from '../../core/runtime/application-revision.js';
import {
  assertArtifactId,
  validateArtifactRecordObservation,
} from '../../core/runtime/artifact-record.js';
import {
  getBuildTargetId,
  validateBuildTarget,
} from '../../core/runtime/build-target.js';
import { cloneJsonObject } from '../../core/runtime/json-value.js';
import { assertLogicalId } from '../../core/runtime/logical-id.js';

import { getPackageArtifactFileName } from './package-artifact-file-name.js';

export const APPLICATION_PACKAGE_RECEIPT_SCHEMA_VERSION = 1;
export const APPLICATION_PACKAGE_RECEIPT_KIND = 'wharfie.application.package';

const PACKAGE_RESULT_KEYS = Object.freeze([
  'app',
  'revision',
  'targets',
  'outputDir',
  'artifacts',
]);
const PACKAGE_APP_KEYS = Object.freeze(['id']);
const PACKAGE_ARTIFACT_KEYS = Object.freeze([
  'fileName',
  'path',
  'recordPath',
  'target',
  'artifactId',
  'revisionId',
  'byteDigest',
  'size',
  'record',
]);

/**
 * Require one exact record shape after the JSON boundary has removed
 * accessors, symbols, sparse arrays, and other non-data values.
 * @param {Record<string, any>} value - Candidate record.
 * @param {any} keys - Frozen array of exact supported keys.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertExactKeys(value, keys, valuePath) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((/** @type {string} */ key) => !Object.hasOwn(value, key))
  ) {
    throw new TypeError(
      `${valuePath} must contain exactly ${keys.join(', ')}.`,
    );
  }
}

/**
 * @param {unknown} value - Candidate string.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {string} - Validated path string.
 */
function validateUsablePathString(value, valuePath) {
  const isWellFormed = /** @type {any} */ (String.prototype).isWellFormed;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    (typeof isWellFormed === 'function' && !isWellFormed.call(value))
  ) {
    throw new TypeError(`${valuePath} must be a usable nonempty path string.`);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate output directory.
 * @returns {string} - Exact normalized absolute directory.
 */
function validateOutputDirectory(value) {
  const outputDir = validateUsablePathString(value, 'packageResult.outputDir');
  if (!path.isAbsolute(outputDir) || path.resolve(outputDir) !== outputDir) {
    throw new TypeError(
      'packageResult.outputDir must be one normalized absolute path.',
    );
  }
  return outputDir;
}

/**
 * Recursively freeze one newly projected JSON document.
 * @param {any} value - JSON value.
 * @returns {any} - The same recursively frozen value.
 */
function freezeJsonDocument(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJsonDocument(child);
  return Object.freeze(value);
}

/**
 * Project the rich internal packaging result into the stable public handoff
 * document. This projection relies on `packageLocalApp()` having already bound
 * the published bytes and canonical sidecar record to the owning logical
 * revision; it does not inspect embedded executable metadata and is not a new
 * artifact authority. Receipt paths are local conveniences for the process
 * that just published the files.
 * @param {unknown} raw - Successful `packageLocalApp()` result.
 * @returns {Readonly<{
 *   schemaVersion: 1,
 *   kind: 'wharfie.application.package',
 *   appId: string,
 *   revisionId: string,
 *   outputDir: string,
 *   artifactCount: number,
 *   artifacts: Array<{
 *     artifactId: string,
 *     target: import('../../core/runtime/build-target.js').BuildTarget,
 *     fileName: string,
 *     path: string,
 *     recordPath: string,
 *     byteDigest: import('../../core/runtime/application-revision.js').Sha256Digest,
 *     size: number
 *   }>
 * }>} - Exact recursively frozen package receipt.
 */
export function createApplicationPackageReceipt(raw) {
  const result = cloneJsonObject(raw, 'packageResult');
  assertExactKeys(result, PACKAGE_RESULT_KEYS, 'packageResult');

  const app = cloneJsonObject(result.app, 'packageResult.app');
  assertExactKeys(app, PACKAGE_APP_KEYS, 'packageResult.app');
  assertLogicalId(app.id, 'packageResult.app.id');

  const revision = validateApplicationRevision(
    result.revision,
    'packageResult.revision',
  );
  if (revision.contract.app.id !== app.id) {
    throw new Error(
      'packageResult.app.id must match the packaged application revision.',
    );
  }

  const outputDir = validateOutputDirectory(result.outputDir);

  if (!Array.isArray(result.targets) || result.targets.length === 0) {
    throw new TypeError(
      'packageResult.targets must be a nonempty array of exact build targets.',
    );
  }
  const targetIds = new Set();
  for (let index = 0; index < result.targets.length; index += 1) {
    const target = validateBuildTarget(
      result.targets[index],
      `packageResult.targets[${index}]`,
    );
    const targetId = getBuildTargetId(
      target,
      `packageResult.targets[${index}]`,
    );
    if (targetIds.has(targetId)) {
      throw new TypeError(
        'packageResult.targets must contain unique exact build targets.',
      );
    }
    targetIds.add(targetId);
  }

  if (!Array.isArray(result.artifacts) || result.artifacts.length === 0) {
    throw new TypeError(
      'packageResult.artifacts must be a nonempty array of packaged artifacts.',
    );
  }

  const artifactIds = new Set();
  const artifactTargetIds = new Set();
  const fileNames = new Set();
  /** @type {Array<{targetId: string, receipt: Record<string, any>}>} */
  const projected = [];

  for (let index = 0; index < result.artifacts.length; index += 1) {
    const valuePath = `packageResult.artifacts[${index}]`;
    const artifact = cloneJsonObject(result.artifacts[index], valuePath);
    assertExactKeys(artifact, PACKAGE_ARTIFACT_KEYS, valuePath);

    const target = validateBuildTarget(artifact.target, `${valuePath}.target`);
    const targetId = getBuildTargetId(target, `${valuePath}.target`);
    if (artifactTargetIds.has(targetId)) {
      throw new TypeError(
        'packageResult.artifacts must contain one artifact per exact target.',
      );
    }
    artifactTargetIds.add(targetId);

    assertArtifactId(artifact.artifactId, `${valuePath}.artifactId`);
    if (artifactIds.has(artifact.artifactId)) {
      throw new TypeError(
        'packageResult.artifacts must contain unique artifact identities.',
      );
    }
    artifactIds.add(artifact.artifactId);

    assertApplicationRevisionId(artifact.revisionId, `${valuePath}.revisionId`);
    if (artifact.revisionId !== revision.revisionId) {
      throw new Error(
        'Every packaged artifact must belong to the packaged application revision.',
      );
    }

    const byteDigest = validateSha256Digest(
      artifact.byteDigest,
      `${valuePath}.byteDigest`,
    );
    if (!Number.isSafeInteger(artifact.size) || artifact.size < 0) {
      throw new TypeError(
        `${valuePath}.size must be a nonnegative safe integer.`,
      );
    }

    const record = validateArtifactRecordObservation(
      artifact.record,
      {
        observation: {
          artifactId: artifact.artifactId,
          byteDigest,
          size: artifact.size,
        },
        revision,
      },
      `${valuePath}.record`,
    );
    if (
      getBuildTargetId(record.target, `${valuePath}.record.target`) !== targetId
    ) {
      throw new Error(
        'Each packaged artifact summary must match its immutable artifact record.',
      );
    }

    validateUsablePathString(artifact.fileName, `${valuePath}.fileName`);
    const expectedFileName = getPackageArtifactFileName({
      appId: app.id,
      target,
      byteDigest,
    });
    if (artifact.fileName !== expectedFileName) {
      throw new Error(
        'Each packaged artifact must use its canonical content-addressed file name.',
      );
    }
    if (fileNames.has(artifact.fileName)) {
      throw new TypeError(
        'packageResult.artifacts must contain unique artifact file names.',
      );
    }
    fileNames.add(artifact.fileName);

    validateUsablePathString(artifact.path, `${valuePath}.path`);
    validateUsablePathString(artifact.recordPath, `${valuePath}.recordPath`);
    const expectedPath = path.join(outputDir, artifact.fileName);
    if (
      artifact.path !== expectedPath ||
      artifact.recordPath !== `${expectedPath}.artifact.json`
    ) {
      throw new Error(
        'Each packaged artifact path and record path must be direct children of packageResult.outputDir.',
      );
    }

    projected.push({
      targetId,
      receipt: {
        artifactId: artifact.artifactId,
        target,
        fileName: artifact.fileName,
        path: artifact.path,
        recordPath: artifact.recordPath,
        byteDigest,
        size: artifact.size,
      },
    });
  }

  if (
    targetIds.size !== artifactTargetIds.size ||
    [...targetIds].some((targetId) => !artifactTargetIds.has(targetId))
  ) {
    throw new Error(
      'packageResult.targets must exactly match the packaged artifact targets.',
    );
  }

  projected.sort((left, right) =>
    left.targetId < right.targetId
      ? -1
      : left.targetId > right.targetId
        ? 1
        : 0,
  );

  return freezeJsonDocument({
    schemaVersion: APPLICATION_PACKAGE_RECEIPT_SCHEMA_VERSION,
    kind: APPLICATION_PACKAGE_RECEIPT_KIND,
    appId: app.id,
    revisionId: revision.revisionId,
    outputDir,
    artifactCount: projected.length,
    artifacts: projected.map(({ receipt }) => receipt),
  });
}

export default {
  APPLICATION_PACKAGE_RECEIPT_KIND,
  APPLICATION_PACKAGE_RECEIPT_SCHEMA_VERSION,
  createApplicationPackageReceipt,
};
