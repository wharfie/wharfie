import { createCanonicalJsonSha256Id } from '../../runtime/content-id.js';

/**
 * The append-only execution ledger keeps one run in one database partition.
 * Dynamic identities are encoded into typed collision-safe sort keys so a
 * caller-controlled delimiter can never make two records alias. Single
 * segments use base64url; composite effect identity uses a domain-separated
 * digest to stay within the portable DynamoDB sort-key ceiling.
 */

// Ledger v5 is intentionally a fresh namespace. It adds persisted managed
// effects to v4's cancellation-capable manual state machine, so sharing
// physical keys would let an older reader ignore effect truth while accepting
// a terminal attempt from the same history.
export const EXECUTION_LEDGER_SORT_KEY_PREFIX = 'ledger/v5/';
export const EXECUTION_LEDGER_EVENT_SEQUENCE_WIDTH = 16;
export const MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES = 512;

/**
 * @param {unknown} value - Candidate opaque durable identity.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {string} - Validated opaque identity.
 */
export function assertLedgerOpaqueId(value, label = 'ledger identity') {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  const isWellFormed = /** @type {any} */ (String.prototype).isWellFormed;
  const wellFormed =
    typeof isWellFormed === 'function'
      ? isWellFormed.call(value)
      : Buffer.from(value, 'utf8').toString('utf8') === value;
  if (!wellFormed) {
    throw new TypeError(`${label} must be well-formed Unicode.`);
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES) {
    throw new RangeError(
      `${label} must not exceed ${MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES} UTF-8 bytes.`,
    );
  }
  return value;
}

/**
 * @param {string} value - Opaque durable identity.
 * @param {string} label - Human-readable boundary label.
 * @returns {string} - Base64url storage segment.
 */
export function encodeLedgerKeySegment(value, label = 'ledger identity') {
  return Buffer.from(assertLedgerOpaqueId(value, label), 'utf8').toString(
    'base64url',
  );
}

/**
 * @param {number} sequence - Positive ledger sequence.
 * @returns {string} - Fixed-width lexical sequence representation.
 */
export function encodeLedgerSequence(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError('ledger sequence must be a positive safe integer.');
  }
  const encoded = String(sequence);
  if (encoded.length > EXECUTION_LEDGER_EVENT_SEQUENCE_WIDTH) {
    throw new RangeError('ledger sequence exceeds its storage representation.');
  }
  return encoded.padStart(EXECUTION_LEDGER_EVENT_SEQUENCE_WIDTH, '0');
}

/** @returns {string} - Run-head sort key. */
export function getRunHeadSortKey() {
  return `${EXECUTION_LEDGER_SORT_KEY_PREFIX}head`;
}

/** @returns {string} - Run-projection sort key. */
export function getRunProjectionSortKey() {
  return `${EXECUTION_LEDGER_SORT_KEY_PREFIX}projection/run`;
}

/**
 * @param {number} sequence - Event sequence.
 * @returns {string} - Event sort key.
 */
export function getEventSortKey(sequence) {
  return `${EXECUTION_LEDGER_SORT_KEY_PREFIX}event/${encodeLedgerSequence(sequence)}`;
}

/**
 * @param {string} invocationId - Opaque invocation identity.
 * @returns {string} - Invocation-projection sort key.
 */
export function getInvocationProjectionSortKey(invocationId) {
  return `${EXECUTION_LEDGER_SORT_KEY_PREFIX}projection/invocation/${encodeLedgerKeySegment(
    invocationId,
    'invocationId',
  )}`;
}

/**
 * @param {string} attemptId - Opaque attempt identity.
 * @returns {string} - Attempt-projection sort key.
 */
export function getAttemptProjectionSortKey(attemptId) {
  return `${EXECUTION_LEDGER_SORT_KEY_PREFIX}projection/attempt/${encodeLedgerKeySegment(
    attemptId,
    'attemptId',
  )}`;
}

/**
 * Effect IDs are stable only within one logical invocation. Hash the validated
 * tuple so caller-controlled delimiters cannot alias two projections and two
 * maximum-size IDs still fit DynamoDB's portable 1,024-byte sort-key limit.
 * @param {string} invocationId - Opaque invocation identity.
 * @param {string} effectId - Opaque logical effect identity.
 * @returns {string} - Effect-projection sort key.
 */
export function getEffectProjectionSortKey(invocationId, effectId) {
  const normalizedInvocationId = assertLedgerOpaqueId(
    invocationId,
    'invocationId',
  );
  const normalizedEffectId = assertLedgerOpaqueId(effectId, 'effectId');
  const tupleId = createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-effect-projection-key:v5',
    prefix: 'wfk',
    value: {
      invocationId: normalizedInvocationId,
      effectId: normalizedEffectId,
    },
    valuePath: 'execution ledger effect projection identity',
  });
  return `${EXECUTION_LEDGER_SORT_KEY_PREFIX}projection/effect/${tupleId}`;
}

/**
 * @param {string} transitionId - Opaque caller transition identity.
 * @returns {string} - Transition-receipt sort key.
 */
export function getTransitionSortKey(transitionId) {
  return `${EXECUTION_LEDGER_SORT_KEY_PREFIX}transition/${encodeLedgerKeySegment(
    transitionId,
    'transitionId',
  )}`;
}

export default {
  EXECUTION_LEDGER_EVENT_SEQUENCE_WIDTH,
  EXECUTION_LEDGER_SORT_KEY_PREFIX,
  MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES,
  assertLedgerOpaqueId,
  encodeLedgerKeySegment,
  encodeLedgerSequence,
  getAttemptProjectionSortKey,
  getEffectProjectionSortKey,
  getEventSortKey,
  getInvocationProjectionSortKey,
  getRunHeadSortKey,
  getRunProjectionSortKey,
  getTransitionSortKey,
};
