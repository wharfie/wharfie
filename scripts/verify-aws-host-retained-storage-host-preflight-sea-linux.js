/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This one-shot guest verifier keeps its strict injected protocol inline. */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  constants as fsConstants,
  createWriteStream,
  promises as fsp,
} from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NODE_VERSION = '24.13.1';
const NPM_VERSION = '11.12.0';
const EXPECTED_ARCHITECTURE = 'x86_64';
const NODE_ARCHIVE_FILE_NAME = 'node-v24.13.1-linux-x64.tar.gz';
const NODE_ARCHIVE_URL =
  'https://nodejs.org/dist/v24.13.1/node-v24.13.1-linux-x64.tar.gz';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SHA256 =
  'etKPsXKpqwWT-GwaOeXCaNDY_D1ssBZ_RVtWVaem4v0';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE = 56_127_068;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_EMPTY_SHA256 =
  '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_REDACTED_STDERR_SHA256 =
  'ZivTFMztiLh0VvgJtzIU9TWYgnAXuzeIZ7uA4pExZLs';
const INPUT_BUNDLE_PATH = '/wharfie-input/repo.bundle';
const INPUT_VERIFIER_PATH = '/wharfie-input/verifier.js';
const BOOTSTRAP_NODE_EXECUTABLE_PATH = '/usr/local/bin/node';
const WORK_ROOT_PARENT = '/wharfie-work';
const OWNERSHIP_MARKER_NAME = '.wharfie-guest-owner';
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const INVOCATION_ID_PATTERN = /^[0-9a-f]{32}$/u;
const OWNERSHIP_TOKEN_PATTERN = /^[0-9a-f]{32}$/u;
const MAX_ARGV_BYTES = 16 * 1024;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_GIT_BUNDLE_BYTES = 128 * 1024 * 1024;
const MAX_GIT_BUNDLE_HEADER_BYTES = 64 * 1024;
const MAX_CHECKOUT_INDEX_BYTES = 1024 * 1024;
const MAX_CHECKOUT_INDEX_ENTRIES = 8192;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const EXECUTION_TIMEOUT_MS = 60 * 1000;
const SETUP_TIMEOUT_MS = 5 * 60 * 1000;
const VERIFICATION_TIMEOUT_MS = 25 * 60 * 1000;
const FORCED_TERMINATION_REAP_TIMEOUT_MS = 2 * 1000;
const SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const KERNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,127}$/u;
const GLIBC_PATTERN = /^[0-9]+(?:\.[0-9]+){1,3}$/u;
const INPUT_KEYS = new Set([
  'sourceCommit',
  'invocationId',
  'gitBundlePath',
  'nodeArchivePath',
  'workRoot',
  'ownershipToken',
]);
const OPTION_KEYS = new Set(['host', 'ports']);
const HOST_KEYS = new Set([
  'platform',
  'architecture',
  'nodeVersion',
  'executablePath',
  'kernelRelease',
  'glibcVersionRuntime',
]);
const PORT_KEYS = new Set([
  'confirmOwnership',
  'prepare',
  'observeSourceCheckout',
  'nodeFoundOnRuntimePath',
  'observeBootstrapNodeArchive',
  'packageSea',
  'assertRegularFile',
  'loadArtifactRecord',
  'observeArtifact',
  'reproduceSourceArchive',
  'regenerateEntryBundle',
  'executeArtifact',
  'copyArtifact',
  'removeOriginalPublication',
  'publicationAbsent',
  'cleanup',
  'guestWorkAbsent',
]);
const PREPARED_KEYS = new Set([
  'checkoutRoot',
  'outputDirectory',
  'npmVersion',
  'sourceCheckout',
]);
const PACKAGE_KEYS = new Set(['artifactPath', 'recordPath']);
const BYTE_KEYS = new Set(['byteDigest', 'size']);
const ARCHIVE_KEYS = new Set(['fileName', 'byteDigest', 'size']);
const ARTIFACT_KEYS = new Set(['artifactId', 'byteDigest', 'size']);
const SOURCE_CHECKOUT_KEYS = new Set([
  'basis',
  'checkedOutCommit',
  'clean',
  'prerequisiteCount',
  'transportByteDigest',
  'transportSize',
]);
const EXECUTION_KEYS = new Set(['status', 'stdout', 'stderr']);
const PRELOAD_EXECUTION_KEYS = new Set([...EXECUTION_KEYS, 'preloadExecuted']);
const RUNTIME_ENVIRONMENT = Object.freeze({
  PATH: '/usr/bin:/bin',
  HOME: '/tmp',
  TMPDIR: '/tmp',
  LANG: 'C',
  LC_ALL: 'C',
});
const EXPECTED_EXECUTION = Object.freeze({
  status: 1,
  stdout: Object.freeze({
    byteDigest: Object.freeze({
      algorithm: 'sha256',
      value: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_EMPTY_SHA256,
    }),
    size: 0,
  }),
  stderr: Object.freeze({
    byteDigest: Object.freeze({
      algorithm: 'sha256',
      value:
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_REDACTED_STDERR_SHA256,
    }),
    size: 57,
  }),
});

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

/** @param {any} value @returns {any} */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

/** @param {unknown} value @param {string} valuePath @returns {any} */
function cloneBoundedJson(value, valuePath) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new TypeError(`${valuePath} must be JSON.`);
  }
  if (
    typeof text !== 'string' ||
    Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES
  ) {
    throw new TypeError(`${valuePath} exceeds its JSON byte limit.`);
  }
  return JSON.parse(text);
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

/** @param {string} invocationId @returns {string} */
function expectedWorkRoot(invocationId) {
  return `${WORK_ROOT_PARENT}/invocation-${invocationId}`;
}

/** @param {string} workRoot @returns {string} */
function expectedNodeArchivePath(workRoot) {
  return path.join(workRoot, 'bootstrap', NODE_ARCHIVE_FILE_NAME);
}

/** @param {string} workRoot @returns {string} */
function expectedNodeExecutablePath(workRoot) {
  return path.join(
    workRoot,
    'bootstrap',
    `node-v${NODE_VERSION}-linux-x64`,
    'bin',
    'node',
  );
}

/** @param {string} workRoot @returns {string} */
function expectedNpmCliPath(workRoot) {
  return path.join(
    workRoot,
    'npm-prefix',
    'lib',
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js',
  );
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateInput(value) {
  const input = exactObject(value, 'Linux SEA guest verification input');
  assertExactKeys(input, INPUT_KEYS, 'Linux SEA guest verification input');
  if (
    typeof input.sourceCommit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(input.sourceCommit) ||
    typeof input.invocationId !== 'string' ||
    !INVOCATION_ID_PATTERN.test(input.invocationId) ||
    typeof input.ownershipToken !== 'string' ||
    !OWNERSHIP_TOKEN_PATTERN.test(input.ownershipToken)
  ) {
    throw new TypeError('Linux SEA guest verification identities are invalid.');
  }
  const paths = {
    gitBundlePath: canonicalAbsolutePath(
      input.gitBundlePath,
      'Linux SEA guest verification gitBundlePath',
    ),
    nodeArchivePath: canonicalAbsolutePath(
      input.nodeArchivePath,
      'Linux SEA guest verification nodeArchivePath',
    ),
    workRoot: canonicalAbsolutePath(
      input.workRoot,
      'Linux SEA guest verification workRoot',
    ),
  };
  if (
    paths.gitBundlePath !== INPUT_BUNDLE_PATH ||
    paths.workRoot !== expectedWorkRoot(input.invocationId) ||
    paths.nodeArchivePath !== expectedNodeArchivePath(paths.workRoot) ||
    new Set(Object.values(paths)).size !== 3
  ) {
    throw new TypeError(
      'Linux SEA guest verification paths do not match the fixed invocation layout.',
    );
  }
  return Object.freeze({
    sourceCommit: input.sourceCommit,
    invocationId: input.invocationId,
    ownershipToken: input.ownershipToken,
    ...paths,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateHost(value) {
  const host = exactObject(value, 'Linux SEA guest verifier host');
  assertExactKeys(host, HOST_KEYS, 'Linux SEA guest verifier host');
  if (
    typeof host.platform !== 'string' ||
    typeof host.architecture !== 'string' ||
    typeof host.nodeVersion !== 'string' ||
    typeof host.executablePath !== 'string' ||
    typeof host.kernelRelease !== 'string' ||
    !KERNEL_PATTERN.test(host.kernelRelease) ||
    typeof host.glibcVersionRuntime !== 'string' ||
    !GLIBC_PATTERN.test(host.glibcVersionRuntime)
  ) {
    throw new TypeError('Linux SEA guest verifier host is invalid.');
  }
  return Object.freeze({ ...host });
}

/** @param {Readonly<Record<string, any>>} host @param {Readonly<Record<string, any>>} input @returns {void} */
function assertExactHost(host, input) {
  if (
    host.platform !== 'linux' ||
    host.architecture !== 'x64' ||
    host.nodeVersion !== NODE_VERSION ||
    host.executablePath !== expectedNodeExecutablePath(input.workRoot)
  ) {
    throw new Error(
      `Linux SEA guest verification requires Linux/x64 Node ${NODE_VERSION} and npm ${NPM_VERSION}.`,
    );
  }
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, Function>>} */
function capturePorts(value, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, PORT_KEYS, valuePath);
  /** @type {Record<string, Function>} */
  const captured = {};
  for (const key of PORT_KEYS) {
    if (typeof input[key] !== 'function') {
      throw new TypeError(`${valuePath}.${key} must be a function.`);
    }
    captured[key] = input[key].bind(input);
  }
  return Object.freeze(captured);
}

/** @param {unknown} value @param {string} valuePath @param {boolean} [allowEmpty] @returns {Readonly<Record<string, any>>} */
function validateByteObservation(value, valuePath, allowEmpty = false) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, BYTE_KEYS, valuePath);
  const digest = exactObject(input.byteDigest, `${valuePath}.byteDigest`);
  assertExactKeys(
    digest,
    new Set(['algorithm', 'value']),
    `${valuePath}.byteDigest`,
  );
  if (
    digest.algorithm !== 'sha256' ||
    typeof digest.value !== 'string' ||
    !SHA256_PATTERN.test(digest.value) ||
    typeof input.size !== 'number' ||
    !Number.isSafeInteger(input.size) ||
    input.size < (allowEmpty ? 0 : 1)
  ) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  return deepFreeze({
    byteDigest: { algorithm: 'sha256', value: digest.value },
    size: input.size,
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateArtifactObservation(value, valuePath) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, ARTIFACT_KEYS, valuePath);
  const observation = validateByteObservation(
    { byteDigest: input.byteDigest, size: input.size },
    valuePath,
  );
  if (input.artifactId !== `waf1_${observation.byteDigest.value}`) {
    throw new TypeError(`${valuePath}.artifactId does not name its bytes.`);
  }
  return deepFreeze({ artifactId: input.artifactId, ...observation });
}

/** @param {unknown} value @param {string} valuePath @param {string} sourceCommit @returns {Readonly<Record<string, any>>} */
function validateSourceCheckout(value, valuePath, sourceCommit) {
  const input = exactObject(value, valuePath);
  assertExactKeys(input, SOURCE_CHECKOUT_KEYS, valuePath);
  const transport = validateByteObservation(
    {
      byteDigest: input.transportByteDigest,
      size: input.transportSize,
    },
    `${valuePath} transport`,
  );
  if (
    input.basis !== 'guest-clean-detached-checkout' ||
    input.checkedOutCommit !== sourceCommit ||
    input.clean !== true ||
    input.prerequisiteCount !== 0
  ) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  return deepFreeze({
    basis: 'guest-clean-detached-checkout',
    checkedOutCommit: sourceCommit,
    clean: true,
    prerequisiteCount: 0,
    transportByteDigest: transport.byteDigest,
    transportSize: transport.size,
  });
}

/** @param {unknown} value @param {string} valuePath @param {boolean} [preload] @returns {Readonly<Record<string, any>>} */
function validateExecution(value, valuePath, preload = false) {
  const input = exactObject(value, valuePath);
  assertExactKeys(
    input,
    preload ? PRELOAD_EXECUTION_KEYS : EXECUTION_KEYS,
    valuePath,
  );
  if (
    typeof input.status !== 'number' ||
    !Number.isSafeInteger(input.status) ||
    input.status < 0 ||
    input.status > 255 ||
    !Buffer.isBuffer(input.stdout) ||
    !Buffer.isBuffer(input.stderr) ||
    input.stdout.length > MAX_OUTPUT_BYTES ||
    input.stderr.length > MAX_OUTPUT_BYTES ||
    (preload && input.preloadExecuted !== false)
  ) {
    throw new TypeError(`${valuePath} is invalid or exceeds its output limit.`);
  }
  /** @param {Buffer} bytes */
  const observe = (bytes) => ({
    byteDigest: {
      algorithm: 'sha256',
      value: createHash('sha256').update(bytes).digest('base64url'),
    },
    size: bytes.length,
  });
  return deepFreeze({
    status: input.status,
    stdout: observe(input.stdout),
    stderr: observe(input.stderr),
    ...(preload ? { preloadExecuted: false } : {}),
  });
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/**
 * Create one guest verifier around exact high-level ports. Ports may perform
 * native work; this orchestrator owns ordering, bounded observations, trust
 * separation, and cleanup-before-return.
 * @param {unknown} optionsValue
 * @returns {Readonly<{verify: (value: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsRetainedStorageHostPreflightSeaLinuxGuestVerifier(
  optionsValue,
) {
  const options = exactObject(optionsValue, 'Linux SEA guest verifier options');
  assertExactKeys(options, OPTION_KEYS, 'Linux SEA guest verifier options');
  const host = validateHost(options.host);
  const ports = capturePorts(options.ports, 'Linux SEA guest verifier ports');

  return Object.freeze({
    async verify(value) {
      const input = validateInput(value);
      /** @type {unknown} */
      let primaryError;
      /** @type {Record<string, any> | undefined} */
      let observations;
      let ownershipConfirmed = false;
      try {
        assertExactHost(host, input);
        if (
          (await ports.confirmOwnership(
            Object.freeze({
              invocationId: input.invocationId,
              workRoot: input.workRoot,
              ownershipToken: input.ownershipToken,
            }),
          )) !== true
        ) {
          throw new Error(
            'Linux SEA guest verification did not acquire cleanup ownership.',
          );
        }
        ownershipConfirmed = true;
        const preparedInput = Object.freeze({ ...input });
        const prepared = exactObject(
          await ports.prepare(preparedInput),
          'Linux SEA guest preparation result',
        );
        assertExactKeys(
          prepared,
          PREPARED_KEYS,
          'Linux SEA guest preparation result',
        );
        const checkoutRoot = canonicalAbsolutePath(
          prepared.checkoutRoot,
          'Linux SEA guest checkoutRoot',
        );
        const outputDirectory = canonicalAbsolutePath(
          prepared.outputDirectory,
          'Linux SEA guest outputDirectory',
        );
        if (
          checkoutRoot !== path.join(input.workRoot, 'checkout') ||
          outputDirectory !== path.join(input.workRoot, 'output') ||
          prepared.npmVersion !== NPM_VERSION
        ) {
          throw new Error(
            'Linux SEA guest preparation escaped its owned root or used the wrong npm.',
          );
        }
        const preparedSourceCheckout = validateSourceCheckout(
          prepared.sourceCheckout,
          'Linux SEA guest prepared source checkout',
          input.sourceCommit,
        );
        if (
          (await ports.nodeFoundOnRuntimePath(
            Object.freeze({ environment: RUNTIME_ENVIRONMENT }),
          )) !== false
        ) {
          throw new Error(
            'Linux SEA guest found Node on the recorded runtime PATH.',
          );
        }

        const bootstrapInput = exactObject(
          await ports.observeBootstrapNodeArchive(
            Object.freeze({ path: input.nodeArchivePath }),
          ),
          'Linux SEA guest bootstrap archive observation',
        );
        assertExactKeys(
          bootstrapInput,
          ARCHIVE_KEYS,
          'Linux SEA guest bootstrap archive observation',
        );
        /** @type {Record<string, any>} */
        const bootstrapNodeArchive = {
          basis: 'downloaded-pinned-sha256-observation',
          fileName: bootstrapInput.fileName,
          ...validateByteObservation(
            {
              byteDigest: bootstrapInput.byteDigest,
              size: bootstrapInput.size,
            },
            'Linux SEA guest bootstrap archive observation',
          ),
        };
        if (
          bootstrapNodeArchive.fileName !== NODE_ARCHIVE_FILE_NAME ||
          bootstrapNodeArchive.byteDigest.value !==
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SHA256 ||
          bootstrapNodeArchive.size !==
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE
        ) {
          throw new TypeError('Linux SEA guest bootstrap archive is invalid.');
        }

        const packaged = exactObject(
          await ports.packageSea(
            Object.freeze({
              checkoutRoot,
              outputDirectory,
              sourceCommit: input.sourceCommit,
              expectedArchitecture: EXPECTED_ARCHITECTURE,
            }),
          ),
          'Linux SEA guest package result',
        );
        assertExactKeys(
          packaged,
          PACKAGE_KEYS,
          'Linux SEA guest package result',
        );
        const artifactPath = canonicalAbsolutePath(
          packaged.artifactPath,
          'Linux SEA guest artifactPath',
        );
        const recordPath = canonicalAbsolutePath(
          packaged.recordPath,
          'Linux SEA guest recordPath',
        );
        if (
          artifactPath === recordPath ||
          (await ports.assertRegularFile(
            Object.freeze({ path: artifactPath, ownedRoot: outputDirectory }),
          )) !== true ||
          (await ports.assertRegularFile(
            Object.freeze({ path: recordPath, ownedRoot: outputDirectory }),
          )) !== true
        ) {
          throw new Error(
            'Linux SEA guest package returned an unsafe artifact path.',
          );
        }
        const artifactRecord = cloneBoundedJson(
          await ports.loadArtifactRecord(
            Object.freeze({ checkoutRoot, recordPath }),
          ),
          'Linux SEA guest artifact record',
        );
        const publishedArtifact = validateArtifactObservation(
          await ports.observeArtifact(
            Object.freeze({
              path: artifactPath,
              maximumBytes: MAX_ARTIFACT_BYTES,
            }),
          ),
          'Linux SEA guest published artifact',
        );
        const reproducedSourceArchive = validateByteObservation(
          await ports.reproduceSourceArchive(
            Object.freeze({ checkoutRoot, sourceCommit: input.sourceCommit }),
          ),
          'Linux SEA guest reproduced source archive',
        );
        const regeneratedEntryBundle = validateByteObservation(
          await ports.regenerateEntryBundle(
            Object.freeze({
              checkoutRoot,
              sourceCommit: input.sourceCommit,
              expectedArchitecture: EXPECTED_ARCHITECTURE,
            }),
          ),
          'Linux SEA guest regenerated entry bundle',
        );
        const sourceCheckout = validateSourceCheckout(
          await ports.observeSourceCheckout(
            Object.freeze({
              checkoutRoot,
              gitBundlePath: input.gitBundlePath,
              sourceCommit: input.sourceCommit,
              prerequisiteCount: preparedSourceCheckout.prerequisiteCount,
            }),
          ),
          'Linux SEA guest final source checkout',
          input.sourceCommit,
        );
        if (
          !sameJson(
            {
              byteDigest: sourceCheckout.transportByteDigest,
              size: sourceCheckout.transportSize,
            },
            {
              byteDigest: preparedSourceCheckout.transportByteDigest,
              size: preparedSourceCheckout.transportSize,
            },
          )
        ) {
          throw new Error(
            'Linux SEA guest source transport changed during verification.',
          );
        }
        const original = validateExecution(
          await ports.executeArtifact(
            Object.freeze({
              path: artifactPath,
              arguments: Object.freeze([]),
              environment: RUNTIME_ENVIRONMENT,
              controlledPreload: false,
            }),
          ),
          'Linux SEA guest original execution',
        );

        const relocatedPath = path.join(
          input.workRoot,
          'relocated',
          'wharfie-host-preflight',
        );
        await ports.copyArtifact(
          Object.freeze({
            sourcePath: artifactPath,
            destinationPath: relocatedPath,
            ownedRoot: input.workRoot,
          }),
        );
        await ports.removeOriginalPublication(
          Object.freeze({ artifactPath, recordPath }),
        );
        if (
          (await ports.publicationAbsent(
            Object.freeze({ artifactPath, recordPath }),
          )) !== true
        ) {
          throw new Error(
            'Linux SEA guest original publication remains before relocated execution.',
          );
        }
        const relocatedArtifact = validateArtifactObservation(
          await ports.observeArtifact(
            Object.freeze({
              path: relocatedPath,
              maximumBytes: MAX_ARTIFACT_BYTES,
            }),
          ),
          'Linux SEA guest relocated artifact',
        );
        const relocated = validateExecution(
          await ports.executeArtifact(
            Object.freeze({
              path: relocatedPath,
              arguments: Object.freeze([]),
              environment: RUNTIME_ENVIRONMENT,
              controlledPreload: false,
            }),
          ),
          'Linux SEA guest relocated execution',
        );
        const extraArgument = validateExecution(
          await ports.executeArtifact(
            Object.freeze({
              path: relocatedPath,
              arguments: Object.freeze(['unexpected']),
              environment: RUNTIME_ENVIRONMENT,
              controlledPreload: false,
            }),
          ),
          'Linux SEA guest extra-argument execution',
        );
        const inheritedNodeOptions = validateExecution(
          await ports.executeArtifact(
            Object.freeze({
              path: relocatedPath,
              arguments: Object.freeze([]),
              environment: RUNTIME_ENVIRONMENT,
              controlledPreload: true,
            }),
          ),
          'Linux SEA guest inherited-option execution',
          true,
        );
        if (
          !sameJson(publishedArtifact, relocatedArtifact) ||
          !sameJson(original, EXPECTED_EXECUTION) ||
          !sameJson(relocated, EXPECTED_EXECUTION) ||
          !sameJson(extraArgument, EXPECTED_EXECUTION) ||
          !sameJson(
            {
              status: inheritedNodeOptions.status,
              stdout: inheritedNodeOptions.stdout,
              stderr: inheritedNodeOptions.stderr,
            },
            EXPECTED_EXECUTION,
          )
        ) {
          throw new Error(
            'Linux SEA guest bytes or deterministic execution matrix differs.',
          );
        }
        observations = {
          subject: {
            sourceCommit: input.sourceCommit,
            recordId: artifactRecord.recordId,
            artifactId: artifactRecord.artifactId,
          },
          builderClaims: { artifactRecord },
          independentObservations: {
            bootstrapNodeArchive,
            sourceCheckout,
            reproducedSourceArchive: {
              basis: 'clean-checkout-reproduction',
              format: artifactRecord.sourceArchive.format,
              ...reproducedSourceArchive,
            },
            regeneratedEntryBundle: {
              basis: 'implementation-under-test-reproduction',
              format: artifactRecord.entryBundle.format,
              ...regeneratedEntryBundle,
            },
            publishedArtifact: {
              basis: 'held-file-observation',
              ...publishedArtifact,
            },
            relocatedArtifact: {
              basis: 'held-file-observation',
              ...relocatedArtifact,
              originalPublicationAbsent: true,
            },
            proofEnvironment: {
              platform: host.platform,
              architecture: host.architecture,
              kernelRelease: host.kernelRelease,
              glibcVersionRuntime: host.glibcVersionRuntime,
              builderNodeVersion: host.nodeVersion,
              npmVersion: prepared.npmVersion,
            },
            runtimeEnvironment: {
              path: RUNTIME_ENVIRONMENT.PATH,
              nodeFoundOnPath: false,
            },
            executions: {
              original,
              relocated,
              extraArgument,
              inheritedNodeOptions,
            },
          },
        };
      } catch (error) {
        primaryError = error;
      }

      /** @type {unknown} */
      let cleanupError;
      if (ownershipConfirmed) {
        try {
          await ports.cleanup(
            Object.freeze({
              invocationId: input.invocationId,
              workRoot: input.workRoot,
              ownershipToken: input.ownershipToken,
            }),
          );
          if (
            (await ports.guestWorkAbsent(
              Object.freeze({ workRoot: input.workRoot }),
            )) !== true
          ) {
            throw new Error('Linux SEA guest work remains after cleanup.');
          }
        } catch (error) {
          cleanupError = error;
        }
      }
      if (primaryError || cleanupError) {
        if (primaryError && !cleanupError) throw primaryError;
        throw new AggregateError(
          [
            ...(primaryError ? [primaryError] : []),
            ...(cleanupError ? [cleanupError] : []),
          ],
          'Linux SEA guest verification failed and cleanup was incomplete.',
        );
      }
      if (!observations) {
        throw new Error(
          'Linux SEA guest verification produced no observations.',
        );
      }
      observations.independentObservations.cleanup = {
        guestWork: {
          invocationId: input.invocationId,
          removed: true,
        },
      };
      return deepFreeze(canonical(observations));
    },
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

/** @param {import('node:fs').BigIntStats} stats @returns {Readonly<{dev: bigint, ino: bigint}>} */
function directoryIdentity(stats) {
  return Object.freeze({ dev: stats.dev, ino: stats.ino });
}

/** @param {Readonly<{dev: bigint, ino: bigint}>} left @param {Readonly<{dev: bigint, ino: bigint}>} right @returns {boolean} */
function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

/** @param {string} filePath @param {number} maximumBytes @returns {Promise<Readonly<Record<string, any>>>} */
async function observeStableFile(filePath, maximumBytes) {
  const beforePath = await fsp.lstat(filePath, { bigint: true });
  if (
    beforePath.isSymbolicLink() ||
    !beforePath.isFile() ||
    beforePath.size < 1n ||
    beforePath.size > BigInt(maximumBytes)
  ) {
    throw new Error('Linux SEA guest observed file is invalid.');
  }
  const handle = await fsp.open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFile(beforePath, before)) {
      throw new Error('Linux SEA guest observed file changed before reading.');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < Number(before.size)) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - offset),
        offset,
      );
      if (bytesRead === 0)
        throw new Error('Linux SEA guest file was truncated.');
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const [after, afterPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fsp.lstat(filePath, { bigint: true }),
    ]);
    if (!sameFile(before, after) || !sameFile(after, afterPath)) {
      throw new Error('Linux SEA guest observed file changed while reading.');
    }
    return Object.freeze({
      byteDigest: Object.freeze({
        algorithm: 'sha256',
        value: hash.digest('base64url'),
      }),
      size: offset,
    });
  } finally {
    await handle.close();
  }
}

/** @param {string} filePath @param {number} maximumBytes @returns {Promise<Buffer>} */
async function readStableFileBytes(filePath, maximumBytes) {
  const beforePath = await fsp.lstat(filePath, { bigint: true });
  if (
    beforePath.isSymbolicLink() ||
    !beforePath.isFile() ||
    beforePath.size < 1n ||
    beforePath.size > BigInt(maximumBytes)
  ) {
    throw new Error('Linux SEA guest bounded file is invalid.');
  }
  const handle = await fsp.open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFile(beforePath, before)) {
      throw new Error('Linux SEA guest bounded file changed before reading.');
    }
    const bytes = await handle.readFile();
    const [after, afterPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fsp.lstat(filePath, { bigint: true }),
    ]);
    if (
      bytes.length !== Number(before.size) ||
      !sameFile(before, after) ||
      !sameFile(after, afterPath)
    ) {
      throw new Error('Linux SEA guest bounded file changed while reading.');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

/** @param {string} child @param {string} root @returns {boolean} */
function isStrictlyBeneath(child, root) {
  const relative = path.relative(root, child);
  return (
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  );
}

/** @param {Buffer} bytes @returns {number} */
function validateRegularCheckoutIndex(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 1 ||
    bytes.length > MAX_CHECKOUT_INDEX_BYTES
  ) {
    throw new Error('Linux SEA guest checkout index is invalid or oversized.');
  }
  let offset = 0;
  let count = 0;
  while (offset < bytes.length) {
    const terminal = bytes.indexOf(0, offset);
    if (terminal < 0 || terminal === offset) {
      throw new Error('Linux SEA guest checkout index framing is invalid.');
    }
    const record = bytes.subarray(offset, terminal);
    const separator = record.indexOf(0x09);
    if (
      separator < 1 ||
      separator === record.length - 1 ||
      !/^100(?:644|755) [0-9a-f]{40} 0$/u.test(
        record.subarray(0, separator).toString('ascii'),
      )
    ) {
      throw new Error(
        'Linux SEA guest checkout index contains a non-regular tracked path.',
      );
    }
    count += 1;
    if (count > MAX_CHECKOUT_INDEX_ENTRIES) {
      throw new Error('Linux SEA guest checkout index has too many entries.');
    }
    offset = terminal + 1;
  }
  return count;
}

/** @param {string} filePath @param {string} ownedRoot @returns {Promise<void>} */
async function assertRegularFileBeneath(filePath, ownedRoot) {
  if (!isStrictlyBeneath(filePath, ownedRoot)) {
    throw new Error('Linux SEA guest file escaped its owned root.');
  }
  const stats = await fsp.lstat(filePath);
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    (await fsp.realpath(filePath)) !== filePath
  ) {
    throw new Error('Linux SEA guest owned file is not one real regular file.');
  }
}

/** @param {string} checkoutRoot @param {string} relativePath @returns {Promise<string>} */
async function resolveCheckoutModulePath(checkoutRoot, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    path.normalize(relativePath) !== relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error('Linux SEA guest checkout module path is invalid.');
  }
  const modulePath = path.join(checkoutRoot, relativePath);
  await assertRegularFileBeneath(modulePath, checkoutRoot);
  return modulePath;
}

/** @param {{sourcePath: string, destinationPath: string, ownedRoot: string}} input @returns {Promise<void>} */
async function copyArtifactIntoOwnedRoot(input) {
  const ownedRoot = canonicalAbsolutePath(
    input.ownedRoot,
    'Linux SEA guest relocation ownedRoot',
  );
  const expectedSourceRoot = path.join(ownedRoot, 'output');
  const expectedDestination = path.join(
    ownedRoot,
    'relocated',
    'wharfie-host-preflight',
  );
  if (
    input.destinationPath !== expectedDestination ||
    !isStrictlyBeneath(expectedSourceRoot, ownedRoot)
  ) {
    throw new Error('Linux SEA guest relocation path escaped its owned root.');
  }
  await assertRegularFileBeneath(input.sourcePath, expectedSourceRoot);
  const destinationDirectory = path.dirname(input.destinationPath);
  await fsp.mkdir(destinationDirectory, {
    recursive: true,
    mode: 0o700,
  });
  const directoryStats = await fsp.lstat(destinationDirectory);
  if (
    directoryStats.isSymbolicLink() ||
    !directoryStats.isDirectory() ||
    (await fsp.realpath(destinationDirectory)) !== destinationDirectory
  ) {
    throw new Error(
      'Linux SEA guest relocation directory is not a real owned directory.',
    );
  }
  await fsp.copyFile(
    input.sourcePath,
    input.destinationPath,
    fsConstants.COPYFILE_EXCL,
  );
  await assertRegularFileBeneath(input.destinationPath, ownedRoot);
  await fsp.chmod(input.destinationPath, 0o755);
}

/** @param {string} bundlePath @param {string} sourceCommit @returns {Promise<Readonly<Record<string, any>>>} */
async function validateGitBundleHeader(bundlePath, sourceCommit) {
  const beforePath = await fsp.lstat(bundlePath, { bigint: true });
  if (
    beforePath.isSymbolicLink() ||
    !beforePath.isFile() ||
    beforePath.size < 1n ||
    beforePath.size > BigInt(MAX_GIT_BUNDLE_BYTES)
  ) {
    throw new Error('Linux SEA guest Git bundle is invalid.');
  }
  const handle = await fsp.open(
    bundlePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFile(beforePath, before)) {
      throw new Error('Linux SEA guest Git bundle changed before reading.');
    }
    const bytes = Buffer.allocUnsafe(MAX_GIT_BUNDLE_HEADER_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const headerEnd = bytes.subarray(0, bytesRead).indexOf('\n\n');
    if (headerEnd < 1 || headerEnd > MAX_GIT_BUNDLE_HEADER_BYTES) {
      throw new Error('Linux SEA guest Git bundle header is unbounded.');
    }
    const header = bytes.subarray(0, headerEnd).toString('utf8');
    if (
      header.includes('\r') ||
      (!header.startsWith('# v2 git bundle\n') &&
        !header.startsWith('# v3 git bundle\n'))
    ) {
      throw new Error('Linux SEA guest Git bundle header is invalid.');
    }
    const lines = header.split('\n').slice(1);
    const prerequisites = lines.filter((line) => line.startsWith('-'));
    const references = lines.filter((line) => /^[0-9a-f]{40} /u.test(line));
    const unrecognized = lines.filter(
      (line) =>
        !line.startsWith('-') &&
        !line.startsWith('@') &&
        !/^[0-9a-f]{40} /u.test(line),
    );
    if (
      prerequisites.length !== 0 ||
      references.length !== 1 ||
      references[0] !== `${sourceCommit} HEAD` ||
      unrecognized.length !== 0
    ) {
      throw new Error(
        'Linux SEA guest Git bundle must contain exact HEAD with zero prerequisites.',
      );
    }
    const [after, afterPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fsp.lstat(bundlePath, { bigint: true }),
    ]);
    if (!sameFile(before, after) || !sameFile(after, afterPath)) {
      throw new Error('Linux SEA guest Git bundle changed while reading.');
    }
    const transport = await observeStableFile(bundlePath, MAX_GIT_BUNDLE_BYTES);
    const finalPath = await fsp.lstat(bundlePath, { bigint: true });
    if (!sameFile(before, finalPath)) {
      throw new Error(
        'Linux SEA guest Git bundle changed between header and transport observation.',
      );
    }
    return Object.freeze({
      basis: 'guest-clean-detached-checkout',
      checkedOutCommit: sourceCommit,
      clean: true,
      prerequisiteCount: 0,
      transportByteDigest: transport.byteDigest,
      transportSize: transport.size,
    });
  } finally {
    await handle.close();
  }
}

/** @param {import('node:child_process').ChildProcess} child @returns {void} */
function killChildProcessGroup(child) {
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

/** @param {string} command @param {readonly string[]} args @param {Record<string, string>} environment @param {{cwd?: string, timeoutMs?: number, maximumOutputBytes?: number, forcedTerminationReapTimeoutMs?: number}} [options] @returns {Promise<{status: number, stdout: Buffer, stderr: Buffer}>} */
async function runBounded(command, args, environment, options = {}) {
  const timeoutMs = options.timeoutMs ?? EXECUTION_TIMEOUT_MS;
  const maximumOutputBytes = options.maximumOutputBytes ?? MAX_OUTPUT_BYTES;
  const forcedTerminationReapTimeoutMs =
    options.forcedTerminationReapTimeoutMs ??
    FORCED_TERMINATION_REAP_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > VERIFICATION_TIMEOUT_MS ||
    !Number.isSafeInteger(maximumOutputBytes) ||
    maximumOutputBytes < 1 ||
    maximumOutputBytes > MAX_OUTPUT_BYTES ||
    !Number.isSafeInteger(forcedTerminationReapTimeoutMs) ||
    forcedTerminationReapTimeoutMs < 1 ||
    forcedTerminationReapTimeoutMs > FORCED_TERMINATION_REAP_TIMEOUT_MS
  ) {
    throw new TypeError('Linux SEA guest child limits are invalid.');
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    /** @type {unknown} */
    let failure;
    let settled = false;
    /** @type {NodeJS.Timeout | undefined} */
    let reapTimeout;
    const clearTimers = () => {
      clearTimeout(timeout);
      if (reapTimeout) clearTimeout(reapTimeout);
    };
    /** @param {unknown} error */
    const forceTermination = (error) => {
      if (failure || settled) return;
      failure = error;
      killChildProcessGroup(child);
      reapTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimers();
        child.stdout.destroy();
        child.stderr.destroy();
        reject(
          new AggregateError(
            [failure],
            'Linux SEA guest child did not close after forced termination.',
          ),
        );
      }, forcedTerminationReapTimeoutMs);
    };
    const timeout = setTimeout(() => {
      forceTermination(
        new Error('Linux SEA guest child exceeded its wall-clock limit.'),
      );
    }, timeoutMs);
    /** @param {Buffer[]} chunks @param {'stdout'|'stderr'} sizeKey @param {Buffer} chunk */
    const capture = (chunks, sizeKey, chunk) => {
      if (failure || settled) return;
      const size = sizeKey === 'stdout' ? stdoutSize : stderrSize;
      if (size + chunk.length > maximumOutputBytes) {
        forceTermination(
          new Error('Linux SEA guest child output exceeded its limit.'),
        );
        return;
      }
      chunks.push(Buffer.from(chunk));
      if (sizeKey === 'stdout') stdoutSize += chunk.length;
      else stderrSize += chunk.length;
    };
    child.stdout.on('data', (chunk) => capture(stdout, 'stdout', chunk));
    child.stderr.on('data', (chunk) => capture(stderr, 'stderr', chunk));
    child.once('error', (error) => {
      if (failure || settled) return;
      if (typeof child.pid !== 'number') {
        settled = true;
        clearTimers();
        reject(error);
      } else {
        forceTermination(error);
      }
    });
    child.once('close', (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (failure) {
        reject(failure);
      } else if (signal || !Number.isInteger(status)) {
        reject(new Error('Linux SEA guest child did not exit normally.'));
      } else {
        resolve({
          status: Number(status),
          stdout: Buffer.concat(stdout, stdoutSize),
          stderr: Buffer.concat(stderr, stderrSize),
        });
      }
    });
  });
}

/** @param {string} command @param {readonly string[]} args @param {Record<string, string>} environment @param {{cwd?: string, timeoutMs?: number}} [options] @returns {Promise<Buffer>} */
async function runChecked(command, args, environment, options = {}) {
  const result = await runBounded(command, args, environment, {
    ...options,
    timeoutMs: options.timeoutMs ?? SETUP_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    throw new Error('Linux SEA guest setup command failed.');
  }
  return result.stdout;
}

/** @param {string} modulePath @returns {Promise<any>} */
async function importFresh(modulePath) {
  const url = pathToFileURL(modulePath);
  url.searchParams.set('guestProof', `${process.pid}-${Date.now()}`);
  return await import(url.href);
}

/** @param {string} invocationId @param {string} ownershipToken @param {Readonly<{dev: bigint, ino: bigint}>} identity @returns {Buffer} */
function ownershipMarkerBytes(invocationId, ownershipToken, identity) {
  return Buffer.from(
    `${invocationId}:${ownershipToken}:${identity.dev}:${identity.ino}\n`,
    'utf8',
  );
}

/** @param {{invocationId: string, workRoot: string, ownershipToken: string}} input @param {Readonly<{dev: bigint, ino: bigint}>} [expectedIdentity] @returns {Promise<Readonly<{dev: bigint, ino: bigint}>>} */
async function assertOwnedWorkRoot(input, expectedIdentity) {
  if (
    input.workRoot !== expectedWorkRoot(input.invocationId) ||
    !OWNERSHIP_TOKEN_PATTERN.test(input.ownershipToken)
  ) {
    throw new Error('Linux SEA guest ownership identity is invalid.');
  }
  const stats = await fsp.lstat(input.workRoot, { bigint: true });
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    (await fsp.realpath(input.workRoot)) !== input.workRoot
  ) {
    throw new Error('Linux SEA guest work root is not owned.');
  }
  const identity = directoryIdentity(stats);
  if (expectedIdentity && !sameDirectoryIdentity(identity, expectedIdentity)) {
    throw new Error('Linux SEA guest work root identity changed.');
  }
  const markerPath = path.join(input.workRoot, OWNERSHIP_MARKER_NAME);
  const marker = await readStableFileBytes(markerPath, 256);
  if (
    !marker.equals(
      ownershipMarkerBytes(input.invocationId, input.ownershipToken, identity),
    )
  ) {
    throw new Error('Linux SEA guest ownership marker does not match.');
  }
  return identity;
}

/** @param {string} workRoot @param {Readonly<{dev: bigint, ino: bigint}>} identity @param {{allowAbsent: boolean}} options @returns {Promise<void>} */
async function removeOwnedDirectoryByIdentity(workRoot, identity, options) {
  const current = await fsp.lstat(workRoot, { bigint: true }).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (current === null) {
    if (options.allowAbsent) return;
    throw new Error('Linux SEA guest owned root disappeared before cleanup.');
  }
  if (
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    !sameDirectoryIdentity(directoryIdentity(current), identity)
  ) {
    throw new Error('Linux SEA guest refuses to remove an unowned root.');
  }
  const quarantinePath = `${workRoot}.removing-${randomBytes(16).toString(
    'hex',
  )}`;
  await fsp.rename(workRoot, quarantinePath);
  const moved = await fsp.lstat(quarantinePath, { bigint: true });
  if (
    moved.isSymbolicLink() ||
    !moved.isDirectory() ||
    !sameDirectoryIdentity(directoryIdentity(moved), identity)
  ) {
    throw new Error(
      'Linux SEA guest owned root identity changed during cleanup.',
    );
  }
  await fsp.rm(quarantinePath, { force: true, recursive: true });
  const [quarantineAbsent, originalAbsent] = await Promise.all([
    fsp.lstat(quarantinePath).then(
      () => false,
      (error) => {
        if (error?.code === 'ENOENT') return true;
        throw error;
      },
    ),
    fsp.lstat(workRoot).then(
      () => false,
      (error) => {
        if (error?.code === 'ENOENT') return true;
        throw error;
      },
    ),
  ]);
  if (!quarantineAbsent || !originalAbsent) {
    throw new Error('Linux SEA guest owned root was recreated during cleanup.');
  }
}

/** @param {string} checkoutRoot @param {string} sourceCommit @param {Readonly<Record<string, any>>} transport @param {Record<string, string>} environment @returns {Promise<Readonly<Record<string, any>>>} */
async function observeCleanCheckout(
  checkoutRoot,
  sourceCommit,
  transport,
  environment,
) {
  const checkoutStats = await fsp.lstat(checkoutRoot);
  if (
    checkoutStats.isSymbolicLink() ||
    !checkoutStats.isDirectory() ||
    (await fsp.realpath(checkoutRoot)) !== checkoutRoot
  ) {
    throw new Error('Linux SEA guest checkout root is invalid.');
  }
  const head = (
    await runChecked(
      'git',
      ['-C', checkoutRoot, 'rev-parse', '--verify', 'HEAD^{commit}'],
      environment,
    )
  )
    .toString('utf8')
    .trim();
  const dirty = await runChecked(
    'git',
    ['-C', checkoutRoot, 'status', '--porcelain=v1', '--untracked-files=all'],
    environment,
  );
  const checkoutIndex = await runChecked(
    'git',
    ['-C', checkoutRoot, 'ls-files', '--stage', '-z'],
    environment,
  );
  if (
    head !== sourceCommit ||
    dirty.length !== 0 ||
    validateRegularCheckoutIndex(checkoutIndex) < 1
  ) {
    throw new Error('Linux SEA guest checkout is not clean and exact.');
  }
  return Object.freeze({
    basis: 'guest-clean-detached-checkout',
    checkedOutCommit: sourceCommit,
    clean: true,
    prerequisiteCount: 0,
    transportByteDigest: transport.transportByteDigest,
    transportSize: transport.transportSize,
  });
}

/** @returns {Readonly<Record<string, Function>>} */
function createProductionPorts() {
  /** @type {Readonly<{dev: bigint, ino: bigint}> | undefined} */
  let confirmedIdentity;
  /** @type {string | undefined} */
  let confirmedWorkRoot;
  /** @param {string} workRoot @returns {Record<string, string>} */
  const baseEnvironment = (workRoot) => {
    /** @type {Record<string, string>} */
    const environment = {
      PATH: '/usr/bin:/bin',
      HOME: path.join(workRoot, 'home'),
      TMPDIR: path.join(workRoot, 'tmp'),
      LANG: 'C',
      LC_ALL: 'C',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: os.devNull,
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_OPTIONAL_LOCKS: '0',
      npm_config_cache: path.join(workRoot, 'npm-cache'),
      npm_config_ignore_scripts: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    };
    return environment;
  };
  /** @param {string} workRoot @returns {Promise<Readonly<{dev: bigint, ino: bigint}>>} */
  const requireConfirmedWorkRoot = async (workRoot) => {
    if (!confirmedIdentity || confirmedWorkRoot !== workRoot) {
      throw new Error(
        'Linux SEA guest work root has not been identity-confirmed.',
      );
    }
    const current = await fsp.lstat(workRoot, { bigint: true });
    if (
      current.isSymbolicLink() ||
      !current.isDirectory() ||
      !sameDirectoryIdentity(directoryIdentity(current), confirmedIdentity)
    ) {
      throw new Error('Linux SEA guest work root identity changed.');
    }
    return confirmedIdentity;
  };
  return Object.freeze({
    /** @param {{invocationId: string, workRoot: string, ownershipToken: string}} input */
    async confirmOwnership(input) {
      if (confirmedIdentity || confirmedWorkRoot) {
        throw new Error(
          'Linux SEA guest cleanup ownership was already confirmed.',
        );
      }
      confirmedIdentity = await assertOwnedWorkRoot(input);
      confirmedWorkRoot = input.workRoot;
      return true;
    },
    /** @param {{sourceCommit: string, invocationId: string, gitBundlePath: string, nodeArchivePath: string, workRoot: string, ownershipToken: string}} input */
    async prepare(input) {
      await assertOwnedWorkRoot(
        input,
        await requireConfirmedWorkRoot(input.workRoot),
      );
      const environment = baseEnvironment(input.workRoot);
      const transport = await validateGitBundleHeader(
        input.gitBundlePath,
        input.sourceCommit,
      );
      const checkoutRoot = path.join(input.workRoot, 'checkout');
      const outputDirectory = path.join(input.workRoot, 'output');
      await fsp.mkdir(outputDirectory, { mode: 0o700 });
      await runChecked(
        'git',
        [
          'clone',
          '--quiet',
          '--no-checkout',
          input.gitBundlePath,
          checkoutRoot,
        ],
        environment,
      );
      await runChecked(
        'git',
        [
          '-C',
          checkoutRoot,
          'checkout',
          '--quiet',
          '--detach',
          input.sourceCommit,
        ],
        environment,
      );
      const npmCli = expectedNpmCliPath(input.workRoot);
      await assertRegularFileBeneath(npmCli, input.workRoot);
      const npmVersion = (
        await runChecked(process.execPath, [npmCli, '--version'], environment)
      )
        .toString('utf8')
        .trim();
      if (npmVersion !== NPM_VERSION) {
        throw new Error(`Linux SEA guest requires npm ${NPM_VERSION}.`);
      }
      await runChecked(
        process.execPath,
        [
          npmCli,
          'ci',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--loglevel=error',
        ],
        environment,
        { cwd: checkoutRoot },
      );
      const sourceCheckout = await observeCleanCheckout(
        checkoutRoot,
        input.sourceCommit,
        transport,
        environment,
      );
      return { checkoutRoot, outputDirectory, npmVersion, sourceCheckout };
    },
    /** @param {{checkoutRoot: string, gitBundlePath: string, sourceCommit: string}} input */
    async observeSourceCheckout(input) {
      const transport = await validateGitBundleHeader(
        input.gitBundlePath,
        input.sourceCommit,
      );
      return await observeCleanCheckout(
        input.checkoutRoot,
        input.sourceCommit,
        transport,
        baseEnvironment(path.dirname(input.checkoutRoot)),
      );
    },
    /** @param {{environment: Record<string, string>}} input */
    async nodeFoundOnRuntimePath({ environment }) {
      for (const directory of environment.PATH.split(':')) {
        const candidate = path.join(directory, 'node');
        try {
          const stats = await fsp.stat(candidate);
          await fsp.access(candidate, fsConstants.X_OK);
          if (stats.isFile()) return true;
        } catch (error) {
          const code = /** @type {NodeJS.ErrnoException} */ (error).code;
          if (code !== 'ENOENT' && code !== 'EACCES') throw error;
        }
      }
      return false;
    },
    /** @param {{path: string}} input */
    async observeBootstrapNodeArchive({ path: archivePath }) {
      const observed = await observeStableFile(archivePath, MAX_ARCHIVE_BYTES);
      return { fileName: path.basename(archivePath), ...observed };
    },
    /** @param {{checkoutRoot: string, outputDirectory: string, sourceCommit: string, expectedArchitecture: string}} input */
    async packageSea(input) {
      await requireConfirmedWorkRoot(path.dirname(input.checkoutRoot));
      const modulePath = await resolveCheckoutModulePath(
        input.checkoutRoot,
        'scripts/aws-host-retained-storage-host-preflight-sea-package.js',
      );
      const namespace = await importFresh(modulePath);
      const result = await namespace.packageAwsRetainedStorageHostPreflightSea({
        sourceCommit: input.sourceCommit,
        expectedArchitecture: input.expectedArchitecture,
        outputDirectory: input.outputDirectory,
      });
      return { artifactPath: result.path, recordPath: result.recordPath };
    },
    /** @param {{path: string, ownedRoot: string}} input */
    async assertRegularFile(input) {
      await assertRegularFileBeneath(input.path, input.ownedRoot);
      return true;
    },
    /** @param {{checkoutRoot: string, recordPath: string}} input */
    async loadArtifactRecord({ checkoutRoot, recordPath }) {
      const bytes = await readStableFileBytes(recordPath, MAX_RECORD_BYTES);
      const modulePath = await resolveCheckoutModulePath(
        checkoutRoot,
        'scripts/aws-host-retained-storage-host-preflight-sea-artifact-record.js',
      );
      const namespace = await importFresh(modulePath);
      return namespace.validateAwsRetainedStorageHostPreflightSeaArtifactRecordClaims(
        JSON.parse(bytes.toString('utf8')),
      );
    },
    /** @param {{path: string, maximumBytes: number}} input */
    async observeArtifact({ path: artifactPath, maximumBytes }) {
      const observed = await observeStableFile(artifactPath, maximumBytes);
      return {
        artifactId: `waf1_${observed.byteDigest.value}`,
        ...observed,
      };
    },
    /** @param {{checkoutRoot: string, sourceCommit: string}} input */
    async reproduceSourceArchive({ checkoutRoot, sourceCommit }) {
      const modulePath = await resolveCheckoutModulePath(
        checkoutRoot,
        'scripts/aws-host-retained-storage-host-preflight-sea-source.js',
      );
      const namespace = await importFresh(modulePath);
      const snapshot =
        await namespace.createAwsRetainedStorageHostPreflightSeaSourceSnapshot({
          sourceCommit,
        });
      try {
        return {
          byteDigest: snapshot.archive.byteDigest,
          size: snapshot.archive.size,
        };
      } finally {
        await snapshot.close();
      }
    },
    /** @param {{checkoutRoot: string, sourceCommit: string, expectedArchitecture: string}} input */
    async regenerateEntryBundle(input) {
      const sourceModulePath = await resolveCheckoutModulePath(
        input.checkoutRoot,
        'scripts/aws-host-retained-storage-host-preflight-sea-source.js',
      );
      const bundleModulePath = await resolveCheckoutModulePath(
        input.checkoutRoot,
        'scripts/aws-host-retained-storage-host-preflight-sea-bundle.js',
      );
      const sourceNamespace = await importFresh(sourceModulePath);
      const bundleNamespace = await importFresh(bundleModulePath);
      const snapshot =
        await sourceNamespace.createAwsRetainedStorageHostPreflightSeaSourceSnapshot(
          { sourceCommit: input.sourceCommit },
        );
      try {
        const bundle =
          await bundleNamespace.bundleAwsRetainedStorageHostPreflightSea({
            snapshotRoot: snapshot.root,
            sourceCommit: input.sourceCommit,
            expectedArchitecture: input.expectedArchitecture,
          });
        return { byteDigest: bundle.byteDigest, size: bundle.size };
      } finally {
        await snapshot.close();
      }
    },
    /** @param {{path: string, arguments: readonly string[], environment: Record<string, string>, controlledPreload: boolean}} input */
    async executeArtifact(input) {
      if (!confirmedWorkRoot) {
        throw new Error(
          'Linux SEA guest work root has not been identity-confirmed.',
        );
      }
      await requireConfirmedWorkRoot(confirmedWorkRoot);
      await assertRegularFileBeneath(input.path, confirmedWorkRoot);
      const environment = { ...input.environment };
      let sentinelPath;
      if (input.controlledPreload) {
        const directory = path.dirname(input.path);
        const preloadPath = path.join(directory, 'controlled-preload.cjs');
        sentinelPath = path.join(directory, 'controlled-preload-sentinel');
        await fsp.writeFile(
          preloadPath,
          `require('node:fs').writeFileSync(${JSON.stringify(
            sentinelPath,
          )}, 'executed', {flag:'wx'});\n`,
          { flag: 'wx', mode: 0o600 },
        );
        environment.NODE_OPTIONS = `--require=${preloadPath}`;
      }
      const result = await runBounded(
        input.path,
        input.arguments,
        environment,
        {
          timeoutMs: EXECUTION_TIMEOUT_MS,
        },
      );
      return {
        ...result,
        ...(input.controlledPreload
          ? {
              preloadExecuted: await fsp
                .lstat(/** @type {string} */ (sentinelPath))
                .then(
                  () => true,
                  (error) => {
                    if (error?.code === 'ENOENT') return false;
                    throw error;
                  },
                ),
            }
          : {}),
      };
    },
    /** @param {{sourcePath: string, destinationPath: string, ownedRoot: string}} input */
    async copyArtifact({ sourcePath, destinationPath, ownedRoot }) {
      await requireConfirmedWorkRoot(ownedRoot);
      await copyArtifactIntoOwnedRoot({
        sourcePath,
        destinationPath,
        ownedRoot,
      });
    },
    /** @param {{artifactPath: string, recordPath: string}} input */
    async removeOriginalPublication({ artifactPath, recordPath }) {
      await Promise.all([fsp.unlink(artifactPath), fsp.unlink(recordPath)]);
    },
    /** @param {{artifactPath: string, recordPath: string}} input */
    async publicationAbsent({ artifactPath, recordPath }) {
      /** @param {string} filePath */
      const absent = async (filePath) =>
        await fsp.lstat(filePath).then(
          () => false,
          (error) => {
            if (error?.code === 'ENOENT') return true;
            throw error;
          },
        );
      return (await absent(artifactPath)) && (await absent(recordPath));
    },
    /** @param {{invocationId: string, workRoot: string, ownershipToken: string}} input */
    async cleanup(input) {
      const identity = await requireConfirmedWorkRoot(input.workRoot);
      await assertOwnedWorkRoot(input, identity);
      await removeOwnedDirectoryByIdentity(input.workRoot, identity, {
        allowAbsent: false,
      });
    },
    /** @param {{workRoot: string}} input */
    async guestWorkAbsent({ workRoot }) {
      return await fsp.lstat(workRoot).then(
        () => false,
        (error) => {
          if (error?.code === 'ENOENT') return true;
          throw error;
        },
      );
    },
  });
}

/** @returns {Readonly<Record<string, any>>} */
function nativeHost() {
  const report = /** @type {any} */ (process.report?.getReport());
  return Object.freeze({
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.versions.node,
    executablePath: process.execPath,
    kernelRelease: os.release(),
    glibcVersionRuntime: report?.header?.glibcVersionRuntime || 'unknown',
  });
}

/** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
export async function verifyAwsRetainedStorageHostPreflightSeaLinux(value) {
  return await createAwsRetainedStorageHostPreflightSeaLinuxGuestVerifier({
    host: nativeHost(),
    ports: createProductionPorts(),
  }).verify(value);
}

/** @param {string} workRoot @returns {Record<string, string>} */
function bootstrapEnvironment(workRoot) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: path.join(workRoot, 'home'),
    TMPDIR: path.join(workRoot, 'tmp'),
    LANG: 'C',
    LC_ALL: 'C',
    npm_config_cache: path.join(workRoot, 'npm-cache'),
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
}

/** @param {Readonly<Record<string, any>>} input @param {string} ownershipToken @returns {Promise<Readonly<{dev: bigint, ino: bigint}>>} */
async function createBootstrapOwnedRoot(input, ownershipToken) {
  const parent = await fsp.lstat(WORK_ROOT_PARENT);
  if (
    parent.isSymbolicLink() ||
    !parent.isDirectory() ||
    (await fsp.realpath(WORK_ROOT_PARENT)) !== WORK_ROOT_PARENT
  ) {
    throw new Error('Linux SEA bootstrap work parent is invalid.');
  }
  await fsp.mkdir(input.workRoot, { mode: 0o700 });
  const ownedStats = await fsp.lstat(input.workRoot, { bigint: true });
  const identity = directoryIdentity(ownedStats);
  try {
    if (
      ownedStats.isSymbolicLink() ||
      !ownedStats.isDirectory() ||
      (await fsp.realpath(input.workRoot)) !== input.workRoot
    ) {
      throw new Error('Linux SEA bootstrap did not create one real work root.');
    }
    await fsp.writeFile(
      path.join(input.workRoot, OWNERSHIP_MARKER_NAME),
      ownershipMarkerBytes(input.invocationId, ownershipToken, identity),
      { flag: 'wx', mode: 0o400 },
    );
    await Promise.all(
      ['bootstrap', 'home', 'tmp', 'npm-cache', 'npm-prefix'].map(
        async (name) =>
          await fsp.mkdir(path.join(input.workRoot, name), { mode: 0o700 }),
      ),
    );
    return identity;
  } catch (error) {
    /** @type {unknown} */
    let cleanupError;
    try {
      await removeOwnedDirectoryByIdentity(input.workRoot, identity, {
        allowAbsent: false,
      });
    } catch (failure) {
      cleanupError = failure;
    }
    if (!cleanupError) throw error;
    throw new AggregateError(
      [error, cleanupError],
      'Linux SEA bootstrap setup failed and identity-bound cleanup was incomplete.',
    );
  }
}

/** @param {string} workRoot @param {Readonly<{dev: bigint, ino: bigint}>} identity @returns {Promise<void>} */
async function cleanupBootstrapOwnedRoot(workRoot, identity) {
  await removeOwnedDirectoryByIdentity(workRoot, identity, {
    allowAbsent: true,
  });
}

/** @param {string} destinationPath @returns {Promise<void>} */
async function downloadPinnedNodeArchive(destinationPath) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error('Linux SEA bootstrap Node download timed out.'),
      ),
    SETUP_TIMEOUT_MS,
  );
  let output;
  try {
    const response = await new Promise((resolve, reject) => {
      const request = https.get(
        NODE_ARCHIVE_URL,
        { signal: controller.signal },
        resolve,
      );
      request.once('error', reject);
    });
    if (
      response.statusCode !== 200 ||
      (typeof response.headers['content-length'] === 'string' &&
        Number(response.headers['content-length']) > MAX_ARCHIVE_BYTES)
    ) {
      response.resume();
      throw new Error('Linux SEA bootstrap Node download was rejected.');
    }
    let size = 0;
    const hash = createHash('sha256');
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > MAX_ARCHIVE_BYTES) {
          callback(
            new Error('Linux SEA bootstrap Node archive exceeds its limit.'),
          );
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    output = createWriteStream(destinationPath, {
      flags: 'wx',
      mode: 0o400,
    });
    await pipeline(response, limiter, output, { signal: controller.signal });
    const digest = hash.digest('base64url');
    if (
      size < 1 ||
      size !==
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE ||
      digest !==
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SHA256
    ) {
      throw new Error('Linux SEA bootstrap Node archive digest is invalid.');
    }
  } catch (error) {
    output?.destroy();
    await fsp.unlink(destinationPath).catch((unlinkError) => {
      if (unlinkError?.code !== 'ENOENT') throw unlinkError;
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** @param {string} executable @param {readonly string[]} args @param {Record<string, string>} environment @param {string} expectedStdout @returns {Promise<void>} */
async function verifyExactCommandVersion(
  executable,
  args,
  environment,
  expectedStdout,
) {
  const result = await runBounded(executable, args, environment, {
    timeoutMs: SETUP_TIMEOUT_MS,
  });
  if (
    result.status !== 0 ||
    result.stderr.length !== 0 ||
    result.stdout.toString('utf8') !== `${expectedStdout}\n`
  ) {
    throw new Error('Linux SEA bootstrap dependency version is invalid.');
  }
}

/** @param {Buffer} bytes @returns {Readonly<Record<string, any>>} */
export function validateAwsRetainedStorageHostPreflightSeaLinuxGuestJsonFrame(
  bytes,
) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 3 ||
    bytes.length > MAX_JSON_BYTES ||
    bytes.at(-1) !== 0x0a ||
    bytes.subarray(0, -1).includes(0x0a) ||
    bytes.subarray(0, -1).includes(0x0d)
  ) {
    throw new TypeError('Linux SEA guest stdout frame is invalid.');
  }
  let decoded;
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, -1),
    );
    decoded = JSON.parse(body);
  } catch {
    throw new TypeError('Linux SEA guest stdout frame is invalid JSON.');
  }
  if (!isPlainObject(decoded)) {
    throw new TypeError('Linux SEA guest stdout frame must contain an object.');
  }
  const canonicalBytes = Buffer.from(
    `${JSON.stringify(canonical(decoded))}\n`,
    'utf8',
  );
  if (!bytes.equals(canonicalBytes)) {
    throw new TypeError('Linux SEA guest stdout frame is not canonical.');
  }
  return deepFreeze(decoded);
}

/** @param {string} checkoutRoot @param {string} relativePath @returns {Promise<string>} */
export async function assertAwsRetainedStorageHostPreflightSeaLinuxCheckoutModuleForTest(
  checkoutRoot,
  relativePath,
) {
  return await resolveCheckoutModulePath(checkoutRoot, relativePath);
}

/** @param {Buffer} bytes @returns {number} */
export function validateAwsRetainedStorageHostPreflightSeaLinuxCheckoutIndexForTest(
  bytes,
) {
  return validateRegularCheckoutIndex(bytes);
}

/** @param {{sourcePath: string, destinationPath: string, ownedRoot: string}} input @returns {Promise<void>} */
export async function copyAwsRetainedStorageHostPreflightSeaLinuxArtifactForTest(
  input,
) {
  await copyArtifactIntoOwnedRoot(input);
}

/** @param {string} workRoot @param {Readonly<{dev: bigint, ino: bigint}>} identity @returns {Promise<void>} */
export async function removeAwsRetainedStorageHostPreflightSeaLinuxOwnedRootForTest(
  workRoot,
  identity,
) {
  await removeOwnedDirectoryByIdentity(workRoot, identity, {
    allowAbsent: false,
  });
}

/** @param {{command: string, args: readonly string[], environment: Record<string, string>, timeoutMs: number, forcedTerminationReapTimeoutMs: number}} input @returns {Promise<{status: number, stdout: Buffer, stderr: Buffer}>} */
export async function runAwsRetainedStorageHostPreflightSeaLinuxBoundedChildForTest(
  input,
) {
  return await runBounded(input.command, input.args, input.environment, {
    timeoutMs: input.timeoutMs,
    forcedTerminationReapTimeoutMs: input.forcedTerminationReapTimeoutMs,
  });
}

/** @param {Buffer} bytes @returns {Promise<void>} */
async function writeStdoutFrame(bytes) {
  await new Promise((resolve, reject) => {
    process.stdout.write(bytes, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

/** @param {Readonly<Record<string, any>>} input @returns {Promise<Buffer>} */
async function runBootstrap(input) {
  const ownershipToken = randomBytes(16).toString('hex');
  /** @type {Readonly<{dev: bigint, ino: bigint}> | undefined} */
  let ownedIdentity;
  /** @type {unknown} */
  let primaryError;
  /** @type {Buffer | undefined} */
  let frame;
  try {
    ownedIdentity = await createBootstrapOwnedRoot(input, ownershipToken);
    const archivePath = expectedNodeArchivePath(input.workRoot);
    await downloadPinnedNodeArchive(archivePath);
    const environment = bootstrapEnvironment(input.workRoot);
    const nodeRoot = path.dirname(
      path.dirname(expectedNodeExecutablePath(input.workRoot)),
    );
    await runChecked(
      'tar',
      [
        '--extract',
        '--gzip',
        '--file',
        archivePath,
        '--directory',
        path.dirname(nodeRoot),
        '--no-same-owner',
        '--no-same-permissions',
      ],
      environment,
      { timeoutMs: SETUP_TIMEOUT_MS },
    );
    const exactNode = expectedNodeExecutablePath(input.workRoot);
    await assertRegularFileBeneath(exactNode, input.workRoot);
    await verifyExactCommandVersion(
      exactNode,
      ['--version'],
      environment,
      `v${NODE_VERSION}`,
    );
    const bootstrapNpmCli = path.join(
      nodeRoot,
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    );
    await assertRegularFileBeneath(bootstrapNpmCli, input.workRoot);
    await runChecked(
      exactNode,
      [
        bootstrapNpmCli,
        'install',
        '--global',
        '--prefix',
        path.join(input.workRoot, 'npm-prefix'),
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
        `npm@${NPM_VERSION}`,
      ],
      environment,
      { timeoutMs: SETUP_TIMEOUT_MS },
    );
    const npmCli = expectedNpmCliPath(input.workRoot);
    await assertRegularFileBeneath(npmCli, input.workRoot);
    await verifyExactCommandVersion(
      exactNode,
      [npmCli, '--version'],
      environment,
      NPM_VERSION,
    );
    const verifierPath = fileURLToPath(import.meta.url);
    const result = await runBounded(
      exactNode,
      [
        verifierPath,
        '--verify-owned',
        input.sourceCommit,
        input.invocationId,
        input.gitBundlePath,
        input.workRoot,
        archivePath,
        ownershipToken,
      ],
      environment,
      {
        timeoutMs: VERIFICATION_TIMEOUT_MS,
        maximumOutputBytes: MAX_JSON_BYTES,
      },
    );
    if (result.status !== 0 || result.stderr.length !== 0) {
      throw new Error('Linux SEA owned verification child failed.');
    }
    validateAwsRetainedStorageHostPreflightSeaLinuxGuestJsonFrame(
      result.stdout,
    );
    const rootAbsent = await fsp.lstat(input.workRoot).then(
      () => false,
      (error) => {
        if (error?.code === 'ENOENT') return true;
        throw error;
      },
    );
    if (!rootAbsent) {
      throw new Error('Linux SEA owned verification child left its work root.');
    }
    frame = result.stdout;
  } catch (error) {
    primaryError = error;
  }
  /** @type {unknown} */
  let cleanupError;
  if (primaryError && ownedIdentity) {
    try {
      await cleanupBootstrapOwnedRoot(input.workRoot, ownedIdentity);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (primaryError || cleanupError) {
    if (primaryError && !cleanupError) throw primaryError;
    throw new AggregateError(
      [
        ...(primaryError ? [primaryError] : []),
        ...(cleanupError ? [cleanupError] : []),
      ],
      'Linux SEA bootstrap failed and cleanup was incomplete.',
    );
  }
  if (!frame) throw new Error('Linux SEA bootstrap emitted no guest frame.');
  return frame;
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
export function parseAwsRetainedStorageHostPreflightSeaLinuxVerifierArgv(
  value,
) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string') ||
    Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ARGV_BYTES
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA Linux verifier invocation is invalid.',
    );
  }
  if (value.length === 7 && value[2] === '--bootstrap') {
    const sourceCommit = value[3];
    const invocationId = value[4];
    if (
      value[0] !== BOOTSTRAP_NODE_EXECUTABLE_PATH ||
      value[1] !== INPUT_VERIFIER_PATH ||
      !SOURCE_COMMIT_PATTERN.test(sourceCommit) ||
      !INVOCATION_ID_PATTERN.test(invocationId) ||
      value[5] !== INPUT_BUNDLE_PATH ||
      value[6] !== expectedWorkRoot(invocationId)
    ) {
      throw new TypeError('Linux SEA bootstrap invocation is invalid.');
    }
    return Object.freeze({
      mode: 'bootstrap',
      sourceCommit,
      invocationId,
      gitBundlePath: value[5],
      workRoot: value[6],
    });
  }
  if (value.length === 9 && value[2] === '--verify-owned') {
    const input = validateInput({
      sourceCommit: value[3],
      invocationId: value[4],
      gitBundlePath: value[5],
      workRoot: value[6],
      nodeArchivePath: value[7],
      ownershipToken: value[8],
    });
    if (
      value[0] !== expectedNodeExecutablePath(input.workRoot) ||
      value[1] !== INPUT_VERIFIER_PATH
    ) {
      throw new TypeError(
        'Linux SEA owned verification did not use the pinned Node executable and verifier.',
      );
    }
    return Object.freeze({ mode: 'verify-owned', input });
  }
  throw new TypeError(
    'AWS retained-storage host preflight SEA Linux verifier invocation is invalid.',
  );
}

/** @param {unknown} argv @returns {Promise<void>} */
export async function main(argv) {
  const invocation =
    parseAwsRetainedStorageHostPreflightSeaLinuxVerifierArgv(argv);
  if (invocation.mode === 'bootstrap') {
    await writeStdoutFrame(await runBootstrap(invocation));
    return;
  }
  const draft = await verifyAwsRetainedStorageHostPreflightSeaLinux(
    invocation.input,
  );
  await writeStdoutFrame(
    Buffer.from(`${JSON.stringify(canonical(draft))}\n`, 'utf8'),
  );
}

const invoked =
  typeof process.argv[1] === 'string'
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (invoked === import.meta.url) {
  main(process.argv).catch(() => {
    process.stderr.write(
      'AWS retained-storage host preflight SEA Linux verification failed.\n',
    );
    process.exitCode = 1;
  });
}

export default verifyAwsRetainedStorageHostPreflightSeaLinux;
