/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/tag-lines -- This narrow orchestration boundary keeps its exact injected-port contract inline. */

import { createCanonicalJsonSha256Id } from './content-id.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX,
} from './deployment-aws-host-activation.js';
import {
  createAwsSingleNodeHostRetainedStoragePreparedFormatJournal,
  validateAwsSingleNodeHostRetainedStorageFormatJournalForDesired,
} from './deployment-aws-host-retained-storage-format-journal.js';
import { validateAwsSingleNodeHostRetainedStorageDesired } from './deployment-aws-host-retained-storage.js';

const OPTIONS_KEYS = Object.freeze(['observer', 'journalStore']);
const OBSERVER_KEYS = Object.freeze(['inspect', 'inspectBlankFormat']);
const JOURNAL_STORE_KEYS = Object.freeze([
  'readRetainedStorageFormatJournal',
  'compareAndSetRetainedStorageFormatJournal',
]);
const PREPARE_KEYS = Object.freeze([
  'desired',
  'intentId',
  'attemptGeneration',
]);
const STATUS_ONLY_KEYS = Object.freeze(['status']);
const BLANK_RESULT_KEYS = Object.freeze(['status', 'proof']);
const INVALID_OPTIONS =
  'AWS single-node host retained-storage format preparation options are invalid.';
const INVALID_OBSERVER =
  'AWS single-node host retained-storage format preparation observer is invalid.';
const INVALID_JOURNAL_STORE =
  'AWS single-node host retained-storage format preparation journal store is invalid.';
const INVALID_PREPARE_INPUT =
  'AWS single-node host retained-storage format preparation input is invalid.';
const INVALID_OBSERVATION =
  'AWS single-node host retained-storage blank observation is invalid.';
const UNKNOWN_DURABILITY =
  'AWS single-node host retained-storage format preparation durability is unknown.';

/** A format-journal mutation did not produce conclusive durable readback. */
export class AwsSingleNodeHostRetainedStorageFormatPreparationUnknownError extends Error {
  /** @param {{cause?: unknown}} [options] - Optional non-rendered cause. */
  constructor(options = {}) {
    super(UNKNOWN_DURABILITY, options);
    this.name = 'AwsSingleNodeHostRetainedStorageFormatPreparationUnknownError';
    this.code =
      'AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PREPARATION_UNKNOWN';
  }
}

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, any>} - Whether value is a plain object.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Snapshot one exact enumerable own-data object without invoking accessors.
 * @param {unknown} value - Candidate object.
 * @param {Readonly<string[]>} keys - Complete ordered key surface.
 * @param {string} message - Fixed validation failure.
 * @returns {Readonly<Record<string, any>>} - Descriptor-snapshotted values.
 */
function snapshotExactObject(value, keys, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some(
      (key) =>
        typeof key !== 'string' || !keys.includes(/** @type {string} */ (key)),
    )
  ) {
    throw new TypeError(message);
  }

  /** @type {Record<string, any>} */
  const snapshot = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(message);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

/**
 * Derive the only activation step allowed to prepare the desired media role.
 * @param {string} capabilityKind - Retained-storage role.
 * @returns {'application-storage'|'control-storage'} - Activation step kind.
 */
function storageStepKind(capabilityKind) {
  if (capabilityKind === 'application-state') return 'application-storage';
  if (capabilityKind === 'control-state') return 'control-storage';
  throw new TypeError(INVALID_PREPARE_INPUT);
}

/**
 * Snapshot and validate the complete public input before the first await.
 * @param {unknown} value - Exact preparation input.
 * @returns {Readonly<{desired: Readonly<Record<string, any>>, intentId: string, attemptGeneration: number}>} - Canonical input.
 */
function validatePrepareInput(value) {
  const input = snapshotExactObject(value, PREPARE_KEYS, INVALID_PREPARE_INPUT);
  let desired;
  try {
    desired = validateAwsSingleNodeHostRetainedStorageDesired(input.desired);
  } catch {
    throw new TypeError(INVALID_PREPARE_INPUT);
  }
  if (
    typeof input.intentId !== 'string' ||
    !Number.isSafeInteger(input.attemptGeneration) ||
    input.attemptGeneration < 0
  ) {
    throw new TypeError(INVALID_PREPARE_INPUT);
  }
  const expectedIntentId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX,
    value: {
      requestId: desired.requestId,
      kind: storageStepKind(desired.capabilityKind),
    },
    valuePath: 'awsSingleNodeHostRetainedStorageFormatPreparation intent',
  });
  if (input.intentId !== expectedIntentId) {
    throw new TypeError(INVALID_PREPARE_INPUT);
  }
  return Object.freeze({
    desired,
    intentId: input.intentId,
    attemptGeneration: input.attemptGeneration,
  });
}

/**
 * Snapshot the closed observer's finite result without accepting provenance
 * from the result itself. Trust remains with the injected observer port.
 * @param {unknown} value - Candidate blank observation.
 * @returns {Readonly<Record<string, any>>} - Exact finite result.
 */
function validateBlankObservation(value) {
  if (!isPlainObject(value)) throw new TypeError(INVALID_OBSERVATION);
  const statusDescriptor = Object.getOwnPropertyDescriptor(value, 'status');
  if (
    statusDescriptor === undefined ||
    statusDescriptor.enumerable !== true ||
    !Object.hasOwn(statusDescriptor, 'value')
  ) {
    throw new TypeError(INVALID_OBSERVATION);
  }
  const status = statusDescriptor.value;
  if (status === 'unknown' || status === 'conflict') {
    snapshotExactObject(value, STATUS_ONLY_KEYS, INVALID_OBSERVATION);
    return Object.freeze({ status });
  }
  if (status !== 'blank') throw new TypeError(INVALID_OBSERVATION);
  const observation = snapshotExactObject(
    value,
    BLANK_RESULT_KEYS,
    INVALID_OBSERVATION,
  );
  return Object.freeze({ status, proof: observation.proof });
}

/**
 * Convert one independently validated durable journal into the public result.
 * @param {Readonly<Record<string, any>>} journal - Exact durable truth.
 * @returns {Readonly<{status: 'prepared'|'formatted', journal: Readonly<Record<string, any>>}>} - Immutable outcome.
 */
function durableResult(journal) {
  if (journal.phase !== 'prepared' && journal.phase !== 'formatted') {
    throw new AwsSingleNodeHostRetainedStorageFormatPreparationUnknownError();
  }
  return Object.freeze({ status: journal.phase, journal });
}

/**
 * Coordinate proof-gated preparation of one retained-storage format journal.
 *
 * The injected observer is the sole authority for blank-media proof. A CAS
 * response is never success authority: every attempted publication settles
 * only from a fresh, independently validated durable readback. This layer does
 * not acquire the host lock and does not format media.
 *
 * A returned `prepared` or `formatted` journal proves durable history only.
 * In particular, `prepared` does not prove that media is still blank. Neither
 * result proves current live media state, formatter authority, or current
 * controller authorization.
 *
 * @param {unknown} value - Exact closed observer and journal-store ports.
 * @returns {Readonly<{prepare: Function}>} - Frozen preparation capability.
 */
export function createAwsSingleNodeHostRetainedStorageFormatPreparation(value) {
  const options = snapshotExactObject(value, OPTIONS_KEYS, INVALID_OPTIONS);
  const observer = snapshotExactObject(
    options.observer,
    OBSERVER_KEYS,
    INVALID_OBSERVER,
  );
  const journalStore = snapshotExactObject(
    options.journalStore,
    JOURNAL_STORE_KEYS,
    INVALID_JOURNAL_STORE,
  );
  if (
    typeof observer.inspect !== 'function' ||
    typeof observer.inspectBlankFormat !== 'function'
  ) {
    throw new TypeError(INVALID_OBSERVER);
  }
  if (
    typeof journalStore.readRetainedStorageFormatJournal !== 'function' ||
    typeof journalStore.compareAndSetRetainedStorageFormatJournal !== 'function'
  ) {
    throw new TypeError(INVALID_JOURNAL_STORE);
  }

  const observerReceiver = options.observer;
  const journalStoreReceiver = options.journalStore;

  /**
   * Read and independently validate the exact journal for this stable target.
   * @param {Readonly<Record<string, any>>} desired - Canonical current desired.
   * @returns {Promise<Readonly<Record<string, any>>|null>} - Durable truth.
   */
  async function readDurableJournal(desired) {
    const stored = await Reflect.apply(
      journalStore.readRetainedStorageFormatJournal,
      journalStoreReceiver,
      [desired],
    );
    if (stored === null) return null;
    return validateAwsSingleNodeHostRetainedStorageFormatJournalForDesired(
      stored,
      desired,
    );
  }

  /**
   * Prepare a durable blank-format journal or return current durable truth.
   * @param {unknown} inputValue - Exact desired, intent, and attempt.
   * @returns {Promise<Readonly<Record<string, any>>>} - Finite outcome.
   */
  async function prepare(inputValue) {
    const input = validatePrepareInput(inputValue);
    const existing = await readDurableJournal(input.desired);
    if (existing !== null) return durableResult(existing);

    const observed = validateBlankObservation(
      await Reflect.apply(observer.inspectBlankFormat, observerReceiver, [
        input.desired,
      ]),
    );
    if (observed.status !== 'blank') return observed;

    const prepared =
      createAwsSingleNodeHostRetainedStoragePreparedFormatJournal({
        desired: input.desired,
        intentId: input.intentId,
        attemptGeneration: input.attemptGeneration,
        blankProof: observed.proof,
      });

    let publicationFailed = false;
    /** @type {unknown} */
    let publicationError;
    /** @type {unknown} */
    let applied;
    try {
      applied = await Reflect.apply(
        journalStore.compareAndSetRetainedStorageFormatJournal,
        journalStoreReceiver,
        [
          Object.freeze({
            desired: input.desired,
            expectedJournalId: null,
            nextJournal: prepared,
          }),
        ],
      );
      if (typeof applied !== 'boolean') {
        publicationFailed = true;
        publicationError = new TypeError(
          'compareAndSetRetainedStorageFormatJournal must return a boolean.',
        );
      }
    } catch (error) {
      publicationFailed = true;
      publicationError = error;
    }

    const durable = await readDurableJournal(input.desired);
    if (durable !== null) return durableResult(durable);
    if (publicationFailed) throw publicationError;
    throw new AwsSingleNodeHostRetainedStorageFormatPreparationUnknownError();
  }

  return Object.freeze({ prepare });
}

export default createAwsSingleNodeHostRetainedStorageFormatPreparation;
