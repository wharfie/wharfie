/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This narrow build adapter keeps its immutable boundary types beside the implementation. */

import { constants as fsConstants, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import NodeBinary from '../src/core/resources/builds/node-binary.js';
import SeaBuild from '../src/core/resources/builds/sea-build.js';
import { sha256Base64Url } from '../src/core/runtime/content-id.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  validateAwsRetainedStorageHostPreflightSeaDeliveryManifest,
} from './aws-host-retained-storage-host-preflight-sea-delivery.js';

const INPUT_KEYS = new Set(['delivery', 'bundleBytes']);
const TEST_OPTIONS_KEYS = new Set(['NodeBinaryClass', 'SeaBuildClass']);
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
let buildDirectoriesClaimed = false;

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

/** @param {string} filePath @param {string} valuePath @returns {Promise<Buffer>} */
async function readStableRegularFile(filePath, valuePath) {
  const beforePath = await fsp.lstat(filePath, { bigint: true });
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) {
    throw new Error(`${valuePath} must be a regular non-symbolic file.`);
  }
  if (beforePath.size < 1n || beforePath.size > BigInt(MAX_ARTIFACT_BYTES)) {
    throw new Error(
      `${valuePath} must contain between 1 and ${MAX_ARTIFACT_BYTES} bytes.`,
    );
  }
  const noFollow =
    typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const handle = await fsp.open(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameFile(beforePath, before)) {
      throw new Error(`${valuePath} changed before it could be read.`);
    }
    const bytes = Buffer.allocUnsafe(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (result.bytesRead === 0) {
        throw new Error(`${valuePath} changed while it was being read.`);
      }
      offset += result.bytesRead;
    }
    const [after, afterPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fsp.lstat(filePath, { bigint: true }),
    ]);
    if (
      !after.isFile() ||
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      !sameFile(before, after) ||
      !sameFile(after, afterPath)
    ) {
      throw new Error(`${valuePath} changed while it was being read.`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function decodeUtf8(value, valuePath) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      /** @type {Buffer} */ (value),
    );
  } catch {
    throw new TypeError(`${valuePath} must be valid UTF-8.`);
  }
}

/** @param {Record<string, any>} value @param {string} key @param {string} valuePath @returns {any} */
function requiredOwnData(value, key, valuePath) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${valuePath}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

/**
 * Keep the exported adapter from reporting an official-Node build when the
 * same-generation receipt or intermediate byte evidence is absent. The
 * artifact-record boundary performs the complete schema validation later.
 * @param {unknown} value
 * @param {string} binaryPath
 * @returns {Readonly<Record<string, any>>}
 */
function requireCompleteGenerationEvidence(value, binaryPath) {
  const valuePath =
    'AWS retained-storage host preflight SEA successful build evidence';
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  if (requiredOwnData(value, 'binaryPath', valuePath) !== binaryPath) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA generation does not identify its exact output binary.',
    );
  }
  for (const key of ['entryCode', 'codeBundle', 'seaBlob']) {
    if (!isPlainObject(requiredOwnData(value, key, valuePath))) {
      throw new TypeError(`${valuePath}.${key} must be a plain object.`);
    }
  }
  const nodeSource = requiredOwnData(value, 'nodeSource', valuePath);
  if (!isPlainObject(nodeSource)) {
    throw new TypeError(`${valuePath}.nodeSource must be a plain object.`);
  }
  if (
    !isPlainObject(
      requiredOwnData(nodeSource, 'archive', `${valuePath}.nodeSource`),
    )
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA generation requires its official Node archive receipt.',
    );
  }
  return value;
}

/** @param {any} Class @param {string} name @returns {void} */
function assertResourceClass(Class, name) {
  if (
    typeof Class !== 'function' ||
    typeof Class.BINARIES_DIR !== 'string' ||
    Class.BINARIES_DIR.length === 0
  ) {
    throw new TypeError(`${name} must expose its binaries directory.`);
  }
}

/**
 * Create one builder around explicit resource classes. Resource injection is
 * exposed only by the test factory; production always uses Wharfie's concrete
 * NodeBinary and SeaBuild implementations.
 * @param {any} NodeBinaryClass
 * @param {any} SeaBuildClass
 * @returns {(value: unknown) => Promise<Readonly<Record<string, any>>>}
 */
function createBuilder(NodeBinaryClass, SeaBuildClass) {
  assertResourceClass(NodeBinaryClass, 'NodeBinaryClass');
  assertResourceClass(SeaBuildClass, 'SeaBuildClass');
  if (
    typeof NodeBinaryClass.TEMP_DIR !== 'string' ||
    NodeBinaryClass.TEMP_DIR.length === 0 ||
    typeof SeaBuildClass.BUILD_DIR !== 'string' ||
    SeaBuildClass.BUILD_DIR.length === 0
  ) {
    throw new TypeError(
      'SEA resource classes must expose their private temporary directories.',
    );
  }

  return async (value) => {
    if (!isPlainObject(value)) {
      throw new TypeError(
        'AWS retained-storage host preflight SEA build input must be an object.',
      );
    }
    assertExactKeys(
      value,
      INPUT_KEYS,
      'AWS retained-storage host preflight SEA build input',
    );
    const delivery = validateAwsRetainedStorageHostPreflightSeaDeliveryManifest(
      value.delivery,
    );
    const bundleBytes = snapshotBytes(
      value.bundleBytes,
      MAX_BUNDLE_BYTES,
      'AWS retained-storage host preflight SEA bundle',
    );
    const entryCode = decodeUtf8(
      bundleBytes,
      'AWS retained-storage host preflight SEA bundle',
    );
    if (Buffer.byteLength(entryCode, 'utf8') !== bundleBytes.length) {
      throw new TypeError(
        'AWS retained-storage host preflight SEA bundle must have one canonical UTF-8 encoding.',
      );
    }
    const manifestBytes = Buffer.from(
      stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(delivery),
      'utf8',
    );
    if (
      manifestBytes.length < 1 ||
      manifestBytes.length >
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES
    ) {
      throw new TypeError(
        'AWS retained-storage host preflight SEA delivery asset is too large.',
      );
    }
    const manifestDigest = {
      algorithm: /** @type {'sha256'} */ ('sha256'),
      value: sha256Base64Url(
        manifestBytes,
        'AWS retained-storage host preflight SEA delivery asset',
      ),
    };

    const originalDirectories = {
      nodeTemp: NodeBinaryClass.TEMP_DIR,
      nodeBinaries: NodeBinaryClass.BINARIES_DIR,
      seaBuilds: SeaBuildClass.BUILD_DIR,
      seaBinaries: SeaBuildClass.BINARIES_DIR,
    };
    if (buildDirectoriesClaimed) {
      throw new Error(
        'Another AWS retained-storage host preflight SEA build is active in this process.',
      );
    }
    buildDirectoriesClaimed = true;
    /** @type {string | undefined} */
    let workspace;
    /** @type {unknown} */
    let primaryError;
    /** @type {Readonly<Record<string, any>> | undefined} */
    let result;
    try {
      workspace = await fsp.mkdtemp(
        path.join(os.tmpdir(), 'wharfie-aws-host-preflight-sea-build-'),
      );
      await fsp.chmod(workspace, 0o700);
      NodeBinaryClass.TEMP_DIR = path.join(workspace, 'node-downloads');
      NodeBinaryClass.BINARIES_DIR = path.join(workspace, 'node-binaries');
      SeaBuildClass.BUILD_DIR = path.join(workspace, 'sea-builds');
      SeaBuildClass.BINARIES_DIR = path.join(workspace, 'sea-binaries');

      const manifestPath = path.join(workspace, 'delivery.json');
      await fsp.writeFile(manifestPath, manifestBytes, {
        flag: 'wx',
        mode: 0o400,
      });
      await fsp.chmod(manifestPath, 0o400);

      const target = delivery.target;
      const nodeBinary = new NodeBinaryClass({
        name: 'aws-retained-storage-host-preflight-node',
        properties: {
          version: target.nodeVersion,
          platform: target.platform,
          architecture: target.architecture,
        },
      });
      if (typeof nodeBinary.reconcile !== 'function') {
        throw new TypeError(
          'AWS retained-storage host preflight Node resource cannot reconcile.',
        );
      }
      await nodeBinary.reconcile();
      const nodeBinaryPath = nodeBinary.get('binaryPath');
      if (typeof nodeBinaryPath !== 'string' || nodeBinaryPath.length === 0) {
        throw new Error(
          'AWS retained-storage host preflight Node resource has no binary.',
        );
      }

      const seaBuild = new SeaBuildClass({
        name: 'aws-retained-storage-host-preflight',
        dependsOn: [nodeBinary],
        properties: {
          entryCode,
          resolveDir: workspace,
          nodeBinaryPath,
          nodeVersion: target.nodeVersion,
          platform: target.platform,
          architecture: target.architecture,
          libc: target.libc,
          environmentVariables: {},
          assets: {
            [AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME]:
              manifestPath,
          },
          assetDigests: {
            [AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME]:
              manifestDigest,
          },
          functionAssetDigests: {},
        },
      });
      if (
        typeof seaBuild.build !== 'function' ||
        typeof seaBuild.getSuccessfulBuildEvidence !== 'function'
      ) {
        throw new TypeError(
          'AWS retained-storage host preflight SEA resource cannot build with evidence.',
        );
      }
      await seaBuild.build();
      const binaryPath = seaBuild.get('binaryPath');
      if (typeof binaryPath !== 'string' || binaryPath.length === 0) {
        throw new Error(
          'AWS retained-storage host preflight SEA build has no binary.',
        );
      }
      const artifactBytes = await readStableRegularFile(
        binaryPath,
        'AWS retained-storage host preflight SEA build output',
      );
      const generation = requireCompleteGenerationEvidence(
        seaBuild.getSuccessfulBuildEvidence(artifactBytes),
        binaryPath,
      );
      result = Object.freeze({
        artifactBytes: Buffer.from(artifactBytes),
        generation,
      });
    } catch (error) {
      primaryError = error;
    }

    /** @type {unknown[]} */
    const cleanupErrors = [];
    for (const restore of [
      () => {
        NodeBinaryClass.TEMP_DIR = originalDirectories.nodeTemp;
      },
      () => {
        NodeBinaryClass.BINARIES_DIR = originalDirectories.nodeBinaries;
      },
      () => {
        SeaBuildClass.BUILD_DIR = originalDirectories.seaBuilds;
      },
      () => {
        SeaBuildClass.BINARIES_DIR = originalDirectories.seaBinaries;
      },
    ]) {
      try {
        restore();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    buildDirectoriesClaimed = false;
    if (workspace) {
      try {
        await fsp.rm(workspace, { force: true, recursive: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (primaryError || cleanupErrors.length > 0) {
      if (primaryError && cleanupErrors.length === 0) throw primaryError;
      throw new AggregateError(
        [...(primaryError ? [primaryError] : []), ...cleanupErrors],
        primaryError
          ? 'AWS retained-storage host preflight SEA build failed and cleanup was incomplete.'
          : 'AWS retained-storage host preflight SEA build completed but cleanup was incomplete.',
      );
    }
    if (!result) {
      throw new Error(
        'AWS retained-storage host preflight SEA build completed without evidence.',
      );
    }
    return result;
  };
}

const productionBuilder = createBuilder(NodeBinary, SeaBuild);

/**
 * Build one Linux SEA with official Node provenance inside invocation-owned
 * directories that are removed before this promise settles. This adapter
 * temporarily redirects process-global resource directories and is therefore
 * intended for the dedicated one-shot packaging process, not as a reusable
 * concurrent library API.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function buildAwsRetainedStorageHostPreflightSea(value) {
  return productionBuilder(value);
}

/**
 * Test-only builder factory using resource doubles without downloading Node or
 * invoking native SEA generation.
 * @param {unknown} optionsValue
 * @returns {(value: unknown) => Promise<Readonly<Record<string, any>>>}
 */
export function createAwsRetainedStorageHostPreflightSeaBuilderForTest(
  optionsValue,
) {
  if (!isPlainObject(optionsValue)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA test builder options must be an object.',
    );
  }
  assertExactKeys(
    optionsValue,
    TEST_OPTIONS_KEYS,
    'AWS retained-storage host preflight SEA test builder options',
  );
  return createBuilder(
    optionsValue.NodeBinaryClass,
    optionsValue.SeaBuildClass,
  );
}

export default buildAwsRetainedStorageHostPreflightSea;
