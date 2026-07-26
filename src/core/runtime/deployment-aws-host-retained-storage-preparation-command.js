/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/tag-lines -- This narrow command boundary keeps its exact injected-port contract inline. */

import { createAwsSingleNodeHostRetainedStorageFormatPreparation } from './deployment-aws-host-retained-storage-format-preparation.js';
import { createAwsSingleNodeHostRetainedStorageObserver } from './deployment-aws-host-retained-storage-observer.js';

const PRODUCTION_OPTIONS_KEYS = Object.freeze(['journalStore']);
const TEST_OPTIONS_KEYS = Object.freeze(['observer', 'journalStore']);
const OBSERVER_KEYS = Object.freeze(['inspect', 'inspectBlankFormat']);
const JOURNAL_STORE_KEYS = Object.freeze([
  'readRetainedStorageFormatJournal',
  'compareAndSetRetainedStorageFormatJournal',
]);
const INVALID_PRODUCTION_OPTIONS =
  'AWS single-node host retained-storage preparation command options are invalid.';
const INVALID_TEST_OPTIONS =
  'AWS single-node host retained-storage preparation command test options are invalid.';
const INVALID_OBSERVER =
  'AWS single-node host retained-storage preparation command observer is invalid.';
const INVALID_JOURNAL_STORE =
  'AWS single-node host retained-storage preparation command journal store is invalid.';

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
 * Capture an exact method-only port while retaining its original receiver.
 * @param {unknown} value - Candidate port.
 * @param {Readonly<string[]>} keys - Complete method surface.
 * @param {string} message - Fixed validation failure.
 * @returns {Readonly<{receiver: Record<string, any>, methods: Readonly<Record<string, Function>>}>} - Stable port.
 */
function snapshotPort(value, keys, message) {
  const methods = snapshotExactObject(value, keys, message);
  if (keys.some((key) => typeof methods[key] !== 'function')) {
    throw new TypeError(message);
  }
  return Object.freeze({
    receiver: /** @type {Record<string, any>} */ (value),
    methods,
  });
}

/**
 * Construct the adapter-compatible facade from already captured ports.
 *
 * This facade is deliberately not an authority boundary. Host-lock admission
 * protects journal access, but host lock alone is insufficient authorization:
 * the activation kernel must freshly authorize controller dispatch and prove
 * the current local fence before calling `converge`.
 *
 * Preparation results are intentionally discarded. Durable preparation is
 * history, not settled physical storage, formatter authority, or permission
 * to advance activation without the adapter's subsequent observation.
 *
 * @param {ReturnType<typeof snapshotPort>} observer - Captured observer.
 * @param {ReturnType<typeof snapshotPort>} journalStore - Captured store.
 * @returns {Readonly<{inspect: Function, converge: Function}>} - Exact facade.
 */
function createCommand(observer, journalStore) {
  const observerFacade = Object.freeze({
    inspect(/** @type {unknown} */ desired) {
      return Reflect.apply(observer.methods.inspect, observer.receiver, [
        desired,
      ]);
    },
    inspectBlankFormat(/** @type {unknown} */ desired) {
      return Reflect.apply(
        observer.methods.inspectBlankFormat,
        observer.receiver,
        [desired],
      );
    },
  });
  const journalStoreFacade = Object.freeze({
    readRetainedStorageFormatJournal(/** @type {unknown} */ desired) {
      return Reflect.apply(
        journalStore.methods.readRetainedStorageFormatJournal,
        journalStore.receiver,
        [desired],
      );
    },
    compareAndSetRetainedStorageFormatJournal(/** @type {unknown} */ input) {
      return Reflect.apply(
        journalStore.methods.compareAndSetRetainedStorageFormatJournal,
        journalStore.receiver,
        [input],
      );
    },
  });
  const preparation = createAwsSingleNodeHostRetainedStorageFormatPreparation({
    observer: observerFacade,
    journalStore: journalStoreFacade,
  });
  const prepare = preparation.prepare;

  return Object.freeze({
    /** @param {unknown} desired @returns {unknown} */
    inspect(desired) {
      return Reflect.apply(observer.methods.inspect, observer.receiver, [
        desired,
      ]);
    },

    /** @param {unknown} input @returns {Promise<void>} */
    async converge(input) {
      await Reflect.apply(prepare, preparation, [input]);
    },
  });
}

/**
 * Create the production retained-storage preparation command.
 *
 * Production construction is closed over the native root/Linux observer. The
 * only caller-supplied capability is the host-lock-admitted format journal
 * store; callers cannot replace physical observation or add mutation ports.
 *
 * @param {unknown} value - Exact journal-store option.
 * @returns {Readonly<{inspect: Function, converge: Function}>} - Command.
 */
export function createAwsSingleNodeHostRetainedStoragePreparationCommand(
  value,
) {
  const options = snapshotExactObject(
    value,
    PRODUCTION_OPTIONS_KEYS,
    INVALID_PRODUCTION_OPTIONS,
  );
  const journalStore = snapshotPort(
    options.journalStore,
    JOURNAL_STORE_KEYS,
    INVALID_JOURNAL_STORE,
  );
  const observer = snapshotPort(
    createAwsSingleNodeHostRetainedStorageObserver(),
    OBSERVER_KEYS,
    INVALID_OBSERVER,
  );
  return createCommand(observer, journalStore);
}

/**
 * Create the same facade over a synthetic observer for semantic tests.
 * Production construction never accepts this observer seam.
 *
 * @param {unknown} value - Exact observer and journal-store options.
 * @returns {Readonly<{inspect: Function, converge: Function}>} - Command.
 */
export function createAwsSingleNodeHostRetainedStoragePreparationCommandForTest(
  value,
) {
  const options = snapshotExactObject(
    value,
    TEST_OPTIONS_KEYS,
    INVALID_TEST_OPTIONS,
  );
  const observer = snapshotPort(
    options.observer,
    OBSERVER_KEYS,
    INVALID_OBSERVER,
  );
  const journalStore = snapshotPort(
    options.journalStore,
    JOURNAL_STORE_KEYS,
    INVALID_JOURNAL_STORE,
  );
  return createCommand(observer, journalStore);
}

export default createAwsSingleNodeHostRetainedStoragePreparationCommand;
