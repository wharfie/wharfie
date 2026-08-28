import { setTimeout as sleep } from 'node:timers/promises';

import { assertLogicalId } from '../../../runtime/logical-id.js';
import { assertLedgerOpaqueId } from '../../ledger/record-key.js';
import { DB_ADAPTER_NAMES, assertDBClientAdapterIdentity } from '../base.js';
import {
  CoordinatorAuthorityRequestConflictError,
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
} from './coordinator-authority.js';

export const DYNAMODB_COORDINATOR_AUTHORITY_OBSERVATION_SCHEMA_VERSION = 1;
export const DYNAMODB_COORDINATOR_AUTHORITY_OBSERVATION_KIND =
  'dynamodb-coordinator-authority-rvn-observation';
export const DYNAMODB_COORDINATOR_AUTHORITY_MAX_OBSERVATION_WINDOW_MS = 2_147_483_647;

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const MAX_OBSERVATION_WAIT_CYCLES = 1_024;
const MAX_NO_PROGRESS_WAIT_CYCLES = 3;

/**
 * @typedef {Readonly<{
 *   schemaVersion: 1,
 *   kind: 'dynamodb-coordinator-authority-rvn-observation',
 *   tableName: string,
 *   appId: string,
 *   observationWindowMs: number,
 *   elapsedNanoseconds: string,
 *   recordVersion: number,
 *   authority: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot,
 * }>} DynamoDBCoordinatorAuthorityObservation
 */

/** DynamoDB observation state was impossible or the monotonic clock failed. */
export class DynamoDBCoordinatorAuthorityObservationError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} reason - Safe failure reason.
   * @param {{cause?: unknown}} [options] - Optional underlying failure.
   */
  constructor(appId, reason, options = {}) {
    super(`DynamoDB coordinator observation failed: ${appId} (${reason})`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'DynamoDBCoordinatorAuthorityObservationError';
    this.code = 'WHARFIE_DYNAMODB_COORDINATOR_OBSERVATION_FAILED';
    this.appId = appId;
    this.reason = reason;
  }
}

/** A takeover write or its receipt readback did not produce a definite result. */
export class DynamoDBCoordinatorAuthorityTakeoverUnknownError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} requestId - Exact retry identity.
   * @param {{cause?: unknown}} [options] - Provider or readback failure.
   */
  constructor(appId, requestId, options = {}) {
    super(
      `DynamoDB coordinator takeover outcome is unknown: ${appId}#${requestId}`,
      {
        ...(options.cause === undefined ? {} : { cause: options.cause }),
      },
    );
    this.name = 'DynamoDBCoordinatorAuthorityTakeoverUnknownError';
    this.code = 'WHARFIE_DYNAMODB_COORDINATOR_TAKEOVER_UNKNOWN';
    this.appId = appId;
    this.requestId = requestId;
  }
}

/**
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} allowed - Exact supported keys.
 * @param {Set<string>} required - Required keys.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - The validated caller-owned object.
 */
function exactInput(value, allowed, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const keys = Object.keys(object);
  if (
    keys.some((key) => !allowed.has(key)) ||
    [...required].some(
      (key) => !Object.prototype.hasOwnProperty.call(object, key),
    )
  ) {
    throw new TypeError(`${label} contains unsupported or missing fields.`);
  }
  return object;
}

/**
 * @param {unknown} value - Candidate observation window.
 * @returns {number} - Positive bounded milliseconds.
 */
function observationWindow(value) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > DYNAMODB_COORDINATOR_AUTHORITY_MAX_OBSERVATION_WINDOW_MS
  ) {
    throw new TypeError(
      `observationWindowMs must be a positive safe integer no greater than ${DYNAMODB_COORDINATOR_AUTHORITY_MAX_OBSERVATION_WINDOW_MS}.`,
    );
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate diagnostic time.
 * @param {string} label - Boundary label.
 * @returns {number} - Nonnegative safe integer.
 */
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate abort signal.
 * @returns {boolean} - Whether the narrow signal contract is present.
 */
function isAbortSignal(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (
      /** @type {{addEventListener?: unknown}} */ (value).addEventListener
    ) === 'function' &&
    typeof (
      /** @type {{removeEventListener?: unknown}} */ (value).removeEventListener
    ) === 'function' &&
    typeof (/** @type {{aborted?: unknown}} */ (value).aborted) === 'boolean'
  );
}

/**
 * @param {import('./coordinator-authority.js').CoordinatorAuthoritySnapshot} left - Snapshot.
 * @param {import('./coordinator-authority.js').CoordinatorAuthoritySnapshot} right - Snapshot.
 * @returns {boolean} - Exact canonical equality.
 */
function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * @param {import('./coordinator-authority.js').CoordinatorAuthoritySnapshot} left - Snapshot.
 * @param {import('./coordinator-authority.js').CoordinatorAuthoritySnapshot} right - Snapshot.
 * @returns {boolean} - Stable authority identity equality.
 */
function sameAuthority(left, right) {
  return (
    left.appId === right.appId &&
    left.coordinatorId === right.coordinatorId &&
    left.authorityId === right.authorityId &&
    left.epoch === right.epoch
  );
}

/**
 * @param {unknown} error - Candidate Wharfie authority domain error.
 * @returns {boolean} - Whether the error already has definite authority semantics.
 */
function isCoordinatorAuthorityDomainError(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (/** @type {{code?: unknown}} */ (error).code) === 'string' &&
    /** @type {{code: string}} */ (error).code.startsWith(
      'WHARFIE_COORDINATOR_AUTHORITY_',
    )
  );
}

/**
 * Create the single-region DynamoDB RVN observation protocol. The caller must
 * establish that this is an ordinary non-global table and bind every protected
 * ledger mutation to this same client/table transaction domain; the adapter
 * brand alone cannot prove either deployment property. This primitive is
 * intentionally not a resident renewal loop or automatic recovery policy. Its
 * safety depends on every authoritative DynamoDB mutation sharing the stable
 * epoch fence; the local observation timer controls replacement policy only.
 * @param {{db: import('../base.js').DBClient, tableName: string, observationWindowMs: number, monotonicNow?: () => bigint, waitForObservation?: (milliseconds: number, signal?: AbortSignal) => Promise<void>}} options - Exact provider and timing dependencies.
 * @returns {Readonly<{
 *   get: (input: {appId: string}) => Promise<import('./coordinator-authority.js').CoordinatorAuthoritySnapshot | null>,
 *   acquire: (input: {appId: string, coordinatorId: string, requestId: string, observedAt?: number}) => Promise<import('./coordinator-authority.js').CoordinatorAuthorityTransitionResult>,
 *   renew: (input: {observedAuthority: unknown, requestId: string, observedAt: number}) => Promise<{applied: boolean, authority: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot}>,
 *   release: (input: {authority: unknown, requestId: string, observedAt?: number}) => Promise<import('./coordinator-authority.js').CoordinatorAuthorityTransitionResult>,
 *   observeReplacement: (input: {appId: string, signal?: AbortSignal}) => Promise<Readonly<{outcome: 'inactive', authority: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot | null}> | Readonly<{outcome: 'changed', reason: 'renewed'|'released'|'replaced', before: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot, after: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot}> | Readonly<{outcome: 'stable', observation: DynamoDBCoordinatorAuthorityObservation, takeover: (input: {coordinatorId: string, requestId: string, observedAt: number}) => Promise<{applied: boolean, observation: DynamoDBCoordinatorAuthorityObservation, authority: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot}>}>>,
 * }>} - Closed provider protocol.
 */
export function createDynamoDBCoordinatorAuthorityProtocol(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'createDynamoDBCoordinatorAuthorityProtocol options must be an object.',
    );
  }
  const allowedOptions = new Set([
    'db',
    'tableName',
    'observationWindowMs',
    'monotonicNow',
    'waitForObservation',
  ]);
  if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
    throw new TypeError(
      'createDynamoDBCoordinatorAuthorityProtocol options contain unsupported fields.',
    );
  }
  assertDBClientAdapterIdentity(options.db, DB_ADAPTER_NAMES.DYNAMODB);
  if (typeof options.tableName !== 'string' || !options.tableName.trim()) {
    throw new TypeError(
      'createDynamoDBCoordinatorAuthorityProtocol requires a tableName.',
    );
  }
  const tableName = options.tableName.trim();
  const observationWindowMs = observationWindow(options.observationWindowMs);
  const monotonicNow = options.monotonicNow ?? process.hrtime.bigint;
  if (typeof monotonicNow !== 'function') {
    throw new TypeError('monotonicNow must be a function.');
  }
  const waitForObservation =
    options.waitForObservation ??
    (async (milliseconds, signal) => {
      await sleep(milliseconds, undefined, signal ? { signal } : undefined);
    });
  if (typeof waitForObservation !== 'function') {
    throw new TypeError('waitForObservation must be a function.');
  }
  const authority = createCoordinatorAuthority({ db: options.db, tableName });

  /**
   * @param {string} appId - Observation scope.
   * @returns {bigint} - Valid monotonic timestamp.
   */
  function readMonotonic(appId) {
    let value;
    try {
      value = monotonicNow();
    } catch (cause) {
      throw new DynamoDBCoordinatorAuthorityObservationError(
        appId,
        'monotonic clock threw',
        { cause },
      );
    }
    if (typeof value !== 'bigint' || value < 0n) {
      throw new DynamoDBCoordinatorAuthorityObservationError(
        appId,
        'monotonic clock returned an invalid value',
      );
    }
    return value;
  }

  /**
   * Wait for one complete local monotonic interval. The waiter is only a
   * scheduling port; it never establishes elapsed time by itself.
   * @param {string} appId - Observation scope.
   * @param {bigint} startedAt - Post-read monotonic boundary.
   * @param {AbortSignal | undefined} signal - Optional cancellation.
   * @returns {Promise<bigint>} - Actual elapsed monotonic nanoseconds.
   */
  async function waitForCompleteWindow(appId, startedAt, signal) {
    const required = BigInt(observationWindowMs) * NANOSECONDS_PER_MILLISECOND;
    let previous = startedAt;
    let noProgressCycles = 0;
    for (let cycle = 0; cycle < MAX_OBSERVATION_WAIT_CYCLES; cycle += 1) {
      const elapsed = previous - startedAt;
      if (elapsed >= required) return elapsed;
      const remaining = required - elapsed;
      const remainingMilliseconds = Number(
        (remaining + NANOSECONDS_PER_MILLISECOND - 1n) /
          NANOSECONDS_PER_MILLISECOND,
      );
      await waitForObservation(remainingMilliseconds, signal);
      const current = readMonotonic(appId);
      if (current < previous) {
        throw new DynamoDBCoordinatorAuthorityObservationError(
          appId,
          'monotonic clock regressed',
        );
      }
      if (current === previous) {
        noProgressCycles += 1;
        if (noProgressCycles >= MAX_NO_PROGRESS_WAIT_CYCLES) {
          throw new DynamoDBCoordinatorAuthorityObservationError(
            appId,
            'monotonic clock made no progress',
          );
        }
      } else {
        noProgressCycles = 0;
      }
      previous = current;
    }
    throw new DynamoDBCoordinatorAuthorityObservationError(
      appId,
      'observation wait exceeded its progress bound',
    );
  }

  /**
   * @param {{appId: string, signal?: AbortSignal}} input - Replacement observation request.
   * @returns {Promise<Readonly<{outcome: 'inactive', authority: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot | null}> | Readonly<{outcome: 'changed', reason: 'renewed'|'released'|'replaced', before: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot, after: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot}> | Readonly<{outcome: 'stable', observation: DynamoDBCoordinatorAuthorityObservation, takeover: (input: {coordinatorId: string, requestId: string, observedAt: number}) => Promise<{applied: boolean, observation: DynamoDBCoordinatorAuthorityObservation, authority: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot}>}>>} - Closed observation result.
   */
  async function observeReplacement(input) {
    const value = exactInput(
      input,
      new Set(['appId', 'signal']),
      new Set(['appId']),
      'dynamodbCoordinatorAuthority.observeReplacement',
    );
    assertLogicalId(
      value.appId,
      'dynamodbCoordinatorAuthority.observeReplacement.appId',
    );
    const appId = value.appId;
    const signal = value.signal;
    if (signal !== undefined && !isAbortSignal(signal)) {
      throw new TypeError(
        'dynamodbCoordinatorAuthority.observeReplacement.signal must be an AbortSignal.',
      );
    }
    const before = await authority.get({ appId });
    if (!before || before.status === CoordinatorAuthorityStatus.RELEASED) {
      return Object.freeze({ outcome: 'inactive', authority: before });
    }
    const startedAt = readMonotonic(appId);
    const elapsed = await waitForCompleteWindow(appId, startedAt, signal);
    const after = await authority.get({ appId });
    if (!after) {
      throw new DynamoDBCoordinatorAuthorityObservationError(
        appId,
        'an ACTIVE authority record disappeared',
      );
    }
    if (!sameSnapshot(before, after)) {
      if (after.recordVersion <= before.recordVersion) {
        throw new DynamoDBCoordinatorAuthorityObservationError(
          appId,
          'record version did not advance with changed authority bytes',
        );
      }
      if (sameAuthority(before, after)) {
        return Object.freeze({
          outcome: 'changed',
          reason:
            after.status === CoordinatorAuthorityStatus.RELEASED
              ? 'released'
              : 'renewed',
          before,
          after,
        });
      }
      if (after.epoch <= before.epoch) {
        throw new DynamoDBCoordinatorAuthorityObservationError(
          appId,
          'replacement did not advance the coordinator epoch',
        );
      }
      return Object.freeze({
        outcome: 'changed',
        reason: 'replaced',
        before,
        after,
      });
    }

    const observation = Object.freeze({
      schemaVersion: DYNAMODB_COORDINATOR_AUTHORITY_OBSERVATION_SCHEMA_VERSION,
      kind: DYNAMODB_COORDINATOR_AUTHORITY_OBSERVATION_KIND,
      tableName,
      appId,
      observationWindowMs,
      elapsedNanoseconds: elapsed.toString(10),
      recordVersion: before.recordVersion,
      authority: before,
    });
    /** @type {{coordinatorId: string, requestId: string, observedAt: number} | null} */
    let retainedIntent = null;

    /**
     * Conditionally replace only the exact snapshot retained by this closure.
     * @param {{coordinatorId: string, requestId: string, observedAt: number}} takeoverInput - Exact replacement identity.
     * @returns {Promise<{applied: boolean, observation: DynamoDBCoordinatorAuthorityObservation, authority: import('./coordinator-authority.js').CoordinatorAuthoritySnapshot}>} - Takeover or exact replay.
     */
    async function takeover(takeoverInput) {
      const replacement = exactInput(
        takeoverInput,
        new Set(['coordinatorId', 'requestId', 'observedAt']),
        new Set(['coordinatorId', 'requestId', 'observedAt']),
        'dynamodbCoordinatorAuthority.takeover',
      );
      const intent = {
        coordinatorId: assertLedgerOpaqueId(
          replacement.coordinatorId,
          'dynamodbCoordinatorAuthority.takeover.coordinatorId',
        ),
        requestId: assertLedgerOpaqueId(
          replacement.requestId,
          'dynamodbCoordinatorAuthority.takeover.requestId',
        ),
        observedAt: nonnegativeInteger(
          replacement.observedAt,
          'dynamodbCoordinatorAuthority.takeover.observedAt',
        ),
      };
      if (
        retainedIntent &&
        JSON.stringify(retainedIntent) !== JSON.stringify(intent)
      ) {
        throw new CoordinatorAuthorityRequestConflictError(
          appId,
          intent.requestId,
        );
      }
      retainedIntent ??= Object.freeze(intent);
      try {
        const result = await authority.takeover({
          appId,
          coordinatorId: retainedIntent.coordinatorId,
          requestId: retainedIntent.requestId,
          observedAuthority: before,
          confirmAuthorityReplacement: true,
          observedAt: retainedIntent.observedAt,
        });
        return Object.freeze({
          applied: result.applied,
          observation,
          authority: result.authority,
        });
      } catch (error) {
        if (isCoordinatorAuthorityDomainError(error)) throw error;
        throw new DynamoDBCoordinatorAuthorityTakeoverUnknownError(
          appId,
          retainedIntent.requestId,
          { cause: error },
        );
      }
    }

    return Object.freeze({ outcome: 'stable', observation, takeover });
  }

  return Object.freeze({
    get: authority.get,
    acquire: authority.acquire,
    renew: authority.renewRecordVersion,
    release: authority.release,
    observeReplacement,
  });
}

export default createDynamoDBCoordinatorAuthorityProtocol;
