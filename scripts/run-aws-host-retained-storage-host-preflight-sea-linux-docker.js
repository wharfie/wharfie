/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This bounded proof driver keeps its exact injected-port and observation protocols inline. */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  constants as fsConstants,
  createReadStream,
  promises as fsp,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import { cloneBoundedJsonObject } from '../src/core/runtime/json-value.js';
import { assertManifestIsSecretFree } from '../src/core/runtime/manifest-security.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_DRIVER_PATH,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_MAX_BYTES,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_PROTOCOL_PATH,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_VERIFIER_PATH,
  createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt,
  stringifyAwsRetainedStorageHostPreflightSeaLinuxProofReceipt,
  validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt,
} from './aws-host-retained-storage-host-preflight-sea-linux-proof.js';

const DRIVER_REPOSITORY_PATH =
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_DRIVER_PATH;
const VERIFIER_REPOSITORY_PATH =
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_VERIFIER_PATH;
const PROTOCOL_REPOSITORY_PATH =
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_PROTOCOL_PATH;
const PROOF_KIND = 'aws-retained-storage-host-preflight-sea-linux-docker-proof';
const CONTAINER_NAME_PREFIX = 'wharfie-sea-proof-';
const CONTAINER_LABEL_KIND = 'org.wharfie.proof.kind';
const CONTAINER_LABEL_SOURCE = 'org.wharfie.proof.sourceCommit';
const CONTAINER_LABEL_TOOLING = 'org.wharfie.proof.toolingCommit';
const CONTAINER_LABEL_INVOCATION = 'org.wharfie.proof.invocationId';
const CONTAINER_INPUT_DIRECTORY = '/wharfie-input';
const CONTAINER_WORK_DIRECTORY = '/wharfie-work';
const CONTAINER_VERIFIER_PATH = `${CONTAINER_INPUT_DIRECTORY}/verifier.js`;
const IMAGE_ID_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/u;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/u;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_TOOLING_BYTES = 2 * 1024 * 1024;
const MAX_GIT_BUNDLE_BYTES = 128 * 1024 * 1024;
const MAX_GUEST_DRAFT_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES =
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_PROOF_MAX_BYTES;
const DEFAULT_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;
const PROOF_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const COMMAND_REAP_TIMEOUT_MS = 10 * 1000;
const DOCKER_IDENTITY_SETTLE_TIMEOUT_MS = 5 * 1000;
const DOCKER_IDENTITY_POLL_INTERVAL_MS = 100;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o400;

const INPUT_KEYS = new Set(['imageId', 'outputRoot']);
const TEST_OPTIONS_KEYS = new Set(['ports']);
const PORT_KEYS = new Set([
  'readRepository',
  'createInvocationId',
  'inspectImage',
  'observeExecutionMode',
  'inspectContainer',
  'removeContainer',
  'prepareWorkspace',
  'createGitBundle',
  'exportTooling',
  'observeFile',
  'runContainer',
  'removeTree',
  'createReceipt',
  'publishReceipt',
]);
const REPOSITORY_KEYS = new Set(['root', 'sourceCommit', 'toolingCommit']);
const WORKSPACE_KEYS = new Set(['root', 'inputDirectory']);
const IMAGE_KEYS = new Set(['id', 'platform', 'architecture', 'rootfsDigest']);
const FILE_OBSERVATION_KEYS = new Set(['byteDigest', 'size']);
const DIGEST_KEYS = new Set(['algorithm', 'value']);
const CONTAINER_OBSERVATION_KEYS = new Set([
  'containerId',
  'name',
  'imageId',
  'labels',
  'state',
]);
const RUN_RESULT_KEYS = new Set(['status', 'guestDraft', 'containerId']);
const BUNDLE_RESULT_KEYS = new Set([
  'format',
  'headCommit',
  'prerequisiteCount',
]);
const RECEIPT_RESULT_KEYS = new Set(['receipt', 'bytes']);
const GUEST_DRAFT_KEYS = new Set([
  'subject',
  'builderClaims',
  'independentObservations',
]);
const GUEST_CLEANUP_KEYS = new Set(['guestWork']);
const GUEST_WORK_KEYS = new Set(['invocationId', 'removed']);
const PUBLICATION_KEYS = new Set([
  'proofPath',
  'checksumPath',
  'outputDirectory',
]);

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
  if (
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalAbsolutePath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    path.parse(value).root === value
  ) {
    throw new TypeError(
      `${valuePath} must be a canonical absolute non-root path.`,
    );
  }
  return value;
}

/** @param {unknown} value @returns {Readonly<{imageId: string, outputRoot: string}>} */
function validateInput(value) {
  const input = exactObject(
    value,
    'AWS retained-storage host preflight SEA Linux Docker proof input',
  );
  assertExactKeys(
    input,
    INPUT_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker proof input',
  );
  if (
    typeof input.imageId !== 'string' ||
    !IMAGE_ID_PATTERN.test(input.imageId)
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker proof imageId must be one exact local sha256 image ID.',
    );
  }
  return Object.freeze({
    imageId: input.imageId,
    outputRoot: canonicalAbsolutePath(
      input.outputRoot,
      'AWS retained-storage host preflight SEA Linux Docker proof outputRoot',
    ),
  });
}

/** @param {unknown} value @returns {Readonly<{root: string, sourceCommit: string, toolingCommit: string}>} */
function validateRepository(value) {
  const repository = exactObject(
    value,
    'AWS retained-storage host preflight SEA Linux Docker proof repository',
  );
  assertExactKeys(
    repository,
    REPOSITORY_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker proof repository',
  );
  const root = canonicalAbsolutePath(
    repository.root,
    'AWS retained-storage host preflight SEA Linux Docker proof repository.root',
  );
  if (
    typeof repository.sourceCommit !== 'string' ||
    !COMMIT_PATTERN.test(repository.sourceCommit) ||
    repository.toolingCommit !== repository.sourceCommit
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker proof requires one clean exact HEAD for source and tooling.',
    );
  }
  return Object.freeze({
    root,
    sourceCommit: repository.sourceCommit,
    toolingCommit: repository.toolingCommit,
  });
}

/** @param {unknown} value @returns {Readonly<{root: string, inputDirectory: string}>} */
function validateWorkspace(value) {
  const workspace = exactObject(
    value,
    'AWS retained-storage host preflight SEA Linux Docker proof workspace',
  );
  assertExactKeys(
    workspace,
    WORKSPACE_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker proof workspace',
  );
  const root = canonicalAbsolutePath(
    workspace.root,
    'AWS retained-storage host preflight SEA Linux Docker proof workspace.root',
  );
  const inputDirectory = canonicalAbsolutePath(
    workspace.inputDirectory,
    'AWS retained-storage host preflight SEA Linux Docker proof workspace.inputDirectory',
  );
  const relativeInput = path.relative(root, inputDirectory);
  if (
    root.includes(',') ||
    inputDirectory.includes(',') ||
    relativeInput.length === 0 ||
    relativeInput.startsWith('..') ||
    path.isAbsolute(relativeInput)
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker proof input directory must be a descendant of its private root.',
    );
  }
  return Object.freeze({ root, inputDirectory });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function validateDigest(value, valuePath) {
  const digest = exactObject(value, valuePath);
  assertExactKeys(digest, DIGEST_KEYS, valuePath);
  if (
    digest.algorithm !== 'sha256' ||
    typeof digest.value !== 'string' ||
    !SHA256_BASE64URL_PATTERN.test(digest.value)
  ) {
    throw new TypeError(`${valuePath} must be one canonical SHA-256 digest.`);
  }
  return Object.freeze({
    algorithm: /** @type {'sha256'} */ ('sha256'),
    value: digest.value,
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<{byteDigest: Readonly<{algorithm: 'sha256', value: string}>, size: number}>} */
function validateFileObservation(value, valuePath) {
  const observation = exactObject(value, valuePath);
  assertExactKeys(observation, FILE_OBSERVATION_KEYS, valuePath);
  if (
    typeof observation.size !== 'number' ||
    !Number.isSafeInteger(observation.size) ||
    observation.size < 1
  ) {
    throw new TypeError(`${valuePath}.size must be a positive safe integer.`);
  }
  return deepFreeze({
    byteDigest: validateDigest(
      observation.byteDigest,
      `${valuePath}.byteDigest`,
    ),
    size: observation.size,
  });
}

/** @param {unknown} value @param {string} sourceCommit @returns {Readonly<{format: 'git-bundle-complete-head-v1', headCommit: string, prerequisiteCount: 0}>} */
function validateBundleResult(value, sourceCommit) {
  const result = exactObject(
    value,
    'AWS retained-storage host preflight SEA Linux Docker Git bundle result',
  );
  assertExactKeys(
    result,
    BUNDLE_RESULT_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker Git bundle result',
  );
  if (
    result.format !== 'git-bundle-complete-head-v1' ||
    result.headCommit !== sourceCommit ||
    result.prerequisiteCount !== 0
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker Git bundle is not one complete exact HEAD transport.',
    );
  }
  return Object.freeze({
    format: /** @type {'git-bundle-complete-head-v1'} */ (
      'git-bundle-complete-head-v1'
    ),
    headCommit: sourceCommit,
    prerequisiteCount: /** @type {0} */ (0),
  });
}

/** @param {unknown} value @returns {'native' | 'emulated'} */
function validateExecutionMode(value) {
  if (value !== 'native' && value !== 'emulated') {
    throw new TypeError(
      "AWS retained-storage host preflight SEA Linux Docker execution mode must be 'native' or 'emulated'.",
    );
  }
  return value;
}

/** @param {unknown} value @returns {Readonly<{id: string, platform: 'linux', architecture: 'amd64', rootfsDigest: Readonly<{algorithm: 'sha256', value: string}>}>} */
function validateImage(value) {
  const image = exactObject(
    value,
    'AWS retained-storage host preflight SEA Linux Docker image observation',
  );
  assertExactKeys(
    image,
    IMAGE_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker image observation',
  );
  if (
    typeof image.id !== 'string' ||
    !IMAGE_ID_PATTERN.test(image.id) ||
    image.platform !== 'linux' ||
    image.architecture !== 'amd64'
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker proof requires an exact local linux/amd64 image.',
    );
  }
  return deepFreeze({
    id: image.id,
    platform: /** @type {'linux'} */ ('linux'),
    architecture: /** @type {'amd64'} */ ('amd64'),
    rootfsDigest: validateDigest(
      image.rootfsDigest,
      'Docker image rootfsDigest',
    ),
  });
}

/** @param {unknown} value @returns {Readonly<{containerId: string, name: string, imageId: string, labels: Readonly<Record<string, string>>, state: 'running' | 'stopped'}> | null} */
function validateContainerObservation(value) {
  if (value === null) return null;
  const container = exactObject(
    value,
    'AWS retained-storage host preflight SEA Linux Docker container observation',
  );
  assertExactKeys(
    container,
    CONTAINER_OBSERVATION_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker container observation',
  );
  if (
    typeof container.containerId !== 'string' ||
    !CONTAINER_ID_PATTERN.test(container.containerId) ||
    typeof container.name !== 'string' ||
    container.name.length === 0 ||
    typeof container.imageId !== 'string' ||
    !IMAGE_ID_PATTERN.test(container.imageId) ||
    (container.state !== 'running' && container.state !== 'stopped')
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker container observation is invalid.',
    );
  }
  const labels = exactObject(
    container.labels,
    'AWS retained-storage host preflight SEA Linux Docker container labels',
  );
  /** @type {Record<string, string>} */
  const labelSnapshot = {};
  for (const [key, child] of Object.entries(labels)) {
    if (
      typeof child !== 'string' ||
      key.length === 0 ||
      key.length > 256 ||
      child.length > 1024
    ) {
      throw new TypeError(
        'AWS retained-storage host preflight SEA Linux Docker container labels are invalid.',
      );
    }
    labelSnapshot[key] = child;
  }
  return deepFreeze({
    containerId: container.containerId,
    name: container.name,
    imageId: container.imageId,
    labels: labelSnapshot,
    state: /** @type {'running' | 'stopped'} */ (container.state),
  });
}

/** @param {Readonly<Record<string, Function>>} value @returns {Readonly<Record<string, Function>>} */
function capturePorts(value) {
  const ports = exactObject(
    value,
    'AWS retained-storage host preflight SEA Linux Docker proof ports',
  );
  assertExactKeys(
    ports,
    PORT_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker proof ports',
  );
  /** @type {Record<string, Function>} */
  const captured = {};
  for (const key of PORT_KEYS) {
    if (typeof ports[key] !== 'function') {
      throw new TypeError(
        `AWS retained-storage host preflight SEA Linux Docker proof ports.${key} must be a function.`,
      );
    }
    captured[key] = ports[key].bind(ports);
  }
  return Object.freeze(captured);
}

/** @param {unknown} value @returns {string} */
function validateInvocationId(value) {
  if (typeof value !== 'string' || !INVOCATION_ID_PATTERN.test(value)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker proof invocation ID must be 128 bits of lowercase hexadecimal.',
    );
  }
  return value;
}

/** @param {string} sourceCommit @param {string} toolingCommit @param {string} invocationId @returns {Readonly<Record<string, string>>} */
function expectedContainerLabels(sourceCommit, toolingCommit, invocationId) {
  return Object.freeze({
    [CONTAINER_LABEL_KIND]: PROOF_KIND,
    [CONTAINER_LABEL_SOURCE]: sourceCommit,
    [CONTAINER_LABEL_TOOLING]: toolingCommit,
    [CONTAINER_LABEL_INVOCATION]: validateInvocationId(invocationId),
  });
}

/** @param {Readonly<Record<string, any>>} container @param {Readonly<{containerId?: string, name: string, imageId: string, labels: Readonly<Record<string, string>>, state?: 'running' | 'stopped'}>} expected @returns {void} */
function assertOwnedContainer(container, expected) {
  if (
    (expected.containerId !== undefined &&
      container.containerId !== expected.containerId) ||
    container.name !== expected.name ||
    container.imageId !== expected.imageId ||
    (expected.state !== undefined && container.state !== expected.state) ||
    Object.entries(expected.labels).some(
      ([key, expected]) => container.labels[key] !== expected,
    )
  ) {
    throw new Error(
      `Docker container name '${expected.name}' is not owned by this exact Wharfie proof invocation; refusing to remove it.`,
    );
  }
}

/**
 * Refuse every running deterministic-name container. Remove only a stopped
 * stale container with exact Wharfie kind/source/tooling/image ownership and
 * a valid prior invocation ID.
 * @param {Readonly<Record<string, Function>>} ports
 * @param {string} name
 * @param {string} imageId
 * @param {string} sourceCommit
 * @param {string} toolingCommit
 * @returns {Promise<void>}
 */
async function reconcileStoppedStaleContainer(
  ports,
  name,
  imageId,
  sourceCommit,
  toolingCommit,
) {
  const observed = validateContainerObservation(
    await ports.inspectContainer({ name }),
  );
  if (observed === null) return;
  if (observed.state === 'running') {
    throw new Error(
      `Docker container name '${name}' is already running; refusing to disrupt a concurrent proof invocation.`,
    );
  }
  const staleInvocationId = validateInvocationId(
    observed.labels[CONTAINER_LABEL_INVOCATION],
  );
  const labels = expectedContainerLabels(
    sourceCommit,
    toolingCommit,
    staleInvocationId,
  );
  assertOwnedContainer(observed, {
    name,
    imageId,
    labels,
    state: 'stopped',
  });
  await ports.removeContainer({
    containerId: observed.containerId,
    expectedName: name,
    expectedImageId: imageId,
    expectedLabels: labels,
    expectedState: 'stopped',
  });
  const remainingById = validateContainerObservation(
    await ports.inspectContainer({ containerId: observed.containerId }),
  );
  const remainingByName = validateContainerObservation(
    await ports.inspectContainer({ name }),
  );
  if (remainingById !== null || remainingByName !== null) {
    throw new Error(
      `Wharfie proof container '${name}' remained after bounded cleanup.`,
    );
  }
}

/**
 * Remove only a container labeled for this fresh invocation. The effect port
 * receives the immutable observed container ID and must reinspect that ID
 * before removal; mutable-name reuse is never a removal authority.
 * @param {Readonly<Record<string, Function>>} ports
 * @param {string} name
 * @param {string} imageId
 * @param {Readonly<Record<string, string>>} labels
 * @param {string | undefined} knownContainerId
 * @returns {Promise<void>}
 */
async function cleanupCurrentInvocationContainer(
  ports,
  name,
  imageId,
  labels,
  knownContainerId,
) {
  let observed;
  if (knownContainerId !== undefined) {
    observed = validateContainerObservation(
      await ports.inspectContainer({ containerId: knownContainerId }),
    );
    if (observed === null) {
      const nameCollision = validateContainerObservation(
        await ports.inspectContainer({ name }),
      );
      if (nameCollision !== null) {
        throw new Error(
          `Docker container name '${name}' was reused after the current immutable container exited; refusing removal.`,
        );
      }
      return;
    }
    assertOwnedContainer(observed, {
      containerId: knownContainerId,
      name,
      imageId,
      labels,
    });
  } else {
    observed = validateContainerObservation(
      await ports.inspectContainer({ name }),
    );
    if (observed === null) return;
    assertOwnedContainer(observed, { name, imageId, labels });
  }
  await ports.removeContainer({
    containerId: observed.containerId,
    expectedName: name,
    expectedImageId: imageId,
    expectedLabels: labels,
    expectedState: observed.state,
  });
  const remainingById = validateContainerObservation(
    await ports.inspectContainer({ containerId: observed.containerId }),
  );
  const remainingByName = validateContainerObservation(
    await ports.inspectContainer({ name }),
  );
  if (remainingById !== null || remainingByName !== null) {
    throw new Error(
      `Docker container name '${name}' was reused or remained after current-invocation cleanup; refusing further removal.`,
    );
  }
}

/** @param {Readonly<Record<string, any>>} left @param {Readonly<Record<string, any>>} right @returns {boolean} */
function sameImage(left, right) {
  return (
    left.id === right.id &&
    left.platform === right.platform &&
    left.architecture === right.architecture &&
    left.rootfsDigest.value === right.rootfsDigest.value
  );
}

/** @param {Readonly<Record<string, any>>} value @returns {Buffer} */
function canonicalJsonBytes(value) {
  return Buffer.from(
    `${JSON.stringify(sortCanonicalJsonValue(value))}\n`,
    'utf8',
  );
}

/** @param {Readonly<Record<string, any>>} descriptor @param {Readonly<Record<string, any>>} workspace @param {string} imageId @param {string} cidFilePath @returns {string[]} */
function createDockerArgv(descriptor, workspace, imageId, cidFilePath) {
  const labels = descriptor.container.labels;
  const guestWorkRoot = `${CONTAINER_WORK_DIRECTORY}/invocation-${descriptor.invocationId}`;
  return [
    'run',
    '--pull=never',
    '--rm',
    `--cidfile=${cidFilePath}`,
    '--name',
    descriptor.container.name,
    '--label',
    `${CONTAINER_LABEL_KIND}=${labels[CONTAINER_LABEL_KIND]}`,
    '--label',
    `${CONTAINER_LABEL_SOURCE}=${labels[CONTAINER_LABEL_SOURCE]}`,
    '--label',
    `${CONTAINER_LABEL_TOOLING}=${labels[CONTAINER_LABEL_TOOLING]}`,
    '--label',
    `${CONTAINER_LABEL_INVOCATION}=${labels[CONTAINER_LABEL_INVOCATION]}`,
    '--platform',
    'linux/amd64',
    '--network',
    'bridge',
    '--log-driver=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--pids-limit=512',
    '--memory=6g',
    '--memory-swap=6g',
    '--cpus=4',
    '--tmpfs',
    `${CONTAINER_WORK_DIRECTORY}:rw,exec,nosuid,nodev,size=4294967296,mode=0700`,
    '--tmpfs',
    '/tmp:rw,exec,nosuid,nodev,size=536870912,mode=1777',
    '--mount',
    `type=bind,source=${workspace.inputDirectory},target=${CONTAINER_INPUT_DIRECTORY},readonly`,
    '--env',
    `HOME=${CONTAINER_WORK_DIRECTORY}/home`,
    '--env',
    'TMPDIR=/tmp',
    '--env',
    'PATH=/usr/local/bin:/usr/bin:/bin',
    '--env',
    'LANG=C',
    '--env',
    'LC_ALL=C',
    '--env',
    'NODE_OPTIONS=',
    '--env',
    'HTTP_PROXY=',
    '--env',
    'HTTPS_PROXY=',
    '--env',
    'ALL_PROXY=',
    '--env',
    'NO_PROXY=',
    '--env',
    'http_proxy=',
    '--env',
    'https_proxy=',
    '--env',
    'all_proxy=',
    '--env',
    'no_proxy=',
    '--env',
    'AWS_ACCESS_KEY_ID=',
    '--env',
    'AWS_SECRET_ACCESS_KEY=',
    '--env',
    'AWS_SESSION_TOKEN=',
    '--env',
    'AWS_PROFILE=',
    '--env',
    'AWS_WEB_IDENTITY_TOKEN_FILE=',
    '--env',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI=',
    '--env',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=',
    '--env',
    'AWS_EC2_METADATA_DISABLED=true',
    '--entrypoint',
    '/usr/local/bin/node',
    imageId,
    CONTAINER_VERIFIER_PATH,
    '--bootstrap',
    descriptor.source.commit,
    descriptor.invocationId,
    `${CONTAINER_INPUT_DIRECTORY}/repo.bundle`,
    guestWorkRoot,
  ];
}

/** @param {Readonly<Record<string, any>>} repository @param {string} invocationId @param {Readonly<Record<string, any>>} image @param {Readonly<Record<string, any>>} sourceTransport @param {Readonly<Record<string, any>>} implementation @param {'native' | 'emulated'} executionMode @param {Readonly<Record<string, string>>} labels @returns {Readonly<Record<string, any>>} */
function createInvocationDescriptor(
  repository,
  invocationId,
  image,
  sourceTransport,
  implementation,
  executionMode,
  labels,
) {
  return deepFreeze({
    schemaVersion: 1,
    kind: 'awsRetainedStorageHostPreflightSeaLinuxDockerInvocation',
    invocationId,
    source: {
      commit: repository.sourceCommit,
      bundle: {
        path: `${CONTAINER_INPUT_DIRECTORY}/repo.bundle`,
        ...sourceTransport,
      },
    },
    tooling: implementation,
    container: {
      name: `${CONTAINER_NAME_PREFIX}${repository.sourceCommit}`,
      image,
      labels,
      executionMode,
      platform: 'linux/amd64',
      pullPolicy: 'never',
      remove: true,
      rootFilesystem: 'read-only',
      network: 'bridge',
      logDriver: 'none',
      capabilities: [],
      noNewPrivileges: true,
      limits: {
        cpus: 4,
        memoryBytes: 6 * 1024 * 1024 * 1024,
        pids: 512,
        wallClockMilliseconds: PROOF_COMMAND_TIMEOUT_MS,
      },
      mounts: [
        {
          role: 'private-input',
          target: CONTAINER_INPUT_DIRECTORY,
          readOnly: true,
          type: 'bind',
        },
      ],
      tmpfs: [
        {
          target: CONTAINER_WORK_DIRECTORY,
          size: 4 * 1024 * 1024 * 1024,
          executable: true,
        },
        {
          target: '/tmp',
          size: 512 * 1024 * 1024,
          executable: true,
        },
      ],
    },
    command: {
      executable: '/usr/local/bin/node',
      argv: [
        CONTAINER_VERIFIER_PATH,
        '--bootstrap',
        repository.sourceCommit,
        invocationId,
        `${CONTAINER_INPUT_DIRECTORY}/repo.bundle`,
        `${CONTAINER_WORK_DIRECTORY}/invocation-${invocationId}`,
      ],
      environment: {
        HOME: `${CONTAINER_WORK_DIRECTORY}/home`,
        LANG: 'C',
        LC_ALL: 'C',
        NODE_OPTIONS: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        ALL_PROXY: '',
        NO_PROXY: '',
        http_proxy: '',
        https_proxy: '',
        all_proxy: '',
        no_proxy: '',
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: '',
        AWS_SESSION_TOKEN: '',
        AWS_PROFILE: '',
        AWS_WEB_IDENTITY_TOKEN_FILE: '',
        AWS_CONTAINER_CREDENTIALS_FULL_URI: '',
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '',
        AWS_EC2_METADATA_DISABLED: 'true',
        PATH: '/usr/local/bin:/usr/bin:/bin',
        TMPDIR: '/tmp',
      },
    },
    evidenceChannel: {
      type: 'bounded-stdout-json',
      maximumBytes: MAX_GUEST_DRAFT_BYTES,
    },
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateRunResult(value) {
  const result = exactObject(
    value,
    'AWS retained-storage host preflight SEA Linux Docker run result',
  );
  assertExactKeys(
    result,
    RUN_RESULT_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker run result',
  );
  if (result.status !== 0) {
    throw new Error(
      'AWS retained-storage host preflight SEA Linux Docker guest failed.',
    );
  }
  if (
    typeof result.containerId !== 'string' ||
    !CONTAINER_ID_PATTERN.test(result.containerId)
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker run result has no immutable container ID.',
    );
  }
  return deepFreeze({
    guestDraft: validateGuestDraft(result.guestDraft),
    containerId: result.containerId,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateGuestDraft(value) {
  const draft = cloneBoundedJsonObject(
    value,
    MAX_GUEST_DRAFT_BYTES,
    'AWS retained-storage host preflight SEA Linux Docker guest draft',
  );
  assertManifestIsSecretFree(
    draft,
    'AWS retained-storage host preflight SEA Linux Docker guest draft',
  );
  assertExactKeys(
    draft,
    GUEST_DRAFT_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker guest draft',
  );
  return deepFreeze(draft);
}

/** @param {unknown} value @param {string[]} privatePaths @returns {Readonly<{receipt: Readonly<Record<string, any>>, bytes: Buffer}>} */
function validateReceiptResult(value, privatePaths) {
  const result = exactObject(
    value,
    'AWS retained-storage host preflight SEA Linux Docker receipt result',
  );
  assertExactKeys(
    result,
    RECEIPT_RESULT_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker receipt result',
  );
  const receipt = cloneBoundedJsonObject(
    result.receipt,
    MAX_RECEIPT_BYTES,
    'AWS retained-storage host preflight SEA Linux Docker receipt',
  );
  if (!Buffer.isBuffer(result.bytes)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker receipt result.bytes must be a Buffer.',
    );
  }
  const bytes = Buffer.from(result.bytes);
  if (
    bytes.length < 1 ||
    bytes.length > MAX_RECEIPT_BYTES ||
    privatePaths.some((privatePath) => bytes.includes(privatePath)) ||
    bytes[bytes.length - 1] !== 0x0a
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker receipt is oversized or exposes a private host path.',
    );
  }
  return deepFreeze({ receipt, bytes });
}

/** @param {Readonly<Record<string, any>>} guestDraft @param {Readonly<Record<string, any>>} runnerClaims @param {string} invocationId @param {string} containerId @param {string} imageId @returns {Readonly<Record<string, any>>} */
function createFinalReceiptInput(
  guestDraft,
  runnerClaims,
  invocationId,
  containerId,
  imageId,
) {
  const observations = exactObject(
    guestDraft.independentObservations,
    'AWS retained-storage host preflight SEA Linux Docker guest independentObservations',
  );
  const guestCleanup = exactObject(
    observations.cleanup,
    'AWS retained-storage host preflight SEA Linux Docker guest cleanup',
  );
  assertExactKeys(
    guestCleanup,
    GUEST_CLEANUP_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker guest cleanup',
  );
  const guestWork = exactObject(
    guestCleanup.guestWork,
    'AWS retained-storage host preflight SEA Linux Docker guest cleanup.guestWork',
  );
  assertExactKeys(
    guestWork,
    GUEST_WORK_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker guest cleanup.guestWork',
  );
  if (guestWork.invocationId !== invocationId || guestWork.removed !== true) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux Docker guest cleanup does not match the fresh invocation.',
    );
  }
  return deepFreeze({
    subject: guestDraft.subject,
    runnerClaims,
    builderClaims: guestDraft.builderClaims,
    independentObservations: {
      ...observations,
      cleanup: {
        guestWork: {
          invocationId,
          removed: true,
        },
        container: {
          invocationId,
          containerId,
          absent: true,
        },
        temporaryRoot: {
          invocationId,
          removed: true,
        },
        selectedImage: {
          imageId,
          unchanged: true,
        },
      },
    },
  });
}

/** @param {AbortSignal | undefined} signal @returns {void} */
function throwIfProofInterrupted(signal) {
  if (signal?.aborted) {
    throw new Error(
      'AWS retained-storage host preflight SEA Linux Docker proof was interrupted.',
    );
  }
}

/**
 * Create the bounded orchestration around explicit side-effect ports.
 * @param {Readonly<Record<string, Function>>} ports
 * @returns {Readonly<{run: (input: unknown, options?: {signal?: AbortSignal}) => Promise<Readonly<Record<string, any>>>}>}
 */
function createDriver(ports) {
  return Object.freeze({
    async run(inputValue, options = {}) {
      const input = validateInput(inputValue);
      const signal = options.signal;
      if (
        signal !== undefined &&
        (signal === null ||
          typeof signal !== 'object' ||
          typeof signal.aborted !== 'boolean' ||
          typeof signal.addEventListener !== 'function' ||
          typeof signal.removeEventListener !== 'function')
      ) {
        throw new TypeError('Linux SEA Docker proof signal is invalid.');
      }
      throwIfProofInterrupted(signal);
      const repository = validateRepository(await ports.readRepository());
      throwIfProofInterrupted(signal);
      const invocationId = validateInvocationId(
        await ports.createInvocationId(),
      );
      throwIfProofInterrupted(signal);
      const containerName = `${CONTAINER_NAME_PREFIX}${repository.sourceCommit}`;
      const labels = expectedContainerLabels(
        repository.sourceCommit,
        repository.toolingCommit,
        invocationId,
      );
      let startupReconciled = false;
      let runAttempted = false;
      let imageBefore;
      /** @type {'native' | 'emulated' | undefined} */
      let executionMode;
      /** @type {Readonly<Record<string, any>> | undefined} */
      let workspace;
      /** @type {Readonly<Record<string, any>> | undefined} */
      let sourceTransport;
      /** @type {Readonly<Record<string, any>> | undefined} */
      let implementation;
      /** @type {Readonly<Record<string, any>> | undefined} */
      let descriptor;
      /** @type {Readonly<Record<string, any>> | undefined} */
      let guestDraft;
      /** @type {string | undefined} */
      let containerId;
      /** @type {unknown} */
      let primaryError;

      try {
        imageBefore = validateImage(await ports.inspectImage(input.imageId));
        throwIfProofInterrupted(signal);
        if (imageBefore.id !== input.imageId) {
          throw new Error(
            'Docker resolved a different image than the exact caller-supplied image ID.',
          );
        }
        executionMode = validateExecutionMode(
          await ports.observeExecutionMode(),
        );
        throwIfProofInterrupted(signal);
        await reconcileStoppedStaleContainer(
          ports,
          containerName,
          input.imageId,
          repository.sourceCommit,
          repository.toolingCommit,
        );
        throwIfProofInterrupted(signal);
        startupReconciled = true;

        workspace = validateWorkspace(
          await ports.prepareWorkspace({
            directoryMode: PRIVATE_DIRECTORY_MODE,
          }),
        );
        throwIfProofInterrupted(signal);
        const bundlePath = path.join(workspace.inputDirectory, 'repo.bundle');
        const driverPath = path.join(workspace.inputDirectory, 'runner.js');
        const verifierPath = path.join(workspace.inputDirectory, 'verifier.js');
        const protocolPath = path.join(workspace.inputDirectory, 'protocol.js');
        const cidFilePath = path.join(workspace.root, 'container.cid');

        throwIfProofInterrupted(signal);
        const bundleResult = validateBundleResult(
          await ports.createGitBundle({
            repositoryRoot: repository.root,
            sourceCommit: repository.sourceCommit,
            destinationPath: bundlePath,
            mode: PRIVATE_FILE_MODE,
          }),
          repository.sourceCommit,
        );
        throwIfProofInterrupted(signal);
        const bundleObservation = validateFileObservation(
          await ports.observeFile({
            filePath: bundlePath,
            maximumBytes: MAX_GIT_BUNDLE_BYTES,
          }),
          'AWS retained-storage host preflight SEA Linux Docker Git bundle',
        );
        throwIfProofInterrupted(signal);
        const observedSourceTransport = deepFreeze({
          ...bundleResult,
          ...bundleObservation,
        });
        sourceTransport = observedSourceTransport;
        /** @param {string} repositoryPath @param {string} destinationPath @param {string} valuePath */
        const observeTooling = async (
          repositoryPath,
          destinationPath,
          valuePath,
        ) => {
          throwIfProofInterrupted(signal);
          await ports.exportTooling({
            repositoryRoot: repository.root,
            toolingCommit: repository.toolingCommit,
            repositoryPath,
            destinationPath,
            mode: PRIVATE_FILE_MODE,
          });
          throwIfProofInterrupted(signal);
          const observation = deepFreeze({
            logicalPath: repositoryPath,
            ...validateFileObservation(
              await ports.observeFile({
                filePath: destinationPath,
                maximumBytes: MAX_TOOLING_BYTES,
              }),
              valuePath,
            ),
          });
          throwIfProofInterrupted(signal);
          return observation;
        };
        const observedImplementation = deepFreeze({
          sourceCommit: repository.toolingCommit,
          driver: await observeTooling(
            DRIVER_REPOSITORY_PATH,
            driverPath,
            'AWS retained-storage host preflight SEA Linux Docker driver',
          ),
          verifier: await observeTooling(
            VERIFIER_REPOSITORY_PATH,
            verifierPath,
            'AWS retained-storage host preflight SEA Linux Docker verifier',
          ),
          protocol: await observeTooling(
            PROTOCOL_REPOSITORY_PATH,
            protocolPath,
            'AWS retained-storage host preflight SEA Linux proof protocol',
          ),
        });
        implementation = observedImplementation;
        descriptor = createInvocationDescriptor(
          repository,
          invocationId,
          imageBefore,
          observedSourceTransport,
          observedImplementation,
          executionMode,
          labels,
        );

        throwIfProofInterrupted(signal);
        runAttempted = true;
        /** @type {{argv: string[], cidFilePath: string, containerName: string, signal?: AbortSignal}} */
        const containerInput = {
          argv: createDockerArgv(
            descriptor,
            workspace,
            input.imageId,
            cidFilePath,
          ),
          cidFilePath,
          containerName,
        };
        if (signal !== undefined) containerInput.signal = signal;
        const runResult = validateRunResult(
          await ports.runContainer(containerInput),
        );
        guestDraft = runResult.guestDraft;
        containerId = runResult.containerId;
      } catch (error) {
        if (
          error instanceof DockerContainerRunError &&
          error.containerId !== undefined
        ) {
          if (CONTAINER_ID_PATTERN.test(error.containerId)) {
            containerId = error.containerId;
          } else {
            primaryError = new AggregateError(
              [
                error,
                new Error(
                  'Docker failure exposed an invalid immutable container ID.',
                ),
              ],
              'The bounded Docker proof command failed with invalid cleanup evidence.',
            );
          }
        }
        if (primaryError === undefined) primaryError = error;
      }

      /** @type {unknown[]} */
      const cleanupErrors = [];
      let containerAbsent = startupReconciled && !runAttempted;
      let imageUnchanged = false;
      let workspaceRemoved = workspace === undefined;
      if (imageBefore) {
        if (runAttempted) {
          try {
            await cleanupCurrentInvocationContainer(
              ports,
              containerName,
              input.imageId,
              labels,
              containerId,
            );
            containerAbsent = true;
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
        try {
          const imageAfter = validateImage(
            await ports.inspectImage(input.imageId),
          );
          if (!sameImage(imageBefore, imageAfter)) {
            throw new Error(
              'The selected Docker image changed during the Wharfie proof.',
            );
          }
          imageUnchanged = true;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (workspace) {
        try {
          await ports.removeTree({ root: workspace.root });
          workspaceRemoved = true;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }

      if (primaryError || cleanupErrors.length > 0) {
        if (primaryError && cleanupErrors.length === 0) throw primaryError;
        throw new AggregateError(
          [...(primaryError ? [primaryError] : []), ...cleanupErrors],
          primaryError
            ? 'AWS retained-storage host preflight SEA Linux Docker proof failed and cleanup was incomplete.'
            : 'AWS retained-storage host preflight SEA Linux Docker proof completed but cleanup was incomplete.',
        );
      }
      if (
        !imageBefore ||
        !executionMode ||
        !sourceTransport ||
        !implementation ||
        !descriptor ||
        !guestDraft ||
        !containerId
      ) {
        throw new Error(
          'AWS retained-storage host preflight SEA Linux Docker proof completed without bound evidence.',
        );
      }

      const cleanup = deepFreeze({
        containerAbsent,
        imageUnchanged,
        workspaceRemoved,
      });
      if (
        !cleanup.containerAbsent ||
        !cleanup.imageUnchanged ||
        !cleanup.workspaceRemoved
      ) {
        throw new Error(
          'AWS retained-storage host preflight SEA Linux Docker proof cleanup postconditions are incomplete.',
        );
      }
      const runnerClaims = deepFreeze({
        implementation,
        sourceTransport,
        container: {
          engine: 'docker',
          imageId: imageBefore.id,
          invocationId,
          containerId,
          imageIdentityBasis: 'host-daemon-observation',
          requestedPlatform: 'linux/amd64',
          pullPolicy: 'never',
          executionMode,
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
          memoryBytes: 6 * 1024 * 1024 * 1024,
          pidsLimit: 512,
          workTmpfsBytes: 4 * 1024 * 1024 * 1024,
          tempTmpfsBytes: 512 * 1024 * 1024,
          evidenceMaxBytes: MAX_GUEST_DRAFT_BYTES,
          cpuLimit: 4,
          wallClockLimitMilliseconds: PROOF_COMMAND_TIMEOUT_MS,
        },
      });
      const receiptInput = createFinalReceiptInput(
        guestDraft,
        runnerClaims,
        invocationId,
        containerId,
        imageBefore.id,
      );
      throwIfProofInterrupted(signal);
      const receiptResult = validateReceiptResult(
        await ports.createReceipt(receiptInput),
        workspace ? [workspace.root, workspace.inputDirectory] : [],
      );
      throwIfProofInterrupted(signal);
      const publication = exactObject(
        await ports.publishReceipt({
          outputRoot: input.outputRoot,
          sourceCommit: repository.sourceCommit,
          receiptBytes: receiptResult.bytes,
          fileMode: PRIVATE_FILE_MODE,
          directoryMode: PRIVATE_DIRECTORY_MODE,
        }),
        'AWS retained-storage host preflight SEA Linux Docker proof publication',
      );
      assertExactKeys(
        publication,
        PUBLICATION_KEYS,
        'AWS retained-storage host preflight SEA Linux Docker proof publication',
      );
      return deepFreeze({
        sourceCommit: repository.sourceCommit,
        proofPath: canonicalAbsolutePath(
          publication.proofPath,
          'AWS retained-storage host preflight SEA Linux Docker proof publication.proofPath',
        ),
        checksumPath: canonicalAbsolutePath(
          publication.checksumPath,
          'AWS retained-storage host preflight SEA Linux Docker proof publication.checksumPath',
        ),
        outputDirectory: canonicalAbsolutePath(
          publication.outputDirectory,
          'AWS retained-storage host preflight SEA Linux Docker proof publication.outputDirectory',
        ),
      });
    },
  });
}

/** @param {import('node:child_process').ChildProcess} child @returns {void} */
function killExternalProcessGroup(child) {
  if (
    process.platform !== 'win32' &&
    typeof child.pid === 'number' &&
    child.pid > 0
  ) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') {
        try {
          child.kill('SIGKILL');
        } catch {
          // The close/error event remains the authoritative reap result.
        }
        return;
      }
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // The close/error event remains the authoritative reap result.
  }
}

/** @param {string} command @param {string[]} argv @param {{cwd?: string, maximumOutputBytes?: number, timeoutMs?: number, signal?: AbortSignal}} [options] @returns {Promise<Readonly<{stdout: Buffer, stderr: Buffer}>>} */
async function runExternal(command, argv, options = {}) {
  const maximumOutputBytes =
    options.maximumOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > PROOF_COMMAND_TIMEOUT_MS
  ) {
    throw new TypeError(`Command '${command}' timeout is invalid.`);
  }
  if (
    options.signal !== undefined &&
    (options.signal === null ||
      typeof options.signal !== 'object' ||
      typeof options.signal.aborted !== 'boolean' ||
      typeof options.signal.addEventListener !== 'function' ||
      typeof options.signal.removeEventListener !== 'function')
  ) {
    throw new TypeError(`Command '${command}' abort signal is invalid.`);
  }
  if (options.signal?.aborted) {
    throw new Error(`Command '${command}' was interrupted before it started.`);
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    /** @type {unknown} */
    let pendingFailure;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let reapTimeout;
    const removeAbortListener = () => {
      options.signal?.removeEventListener('abort', handleAbort);
    };
    /** @param {unknown} error */
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (reapTimeout !== undefined) clearTimeout(reapTimeout);
      removeAbortListener();
      reject(error);
    };
    /** @param {unknown} error */
    const fail = (error) => {
      if (settled || pendingFailure !== undefined) return;
      pendingFailure = error;
      clearTimeout(timeout);
      if (child.pid === undefined) {
        rejectOnce(error);
        return;
      }
      killExternalProcessGroup(child);
      reapTimeout = setTimeout(() => {
        rejectOnce(
          new AggregateError(
            [error],
            `Command '${command}' did not close after forced termination.`,
          ),
        );
      }, COMMAND_REAP_TIMEOUT_MS);
    };
    const handleAbort = () => {
      fail(new Error(`Command '${command}' was interrupted.`));
    };
    const timeout = setTimeout(() => {
      fail(new Error(`Command '${command}' exceeded its wall-clock limit.`));
    }, timeoutMs);
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    child.stdout.on('data', (chunk) => {
      if (pendingFailure !== undefined) return;
      const bytes = Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (stdoutBytes > maximumOutputBytes) {
        fail(new Error(`Command '${command}' emitted oversized stdout.`));
        return;
      }
      stdout.push(bytes);
    });
    child.stderr.on('data', (chunk) => {
      if (pendingFailure !== undefined) return;
      const bytes = Buffer.from(chunk);
      stderrBytes += bytes.length;
      if (stderrBytes > maximumOutputBytes) {
        fail(new Error(`Command '${command}' emitted oversized stderr.`));
        return;
      }
      stderr.push(bytes);
    });
    child.once('error', fail);
    child.once('close', (status, signal) => {
      if (settled) return;
      clearTimeout(timeout);
      if (reapTimeout !== undefined) clearTimeout(reapTimeout);
      removeAbortListener();
      if (pendingFailure !== undefined) {
        settled = true;
        reject(pendingFailure);
        return;
      }
      settled = true;
      if (signal || status !== 0) {
        reject(new Error(`Command '${command}' failed.`));
        return;
      }
      resolve(
        Object.freeze({
          stdout: Buffer.concat(stdout, stdoutBytes),
          stderr: Buffer.concat(stderr, stderrBytes),
        }),
      );
    });
    if (options.signal?.aborted) handleAbort();
  });
}

/** @param {import('node:fs').BigIntStats} left @param {import('node:fs').BigIntStats} right @returns {boolean} */
function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/** @param {string} filePath @param {number} maximumBytes @param {boolean} retainBytes @returns {Promise<Readonly<Record<string, any>>>} */
async function readStableRegularFile(filePath, maximumBytes, retainBytes) {
  const pathBefore = await fsp.lstat(filePath, { bigint: true });
  if (
    pathBefore.isSymbolicLink() ||
    !pathBefore.isFile() ||
    pathBefore.size < 1n ||
    pathBefore.size > BigInt(maximumBytes)
  ) {
    throw new Error(`Private proof file '${filePath}' is invalid.`);
  }
  const noFollow =
    typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const handle = await fsp.open(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFile(pathBefore, before)) {
      throw new Error(`Private proof file '${filePath}' changed before read.`);
    }
    const hash = createHash('sha256');
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    const stream = createReadStream(filePath, {
      fd: handle.fd,
      autoClose: false,
      start: 0,
    });
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maximumBytes) {
        throw new Error(`Private proof file '${filePath}' is oversized.`);
      }
      hash.update(bytes);
      if (retainBytes) chunks.push(bytes);
    }
    const [after, pathAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      fsp.lstat(filePath, { bigint: true }),
    ]);
    if (
      size !== Number(before.size) ||
      !after.isFile() ||
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      !sameFile(before, after) ||
      !sameFile(after, pathAfter)
    ) {
      throw new Error(`Private proof file '${filePath}' changed during read.`);
    }
    const result = {
      byteDigest: {
        algorithm: /** @type {'sha256'} */ ('sha256'),
        value: hash.digest('base64url'),
      },
      size,
    };
    return deepFreeze(
      retainBytes ? { ...result, bytes: Buffer.concat(chunks, size) } : result,
    );
  } finally {
    await handle.close();
  }
}

/** @param {Buffer} bytes @returns {string} */
function parseDockerContainerIdBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || (bytes.length !== 64 && bytes.length !== 65)) {
    throw new Error('Docker did not write one exact immutable container ID.');
  }
  const text = bytes.toString('ascii');
  if (!Buffer.from(text, 'ascii').equals(bytes)) {
    throw new Error('Docker wrote a non-ASCII immutable container ID.');
  }
  const containerId = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (!CONTAINER_ID_PATTERN.test(containerId)) {
    throw new Error('Docker did not write one exact immutable container ID.');
  }
  return containerId;
}

/** @param {string} cidFilePath @returns {Promise<string>} */
async function readDockerContainerIdFile(cidFilePath) {
  const observation = await readStableRegularFile(cidFilePath, 65, true);
  return parseDockerContainerIdBytes(observation.bytes);
}

/** @param {unknown} error @returns {boolean} */
function isMissingFileError(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/** @param {string} cidFilePath @returns {Promise<string | undefined>} */
async function readDockerContainerIdFileIfPresent(cidFilePath) {
  try {
    return await readDockerContainerIdFile(cidFilePath);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

/** @param {number} milliseconds @returns {Promise<void>} */
async function waitFor(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * After a failed, reaped `docker run`, require a bounded quiescence window in
 * which either the immutable ID becomes observable or the deterministic name
 * remains absent. This closes the daemon create/cidfile race before cleanup.
 * @param {Readonly<Record<string, Function>>} ports
 * @param {{cidFilePath: string, containerName: string}} input
 * @returns {Promise<string | undefined>}
 */
async function settleDockerContainerIdentity(ports, input) {
  const deadline = Date.now() + DOCKER_IDENTITY_SETTLE_TIMEOUT_MS;
  /** @type {unknown} */
  let cidFileError;
  do {
    try {
      const fromFile = await readDockerContainerIdFileIfPresent(
        input.cidFilePath,
      );
      if (fromFile !== undefined) return fromFile;
      cidFileError = undefined;
    } catch (error) {
      cidFileError = error;
    }
    const observed = validateContainerObservation(
      await ports.inspectContainer({ name: input.containerName }),
    );
    if (observed !== null) return observed.containerId;
    if (Date.now() >= deadline) {
      if (cidFileError !== undefined) throw cidFileError;
      return undefined;
    }
    await waitFor(DOCKER_IDENTITY_POLL_INTERVAL_MS);
  } while (true);
}

class DockerContainerRunError extends Error {
  /**
   * @param {unknown} cause
   * @param {string | undefined} containerId
   */
  constructor(cause, containerId) {
    super('The bounded Docker proof command failed.', { cause });
    this.name = 'DockerContainerRunError';
    this.containerId = containerId;
  }
}

/**
 * @param {Buffer} stdout
 * @param {Buffer} stderr
 * @returns {Readonly<Record<string, any>>}
 */
function parseGuestDraftFrame(stdout, stderr) {
  if (!Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr)) {
    throw new TypeError('Linux SEA guest output must be byte buffers.');
  }
  if (stdout.length > MAX_GUEST_DRAFT_BYTES) {
    throw new Error('The Linux SEA guest draft exceeds its byte limit.');
  }
  if (stderr.length !== 0) {
    throw new Error(
      'The Linux SEA proof guest emitted unexpected diagnostic output.',
    );
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  } catch {
    throw new Error('The Linux SEA guest draft is not valid UTF-8.');
  }
  if (
    text.length < 2 ||
    !text.endsWith('\n') ||
    text.slice(0, -1).includes('\n')
  ) {
    throw new Error(
      'The Linux SEA guest must emit exactly one newline-terminated JSON document.',
    );
  }
  const body = text.slice(0, -1);
  let guestDraft;
  try {
    guestDraft = JSON.parse(body);
  } catch {
    throw new Error('The Linux SEA guest draft is not valid JSON.');
  }
  if (
    !isPlainObject(guestDraft) ||
    JSON.stringify(sortCanonicalJsonValue(guestDraft)) !== body
  ) {
    throw new Error(
      'The Linux SEA guest draft contains extra whitespace, duplicate fields, non-object output, or non-canonical logging.',
    );
  }
  return deepFreeze(guestDraft);
}

/** @param {Buffer} bytes @param {string} sourceCommit @returns {Readonly<{format: 'git-bundle-complete-head-v1', headCommit: string, prerequisiteCount: 0}>} */
function inspectCompleteGitBundleHeader(bytes, sourceCommit) {
  const headerEnd = bytes.indexOf(Buffer.from('\n\n', 'ascii'));
  if (headerEnd < 1 || headerEnd > 64 * 1024) {
    throw new Error('The Git bundle has no bounded canonical header.');
  }
  let header;
  try {
    header = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, headerEnd),
    );
  } catch {
    throw new Error('The Git bundle header is not valid UTF-8.');
  }
  const lines = header.split('\n');
  if (lines[0] !== '# v2 git bundle' && lines[0] !== '# v3 git bundle') {
    throw new Error('The Git bundle version header is invalid.');
  }
  const prerequisites = lines.slice(1).filter((line) => line.startsWith('-'));
  const references = lines
    .slice(1)
    .filter((line) => /^[0-9a-f]{40} /u.test(line));
  const invalid = lines
    .slice(1)
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith('-') &&
        !line.startsWith('@') &&
        !/^[0-9a-f]{40} /u.test(line),
    );
  if (
    prerequisites.length !== 0 ||
    references.length !== 1 ||
    references[0] !== `${sourceCommit} HEAD` ||
    invalid.length !== 0
  ) {
    throw new Error(
      'The Git bundle is not one complete prerequisite-free exact HEAD.',
    );
  }
  return Object.freeze({
    format: /** @type {'git-bundle-complete-head-v1'} */ (
      'git-bundle-complete-head-v1'
    ),
    headCommit: sourceCommit,
    prerequisiteCount: /** @type {0} */ (0),
  });
}

const LIVE_REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL('../', import.meta.url)),
);
const LIVE_TOOLING_FILES = Object.freeze([
  Object.freeze({
    logicalPath: DRIVER_REPOSITORY_PATH,
    livePath: fileURLToPath(import.meta.url),
  }),
  Object.freeze({
    logicalPath: VERIFIER_REPOSITORY_PATH,
    livePath: path.join(LIVE_REPOSITORY_ROOT, VERIFIER_REPOSITORY_PATH),
  }),
  Object.freeze({
    logicalPath: PROTOCOL_REPOSITORY_PATH,
    livePath: path.join(LIVE_REPOSITORY_ROOT, PROTOCOL_REPOSITORY_PATH),
  }),
]);

const productionPorts = {
  async readRepository() {
    const status = await runExternal(
      'git',
      [
        '-C',
        LIVE_REPOSITORY_ROOT,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ],
      { maximumOutputBytes: MAX_COMMAND_OUTPUT_BYTES },
    );
    if (status.stdout.length !== 0) {
      throw new Error(
        'Commit or remove worktree changes before creating a Linux SEA proof receipt.',
      );
    }
    const head = await runExternal('git', [
      '-C',
      LIVE_REPOSITORY_ROOT,
      'rev-parse',
      '--verify',
      'HEAD^{commit}',
    ]);
    const sourceCommit = head.stdout.toString('utf8').trim();
    if (!COMMIT_PATTERN.test(sourceCommit)) {
      throw new Error('The repository HEAD is not one exact Git commit.');
    }
    for (const tooling of LIVE_TOOLING_FILES) {
      const committed = await runExternal(
        'git',
        [
          '-C',
          LIVE_REPOSITORY_ROOT,
          'show',
          `${sourceCommit}:${tooling.logicalPath}`,
        ],
        { maximumOutputBytes: MAX_TOOLING_BYTES },
      );
      const live = await fsp.readFile(tooling.livePath);
      if (live.length < 1 || !live.equals(committed.stdout)) {
        throw new Error(
          `Linux SEA proof tooling '${tooling.logicalPath}' does not match exact clean HEAD.`,
        );
      }
    }
    return {
      root: LIVE_REPOSITORY_ROOT,
      sourceCommit,
      toolingCommit: sourceCommit,
    };
  },

  async createInvocationId() {
    return randomBytes(16).toString('hex');
  },

  /** @param {string} imageId */
  async inspectImage(imageId) {
    const result = await runExternal('docker', ['image', 'inspect', imageId]);
    let decoded;
    try {
      decoded = JSON.parse(result.stdout.toString('utf8'));
    } catch {
      throw new Error('Docker returned malformed image inspection output.');
    }
    if (!Array.isArray(decoded) || decoded.length !== 1) {
      throw new Error('Docker did not resolve one exact local image.');
    }
    const image = decoded[0];
    if (
      !isPlainObject(image) ||
      !isPlainObject(image.RootFS) ||
      !Array.isArray(image.RootFS.Layers)
    ) {
      throw new Error('Docker image inspection omitted rootfs evidence.');
    }
    return {
      id: image.Id,
      platform: image.Os,
      architecture: image.Architecture,
      rootfsDigest: {
        algorithm: 'sha256',
        value: createHash('sha256')
          .update(
            canonicalJsonBytes({
              type: image.RootFS.Type,
              layers: image.RootFS.Layers,
            }),
          )
          .digest('base64url'),
      },
    };
  },

  async observeExecutionMode() {
    const result = await runExternal('docker', [
      'info',
      '--format',
      '{{.Architecture}}',
    ]);
    const architecture = result.stdout.toString('utf8').trim();
    if (architecture === 'x86_64' || architecture === 'amd64') {
      return 'native';
    }
    if (architecture === 'aarch64' || architecture === 'arm64') {
      return 'emulated';
    }
    throw new Error(
      'Docker daemon architecture cannot establish the requested linux/amd64 execution mode.',
    );
  },

  /** @param {{name: string} | {containerId: string}} input */
  async inspectContainer(input) {
    const byName = Object.hasOwn(input, 'name');
    const byId = Object.hasOwn(input, 'containerId');
    if (byName === byId) {
      throw new TypeError(
        'Docker container inspection requires exactly one name or immutable container ID.',
      );
    }
    const reference = byName
      ? /** @type {{name: string}} */ (input).name
      : /** @type {{containerId: string}} */ (input).containerId;
    if (
      (byName &&
        (typeof reference !== 'string' ||
          reference.length === 0 ||
          reference !==
            `${CONTAINER_NAME_PREFIX}${reference.slice(CONTAINER_NAME_PREFIX.length)}`)) ||
      (byId &&
        (typeof reference !== 'string' ||
          !CONTAINER_ID_PATTERN.test(reference)))
    ) {
      throw new TypeError('Docker container inspection reference is invalid.');
    }
    const list = await runExternal('docker', [
      'container',
      'ls',
      '--all',
      '--no-trunc',
      '--filter',
      byName ? `name=^/${reference}$` : `id=${reference}`,
      '--format',
      byName ? '{{.ID}} {{.Names}}' : '{{.ID}}',
    ]);
    const matches = list.stdout
      .toString('utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    if (matches.length === 0) return null;
    const expectedMatch = byName
      ? `${matches[0].slice(0, 64)} ${reference}`
      : reference;
    if (matches.length !== 1 || matches[0] !== expectedMatch) {
      throw new Error(
        `Docker container lookup for '${reference}' was ambiguous.`,
      );
    }
    const inspected = await runExternal('docker', [
      'container',
      'inspect',
      reference,
    ]);
    let decoded;
    try {
      decoded = JSON.parse(inspected.stdout.toString('utf8'));
    } catch {
      throw new Error('Docker returned malformed container inspection output.');
    }
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 1 ||
      !isPlainObject(decoded[0]) ||
      !isPlainObject(decoded[0].Config) ||
      !isPlainObject(decoded[0].State)
    ) {
      throw new Error('Docker did not return one exact container.');
    }
    return {
      containerId: decoded[0].Id,
      name: String(decoded[0].Name || '').replace(/^\//u, ''),
      imageId: decoded[0].Image,
      labels: isPlainObject(decoded[0].Config.Labels)
        ? decoded[0].Config.Labels
        : {},
      state: decoded[0].State.Running ? 'running' : 'stopped',
    };
  },

  /** @param {{containerId: string, expectedName: string, expectedImageId: string, expectedLabels: Readonly<Record<string, string>>, expectedState: 'running' | 'stopped'}} input */
  async removeContainer(input) {
    const current = validateContainerObservation(
      await this.inspectContainer({ containerId: input.containerId }),
    );
    if (current === null) return;
    assertOwnedContainer(current, {
      containerId: input.containerId,
      name: input.expectedName,
      imageId: input.expectedImageId,
      labels: input.expectedLabels,
      state: input.expectedState,
    });
    await runExternal('docker', [
      'container',
      'rm',
      ...(current.state === 'running' ? ['--force'] : []),
      input.containerId,
    ]);
  },

  /** @param {{directoryMode: number}} input */
  async prepareWorkspace(input) {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-sea-linux-docker-proof-'),
    );
    try {
      await fsp.chmod(root, input.directoryMode);
      const inputDirectory = path.join(root, 'input');
      await fsp.mkdir(inputDirectory, { mode: input.directoryMode });
      await fsp.chmod(inputDirectory, input.directoryMode);
      return { root, inputDirectory };
    } catch (error) {
      await fsp.rm(root, { force: true, recursive: true });
      throw error;
    }
  },

  /** @param {{repositoryRoot: string, sourceCommit: string, destinationPath: string, mode: number}} input */
  async createGitBundle(input) {
    const bundle = await runExternal(
      'git',
      ['-C', input.repositoryRoot, 'bundle', 'create', '-', 'HEAD'],
      { maximumOutputBytes: MAX_GIT_BUNDLE_BYTES },
    );
    if (
      bundle.stdout.length < 1 ||
      bundle.stdout.length > MAX_GIT_BUNDLE_BYTES
    ) {
      throw new Error('The exact Git bundle exceeds its byte limit.');
    }
    const transport = inspectCompleteGitBundleHeader(
      bundle.stdout,
      input.sourceCommit,
    );
    await fsp.writeFile(input.destinationPath, bundle.stdout, {
      flag: 'wx',
      mode: input.mode,
    });
    const headAfter = await runExternal('git', [
      '-C',
      input.repositoryRoot,
      'rev-parse',
      '--verify',
      'HEAD^{commit}',
    ]);
    if (headAfter.stdout.toString('utf8').trim() !== input.sourceCommit) {
      throw new Error('Repository HEAD changed while creating the Git bundle.');
    }
    const heads = await runExternal('git', [
      'bundle',
      'list-heads',
      input.destinationPath,
    ]);
    const expectedHead = `${input.sourceCommit} HEAD`;
    if (!heads.stdout.toString('utf8').split('\n').includes(expectedHead)) {
      throw new Error('The Git bundle does not identify exact proof HEAD.');
    }
    await fsp.chmod(input.destinationPath, input.mode);
    return transport;
  },

  /** @param {{repositoryRoot: string, toolingCommit: string, repositoryPath: string, destinationPath: string, mode: number}} input */
  async exportTooling(input) {
    const result = await runExternal(
      'git',
      [
        '-C',
        input.repositoryRoot,
        'show',
        `${input.toolingCommit}:${input.repositoryPath}`,
      ],
      { maximumOutputBytes: MAX_TOOLING_BYTES },
    );
    await fsp.writeFile(input.destinationPath, result.stdout, {
      flag: 'wx',
      mode: input.mode,
    });
    await fsp.chmod(input.destinationPath, input.mode);
  },

  /** @param {{filePath: string, maximumBytes: number}} input */
  async observeFile(input) {
    return await readStableRegularFile(
      input.filePath,
      input.maximumBytes,
      false,
    );
  },

  /** @param {{argv: string[], cidFilePath: string, containerName: string, signal?: AbortSignal}} input */
  async runContainer(input) {
    let result;
    try {
      result = await runExternal('docker', input.argv, {
        maximumOutputBytes: MAX_GUEST_DRAFT_BYTES,
        timeoutMs: PROOF_COMMAND_TIMEOUT_MS,
        signal: input.signal,
      });
    } catch (error) {
      let containerId;
      try {
        containerId = await settleDockerContainerIdentity(this, input);
      } catch (cidError) {
        throw new DockerContainerRunError(
          new AggregateError(
            [error, cidError],
            'The Docker command failed and its immutable container ID evidence was invalid.',
          ),
          undefined,
        );
      }
      throw new DockerContainerRunError(error, containerId);
    }
    let containerId;
    try {
      containerId = await readDockerContainerIdFile(input.cidFilePath);
      const guestDraft = parseGuestDraftFrame(result.stdout, result.stderr);
      return {
        status: 0,
        guestDraft,
        containerId,
      };
    } catch (error) {
      throw new DockerContainerRunError(error, containerId);
    }
  },

  /** @param {{root: string}} input */
  async removeTree(input) {
    await fsp.rm(input.root, { force: true, recursive: true });
    try {
      await fsp.lstat(input.root);
      throw new Error(
        'Private Linux SEA proof workspace remained after cleanup.',
      );
    } catch (error) {
      if (
        error === null ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
  },

  /** @param {Readonly<Record<string, any>>} input */
  async createReceipt(input) {
    const created =
      createAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(input);
    const receipt =
      validateAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(created);
    const bytes = Buffer.from(
      stringifyAwsRetainedStorageHostPreflightSeaLinuxProofReceipt(receipt),
      'utf8',
    );
    if (bytes.length < 1 || bytes.length > MAX_RECEIPT_BYTES) {
      throw new TypeError(
        'AWS retained-storage host preflight SEA Linux proof receipt exceeds its protocol byte limit.',
      );
    }
    return { receipt, bytes };
  },

  /** @param {{outputRoot: string, sourceCommit: string, receiptBytes: Buffer, fileMode: number, directoryMode: number}} input */
  async publishReceipt(input) {
    await fsp.mkdir(input.outputRoot, {
      recursive: true,
      mode: input.directoryMode,
    });
    const outputRootStats = await fsp.lstat(input.outputRoot);
    if (
      outputRootStats.isSymbolicLink() ||
      !outputRootStats.isDirectory() ||
      (await fsp.realpath(input.outputRoot)) !== input.outputRoot
    ) {
      throw new Error(
        'Linux SEA proof output root must be one real canonical directory.',
      );
    }
    const outputDirectory = path.join(input.outputRoot, input.sourceCommit);
    try {
      await fsp.lstat(outputDirectory);
      throw new Error(
        `Linux SEA proof receipt already exists for ${input.sourceCommit}.`,
      );
    } catch (error) {
      if (
        error === null ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
    const stagingDirectory = await fsp.mkdtemp(
      path.join(input.outputRoot, `.${input.sourceCommit}.`),
    );
    await fsp.chmod(stagingDirectory, input.directoryMode);
    let renamed = false;
    try {
      const stagedProofPath = path.join(stagingDirectory, 'proof.json');
      const stagedChecksumPath = path.join(stagingDirectory, 'SHA256SUMS');
      const checksum = createHash('sha256')
        .update(input.receiptBytes)
        .digest('hex');
      const proofHandle = await fsp.open(
        stagedProofPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
        input.fileMode,
      );
      try {
        await proofHandle.writeFile(input.receiptBytes);
        await proofHandle.sync();
      } finally {
        await proofHandle.close();
      }
      const checksumHandle = await fsp.open(
        stagedChecksumPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
        input.fileMode,
      );
      try {
        await checksumHandle.writeFile(
          Buffer.from(`${checksum}  proof.json\n`, 'utf8'),
        );
        await checksumHandle.sync();
      } finally {
        await checksumHandle.close();
      }
      await Promise.all([
        fsp.chmod(stagedProofPath, input.fileMode),
        fsp.chmod(stagedChecksumPath, input.fileMode),
      ]);
      const stagingHandle = await fsp.open(
        stagingDirectory,
        fsConstants.O_RDONLY,
      );
      try {
        await stagingHandle.sync();
      } finally {
        await stagingHandle.close();
      }
      await fsp.rename(stagingDirectory, outputDirectory);
      renamed = true;
      const outputRootHandle = await fsp.open(
        input.outputRoot,
        fsConstants.O_RDONLY,
      );
      try {
        await outputRootHandle.sync();
      } finally {
        await outputRootHandle.close();
      }
      return {
        proofPath: path.join(outputDirectory, 'proof.json'),
        checksumPath: path.join(outputDirectory, 'SHA256SUMS'),
        outputDirectory,
      };
    } finally {
      if (!renamed) {
        await fsp.rm(stagingDirectory, { force: true, recursive: true });
      }
    }
  },
};

const PRODUCTION_DRIVER = createDriver(capturePorts(productionPorts));

/**
 * Test-only construction of the internal immutable-ID-carrying run failure.
 * @param {unknown} containerId
 * @returns {Error}
 */
export function createAwsRetainedStorageHostPreflightSeaLinuxDockerRunErrorForTest(
  containerId,
) {
  if (
    typeof containerId !== 'string' ||
    !CONTAINER_ID_PATTERN.test(containerId)
  ) {
    throw new TypeError('Docker run error test container ID is invalid.');
  }
  return new DockerContainerRunError(
    new Error('Injected bounded Docker run failure.'),
    containerId,
  );
}

/**
 * Test-only access to the exact Docker cidfile parser.
 * @param {unknown} value
 * @returns {string}
 */
export function parseAwsRetainedStorageHostPreflightSeaLinuxDockerCidFileForTest(
  value,
) {
  if (!Buffer.isBuffer(value)) {
    throw new TypeError('Docker cidfile test input must be a Buffer.');
  }
  return parseDockerContainerIdBytes(value);
}

/**
 * Test-only access to the exact bounded guest stdout/stderr frame parser.
 * @param {unknown} stdout
 * @param {unknown} stderr
 * @returns {Readonly<Record<string, any>>}
 */
export function parseAwsRetainedStorageHostPreflightSeaLinuxDockerGuestFrameForTest(
  stdout,
  stderr,
) {
  if (!Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr)) {
    throw new TypeError('Linux SEA guest frame test inputs must be Buffers.');
  }
  return parseGuestDraftFrame(stdout, stderr);
}

/**
 * Test-only access to the live whlp2 create/validate/stringify mapping.
 * @param {unknown} inputValue
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function createAwsRetainedStorageHostPreflightSeaLinuxDockerProofReceiptForTest(
  inputValue,
) {
  const input = exactObject(
    inputValue,
    'AWS retained-storage host preflight SEA Linux Docker proof test receipt input',
  );
  return await productionPorts.createReceipt(input);
}

/**
 * Test-only access to the staged, fsynced JSON/checksum publisher.
 * @param {unknown} inputValue
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function publishAwsRetainedStorageHostPreflightSeaLinuxDockerProofReceiptForTest(
  inputValue,
) {
  const input = exactObject(
    inputValue,
    'AWS retained-storage host preflight SEA Linux Docker proof test publication',
  );
  return await productionPorts.publishReceipt(
    /** @type {{outputRoot: string, sourceCommit: string, receiptBytes: Buffer, fileMode: number, directoryMode: number}} */ (
      input
    ),
  );
}

/**
 * Run one clean-HEAD proof through a local immutable Docker image. The driver
 * has no image-pull, image-build, or volume-management capability.
 * @param {unknown} inputValue
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function runAwsRetainedStorageHostPreflightSeaLinuxDockerProof(
  inputValue,
) {
  return await PRODUCTION_DRIVER.run(inputValue);
}

/**
 * Test-only driver factory around exact receiver-bound ports.
 * @param {unknown} optionsValue
 * @returns {Readonly<{run: (input: unknown, options?: {signal?: AbortSignal}) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsRetainedStorageHostPreflightSeaLinuxDockerProofDriverForTest(
  optionsValue,
) {
  const options = exactObject(
    optionsValue,
    'AWS retained-storage host preflight SEA Linux Docker proof test options',
  );
  assertExactKeys(
    options,
    TEST_OPTIONS_KEYS,
    'AWS retained-storage host preflight SEA Linux Docker proof test options',
  );
  return createDriver(capturePorts(options.ports));
}

/** @param {unknown} value @returns {Readonly<{imageId: string, outputRoot: string}>} */
export function parseAwsRetainedStorageHostPreflightSeaLinuxDockerProofArgv(
  value,
) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((item) => typeof item !== 'string')
  ) {
    throw new TypeError(
      'Usage: run-aws-host-preflight-sea-linux-docker <sha256-image-id> <absolute-output-root>',
    );
  }
  return validateInput({ imageId: value[2], outputRoot: value[3] });
}

/** @param {unknown} argv @returns {Promise<void>} */
export async function main(argv) {
  const input =
    parseAwsRetainedStorageHostPreflightSeaLinuxDockerProofArgv(argv);
  const controller = new AbortController();
  /** @type {NodeJS.Signals | undefined} */
  let interruptedBy;
  /** @param {NodeJS.Signals} signal */
  const handleSignal = (signal) => {
    if (interruptedBy !== undefined) return;
    interruptedBy = signal;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    controller.abort();
  };
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
  try {
    const result = await PRODUCTION_DRIVER.run(input, {
      signal: controller.signal,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
  }
}

const invokedPath =
  typeof process.argv[1] === 'string'
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (invokedPath === import.meta.url) {
  main(process.argv).catch(() => {
    process.stderr.write(
      'AWS retained-storage host preflight SEA Linux Docker proof failed.\n',
    );
    if (process.exitCode === undefined || process.exitCode === 0) {
      process.exitCode = 1;
    }
  });
}

export default runAwsRetainedStorageHostPreflightSeaLinuxDockerProof;
