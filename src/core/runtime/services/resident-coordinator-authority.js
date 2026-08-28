/* eslint-disable jsdoc/no-undefined-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/tag-lines, jsdoc/valid-types -- The resident authority boundary keeps its exact protocol signatures inline. */

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  CoordinatorAuthorityConflictError,
  CoordinatorAuthorityRequestConflictError,
  CoordinatorAuthorityRenewalUnknownError,
  CoordinatorAuthorityStaleError,
  CoordinatorAuthorityStatus,
  assertCoordinatorAuthorityToken,
} from '../../lib/db/tables/coordinator-authority.js';
import { DynamoDBCoordinatorAuthorityTakeoverUnknownError } from '../../lib/db/tables/dynamodb-coordinator-authority.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { assertLogicalId } from '../logical-id.js';

export const RESIDENT_COORDINATOR_AUTHORITY_DEFAULT_RENEWAL_INTERVAL_MS = 5_000;
export const RESIDENT_COORDINATOR_AUTHORITY_DEFAULT_RETRY_DELAY_MS = 100;
export const RESIDENT_COORDINATOR_AUTHORITY_DEFAULT_RENEWAL_JITTER_RATIO = 0.2;
export const RESIDENT_COORDINATOR_AUTHORITY_MAX_INTERVAL_MS = 2_147_483_647;

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const MAX_WAIT_CYCLES = 1_024;
const MAX_NO_PROGRESS_WAIT_CYCLES = 3;
const RENEWAL_UNKNOWN_RETRIES = 1;
const RENEWAL_STOP_REASON = Object.freeze(
  Object.assign(new Error('Resident coordinator renewal stopped.'), {
    name: 'ResidentCoordinatorAuthorityRenewalStopped',
    code: 'WHARFIE_RESIDENT_COORDINATOR_AUTHORITY_RENEWAL_STOPPED',
  }),
);

/**
 * @typedef {ReturnType<import('../../lib/db/tables/dynamodb-coordinator-authority.js').createDynamoDBCoordinatorAuthorityProtocol>} ResidentCoordinatorAuthorityProtocol
 */

/**
 * @typedef {Readonly<{
 *   authority: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot,
 *   coordinatorAuthority: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken,
 *   signal: AbortSignal,
 * }>} ResidentCoordinatorAuthorityHandlerContext
 */

/** The resident must stop admitting work because ownership is no longer proven. */
export class ResidentCoordinatorAuthorityLostError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {'renewal'} phase - Authority phase that failed closed.
   * @param {{requestId?: string, cause?: unknown}} [options] - Exact failed request and cause.
   */
  constructor(appId, phase, options = {}) {
    const cause = options.cause;
    const requestId = options.requestId;
    super(`Resident coordinator authority was lost: ${appId} (${phase})`, {
      ...(cause === undefined ? {} : { cause }),
    });
    this.name = 'ResidentCoordinatorAuthorityLostError';
    this.code = 'WHARFIE_RESIDENT_COORDINATOR_AUTHORITY_LOST';
    this.appId = appId;
    this.phase = phase;
    if (requestId !== undefined) {
      this.requestId = requestId;
    }
  }
}

/** @param {unknown} value @param {string} label */
function positiveInterval(value, label) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > RESIDENT_COORDINATOR_AUTHORITY_MAX_INTERVAL_MS
  ) {
    throw new TypeError(
      `${label} must be a positive safe integer no greater than ${RESIDENT_COORDINATOR_AUTHORITY_MAX_INTERVAL_MS}.`,
    );
  }
  return Number(value);
}

/** @param {unknown} value @param {string} label */
function nonnegativeTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} label */
function normalizeAbortSignal(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (/** @type {AbortSignal} */ (value).addEventListener) !==
      'function' ||
    typeof (/** @type {AbortSignal} */ (value).removeEventListener) !==
      'function' ||
    typeof (/** @type {AbortSignal} */ (value).aborted) !== 'boolean'
  ) {
    throw new TypeError(`${label} must be an AbortSignal.`);
  }
  return /** @type {AbortSignal} */ (value);
}

/** @param {AbortSignal | undefined} signal */
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason ?? new Error('Resident coordinator authority aborted.');
}

/** @param {unknown} error @param {string} code */
function hasErrorCode(error, code) {
  return (
    error instanceof Error &&
    'code' in error &&
    /** @type {{code?: unknown}} */ (error).code === code
  );
}

/** @param {unknown} error */
function isAuthorityConflict(error) {
  return (
    error instanceof CoordinatorAuthorityConflictError ||
    hasErrorCode(error, 'WHARFIE_COORDINATOR_AUTHORITY_CONFLICT')
  );
}

/** @param {unknown} error */
function isAuthorityStale(error) {
  return (
    error instanceof CoordinatorAuthorityStaleError ||
    hasErrorCode(error, 'WHARFIE_COORDINATOR_AUTHORITY_STALE')
  );
}

/** @param {unknown} error */
function isRenewalUnknown(error) {
  return (
    error instanceof CoordinatorAuthorityRenewalUnknownError ||
    hasErrorCode(error, 'WHARFIE_COORDINATOR_AUTHORITY_RENEWAL_UNKNOWN')
  );
}

/** @param {unknown} error */
function isTakeoverUnknown(error) {
  return (
    error instanceof DynamoDBCoordinatorAuthorityTakeoverUnknownError ||
    hasErrorCode(error, 'WHARFIE_DYNAMODB_COORDINATOR_TAKEOVER_UNKNOWN')
  );
}

/** @param {unknown} error */
function isRequestConflict(error) {
  return (
    error instanceof CoordinatorAuthorityRequestConflictError ||
    hasErrorCode(error, 'WHARFIE_COORDINATOR_AUTHORITY_REQUEST_CONFLICT')
  );
}

/** @param {unknown} error */
function isKnownAuthorityDomainError(error) {
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    typeof (/** @type {{code?: unknown}} */ (error).code) !== 'string'
  ) {
    return false;
  }
  const code = /** @type {{code: string}} */ (error).code;
  return (
    code.startsWith('WHARFIE_COORDINATOR_AUTHORITY_') ||
    code.startsWith('WHARFIE_DYNAMODB_COORDINATOR_')
  );
}

/** @param {unknown} error */
function isOpaqueTransitionError(error) {
  return (
    isTakeoverUnknown(error) ||
    (!(error instanceof TypeError) && !isKnownAuthorityDomainError(error))
  );
}

/**
 * @param {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot} left
 * @param {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot} right
 */
function sameAuthoritySnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Read each supported own field once so accessors cannot drift between
 * validation and later authority decisions.
 * @param {Record<string, any>} value - Caller-owned input object.
 * @param {Set<string>} fields - Supported field names.
 * @returns {Readonly<Record<string, any>>} - Frozen single-read snapshot.
 */
function snapshotOwnFields(value, fields) {
  /** @type {Record<string, any>} */
  const snapshot = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      snapshot[field] = value[field];
    }
  }
  return Object.freeze(snapshot);
}

/**
 * Build one resident-only authority supervisor around the closed DynamoDB RVN
 * protocol. The initial full snapshot is retained for diagnostics while every
 * protected mutation receives one immutable stable token. Record-version
 * renewals replace only the supervisor's latest full snapshot and never alter
 * that bound token.
 *
 * `run({handler})` owns one authority lifecycle. Handler completion is the
 * graceful drain boundary: external cancellation is forwarded to the handler,
 * renewal continues while it drains, and the latest full snapshot is released
 * only after the handler settles. A renewal that remains stale, conflicting,
 * unknown, or otherwise invalid after its one exact ambiguity retry aborts the
 * handler signal and is reported after drain and cleanup. Acquisition and
 * takeover receipts admit work only after an exact strong-read match. If
 * cancellation intersects an ambiguous startup write, only that already
 * authorized exact intent is replayed until its receipt/current state settles;
 * any authority it proves or creates is released before cancellation returns.
 * Cleanup itself retains one receipt-backed release intent across retries.
 *
 * @param {{
 *   protocol: ResidentCoordinatorAuthorityProtocol,
 *   appId: string,
 *   coordinatorId: string,
 *   renewalIntervalMs?: number,
 *   retryDelayMs?: number,
 *   renewalJitterRatio?: number,
 *   observedAtNow?: () => number,
 *   monotonicNow?: () => bigint,
 *   waitForInterval?: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
 *   random?: () => number,
 *   createRequestId?: (input: Readonly<{action: 'acquire'|'takeover'|'renew'|'release', sequence: number}>) => string,
 * }} options - Exact authority, identity, policy, and deterministic timing ports.
 * @returns {Readonly<{
 *   run: <T>(input: {signal?: AbortSignal, handler: (context: ResidentCoordinatorAuthorityHandlerContext) => Promise<T> | T}) => Promise<T>,
 * }>} - Single-session resident authority supervisor.
 */
export function createResidentCoordinatorAuthoritySupervisor(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'createResidentCoordinatorAuthoritySupervisor requires options.',
    );
  }
  const allowedOptions = new Set([
    'protocol',
    'appId',
    'coordinatorId',
    'renewalIntervalMs',
    'retryDelayMs',
    'renewalJitterRatio',
    'observedAtNow',
    'monotonicNow',
    'waitForInterval',
    'random',
    'createRequestId',
  ]);
  if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
    throw new TypeError(
      'createResidentCoordinatorAuthoritySupervisor options contain unsupported fields.',
    );
  }
  const optionSnapshot = snapshotOwnFields(options, allowedOptions);
  const protocolInput = optionSnapshot.protocol;
  if (!protocolInput || typeof protocolInput !== 'object') {
    throw new TypeError(
      'Resident coordinator authority protocol must implement the closed DynamoDB RVN API.',
    );
  }
  const protocolMethodNames = Object.freeze([
    'get',
    'acquire',
    'renew',
    'release',
    'observeReplacement',
  ]);
  const protocolMethodSnapshot = Object.fromEntries(
    protocolMethodNames.map((method) => [
      method,
      /** @type {Record<string, any>} */ (protocolInput)[method],
    ]),
  );
  if (
    protocolMethodNames.some(
      (method) => typeof protocolMethodSnapshot[method] !== 'function',
    )
  ) {
    throw new TypeError(
      'Resident coordinator authority protocol must implement the closed DynamoDB RVN API.',
    );
  }
  const protocol = /** @type {ResidentCoordinatorAuthorityProtocol} */ (
    Object.freeze(
      Object.fromEntries(
        protocolMethodNames.map((method) => [
          method,
          protocolMethodSnapshot[method].bind(protocolInput),
        ]),
      ),
    )
  );
  assertLogicalId(optionSnapshot.appId, 'resident coordinator authority appId');
  const appId = /** @type {string} */ (optionSnapshot.appId);
  const coordinatorId = assertLedgerOpaqueId(
    optionSnapshot.coordinatorId,
    'resident coordinator authority coordinatorId',
  );
  const renewalIntervalMs = positiveInterval(
    optionSnapshot.renewalIntervalMs ??
      RESIDENT_COORDINATOR_AUTHORITY_DEFAULT_RENEWAL_INTERVAL_MS,
    'Resident coordinator authority renewalIntervalMs',
  );
  const retryDelayMs = positiveInterval(
    optionSnapshot.retryDelayMs ??
      RESIDENT_COORDINATOR_AUTHORITY_DEFAULT_RETRY_DELAY_MS,
    'Resident coordinator authority retryDelayMs',
  );
  const renewalJitterRatio =
    optionSnapshot.renewalJitterRatio ??
    RESIDENT_COORDINATOR_AUTHORITY_DEFAULT_RENEWAL_JITTER_RATIO;
  if (
    typeof renewalJitterRatio !== 'number' ||
    !Number.isFinite(renewalJitterRatio) ||
    renewalJitterRatio < 0 ||
    renewalJitterRatio >= 1
  ) {
    throw new TypeError(
      'Resident coordinator authority renewalJitterRatio must be in [0, 1).',
    );
  }
  const observedAtNow = optionSnapshot.observedAtNow ?? Date.now;
  const monotonicNow = optionSnapshot.monotonicNow ?? process.hrtime.bigint;
  /** @type {(milliseconds: number, signal?: AbortSignal) => Promise<void>} */
  const defaultWaitForInterval = async (milliseconds, signal) => {
    await sleep(milliseconds, undefined, signal ? { signal } : undefined);
  };
  const waitForInterval =
    optionSnapshot.waitForInterval ?? defaultWaitForInterval;
  const random = optionSnapshot.random ?? Math.random;
  const createRequestId =
    optionSnapshot.createRequestId ??
    (() => `resident-coordinator-${randomUUID()}`);
  for (const [value, label] of [
    [observedAtNow, 'observedAtNow'],
    [monotonicNow, 'monotonicNow'],
    [waitForInterval, 'waitForInterval'],
    [random, 'random'],
    [createRequestId, 'createRequestId'],
  ]) {
    if (typeof value !== 'function') {
      throw new TypeError(
        `Resident coordinator authority ${label} must be a function.`,
      );
    }
  }

  let requestSequence = 0;
  let running = false;

  /** @returns {number} */
  function readObservedAt() {
    return nonnegativeTimestamp(
      observedAtNow(),
      'Resident coordinator authority observedAtNow result',
    );
  }

  /** @returns {bigint} */
  function readMonotonic() {
    const value = monotonicNow();
    if (typeof value !== 'bigint' || value < 0n) {
      throw new TypeError(
        'Resident coordinator authority monotonicNow must return a nonnegative bigint.',
      );
    }
    return value;
  }

  /** @param {'acquire'|'takeover'|'renew'|'release'} action */
  function nextRequestId(action) {
    requestSequence += 1;
    return assertLedgerOpaqueId(
      createRequestId(Object.freeze({ action, sequence: requestSequence })),
      `resident coordinator authority ${action} requestId`,
    );
  }

  /** @returns {number} */
  function nextRenewalDelay() {
    const value = random();
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value >= 1
    ) {
      throw new TypeError(
        'Resident coordinator authority random must return a number in [0, 1).',
      );
    }
    return Math.max(
      1,
      Math.ceil(renewalIntervalMs * (1 - renewalJitterRatio * value)),
    );
  }

  /**
   * Treat the waiter as a scheduling port, not elapsed-time evidence.
   * @param {number} milliseconds - Required monotonic interval.
   * @param {AbortSignal | undefined} signal - Cancellation boundary.
   */
  async function waitForCompleteInterval(milliseconds, signal) {
    const required = BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
    const startedAt = readMonotonic();
    let previous = startedAt;
    let noProgressCycles = 0;
    for (let cycle = 0; cycle < MAX_WAIT_CYCLES; cycle += 1) {
      throwIfAborted(signal);
      const elapsed = previous - startedAt;
      if (elapsed >= required) return;
      const remaining = required - elapsed;
      const remainingMilliseconds = Number(
        (remaining + NANOSECONDS_PER_MILLISECOND - 1n) /
          NANOSECONDS_PER_MILLISECOND,
      );
      try {
        await waitForInterval(remainingMilliseconds, signal);
      } catch (error) {
        if (signal?.aborted) throwIfAborted(signal);
        throw error;
      }
      throwIfAborted(signal);
      const current = readMonotonic();
      if (current < previous) {
        throw new TypeError(
          'Resident coordinator authority monotonic clock regressed.',
        );
      }
      if (current === previous) {
        noProgressCycles += 1;
        if (noProgressCycles >= MAX_NO_PROGRESS_WAIT_CYCLES) {
          throw new TypeError(
            'Resident coordinator authority monotonic clock made no progress.',
          );
        }
      } else {
        noProgressCycles = 0;
      }
      previous = current;
    }
    throw new TypeError(
      'Resident coordinator authority wait exceeded its progress bound.',
    );
  }

  /**
   * @param {unknown} value - Returned full snapshot.
   * @param {string} label - Boundary label.
   * @returns {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot}
   */
  function normalizeFullAuthority(value, label) {
    assertCoordinatorAuthorityToken(value, label);
    if (
      !(value && typeof value === 'object') ||
      !Object.prototype.hasOwnProperty.call(value, 'status')
    ) {
      throw new TypeError(`${label} must be a full authority snapshot.`);
    }
    return Object.freeze({
      .../** @type {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot} */ (
        value
      ),
    });
  }

  /**
   * @param {unknown} value - Returned full snapshot.
   * @param {string} label - Boundary label.
   * @returns {Readonly<{authority: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot, coordinatorAuthority: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken}>}
   */
  function normalizeOwnedAuthority(value, label) {
    const authority = normalizeFullAuthority(value, label);
    const coordinatorAuthority = assertCoordinatorAuthorityToken(
      authority,
      label,
    );
    if (
      coordinatorAuthority.appId !== appId ||
      coordinatorAuthority.coordinatorId !== coordinatorId ||
      authority.status !== CoordinatorAuthorityStatus.ACTIVE
    ) {
      throw new TypeError(
        `${label} must be this resident's ACTIVE full authority snapshot.`,
      );
    }
    return Object.freeze({
      authority,
      coordinatorAuthority,
    });
  }

  /** @returns {Promise<import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot | null>} */
  async function readCurrentAuthority() {
    const current = await protocol.get({ appId });
    return current === null
      ? null
      : normalizeFullAuthority(
          current,
          'resident coordinator current authority',
        );
  }

  /** @param {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot | null} current @param {Readonly<{requestId: string}>} intent */
  function isRetainedIntentAuthority(current, intent) {
    return Boolean(
      current?.status === CoordinatorAuthorityStatus.ACTIVE &&
      current.coordinatorId === coordinatorId &&
      current.acquisitionRequestId === intent.requestId,
    );
  }

  /**
   * Settle a transition whose response became opaque before cancellation. A
   * non-owned read cannot prove that the timed-out write will not commit later,
   * so this loop replays only the exact pre-cancellation intent. Receipt replay,
   * an exact-CAS conflict/stale result followed by a strong read, or a definite
   * transition response establishes ordering against the original in-flight
   * request. No fresh request identity is created and the handler never starts.
   * @param {Readonly<{requestId: string}>} intent - Retained acquisition intent.
   * @param {(intent: any) => Promise<any>} transition - Exact retained mutation closure.
   * @param {AbortSignal} signal - Already-aborted startup signal.
   * @param {string} label - Returned authority label.
   * @returns {Promise<ReturnType<typeof normalizeOwnedAuthority>>}
   */
  async function settleCancelledTransition(intent, transition, signal, label) {
    while (true) {
      /** @type {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot | null | undefined} */
      let before;
      try {
        before = await readCurrentAuthority();
      } catch (error) {
        if (error instanceof TypeError || isKnownAuthorityDomainError(error)) {
          throw error;
        }
      }
      if (before && isRetainedIntentAuthority(before, intent)) {
        return normalizeOwnedAuthority(
          before,
          'resident coordinator settled transition authority',
        );
      }

      let result;
      try {
        result = await transition(intent);
      } catch (error) {
        if (isAuthorityConflict(error) || isAuthorityStale(error)) {
          // The exact replay observed a serialized state that its retained CAS
          // cannot later replace. Confirm it did not expose this intent's owner
          // before treating cancellation as definitively settled.
          let afterConflict;
          try {
            afterConflict = await readCurrentAuthority();
          } catch (readError) {
            if (
              readError instanceof TypeError ||
              isKnownAuthorityDomainError(readError)
            ) {
              throw readError;
            }
            // eslint-disable-next-line no-await-in-loop -- Settlement persists through opaque provider reads.
            await waitForCompleteInterval(retryDelayMs, undefined);
            continue;
          }
          if (
            afterConflict &&
            isRetainedIntentAuthority(afterConflict, intent)
          ) {
            return normalizeOwnedAuthority(
              afterConflict,
              'resident coordinator settled transition authority',
            );
          }
          throwIfAborted(signal);
        }
        if (!isOpaqueTransitionError(error)) throw error;
        // eslint-disable-next-line no-await-in-loop -- Settlement exact-retries only the retained pre-cancellation intent.
        await waitForCompleteInterval(retryDelayMs, undefined);
        continue;
      }

      normalizeOwnedAuthority(result.authority, label);
      let after;
      try {
        after = await readCurrentAuthority();
      } catch (error) {
        if (error instanceof TypeError || isKnownAuthorityDomainError(error)) {
          throw error;
        }
        // A definite receipt with an unknown current read is replayed until a
        // strong read establishes whether cleanup still owns an ACTIVE record.
        // eslint-disable-next-line no-await-in-loop -- Settlement persists through opaque provider reads.
        await waitForCompleteInterval(retryDelayMs, undefined);
        continue;
      }
      if (after && isRetainedIntentAuthority(after, intent)) {
        return normalizeOwnedAuthority(
          after,
          'resident coordinator settled transition authority',
        );
      }
      // This exact transition returned definitively. A subsequent strong read
      // that is null, released, or owned by another acquisition proves there is
      // no ACTIVE orphan left for this retained intent.
      throwIfAborted(signal);
    }
  }

  /**
   * Apply or replay one retained acquisition/takeover intent and establish a
   * strong-read admission linearization point. Unknown current-state reads
   * cause the exact transition to be replayed while startup remains active.
   * Once cancelled, only this exact pre-cancellation intent may be replayed;
   * fresh acquisition/takeover identities are forbidden until settlement.
   * @param {Readonly<{requestId: string}>} intent - Exact retained intent.
   * @param {(intent: any) => Promise<any>} transition - Exact protocol mutation closure.
   * @param {AbortSignal} signal - Startup cancellation.
   * @param {string} label - Returned authority label.
   * @returns {Promise<Readonly<{outcome: 'owned', owned: ReturnType<typeof normalizeOwnedAuthority>}> | Readonly<{outcome: 'mismatch'}>>}
   */
  async function applyRetainedTransition(intent, transition, signal, label) {
    let mayOwn = false;
    while (true) {
      if (signal.aborted) {
        if (mayOwn) {
          return Object.freeze({
            outcome: 'owned',
            owned: await settleCancelledTransition(
              intent,
              transition,
              signal,
              label,
            ),
          });
        }
        throwIfAborted(signal);
      }

      let result;
      try {
        result = await transition(intent);
        mayOwn = true;
      } catch (error) {
        if (!isOpaqueTransitionError(error)) throw error;
        mayOwn = true;
        if (signal.aborted) continue;
        try {
          // eslint-disable-next-line no-await-in-loop -- Exact retained intent retry is deliberately serial.
          await waitForCompleteInterval(retryDelayMs, signal);
        } catch (waitError) {
          if (signal.aborted) continue;
          throw waitError;
        }
        continue;
      }

      const candidate = normalizeOwnedAuthority(result.authority, label);
      let current;
      try {
        current = await readCurrentAuthority();
      } catch (error) {
        if (error instanceof TypeError || isKnownAuthorityDomainError(error)) {
          throw error;
        }
        // The transition result alone is not an admission point. Replay its
        // exact intent after a bounded delay unless cancellation has switched
        // this lifecycle into exact-intent settlement.
        if (signal.aborted) continue;
        try {
          // eslint-disable-next-line no-await-in-loop -- Exact retained intent retry is deliberately serial.
          await waitForCompleteInterval(retryDelayMs, signal);
        } catch (waitError) {
          if (signal.aborted) continue;
          throw waitError;
        }
        continue;
      }
      if (current && sameAuthoritySnapshot(current, candidate.authority)) {
        return Object.freeze({ outcome: 'owned', owned: candidate });
      }
      mayOwn = false;
      throwIfAborted(signal);
      return Object.freeze({ outcome: 'mismatch' });
    }
  }

  /**
   * @param {AbortSignal} signal - Startup cancellation.
   * @returns {Promise<ReturnType<typeof normalizeOwnedAuthority>>}
   */
  async function acquireOrTakeover(signal) {
    const createAcquireIntent = () =>
      Object.freeze({
        appId,
        coordinatorId,
        requestId: nextRequestId('acquire'),
        observedAt: readObservedAt(),
      });
    let acquireIntent = createAcquireIntent();
    while (true) {
      throwIfAborted(signal);
      try {
        const acquired = await applyRetainedTransition(
          acquireIntent,
          async (intent) => await protocol.acquire(intent),
          signal,
          'resident coordinator acquired authority',
        );
        if (acquired.outcome === 'owned') return acquired.owned;
        // A historical receipt is read-only evidence. Rotate the identity so
        // subsequent acquisition can only describe a new transition.
        acquireIntent = createAcquireIntent();
        continue;
      } catch (error) {
        throwIfAborted(signal);
        if (isRequestConflict(error)) throw error;
        if (!isAuthorityConflict(error)) throw error;
      }

      const observed = await protocol.observeReplacement({ appId, signal });
      throwIfAborted(signal);
      if (observed.outcome === 'inactive' || observed.outcome === 'changed') {
        continue;
      }
      if (observed.outcome !== 'stable') {
        throw new TypeError(
          'Resident coordinator observation returned an unsupported outcome.',
        );
      }
      const takeoverIntent = Object.freeze({
        coordinatorId,
        requestId: nextRequestId('takeover'),
        observedAt: readObservedAt(),
      });
      throwIfAborted(signal);
      try {
        const taken = await applyRetainedTransition(
          takeoverIntent,
          async (intent) => await observed.takeover(intent),
          signal,
          'resident coordinator takeover authority',
        );
        if (taken.outcome === 'owned') return taken.owned;
      } catch (error) {
        throwIfAborted(signal);
        if (!isAuthorityConflict(error) && !isAuthorityStale(error)) {
          throw error;
        }
      }
      // The stable predecessor changed or a historical takeover receipt was
      // observed. Neither authorizes reuse of the old acquisition identity.
      acquireIntent = createAcquireIntent();
    }
  }

  /**
   * Release with one immutable receipt-backed intent. Opaque failures can be
   * exact-retried safely; known domain failures are terminal, while stale
   * means a successor already completed relinquishment for this owner.
   * @param {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot} authority - Latest full owner snapshot.
   */
  async function releaseOwnedAuthority(authority) {
    const intent = Object.freeze({
      authority,
      requestId: nextRequestId('release'),
      observedAt: readObservedAt(),
    });
    // Cleanup retries are intentionally unbounded. Returning after an opaque
    // result could abandon an ACTIVE owner; the monotonic bounded backoff keeps
    // persistence from becoming a provider-failure busy loop.
    while (true) {
      try {
        await protocol.release(intent);
        return;
      } catch (error) {
        if (isAuthorityStale(error)) return;
        if (error instanceof TypeError || isKnownAuthorityDomainError(error)) {
          throw error;
        }
        // eslint-disable-next-line no-await-in-loop -- Release receipts make this exact cleanup retry safe.
        await waitForCompleteInterval(retryDelayMs, undefined);
      }
    }
  }

  /**
   * @template T
   * @param {{signal?: AbortSignal, handler: (context: ResidentCoordinatorAuthorityHandlerContext) => Promise<T> | T}} input - One resident lifecycle.
   * @returns {Promise<T>} - Handler result after drain and exact release.
   */
  async function run(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Resident coordinator authority run requires input.');
    }
    const allowed = new Set(['signal', 'handler']);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
      throw new TypeError(
        'Resident coordinator authority run requires only a handler and optional signal.',
      );
    }
    const inputSnapshot = snapshotOwnFields(input, allowed);
    const handler = inputSnapshot.handler;
    if (typeof handler !== 'function') {
      throw new TypeError(
        'Resident coordinator authority run requires only a handler and optional signal.',
      );
    }
    if (running) {
      throw new Error(
        'Resident coordinator authority supervisor is already running.',
      );
    }
    const externalSignal =
      inputSnapshot.signal === undefined
        ? undefined
        : normalizeAbortSignal(
            inputSnapshot.signal,
            'Resident coordinator authority run signal',
          );
    running = true;
    const sessionAbort = new AbortController();
    const renewalStop = new AbortController();
    const forwardExternalAbort = () => {
      if (!sessionAbort.signal.aborted) {
        sessionAbort.abort(externalSignal?.reason);
      }
    };
    externalSignal?.addEventListener('abort', forwardExternalAbort, {
      once: true,
    });
    if (externalSignal?.aborted) forwardExternalAbort();

    /** @type {ReturnType<typeof normalizeOwnedAuthority> | undefined} */
    let owned;
    /** @type {import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot | undefined} */
    let latestAuthority;
    /** @type {unknown} */
    let handlerResult;
    /** @type {unknown} */
    let handlerError;
    /** @type {ResidentCoordinatorAuthorityLostError | undefined} */
    let renewalFailure;
    /** @type {unknown} */
    let releaseError;
    /** @type {Promise<void> | undefined} */
    let renewalDone;

    try {
      owned = await acquireOrTakeover(sessionAbort.signal);
      latestAuthority = owned.authority;
      throwIfAborted(sessionAbort.signal);

      renewalDone = (async () => {
        try {
          while (!renewalStop.signal.aborted) {
            await waitForCompleteInterval(
              nextRenewalDelay(),
              renewalStop.signal,
            );
            if (renewalStop.signal.aborted) return;
            const intent = Object.freeze({
              observedAuthority: latestAuthority,
              requestId: nextRequestId('renew'),
              observedAt: readObservedAt(),
            });
            let renewed;
            for (
              let attempt = 0;
              attempt <= RENEWAL_UNKNOWN_RETRIES;
              attempt += 1
            ) {
              try {
                // eslint-disable-next-line no-await-in-loop -- Unknown renewal must retry this exact retained tuple serially.
                renewed = await protocol.renew(intent);
                break;
              } catch (error) {
                if (
                  !isRenewalUnknown(error) ||
                  attempt === RENEWAL_UNKNOWN_RETRIES
                ) {
                  throw new ResidentCoordinatorAuthorityLostError(
                    appId,
                    'renewal',
                    { requestId: intent.requestId, cause: error },
                  );
                }
                // eslint-disable-next-line no-await-in-loop -- The sole exact retry is intentionally ordered after its backoff.
                await waitForCompleteInterval(retryDelayMs, renewalStop.signal);
              }
            }
            if (!renewed) {
              throw new ResidentCoordinatorAuthorityLostError(
                appId,
                'renewal',
                { requestId: intent.requestId },
              );
            }
            const normalized = normalizeOwnedAuthority(
              renewed.authority,
              'resident coordinator renewed authority',
            );
            if (
              JSON.stringify(normalized.coordinatorAuthority) !==
                JSON.stringify(owned.coordinatorAuthority) ||
              normalized.authority.recordVersion <=
                latestAuthority.recordVersion
            ) {
              throw new ResidentCoordinatorAuthorityLostError(
                appId,
                'renewal',
                {
                  requestId: intent.requestId,
                  cause: new TypeError(
                    'Renewal did not advance the exact stable authority snapshot.',
                  ),
                },
              );
            }
            latestAuthority = normalized.authority;
          }
        } catch (error) {
          if (renewalStop.signal.aborted) return;
          renewalFailure =
            error instanceof ResidentCoordinatorAuthorityLostError
              ? error
              : new ResidentCoordinatorAuthorityLostError(appId, 'renewal', {
                  cause: error,
                });
          if (!sessionAbort.signal.aborted) {
            sessionAbort.abort(renewalFailure);
          }
        }
      })();

      try {
        handlerResult = await handler(
          Object.freeze({
            authority: owned.authority,
            coordinatorAuthority: owned.coordinatorAuthority,
            signal: sessionAbort.signal,
          }),
        );
      } catch (error) {
        handlerError = error;
      }
    } catch (error) {
      handlerError = error;
    } finally {
      if (!renewalStop.signal.aborted) {
        renewalStop.abort(RENEWAL_STOP_REASON);
      }
      await renewalDone;
      if (latestAuthority) {
        try {
          await releaseOwnedAuthority(latestAuthority);
        } catch (error) {
          releaseError = error;
        }
      }
      externalSignal?.removeEventListener('abort', forwardExternalAbort);
      running = false;
    }

    const errors = [renewalFailure, handlerError, releaseError].filter(
      (error, index, values) =>
        error !== undefined && values.indexOf(error) === index,
    );
    // A cooperative handler commonly rejects with the authority-loss reason;
    // report the typed loss once rather than wrapping the same event twice.
    const distinctErrors = errors.filter(
      (error, index) =>
        !(
          index > 0 &&
          renewalFailure &&
          (error === renewalFailure || error === sessionAbort.signal.reason)
        ),
    );
    if (distinctErrors.length > 1) {
      throw new AggregateError(
        distinctErrors,
        'Resident coordinator handler, authority renewal, or release failed.',
      );
    }
    if (distinctErrors.length === 1) throw distinctErrors[0];
    return /** @type {T} */ (handlerResult);
  }

  return Object.freeze({ run });
}

export default createResidentCoordinatorAuthoritySupervisor;
