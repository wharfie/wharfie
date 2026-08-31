/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- Strict snapshot records keep their exact shapes inline. */

import {
  normalizeApplicationStateSnapshotDistributionIdentity,
  validateApplicationStateSnapshotReference,
  verifyApplicationStateSnapshotReference,
} from './application-state-snapshot.js';

/**
 * @typedef {Readonly<{identity: Readonly<{kind: 'wharfie.application-state-snapshot-distribution.v1', distributionId: string, storeId: string}>, publishImmutable: (input: {reference: unknown, bytes: unknown}) => Promise<Readonly<Record<string, any>>>, readBytes: (reference: unknown) => Promise<Buffer>}>} ApplicationStateSnapshotDistribution
 */

/**
 * Construction-only brand for provider-neutral snapshot-distribution
 * capabilities. Public identity metadata cannot claim verified immutable
 * publication on its own.
 * @type {WeakMap<object, Readonly<Record<string, any>>>}
 */
const APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_SCOPES = new WeakMap();

const DISTRIBUTION_OPTION_KEYS = new Set([
  'identity',
  'publishImmutable',
  'readBytes',
]);
const PUBLICATION_INPUT_KEYS = new Set(['reference', 'bytes']);

/** Error raised when an immutable snapshot is absent from a distribution. */
export class ApplicationStateSnapshotNotFoundError extends Error {
  /** @param {string} snapshotId - Missing immutable snapshot identity. */
  constructor(snapshotId) {
    super(`Application-state snapshot is missing: ${snapshotId}`);
    this.name = 'ApplicationStateSnapshotNotFoundError';
    this.snapshotId = snapshotId;
  }
}

/** Error raised when distributed bytes do not match their snapshot reference. */
export class ApplicationStateSnapshotIntegrityError extends Error {
  /**
   * @param {string} snapshotId - Immutable snapshot identity.
   * @param {string} reason - Safe integrity failure reason.
   * @param {{cause?: unknown}} [options] - Optional non-rendered cause.
   */
  constructor(snapshotId, reason, options = {}) {
    super(
      `Application-state snapshot integrity check failed: ${snapshotId} (${reason})`,
      options,
    );
    this.name = 'ApplicationStateSnapshotIntegrityError';
    this.snapshotId = snapshotId;
  }
}

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} keys - Exact supported enumerable keys.
 * @param {string} label - Boundary label.
 * @returns {void}
 */
function assertExactKeys(value, keys, label) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key))
      throw new TypeError(`${label}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${label}.${key} is required.`);
    }
  }
}

/**
 * Require a capability returned by createApplicationStateSnapshotDistribution.
 * A copied or caller-shaped object cannot reproduce the out-of-band brand.
 * @param {unknown} value - Candidate distribution capability.
 * @param {string} [label] - Boundary label.
 * @returns {asserts value is ApplicationStateSnapshotDistribution}
 */
export function assertApplicationStateSnapshotDistribution(
  value,
  label = 'application-state snapshot distribution',
) {
  if (
    !value ||
    typeof value !== 'object' ||
    !APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_SCOPES.has(value)
  ) {
    throw new TypeError(
      `${label} must be constructed by createApplicationStateSnapshotDistribution().`,
    );
  }
}

/**
 * Create one independently owned byte copy and verify it against the complete
 * normalized snapshot reference. Provider bytes are untrusted even when a
 * publication call reported success.
 * @param {Readonly<Record<string, any>>} reference - Exact snapshot reference.
 * @param {unknown} value - Candidate provider bytes.
 * @param {string} label - Safe integrity label.
 * @returns {Buffer} - Independently owned verified bytes.
 */
function copyVerifiedBytes(reference, value, label) {
  let byteLength;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    byteLength = value.byteLength;
  } else if (value instanceof ArrayBuffer) {
    byteLength = value.byteLength;
  } else {
    throw new ApplicationStateSnapshotIntegrityError(
      reference.snapshotId,
      `${label} did not return exact bytes`,
    );
  }
  if (byteLength !== reference.size) {
    throw new ApplicationStateSnapshotIntegrityError(
      reference.snapshotId,
      `${label} byte size ${byteLength} does not match reference size ${reference.size}`,
    );
  }
  const bytes =
    value instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(value))
      : Buffer.from(value);
  try {
    verifyApplicationStateSnapshotReference(reference, bytes, label);
  } catch (error) {
    if (error instanceof ApplicationStateSnapshotIntegrityError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ApplicationStateSnapshotIntegrityError(
      reference.snapshotId,
      `${label}: ${message}`,
      { cause: error },
    );
  }
  return bytes;
}

/**
 * Construct the provider-neutral immutable snapshot-distribution boundary.
 * The provider port owns routing and credentials; core receives only one
 * strict durable identity, immutable references, and exact bytes.
 *
 * A publication never succeeds from the provider response alone. Exact bytes
 * must be independently read and verified immediately. When the publication
 * response is lost, the same readback is authoritative: exact retained bytes
 * settle success, while any other outcome preserves the original failure.
 * @param {{identity: unknown, publishImmutable: (input: {reference: Readonly<Record<string, any>>, bytes: Buffer}) => Promise<unknown>, readBytes: (reference: Readonly<Record<string, any>>) => Promise<unknown>}} options - Exact distribution port.
 * @returns {ApplicationStateSnapshotDistribution} - Branded immutable distribution capability.
 */
export function createApplicationStateSnapshotDistribution(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Application-state snapshot distribution options must be an object.',
    );
  }
  const candidate = /** @type {Record<string, any>} */ (options);
  assertExactKeys(
    candidate,
    DISTRIBUTION_OPTION_KEYS,
    'application-state snapshot distribution options',
  );
  const identity = normalizeApplicationStateSnapshotDistributionIdentity(
    candidate.identity,
    'application-state snapshot distribution identity',
  );
  const publishImmutableMethod = candidate.publishImmutable;
  const readBytesMethod = candidate.readBytes;
  if (
    typeof publishImmutableMethod !== 'function' ||
    typeof readBytesMethod !== 'function'
  ) {
    throw new TypeError(
      'Application-state snapshot distribution must expose publishImmutable() and readBytes().',
    );
  }
  const portPublishImmutable = publishImmutableMethod.bind(candidate);
  const portReadBytes = readBytesMethod.bind(candidate);

  /**
   * @param {unknown} value - Candidate immutable reference.
   * @returns {Readonly<Record<string, any>>} - Reference in this distribution's exact store namespace.
   */
  function normalizeReference(value) {
    const reference = validateApplicationStateSnapshotReference(
      value,
      'application-state snapshot distribution reference',
    );
    if (reference.destination.configuration.storeId !== identity.storeId) {
      throw new TypeError(
        `Application-state snapshot ${reference.snapshotId} belongs to a different distribution store.`,
      );
    }
    return reference;
  }

  /**
   * @param {Readonly<Record<string, any>>} reference - Normalized reference.
   * @param {string} label - Integrity boundary label.
   * @returns {Promise<Buffer>} - Independently owned verified bytes.
   */
  async function readVerified(reference, label) {
    return copyVerifiedBytes(reference, await portReadBytes(reference), label);
  }

  /**
   * @param {unknown} value - Candidate immutable reference.
   * @returns {Promise<Buffer>} - Independently owned verified bytes.
   */
  async function readBytes(value) {
    const reference = normalizeReference(value);
    return await readVerified(
      reference,
      `distributed application-state snapshot ${reference.snapshotId}`,
    );
  }

  /**
   * @param {{reference: unknown, bytes: unknown}} input - Exact snapshot publication.
   * @returns {Promise<Readonly<Record<string, any>>>} - Normalized reference after exact distributed readback.
   */
  async function publishImmutable(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError(
        'Application-state snapshot publication must be an object.',
      );
    }
    const publication = /** @type {Record<string, any>} */ (input);
    assertExactKeys(
      publication,
      PUBLICATION_INPUT_KEYS,
      'application-state snapshot publication',
    );
    const reference = normalizeReference(publication.reference);
    const bytes = copyVerifiedBytes(
      reference,
      publication.bytes,
      `application-state snapshot publication ${reference.snapshotId}`,
    );

    let publishFailed = false;
    /** @type {unknown} */
    let publishError;
    try {
      await portPublishImmutable({
        reference,
        bytes: Buffer.from(bytes),
      });
    } catch (error) {
      publishFailed = true;
      publishError = error;
    }

    if (publishFailed) {
      try {
        const retained = await readVerified(
          reference,
          `ambiguous application-state snapshot publication ${reference.snapshotId}`,
        );
        if (retained.equals(bytes)) return reference;
      } catch {
        // Exact readback is the only recovery proof. Preserve the publication
        // failure when no such proof is available.
      }
      throw publishError;
    }

    const retained = await readVerified(
      reference,
      `application-state snapshot publication readback ${reference.snapshotId}`,
    );
    if (!retained.equals(bytes)) {
      throw new ApplicationStateSnapshotIntegrityError(
        reference.snapshotId,
        'publication readback does not contain the exact submitted bytes',
      );
    }
    return reference;
  }

  const distribution = Object.freeze({
    identity,
    publishImmutable,
    readBytes,
  });
  APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_SCOPES.set(distribution, identity);
  return distribution;
}

export default createApplicationStateSnapshotDistribution;
