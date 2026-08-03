/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This closed readiness protocol keeps its exact injected read surface and tagged observations inline. */

import path from 'node:path';

import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import {
  assertSha256Base64Url,
  sha256Base64Url,
} from '../src/core/runtime/content-id.js';
import { cloneBoundedJsonObject } from '../src/core/runtime/json-value.js';
import { assertManifestIsSecretFree } from '../src/core/runtime/manifest-security.js';

export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SCHEMA_VERSION = 1;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_KIND =
  'awsRetainedStorageHostPreflightSeaLinuxDockerReadiness';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SAFETY_CLASS =
  'read-only-no-container-mutation';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_MAX_BYTES =
  64 * 1024;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_CORE_PATH =
  'scripts/aws-host-retained-storage-host-preflight-sea-linux-docker-readiness.js';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_CLI_PATH =
  'scripts/inspect-aws-host-retained-storage-host-preflight-sea-linux-docker-readiness.js';

const PROOF_DRIVER_PATH =
  'scripts/run-aws-host-retained-storage-host-preflight-sea-linux-docker.js';
const PROOF_VERIFIER_PATH =
  'scripts/verify-aws-host-retained-storage-host-preflight-sea-linux.js';
const PROOF_PROTOCOL_PATH =
  'scripts/aws-host-retained-storage-host-preflight-sea-linux-proof.js';

export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS =
  Object.freeze([
    PROOF_DRIVER_PATH,
    PROOF_VERIFIER_PATH,
    PROOF_PROTOCOL_PATH,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_CORE_PATH,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_CLI_PATH,
  ]);

const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const SERVER_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,127}$/u;
const SMALL_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,127}$/u;
const OBSERVED_AT_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const MAX_PORT_RESULT_BYTES = 32 * 1024;
const MAX_TOOLING_BYTES = 2 * 1024 * 1024;
const CONTAINER_NAME_PREFIX = 'wharfie-sea-proof-';

const DAEMON_MEMORY_BYTES = 6n * 1024n * 1024n * 1024n;
const REQUESTED_CPU_COUNT = 4;
const PIDS_LIMIT = 512;
const WORK_TMPFS_BYTES = 4n * 1024n * 1024n * 1024n;
const TEMP_TMPFS_BYTES = 512n * 1024n * 1024n;
const WALL_CLOCK_LIMIT_MILLISECONDS = 30 * 60 * 1000;
const GIT_BUNDLE_MAXIMUM_BYTES = 128n * 1024n * 1024n;
const TOOLING_EXPORT_MAXIMUM_BYTES = 3n * 2n * 1024n * 1024n;
const HOST_TEMP_MINIMUM_AVAILABLE_BYTES = 160n * 1024n * 1024n;
const OUTPUT_MINIMUM_AVAILABLE_BYTES = 2n * 1024n * 1024n;

const INPUT_KEYS = new Set(['imageId', 'outputRoot']);
const OPTIONS_KEYS = new Set(['ports']);
const PORT_KEYS = new Set([
  'readObservedAt',
  'observeRepository',
  'observeDockerEndpoint',
  'observeDockerDaemon',
  'observeDockerImage',
  'observeDockerContainer',
  'observeHostTemp',
  'observeOutput',
]);
const UNOBSERVABLE_KEYS = new Set(['state']);
const REPOSITORY_KEYS = new Set(['state', 'commit', 'worktree', 'tooling']);
const TOOLING_KEYS = new Set([
  'logicalPath',
  'treeEntry',
  'liveFile',
  'committedBytes',
  'liveBytes',
  'matchesHead',
]);
const BYTE_OBSERVATION_KEYS = new Set(['byteDigest', 'size']);
const DIGEST_KEYS = new Set(['algorithm', 'value']);
const ENDPOINT_KEYS = new Set(['state', 'locality']);
const DAEMON_KEYS = new Set([
  'state',
  'operatingSystem',
  'architecture',
  'executionMode',
  'cpuCount',
  'memoryBytes',
  'serverVersion',
]);
const IMAGE_KEYS = new Set([
  'state',
  'id',
  'operatingSystem',
  'architecture',
  'rootfsDigest',
]);
const CONTAINER_ABSENT_KEYS = new Set(['state']);
const CONTAINER_KEYS = new Set([
  'state',
  'containerId',
  'runtimeState',
  'collisionClass',
]);
const FILESYSTEM_KEYS = new Set([
  'state',
  'writable',
  'device',
  'availableBytes',
]);
const OUTPUT_KEYS = new Set([
  'state',
  'rootState',
  'proofCommitPath',
  'writable',
  'device',
  'availableBytes',
]);
const REPORT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'safetyClass',
  'authority',
  'authoritative',
  'observedAt',
  'freshness',
  'subject',
  'requirements',
  'observations',
  'readyForBoundedAttempt',
  'blockers',
  'advisories',
  'limitations',
]);

const BLOCKER_CODES = new Set([
  'CONCURRENT_PROOF_RUNNING',
  'CONTAINER_COLLISION_UNOBSERVABLE',
  'DOCKER_DAEMON_ARCHITECTURE_UNSUPPORTED',
  'DOCKER_DAEMON_MEMORY_INSUFFICIENT',
  'DOCKER_DAEMON_OS_UNSUPPORTED',
  'DOCKER_DAEMON_UNOBSERVABLE',
  'DOCKER_ENDPOINT_NOT_LOCAL',
  'DOCKER_ENDPOINT_UNOBSERVABLE',
  'FOREIGN_CONTAINER_NAME_COLLISION',
  'HOST_TEMP_FILESYSTEM_UNOBSERVABLE',
  'HOST_TEMP_NOT_WRITABLE',
  'HOST_TEMP_PATH_UNSAFE',
  'HOST_TEMP_SPACE_INSUFFICIENT',
  'IMAGE_CHANGED_DURING_ASSESSMENT',
  'IMAGE_ID_MISMATCH',
  'IMAGE_NOT_OBSERVED_LOCAL',
  'IMAGE_PLATFORM_UNSUPPORTED',
  'OUTPUT_COMMIT_COLLISION',
  'OUTPUT_FILESYSTEM_UNOBSERVABLE',
  'OUTPUT_PARENT_NOT_WRITABLE',
  'OUTPUT_PATH_UNSAFE',
  'OUTPUT_SPACE_INSUFFICIENT',
  'REPOSITORY_CHANGED_DURING_ASSESSMENT',
  'REPOSITORY_DIRTY',
  'REPOSITORY_UNOBSERVABLE',
  'SHARED_HOST_FILESYSTEM_SPACE_INSUFFICIENT',
  'TOOLING_BYTES_MISMATCH',
  'TOOLING_LIVE_FILE_UNSAFE',
  'TOOLING_TREE_ENTRY_INVALID',
]);

const ADVISORY_CODES = new Set([
  'DAEMON_CPU_BELOW_REQUESTED_CAP',
  'DOCKER_BACKING_STORE_CAPACITY_UNOBSERVED',
  'EMULATED_AMD64_EXECUTION',
  'OUTPUT_ROOT_WILL_BE_CREATED',
  'OWNED_STOPPED_RESIDUE_RECONCILABLE',
  'POINT_IN_TIME_ONLY',
  'UNRESTRICTED_FUTURE_NETWORK',
]);

const LIMITATIONS = Object.freeze([
  'This point-in-time report reserves no resources and authorizes no mutation.',
  'The bounded proof driver repeats its own clean-head, image, container, cleanup, and publication checks.',
  'Docker backing-store free capacity is not exposed by this portable read-only observation.',
  'Docker socket and context access remain privileged caller-controlled trust boundaries.',
  'PATH-selected Git and Docker executable bytes plus local repository and Docker configuration are caller-controlled trusted-local inputs.',
  'A unix:// endpoint establishes local transport, not daemon identity; its socket can proxy or be replaced.',
  'Stopped-container labels are forgeable cleanup eligibility, not authenticated ownership.',
  'Access and statfs observations do not cover inode, quota, thin-provisioning, or backing-store exhaustion.',
  'Image provenance, signature, bootstrap Node behavior, emulation, registry, TLS, DNS, dependency installation, build success, and proof execution are not verified.',
  'Host access, statfs, repository, image, container, and output-path state can change immediately after observation.',
  'A later bounded proof uses unrestricted bridge networking and can contact external services.',
]);
const CREATED_REPORTS = new WeakSet();

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

/** @param {unknown} value @param {string} valuePath @returns {Record<string, any>} */
function exactObject(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  return value;
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

/** @param {unknown} value @param {string} valuePath @returns {string} */
function validateDecimal(value, valuePath) {
  if (
    typeof value !== 'string' ||
    !DECIMAL_PATTERN.test(value) ||
    BigInt(value) < 0n
  ) {
    throw new TypeError(`${valuePath} must be a canonical decimal integer.`);
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function validateDigest(value, valuePath) {
  const digest = exactObject(value, valuePath);
  assertExactKeys(digest, DIGEST_KEYS, valuePath);
  if (digest.algorithm !== 'sha256') {
    throw new TypeError(`${valuePath}.algorithm must be sha256.`);
  }
  assertSha256Base64Url(digest.value, `${valuePath}.value`);
  return deepFreeze({
    algorithm: /** @type {'sha256'} */ ('sha256'),
    value: digest.value,
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>> | null} */
function validateNullableByteObservation(value, valuePath) {
  if (value === null) return null;
  const observation = exactObject(value, valuePath);
  assertExactKeys(observation, BYTE_OBSERVATION_KEYS, valuePath);
  if (
    !Number.isSafeInteger(observation.size) ||
    observation.size < 1 ||
    observation.size > MAX_TOOLING_BYTES
  ) {
    throw new TypeError(`${valuePath}.size is outside the tooling byte bound.`);
  }
  return deepFreeze({
    byteDigest: validateDigest(
      observation.byteDigest,
      `${valuePath}.byteDigest`,
    ),
    size: observation.size,
  });
}

/** @param {Readonly<Record<string, any>> | null} left @param {Readonly<Record<string, any>> | null} right @returns {boolean} */
function sameByteObservation(left, right) {
  return (
    left !== null &&
    right !== null &&
    left.size === right.size &&
    left.byteDigest.value === right.byteDigest.value
  );
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateRepositoryObservation(value, valuePath) {
  const repository = exactObject(value, valuePath);
  if (repository.state === 'unobservable') {
    assertExactKeys(repository, UNOBSERVABLE_KEYS, valuePath);
    return deepFreeze({ state: 'unobservable' });
  }
  assertExactKeys(repository, REPOSITORY_KEYS, valuePath);
  if (
    repository.state !== 'observed' ||
    typeof repository.commit !== 'string' ||
    !COMMIT_PATTERN.test(repository.commit) ||
    !['clean', 'dirty'].includes(repository.worktree) ||
    !Array.isArray(repository.tooling) ||
    repository.tooling.length !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS.length
  ) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  const tooling = repository.tooling.map((candidate, index) => {
    const toolingPath = `${valuePath}.tooling[${index}]`;
    const observation = exactObject(candidate, toolingPath);
    assertExactKeys(observation, TOOLING_KEYS, toolingPath);
    const logicalPath =
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_TOOLING_PATHS[
        index
      ];
    if (
      observation.logicalPath !== logicalPath ||
      !['regular-blob', 'invalid'].includes(observation.treeEntry) ||
      !['safe-regular', 'unsafe'].includes(observation.liveFile) ||
      typeof observation.matchesHead !== 'boolean'
    ) {
      throw new TypeError(`${toolingPath} is invalid.`);
    }
    const committedBytes = validateNullableByteObservation(
      observation.committedBytes,
      `${toolingPath}.committedBytes`,
    );
    const liveBytes = validateNullableByteObservation(
      observation.liveBytes,
      `${toolingPath}.liveBytes`,
    );
    if (
      (observation.treeEntry === 'regular-blob') !==
        (committedBytes !== null) ||
      (observation.liveFile === 'safe-regular') !== (liveBytes !== null) ||
      observation.matchesHead !==
        (observation.treeEntry === 'regular-blob' &&
          observation.liveFile === 'safe-regular' &&
          sameByteObservation(committedBytes, liveBytes))
    ) {
      throw new TypeError(`${toolingPath} has inconsistent byte evidence.`);
    }
    return deepFreeze({
      logicalPath,
      treeEntry: observation.treeEntry,
      liveFile: observation.liveFile,
      committedBytes,
      liveBytes,
      matchesHead: observation.matchesHead,
    });
  });
  return deepFreeze({
    state: 'observed',
    commit: repository.commit,
    worktree: repository.worktree,
    tooling,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateEndpointObservation(value) {
  const endpoint = exactObject(value, 'Docker endpoint observation');
  if (endpoint.state === 'unobservable') {
    assertExactKeys(endpoint, UNOBSERVABLE_KEYS, 'Docker endpoint observation');
    return deepFreeze({ state: 'unobservable' });
  }
  assertExactKeys(endpoint, ENDPOINT_KEYS, 'Docker endpoint observation');
  if (
    endpoint.state !== 'observed' ||
    !['local-unix', 'remote-or-unsupported'].includes(endpoint.locality)
  ) {
    throw new TypeError('Docker endpoint observation is invalid.');
  }
  return deepFreeze({
    state: 'observed',
    locality: endpoint.locality,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateDaemonObservation(value) {
  const daemon = exactObject(value, 'Docker daemon observation');
  if (daemon.state === 'unobservable') {
    assertExactKeys(daemon, UNOBSERVABLE_KEYS, 'Docker daemon observation');
    return deepFreeze({ state: 'unobservable' });
  }
  assertExactKeys(daemon, DAEMON_KEYS, 'Docker daemon observation');
  if (
    daemon.state !== 'observed' ||
    typeof daemon.operatingSystem !== 'string' ||
    !SMALL_TOKEN_PATTERN.test(daemon.operatingSystem) ||
    typeof daemon.architecture !== 'string' ||
    !SMALL_TOKEN_PATTERN.test(daemon.architecture) ||
    !['native', 'emulated', 'unsupported'].includes(daemon.executionMode) ||
    !Number.isSafeInteger(daemon.cpuCount) ||
    daemon.cpuCount < 1 ||
    daemon.cpuCount > 65_536 ||
    typeof daemon.serverVersion !== 'string' ||
    !SERVER_VERSION_PATTERN.test(daemon.serverVersion)
  ) {
    throw new TypeError('Docker daemon observation is invalid.');
  }
  validateDecimal(daemon.memoryBytes, 'Docker daemon observation.memoryBytes');
  const expectedMode = ['amd64', 'x86_64'].includes(daemon.architecture)
    ? 'native'
    : ['arm64', 'aarch64'].includes(daemon.architecture)
      ? 'emulated'
      : 'unsupported';
  if (daemon.executionMode !== expectedMode) {
    throw new TypeError(
      'Docker daemon execution mode does not match its architecture.',
    );
  }
  return deepFreeze({
    state: 'observed',
    operatingSystem: daemon.operatingSystem,
    architecture: daemon.architecture,
    executionMode: daemon.executionMode,
    cpuCount: daemon.cpuCount,
    memoryBytes: daemon.memoryBytes,
    serverVersion: daemon.serverVersion,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateImageObservation(value) {
  const image = exactObject(value, 'Docker image observation');
  if (image.state === 'unobservable') {
    assertExactKeys(image, UNOBSERVABLE_KEYS, 'Docker image observation');
    return deepFreeze({ state: 'unobservable' });
  }
  assertExactKeys(image, IMAGE_KEYS, 'Docker image observation');
  if (
    image.state !== 'observed' ||
    typeof image.id !== 'string' ||
    !IMAGE_ID_PATTERN.test(image.id) ||
    typeof image.operatingSystem !== 'string' ||
    !SMALL_TOKEN_PATTERN.test(image.operatingSystem) ||
    typeof image.architecture !== 'string' ||
    !SMALL_TOKEN_PATTERN.test(image.architecture)
  ) {
    throw new TypeError('Docker image observation is invalid.');
  }
  return deepFreeze({
    state: 'observed',
    id: image.id,
    operatingSystem: image.operatingSystem,
    architecture: image.architecture,
    rootfsDigest: validateDigest(
      image.rootfsDigest,
      'Docker image observation.rootfsDigest',
    ),
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateContainerObservation(value) {
  const container = exactObject(value, 'Docker container observation');
  if (container.state === 'unobservable' || container.state === 'absent') {
    assertExactKeys(
      container,
      CONTAINER_ABSENT_KEYS,
      'Docker container observation',
    );
    return deepFreeze({ state: container.state });
  }
  assertExactKeys(container, CONTAINER_KEYS, 'Docker container observation');
  if (
    container.state !== 'observed' ||
    typeof container.containerId !== 'string' ||
    !CONTAINER_ID_PATTERN.test(container.containerId) ||
    !['running', 'stopped'].includes(container.runtimeState) ||
    !['running-owned', 'stopped-owned-reconcilable', 'foreign'].includes(
      container.collisionClass,
    ) ||
    (container.collisionClass === 'running-owned' &&
      container.runtimeState !== 'running') ||
    (container.collisionClass === 'stopped-owned-reconcilable' &&
      container.runtimeState !== 'stopped')
  ) {
    throw new TypeError('Docker container observation is invalid.');
  }
  return deepFreeze({
    state: 'observed',
    containerId: container.containerId,
    runtimeState: container.runtimeState,
    collisionClass: container.collisionClass,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateHostTempObservation(value) {
  const filesystem = exactObject(value, 'host temp observation');
  if (filesystem.state === 'unobservable' || filesystem.state === 'unsafe') {
    assertExactKeys(filesystem, UNOBSERVABLE_KEYS, 'host temp observation');
    return deepFreeze({ state: filesystem.state });
  }
  assertExactKeys(filesystem, FILESYSTEM_KEYS, 'host temp observation');
  if (
    filesystem.state !== 'observed' ||
    typeof filesystem.writable !== 'boolean'
  ) {
    throw new TypeError('host temp observation is invalid.');
  }
  validateDecimal(filesystem.device, 'host temp observation.device');
  validateDecimal(
    filesystem.availableBytes,
    'host temp observation.availableBytes',
  );
  return deepFreeze({
    state: 'observed',
    writable: filesystem.writable,
    device: filesystem.device,
    availableBytes: filesystem.availableBytes,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateOutputObservation(value) {
  const output = exactObject(value, 'output filesystem observation');
  if (output.state === 'unobservable' || output.state === 'unsafe') {
    assertExactKeys(output, UNOBSERVABLE_KEYS, 'output filesystem observation');
    return deepFreeze({ state: output.state });
  }
  assertExactKeys(output, OUTPUT_KEYS, 'output filesystem observation');
  if (
    output.state !== 'observed' ||
    !['existing', 'absent'].includes(output.rootState) ||
    !['absent', 'present'].includes(output.proofCommitPath) ||
    typeof output.writable !== 'boolean'
  ) {
    throw new TypeError('output filesystem observation is invalid.');
  }
  validateDecimal(output.device, 'output filesystem observation.device');
  validateDecimal(
    output.availableBytes,
    'output filesystem observation.availableBytes',
  );
  return deepFreeze({
    state: 'observed',
    rootState: output.rootState,
    proofCommitPath: output.proofCommitPath,
    writable: output.writable,
    device: output.device,
    availableBytes: output.availableBytes,
  });
}

/** @param {unknown} value @returns {string} */
function validateObservedAt(value) {
  if (
    typeof value !== 'string' ||
    !OBSERVED_AT_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError(
      'Docker readiness observedAt must be one canonical UTC timestamp.',
    );
  }
  return value;
}

/** @param {unknown} value @returns {Readonly<{imageId: string, outputRoot: string}>} */
function validateInput(value) {
  const input = exactObject(value, 'Docker readiness input');
  assertExactKeys(input, INPUT_KEYS, 'Docker readiness input');
  if (
    typeof input.imageId !== 'string' ||
    !IMAGE_ID_PATTERN.test(input.imageId)
  ) {
    throw new TypeError(
      'Docker readiness imageId must be one immutable lowercase sha256 image ID.',
    );
  }
  if (
    typeof input.outputRoot !== 'string' ||
    input.outputRoot.length < 2 ||
    input.outputRoot.length > 4096 ||
    input.outputRoot.trim() !== input.outputRoot ||
    input.outputRoot.includes('\0') ||
    input.outputRoot.includes('\n') ||
    input.outputRoot.includes('\r') ||
    !path.isAbsolute(input.outputRoot) ||
    path.normalize(input.outputRoot) !== input.outputRoot ||
    path.parse(input.outputRoot).root === input.outputRoot
  ) {
    throw new TypeError(
      'Docker readiness outputRoot must be one canonical absolute non-root path.',
    );
  }
  return deepFreeze({
    imageId: input.imageId,
    outputRoot: input.outputRoot,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, Function>>} */
function capturePorts(value) {
  const ports = exactObject(value, 'Docker readiness ports');
  assertExactKeys(ports, PORT_KEYS, 'Docker readiness ports');
  /** @type {Record<string, Function>} */
  const captured = {};
  for (const key of PORT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(ports, key);
    if (
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(
        `Docker readiness ports.${key} must be an own data function.`,
      );
    }
    captured[key] = descriptor.value.bind(ports);
  }
  return Object.freeze(captured);
}

/** @param {unknown} value @param {string} label @returns {Record<string, any>} */
function snapshotPortResult(value, label) {
  return cloneBoundedJsonObject(value, MAX_PORT_RESULT_BYTES, label);
}

/** @param {Set<string>} values @param {string} code @returns {void} */
function addFixedCode(values, code) {
  if (!BLOCKER_CODES.has(code) && !ADVISORY_CODES.has(code)) {
    throw new Error('Docker readiness attempted to publish an unknown code.');
  }
  values.add(code);
}

/** @param {Readonly<Record<string, any>>} repository @param {Set<string>} blockers @returns {void} */
function assessRepositorySnapshot(repository, blockers) {
  if (repository.state === 'unobservable') {
    addFixedCode(blockers, 'REPOSITORY_UNOBSERVABLE');
    return;
  }
  if (repository.worktree === 'dirty') {
    addFixedCode(blockers, 'REPOSITORY_DIRTY');
  }
  for (const tooling of repository.tooling) {
    if (tooling.treeEntry !== 'regular-blob') {
      addFixedCode(blockers, 'TOOLING_TREE_ENTRY_INVALID');
    }
    if (tooling.liveFile !== 'safe-regular') {
      addFixedCode(blockers, 'TOOLING_LIVE_FILE_UNSAFE');
    }
    if (!tooling.matchesHead) {
      addFixedCode(blockers, 'TOOLING_BYTES_MISMATCH');
    }
  }
}

/** @param {Readonly<Record<string, any>>} image @param {string} requestedImageId @param {Set<string>} blockers @returns {void} */
function assessImage(image, requestedImageId, blockers) {
  if (image.state === 'unobservable') {
    addFixedCode(blockers, 'IMAGE_NOT_OBSERVED_LOCAL');
    return;
  }
  if (image.id !== requestedImageId) {
    addFixedCode(blockers, 'IMAGE_ID_MISMATCH');
  }
  if (image.operatingSystem !== 'linux' || image.architecture !== 'amd64') {
    addFixedCode(blockers, 'IMAGE_PLATFORM_UNSUPPORTED');
  }
}

/**
 * Construct the closed readiness inspector around semantic read-only ports.
 * The port contract grants no run, create, remove, publish, reconcile, or
 * other mutation operation over a Docker object or filesystem path.
 * @param {unknown} optionsValue
 * @returns {Readonly<{inspect: (input: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector(
  optionsValue,
) {
  const options = exactObject(optionsValue, 'Docker readiness options');
  assertExactKeys(options, OPTIONS_KEYS, 'Docker readiness options');
  const ports = capturePorts(options.ports);

  return Object.freeze({
    async inspect(inputValue) {
      const input = validateInput(inputValue);
      const observedAt = validateObservedAt(await ports.readObservedAt());

      const repositoryInitial = validateRepositoryObservation(
        snapshotPortResult(
          await ports.observeRepository(),
          'initial repository observation',
        ),
        'initial repository observation',
      );
      const sourceCommit =
        repositoryInitial.state === 'observed'
          ? repositoryInitial.commit
          : null;
      const toolingCommit = sourceCommit;
      const containerName =
        sourceCommit === null
          ? null
          : `${CONTAINER_NAME_PREFIX}${sourceCommit}`;

      const dockerEndpoint = validateEndpointObservation(
        snapshotPortResult(
          await ports.observeDockerEndpoint(),
          'Docker endpoint observation',
        ),
      );
      const endpointIsLocal =
        dockerEndpoint.state === 'observed' &&
        dockerEndpoint.locality === 'local-unix';
      const unavailable = deepFreeze({ state: 'unobservable' });

      const daemon = endpointIsLocal
        ? validateDaemonObservation(
            snapshotPortResult(
              await ports.observeDockerDaemon(),
              'Docker daemon observation',
            ),
          )
        : unavailable;
      const imageInitial = endpointIsLocal
        ? validateImageObservation(
            snapshotPortResult(
              await ports.observeDockerImage(
                deepFreeze({ imageId: input.imageId }),
              ),
              'initial Docker image observation',
            ),
          )
        : unavailable;
      const container =
        endpointIsLocal && sourceCommit !== null && containerName !== null
          ? validateContainerObservation(
              snapshotPortResult(
                await ports.observeDockerContainer(
                  deepFreeze({
                    imageId: input.imageId,
                    sourceCommit,
                    toolingCommit,
                    containerName,
                  }),
                ),
                'Docker container observation',
              ),
            )
          : unavailable;
      const hostTemp = validateHostTempObservation(
        snapshotPortResult(
          await ports.observeHostTemp(),
          'host temp observation',
        ),
      );
      const output = validateOutputObservation(
        snapshotPortResult(
          await ports.observeOutput(
            deepFreeze({
              outputRoot: input.outputRoot,
              sourceCommit,
            }),
          ),
          'output filesystem observation',
        ),
      );
      const imageFinal = endpointIsLocal
        ? validateImageObservation(
            snapshotPortResult(
              await ports.observeDockerImage(
                deepFreeze({ imageId: input.imageId }),
              ),
              'final Docker image observation',
            ),
          )
        : unavailable;
      const repositoryFinal = validateRepositoryObservation(
        snapshotPortResult(
          await ports.observeRepository(),
          'final repository observation',
        ),
        'final repository observation',
      );

      const repositoryStable = sameJson(repositoryInitial, repositoryFinal);
      const imageStable = sameJson(imageInitial, imageFinal);
      const filesystemTopology =
        hostTemp.state === 'observed' && output.state === 'observed'
          ? hostTemp.device === output.device
            ? 'shared'
            : 'distinct'
          : 'unobservable';
      const publicHostTemp =
        hostTemp.state === 'observed'
          ? deepFreeze({
              state: 'observed',
              writable: hostTemp.writable,
              availableBytes: hostTemp.availableBytes,
            })
          : hostTemp;
      const publicOutput =
        output.state === 'observed'
          ? deepFreeze({
              state: 'observed',
              rootState: output.rootState,
              proofCommitPath: output.proofCommitPath,
              writable: output.writable,
              availableBytes: output.availableBytes,
            })
          : output;

      const blockers = new Set();
      const advisories = new Set([
        'DOCKER_BACKING_STORE_CAPACITY_UNOBSERVED',
        'POINT_IN_TIME_ONLY',
        'UNRESTRICTED_FUTURE_NETWORK',
      ]);

      assessRepositorySnapshot(repositoryInitial, blockers);
      assessRepositorySnapshot(repositoryFinal, blockers);
      if (!repositoryStable) {
        addFixedCode(blockers, 'REPOSITORY_CHANGED_DURING_ASSESSMENT');
      }

      if (dockerEndpoint.state === 'unobservable') {
        addFixedCode(blockers, 'DOCKER_ENDPOINT_UNOBSERVABLE');
      } else if (dockerEndpoint.locality !== 'local-unix') {
        addFixedCode(blockers, 'DOCKER_ENDPOINT_NOT_LOCAL');
      }

      if (daemon.state === 'unobservable') {
        addFixedCode(blockers, 'DOCKER_DAEMON_UNOBSERVABLE');
      } else {
        if (daemon.operatingSystem !== 'linux') {
          addFixedCode(blockers, 'DOCKER_DAEMON_OS_UNSUPPORTED');
        }
        if (daemon.executionMode === 'unsupported') {
          addFixedCode(blockers, 'DOCKER_DAEMON_ARCHITECTURE_UNSUPPORTED');
        } else if (daemon.executionMode === 'emulated') {
          addFixedCode(advisories, 'EMULATED_AMD64_EXECUTION');
        }
        if (BigInt(daemon.memoryBytes) < DAEMON_MEMORY_BYTES) {
          addFixedCode(blockers, 'DOCKER_DAEMON_MEMORY_INSUFFICIENT');
        }
        if (daemon.cpuCount < REQUESTED_CPU_COUNT) {
          addFixedCode(advisories, 'DAEMON_CPU_BELOW_REQUESTED_CAP');
        }
      }

      assessImage(imageInitial, input.imageId, blockers);
      assessImage(imageFinal, input.imageId, blockers);
      if (!imageStable) {
        addFixedCode(blockers, 'IMAGE_CHANGED_DURING_ASSESSMENT');
      }

      if (container.state === 'unobservable') {
        addFixedCode(blockers, 'CONTAINER_COLLISION_UNOBSERVABLE');
      } else if (container.state === 'observed') {
        if (container.collisionClass === 'running-owned') {
          addFixedCode(blockers, 'CONCURRENT_PROOF_RUNNING');
        } else if (container.collisionClass === 'stopped-owned-reconcilable') {
          addFixedCode(advisories, 'OWNED_STOPPED_RESIDUE_RECONCILABLE');
        } else {
          addFixedCode(blockers, 'FOREIGN_CONTAINER_NAME_COLLISION');
        }
      }

      if (hostTemp.state === 'unobservable') {
        addFixedCode(blockers, 'HOST_TEMP_FILESYSTEM_UNOBSERVABLE');
      } else if (hostTemp.state === 'unsafe') {
        addFixedCode(blockers, 'HOST_TEMP_PATH_UNSAFE');
      } else if (!hostTemp.writable) {
        addFixedCode(blockers, 'HOST_TEMP_NOT_WRITABLE');
      }

      if (output.state === 'unobservable') {
        addFixedCode(blockers, 'OUTPUT_FILESYSTEM_UNOBSERVABLE');
      } else if (output.state === 'unsafe') {
        addFixedCode(blockers, 'OUTPUT_PATH_UNSAFE');
      } else {
        if (!output.writable) {
          addFixedCode(blockers, 'OUTPUT_PARENT_NOT_WRITABLE');
        }
        if (output.proofCommitPath === 'present') {
          addFixedCode(blockers, 'OUTPUT_COMMIT_COLLISION');
        }
        if (output.rootState === 'absent') {
          addFixedCode(advisories, 'OUTPUT_ROOT_WILL_BE_CREATED');
        }
      }

      if (hostTemp.state === 'observed' && output.state === 'observed') {
        const hostAvailable = BigInt(hostTemp.availableBytes);
        const outputAvailable = BigInt(output.availableBytes);
        if (filesystemTopology === 'shared') {
          const effectiveAvailable =
            hostAvailable < outputAvailable ? hostAvailable : outputAvailable;
          if (
            effectiveAvailable <
            HOST_TEMP_MINIMUM_AVAILABLE_BYTES + OUTPUT_MINIMUM_AVAILABLE_BYTES
          ) {
            addFixedCode(blockers, 'SHARED_HOST_FILESYSTEM_SPACE_INSUFFICIENT');
          }
        } else {
          if (hostAvailable < HOST_TEMP_MINIMUM_AVAILABLE_BYTES) {
            addFixedCode(blockers, 'HOST_TEMP_SPACE_INSUFFICIENT');
          }
          if (outputAvailable < OUTPUT_MINIMUM_AVAILABLE_BYTES) {
            addFixedCode(blockers, 'OUTPUT_SPACE_INSUFFICIENT');
          }
        }
      }

      const sortedBlockers = Object.freeze([...blockers].sort());
      const sortedAdvisories = Object.freeze([...advisories].sort());
      const report = sortCanonicalJsonValue({
        schemaVersion:
          AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SCHEMA_VERSION,
        kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_KIND,
        safetyClass:
          AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SAFETY_CLASS,
        authority: 'none',
        authoritative: false,
        observedAt,
        freshness: 'point-in-time-only',
        subject: {
          sourceCommit,
          toolingCommit,
          imageId: input.imageId,
          outputRootDigest: {
            algorithm: 'sha256',
            value: sha256Base64Url(input.outputRoot),
          },
          containerName,
        },
        requirements: {
          imagePlatform: 'linux/amd64',
          daemonMemoryBytes: DAEMON_MEMORY_BYTES.toString(),
          requestedCpuCount: REQUESTED_CPU_COUNT,
          pidsLimit: PIDS_LIMIT,
          workTmpfsBytes: WORK_TMPFS_BYTES.toString(),
          tempTmpfsBytes: TEMP_TMPFS_BYTES.toString(),
          wallClockLimitMilliseconds: WALL_CLOCK_LIMIT_MILLISECONDS,
          gitBundleMaximumBytes: GIT_BUNDLE_MAXIMUM_BYTES.toString(),
          toolingExportMaximumBytes: TOOLING_EXPORT_MAXIMUM_BYTES.toString(),
          hostTempMinimumAvailableBytes:
            HOST_TEMP_MINIMUM_AVAILABLE_BYTES.toString(),
          outputMinimumAvailableBytes:
            OUTPUT_MINIMUM_AVAILABLE_BYTES.toString(),
        },
        observations: {
          repository: {
            initial: repositoryInitial,
            final: repositoryFinal,
            stable: repositoryStable,
          },
          dockerEndpoint,
          daemon,
          image: {
            initial: imageInitial,
            final: imageFinal,
            stable: imageStable,
          },
          containerName: container,
          hostTemp: publicHostTemp,
          output: publicOutput,
          filesystemTopology,
        },
        readyForBoundedAttempt: sortedBlockers.length === 0,
        blockers: sortedBlockers,
        advisories: sortedAdvisories,
        limitations: [...LIMITATIONS],
      });
      assertManifestIsSecretFree(report, 'Docker readiness report');
      const bytes = Buffer.byteLength(JSON.stringify(report), 'utf8');
      if (
        bytes < 1 ||
        bytes >
          AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_MAX_BYTES
      ) {
        throw new TypeError('Docker readiness report exceeds its byte limit.');
      }
      const frozenReport = deepFreeze(report);
      CREATED_REPORTS.add(frozenReport);
      return frozenReport;
    },
  });
}

/** @param {unknown} value @returns {Readonly<{imageId: string, outputRoot: string}>} */
export function parseAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessArguments(
  value,
) {
  const expectedKeys = new Set(['0', '1', '2', '3', 'length']);
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new TypeError(
      'Usage: inspect-aws-host-retained-storage-host-preflight-sea-linux-docker-readiness <sha256-image-id> <absolute-output-root>',
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
  ) {
    throw new TypeError(
      'Usage: inspect-aws-host-retained-storage-host-preflight-sea-linux-docker-readiness <sha256-image-id> <absolute-output-root>',
    );
  }
  const descriptors = ['0', '1', '2', '3'].map((key) =>
    Object.getOwnPropertyDescriptor(value, key),
  );
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor?.value !== 4 ||
    descriptors.some(
      (descriptor) =>
        !descriptor?.enumerable ||
        !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'string',
    )
  ) {
    throw new TypeError(
      'Usage: inspect-aws-host-retained-storage-host-preflight-sea-linux-docker-readiness <sha256-image-id> <absolute-output-root>',
    );
  }
  const imageIdDescriptor = descriptors[2];
  const outputRootDescriptor = descriptors[3];
  if (
    imageIdDescriptor === undefined ||
    outputRootDescriptor === undefined ||
    typeof imageIdDescriptor.value !== 'string' ||
    typeof outputRootDescriptor.value !== 'string'
  ) {
    throw new TypeError(
      'Usage: inspect-aws-host-retained-storage-host-preflight-sea-linux-docker-readiness <sha256-image-id> <absolute-output-root>',
    );
  }
  return validateInput({
    imageId: imageIdDescriptor.value,
    outputRoot: outputRootDescriptor.value,
  });
}

/** @param {unknown} value @returns {string} */
export function stringifyAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessReport(
  value,
) {
  if (!isPlainObject(value) || !CREATED_REPORTS.has(value)) {
    throw new TypeError(
      'Docker readiness serializer accepts only a report created by this inspector instance.',
    );
  }
  const report = cloneBoundedJsonObject(
    value,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_MAX_BYTES,
    'Docker readiness report',
  );
  assertExactKeys(report, REPORT_KEYS, 'Docker readiness report');
  if (
    report.schemaVersion !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SCHEMA_VERSION ||
    report.kind !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_KIND ||
    report.safetyClass !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_SAFETY_CLASS ||
    report.authority !== 'none' ||
    report.authoritative !== false ||
    report.freshness !== 'point-in-time-only' ||
    typeof report.readyForBoundedAttempt !== 'boolean' ||
    !Array.isArray(report.blockers) ||
    report.blockers.some((code) => !BLOCKER_CODES.has(code)) ||
    !Array.isArray(report.advisories) ||
    report.advisories.some((code) => !ADVISORY_CODES.has(code)) ||
    !Array.isArray(report.limitations) ||
    !sameJson(report.limitations, LIMITATIONS)
  ) {
    throw new TypeError('Docker readiness report is invalid.');
  }
  validateObservedAt(report.observedAt);
  if (
    report.readyForBoundedAttempt !== (report.blockers.length === 0) ||
    !sameJson(report.blockers, [...new Set(report.blockers)].sort()) ||
    !sameJson(report.advisories, [...new Set(report.advisories)].sort())
  ) {
    throw new TypeError('Docker readiness decision is inconsistent.');
  }
  assertManifestIsSecretFree(report, 'Docker readiness report');
  const encoded = `${JSON.stringify(sortCanonicalJsonValue(report))}\n`;
  if (
    Buffer.byteLength(encoded, 'utf8') >
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_DOCKER_READINESS_MAX_BYTES
  ) {
    throw new TypeError('Docker readiness report exceeds its byte limit.');
  }
  return encoded;
}

export default createAwsRetainedStorageHostPreflightSeaLinuxDockerReadinessInspector;
