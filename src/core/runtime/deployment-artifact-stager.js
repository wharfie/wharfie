/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact port contracts and assertion helpers are clearer than parser-specific expansions. */

import {
  createDeploymentArtifactStageIntent,
  createDeploymentArtifactStageReceipt,
  DEPLOYMENT_ARTIFACT_STAGE_DOCUMENT_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_STAGE_VERSION_ID_MAX_BYTES,
  validateDeploymentArtifactStageIntentContext,
  validateDeploymentArtifactStageReceiptContext,
} from './deployment-artifact-stage.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  validateDeploymentRevision,
  validateRunningDeploymentRevisionContext,
} from './deployment-revision.js';
import { createOwnershipNonce as createDefaultOwnershipNonce } from './deployment-resource-binding.js';
import { cloneBoundedJsonObject } from './json-value.js';
import {
  getRunningExecutablePath,
  openHeldArtifactSource,
} from './packaged-artifact.js';

export const DEPLOYMENT_ARTIFACT_STAGE_CONTENT_TYPE =
  'application/octet-stream';
export const DEPLOYMENT_ARTIFACT_STAGE_METADATA_SCHEMA =
  'deployment-artifact-stage-v1';

const FACTORY_KEYS = new Set([
  'client',
  'store',
  'openArtifactSource',
  'createOwnershipNonce',
  'readEmbeddedRevisionRuntimePair',
]);
const AUTHORITY_KEYS = new Set([
  'deploymentRevision',
  'profile',
  'providerScope',
]);
const REQUIRED_CLIENT_METHODS = Object.freeze(['putObject', 'headObject']);
const REQUIRED_STORE_METHODS = Object.freeze([
  'putArtifactStageIntentIfAbsent',
  'readArtifactStageIntent',
  'putArtifactStageReceiptIfAbsent',
  'readArtifactStageReceipt',
]);
const METADATA_KEYS = new Set([
  'wharfie-schema',
  'wharfie-intent',
  'wharfie-nonce',
  'wharfie-artifact',
  'wharfie-digest',
]);
const AUTHORITY_MAX_BYTES = DEPLOYMENT_ARTIFACT_STAGE_DOCUMENT_MAX_BYTES * 3;

/**
 * A required durable stage record or exact provider object version is absent.
 */
export class DeploymentArtifactStageMissingError extends Error {
  /** @param {{cause?: unknown}} [options] - Optional non-rendered cause. */
  constructor(options = {}) {
    super('Required deployment artifact staging evidence is absent.', options);
    this.name = 'DeploymentArtifactStageMissingError';
    this.code = 'DEPLOYMENT_ARTIFACT_STAGE_MISSING';
  }
}

/**
 * Provider evidence exists but does not satisfy the immutable stage contract.
 */
export class DeploymentArtifactStageConflictError extends Error {
  /** @param {{cause?: unknown}} [options] - Optional non-rendered cause. */
  constructor(options = {}) {
    super(
      'Deployment artifact staging evidence conflicts with the required contract.',
      options,
    );
    this.name = 'DeploymentArtifactStageConflictError';
    this.code = 'DEPLOYMENT_ARTIFACT_STAGE_CONFLICT';
  }
}

/**
 * An ambiguous provider/store outcome could not be resolved by exact readback.
 */
export class DeploymentArtifactStageUnknownError extends Error {
  /** @param {{cause?: unknown}} [options] - Optional non-rendered cause. */
  constructor(options = {}) {
    super('Deployment artifact staging state is unknown.', options);
    this.name = 'DeploymentArtifactStageUnknownError';
    this.code = 'DEPLOYMENT_ARTIFACT_STAGE_UNKNOWN';
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertAllKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function exactJsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {unknown} error @returns {boolean} */
function isMissingObjectError(error) {
  if (!isObjectRecord(error)) return false;
  const name = error.name;
  if (name === 'NotFound' || name === 'NoSuchKey' || name === 'NoSuchVersion') {
    return true;
  }
  return error.$metadata?.httpStatusCode === 404;
}

/** @param {string} value @returns {boolean} */
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** @param {unknown} value @returns {value is string} */
function isUsableVersionId(value) {
  return (
    typeof value === 'string' &&
    value !== 'null' &&
    value.length > 0 &&
    isWellFormedUnicode(value) &&
    Buffer.byteLength(value, 'utf8') <=
      DEPLOYMENT_ARTIFACT_STAGE_VERSION_ID_MAX_BYTES
  );
}

/** @param {string} value @returns {string} */
function base64UrlSha256ToBase64(value) {
  return Buffer.from(value, 'base64url').toString('base64');
}

/**
 * Create the exact user-metadata ownership envelope used on both Put and Head.
 * @param {Readonly<Record<string, any>>} intent - Valid stage intent.
 * @returns {Readonly<Record<string, string>>} - Exact lowercase S3 metadata.
 */
function createStageMetadata(intent) {
  return Object.freeze({
    'wharfie-schema': DEPLOYMENT_ARTIFACT_STAGE_METADATA_SCHEMA,
    'wharfie-intent': intent.stageIntentId,
    'wharfie-nonce': intent.ownershipNonce,
    'wharfie-artifact': intent.artifact.artifactId,
    'wharfie-digest': intent.artifact.byteDigest.value,
  });
}

/** @param {unknown} metadata @param {Readonly<Record<string, string>>} expected @returns {void} */
function assertExactMetadata(metadata, expected) {
  if (!isObjectRecord(metadata)) {
    throw new DeploymentArtifactStageConflictError();
  }
  const keys = Object.keys(metadata);
  if (
    keys.length !== METADATA_KEYS.size ||
    keys.some((key) => !METADATA_KEYS.has(key))
  ) {
    throw new DeploymentArtifactStageConflictError();
  }
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) {
      throw new DeploymentArtifactStageConflictError();
    }
  }
}

/**
 * Validate and cross-check the provider-independent deployment authority before
 * opening local bytes or reading distributed state.
 * @param {unknown} value - Public method input.
 * @returns {{deploymentRevision: Readonly<Record<string, any>>, profile: Readonly<Record<string, any>>, providerScope: Readonly<Record<string, any>>}} - Canonical authority.
 */
function validateAuthority(value) {
  const input = cloneBoundedJsonObject(
    value,
    AUTHORITY_MAX_BYTES,
    'deploymentArtifactStager authority',
  );
  assertAllKeys(input, AUTHORITY_KEYS, 'deploymentArtifactStager authority');
  const deploymentRevision = validateDeploymentRevision(
    input.deploymentRevision,
    'deploymentArtifactStager authority.deploymentRevision',
  );
  const profile = validateDeploymentProfile(
    input.profile,
    'deploymentArtifactStager authority.profile',
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    'deploymentArtifactStager authority.providerScope',
  );
  if (
    deploymentRevision.profileRevisionId !== profile.profileRevisionId ||
    deploymentRevision.appId !== profile.appId ||
    profile.provider.kind !== providerScope.provider ||
    profile.provider.scope.region !== providerScope.region
  ) {
    throw new DeploymentArtifactStageConflictError();
  }
  return { deploymentRevision, profile, providerScope };
}

/** @param {unknown} value @param {string} path @returns {void} */
function assertPortObject(value, path) {
  if (!isObjectRecord(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
}

/** @param {unknown} source @returns {asserts source is {observation: Record<string, any>, createReadStream: Function, verifyUnchanged: Function, close: Function}} */
function assertArtifactSource(source) {
  if (!isObjectRecord(source)) {
    throw new TypeError(
      'deploymentArtifactStager artifact source must be an object.',
    );
  }
  if (!isObjectRecord(source.observation)) {
    throw new TypeError(
      'deploymentArtifactStager artifact source.observation must be an object.',
    );
  }
  for (const method of ['createReadStream', 'verifyUnchanged', 'close']) {
    if (typeof source[method] !== 'function') {
      throw new TypeError(
        `deploymentArtifactStager artifact source.${method} is required.`,
      );
    }
  }
}

/** @param {Readonly<Record<string, any>>} intent @param {Readonly<Record<string, any>>} receipt @returns {Readonly<{intent: Readonly<Record<string, any>>, receipt: Readonly<Record<string, any>>}>} */
function createBundle(intent, receipt) {
  return Object.freeze({ intent, receipt });
}

/**
 * Bind a held running artifact, durable immutable records, and a narrow S3
 * object port. This factory never creates the retained control bucket and
 * never owns or closes the caller's client/store.
 * @param {unknown} options - Exact dependencies.
 * @returns {Readonly<{stageRunningArtifact: Function, validateStagedArtifact: Function}>} - Staging boundary.
 */
export function createDeploymentArtifactStager(options) {
  assertPortObject(options, 'deploymentArtifactStager options');
  const dependencies = /** @type {Record<string, any>} */ (options);
  for (const key of Object.keys(dependencies)) {
    if (!FACTORY_KEYS.has(key)) {
      throw new TypeError(
        `deploymentArtifactStager options.${key} is not supported.`,
      );
    }
  }
  for (const key of ['client', 'store']) {
    if (!Object.prototype.hasOwnProperty.call(dependencies, key)) {
      throw new TypeError(
        `deploymentArtifactStager options.${key} is required.`,
      );
    }
  }
  const { client, store } = dependencies;
  assertPortObject(client, 'deploymentArtifactStager client');
  assertPortObject(store, 'deploymentArtifactStager store');
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `deploymentArtifactStager client.${method} is required.`,
      );
    }
  }
  for (const method of REQUIRED_STORE_METHODS) {
    if (typeof store[method] !== 'function') {
      throw new TypeError(
        `deploymentArtifactStager store.${method} is required.`,
      );
    }
  }
  const openArtifactSource = Object.prototype.hasOwnProperty.call(
    dependencies,
    'openArtifactSource',
  )
    ? dependencies.openArtifactSource
    : openHeldArtifactSource;
  const createOwnershipNonce = Object.prototype.hasOwnProperty.call(
    dependencies,
    'createOwnershipNonce',
  )
    ? dependencies.createOwnershipNonce
    : createDefaultOwnershipNonce;
  const readEmbeddedRevisionRuntimePair = Object.prototype.hasOwnProperty.call(
    dependencies,
    'readEmbeddedRevisionRuntimePair',
  )
    ? dependencies.readEmbeddedRevisionRuntimePair
    : undefined;
  if (typeof openArtifactSource !== 'function') {
    throw new TypeError(
      'deploymentArtifactStager options.openArtifactSource must be a function.',
    );
  }
  if (typeof createOwnershipNonce !== 'function') {
    throw new TypeError(
      'deploymentArtifactStager options.createOwnershipNonce must be a function.',
    );
  }
  if (
    readEmbeddedRevisionRuntimePair !== undefined &&
    typeof readEmbeddedRevisionRuntimePair !== 'function'
  ) {
    throw new TypeError(
      'deploymentArtifactStager options.readEmbeddedRevisionRuntimePair must be a function.',
    );
  }

  /**
   * Read and validate exact provider object-version evidence.
   * @param {Readonly<Record<string, any>>} intent - Exact stage intent.
   * @param {string|undefined} versionId - Exact version, or current when absent.
   * @returns {Promise<Readonly<Record<string, any>>>} - Receipt object fields.
   */
  async function inspectObject(intent, versionId) {
    const request = {
      Bucket: intent.object.bucketName,
      Key: intent.object.key,
      ...(versionId === undefined ? {} : { VersionId: versionId }),
      ChecksumMode: 'ENABLED',
      ExpectedBucketOwner: intent.providerScope.accountId,
    };
    let response;
    try {
      response = await client.headObject(request);
    } catch (error) {
      if (isMissingObjectError(error)) {
        throw new DeploymentArtifactStageMissingError({ cause: error });
      }
      throw new DeploymentArtifactStageUnknownError({ cause: error });
    }
    if (!isObjectRecord(response) || !isUsableVersionId(response.VersionId)) {
      throw new DeploymentArtifactStageConflictError();
    }
    if (versionId !== undefined && response.VersionId !== versionId) {
      throw new DeploymentArtifactStageConflictError();
    }
    if (response.ContentLength !== intent.artifact.size) {
      throw new DeploymentArtifactStageConflictError();
    }
    const expectedChecksum = base64UrlSha256ToBase64(
      intent.artifact.byteDigest.value,
    );
    if (response.ChecksumSHA256 !== expectedChecksum) {
      throw new DeploymentArtifactStageConflictError();
    }
    if (response.ServerSideEncryption !== 'AES256') {
      throw new DeploymentArtifactStageConflictError();
    }
    if (response.ContentType !== DEPLOYMENT_ARTIFACT_STAGE_CONTENT_TYPE) {
      throw new DeploymentArtifactStageConflictError();
    }
    const storageClass = response.StorageClass ?? 'STANDARD';
    if (storageClass !== 'STANDARD') {
      throw new DeploymentArtifactStageConflictError();
    }
    assertExactMetadata(response.Metadata, createStageMetadata(intent));
    return Object.freeze({
      bucketName: intent.object.bucketName,
      key: intent.object.key,
      versionId: response.VersionId,
      contentLength: response.ContentLength,
      checksum: intent.artifact.byteDigest,
      serverSideEncryption: 'AES256',
      storageClass: 'STANDARD',
    });
  }

  /** @param {Readonly<Record<string, any>>} intent @param {Readonly<Record<string, any>>} receipt @returns {Promise<Readonly<Record<string, any>>>} */
  async function validateReceiptObject(intent, receipt) {
    const canonicalReceipt = validateDeploymentArtifactStageReceiptContext(
      receipt,
      { intent },
      'deploymentArtifactStager receipt',
    );
    const evidence = await inspectObject(
      intent,
      canonicalReceipt.object.versionId,
    );
    const expectedReceipt = createDeploymentArtifactStageReceipt({
      intent,
      object: evidence,
    });
    if (expectedReceipt.stageReceiptId !== canonicalReceipt.stageReceiptId) {
      throw new DeploymentArtifactStageConflictError();
    }
    return canonicalReceipt;
  }

  /** @param {Readonly<Record<string, any>>} candidate @param {ReturnType<typeof validateAuthority>} authority @returns {Promise<Readonly<Record<string, any>>>} */
  async function persistAndReadIntent(candidate, authority) {
    let writeFailed = false;
    /** @type {unknown} */
    let writeError;
    try {
      await store.putArtifactStageIntentIfAbsent(candidate);
    } catch (error) {
      writeFailed = true;
      writeError = error;
    }
    let stored;
    try {
      stored = await store.readArtifactStageIntent(
        authority.providerScope.providerScopeId,
        authority.deploymentRevision.artifactId,
      );
    } catch (error) {
      if (writeFailed) throw writeError;
      throw error;
    }
    if (stored === null) {
      if (writeFailed) throw writeError;
      throw new DeploymentArtifactStageUnknownError();
    }
    try {
      const intent = validateDeploymentArtifactStageIntentContext(
        stored,
        authority,
        'deploymentArtifactStager stored intent',
      );
      if (
        !exactJsonEqual(intent.providerScope, candidate.providerScope) ||
        !exactJsonEqual(intent.artifact, candidate.artifact) ||
        !exactJsonEqual(intent.object, candidate.object)
      ) {
        throw new DeploymentArtifactStageConflictError();
      }
      return intent;
    } catch (error) {
      if (writeFailed) throw writeError;
      throw error;
    }
  }

  /** @param {Readonly<Record<string, any>>} candidate @param {Readonly<Record<string, any>>} intent @returns {Promise<Readonly<Record<string, any>>>} */
  async function persistAndReadReceipt(candidate, intent) {
    let writeFailed = false;
    /** @type {unknown} */
    let writeError;
    try {
      await store.putArtifactStageReceiptIfAbsent(intent, candidate);
    } catch (error) {
      writeFailed = true;
      writeError = error;
    }
    let stored;
    try {
      stored = await store.readArtifactStageReceipt(intent);
    } catch (error) {
      if (writeFailed) throw writeError;
      throw error;
    }
    if (stored === null) {
      if (writeFailed) throw writeError;
      throw new DeploymentArtifactStageUnknownError();
    }
    let receipt;
    try {
      receipt = validateDeploymentArtifactStageReceiptContext(
        stored,
        { intent },
        'deploymentArtifactStager stored receipt',
      );
    } catch (error) {
      if (writeFailed) throw writeError;
      throw error;
    }
    if (receipt.stageReceiptId === candidate.stageReceiptId) return receipt;
    return await validateReceiptObject(intent, receipt);
  }

  /**
   * Read persisted stage records and prove their exact immutable S3 version.
   * This path deliberately never reads local executable bytes.
   * @param {unknown} value - Exact deployment authority.
   * @returns {Promise<Readonly<{intent: Readonly<Record<string, any>>, receipt: Readonly<Record<string, any>>}>>} - Validated stage bundle.
   */
  async function validateStagedArtifact(value) {
    const authority = validateAuthority(value);
    const storedIntent = await store.readArtifactStageIntent(
      authority.providerScope.providerScopeId,
      authority.deploymentRevision.artifactId,
    );
    if (storedIntent === null) {
      throw new DeploymentArtifactStageMissingError();
    }
    const intent = validateDeploymentArtifactStageIntentContext(
      storedIntent,
      authority,
      'deploymentArtifactStager stored intent',
    );
    const storedReceipt = await store.readArtifactStageReceipt(intent);
    if (storedReceipt === null) {
      throw new DeploymentArtifactStageMissingError();
    }
    const receipt = await validateReceiptObject(intent, storedReceipt);
    return createBundle(intent, receipt);
  }

  /**
   * Stage this process's held executable bytes behind a durable intent fence.
   * @param {unknown} value - Exact deployment authority.
   * @returns {Promise<Readonly<{intent: Readonly<Record<string, any>>, receipt: Readonly<Record<string, any>>}>>} - Validated stage bundle.
   */
  async function stageRunningArtifact(value) {
    const authority = validateAuthority(value);
    const source = await openArtifactSource(getRunningExecutablePath());
    try {
      assertArtifactSource(source);
      try {
        await validateRunningDeploymentRevisionContext(
          authority.deploymentRevision,
          { profile: authority.profile },
          {
            inspectRunningArtifact: async () => ({
              artifactId: source.observation.artifactId,
              byteDigest: source.observation.byteDigest,
              size: source.observation.size,
            }),
            ...(readEmbeddedRevisionRuntimePair === undefined
              ? {}
              : { readEmbeddedRevisionRuntimePair }),
          },
        );
      } catch (error) {
        throw new DeploymentArtifactStageConflictError({ cause: error });
      }
      const candidateIntent = createDeploymentArtifactStageIntent({
        providerScope: authority.providerScope,
        artifact: {
          artifactId: source.observation.artifactId,
          byteDigest: source.observation.byteDigest,
          size: source.observation.size,
          appId: authority.deploymentRevision.appId,
          revisionId: authority.deploymentRevision.revisionId,
          target: authority.profile.target,
        },
        ownershipNonce: createOwnershipNonce(),
      });
      validateDeploymentArtifactStageIntentContext(
        candidateIntent,
        authority,
        'deploymentArtifactStager candidate intent',
      );
      const intent = await persistAndReadIntent(candidateIntent, authority);
      const storedReceipt = await store.readArtifactStageReceipt(intent);
      if (storedReceipt !== null) {
        const receipt = await validateReceiptObject(intent, storedReceipt);
        return createBundle(intent, receipt);
      }

      const putRequest = {
        Bucket: intent.object.bucketName,
        Key: intent.object.key,
        Body: source.createReadStream(),
        ContentLength: intent.artifact.size,
        ChecksumAlgorithm: 'SHA256',
        ChecksumSHA256: base64UrlSha256ToBase64(
          intent.artifact.byteDigest.value,
        ),
        ServerSideEncryption: 'AES256',
        StorageClass: 'STANDARD',
        ContentType: DEPLOYMENT_ARTIFACT_STAGE_CONTENT_TYPE,
        IfNoneMatch: '*',
        ExpectedBucketOwner: intent.providerScope.accountId,
        Metadata: createStageMetadata(intent),
      };
      let putFailed = false;
      /** @type {unknown} */
      let putError;
      /** @type {Record<string, any>|undefined} */
      let putResponse;
      try {
        const response = await client.putObject(putRequest);
        if (isObjectRecord(response)) putResponse = response;
      } catch (error) {
        putFailed = true;
        putError = error;
      }
      if (!putFailed) {
        const verifiedObservation = await source.verifyUnchanged();
        if (!exactJsonEqual(verifiedObservation, source.observation)) {
          throw new DeploymentArtifactStageConflictError();
        }
      }

      const putVersionId = isUsableVersionId(putResponse?.VersionId)
        ? putResponse.VersionId
        : undefined;
      let evidence;
      try {
        evidence = await inspectObject(intent, putVersionId);
      } catch (error) {
        if (
          putFailed &&
          !(error instanceof DeploymentArtifactStageConflictError)
        ) {
          throw new DeploymentArtifactStageUnknownError({ cause: putError });
        }
        throw error;
      }
      const candidateReceipt = createDeploymentArtifactStageReceipt({
        intent,
        object: evidence,
      });
      const receipt = await persistAndReadReceipt(candidateReceipt, intent);
      return createBundle(intent, receipt);
    } finally {
      if (isObjectRecord(source) && typeof source.close === 'function') {
        await source.close();
      }
    }
  }

  return Object.freeze({ stageRunningArtifact, validateStagedArtifact });
}

export default createDeploymentArtifactStager;
