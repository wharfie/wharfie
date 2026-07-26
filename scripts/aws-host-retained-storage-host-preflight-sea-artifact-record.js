/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This specialized byte-evidence boundary keeps its compact immutable schemas beside their strict decoders. */

import { createHash } from 'node:crypto';

import { validateSha256Digest } from '../src/core/runtime/application-revision.js';
import {
  getBuildTargetId,
  validateBuildTarget,
} from '../src/core/runtime/build-target.js';
import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../src/core/runtime/content-id.js';
import { cloneBoundedJsonObject } from '../src/core/runtime/json-value.js';
import { assertManifestIsSecretFree } from '../src/core/runtime/manifest-security.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  validateAwsRetainedStorageHostPreflightSeaDeliveryManifest,
} from './aws-host-retained-storage-host-preflight-sea-delivery.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_ARCHIVE_FORMAT,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ARCHIVE_BYTES,
} from './aws-host-retained-storage-host-preflight-sea-source.js';

export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_SCHEMA_VERSION = 1;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_KIND =
  'awsSingleNodeRetainedStorageHostPreflightSeaArtifactRecord';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_DOMAIN =
  'wharfie:aws-single-node:retained-storage-host-preflight-sea-artifact-record:v1';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_PREFIX =
  'whp1';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_MAX_BYTES =
  64 * 1024;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT =
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_ARCHIVE_FORMAT;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ENTRY_BUNDLE_FORMAT =
  'esbuild-snapshot-node24-cjs-v1';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_RUNTIME_BUNDLE_FORMAT =
  'sea-build-esbuild-node24-cjs-v1';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_BLOB_FORMAT =
  'node-sea-blob-v1';

const ARTIFACT_ID_PREFIX = 'waf1';
const ARTIFACT_FORMAT = Object.freeze({ kind: 'node-sea', version: 1 });
const GENERATION_MAX_BYTES = 256 * 1024;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const INPUT_KEYS = new Set([
  'delivery',
  'sourceArchive',
  'bundleBytes',
  'artifactBytes',
  'generation',
]);
const VALIDATOR_CONTEXT_KEYS = new Set([
  'bundleBytes',
  'artifactBytes',
  'generation',
]);
const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'delivery',
  'sourceArchive',
  'entryBundle',
  'runtimeBundle',
  'seaBlob',
  'manifestAsset',
  'artifactId',
  'byteDigest',
  'size',
  'format',
  'target',
  'targetId',
  'node',
  'signing',
]);
const DOCUMENT_KEYS = new Set(['recordId', ...PAYLOAD_KEYS]);
const BYTE_EVIDENCE_KEYS = new Set(['byteDigest', 'size']);
const FORMATTED_BYTE_EVIDENCE_KEYS = new Set(['format', 'byteDigest', 'size']);
const MANIFEST_ASSET_KEYS = new Set(['name', 'byteDigest', 'size']);
const FORMAT_KEYS = new Set(['kind', 'version']);
const NODE_KEYS = new Set(['version', 'archive', 'sourceBinary']);
const NODE_ARCHIVE_KEYS = new Set(['fileName', 'byteDigest']);
const SIGNING_KEYS = new Set(['mode']);
const GENERATION_KEYS = new Set([
  'binaryPath',
  'binaryDigest',
  'entryCode',
  'codeBundle',
  'seaBlob',
  'nodeSource',
  'assets',
  'functionAssets',
  'coreRuntimeDependencies',
  'signing',
]);
const GENERATION_BYTE_EVIDENCE_KEYS = new Set(['digest', 'size']);
const GENERATION_NODE_SOURCE_KEYS = new Set([
  'path',
  'digest',
  'size',
  'archive',
]);
const GENERATION_NODE_ARCHIVE_KEYS = new Set(['fileName', 'digest']);

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function exactObject(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value;
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

/** @param {Record<string, any>} value @param {string} key @param {string} path @returns {any} */
function ownData(value, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${path}.${key} must be an own data property.`);
  }
  return descriptor.value;
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

/** @param {unknown} value @param {number} maximum @param {string} path @returns {Buffer} */
function snapshotBytes(value, maximum, path) {
  let byteLength;
  if (
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  ) {
    byteLength = value.byteLength;
  } else {
    throw new TypeError(
      `${path} must be a Buffer, Uint8Array, or ArrayBuffer.`,
    );
  }
  if (byteLength < 1 || byteLength > maximum) {
    throw new TypeError(`${path} must contain between 1 and ${maximum} bytes.`);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value.slice(0));
  return Buffer.from(value);
}

/** @param {Buffer} bytes @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function digestBytes(bytes) {
  return Object.freeze({
    algorithm: /** @type {'sha256'} */ ('sha256'),
    value: createHash('sha256').update(bytes).digest('base64url'),
  });
}

/** @param {Buffer} bytes @returns {Readonly<{byteDigest: Readonly<{algorithm: 'sha256', value: string}>, size: number}>} */
function observeBytes(bytes) {
  return deepFreeze({ byteDigest: digestBytes(bytes), size: bytes.length });
}

/** @param {unknown} value @param {string} path @param {boolean} positive @returns {number} */
function validateSize(value, path, positive = true) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0)
  ) {
    throw new TypeError(
      `${path} must be a ${positive ? 'positive' : 'nonnegative'} safe integer.`,
    );
  }
  return /** @type {number} */ (value);
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateByteEvidence(value, path) {
  const input = exactObject(value, path);
  assertExactKeys(input, BYTE_EVIDENCE_KEYS, path);
  return deepFreeze({
    byteDigest: validateSha256Digest(input.byteDigest, `${path}.byteDigest`),
    size: validateSize(input.size, `${path}.size`),
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateSourceArchive(value) {
  const path = 'AWS retained-storage host preflight SEA artifact sourceArchive';
  const input = cloneBoundedJsonObject(
    value,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_MAX_BYTES,
    path,
  );
  assertExactKeys(input, FORMATTED_BYTE_EVIDENCE_KEYS, path);
  if (
    input.format !== AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight source archive format is invalid.',
    );
  }
  const evidence = validateByteEvidence(
    { byteDigest: input.byteDigest, size: input.size },
    path,
  );
  if (
    evidence.size >
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ARCHIVE_BYTES
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight source archive exceeds its byte limit.',
    );
  }
  return deepFreeze({
    format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT,
    ...evidence,
  });
}

/** @param {unknown} value @param {string} expectedFormat @param {string} path @returns {Readonly<Record<string, any>>} */
function validateFormattedByteEvidence(value, expectedFormat, path) {
  const input = exactObject(value, path);
  assertExactKeys(input, FORMATTED_BYTE_EVIDENCE_KEYS, path);
  if (input.format !== expectedFormat) {
    throw new TypeError(`${path} format is invalid.`);
  }
  const evidence = validateByteEvidence(
    { byteDigest: input.byteDigest, size: input.size },
    path,
  );
  return deepFreeze({
    format: expectedFormat,
    ...evidence,
  });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateGenerationByteEvidence(value, path) {
  const input = exactObject(value, path);
  assertExactKeys(input, GENERATION_BYTE_EVIDENCE_KEYS, path);
  return deepFreeze({
    byteDigest: validateSha256Digest(input.digest, `${path}.digest`),
    size: validateSize(input.size, `${path}.size`),
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} delivery @returns {Readonly<Record<string, any>>} */
function validateManifestAsset(value, delivery) {
  const path = 'AWS retained-storage host preflight SEA artifact manifestAsset';
  const input = exactObject(value, path);
  assertExactKeys(input, MANIFEST_ASSET_KEYS, path);
  const expectedBytes = Buffer.from(
    stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
    'utf8',
  );
  const expected = observeBytes(expectedBytes);
  const actual = validateByteEvidence(
    { byteDigest: input.byteDigest, size: input.size },
    path,
  );
  if (
    input.name !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME ||
    !sameJson(actual, expected)
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA manifest asset is inconsistent.',
    );
  }
  return deepFreeze({
    name: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
    ...expected,
  });
}

/** @param {unknown} value @returns {Readonly<{kind: 'node-sea', version: 1}>} */
function validateArtifactFormat(value) {
  const path = 'AWS retained-storage host preflight SEA artifact format';
  const input = exactObject(value, path);
  assertExactKeys(input, FORMAT_KEYS, path);
  if (
    input.kind !== ARTIFACT_FORMAT.kind ||
    input.version !== ARTIFACT_FORMAT.version
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA artifact format is invalid.',
    );
  }
  return ARTIFACT_FORMAT;
}

/** @param {Readonly<Record<string, any>>} target @returns {string} */
function expectedNodeArchiveFileName(target) {
  return `node-v${target.nodeVersion}-${target.platform}-${target.architecture}.tar.gz`;
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} target @returns {Readonly<Record<string, any>>} */
function validateNodeEvidence(value, target) {
  const path = 'AWS retained-storage host preflight SEA artifact node';
  const input = exactObject(value, path);
  assertExactKeys(input, NODE_KEYS, path);
  if (input.version !== target.nodeVersion) {
    throw new TypeError(
      'AWS retained-storage host preflight Node version does not match its target.',
    );
  }
  const archive = exactObject(input.archive, `${path}.archive`);
  assertExactKeys(archive, NODE_ARCHIVE_KEYS, `${path}.archive`);
  if (archive.fileName !== expectedNodeArchiveFileName(target)) {
    throw new TypeError(
      'AWS retained-storage host preflight Node archive does not match its target.',
    );
  }
  const sourceBinary = validateByteEvidence(
    input.sourceBinary,
    `${path}.sourceBinary`,
  );
  return deepFreeze({
    version: target.nodeVersion,
    archive: {
      fileName: archive.fileName,
      byteDigest: validateSha256Digest(
        archive.byteDigest,
        `${path}.archive.byteDigest`,
      ),
    },
    sourceBinary,
  });
}

/** @param {unknown} value @returns {Readonly<{mode: 'unsigned'}>} */
function validateSigning(value) {
  const path = 'AWS retained-storage host preflight SEA artifact signing';
  const input = exactObject(value, path);
  assertExactKeys(input, SIGNING_KEYS, path);
  if (input.mode !== 'unsigned') {
    throw new TypeError(
      'AWS retained-storage host preflight SEA artifact must be unsigned.',
    );
  }
  return Object.freeze({ mode: /** @type {'unsigned'} */ ('unsigned') });
}

/**
 * Validate the exact same-generation evidence committed by SeaBuild. Mutable
 * local paths are checked structurally but deliberately excluded from output.
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} delivery
 * @param {Readonly<Record<string, any>>} entryBundle
 * @param {Readonly<Record<string, any>>} artifactObservation
 * @returns {Readonly<Record<string, any>>}
 */
function validateGeneration(value, delivery, entryBundle, artifactObservation) {
  const path =
    'AWS retained-storage host preflight SEA successful build generation';
  const input = cloneBoundedJsonObject(value, GENERATION_MAX_BYTES, path);
  assertExactKeys(input, GENERATION_KEYS, path);
  if (
    typeof input.binaryPath !== 'string' ||
    input.binaryPath.length === 0 ||
    input.binaryPath.trim() !== input.binaryPath
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA generation binaryPath is invalid.',
    );
  }
  const binaryDigest = validateSha256Digest(
    input.binaryDigest,
    `${path}.binaryDigest`,
  );
  if (!sameJson(binaryDigest, artifactObservation.byteDigest)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bytes do not match their successful build generation.',
    );
  }

  const entryCode = validateGenerationByteEvidence(
    input.entryCode,
    `${path}.entryCode`,
  );
  if (
    !sameJson(entryCode.byteDigest, entryBundle.byteDigest) ||
    entryCode.size !== entryBundle.size
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight entry bundle does not match its successful build generation.',
    );
  }
  const codeBundle = validateGenerationByteEvidence(
    input.codeBundle,
    `${path}.codeBundle`,
  );
  const runtimeBundle = deepFreeze({
    format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_RUNTIME_BUNDLE_FORMAT,
    byteDigest: codeBundle.byteDigest,
    size: codeBundle.size,
  });
  const seaBlobEvidence = validateGenerationByteEvidence(
    input.seaBlob,
    `${path}.seaBlob`,
  );
  const seaBlob = deepFreeze({
    format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_BLOB_FORMAT,
    byteDigest: seaBlobEvidence.byteDigest,
    size: seaBlobEvidence.size,
  });

  const manifestBytes = Buffer.from(
    stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
    'utf8',
  );
  const manifestDigest = digestBytes(manifestBytes);
  const assets = exactObject(input.assets, `${path}.assets`);
  assertExactKeys(
    assets,
    new Set([AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME]),
    `${path}.assets`,
  );
  const generationManifestDigest = validateSha256Digest(
    assets[AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME],
    `${path}.assets.delivery`,
  );
  if (!sameJson(generationManifestDigest, manifestDigest)) {
    throw new TypeError(
      'AWS retained-storage host preflight delivery asset does not match its successful build generation.',
    );
  }

  const functionAssets = exactObject(
    input.functionAssets,
    `${path}.functionAssets`,
  );
  assertExactKeys(functionAssets, new Set(), `${path}.functionAssets`);
  if (input.coreRuntimeDependencies !== null) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA must not contain core runtime dependencies.',
    );
  }
  validateSigning(input.signing);

  const nodeSource = exactObject(input.nodeSource, `${path}.nodeSource`);
  assertExactKeys(
    nodeSource,
    GENERATION_NODE_SOURCE_KEYS,
    `${path}.nodeSource`,
  );
  if (
    typeof nodeSource.path !== 'string' ||
    nodeSource.path.length === 0 ||
    nodeSource.path.trim() !== nodeSource.path
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight Node source path is invalid.',
    );
  }
  const sourceBinary = deepFreeze({
    byteDigest: validateSha256Digest(
      nodeSource.digest,
      `${path}.nodeSource.digest`,
    ),
    size: validateSize(nodeSource.size, `${path}.nodeSource.size`),
  });
  const archive = exactObject(nodeSource.archive, `${path}.nodeSource.archive`);
  assertExactKeys(
    archive,
    GENERATION_NODE_ARCHIVE_KEYS,
    `${path}.nodeSource.archive`,
  );
  if (archive.fileName !== expectedNodeArchiveFileName(delivery.target)) {
    throw new TypeError(
      'AWS retained-storage host preflight official Node archive does not match its target.',
    );
  }
  const node = validateNodeEvidence(
    {
      version: delivery.target.nodeVersion,
      archive: {
        fileName: archive.fileName,
        byteDigest: validateSha256Digest(
          archive.digest,
          `${path}.nodeSource.archive.digest`,
        ),
      },
      sourceBinary,
    },
    delivery.target,
  );
  return deepFreeze({ node, manifestDigest, runtimeBundle, seaBlob });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validatePayload(value) {
  const path = 'AWS retained-storage host preflight SEA artifact record';
  const input = exactObject(value, path);
  assertExactKeys(input, PAYLOAD_KEYS, path);
  if (
    input.schemaVersion !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_SCHEMA_VERSION ||
    input.kind !== AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_KIND
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA artifact record header is invalid.',
    );
  }
  const delivery = validateAwsRetainedStorageHostPreflightSeaDeliveryManifest(
    input.delivery,
  );
  const sourceArchive = validateSourceArchive(input.sourceArchive);
  const entryBundle = validateFormattedByteEvidence(
    input.entryBundle,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ENTRY_BUNDLE_FORMAT,
    `${path}.entryBundle`,
  );
  const runtimeBundle = validateFormattedByteEvidence(
    input.runtimeBundle,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_RUNTIME_BUNDLE_FORMAT,
    `${path}.runtimeBundle`,
  );
  const seaBlob = validateFormattedByteEvidence(
    input.seaBlob,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_BLOB_FORMAT,
    `${path}.seaBlob`,
  );
  const manifestAsset = validateManifestAsset(input.manifestAsset, delivery);
  assertDomainSeparatedSha256Id(
    input.artifactId,
    ARTIFACT_ID_PREFIX,
    `${path}.artifactId`,
  );
  const byteDigest = validateSha256Digest(
    input.byteDigest,
    `${path}.byteDigest`,
  );
  if (input.artifactId !== `${ARTIFACT_ID_PREFIX}_${byteDigest.value}`) {
    throw new TypeError(
      'AWS retained-storage host preflight artifact ID does not match its byte digest.',
    );
  }
  const size = validateSize(input.size, `${path}.size`);
  const format = validateArtifactFormat(input.format);
  const target = deepFreeze(
    validateBuildTarget(input.target, `${path}.target`),
  );
  if (!sameJson(target, delivery.target)) {
    throw new TypeError(
      'AWS retained-storage host preflight artifact target does not match its delivery.',
    );
  }
  const targetId = getBuildTargetId(target, `${path}.target`);
  if (input.targetId !== targetId) {
    throw new TypeError(
      'AWS retained-storage host preflight artifact target ID is invalid.',
    );
  }
  const node = validateNodeEvidence(input.node, target);
  const signing = validateSigning(input.signing);
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_SCHEMA_VERSION,
      kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_KIND,
      delivery,
      sourceArchive,
      entryBundle,
      runtimeBundle,
      seaBlob,
      manifestAsset,
      artifactId: input.artifactId,
      byteDigest,
      size,
      format,
      target,
      targetId,
      node,
      signing,
    }),
  );
  assertManifestIsSecretFree(
    payload,
    'AWS retained-storage host preflight SEA artifact record',
  );
  return payload;
}

/**
 * Create one non-circular post-build record from exact source-archive,
 * snapshot entry-bundle, generated runtime-bundle, generated SEA-blob, final
 * SEA, embedded-asset, and Node generation evidence. The content digests are
 * evidence, not proof that a particular repository or compiler produced them.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsRetainedStorageHostPreflightSeaArtifactRecord(value) {
  const path = 'AWS retained-storage host preflight SEA artifact record input';
  const input = exactObject(value, path);
  assertExactKeys(input, INPUT_KEYS, path);
  const delivery = validateAwsRetainedStorageHostPreflightSeaDeliveryManifest(
    ownData(input, 'delivery', path),
  );
  const sourceArchive = validateSourceArchive(
    ownData(input, 'sourceArchive', path),
  );
  const bundleBytes = snapshotBytes(
    ownData(input, 'bundleBytes', path),
    MAX_BUNDLE_BYTES,
    `${path}.bundleBytes`,
  );
  const artifactBytes = snapshotBytes(
    ownData(input, 'artifactBytes', path),
    MAX_ARTIFACT_BYTES,
    `${path}.artifactBytes`,
  );
  const entryBundle = deepFreeze({
    format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ENTRY_BUNDLE_FORMAT,
    ...observeBytes(bundleBytes),
  });
  const artifactObservation = observeBytes(artifactBytes);
  const generation = validateGeneration(
    ownData(input, 'generation', path),
    delivery,
    entryBundle,
    artifactObservation,
  );
  const manifestBytes = Buffer.from(
    stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
    'utf8',
  );
  const manifestAsset = deepFreeze({
    name: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
    ...observeBytes(manifestBytes),
  });
  if (!sameJson(manifestAsset.byteDigest, generation.manifestDigest)) {
    throw new TypeError(
      'AWS retained-storage host preflight manifest evidence is inconsistent.',
    );
  }
  const payload = validatePayload({
    schemaVersion:
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_SCHEMA_VERSION,
    kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_KIND,
    delivery,
    sourceArchive,
    entryBundle,
    runtimeBundle: generation.runtimeBundle,
    seaBlob: generation.seaBlob,
    manifestAsset,
    artifactId: `${ARTIFACT_ID_PREFIX}_${artifactObservation.byteDigest.value}`,
    byteDigest: artifactObservation.byteDigest,
    size: artifactObservation.size,
    format: ARTIFACT_FORMAT,
    target: delivery.target,
    targetId: getBuildTargetId(delivery.target),
    node: generation.node,
    signing: { mode: 'unsigned' },
  });
  const recordId = createCanonicalJsonSha256Id({
    domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_DOMAIN,
    prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_PREFIX,
    value: payload,
    valuePath: 'AWS retained-storage host preflight SEA artifact record',
  });
  return deepFreeze(
    sortCanonicalJsonValue({
      ...payload,
      recordId,
    }),
  );
}

/**
 * Validate one bounded record against the exact snapshot entry bundle, final
 * SEA bytes, and the same successful SeaBuild generation that produced the
 * runtime bundle and SEA blob.
 * @param {unknown} value
 * @param {unknown} contextValue
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
  value,
  contextValue,
) {
  const document = cloneBoundedJsonObject(
    value,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_MAX_BYTES,
    'AWS retained-storage host preflight SEA artifact record',
  );
  assertExactKeys(
    document,
    DOCUMENT_KEYS,
    'AWS retained-storage host preflight SEA artifact record',
  );
  assertDomainSeparatedSha256Id(
    document.recordId,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_PREFIX,
    'AWS retained-storage host preflight SEA artifact record.recordId',
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validatePayload(payloadInput);
  const recordId = createCanonicalJsonSha256Id({
    domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_DOMAIN,
    prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_ID_PREFIX,
    value: payload,
    valuePath: 'AWS retained-storage host preflight SEA artifact record',
  });
  if (document.recordId !== recordId) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA artifact record ID does not match its exact content.',
    );
  }

  const contextPath =
    'AWS retained-storage host preflight SEA artifact validation context';
  const context = exactObject(contextValue, contextPath);
  assertExactKeys(context, VALIDATOR_CONTEXT_KEYS, contextPath);
  const expected = createAwsRetainedStorageHostPreflightSeaArtifactRecord({
    delivery: payload.delivery,
    sourceArchive: payload.sourceArchive,
    bundleBytes: ownData(context, 'bundleBytes', contextPath),
    artifactBytes: ownData(context, 'artifactBytes', contextPath),
    generation: ownData(context, 'generation', contextPath),
  });
  if (!sameJson(document, expected)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA artifact record does not match its exact build evidence.',
    );
  }
  return expected;
}

export default createAwsRetainedStorageHostPreflightSeaArtifactRecord;
