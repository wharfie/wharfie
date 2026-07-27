/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This bounded proof protocol keeps its exact trust classes beside their strict decoder. */

import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../src/core/runtime/content-id.js';
import { cloneBoundedJsonObject } from '../src/core/runtime/json-value.js';
import { assertManifestIsSecretFree } from '../src/core/runtime/manifest-security.js';
import { validateSha256Digest } from '../src/core/runtime/application-revision.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ENTRY_BUNDLE_FORMAT,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT,
  validateAwsRetainedStorageHostPreflightSeaArtifactRecordClaims,
} from './aws-host-retained-storage-host-preflight-sea-artifact-record.js';

export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_SCHEMA_VERSION = 2;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_KIND =
  'awsSingleNodeRetainedStorageHostPreflightSeaLinuxProof';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_SAFETY_CLASS =
  'disposable-linux-container-build-execution';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_DOMAIN =
  'wharfie:aws-single-node:retained-storage-host-preflight-sea-linux-proof:v2';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_PREFIX =
  'whlp2';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_MAX_BYTES =
  256 * 1024;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE = 56_127_068;

export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_DRIVER_PATH =
  'scripts/run-aws-host-retained-storage-host-preflight-sea-linux-docker.js';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_VERIFIER_PATH =
  'scripts/verify-aws-host-retained-storage-host-preflight-sea-linux.js';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_PROTOCOL_PATH =
  'scripts/aws-host-retained-storage-host-preflight-sea-linux-proof.js';

const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/u;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/u;
const KERNEL_RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,127}$/u;
const GLIBC_VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){1,3}$/u;
const EMPTY_SHA256_BASE64URL = '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU';
const EXPECTED_STARTUP_STDERR_SHA256_BASE64URL =
  'ZivTFMztiLh0VvgJtzIU9TWYgnAXuzeIZ7uA4pExZLs';
const PINNED_NODE_X64_ARCHIVE_SHA256_BASE64URL =
  'etKPsXKpqwWT-GwaOeXCaNDY_D1ssBZ_RVtWVaem4v0';
const MAX_OBSERVED_OUTPUT_BYTES = 1024 * 1024;
const MAX_SOURCE_TRANSPORT_BYTES = 128 * 1024 * 1024;
const MAX_TOOL_SOURCE_BYTES = 2 * 1024 * 1024;
const MIN_MEMORY_BYTES = 512 * 1024 * 1024;
const MAX_MEMORY_BYTES = 16 * 1024 * 1024 * 1024;
const EXPECTED_WORK_TMPFS_BYTES = 4 * 1024 * 1024 * 1024;
const EXPECTED_TEMP_TMPFS_BYTES = 512 * 1024 * 1024;
const EXPECTED_EVIDENCE_MAX_BYTES = 1024 * 1024;
const EXPECTED_CPU_LIMIT = 4;

const INPUT_KEYS = new Set([
  'subject',
  'runnerClaims',
  'builderClaims',
  'independentObservations',
]);
const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'safetyClass',
  'authority',
  'authoritative',
  ...INPUT_KEYS,
  'conclusion',
]);
const DOCUMENT_KEYS = new Set(['proofId', ...PAYLOAD_KEYS]);
const SUBJECT_KEYS = new Set(['sourceCommit', 'recordId', 'artifactId']);
const RUNNER_CLAIMS_KEYS = new Set([
  'implementation',
  'sourceTransport',
  'container',
]);
const IMPLEMENTATION_KEYS = new Set([
  'sourceCommit',
  'driver',
  'verifier',
  'protocol',
]);
const TOOL_FILE_KEYS = new Set(['logicalPath', 'byteDigest', 'size']);
const SOURCE_TRANSPORT_KEYS = new Set([
  'format',
  'byteDigest',
  'size',
  'headCommit',
  'prerequisiteCount',
]);
const CONTAINER_KEYS = new Set([
  'engine',
  'imageId',
  'invocationId',
  'containerId',
  'imageIdentityBasis',
  'requestedPlatform',
  'pullPolicy',
  'executionMode',
  'rootFilesystem',
  'capabilities',
  'privilegeEscalation',
  'sourceMount',
  'evidenceChannel',
  'workStorage',
  'tempStorage',
  'network',
  'logDriver',
  'removalPolicy',
  'memoryBytes',
  'pidsLimit',
  'workTmpfsBytes',
  'tempTmpfsBytes',
  'evidenceMaxBytes',
  'cpuLimit',
  'wallClockLimitMilliseconds',
]);
const BUILDER_CLAIMS_KEYS = new Set(['artifactRecord']);
const OBSERVATIONS_KEYS = new Set([
  'bootstrapNodeArchive',
  'sourceCheckout',
  'reproducedSourceArchive',
  'regeneratedEntryBundle',
  'publishedArtifact',
  'relocatedArtifact',
  'proofEnvironment',
  'runtimeEnvironment',
  'executions',
  'cleanup',
]);
const FORMATTED_OBSERVATION_KEYS = new Set([
  'basis',
  'format',
  'byteDigest',
  'size',
]);
const BOOTSTRAP_ARCHIVE_KEYS = new Set([
  'basis',
  'fileName',
  'byteDigest',
  'size',
]);
const SOURCE_CHECKOUT_KEYS = new Set([
  'basis',
  'checkedOutCommit',
  'clean',
  'prerequisiteCount',
  'transportByteDigest',
  'transportSize',
]);
const ARTIFACT_OBSERVATION_KEYS = new Set([
  'basis',
  'artifactId',
  'byteDigest',
  'size',
]);
const RELOCATED_ARTIFACT_OBSERVATION_KEYS = new Set([
  ...ARTIFACT_OBSERVATION_KEYS,
  'originalPublicationAbsent',
]);
const PROOF_ENVIRONMENT_KEYS = new Set([
  'platform',
  'architecture',
  'kernelRelease',
  'glibcVersionRuntime',
  'builderNodeVersion',
  'npmVersion',
]);
const RUNTIME_ENVIRONMENT_KEYS = new Set(['path', 'nodeFoundOnPath']);
const EXECUTIONS_KEYS = new Set([
  'original',
  'relocated',
  'extraArgument',
  'inheritedNodeOptions',
]);
const EXECUTION_RESULT_KEYS = new Set(['status', 'stdout', 'stderr']);
const INHERITED_NODE_OPTIONS_KEYS = new Set([
  ...EXECUTION_RESULT_KEYS,
  'preloadExecuted',
]);
const BYTE_OBSERVATION_KEYS = new Set(['byteDigest', 'size']);
const CLEANUP_KEYS = new Set([
  'guestWork',
  'container',
  'temporaryRoot',
  'selectedImage',
]);
const INVOCATION_REMOVAL_KEYS = new Set(['invocationId', 'removed']);
const CONTAINER_CLEANUP_KEYS = new Set([
  'invocationId',
  'containerId',
  'absent',
]);
const SELECTED_IMAGE_CLEANUP_KEYS = new Set(['imageId', 'unchanged']);
const CONCLUSION_KEYS = new Set([
  'classification',
  'authoritative',
  'limitations',
]);

const EXPECTED_IMPLEMENTATION_PATHS = Object.freeze({
  driver: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_DRIVER_PATH,
  verifier: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_VERIFIER_PATH,
  protocol: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_PROTOCOL_PATH,
});

const BUILDER_ONLY_RECORD_FIELDS = Object.freeze([
  'delivery',
  'manifestAsset',
  'node.sourceBinary',
  'runtimeBundle',
  'seaBlob',
  'signing',
]);

const LIMITATIONS = Object.freeze([
  'The receipt and its content identifiers detect alteration but authenticate neither the runner nor the execution.',
  'Runner, verifier, container-image, and environment identities are inspectable claims rather than third-party attestations.',
  `Artifact-record fields ${BUILDER_ONLY_RECORD_FIELDS.join(
    ', ',
  )} remain trusted-builder claims and were not extracted from the final executable.`,
  'Reproducing source and entry bytes while hashing the final executable does not prove that the whole claimed source produced those executable bytes.',
  'Node absence is scoped only to command lookup on the recorded runtime PATH; Node bytes may exist elsewhere.',
  'The extra-argument result is an observation and does not independently prove argument rejection.',
  'The Node archive is pinned by SHA-256; npm and project packages rely on registry and lock/integrity metadata; none are signature or transparency-log attested.',
  'The unrestricted bridge network can reach arbitrary internet, local-network, and link-local endpoints; this receipt makes no network-authority claim.',
  'A disposable Linux container, including an emulated one, is not successful Amazon Linux 2023 or live-cloud host evidence.',
  'The observed redacted startup failure does not establish successful host-preflight behavior.',
  'Observed cleanup after this run does not guarantee immediate cleanup after SIGKILL, Docker-daemon failure, or host power loss.',
]);

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {unknown} value @param {string} valuePath @returns {Record<string, any>} */
function exactObject(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  return value;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertExactKeys(value, keys, valuePath) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(
      `${valuePath} must contain only its exact required keys.`,
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${valuePath}.${key} must be an own data property.`);
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

/** @param {unknown} value @param {string} valuePath @param {number} minimum @param {number} maximum @returns {number} */
function validateInteger(value, valuePath, minimum, maximum) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `${valuePath} must be a safe integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function validateSourceCommit(value, valuePath) {
  if (typeof value !== 'string' || !SOURCE_COMMIT_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be 40 lowercase hexadecimal characters.`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @param {boolean} [allowEmpty] @returns {Readonly<Record<string, any>>} */
function validateByteObservation(value, valuePath, allowEmpty = false) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, BYTE_OBSERVATION_KEYS, valuePath);
  const byteDigest = validateSha256Digest(
    input.byteDigest,
    `${valuePath}.byteDigest`,
  );
  const size = validateInteger(
    input.size,
    `${valuePath}.size`,
    allowEmpty ? 0 : 1,
    Number.MAX_SAFE_INTEGER,
  );
  if (size === 0 && byteDigest.value !== EMPTY_SHA256_BASE64URL) {
    throw new TypeError(
      `${valuePath}.byteDigest must identify the canonical empty byte string when size is zero.`,
    );
  }
  return deepFreeze({ byteDigest, size });
}

/** @param {unknown} value @param {string} expectedPath @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateToolFile(value, expectedPath, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, TOOL_FILE_KEYS, valuePath);
  if (input.logicalPath !== expectedPath) {
    throw new TypeError(`${valuePath}.logicalPath is invalid.`);
  }
  const observation = validateByteObservation(
    { byteDigest: input.byteDigest, size: input.size },
    valuePath,
  );
  if (observation.size > MAX_TOOL_SOURCE_BYTES) {
    throw new TypeError(`${valuePath}.size exceeds its byte limit.`);
  }
  return deepFreeze({ logicalPath: expectedPath, ...observation });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateSubject(value) {
  const path = 'Linux SEA proof subject';
  const input = exactObject(value, path);
  assertExactKeys(input, SUBJECT_KEYS, path);
  const sourceCommit = validateSourceCommit(
    input.sourceCommit,
    `${path}.sourceCommit`,
  );
  assertDomainSeparatedSha256Id(input.recordId, 'whp1', `${path}.recordId`);
  assertDomainSeparatedSha256Id(input.artifactId, 'waf1', `${path}.artifactId`);
  return deepFreeze({
    sourceCommit,
    recordId: input.recordId,
    artifactId: input.artifactId,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateRunnerClaims(value) {
  const path = 'Linux SEA proof runnerClaims';
  const input = exactObject(value, path);
  assertExactKeys(input, RUNNER_CLAIMS_KEYS, path);

  const implementationPath = `${path}.implementation`;
  const implementationInput = exactObject(
    input.implementation,
    implementationPath,
  );
  assertExactKeys(implementationInput, IMPLEMENTATION_KEYS, implementationPath);
  const implementation = deepFreeze({
    sourceCommit: validateSourceCommit(
      implementationInput.sourceCommit,
      `${implementationPath}.sourceCommit`,
    ),
    driver: validateToolFile(
      implementationInput.driver,
      EXPECTED_IMPLEMENTATION_PATHS.driver,
      `${implementationPath}.driver`,
    ),
    verifier: validateToolFile(
      implementationInput.verifier,
      EXPECTED_IMPLEMENTATION_PATHS.verifier,
      `${implementationPath}.verifier`,
    ),
    protocol: validateToolFile(
      implementationInput.protocol,
      EXPECTED_IMPLEMENTATION_PATHS.protocol,
      `${implementationPath}.protocol`,
    ),
  });

  const transportPath = `${path}.sourceTransport`;
  const transportInput = exactObject(input.sourceTransport, transportPath);
  assertExactKeys(transportInput, SOURCE_TRANSPORT_KEYS, transportPath);
  if (transportInput.format !== 'git-bundle-complete-head-v1') {
    throw new TypeError(`${transportPath}.format is invalid.`);
  }
  const transportObservation = validateByteObservation(
    {
      byteDigest: transportInput.byteDigest,
      size: transportInput.size,
    },
    transportPath,
  );
  if (transportObservation.size > MAX_SOURCE_TRANSPORT_BYTES) {
    throw new TypeError(`${transportPath}.size exceeds its byte limit.`);
  }
  const headCommit = validateSourceCommit(
    transportInput.headCommit,
    `${transportPath}.headCommit`,
  );
  if (transportInput.prerequisiteCount !== 0) {
    throw new TypeError(`${transportPath}.prerequisiteCount must be zero.`);
  }
  const sourceTransport = deepFreeze({
    format: 'git-bundle-complete-head-v1',
    ...transportObservation,
    headCommit,
    prerequisiteCount: 0,
  });

  const containerPath = `${path}.container`;
  const containerInput = exactObject(input.container, containerPath);
  assertExactKeys(containerInput, CONTAINER_KEYS, containerPath);
  const expectedConstants = {
    engine: 'docker',
    imageIdentityBasis: 'host-daemon-observation',
    pullPolicy: 'never',
    rootFilesystem: 'read-only',
    capabilities: 'none',
    privilegeEscalation: 'disabled',
    sourceMount: 'read-only-bind',
    evidenceChannel: 'bounded-stdout-json',
    workStorage: 'bounded-tmpfs',
    tempStorage: 'bounded-tmpfs',
    network: 'unrestricted-bridge-network',
    logDriver: 'none',
    removalPolicy: 'automatic',
  };
  for (const [key, expected] of Object.entries(expectedConstants)) {
    if (containerInput[key] !== expected) {
      throw new TypeError(`${containerPath}.${key} is invalid.`);
    }
  }
  if (
    typeof containerInput.imageId !== 'string' ||
    !IMAGE_ID_PATTERN.test(containerInput.imageId)
  ) {
    throw new TypeError(`${containerPath}.imageId is invalid.`);
  }
  if (
    typeof containerInput.invocationId !== 'string' ||
    !INVOCATION_ID_PATTERN.test(containerInput.invocationId)
  ) {
    throw new TypeError(`${containerPath}.invocationId is invalid.`);
  }
  if (
    typeof containerInput.containerId !== 'string' ||
    !CONTAINER_ID_PATTERN.test(containerInput.containerId)
  ) {
    throw new TypeError(`${containerPath}.containerId is invalid.`);
  }
  if (containerInput.requestedPlatform !== 'linux/amd64') {
    throw new TypeError(`${containerPath}.requestedPlatform is invalid.`);
  }
  if (
    containerInput.executionMode !== 'native' &&
    containerInput.executionMode !== 'emulated'
  ) {
    throw new TypeError(`${containerPath}.executionMode is invalid.`);
  }
  const container = deepFreeze({
    ...expectedConstants,
    imageId: containerInput.imageId,
    invocationId: containerInput.invocationId,
    containerId: containerInput.containerId,
    requestedPlatform: 'linux/amd64',
    executionMode: containerInput.executionMode,
    memoryBytes: validateInteger(
      containerInput.memoryBytes,
      `${containerPath}.memoryBytes`,
      MIN_MEMORY_BYTES,
      MAX_MEMORY_BYTES,
    ),
    pidsLimit: validateInteger(
      containerInput.pidsLimit,
      `${containerPath}.pidsLimit`,
      32,
      4096,
    ),
    workTmpfsBytes: validateInteger(
      containerInput.workTmpfsBytes,
      `${containerPath}.workTmpfsBytes`,
      EXPECTED_WORK_TMPFS_BYTES,
      EXPECTED_WORK_TMPFS_BYTES,
    ),
    tempTmpfsBytes: validateInteger(
      containerInput.tempTmpfsBytes,
      `${containerPath}.tempTmpfsBytes`,
      EXPECTED_TEMP_TMPFS_BYTES,
      EXPECTED_TEMP_TMPFS_BYTES,
    ),
    evidenceMaxBytes: validateInteger(
      containerInput.evidenceMaxBytes,
      `${containerPath}.evidenceMaxBytes`,
      EXPECTED_EVIDENCE_MAX_BYTES,
      EXPECTED_EVIDENCE_MAX_BYTES,
    ),
    cpuLimit: validateInteger(
      containerInput.cpuLimit,
      `${containerPath}.cpuLimit`,
      EXPECTED_CPU_LIMIT,
      EXPECTED_CPU_LIMIT,
    ),
    wallClockLimitMilliseconds: validateInteger(
      containerInput.wallClockLimitMilliseconds,
      `${containerPath}.wallClockLimitMilliseconds`,
      1000,
      30 * 60 * 1000,
    ),
  });
  return deepFreeze({ implementation, sourceTransport, container });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateBuilderClaims(value) {
  const path = 'Linux SEA proof builderClaims';
  const input = exactObject(value, path);
  assertExactKeys(input, BUILDER_CLAIMS_KEYS, path);
  return deepFreeze({
    artifactRecord:
      validateAwsRetainedStorageHostPreflightSeaArtifactRecordClaims(
        input.artifactRecord,
      ),
  });
}

/** @param {unknown} value @param {string} basis @param {string} format @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateFormattedObservation(value, basis, format, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, FORMATTED_OBSERVATION_KEYS, valuePath);
  if (input.basis !== basis || input.format !== format) {
    throw new TypeError(`${valuePath} trust basis or format is invalid.`);
  }
  return deepFreeze({
    basis,
    format,
    ...validateByteObservation(
      { byteDigest: input.byteDigest, size: input.size },
      valuePath,
    ),
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateBootstrapNodeArchive(value, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, BOOTSTRAP_ARCHIVE_KEYS, valuePath);
  if (
    input.basis !== 'downloaded-pinned-sha256-observation' ||
    input.fileName !== 'node-v24.13.1-linux-x64.tar.gz'
  ) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  const observation = validateByteObservation(
    { byteDigest: input.byteDigest, size: input.size },
    valuePath,
  );
  if (
    observation.byteDigest.value !== PINNED_NODE_X64_ARCHIVE_SHA256_BASE64URL ||
    observation.size !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE
  ) {
    throw new TypeError(
      `${valuePath} is not the exact pinned archive byte observation.`,
    );
  }
  return deepFreeze({
    basis: 'downloaded-pinned-sha256-observation',
    fileName: 'node-v24.13.1-linux-x64.tar.gz',
    ...observation,
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateSourceCheckout(value, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, SOURCE_CHECKOUT_KEYS, valuePath);
  if (
    input.basis !== 'guest-clean-detached-checkout' ||
    input.clean !== true ||
    input.prerequisiteCount !== 0
  ) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  const transport = validateByteObservation(
    {
      byteDigest: input.transportByteDigest,
      size: input.transportSize,
    },
    `${valuePath}.transport`,
  );
  if (transport.size > MAX_SOURCE_TRANSPORT_BYTES) {
    throw new TypeError(`${valuePath}.transportSize exceeds its byte limit.`);
  }
  return deepFreeze({
    basis: 'guest-clean-detached-checkout',
    checkedOutCommit: validateSourceCommit(
      input.checkedOutCommit,
      `${valuePath}.checkedOutCommit`,
    ),
    clean: true,
    prerequisiteCount: 0,
    transportByteDigest: transport.byteDigest,
    transportSize: transport.size,
  });
}

/** @param {unknown} value @param {string} valuePath @param {boolean} relocated @returns {Readonly<Record<string, any>>} */
function validateArtifactObservation(value, valuePath, relocated) {
  const input = exactObject(value, valuePath);
  assertExactKeys(
    input,
    relocated ? RELOCATED_ARTIFACT_OBSERVATION_KEYS : ARTIFACT_OBSERVATION_KEYS,
    valuePath,
  );
  if (input.basis !== 'held-file-observation') {
    throw new TypeError(`${valuePath}.basis is invalid.`);
  }
  assertDomainSeparatedSha256Id(
    input.artifactId,
    'waf1',
    `${valuePath}.artifactId`,
  );
  const observation = validateByteObservation(
    { byteDigest: input.byteDigest, size: input.size },
    valuePath,
  );
  if (input.artifactId !== `waf1_${observation.byteDigest.value}`) {
    throw new TypeError(`${valuePath}.artifactId does not name its bytes.`);
  }
  if (relocated && input.originalPublicationAbsent !== true) {
    throw new TypeError(`${valuePath}.originalPublicationAbsent must be true.`);
  }
  return deepFreeze({
    basis: 'held-file-observation',
    artifactId: input.artifactId,
    ...observation,
    ...(relocated ? { originalPublicationAbsent: true } : {}),
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateProofEnvironment(value, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, PROOF_ENVIRONMENT_KEYS, valuePath);
  if (
    input.platform !== 'linux' ||
    input.architecture !== 'x64' ||
    typeof input.kernelRelease !== 'string' ||
    !KERNEL_RELEASE_PATTERN.test(input.kernelRelease) ||
    typeof input.glibcVersionRuntime !== 'string' ||
    !GLIBC_VERSION_PATTERN.test(input.glibcVersionRuntime) ||
    input.builderNodeVersion !== '24.13.1' ||
    input.npmVersion !== '11.12.0'
  ) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  return deepFreeze({
    platform: 'linux',
    architecture: 'x64',
    kernelRelease: input.kernelRelease,
    glibcVersionRuntime: input.glibcVersionRuntime,
    builderNodeVersion: '24.13.1',
    npmVersion: '11.12.0',
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateRuntimeEnvironment(value, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, RUNTIME_ENVIRONMENT_KEYS, valuePath);
  if (input.path !== '/usr/bin:/bin' || input.nodeFoundOnPath !== false) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  return deepFreeze({
    path: '/usr/bin:/bin',
    nodeFoundOnPath: false,
  });
}

/** @param {unknown} value @param {string} valuePath @param {boolean} inherited @returns {Readonly<Record<string, any>>} */
function validateExecutionResult(value, valuePath, inherited = false) {
  const input = exactObject(value, valuePath);
  assertExactKeys(
    input,
    inherited ? INHERITED_NODE_OPTIONS_KEYS : EXECUTION_RESULT_KEYS,
    valuePath,
  );
  const result = {
    status: validateInteger(input.status, `${valuePath}.status`, 0, 255),
    stdout: validateByteObservation(input.stdout, `${valuePath}.stdout`, true),
    stderr: validateByteObservation(input.stderr, `${valuePath}.stderr`, true),
  };
  if (
    result.stdout.size > MAX_OBSERVED_OUTPUT_BYTES ||
    result.stderr.size > MAX_OBSERVED_OUTPUT_BYTES
  ) {
    throw new TypeError(`${valuePath} output observation exceeds its limit.`);
  }
  if (inherited && input.preloadExecuted !== false) {
    throw new TypeError(`${valuePath}.preloadExecuted must be false.`);
  }
  if (
    result.status !== 1 ||
    result.stdout.size !== 0 ||
    result.stdout.byteDigest.value !== EMPTY_SHA256_BASE64URL ||
    result.stderr.size !== 57 ||
    result.stderr.byteDigest.value !== EXPECTED_STARTUP_STDERR_SHA256_BASE64URL
  ) {
    throw new TypeError(
      `${valuePath} must equal the known redacted SEA startup outcome.`,
    );
  }
  return deepFreeze({
    ...result,
    ...(inherited ? { preloadExecuted: false } : {}),
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateExecutions(value, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, EXECUTIONS_KEYS, valuePath);
  return deepFreeze({
    original: validateExecutionResult(input.original, `${valuePath}.original`),
    relocated: validateExecutionResult(
      input.relocated,
      `${valuePath}.relocated`,
    ),
    extraArgument: validateExecutionResult(
      input.extraArgument,
      `${valuePath}.extraArgument`,
    ),
    inheritedNodeOptions: validateExecutionResult(
      input.inheritedNodeOptions,
      `${valuePath}.inheritedNodeOptions`,
      true,
    ),
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} containerClaims @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateCleanup(value, containerClaims, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, CLEANUP_KEYS, valuePath);

  const guestWorkPath = `${valuePath}.guestWork`;
  const guestWork = exactObject(input.guestWork, guestWorkPath);
  assertExactKeys(guestWork, INVOCATION_REMOVAL_KEYS, guestWorkPath);
  const containerPath = `${valuePath}.container`;
  const container = exactObject(input.container, containerPath);
  assertExactKeys(container, CONTAINER_CLEANUP_KEYS, containerPath);
  const temporaryRootPath = `${valuePath}.temporaryRoot`;
  const temporaryRoot = exactObject(input.temporaryRoot, temporaryRootPath);
  assertExactKeys(temporaryRoot, INVOCATION_REMOVAL_KEYS, temporaryRootPath);
  const selectedImagePath = `${valuePath}.selectedImage`;
  const selectedImage = exactObject(input.selectedImage, selectedImagePath);
  assertExactKeys(
    selectedImage,
    SELECTED_IMAGE_CLEANUP_KEYS,
    selectedImagePath,
  );

  if (
    guestWork.invocationId !== containerClaims.invocationId ||
    guestWork.removed !== true ||
    container.invocationId !== containerClaims.invocationId ||
    container.containerId !== containerClaims.containerId ||
    container.absent !== true ||
    temporaryRoot.invocationId !== containerClaims.invocationId ||
    temporaryRoot.removed !== true ||
    selectedImage.imageId !== containerClaims.imageId ||
    selectedImage.unchanged !== true
  ) {
    throw new TypeError(
      `${valuePath} does not match the exact invocation, container, and image identities.`,
    );
  }

  return deepFreeze({
    guestWork: {
      invocationId: containerClaims.invocationId,
      removed: true,
    },
    container: {
      invocationId: containerClaims.invocationId,
      containerId: containerClaims.containerId,
      absent: true,
    },
    temporaryRoot: {
      invocationId: containerClaims.invocationId,
      removed: true,
    },
    selectedImage: {
      imageId: containerClaims.imageId,
      unchanged: true,
    },
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} containerClaims @returns {Readonly<Record<string, any>>} */
function validateIndependentObservations(value, containerClaims) {
  const path = 'Linux SEA proof independentObservations';
  const input = exactObject(value, path);
  assertExactKeys(input, OBSERVATIONS_KEYS, path);
  return deepFreeze({
    bootstrapNodeArchive: validateBootstrapNodeArchive(
      input.bootstrapNodeArchive,
      `${path}.bootstrapNodeArchive`,
    ),
    sourceCheckout: validateSourceCheckout(
      input.sourceCheckout,
      `${path}.sourceCheckout`,
    ),
    reproducedSourceArchive: validateFormattedObservation(
      input.reproducedSourceArchive,
      'clean-checkout-reproduction',
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SOURCE_ARCHIVE_FORMAT,
      `${path}.reproducedSourceArchive`,
    ),
    regeneratedEntryBundle: validateFormattedObservation(
      input.regeneratedEntryBundle,
      'implementation-under-test-reproduction',
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ENTRY_BUNDLE_FORMAT,
      `${path}.regeneratedEntryBundle`,
    ),
    publishedArtifact: validateArtifactObservation(
      input.publishedArtifact,
      `${path}.publishedArtifact`,
      false,
    ),
    relocatedArtifact: validateArtifactObservation(
      input.relocatedArtifact,
      `${path}.relocatedArtifact`,
      true,
    ),
    proofEnvironment: validateProofEnvironment(
      input.proofEnvironment,
      `${path}.proofEnvironment`,
    ),
    runtimeEnvironment: validateRuntimeEnvironment(
      input.runtimeEnvironment,
      `${path}.runtimeEnvironment`,
    ),
    executions: validateExecutions(input.executions, `${path}.executions`),
    cleanup: validateCleanup(input.cleanup, containerClaims, `${path}.cleanup`),
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateConclusion(value) {
  const path = 'Linux SEA proof conclusion';
  const input = exactObject(value, path);
  assertExactKeys(input, CONCLUSION_KEYS, path);
  if (
    input.classification !==
      'linux-sea-startup-relocation-redacted-failure-observed' ||
    input.authoritative !== false ||
    !sameJson(input.limitations, LIMITATIONS)
  ) {
    throw new TypeError(`${path} is invalid.`);
  }
  return deepFreeze({
    classification: 'linux-sea-startup-relocation-redacted-failure-observed',
    authoritative: false,
    limitations: [...LIMITATIONS],
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validatePayload(value) {
  const path = 'Linux SEA proof receipt';
  const input = exactObject(value, path);
  assertExactKeys(input, PAYLOAD_KEYS, path);
  if (
    input.schemaVersion !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_SCHEMA_VERSION ||
    input.kind !== AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_KIND ||
    input.safetyClass !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_SAFETY_CLASS ||
    input.authority !== 'none' ||
    input.authoritative !== false
  ) {
    throw new TypeError('Linux SEA proof receipt header is invalid.');
  }

  const subject = validateSubject(input.subject);
  const runnerClaims = validateRunnerClaims(input.runnerClaims);
  const builderClaims = validateBuilderClaims(input.builderClaims);
  const independentObservations = validateIndependentObservations(
    input.independentObservations,
    runnerClaims.container,
  );
  const conclusion = validateConclusion(input.conclusion);
  const record = builderClaims.artifactRecord;

  if (
    subject.sourceCommit !== record.delivery.source.commit ||
    subject.recordId !== record.recordId ||
    subject.artifactId !== record.artifactId ||
    runnerClaims.implementation.sourceCommit !== subject.sourceCommit ||
    runnerClaims.sourceTransport.headCommit !== subject.sourceCommit ||
    independentObservations.sourceCheckout.checkedOutCommit !==
      subject.sourceCommit ||
    independentObservations.sourceCheckout.prerequisiteCount !==
      runnerClaims.sourceTransport.prerequisiteCount ||
    !sameJson(
      independentObservations.sourceCheckout.transportByteDigest,
      runnerClaims.sourceTransport.byteDigest,
    ) ||
    independentObservations.sourceCheckout.transportSize !==
      runnerClaims.sourceTransport.size
  ) {
    throw new TypeError(
      'Linux SEA proof subject does not match its exact implementation and artifact record.',
    );
  }

  if (
    record.target.architecture !== 'x64' ||
    runnerClaims.container.requestedPlatform !== 'linux/amd64' ||
    independentObservations.proofEnvironment.platform !==
      record.target.platform ||
    independentObservations.proofEnvironment.architecture !==
      record.target.architecture ||
    independentObservations.proofEnvironment.builderNodeVersion !==
      record.target.nodeVersion
  ) {
    throw new TypeError(
      'Linux SEA proof environment does not match its artifact target.',
    );
  }

  const observedArchive = independentObservations.bootstrapNodeArchive;
  if (
    observedArchive.fileName !== record.node.archive.fileName ||
    !sameJson(observedArchive.byteDigest, record.node.archive.byteDigest)
  ) {
    throw new TypeError(
      'Linux SEA proof bootstrap Node archive does not match its artifact record.',
    );
  }
  const reproducedSource = independentObservations.reproducedSourceArchive;
  if (
    reproducedSource.format !== record.sourceArchive.format ||
    !sameJson(reproducedSource.byteDigest, record.sourceArchive.byteDigest) ||
    reproducedSource.size !== record.sourceArchive.size
  ) {
    throw new TypeError(
      'Linux SEA proof reproduced source archive does not match its artifact record.',
    );
  }
  const regeneratedEntry = independentObservations.regeneratedEntryBundle;
  if (
    regeneratedEntry.format !== record.entryBundle.format ||
    !sameJson(regeneratedEntry.byteDigest, record.entryBundle.byteDigest) ||
    regeneratedEntry.size !== record.entryBundle.size
  ) {
    throw new TypeError(
      'Linux SEA proof regenerated entry bundle does not match its artifact record.',
    );
  }
  for (const artifact of [
    independentObservations.publishedArtifact,
    independentObservations.relocatedArtifact,
  ]) {
    if (
      artifact.artifactId !== record.artifactId ||
      !sameJson(artifact.byteDigest, record.byteDigest) ||
      artifact.size !== record.size
    ) {
      throw new TypeError(
        'Linux SEA proof artifact observation does not match its artifact record.',
      );
    }
  }

  const executions = independentObservations.executions;
  if (
    !sameJson(executions.original, executions.relocated) ||
    !sameJson(executions.original, {
      status: executions.inheritedNodeOptions.status,
      stdout: executions.inheritedNodeOptions.stdout,
      stderr: executions.inheritedNodeOptions.stderr,
    })
  ) {
    throw new TypeError(
      'Linux SEA proof baseline, relocation, and inherited-option observations must match.',
    );
  }

  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_SCHEMA_VERSION,
      kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_KIND,
      safetyClass:
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_SAFETY_CLASS,
      authority: 'none',
      authoritative: false,
      subject,
      runnerClaims,
      builderClaims,
      independentObservations,
      conclusion,
    }),
  );
  assertManifestIsSecretFree(payload, 'Linux SEA proof receipt');
  return payload;
}

/**
 * Create one self-addressed, non-authoritative Linux SEA proof receipt. The
 * receipt preserves trust classes; it does not convert runner or builder
 * claims into authenticated attestation.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(
  value,
) {
  const input = cloneBoundedJsonObject(
    value,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_MAX_BYTES,
    'Linux SEA proof receipt input',
  );
  assertExactKeys(input, INPUT_KEYS, 'Linux SEA proof receipt input');
  const payload = validatePayload({
    schemaVersion:
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_SCHEMA_VERSION,
    kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_KIND,
    safetyClass:
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_SAFETY_CLASS,
    authority: 'none',
    authoritative: false,
    subject: input.subject,
    runnerClaims: input.runnerClaims,
    builderClaims: input.builderClaims,
    independentObservations: input.independentObservations,
    conclusion: {
      classification: 'linux-sea-startup-relocation-redacted-failure-observed',
      authoritative: false,
      limitations: [...LIMITATIONS],
    },
  });
  const proofId = createCanonicalJsonSha256Id({
    domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_DOMAIN,
    prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_PREFIX,
    value: payload,
    valuePath: 'Linux SEA proof receipt payload',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, proofId }));
}

/**
 * Validate one bounded transported Linux SEA proof receipt. Its proof ID
 * authenticates exact receipt content only, never the issuer or execution.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(
  value,
) {
  const document = cloneBoundedJsonObject(
    value,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_MAX_BYTES,
    'Linux SEA proof receipt',
  );
  assertExactKeys(document, DOCUMENT_KEYS, 'Linux SEA proof receipt');
  assertDomainSeparatedSha256Id(
    document.proofId,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_PREFIX,
    'Linux SEA proof receipt.proofId',
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validatePayload(payloadInput);
  const proofId = createCanonicalJsonSha256Id({
    domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_DOMAIN,
    prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_ID_PREFIX,
    value: payload,
    valuePath: 'Linux SEA proof receipt payload',
  });
  if (document.proofId !== proofId) {
    throw new TypeError(
      'Linux SEA proof receipt proofId does not match its exact content.',
    );
  }
  return deepFreeze(sortCanonicalJsonValue({ ...payload, proofId }));
}

/**
 * Serialize one validated receipt as canonical newline-terminated JSON.
 * @param {unknown} value
 * @returns {string}
 */
export function stringifyAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(
  value,
) {
  const receipt =
    validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(value);
  const text = `${JSON.stringify(sortCanonicalJsonValue(receipt))}\n`;
  if (
    Buffer.byteLength(text, 'utf8') >
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_MAX_BYTES
  ) {
    throw new TypeError('Linux SEA proof receipt is too large to serialize.');
  }
  return text;
}

export default createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt;
