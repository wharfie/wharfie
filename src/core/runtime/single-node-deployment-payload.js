import { createHash } from 'node:crypto';
import { createWriteStream, promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  validateApplicationRevision,
  validateSha256Digest,
} from './application-revision.js';
import { validateArtifactRecordObservation } from './artifact-record.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from './content-id.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';
import {
  getAsset as nodeGetAsset,
  getRawAsset as nodeGetRawAsset,
  isSea as nodeIsSea,
} from '../lib/node-sea.js';
import { openHeldArtifactSource } from './packaged-artifact.js';

export const SINGLE_NODE_DEPLOYMENT_PAYLOAD_SCHEMA_VERSION = 1;
export const SINGLE_NODE_DEPLOYMENT_PAYLOAD_KIND =
  'singleNodeDeploymentPayload';
export const SINGLE_NODE_DEPLOYMENT_PAYLOAD_ID_DOMAIN =
  'wharfie:single-node-deployment-payload:v1';
export const SINGLE_NODE_DEPLOYMENT_PAYLOAD_ID_PREFIX = 'wsdp1';
export const SINGLE_NODE_DEPLOYMENT_PAYLOAD_ASSET_PREFIX =
  '<WHARFIE_DEPLOYMENT>/payload/v1/';
export const SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME = `${SINGLE_NODE_DEPLOYMENT_PAYLOAD_ASSET_PREFIX}manifest.json`;
export const SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME = `${SINGLE_NODE_DEPLOYMENT_PAYLOAD_ASSET_PREFIX}app-sea`;

const MAX_MANIFEST_BYTES = 512 * 1024;
const CREATE_KEYS = new Set(['artifactRecord', 'observation', 'revision']);
const DOCUMENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'payloadId',
  'artifactRecord',
]);
const CONTEXT_KEYS = new Set(['observation', 'revision']);
const ASSET_INPUT_KEYS = new Set([
  'artifactPath',
  'artifactRecord',
  'revision',
]);

/**
 * @param {any} value - JSON value.
 * @returns {any} - Deeply frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} expected - Exact keys.
 * @param {string} valuePath - Human-readable path.
 * @returns {void}
 */
function assertExactKeys(value, expected, valuePath) {
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * @param {Readonly<Record<string, any>>} record - Validated artifact record.
 * @param {string} valuePath - Human-readable path.
 * @returns {void}
 */
function assertDeployableLinuxArtifact(record, valuePath) {
  if (
    record.target.platform !== 'linux' ||
    record.target.architecture !== 'x64' ||
    record.target.libc !== 'glibc' ||
    record.size < 1
  ) {
    throw new TypeError(
      `${valuePath} must describe one nonempty Linux x64 glibc SEA.`,
    );
  }
}

/**
 * @param {Readonly<Record<string, any>>} record - Validated artifact record.
 * @returns {Readonly<Record<string, any>>} - Canonical manifest.
 */
function createManifestFromRecord(record) {
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: SINGLE_NODE_DEPLOYMENT_PAYLOAD_SCHEMA_VERSION,
      kind: SINGLE_NODE_DEPLOYMENT_PAYLOAD_KIND,
      artifactRecord: record,
    }),
  );
  assertManifestIsSecretFree(payload, 'singleNodeDeploymentPayload');
  const payloadId = createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_DEPLOYMENT_PAYLOAD_ID_DOMAIN,
    prefix: SINGLE_NODE_DEPLOYMENT_PAYLOAD_ID_PREFIX,
    value: payload,
    valuePath: 'singleNodeDeploymentPayload',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, payloadId }));
}

/**
 * Create the manifest that binds one exact embedded Linux SEA to its owning
 * application revision.
 * @param {unknown} value - Artifact record, held observation, and revision.
 * @returns {Readonly<Record<string, any>>} - Canonical payload manifest.
 */
export function createSingleNodeDeploymentPayloadManifest(value) {
  const input = cloneBoundedJsonObject(
    value,
    MAX_MANIFEST_BYTES,
    'singleNodeDeploymentPayload',
  );
  assertExactKeys(input, CREATE_KEYS, 'singleNodeDeploymentPayload');
  const revision = validateApplicationRevision(
    input.revision,
    'singleNodeDeploymentPayload.revision',
  );
  const record = validateArtifactRecordObservation(
    input.artifactRecord,
    {
      observation: input.observation,
      revision,
    },
    'singleNodeDeploymentPayload.artifactRecord',
  );
  assertDeployableLinuxArtifact(
    record,
    'singleNodeDeploymentPayload.artifactRecord',
  );
  return createManifestFromRecord(record);
}

/**
 * Validate a serialized payload manifest against trusted bytes and revision
 * evidence, recomputing both the ArtifactRecord and payload identities.
 * @param {unknown} value - Candidate manifest.
 * @param {unknown} contextValue - Trusted `{observation, revision}`.
 * @param {string} [valuePath] - Human-readable path.
 * @returns {Readonly<Record<string, any>>} - Canonical manifest.
 */
export function validateSingleNodeDeploymentPayloadManifest(
  value,
  contextValue,
  valuePath = 'singleNodeDeploymentPayload',
) {
  const document = cloneBoundedJsonObject(value, MAX_MANIFEST_BYTES, valuePath);
  assertExactKeys(document, DOCUMENT_KEYS, valuePath);
  const context = cloneBoundedJsonObject(
    contextValue,
    MAX_MANIFEST_BYTES,
    `${valuePath}.context`,
  );
  assertExactKeys(context, CONTEXT_KEYS, `${valuePath}.context`);
  if (
    document.schemaVersion !== SINGLE_NODE_DEPLOYMENT_PAYLOAD_SCHEMA_VERSION ||
    document.kind !== SINGLE_NODE_DEPLOYMENT_PAYLOAD_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  assertDomainSeparatedSha256Id(
    document.payloadId,
    SINGLE_NODE_DEPLOYMENT_PAYLOAD_ID_PREFIX,
    `${valuePath}.payloadId`,
  );
  const revision = validateApplicationRevision(
    context.revision,
    `${valuePath}.context.revision`,
  );
  const record = validateArtifactRecordObservation(
    document.artifactRecord,
    {
      observation: context.observation,
      revision,
    },
    `${valuePath}.artifactRecord`,
  );
  assertDeployableLinuxArtifact(record, `${valuePath}.artifactRecord`);
  const expected = createManifestFromRecord(record);
  if (document.payloadId !== expected.payloadId) {
    throw new Error(`${valuePath}.payloadId does not match its exact payload.`);
  }
  return expected;
}

/**
 * @param {unknown} value - Validated manifest.
 * @returns {string} - Stable JSON including a trailing newline.
 */
export function stringifySingleNodeDeploymentPayloadManifest(value) {
  const document = cloneBoundedJsonObject(
    value,
    MAX_MANIFEST_BYTES,
    'singleNodeDeploymentPayload',
  );
  assertExactKeys(document, DOCUMENT_KEYS, 'singleNodeDeploymentPayload');
  return `${JSON.stringify(sortCanonicalJsonValue(document), null, 2)}\n`;
}

/**
 * @param {string} filePath - File to sync.
 * @returns {Promise<void>} - Settles after file data reaches the filesystem.
 */
async function syncFile(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} directoryPath - Directory to sync.
 * @returns {Promise<void>} - Settles after directory metadata is durable.
 */
async function syncDirectory(directoryPath) {
  const handle = await fsp.open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Snapshot one held Linux artifact into a private temporary asset set. The
 * returned payload path is isolated from later replacement of the published
 * package path and must be cleaned after the outer SEA build.
 * @param {unknown} value - Exact artifact path, record, and revision.
 * @returns {Promise<Readonly<{manifest: Readonly<Record<string, any>>, assets: Readonly<Record<string, string>>, assetDigests: Readonly<Record<string, Readonly<{algorithm: 'sha256', value: string}>>>, cleanup: () => Promise<void>}>>} - Private deployment assets.
 */
export async function createSingleNodeDeploymentPayloadAssets(value) {
  const input = cloneBoundedJsonObject(
    value,
    MAX_MANIFEST_BYTES,
    'singleNodeDeploymentPayloadAssets',
  );
  assertExactKeys(input, ASSET_INPUT_KEYS, 'singleNodeDeploymentPayloadAssets');
  if (
    typeof input.artifactPath !== 'string' ||
    !path.isAbsolute(input.artifactPath) ||
    path.normalize(input.artifactPath) !== input.artifactPath
  ) {
    throw new TypeError(
      'singleNodeDeploymentPayloadAssets.artifactPath must be a canonical absolute path.',
    );
  }

  const source = await openHeldArtifactSource(input.artifactPath);
  /** @type {string|undefined} */
  let directory;
  let sourceClosed = false;
  try {
    const manifest = createSingleNodeDeploymentPayloadManifest({
      artifactRecord: input.artifactRecord,
      observation: source.observation,
      revision: input.revision,
    });
    directory = await fsp.mkdtemp(
      path.join(tmpdir(), 'wharfie-deployment-payload-'),
    );
    await fsp.chmod(directory, 0o700);
    const payloadPath = path.join(directory, 'app-sea');
    await pipeline(
      source.createReadStream(),
      createWriteStream(payloadPath, { flags: 'wx', mode: 0o600 }),
    );
    const verified = await source.verifyUnchanged();
    if (
      verified.artifactId !== manifest.artifactRecord.artifactId ||
      verified.byteDigest.algorithm !==
        manifest.artifactRecord.byteDigest.algorithm ||
      verified.byteDigest.value !== manifest.artifactRecord.byteDigest.value ||
      verified.size !== manifest.artifactRecord.size
    ) {
      throw new Error(
        'singleNodeDeploymentPayloadAssets source changed while it was snapshotted.',
      );
    }
    await source.close();
    sourceClosed = true;
    await fsp.chmod(payloadPath, 0o600);
    await syncFile(payloadPath);

    const manifestPath = path.join(directory, 'manifest.json');
    const manifestBytes =
      stringifySingleNodeDeploymentPayloadManifest(manifest);
    await fsp.writeFile(manifestPath, manifestBytes, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await syncFile(manifestPath);
    await syncDirectory(directory);

    const cleanupDirectory = directory;
    let cleaned = false;
    return Object.freeze({
      manifest,
      assets: Object.freeze({
        [SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME]: manifestPath,
        [SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME]: payloadPath,
      }),
      assetDigests: Object.freeze({
        [SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME]: Object.freeze({
          algorithm: /** @type {const} */ ('sha256'),
          value: sha256Base64Url(manifestBytes),
        }),
        [SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME]: Object.freeze(
          validateSha256Digest(
            manifest.artifactRecord.byteDigest,
            'singleNodeDeploymentPayloadAssets.artifactRecord.byteDigest',
          ),
        ),
      }),
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        await fsp.rm(cleanupDirectory, { recursive: true, force: true });
      },
    });
  } catch (error) {
    const cleanup = [];
    if (!sourceClosed) cleanup.push(source.close());
    if (directory !== undefined) {
      cleanup.push(fsp.rm(directory, { recursive: true, force: true }));
    }
    const outcomes = await Promise.allSettled(cleanup);
    const failures = outcomes
      .filter((outcome) => outcome.status === 'rejected')
      .map((outcome) => outcome.reason);
    if (failures.length > 0) {
      throw new AggregateError(
        [error, ...failures],
        'Deployment payload snapshot failed and cleanup was incomplete.',
      );
    }
    throw error;
  }
}

/**
 * @param {Buffer} bytes - Exact embedded payload bytes.
 * @returns {Readonly<Record<string, any>>} - Trusted byte observation.
 */
function observeBytes(bytes) {
  const value = createHash('sha256').update(bytes).digest('base64url');
  return Object.freeze({
    artifactId: `waf1_${value}`,
    byteDigest: Object.freeze({ algorithm: 'sha256', value }),
    size: bytes.byteLength,
  });
}

/**
 * Keep Node-owned raw SEA memory private while exposing the same one-shot
 * streaming shape used by filesystem-backed packaged artifacts.
 * @param {ArrayBuffer} raw - Node-owned embedded asset.
 * @param {Readonly<Record<string, any>>} observation - Authenticated identity.
 * @returns {Readonly<Record<string, any>>} - One-shot held source.
 */
function createEmbeddedPayloadSource(raw, observation) {
  let bytes = new Uint8Array(raw);
  /** @type {'unused'|'active'|'complete'|'incomplete'|'closed'} */
  let state = 'unused';
  let closed = false;
  /** @type {Readable|undefined} */
  let activeStream;

  return Object.freeze({
    observation,
    createReadStream() {
      if (closed) {
        throw new Error('Embedded deployment payload source is closed.');
      }
      if (state !== 'unused') {
        throw new Error(
          'Embedded deployment payload source stream is single-use.',
        );
      }
      state = 'active';
      const stream = Readable.from(
        (async function* () {
          const hash = createHash('sha256');
          let size = 0;
          let completed = false;
          try {
            for (
              let offset = 0;
              offset < bytes.byteLength;
              offset += 64 * 1024
            ) {
              const chunk = Buffer.from(
                bytes.subarray(
                  offset,
                  Math.min(bytes.byteLength, offset + 64 * 1024),
                ),
              );
              hash.update(chunk);
              size += chunk.byteLength;
              yield chunk;
            }
            const digest = hash.digest('base64url');
            if (
              size !== observation.size ||
              digest !== observation.byteDigest.value
            ) {
              throw new Error(
                'Embedded deployment payload bytes changed while streamed.',
              );
            }
            completed = true;
          } finally {
            if (!closed) state = completed ? 'complete' : 'incomplete';
            activeStream = undefined;
          }
        })(),
        { objectMode: false },
      );
      activeStream = stream;
      return stream;
    },
    async verifyUnchanged() {
      if (closed) {
        throw new Error('Embedded deployment payload source is closed.');
      }
      if (state === 'unused') {
        throw new Error(
          'Embedded deployment payload must be streamed before verification.',
        );
      }
      if (state === 'active') {
        throw new Error(
          'Embedded deployment payload source stream is still active.',
        );
      }
      if (state !== 'complete') {
        throw new Error(
          'Embedded deployment payload source stream did not finish successfully.',
        );
      }
      return observation;
    },
    async close() {
      if (closed) return;
      const stream = activeStream;
      closed = true;
      state = 'closed';
      bytes = new Uint8Array();
      if (stream !== undefined && !stream.destroyed) {
        stream.destroy();
      }
    },
  });
}

/**
 * Read and authenticate the embedded Linux deployment SEA without copying its
 * raw Node-owned asset buffer.
 * @param {{revision: unknown, assetProvider?: {isSea?: () => boolean, getAsset: (name: string) => any, getRawAsset: (name: string) => any}}} options - Owning revision and optional test provider.
 * @returns {Promise<Readonly<{manifest: Readonly<Record<string, any>>, artifactRecord: Readonly<Record<string, any>>, source: Readonly<Record<string, any>>}>>} - Held in-process payload view.
 */
export async function readEmbeddedSingleNodeDeploymentPayload(options) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options)
  ) {
    throw new TypeError(
      'readEmbeddedSingleNodeDeploymentPayload options are invalid.',
    );
  }
  const explicit = Object.hasOwn(options, 'assetProvider');
  const provider =
    options.assetProvider ??
    Object.freeze({
      isSea: nodeIsSea,
      getAsset: nodeGetAsset,
      getRawAsset: nodeGetRawAsset,
    });
  if (
    provider === null ||
    typeof provider !== 'object' ||
    typeof provider.getAsset !== 'function' ||
    typeof provider.getRawAsset !== 'function' ||
    (!explicit &&
      typeof provider.isSea === 'function' &&
      provider.isSea() !== true)
  ) {
    throw new Error(
      'Embedded single-node deployment payload is unavailable outside a packaged SEA.',
    );
  }
  const manifestAsset = await provider.getAsset(
    SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME,
  );
  const manifestBytes =
    manifestAsset instanceof ArrayBuffer
      ? Buffer.from(manifestAsset)
      : manifestAsset instanceof Uint8Array
        ? Buffer.from(
            manifestAsset.buffer,
            manifestAsset.byteOffset,
            manifestAsset.byteLength,
          )
        : null;
  if (manifestBytes === null || manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('Embedded deployment payload manifest is invalid.');
  }
  let parsed;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
    );
  } catch {
    throw new Error('Embedded deployment payload manifest is invalid.');
  }
  const raw = await provider.getRawAsset(
    SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME,
  );
  if (!(raw instanceof ArrayBuffer)) {
    throw new Error('Embedded deployment SEA raw asset is invalid.');
  }
  const bytes = Buffer.from(raw);
  const observation = observeBytes(bytes);
  const manifest = validateSingleNodeDeploymentPayloadManifest(
    parsed,
    {
      observation,
      revision: options.revision,
    },
    'embeddedSingleNodeDeploymentPayload',
  );
  return Object.freeze({
    manifest,
    artifactRecord: manifest.artifactRecord,
    source: createEmbeddedPayloadSource(raw, observation),
  });
}

export default {
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_ASSET_PREFIX,
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_ID_DOMAIN,
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_ID_PREFIX,
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_KIND,
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_MANIFEST_ASSET_NAME,
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_SCHEMA_VERSION,
  SINGLE_NODE_DEPLOYMENT_PAYLOAD_SEA_ASSET_NAME,
  createSingleNodeDeploymentPayloadAssets,
  createSingleNodeDeploymentPayloadManifest,
  readEmbeddedSingleNodeDeploymentPayload,
  stringifySingleNodeDeploymentPayloadManifest,
  validateSingleNodeDeploymentPayloadManifest,
};
