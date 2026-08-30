/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { assertDomainSeparatedSha256Id } from '../../runtime/content-id.js';
import {
  EXECUTION_PAYLOAD_STORAGE_KIND,
  createExecutionPayloadStorageIdentity,
  validateExecutionPayloadReference,
  verifyExecutionPayloadReference,
} from '../../runtime/execution-payload.js';
import { cloneJsonObject } from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import {
  ExecutionPayloadStoreIntegrityError,
  ExecutionPayloadStoreNotFoundError,
} from './local.js';

/**
 * Construction-only brand and immutable scope for replicated payload-store
 * capabilities. Public metadata alone must not be able to claim that writes
 * receive distributed publication and verified readback.
 * @type {WeakMap<object, Readonly<{storage: Readonly<Record<string, any>>, distribution: Readonly<Record<string, any>>}>>}
 */
const REPLICATED_EXECUTION_PAYLOAD_STORE_SCOPES = new WeakMap();

/** The first provider-neutral execution-payload distribution contract. */
export const EXECUTION_PAYLOAD_DISTRIBUTION_KIND =
  'wharfie.execution-payload-distribution.v1';
/** Domain-separated identity prefix for one immutable distribution namespace. */
export const EXECUTION_PAYLOAD_DISTRIBUTION_ID_PREFIX = 'wepd1';

const DISTRIBUTION_IDENTITY_KEYS = new Set([
  'kind',
  'distributionId',
  'storeId',
]);

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowedKeys - Exact supported keys.
 * @param {string} label - Boundary label.
 * @returns {void}
 */
function assertExactKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
  if (Object.keys(value).length !== allowedKeys.size) {
    throw new TypeError(`${label} has missing fields.`);
  }
}

/**
 * Require one canonical distribution namespace identity.
 * @param {unknown} value - Candidate distribution identity.
 * @param {string} [label] - Boundary label.
 * @returns {asserts value is string}
 */
export function assertExecutionPayloadDistributionId(
  value,
  label = 'execution payload distributionId',
) {
  assertDomainSeparatedSha256Id(
    value,
    EXECUTION_PAYLOAD_DISTRIBUTION_ID_PREFIX,
    label,
  );
}

/**
 * Normalize the complete durable identity shared by every replica. Provider
 * routing is deliberately absent: a provider adapter receives this opaque
 * identity but cannot add account, bucket, endpoint, or credential fields to
 * the core contract.
 * @param {unknown} value - Candidate distribution identity.
 * @param {string} [label] - Boundary label.
 * @returns {Readonly<{kind: 'wharfie.execution-payload-distribution.v1', distributionId: string, storeId: string}>} - Strict immutable identity.
 */
export function normalizeExecutionPayloadDistributionIdentity(
  value,
  label = 'execution payload distribution identity',
) {
  const identity = cloneJsonObject(value, label);
  assertExactKeys(identity, DISTRIBUTION_IDENTITY_KEYS, label);
  if (identity.kind !== EXECUTION_PAYLOAD_DISTRIBUTION_KIND) {
    throw new TypeError(
      `${label}.kind must be '${EXECUTION_PAYLOAD_DISTRIBUTION_KIND}'.`,
    );
  }
  assertExecutionPayloadDistributionId(
    identity.distributionId,
    `${label}.distributionId`,
  );
  assertLogicalId(identity.storeId, `${label}.storeId`);
  return Object.freeze({
    kind: EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
    distributionId: identity.distributionId,
    storeId: identity.storeId,
  });
}

/**
 * Require a capability returned by createReplicatedExecutionPayloadStore.
 * This deliberately uses an out-of-band construction brand instead of a
 * caller-copyable property on the returned object.
 * @param {unknown} value - Candidate replicated payload-store capability.
 * @param {string} [label] - Boundary label.
 * @returns {void}
 */
export function assertReplicatedExecutionPayloadStore(
  value,
  label = 'execution payload store',
) {
  if (
    !value ||
    typeof value !== 'object' ||
    !REPLICATED_EXECUTION_PAYLOAD_STORE_SCOPES.has(value)
  ) {
    throw new TypeError(
      `${label} must be constructed by createReplicatedExecutionPayloadStore().`,
    );
  }
}

/**
 * Normalize one local replica identity without accepting a caller-shaped
 * storage kind or additional routing fields.
 * @param {unknown} value - Candidate local storage identity.
 * @returns {Readonly<{kind: 'wharfie.local-content-addressed.v1', storeId: string}>} - Strict local identity.
 */
function normalizeLocalStorageIdentity(value) {
  const storage = cloneJsonObject(
    value,
    'replicated execution payload local storage',
  );
  assertExactKeys(
    storage,
    new Set(['kind', 'storeId']),
    'replicated execution payload local storage',
  );
  if (storage.kind !== EXECUTION_PAYLOAD_STORAGE_KIND) {
    throw new TypeError(
      `replicated execution payload local storage.kind must be '${EXECUTION_PAYLOAD_STORAGE_KIND}'.`,
    );
  }
  return createExecutionPayloadStorageIdentity(
    storage.storeId,
    'replicated execution payload local storage.storeId',
  );
}

/**
 * Create a local-first immutable payload store backed by one independently
 * durable provider-neutral distribution. The distribution port is not trusted
 * with integrity: publication must survive an immediate readback, and every
 * local or distributed read is rehashed before its bytes are returned.
 *
 * Local corruption is never hidden by a distributed fallback. Only the exact
 * local not-found classification permits a fetch, which is verified before it
 * is imported through the local store's create-if-absent hydration boundary.
 * @param {{localStore: {storage: unknown, putJson: (input: {value: unknown, payloadSchema: string}) => Promise<unknown>, importBytes: (input: {reference: unknown, bytes: unknown}) => Promise<unknown>, readBytes: (reference: unknown) => Promise<unknown>}, distribution: {identity: unknown, publishImmutable: (input: {reference: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, bytes: Buffer}) => Promise<unknown>, readBytes: (reference: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>) => Promise<unknown>}}} options - Exact local replica and distribution port.
 * @returns {{storage: Readonly<{kind: 'wharfie.local-content-addressed.v1', storeId: string}>, distribution: Readonly<{kind: 'wharfie.execution-payload-distribution.v1', distributionId: string, storeId: string}>, putJson: (input: {value: unknown, payloadSchema: string}) => Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>, importBytes: (input: {reference: unknown, bytes: unknown}) => Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>, readBytes: (reference: unknown) => Promise<Buffer>, readVerified: (reference: unknown) => Promise<{reference: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, value: any}>, readJson: (reference: unknown) => Promise<any>, verify: (reference: unknown) => Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>}} - Replicated immutable payload-store API.
 */
export function createReplicatedExecutionPayloadStore(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Replicated execution payload store options must be an object.',
    );
  }
  const candidate = /** @type {Record<string, any>} */ (options);
  const allowedOptions = new Set(['localStore', 'distribution']);
  for (const key of Object.keys(candidate)) {
    if (!allowedOptions.has(key)) {
      throw new TypeError(
        `Replicated execution payload store options.${key} is not supported.`,
      );
    }
  }
  for (const key of allowedOptions) {
    if (!Object.prototype.hasOwnProperty.call(candidate, key)) {
      throw new TypeError(
        `Replicated execution payload store options.${key} is required.`,
      );
    }
  }

  const localStore = candidate.localStore;
  if (
    !localStore ||
    typeof localStore !== 'object' ||
    Array.isArray(localStore)
  ) {
    throw new TypeError(
      'Replicated execution payload store localStore must be an object.',
    );
  }
  const storage = normalizeLocalStorageIdentity(localStore.storage);
  const localPutJsonMethod = localStore.putJson;
  const localImportBytesMethod = localStore.importBytes;
  const localReadBytesMethod = localStore.readBytes;
  if (
    typeof localPutJsonMethod !== 'function' ||
    typeof localImportBytesMethod !== 'function' ||
    typeof localReadBytesMethod !== 'function'
  ) {
    throw new TypeError(
      'Replicated execution payload store localStore must expose putJson(), importBytes(), and readBytes().',
    );
  }
  const localPutJson = localPutJsonMethod.bind(localStore);
  const localImportBytes = localImportBytesMethod.bind(localStore);
  const localReadBytes = localReadBytesMethod.bind(localStore);

  const distributionPort = candidate.distribution;
  if (
    !distributionPort ||
    typeof distributionPort !== 'object' ||
    Array.isArray(distributionPort)
  ) {
    throw new TypeError(
      'Replicated execution payload store distribution must be an object.',
    );
  }
  const allowedDistributionKeys = new Set([
    'identity',
    'publishImmutable',
    'readBytes',
  ]);
  for (const key of Object.keys(distributionPort)) {
    if (!allowedDistributionKeys.has(key)) {
      throw new TypeError(
        `Replicated execution payload store distribution.${key} is not supported.`,
      );
    }
  }
  for (const key of allowedDistributionKeys) {
    if (!Object.prototype.hasOwnProperty.call(distributionPort, key)) {
      throw new TypeError(
        `Replicated execution payload store distribution.${key} is required.`,
      );
    }
  }
  const distribution = normalizeExecutionPayloadDistributionIdentity(
    distributionPort.identity,
    'replicated execution payload distribution identity',
  );
  if (distribution.storeId !== storage.storeId) {
    throw new TypeError(
      'Replicated execution payload distribution storeId must match its local replica.',
    );
  }
  const publishImmutableMethod = distributionPort.publishImmutable;
  const distributionReadBytesMethod = distributionPort.readBytes;
  if (
    typeof publishImmutableMethod !== 'function' ||
    typeof distributionReadBytesMethod !== 'function'
  ) {
    throw new TypeError(
      'Replicated execution payload distribution must expose publishImmutable() and readBytes().',
    );
  }
  const publishImmutable = publishImmutableMethod.bind(distributionPort);
  const distributionReadBytes =
    distributionReadBytesMethod.bind(distributionPort);

  /**
   * @param {unknown} value - Candidate immutable reference.
   * @returns {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} - Reference for this exact replica namespace.
   */
  function normalizeReplicatedReference(value) {
    const reference = validateExecutionPayloadReference(
      value,
      'replicated execution payload reference',
    );
    if (
      reference.storage.kind !== storage.kind ||
      reference.storage.storeId !== storage.storeId
    ) {
      throw new TypeError(
        `Execution payload ${reference.payloadId} belongs to a different replicated payload store.`,
      );
    }
    return reference;
  }

  /**
   * @param {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} left - Expected reference.
   * @param {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} right - Candidate exact reference.
   * @returns {boolean} - Whether every strict reference field agrees.
   */
  function sameReference(left, right) {
    return (
      left.schemaVersion === right.schemaVersion &&
      left.kind === right.kind &&
      left.payloadId === right.payloadId &&
      left.digest.algorithm === right.digest.algorithm &&
      left.digest.value === right.digest.value &&
      left.size === right.size &&
      left.mediaType === right.mediaType &&
      left.payloadSchema === right.payloadSchema &&
      left.storage.kind === right.storage.kind &&
      left.storage.storeId === right.storage.storeId &&
      left.storage.key === right.storage.key
    );
  }

  /**
   * @param {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} expected - Expected reference.
   * @param {unknown} value - Candidate local import result.
   * @returns {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} - Exact imported reference.
   */
  function normalizeImportedReference(expected, value) {
    const imported = normalizeReplicatedReference(value);
    if (!sameReference(expected, imported)) {
      throw new ExecutionPayloadStoreIntegrityError(
        expected.payloadId,
        'local hydration returned a different execution payload reference',
      );
    }
    return imported;
  }

  /**
   * Copy and bind untrusted bytes to one normalized reference.
   * @param {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} reference - Expected immutable reference.
   * @param {unknown} value - Candidate provider bytes.
   * @param {string} label - Safe integrity label.
   * @returns {Buffer} - Independent exact byte copy.
   */
  function copyVerifiedBytes(reference, value, label) {
    let byteLength;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      byteLength = value.byteLength;
    } else if (value instanceof ArrayBuffer) {
      byteLength = value.byteLength;
    } else {
      throw new ExecutionPayloadStoreIntegrityError(
        reference.payloadId,
        `${label} did not return exact bytes`,
      );
    }
    if (byteLength !== reference.size) {
      throw new ExecutionPayloadStoreIntegrityError(
        reference.payloadId,
        `${label} byte size ${byteLength} does not match reference size ${reference.size}`,
      );
    }
    const bytes =
      value instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(value))
        : Buffer.from(value);
    try {
      verifyExecutionPayloadReference(reference, bytes, label);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExecutionPayloadStoreIntegrityError(
        reference.payloadId,
        `${label}: ${message}`,
      );
    }
    return bytes;
  }

  /**
   * Publish exact local bytes, then independently read and verify the durable
   * distribution before a reference may be returned to the ledger.
   * @param {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} reference - Exact immutable reference.
   * @param {Buffer} bytes - Locally verified canonical bytes.
   * @returns {Promise<void>} - Resolves only after verified readback.
   */
  async function publishAndVerify(reference, bytes) {
    await publishImmutable({
      reference,
      bytes: Buffer.from(bytes),
    });
    copyVerifiedBytes(
      reference,
      await distributionReadBytes(reference),
      `distributed execution payload ${reference.payloadId}`,
    );
  }

  /**
   * @param {{value: unknown, payloadSchema: string}} input - Canonical JSON publication input.
   * @returns {Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>} - Locally and distributively durable reference.
   */
  async function putJson(input) {
    const reference = normalizeReplicatedReference(await localPutJson(input));
    const bytes = copyVerifiedBytes(
      reference,
      await localReadBytes(reference),
      `local execution payload ${reference.payloadId}`,
    );
    await publishAndVerify(reference, bytes);
    return reference;
  }

  /**
   * Import already-referenced bytes locally and publish them to the same
   * distribution. This retains the local store's strict input validation and
   * immutable conflict behavior.
   * @param {{reference: unknown, bytes: unknown}} input - Exact import input.
   * @returns {Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>} - Replicated reference.
   */
  async function importBytes(input) {
    const expected = normalizeReplicatedReference(input?.reference);
    const reference = normalizeImportedReference(
      expected,
      await localImportBytes(input),
    );
    const bytes = copyVerifiedBytes(
      reference,
      await localReadBytes(reference),
      `local execution payload ${reference.payloadId}`,
    );
    await publishAndVerify(reference, bytes);
    return reference;
  }

  /**
   * Read from the local replica, falling back only when the exact immutable
   * object is absent. Distributed bytes are verified before hydration, and
   * the local import must complete before the bytes are returned.
   * @param {unknown} value - Candidate immutable reference.
   * @returns {Promise<Buffer>} - Independently owned verified bytes.
   */
  async function readBytes(value) {
    const reference = normalizeReplicatedReference(value);
    try {
      return copyVerifiedBytes(
        reference,
        await localReadBytes(reference),
        `local execution payload ${reference.payloadId}`,
      );
    } catch (error) {
      if (
        !(error instanceof ExecutionPayloadStoreNotFoundError) ||
        error.payloadId !== reference.payloadId
      ) {
        throw error;
      }
    }

    const bytes = copyVerifiedBytes(
      reference,
      await distributionReadBytes(reference),
      `distributed execution payload ${reference.payloadId}`,
    );
    normalizeImportedReference(
      reference,
      await localImportBytes({ reference, bytes }),
    );
    return copyVerifiedBytes(
      reference,
      await localReadBytes(reference),
      `hydrated local execution payload ${reference.payloadId}`,
    );
  }

  /**
   * @param {unknown} value - Candidate immutable reference.
   * @returns {Promise<{reference: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, value: any}>} - Verified decoded payload.
   */
  async function readVerified(value) {
    const reference = normalizeReplicatedReference(value);
    const bytes = await readBytes(reference);
    try {
      return verifyExecutionPayloadReference(
        reference,
        bytes,
        `replicated execution payload ${reference.payloadId}`,
      );
    } catch (error) {
      if (error instanceof ExecutionPayloadStoreIntegrityError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ExecutionPayloadStoreIntegrityError(
        reference.payloadId,
        message,
      );
    }
  }

  /**
   * @param {unknown} reference - Immutable reference.
   * @returns {Promise<any>} - Verified JSON.
   */
  async function readJson(reference) {
    return (await readVerified(reference)).value;
  }

  /**
   * @param {unknown} reference - Immutable reference.
   * @returns {Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>} - Verified reference.
   */
  async function verify(reference) {
    return (await readVerified(reference)).reference;
  }

  const replicatedStore = Object.freeze({
    storage,
    distribution,
    putJson,
    importBytes,
    readBytes,
    readVerified,
    readJson,
    verify,
  });
  REPLICATED_EXECUTION_PAYLOAD_STORE_SCOPES.set(
    replicatedStore,
    Object.freeze({ storage, distribution }),
  );
  return replicatedStore;
}

export default createReplicatedExecutionPayloadStore;
