/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { assertApplicationRevisionId } from './application-revision.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const ACTIVITY_PROTOCOL_NAME = 'wharfie.activity';
export const ACTIVITY_PROTOCOL_VERSION = 1;
export const ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES = 1024 * 1024;
export const ACTIVITY_PROTOCOL_MAX_OPAQUE_ID_BYTES = 512;

export const ACTIVITY_PROTOCOL_HOST_FRAME_TYPES = Object.freeze([
  'start',
  'cancel',
  'effect-result',
]);
export const ACTIVITY_PROTOCOL_COMPONENT_FRAME_TYPES = Object.freeze([
  'log',
  'effect-request',
  'completed',
  'failed',
  'cancelled',
  'deadline-exceeded',
  'protocol-failed',
]);
export const ACTIVITY_PROTOCOL_TERMINAL_TYPES = Object.freeze([
  'completed',
  'failed',
  'cancelled',
  'deadline-exceeded',
  'protocol-failed',
]);
export const ACTIVITY_PROTOCOL_LOG_LEVELS = Object.freeze([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
]);
export const ACTIVITY_PROTOCOL_REPLAY_PROPERTIES = Object.freeze([
  'pure',
  'idempotent',
  'transactional',
  'unsafe',
]);

const HOST_FRAME_TYPES = new Set(ACTIVITY_PROTOCOL_HOST_FRAME_TYPES);
const COMPONENT_FRAME_TYPES = new Set(ACTIVITY_PROTOCOL_COMPONENT_FRAME_TYPES);
const TERMINAL_TYPES = new Set(ACTIVITY_PROTOCOL_TERMINAL_TYPES);
const LOG_LEVELS = new Set(ACTIVITY_PROTOCOL_LOG_LEVELS);
const REPLAY_PROPERTIES = new Set(ACTIVITY_PROTOCOL_REPLAY_PROPERTIES);
const REPLAY_PROPERTY_ORDER = new Map(
  ACTIVITY_PROTOCOL_REPLAY_PROPERTIES.map((property, index) => [
    property,
    index,
  ]),
);
const UTF8_ENCODER = new TextEncoder();

const COMMON_KEYS = ['protocol', 'protocolVersion', 'type'];
const START_KEYS = new Set([
  ...COMMON_KEYS,
  'revisionId',
  'activityId',
  'runId',
  'invocationId',
  'attemptId',
  'fencingToken',
  'input',
  'caller',
  'deadlineUnixMs',
]);
const START_REQUIRED_KEYS = new Set(
  [...START_KEYS].filter((key) => key !== 'deadlineUnixMs'),
);
const CANCEL_KEYS = new Set([...COMMON_KEYS, 'attemptId', 'reason']);
const EFFECT_RESULT_SUCCESS_KEYS = new Set([
  ...COMMON_KEYS,
  'attemptId',
  'effectId',
  'ok',
  'result',
  'substantiatedReplayProperties',
  'evidence',
]);
const EFFECT_RESULT_FAILURE_KEYS = new Set([
  ...COMMON_KEYS,
  'attemptId',
  'effectId',
  'ok',
  'error',
  'substantiatedReplayProperties',
  'evidence',
]);
const LOG_KEYS = new Set([
  ...COMMON_KEYS,
  'attemptId',
  'sequence',
  'level',
  'message',
  'fields',
]);
const EFFECT_REQUEST_KEYS = new Set([
  ...COMMON_KEYS,
  'attemptId',
  'sequence',
  'effectId',
  'capability',
  'operation',
  'input',
  'requestedReplayProperties',
]);
const COMPLETED_KEYS = new Set([
  ...COMMON_KEYS,
  'attemptId',
  'sequence',
  'result',
]);
const ERROR_TERMINAL_KEYS = new Set([
  ...COMMON_KEYS,
  'attemptId',
  'sequence',
  'error',
]);
const CALLER_KEYS = new Set(['metadata']);
const ERROR_KEYS = new Set(['code', 'name', 'message', 'details']);

/**
 * @typedef {'start'|'cancel'|'effect-result'} ActivityProtocolHostFrameType
 * @typedef {'log'|'effect-request'|'completed'|'failed'|'cancelled'|'deadline-exceeded'|'protocol-failed'} ActivityProtocolComponentFrameType
 * @typedef {ActivityProtocolHostFrameType|ActivityProtocolComponentFrameType} ActivityProtocolFrameType
 * @typedef {Record<string, any>} ActivityProtocolFrame
 */

/**
 * @param {unknown} value - Candidate plain object.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {asserts value is Record<string, any>}
 */
function assertPlainObject(value, valuePath) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${valuePath} must be a JSON object.`);
  }
}

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowed - Exact allowed property names.
 * @param {Set<string>} required - Required property names.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertExactKeys(value, allowed, required, valuePath) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate opaque identity.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {asserts value is string}
 */
function assertOpaqueId(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    UTF8_ENCODER.encode(value).byteLength >
      ACTIVITY_PROTOCOL_MAX_OPAQUE_ID_BYTES
  ) {
    throw new TypeError(`${valuePath} must be a nonempty opaque string.`);
  }
}

/**
 * @param {unknown} value - Candidate ordinary string.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {asserts value is string}
 */
function assertString(value, valuePath) {
  if (typeof value !== 'string') {
    throw new TypeError(`${valuePath} must be a string.`);
  }
}

/**
 * @param {unknown} value - Candidate positive sequence number.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {asserts value is number}
 */
function assertSequence(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${valuePath} must be a positive safe integer.`);
  }
}

/**
 * Reject the one JavaScript number whose value is not preserved by the
 * platform JSON encoder. The remaining cloneJsonObject checks already reject
 * non-finite numbers, undefined, bigint, symbols, functions, sparse arrays,
 * accessors, cycles, and non-plain objects.
 * @param {any} value - Cloned JSON value.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertTransportJson(value, valuePath) {
  if (typeof value === 'number' && Object.is(value, -0)) {
    throw new TypeError(
      `${valuePath} must not contain negative zero because JSON transport normalizes it to zero.`,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertTransportJson(item, `${valuePath}[${index}]`),
    );
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertTransportJson(child, `${valuePath}.${key}`);
    }
  }
}

/**
 * @param {Record<string, any>} frame - Strict JSON frame.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function assertEncodedFrameSize(frame, valuePath) {
  const encodedBytes = UTF8_ENCODER.encode(JSON.stringify(frame)).byteLength;
  if (encodedBytes > ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES) {
    throw new RangeError(
      `${valuePath} encoded JSON size must not exceed ${ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES} bytes; received ${encodedBytes}.`,
    );
  }
}

/**
 * @param {any} value - JSON value to freeze.
 * @returns {any} - The same deeply frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value - Candidate structured protocol error.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function validateStructuredError(value, valuePath) {
  assertPlainObject(value, valuePath);
  assertExactKeys(value, ERROR_KEYS, ERROR_KEYS, valuePath);
  assertLogicalId(value.code, `${valuePath}.code`);
  assertOpaqueId(value.name, `${valuePath}.name`);
  assertString(value.message, `${valuePath}.message`);
  assertPlainObject(value.details, `${valuePath}.details`);
}

/**
 * Validate a canonical nonempty replay-property set. Safe properties can
 * compose, while unsafe explicitly means no supported replay guarantee.
 * @param {unknown} value - Candidate replay-property set.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function validateReplayProperties(value, valuePath) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${valuePath} must be a nonempty array.`);
  }

  let previousOrder = -1;
  for (const [index, property] of value.entries()) {
    if (typeof property !== 'string' || !REPLAY_PROPERTIES.has(property)) {
      throw new TypeError(
        `${valuePath}[${index}] is not a supported replay property.`,
      );
    }
    const order = /** @type {number} */ (REPLAY_PROPERTY_ORDER.get(property));
    if (order <= previousOrder) {
      throw new TypeError(
        `${valuePath} must be unique and in canonical replay-property order.`,
      );
    }
    previousOrder = order;
  }

  if (value.includes('unsafe') && value.length !== 1) {
    throw new TypeError(
      `${valuePath} cannot combine unsafe with a supported replay guarantee.`,
    );
  }
}

/**
 * @param {Record<string, any>} frame - Frame whose common fields are validated.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function validateCommonFields(frame, valuePath) {
  if (frame.protocol !== ACTIVITY_PROTOCOL_NAME) {
    throw new TypeError(
      `${valuePath}.protocol must be '${ACTIVITY_PROTOCOL_NAME}'.`,
    );
  }
  if (frame.protocolVersion !== ACTIVITY_PROTOCOL_VERSION) {
    throw new TypeError(
      `${valuePath}.protocolVersion must be the integer ${ACTIVITY_PROTOCOL_VERSION}.`,
    );
  }
  if (
    typeof frame.type !== 'string' ||
    (!HOST_FRAME_TYPES.has(frame.type) &&
      !COMPONENT_FRAME_TYPES.has(frame.type))
  ) {
    throw new TypeError(`${valuePath}.type is not a supported frame type.`);
  }
}

/**
 * @param {Record<string, any>} frame - Start frame.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function validateStartFrame(frame, valuePath) {
  assertExactKeys(frame, START_KEYS, START_REQUIRED_KEYS, valuePath);
  assertApplicationRevisionId(frame.revisionId, `${valuePath}.revisionId`);
  assertLogicalId(frame.activityId, `${valuePath}.activityId`);
  assertOpaqueId(frame.runId, `${valuePath}.runId`);
  assertOpaqueId(frame.invocationId, `${valuePath}.invocationId`);
  assertOpaqueId(frame.attemptId, `${valuePath}.attemptId`);
  assertOpaqueId(frame.fencingToken, `${valuePath}.fencingToken`);
  assertPlainObject(frame.caller, `${valuePath}.caller`);
  assertExactKeys(
    frame.caller,
    CALLER_KEYS,
    CALLER_KEYS,
    `${valuePath}.caller`,
  );
  assertPlainObject(frame.caller.metadata, `${valuePath}.caller.metadata`);
  if (
    Object.prototype.hasOwnProperty.call(frame, 'deadlineUnixMs') &&
    (!Number.isSafeInteger(frame.deadlineUnixMs) || frame.deadlineUnixMs <= 0)
  ) {
    throw new TypeError(
      `${valuePath}.deadlineUnixMs must be a positive safe integer when provided.`,
    );
  }
}

/**
 * @param {Record<string, any>} frame - Cancel frame.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function validateCancelFrame(frame, valuePath) {
  assertExactKeys(frame, CANCEL_KEYS, CANCEL_KEYS, valuePath);
  assertOpaqueId(frame.attemptId, `${valuePath}.attemptId`);
  validateStructuredError(frame.reason, `${valuePath}.reason`);
}

/**
 * @param {Record<string, any>} frame - Effect-result frame.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function validateEffectResultFrame(frame, valuePath) {
  if (frame.ok === true) {
    assertExactKeys(
      frame,
      EFFECT_RESULT_SUCCESS_KEYS,
      EFFECT_RESULT_SUCCESS_KEYS,
      valuePath,
    );
  } else if (frame.ok === false) {
    assertExactKeys(
      frame,
      EFFECT_RESULT_FAILURE_KEYS,
      EFFECT_RESULT_FAILURE_KEYS,
      valuePath,
    );
    validateStructuredError(frame.error, `${valuePath}.error`);
  } else {
    throw new TypeError(`${valuePath}.ok must be a boolean.`);
  }
  assertOpaqueId(frame.attemptId, `${valuePath}.attemptId`);
  assertOpaqueId(frame.effectId, `${valuePath}.effectId`);
  validateReplayProperties(
    frame.substantiatedReplayProperties,
    `${valuePath}.substantiatedReplayProperties`,
  );
  assertPlainObject(frame.evidence, `${valuePath}.evidence`);
}

/**
 * @param {Record<string, any>} frame - Log frame.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function validateLogFrame(frame, valuePath) {
  assertExactKeys(frame, LOG_KEYS, LOG_KEYS, valuePath);
  assertOpaqueId(frame.attemptId, `${valuePath}.attemptId`);
  assertSequence(frame.sequence, `${valuePath}.sequence`);
  if (typeof frame.level !== 'string' || !LOG_LEVELS.has(frame.level)) {
    throw new TypeError(`${valuePath}.level is not a supported log level.`);
  }
  assertString(frame.message, `${valuePath}.message`);
  assertPlainObject(frame.fields, `${valuePath}.fields`);
}

/**
 * @param {Record<string, any>} frame - Effect request frame.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function validateEffectRequestFrame(frame, valuePath) {
  assertExactKeys(frame, EFFECT_REQUEST_KEYS, EFFECT_REQUEST_KEYS, valuePath);
  assertOpaqueId(frame.attemptId, `${valuePath}.attemptId`);
  assertSequence(frame.sequence, `${valuePath}.sequence`);
  assertOpaqueId(frame.effectId, `${valuePath}.effectId`);
  assertLogicalId(frame.capability, `${valuePath}.capability`);
  assertLogicalId(frame.operation, `${valuePath}.operation`);
  validateReplayProperties(
    frame.requestedReplayProperties,
    `${valuePath}.requestedReplayProperties`,
  );
}

/**
 * @param {Record<string, any>} frame - Terminal frame.
 * @param {string} valuePath - Human-readable schema path.
 * @returns {void}
 */
function validateTerminalFrame(frame, valuePath) {
  if (frame.type === 'completed') {
    assertExactKeys(frame, COMPLETED_KEYS, COMPLETED_KEYS, valuePath);
  } else {
    assertExactKeys(frame, ERROR_TERMINAL_KEYS, ERROR_TERMINAL_KEYS, valuePath);
    validateStructuredError(frame.error, `${valuePath}.error`);
  }
  assertOpaqueId(frame.attemptId, `${valuePath}.attemptId`);
  assertSequence(frame.sequence, `${valuePath}.sequence`);
}

/**
 * Validate and independently clone one Activity Protocol v1 frame. The result
 * is deeply frozen so later caller mutation cannot change accepted protocol
 * evidence.
 * @param {unknown} value - Candidate frame.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {Readonly<ActivityProtocolFrame>} - Validated immutable clone.
 */
export function validateActivityProtocolFrame(value, valuePath = 'frame') {
  const frame = cloneJsonObject(value, valuePath);
  assertTransportJson(frame, valuePath);
  assertEncodedFrameSize(frame, valuePath);
  validateCommonFields(frame, valuePath);

  switch (frame.type) {
    case 'start':
      validateStartFrame(frame, valuePath);
      break;
    case 'cancel':
      validateCancelFrame(frame, valuePath);
      break;
    case 'effect-result':
      validateEffectResultFrame(frame, valuePath);
      break;
    case 'log':
      validateLogFrame(frame, valuePath);
      break;
    case 'effect-request':
      validateEffectRequestFrame(frame, valuePath);
      break;
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'deadline-exceeded':
    case 'protocol-failed':
      validateTerminalFrame(frame, valuePath);
      break;
    default:
      throw new TypeError(`${valuePath}.type is not a supported frame type.`);
  }

  return deepFreeze(frame);
}

/**
 * Clone and validate a frame without retaining any caller-owned reference.
 * This explicit alias is useful at transport adapters where cloning is the
 * named boundary operation.
 * @param {unknown} value - Candidate frame.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {Readonly<ActivityProtocolFrame>} - Validated immutable clone.
 */
export function cloneActivityProtocolFrame(value, valuePath = 'frame') {
  return validateActivityProtocolFrame(value, valuePath);
}

/**
 * @param {unknown} value - Candidate host-to-component frame.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {Readonly<ActivityProtocolFrame>} - Validated host frame.
 */
export function validateActivityProtocolHostFrame(
  value,
  valuePath = 'hostFrame',
) {
  const frame = validateActivityProtocolFrame(value, valuePath);
  if (!HOST_FRAME_TYPES.has(frame.type)) {
    throw new TypeError(`${valuePath}.type is not a host frame type.`);
  }
  return frame;
}

/**
 * @param {unknown} value - Candidate component-to-host frame.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {Readonly<ActivityProtocolFrame>} - Validated component frame.
 */
export function validateActivityProtocolComponentFrame(
  value,
  valuePath = 'componentFrame',
) {
  const frame = validateActivityProtocolFrame(value, valuePath);
  if (!COMPONENT_FRAME_TYPES.has(frame.type)) {
    throw new TypeError(`${valuePath}.type is not a component frame type.`);
  }
  return frame;
}

/**
 * Stateful validator for one physical activity-attempt transcript. It verifies
 * transport ordering and correlation only; it deliberately does not schedule,
 * persist, retry, lease, or execute work.
 */
export class ActivityProtocolTranscriptValidator {
  constructor() {
    this._started = false;
    this._attemptId = /** @type {string | null} */ (null);
    this._deadlineUnixMs = /** @type {number | null} */ (null);
    this._nextComponentSequence = 1;
    this._cancelRequested = false;
    this._terminalType =
      /** @type {ActivityProtocolComponentFrameType | null} */ (null);
    /** @type {Map<string, readonly string[]>} */
    this._pendingEffects = new Map();
    this._seenEffectIds = new Set();
  }

  /**
   * @param {Readonly<ActivityProtocolFrame>} frame - Validated non-start frame.
   * @param {string} valuePath - Human-readable schema path.
   * @returns {void}
   */
  _assertActiveAttempt(frame, valuePath) {
    if (!this._started) {
      throw new Error(`${valuePath} cannot be accepted before a start frame.`);
    }
    if (this._terminalType) {
      throw new Error(
        `${valuePath} cannot be accepted after terminal '${this._terminalType}'.`,
      );
    }
    if (frame.attemptId !== this._attemptId) {
      throw new Error(
        `${valuePath}.attemptId does not match the started attempt.`,
      );
    }
  }

  /**
   * Accept one host-to-component frame.
   * @param {unknown} value - Candidate frame.
   * @returns {Readonly<ActivityProtocolFrame>} - Accepted immutable frame.
   */
  acceptHostFrame(value) {
    const frame = validateActivityProtocolHostFrame(value);

    if (frame.type === 'start') {
      if (this._started) {
        throw new Error('A transcript accepts exactly one start frame.');
      }
      this._started = true;
      this._attemptId = frame.attemptId;
      this._deadlineUnixMs = Object.prototype.hasOwnProperty.call(
        frame,
        'deadlineUnixMs',
      )
        ? frame.deadlineUnixMs
        : null;
      return frame;
    }

    this._assertActiveAttempt(frame, 'hostFrame');
    if (frame.type === 'cancel') {
      if (this._cancelRequested) {
        throw new Error('A transcript accepts at most one cancel frame.');
      }
      this._cancelRequested = true;
      return frame;
    }

    const requestedReplayProperties = this._pendingEffects.get(frame.effectId);
    if (!requestedReplayProperties) {
      throw new Error(
        `hostFrame.effectId '${frame.effectId}' does not correlate to a pending effect request.`,
      );
    }
    if (frame.ok === true && !requestedReplayProperties.includes('unsafe')) {
      const substantiated = new Set(frame.substantiatedReplayProperties);
      const missing = requestedReplayProperties.filter(
        (property) => !substantiated.has(property),
      );
      if (missing.length > 0) {
        throw new Error(
          `hostFrame.substantiatedReplayProperties does not satisfy requested replay properties: ${missing.join(', ')}.`,
        );
      }
    }
    this._pendingEffects.delete(frame.effectId);
    return frame;
  }

  /**
   * Accept one component-to-host frame.
   * @param {unknown} value - Candidate frame.
   * @returns {Readonly<ActivityProtocolFrame>} - Accepted immutable frame.
   */
  acceptComponentFrame(value) {
    const frame = validateActivityProtocolComponentFrame(value);
    if (this._terminalType && TERMINAL_TYPES.has(frame.type)) {
      throw new Error(
        `Duplicate terminal '${frame.type}' follows terminal '${this._terminalType}'.`,
      );
    }
    this._assertActiveAttempt(frame, 'componentFrame');
    if (frame.sequence !== this._nextComponentSequence) {
      throw new Error(
        `componentFrame.sequence must be ${this._nextComponentSequence}; received ${String(frame.sequence)}.`,
      );
    }

    if (frame.type === 'effect-request') {
      if (this._cancelRequested) {
        throw new Error(
          'A component cannot request a new effect after cancellation.',
        );
      }
      if (this._seenEffectIds.has(frame.effectId)) {
        throw new Error(
          `componentFrame.effectId '${frame.effectId}' was already used in this attempt.`,
        );
      }
      this._seenEffectIds.add(frame.effectId);
      this._pendingEffects.set(frame.effectId, frame.requestedReplayProperties);
    } else if (frame.type === 'completed') {
      if (this._pendingEffects.size > 0) {
        throw new Error(
          'A completed terminal cannot leave pending effect requests.',
        );
      }
    } else if (frame.type === 'cancelled' && !this._cancelRequested) {
      throw new Error(
        'A cancelled terminal requires a preceding host cancel frame.',
      );
    } else if (
      frame.type === 'deadline-exceeded' &&
      this._deadlineUnixMs === null
    ) {
      throw new Error(
        'A deadline-exceeded terminal requires a deadline on the start frame.',
      );
    }

    this._nextComponentSequence += 1;
    if (TERMINAL_TYPES.has(frame.type)) {
      this._terminalType = /** @type {ActivityProtocolComponentFrameType} */ (
        frame.type
      );
      this._pendingEffects.clear();
    }
    return frame;
  }

  /**
   * Return a small immutable summary without exposing mutable validator state.
   * @returns {Readonly<{started: boolean, attemptId: string|null, nextComponentSequence: number, cancelRequested: boolean, pendingEffectIds: string[], terminalType: ActivityProtocolComponentFrameType|null}>} - Transcript state.
   */
  snapshot() {
    return deepFreeze({
      started: this._started,
      attemptId: this._attemptId,
      nextComponentSequence: this._nextComponentSequence,
      cancelRequested: this._cancelRequested,
      pendingEffectIds: [...this._pendingEffects.keys()].sort(),
      terminalType: this._terminalType,
    });
  }
}

export default {
  ACTIVITY_PROTOCOL_COMPONENT_FRAME_TYPES,
  ACTIVITY_PROTOCOL_HOST_FRAME_TYPES,
  ACTIVITY_PROTOCOL_LOG_LEVELS,
  ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES,
  ACTIVITY_PROTOCOL_MAX_OPAQUE_ID_BYTES,
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_REPLAY_PROPERTIES,
  ACTIVITY_PROTOCOL_TERMINAL_TYPES,
  ACTIVITY_PROTOCOL_VERSION,
  ActivityProtocolTranscriptValidator,
  cloneActivityProtocolFrame,
  validateActivityProtocolComponentFrame,
  validateActivityProtocolFrame,
  validateActivityProtocolHostFrame,
};
