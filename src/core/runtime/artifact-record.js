/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import semver from 'semver';

import {
  assertApplicationRevisionId,
  validateApplicationRevision,
  validateSha256Digest,
} from './application-revision.js';
import { getBuildTargetId, validateBuildTarget } from './build-target.js';
import {
  assertDomainSeparatedSha256Id,
  createSha256Id,
  sha256Base64Url,
} from './content-id.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const ARTIFACT_RECORD_SCHEMA_VERSION = 1;
export const ARTIFACT_RECORD_KIND = 'artifactRecord';
export const ARTIFACT_ID_PREFIX = 'waf1';
export const ARTIFACT_FORMAT = Object.freeze({ kind: 'node-sea', version: 1 });
export const ARTIFACT_PROVENANCE_SCHEMA_VERSION = 1;

const ARTIFACT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'artifactId',
  'byteDigest',
  'size',
  'appId',
  'revisionId',
  'target',
  'targetId',
  'format',
  'provenance',
]);
const FORMAT_KEYS = new Set(['kind', 'version']);
const PROVENANCE_KEYS = new Set([
  'schemaVersion',
  'builder',
  'node',
  'dependencies',
  'signing',
]);
const BUILDER_KEYS = new Set([
  'name',
  'version',
  'runtimeDigest',
  'toolchainDigest',
]);
const NODE_KEYS = new Set(['version', 'archive', 'binary']);
const NODE_ARCHIVE_KEYS = new Set(['fileName', 'digest']);
const NODE_BINARY_KEYS = new Set(['digest']);
const DEPENDENCIES_KEYS = new Set(['digest']);
const UNSIGNED_SIGNING_KEYS = new Set(['mode']);
const IDENTITY_SIGNING_KEYS = new Set(['mode', 'signer']);

/**
 * @typedef ArtifactProvenance
 * @property {1} schemaVersion - Provenance schema version.
 * @property {{ name: string, version: string, runtimeDigest: import('./application-revision.js').Sha256Digest, toolchainDigest: import('./application-revision.js').Sha256Digest }} builder - Builder identity and immutable inputs.
 * @property {{ version: string, archive?: { fileName: string, digest: import('./application-revision.js').Sha256Digest }, binary: { digest: import('./application-revision.js').Sha256Digest } }} node - Verified Node binary and optional official archive provenance.
 * @property {{ digest: import('./application-revision.js').Sha256Digest }} dependencies - Target-specific installed dependency closure.
 * @property {{ mode: 'unsigned'|'ad-hoc' } | { mode: 'identity', signer: string }} signing - Non-secret signing assertion.
 */

/**
 * @typedef ArtifactRecord
 * @property {1} schemaVersion - Artifact record schema version.
 * @property {'artifactRecord'} kind - Document kind.
 * @property {string} artifactId - Final-byte `waf1_` identity.
 * @property {import('./application-revision.js').Sha256Digest} byteDigest - Explicit final-byte digest.
 * @property {number} size - Final byte length.
 * @property {string} appId - Owning application logical ID.
 * @property {string} revisionId - Owning immutable revision.
 * @property {import('./build-target.js').BuildTarget} target - Exact artifact target.
 * @property {string} targetId - Recomputed canonical target identity.
 * @property {{ kind: 'node-sea', version: 1 }} format - Executable format.
 * @property {ArtifactProvenance} provenance - Strict immutable provenance.
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
 * Deeply freeze one independently validated JSON record.
 * @param {any} value - JSON record.
 * @returns {any} - The same frozen record.
 */
function freezeJsonSnapshot(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJsonSnapshot(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value - Candidate canonical string.
 * @param {string} valuePath - Human-readable value path.
 * @returns {asserts value is string}
 */
function assertNonemptyCanonicalString(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw new TypeError(`${valuePath} must be a nonempty canonical string.`);
  }
}

/**
 * @param {unknown} value - Candidate exact semantic version.
 * @param {string} valuePath - Human-readable value path.
 * @returns {asserts value is string}
 */
function assertExactSemver(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    semver.valid(value) !== value
  ) {
    throw new TypeError(
      `${valuePath} must be an exact canonical semantic version.`,
    );
  }
}

/**
 * @param {unknown} value - Candidate official archive filename.
 * @param {string} valuePath - Human-readable value path.
 * @returns {asserts value is string}
 */
function assertArchiveFileName(value, valuePath) {
  assertNonemptyCanonicalString(value, valuePath);
  if (
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new TypeError(`${valuePath} must be a file name without a path.`);
  }
}

/**
 * Preserve exact artifact bytes without accepting strings or coercible values.
 * @param {unknown} value - Candidate bytes.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Buffer} - Exact byte view.
 */
function getArtifactBytes(value, valuePath) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new TypeError(
    `${valuePath} must be a Buffer, Uint8Array, or ArrayBuffer of exact artifact bytes.`,
  );
}

/**
 * Validate the fixed Node SEA artifact format marker.
 * @param {unknown} value - Candidate format.
 * @param {string} valuePath - Human-readable value path.
 * @returns {{ kind: 'node-sea', version: 1 }} - Validated format.
 */
function validateArtifactFormat(value, valuePath) {
  const format = cloneJsonObject(value, valuePath);
  assertExactKeys(format, FORMAT_KEYS, valuePath);
  if (format.kind !== ARTIFACT_FORMAT.kind) {
    throw new TypeError(`${valuePath}.kind must be '${ARTIFACT_FORMAT.kind}'.`);
  }
  if (format.version !== ARTIFACT_FORMAT.version) {
    throw new TypeError(
      `${valuePath}.version must be the integer ${ARTIFACT_FORMAT.version}.`,
    );
  }
  return /** @type {{ kind: 'node-sea', version: 1 }} */ (format);
}

/**
 * Validate a strict non-secret signing assertion.
 * @param {unknown} value - Candidate signing provenance.
 * @param {string} valuePath - Human-readable value path.
 * @returns {ArtifactProvenance['signing']} - Validated signing provenance.
 */
function validateSigningProvenance(value, valuePath) {
  const signing = cloneJsonObject(value, valuePath);
  if (signing.mode === 'unsigned' || signing.mode === 'ad-hoc') {
    assertExactKeys(signing, UNSIGNED_SIGNING_KEYS, valuePath);
    return /** @type {ArtifactProvenance['signing']} */ (signing);
  }
  if (signing.mode === 'identity') {
    assertExactKeys(signing, IDENTITY_SIGNING_KEYS, valuePath);
    assertNonemptyCanonicalString(signing.signer, `${valuePath}.signer`);
    return {
      mode: 'identity',
      signer: signing.signer,
    };
  }
  throw new TypeError(
    `${valuePath}.mode must be 'unsigned', 'ad-hoc', or 'identity'.`,
  );
}

/**
 * Validate complete artifact provenance and cross-check its runtime target.
 * @param {unknown} value - Candidate provenance.
 * @param {import('./build-target.js').BuildTarget} target - Artifact target.
 * @param {import('./application-revision.js').ApplicationRevision} revision - Owning revision.
 * @param {string} valuePath - Human-readable value path.
 * @returns {ArtifactProvenance} - Validated independent provenance.
 */
export function validateArtifactProvenance(
  value,
  target,
  revision,
  valuePath = 'provenance',
) {
  const provenance = cloneJsonObject(value, valuePath);
  assertExactKeys(provenance, PROVENANCE_KEYS, valuePath);
  if (provenance.schemaVersion !== ARTIFACT_PROVENANCE_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${ARTIFACT_PROVENANCE_SCHEMA_VERSION}.`,
    );
  }

  const builder = cloneJsonObject(provenance.builder, `${valuePath}.builder`);
  assertExactKeys(builder, BUILDER_KEYS, `${valuePath}.builder`);
  assertNonemptyCanonicalString(builder.name, `${valuePath}.builder.name`);
  assertExactSemver(builder.version, `${valuePath}.builder.version`);
  const runtimeDigest = validateSha256Digest(
    builder.runtimeDigest,
    `${valuePath}.builder.runtimeDigest`,
  );
  const toolchainDigest = validateSha256Digest(
    builder.toolchainDigest,
    `${valuePath}.builder.toolchainDigest`,
  );
  if (
    runtimeDigest.algorithm !== revision.inputs.runtime.digest.algorithm ||
    runtimeDigest.value !== revision.inputs.runtime.digest.value
  ) {
    throw new Error(
      `${valuePath}.builder.runtimeDigest must match the owning revision runtime digest.`,
    );
  }

  const node = cloneJsonObject(provenance.node, `${valuePath}.node`);
  assertExactKeys(node, NODE_KEYS, `${valuePath}.node`);
  assertExactSemver(node.version, `${valuePath}.node.version`);
  if (node.version !== target.nodeVersion) {
    throw new Error(`${valuePath}.node.version must equal target.nodeVersion.`);
  }
  const binary = cloneJsonObject(node.binary, `${valuePath}.node.binary`);
  assertExactKeys(binary, NODE_BINARY_KEYS, `${valuePath}.node.binary`);

  let archive;
  if (Object.prototype.hasOwnProperty.call(node, 'archive')) {
    archive = cloneJsonObject(node.archive, `${valuePath}.node.archive`);
    assertExactKeys(archive, NODE_ARCHIVE_KEYS, `${valuePath}.node.archive`);
    assertArchiveFileName(
      archive.fileName,
      `${valuePath}.node.archive.fileName`,
    );
  }

  const dependencies = cloneJsonObject(
    provenance.dependencies,
    `${valuePath}.dependencies`,
  );
  assertExactKeys(dependencies, DEPENDENCIES_KEYS, `${valuePath}.dependencies`);

  return {
    schemaVersion: ARTIFACT_PROVENANCE_SCHEMA_VERSION,
    builder: {
      name: builder.name,
      version: builder.version,
      runtimeDigest,
      toolchainDigest,
    },
    node: {
      version: node.version,
      ...(archive
        ? {
            archive: {
              fileName: archive.fileName,
              digest: validateSha256Digest(
                archive.digest,
                `${valuePath}.node.archive.digest`,
              ),
            },
          }
        : {}),
      binary: {
        digest: validateSha256Digest(
          binary.digest,
          `${valuePath}.node.binary.digest`,
        ),
      },
    },
    dependencies: {
      digest: validateSha256Digest(
        dependencies.digest,
        `${valuePath}.dependencies.digest`,
      ),
    },
    signing: validateSigningProvenance(
      provenance.signing,
      `${valuePath}.signing`,
    ),
  };
}

/**
 * Assert the public textual identity form for ArtifactRecordV1 bytes.
 * @param {unknown} value - Candidate artifact identity.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {asserts value is string}
 */
export function assertArtifactId(value, valuePath = 'artifactId') {
  assertDomainSeparatedSha256Id(value, ARTIFACT_ID_PREFIX, valuePath);
}

/**
 * Build the normalized record shared by creation and validation.
 * @param {{ bytes: unknown, revision: unknown, target: unknown, provenance: unknown }} value - Artifact inputs.
 * @param {string} valuePath - Human-readable value path.
 * @returns {ArtifactRecord} - Normalized artifact record.
 */
function createNormalizedArtifactRecord(value, valuePath) {
  const bytes = getArtifactBytes(value.bytes, `${valuePath}.bytes`);
  const revision = validateApplicationRevision(
    value.revision,
    `${valuePath}.revision`,
  );
  const target = validateBuildTarget(value.target, `${valuePath}.target`);
  const targetId = getBuildTargetId(target, `${valuePath}.target`);
  const digestValue = sha256Base64Url(bytes, `${valuePath}.bytes`);
  const provenance = validateArtifactProvenance(
    value.provenance,
    target,
    revision,
    `${valuePath}.provenance`,
  );

  return {
    schemaVersion: ARTIFACT_RECORD_SCHEMA_VERSION,
    kind: ARTIFACT_RECORD_KIND,
    artifactId: createSha256Id({
      prefix: ARTIFACT_ID_PREFIX,
      payload: bytes,
    }),
    byteDigest: { algorithm: 'sha256', value: digestValue },
    size: bytes.byteLength,
    appId: revision.contract.app.id,
    revisionId: revision.revisionId,
    target,
    targetId,
    format: { ...ARTIFACT_FORMAT },
    provenance,
  };
}

/**
 * Create an immutable record for exact final artifact bytes.
 * @param {{ bytes: unknown, revision: unknown, target: unknown, provenance: unknown }} value - Artifact inputs.
 * @returns {ArtifactRecord} - Validated independent artifact record.
 */
export function createArtifactRecord(value) {
  return freezeJsonSnapshot(createNormalizedArtifactRecord(value, 'artifact'));
}

/**
 * Validate an ArtifactRecordV1 against exact final bytes and its owning
 * ApplicationRevisionV1, recomputing every derived identity.
 * @param {unknown} value - Candidate artifact record.
 * @param {{ bytes: unknown, revision: unknown }} context - Trusted validation context.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {ArtifactRecord} - Validated independent artifact record.
 */
export function validateArtifactRecord(value, context, valuePath = 'artifact') {
  const record = cloneJsonObject(value, valuePath);
  assertExactKeys(record, ARTIFACT_KEYS, valuePath);
  if (record.schemaVersion !== ARTIFACT_RECORD_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${ARTIFACT_RECORD_SCHEMA_VERSION}.`,
    );
  }
  if (record.kind !== ARTIFACT_RECORD_KIND) {
    throw new TypeError(`${valuePath}.kind must be '${ARTIFACT_RECORD_KIND}'.`);
  }
  assertArtifactId(record.artifactId, `${valuePath}.artifactId`);
  assertApplicationRevisionId(record.revisionId, `${valuePath}.revisionId`);
  assertLogicalId(record.appId, `${valuePath}.appId`);
  validateSha256Digest(record.byteDigest, `${valuePath}.byteDigest`);
  if (!Number.isSafeInteger(record.size) || record.size < 0) {
    throw new TypeError(
      `${valuePath}.size must be a nonnegative safe integer.`,
    );
  }

  const target = validateBuildTarget(record.target, `${valuePath}.target`);
  const expectedTargetId = getBuildTargetId(target, `${valuePath}.target`);
  if (record.targetId !== expectedTargetId) {
    throw new Error(
      `${valuePath}.targetId does not match the canonical target.`,
    );
  }
  validateArtifactFormat(record.format, `${valuePath}.format`);

  const expected = createNormalizedArtifactRecord(
    {
      bytes: context?.bytes,
      revision: context?.revision,
      target,
      provenance: record.provenance,
    },
    valuePath,
  );
  const recordFields = /** @type {Record<string, any>} */ (record);
  const expectedFields = /** @type {Record<string, any>} */ (expected);

  for (const key of ['artifactId', 'size', 'appId', 'revisionId', 'targetId']) {
    if (recordFields[key] !== expectedFields[key]) {
      throw new Error(`${valuePath}.${key} does not match its trusted inputs.`);
    }
  }
  if (
    record.byteDigest.algorithm !== expected.byteDigest.algorithm ||
    record.byteDigest.value !== expected.byteDigest.value
  ) {
    throw new Error(
      `${valuePath}.byteDigest does not match the exact artifact bytes.`,
    );
  }

  return freezeJsonSnapshot(expected);
}

export default {
  ARTIFACT_FORMAT,
  ARTIFACT_ID_PREFIX,
  ARTIFACT_PROVENANCE_SCHEMA_VERSION,
  ARTIFACT_RECORD_KIND,
  ARTIFACT_RECORD_SCHEMA_VERSION,
  assertArtifactId,
  createArtifactRecord,
  validateArtifactProvenance,
  validateArtifactRecord,
};
