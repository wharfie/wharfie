/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This closed packaging orchestration keeps its exact injected-port protocol inline. */

import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createAwsRetainedStorageHostPreflightSeaArtifactRecord,
  validateAwsRetainedStorageHostPreflightSeaArtifactRecord,
} from './aws-host-retained-storage-host-preflight-sea-artifact-record.js';
import { buildAwsRetainedStorageHostPreflightSea } from './aws-host-retained-storage-host-preflight-sea-build.js';
import { bundleAwsRetainedStorageHostPreflightSea } from './aws-host-retained-storage-host-preflight-sea-bundle.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES,
  createAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
} from './aws-host-retained-storage-host-preflight-sea-delivery.js';
import {
  publishAwsRetainedStorageHostPreflightSeaArtifact,
  validateAwsRetainedStorageHostPreflightSeaOutputDirectory,
} from './aws-host-retained-storage-host-preflight-sea-publish.js';
import { createAwsRetainedStorageHostPreflightSeaSourceSnapshot } from './aws-host-retained-storage-host-preflight-sea-source.js';

const INPUT_KEYS = new Set([
  'sourceCommit',
  'expectedArchitecture',
  'outputDirectory',
]);
const TEST_OPTIONS_KEYS = new Set(['ports']);
const PORT_KEYS = new Set([
  'preflightOutput',
  'createSnapshot',
  'createSnapshotDelivery',
  'bundle',
  'buildSea',
  'publish',
]);
const SNAPSHOT_KEYS = new Set(['root', 'sourceCommit', 'archive', 'close']);
const SNAPSHOT_DELIVERY_KEYS = new Set(['assetName', 'manifestBytes']);
const BUNDLE_KEYS = new Set(['bytes', 'byteDigest', 'size']);
const BUILD_KEYS = new Set(['artifactBytes', 'generation']);
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const ARCHITECTURES = new Set(['x86_64', 'arm64']);
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_ARGV_BYTES = 16 * 1024;
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const DELIVERY_MODULE_PATH =
  'scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';
const LIVE_REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL('../', import.meta.url)),
);

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

/** @param {unknown} value @param {number} maximum @param {string} valuePath @returns {Buffer} */
function snapshotBytes(value, maximum, valuePath) {
  let bytes;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    bytes = Buffer.from(value);
  } else if (value instanceof ArrayBuffer) {
    bytes = Buffer.from(value.slice(0));
  } else {
    throw new TypeError(`${valuePath} must be bytes.`);
  }
  if (bytes.length < 1 || bytes.length > maximum) {
    throw new TypeError(
      `${valuePath} must contain between 1 and ${maximum} bytes.`,
    );
  }
  return bytes;
}

/** @param {Buffer} bytes @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function digestBytes(bytes) {
  return Object.freeze({
    algorithm: /** @type {'sha256'} */ ('sha256'),
    value: createHash('sha256').update(bytes).digest('base64url'),
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateInput(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA package input must be an object.',
    );
  }
  assertExactKeys(
    value,
    INPUT_KEYS,
    'AWS retained-storage host preflight SEA package input',
  );
  if (
    typeof value.sourceCommit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(value.sourceCommit)
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA package sourceCommit must be 40 lowercase hexadecimal characters.',
    );
  }
  if (
    typeof value.expectedArchitecture !== 'string' ||
    !ARCHITECTURES.has(value.expectedArchitecture)
  ) {
    throw new TypeError(
      "AWS retained-storage host preflight SEA package expectedArchitecture must be 'x86_64' or 'arm64'.",
    );
  }
  if (
    typeof value.outputDirectory !== 'string' ||
    value.outputDirectory.length === 0 ||
    value.outputDirectory.trim() !== value.outputDirectory ||
    value.outputDirectory.includes('\0') ||
    value.outputDirectory.includes('\n') ||
    value.outputDirectory.includes('\r') ||
    !path.isAbsolute(value.outputDirectory) ||
    path.normalize(value.outputDirectory) !== value.outputDirectory ||
    path.parse(value.outputDirectory).root === value.outputDirectory
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA package outputDirectory must be a canonical absolute non-root path.',
    );
  }
  return Object.freeze({
    sourceCommit: value.sourceCommit,
    expectedArchitecture: /** @type {'x86_64'|'arm64'} */ (
      value.expectedArchitecture
    ),
    outputDirectory: value.outputDirectory,
  });
}

/** @param {unknown} value @param {Set<string>} keys @param {string} valuePath @returns {Readonly<Record<string, Function>>} */
function captureMethods(value, keys, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  assertExactKeys(value, keys, valuePath);
  /** @type {Record<string, Function>} */
  const methods = {};
  for (const key of keys) {
    const method = value[key];
    if (typeof method !== 'function') {
      throw new TypeError(`${valuePath}.${key} must be a function.`);
    }
    methods[key] = method.bind(value);
  }
  return Object.freeze(methods);
}

/** @param {unknown} value @returns {Readonly<{root: string, sourceCommit: string, archive: Readonly<Record<string, any>>, close: () => Promise<void>}>} */
function validateSnapshot(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'AWS retained-storage host preflight source snapshot result must be an object.',
    );
  }
  assertExactKeys(
    value,
    SNAPSHOT_KEYS,
    'AWS retained-storage host preflight source snapshot result',
  );
  if (
    typeof value.root !== 'string' ||
    !path.isAbsolute(value.root) ||
    path.normalize(value.root) !== value.root ||
    path.parse(value.root).root === value.root
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight source snapshot root is invalid.',
    );
  }
  if (!isPlainObject(value.archive)) {
    throw new TypeError(
      'AWS retained-storage host preflight source archive evidence is invalid.',
    );
  }
  if (
    typeof value.sourceCommit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(value.sourceCommit)
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight source snapshot commit is invalid.',
    );
  }
  if (typeof value.close !== 'function') {
    throw new TypeError(
      'AWS retained-storage host preflight source snapshot has no close capability.',
    );
  }
  return Object.freeze({
    root: value.root,
    sourceCommit: value.sourceCommit,
    archive: value.archive,
    close: value.close.bind(value),
  });
}

/** @param {unknown} value @returns {Readonly<{bytes: Buffer, byteDigest: Readonly<{algorithm: 'sha256', value: string}>, size: number}>} */
function validateBundle(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle result must be an object.',
    );
  }
  assertExactKeys(
    value,
    BUNDLE_KEYS,
    'AWS retained-storage host preflight SEA bundle result',
  );
  const bytes = snapshotBytes(
    value.bytes,
    MAX_BUNDLE_BYTES,
    'AWS retained-storage host preflight SEA bundle result.bytes',
  );
  const digest = digestBytes(bytes);
  if (
    !isPlainObject(value.byteDigest) ||
    value.byteDigest.algorithm !== 'sha256' ||
    typeof value.byteDigest.value !== 'string' ||
    !SHA256_BASE64URL_PATTERN.test(value.byteDigest.value) ||
    value.byteDigest.value !== digest.value ||
    value.size !== bytes.length
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA bundle byte evidence is invalid.',
    );
  }
  return Object.freeze({
    bytes,
    byteDigest: digest,
    size: bytes.length,
  });
}

/** @param {unknown} value @returns {Readonly<{artifactBytes: Buffer, generation: unknown}>} */
function validateBuild(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA build result must be an object.',
    );
  }
  assertExactKeys(
    value,
    BUILD_KEYS,
    'AWS retained-storage host preflight SEA build result',
  );
  return Object.freeze({
    artifactBytes: snapshotBytes(
      value.artifactBytes,
      MAX_ARTIFACT_BYTES,
      'AWS retained-storage host preflight SEA build result.artifactBytes',
    ),
    generation: value.generation,
  });
}

/** @param {unknown} value @returns {Readonly<{assetName: string, manifestBytes: Buffer}>} */
function validateSnapshotDelivery(value) {
  const valuePath =
    'AWS retained-storage host preflight snapshot delivery protocol';
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  assertExactKeys(value, SNAPSHOT_DELIVERY_KEYS, valuePath);
  if (
    typeof value.assetName !== 'string' ||
    value.assetName.length < 1 ||
    value.assetName.length > 1024 ||
    value.assetName.trim() !== value.assetName ||
    value.assetName.includes('\0') ||
    value.assetName.includes('\n') ||
    value.assetName.includes('\r')
  ) {
    throw new TypeError(`${valuePath}.assetName is invalid.`);
  }
  return Object.freeze({
    assetName: value.assetName,
    manifestBytes: snapshotBytes(
      value.manifestBytes,
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES,
      `${valuePath}.manifestBytes`,
    ),
  });
}

/**
 * Execute only the canonical delivery constructors from the trusted exact
 * source snapshot. This proves that the already-loaded packaging protocol
 * serializes the selected runtime's manifest identically before any native
 * build or publication occurs.
 * @param {unknown} value
 * @returns {Promise<Readonly<{assetName: string, manifestBytes: Buffer}>>}
 */
async function createSnapshotDeliveryProtocol(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'AWS retained-storage host preflight snapshot delivery input must be an object.',
    );
  }
  assertExactKeys(
    value,
    new Set(['snapshotRoot', 'sourceCommit', 'expectedArchitecture']),
    'AWS retained-storage host preflight snapshot delivery input',
  );
  const moduleUrl = pathToFileURL(
    path.join(value.snapshotRoot, DELIVERY_MODULE_PATH),
  );
  moduleUrl.searchParams.set('sourceCommit', value.sourceCommit);
  const namespace = await import(moduleUrl.href);
  const createDelivery =
    namespace.createAwsRetainedStorageHostPreflightSeaDeliveryManifest;
  const stringifyDelivery =
    namespace.stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest;
  if (
    typeof createDelivery !== 'function' ||
    typeof stringifyDelivery !== 'function'
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight snapshot delivery module does not expose its exact protocol.',
    );
  }
  const delivery = createDelivery({
    sourceCommit: value.sourceCommit,
    expectedArchitecture: value.expectedArchitecture,
  });
  return Object.freeze({
    assetName:
      namespace.AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
    manifestBytes: Buffer.from(stringifyDelivery(delivery), 'utf8'),
  });
}

/** @param {Readonly<Record<string, Function>>} ports @returns {Readonly<{package: (input: unknown) => Promise<Readonly<Record<string, any>>>}>} */
function createPackager(ports) {
  return Object.freeze({
    async package(inputValue) {
      const input = validateInput(inputValue);
      const delivery = createAwsRetainedStorageHostPreflightSeaDeliveryManifest(
        {
          sourceCommit: input.sourceCommit,
          expectedArchitecture: input.expectedArchitecture,
        },
      );
      const loadedManifestBytes = Buffer.from(
        stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
        'utf8',
      );
      const outputDirectory = await ports.preflightOutput(
        input.outputDirectory,
      );
      if (outputDirectory !== input.outputDirectory) {
        throw new TypeError(
          'AWS retained-storage host preflight SEA output preflight changed its requested directory.',
        );
      }
      const snapshot = validateSnapshot(
        await ports.createSnapshot({
          sourceCommit: input.sourceCommit,
        }),
      );
      /** @type {unknown} */
      let primaryError;
      /** @type {Readonly<Record<string, any>> | undefined} */
      let result;
      try {
        if (snapshot.sourceCommit !== input.sourceCommit) {
          throw new TypeError(
            'AWS retained-storage host preflight source snapshot commit does not match the requested commit.',
          );
        }
        const snapshotDelivery = validateSnapshotDelivery(
          await ports.createSnapshotDelivery({
            snapshotRoot: snapshot.root,
            sourceCommit: input.sourceCommit,
            expectedArchitecture: input.expectedArchitecture,
          }),
        );
        if (
          snapshotDelivery.assetName !==
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME ||
          !snapshotDelivery.manifestBytes.equals(loadedManifestBytes)
        ) {
          throw new Error(
            'AWS retained-storage host preflight selected snapshot delivery protocol does not match the loaded packager.',
          );
        }
        const bundle = validateBundle(
          await ports.bundle({
            snapshotRoot: snapshot.root,
            sourceCommit: input.sourceCommit,
            expectedArchitecture: input.expectedArchitecture,
          }),
        );
        const liveBundle = validateBundle(
          await ports.bundle({
            snapshotRoot: LIVE_REPOSITORY_ROOT,
            sourceCommit: input.sourceCommit,
            expectedArchitecture: input.expectedArchitecture,
          }),
        );
        if (
          liveBundle.size !== bundle.size ||
          !liveBundle.bytes.equals(bundle.bytes)
        ) {
          throw new Error(
            'AWS retained-storage host preflight selected snapshot runtime does not match the live repository delivery graph.',
          );
        }
        const built = validateBuild(
          await ports.buildSea({
            delivery,
            bundleBytes: bundle.bytes,
          }),
        );
        const record = createAwsRetainedStorageHostPreflightSeaArtifactRecord({
          delivery,
          sourceArchive: snapshot.archive,
          bundleBytes: bundle.bytes,
          artifactBytes: built.artifactBytes,
          generation: built.generation,
        });
        validateAwsRetainedStorageHostPreflightSeaArtifactRecord(record, {
          bundleBytes: bundle.bytes,
          artifactBytes: built.artifactBytes,
          generation: built.generation,
        });
        const publication = await ports.publish({
          outputDirectory,
          record,
          bundleBytes: bundle.bytes,
          artifactBytes: built.artifactBytes,
          generation: built.generation,
        });
        if (!isPlainObject(publication)) {
          throw new TypeError(
            'AWS retained-storage host preflight SEA publisher returned an invalid result.',
          );
        }
        result = Object.freeze({ ...publication });
      } catch (error) {
        primaryError = error;
      }

      /** @type {unknown} */
      let cleanupError;
      try {
        await snapshot.close();
      } catch (error) {
        cleanupError = error;
      }
      if (primaryError || cleanupError) {
        if (primaryError && !cleanupError) throw primaryError;
        throw new AggregateError(
          [
            ...(primaryError ? [primaryError] : []),
            ...(cleanupError ? [cleanupError] : []),
          ],
          primaryError
            ? 'AWS retained-storage host preflight SEA packaging failed and source cleanup was incomplete.'
            : 'AWS retained-storage host preflight SEA packaging completed but source cleanup was incomplete.',
        );
      }
      if (!result) {
        throw new Error(
          'AWS retained-storage host preflight SEA packaging completed without publication.',
        );
      }
      return result;
    },
  });
}

const PRODUCTION_PACKAGER = createPackager(
  Object.freeze({
    preflightOutput: validateAwsRetainedStorageHostPreflightSeaOutputDirectory,
    createSnapshot: createAwsRetainedStorageHostPreflightSeaSourceSnapshot,
    createSnapshotDelivery: createSnapshotDeliveryProtocol,
    bundle: bundleAwsRetainedStorageHostPreflightSea,
    buildSea: buildAwsRetainedStorageHostPreflightSea,
    publish: publishAwsRetainedStorageHostPreflightSeaArtifact,
  }),
);

/**
 * Package and immutably publish one exact-commit zero-argument host-preflight
 * SEA. This production path may download the official target Node archive.
 * @param {unknown} inputValue
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function packageAwsRetainedStorageHostPreflightSea(inputValue) {
  return PRODUCTION_PACKAGER.package(inputValue);
}

/**
 * Test-only access to the exact-snapshot delivery protocol probe.
 * @param {unknown} inputValue
 * @returns {Promise<Readonly<{assetName: string, manifestBytes: Buffer}>>}
 */
export async function createAwsRetainedStorageHostPreflightSeaSnapshotDeliveryProtocolForTest(
  inputValue,
) {
  return await createSnapshotDeliveryProtocol(inputValue);
}

/**
 * Test-only packager with one exact, receiver-bound port surface.
 * @param {unknown} optionsValue
 * @returns {Readonly<{package: (input: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsRetainedStorageHostPreflightSeaPackagerForTest(
  optionsValue,
) {
  if (!isPlainObject(optionsValue)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA test packager options must be an object.',
    );
  }
  assertExactKeys(
    optionsValue,
    TEST_OPTIONS_KEYS,
    'AWS retained-storage host preflight SEA test packager options',
  );
  return createPackager(
    captureMethods(
      optionsValue.ports,
      PORT_KEYS,
      'AWS retained-storage host preflight SEA packager ports',
    ),
  );
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
export function parseAwsRetainedStorageHostPreflightSeaPackageArgv(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 5 ||
    value.some((item) => typeof item !== 'string') ||
    Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ARGV_BYTES
  ) {
    throw new TypeError(
      'Usage: package-aws-host-preflight-sea <40-hex-commit> <x86_64|arm64> <absolute-output-directory>',
    );
  }
  return validateInput({
    sourceCommit: value[2],
    expectedArchitecture: value[3],
    outputDirectory: value[4],
  });
}

/** @param {unknown} argv @returns {Promise<void>} */
export async function main(argv) {
  const input = parseAwsRetainedStorageHostPreflightSeaPackageArgv(argv);
  const result = await packageAwsRetainedStorageHostPreflightSea(input);
  process.stdout.write(
    `${JSON.stringify({
      artifactId: result.artifactId,
      recordId: result.recordId,
      path: result.path,
      recordPath: result.recordPath,
    })}\n`,
  );
}

const invokedPath =
  typeof process.argv[1] === 'string'
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (invokedPath === import.meta.url) {
  main(process.argv).catch(() => {
    process.stderr.write(
      'AWS retained-storage host preflight SEA packaging failed.\n',
    );
    process.exitCode = 1;
  });
}

export default packageAwsRetainedStorageHostPreflightSea;
