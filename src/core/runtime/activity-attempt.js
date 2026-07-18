import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  ActivityProtocolTranscriptValidator,
  validateActivityProtocolHostFrame,
} from './activity-protocol.js';

export const DEFAULT_ACTIVITY_CANCELLATION_GRACE_MS = 250;
export const DEFAULT_ACTIVITY_HOST_OPERATION_TIMEOUT_MS = 250;
// This is an internal bundle/worker lookup key, not a public application API.
// Keeping it here lets runtime execution derive the same symbol name without
// importing build-only FunctionResource code into a packaged executable.
export const ACTIVITY_ATTEMPT_PROTOCOL_SYMBOL_PREFIX =
  'wharfie.activity-attempt.v1/';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_ACTIVITY_ERROR_MESSAGE_LENGTH = 16 * 1024;
const MAX_ACTIVITY_ERROR_NAME_LENGTH = 256;
const MAX_ACTIVITY_ERROR_DETAILS_BYTES = 64 * 1024;
const UTF8_ENCODER = new TextEncoder();

/**
 * Return the private bundle entrypoint symbol name for one declared activity.
 * The name is deterministic so the host can select the protocol wrapper
 * without changing the worker cache identity for the activity bundle.
 * @param {string} activityId - Declared activity logical ID.
 * @returns {string} - Private global symbol registry key.
 */
export function getActivityAttemptProtocolSymbol(activityId) {
  assertLogicalId(activityId, 'activityId');
  return `${ACTIVITY_ATTEMPT_PROTOCOL_SYMBOL_PREFIX}${activityId}`;
}

/**
 * @typedef ActivityAttemptEvidenceSnapshot
 * @property {string} status - Physical attempt status.
 * @property {Readonly<Record<string, any>>} start - Accepted start frame.
 * @property {Readonly<Record<string, any>> | null} terminal - Accepted terminal frame, if any.
 * @property {Array<Readonly<Record<string, any>>>} frames - Ordered accepted transcript frames.
 * @property {Readonly<Record<string, any>>} transcript - Validator snapshot.
 */

/**
 * @typedef ActivityAttemptEvidence
 * @property {string} status - Physical terminal status.
 * @property {Readonly<Record<string, any>>} start - Accepted start frame.
 * @property {Readonly<Record<string, any>>} terminal - Accepted terminal frame.
 * @property {Array<Readonly<Record<string, any>>>} frames - Ordered accepted transcript frames.
 * @property {Readonly<Record<string, any>>} transcript - Validator snapshot.
 */

/**
 * A host effect returned a structured failed result to the component.
 * This is an ordinary application-visible failure: an activity can catch it
 * and make an intentional application-level decision.
 */
export class ActivityEffectError extends Error {
  /**
   * @param {Readonly<Record<string, any>>} frame - Accepted effect-result frame.
   */
  constructor(frame) {
    super(frame.error.message);
    this.name = frame.error.name;
    this.code = frame.error.code;
    this.details = frame.error.details;
    this.effectId = frame.effectId;
    this.substantiatedReplayProperties = frame.substantiatedReplayProperties;
    this.evidence = frame.evidence;
  }
}

/**
 * A component requested a managed effect that this host does not support.
 * This is deliberately catchable by activity code; it is not malformed
 * protocol behavior.
 */
export class ActivityEffectUnavailableError extends Error {
  /**
   * @param {string} message - Safe failure message.
   */
  constructor(message) {
    super(message);
    this.name = 'ActivityEffectUnavailableError';
    this.code = 'effect-handler-unavailable';
    this.details = {};
  }
}

/**
 * The component or host adapter violated Activity Protocol v1.
 */
export class ActivityAttemptProtocolError extends Error {
  /**
   * @param {string} code - Canonical protocol error code.
   * @param {string} message - Safe diagnostic message.
   * @param {Record<string, any>} [details] - Strict JSON diagnostic details.
   * @param {{cause?: unknown}} [options] - Optional local-only error cause.
   */
  constructor(code, message, details = {}, options = {}) {
    super(message);
    this.name = 'ActivityAttemptProtocolError';
    this.code = code;
    this.details = cloneJsonObject(details, 'Protocol error details');
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * A component-frame sink did not durably acknowledge a contiguous prefix of
 * the accepted transcript. The error carries all locally accepted evidence so
 * a future ledger can reconcile rather than invent a completed delivery.
 */
export class ActivityAttemptDeliveryError extends Error {
  /**
   * @param {unknown} cause - Sink failure.
   * @param {Readonly<ActivityAttemptEvidenceSnapshot>} evidence - Accepted local evidence.
   * @param {number | null} failedComponentSequence - First unacknowledged component sequence.
   * @param {number} acknowledgedComponentSequence - Last contiguous acknowledged sequence.
   */
  constructor(
    cause,
    evidence,
    failedComponentSequence,
    acknowledgedComponentSequence,
  ) {
    super('Activity component-frame delivery could not be confirmed.');
    this.name = 'ActivityAttemptDeliveryError';
    this.code = 'frame-delivery-failed';
    this.cause = cause;
    this.evidence = evidence;
    this.terminal = evidence.terminal;
    this.failedComponentSequence = failedComponentSequence;
    this.acknowledgedComponentSequence = acknowledgedComponentSequence;
  }
}

/**
 * @param {unknown} value - Candidate object property source.
 * @param {string} key - Property name.
 * @returns {unknown} - Safely read property value.
 */
function readProperty(value, key) {
  try {
    if (
      value === null ||
      (typeof value !== 'object' && typeof value !== 'function')
    ) {
      return undefined;
    }
    return /** @type {Record<string, unknown>} */ (value)[key];
  } catch {
    return undefined;
  }
}

/**
 * @param {unknown} value - Candidate string-like value.
 * @param {string} fallback - Safe fallback.
 * @param {number} maxLength - Maximum retained UTF-16 code units.
 * @returns {string} - Bounded safe string.
 */
function toSafeString(value, fallback, maxLength) {
  if (value === undefined || value === null) return fallback;
  let output;
  try {
    output = typeof value === 'string' ? value : String(value);
  } catch {
    output = fallback;
  }
  if (!output) output = fallback;
  return output.length > maxLength ? output.slice(0, maxLength) : output;
}

/**
 * @param {unknown} value - Candidate logical error code.
 * @param {string} fallback - Known-valid fallback.
 * @returns {string} - Canonical error code.
 */
function normalizeErrorCode(value, fallback) {
  if (typeof value === 'string') {
    try {
      assertLogicalId(value, 'error.code');
      return value;
    } catch {}
  }
  return fallback;
}

/**
 * @param {unknown} value - Candidate JSON details.
 * @returns {Record<string, any>} - Independently cloned bounded details.
 */
function normalizeErrorDetails(value) {
  try {
    const details = cloneJsonObject(value, 'error.details');
    if (
      UTF8_ENCODER.encode(JSON.stringify(details)).byteLength >
      MAX_ACTIVITY_ERROR_DETAILS_BYTES
    ) {
      return {};
    }
    return details;
  } catch {
    return {};
  }
}

/**
 * Convert any local exception into the stable Activity Protocol error shape.
 * Stacks, causes, hostile getters, and oversized metadata stay local.
 * @param {unknown} error - Local exception.
 * @param {string} fallbackCode - Known-valid fallback code.
 * @returns {{code: string, name: string, message: string, details: Record<string, any>}} - Structured error.
 */
export function serializeActivityAttemptError(
  error,
  fallbackCode = 'activity-failed',
) {
  assertLogicalId(fallbackCode, 'fallbackCode');
  const candidateName = readProperty(error, 'name');
  const candidateMessage = readProperty(error, 'message');
  const candidateCode = readProperty(error, 'code');
  const candidateDetails = readProperty(error, 'details');

  return {
    code: normalizeErrorCode(candidateCode, fallbackCode),
    name: toSafeString(candidateName, 'Error', MAX_ACTIVITY_ERROR_NAME_LENGTH),
    message: toSafeString(
      candidateMessage === undefined ? error : candidateMessage,
      'Activity attempt failed.',
      MAX_ACTIVITY_ERROR_MESSAGE_LENGTH,
    ),
    details: normalizeErrorDetails(candidateDetails),
  };
}

/**
 * @param {any} value - Value to freeze recursively.
 * @returns {any} - The same frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} error - Candidate local cause.
 * @param {string} fallbackCode - Error code when the cause is not already protocol-shaped.
 * @param {string} message - Stable public message.
 * @param {Record<string, any>} [details] - Stable public details.
 * @returns {ActivityAttemptProtocolError} - Protocol failure.
 */
function asProtocolError(error, fallbackCode, message, details = {}) {
  return new ActivityAttemptProtocolError(fallbackCode, message, details, {
    cause: error,
  });
}

/**
 * @param {unknown} value - Candidate millisecond duration.
 * @param {string} label - Human-readable option name.
 * @param {boolean} allowZero - Whether zero is allowed.
 * @returns {number} - Valid duration.
 */
function assertDuration(value, label, allowZero) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > MAX_TIMER_DELAY_MS
  ) {
    throw new TypeError(
      `${label} must be a ${allowZero ? 'nonnegative' : 'positive'} safe integer no greater than ${MAX_TIMER_DELAY_MS}.`,
    );
  }
  return value;
}

/**
 * Run a host-owned operation with an explicit finite bound. Its late rejection
 * is consumed locally, so a timed-out host callback cannot create an unhandled
 * rejection after the attempt has already become uncertain.
 * @param {() => unknown | Promise<unknown>} operation - Host operation.
 * @param {number} timeoutMs - Maximum wait.
 * @param {string} label - Safe operation label.
 * @returns {Promise<any>} - Host operation result.
 */
async function runBoundedHostOperation(operation, timeoutMs, label) {
  let timer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  const settled = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ kind: /** @type {const} */ ('value'), value }),
      (error) => ({ kind: /** @type {const} */ ('error'), error }),
    );
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: /** @type {const} */ ('timeout') }),
      timeoutMs,
    );
  });
  const outcome = await Promise.race([settled, timedOut]);
  if (timer) clearTimeout(timer);

  if (outcome.kind === 'timeout') {
    settled.then(
      () => {},
      () => {},
    );
    throw new ActivityAttemptProtocolError(
      'host-operation-timed-out',
      `${label} did not settle within ${timeoutMs}ms.`,
    );
  }
  if (outcome.kind === 'error') throw outcome.error;
  return outcome.value;
}

/**
 * @param {Promise<any>} execution - Settled-result handler promise.
 * @param {number} graceMs - Grace duration.
 * @returns {Promise<{settled: true, execution: any} | {settled: false}>} - Grace result.
 */
async function waitForGrace(execution, graceMs) {
  let timer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), graceMs);
  });
  const result = await Promise.race([
    execution.then((value) => ({ settled: true, execution: value })),
    timeout,
  ]);
  if (timer) clearTimeout(timer);
  return /** @type {any} */ (result);
}

/**
 * Execute one Node handler as one bounded Activity Protocol v1 attempt.
 * This adapter records evidence for one physical attempt only. It does not
 * persist work, choose an authoritative outcome, or make retry decisions.
 * @param {Object} options - Attempt options.
 * @param {unknown} options.startFrame - Activity Protocol v1 start frame.
 * @param {(input: any, runtime: Readonly<Record<string, any>>) => any | Promise<any>} options.handler - Node activity handler.
 * @param {(frame: Readonly<Record<string, any>>) => unknown | Promise<unknown>} [options.onComponentFrame] - Ordered component-frame sink.
 * @param {(request: Readonly<Record<string, any>>, options: {signal: AbortSignal}) => unknown | Promise<unknown>} [options.handleEffect] - Host effect adapter returning an effect-result frame.
 * @param {AbortSignal} [options.signal] - External cancellation signal.
 * @param {number} [options.cancellationGraceMs] - Cooperative cancellation grace.
 * @param {number} [options.hostOperationTimeoutMs] - Finite component-sink and force-termination wait.
 * @param {() => unknown | Promise<unknown>} [options.forceTerminate] - Terminates the adapter boundary after grace.
 * @param {() => number} [options.now] - Wall-clock source used for deadlines.
 * @returns {Promise<Readonly<ActivityAttemptEvidence>>} - Immutable physical-attempt evidence.
 */
export async function runNodeActivityAttempt(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('runNodeActivityAttempt requires options.');
  }
  if (typeof options.handler !== 'function') {
    throw new TypeError(
      'runNodeActivityAttempt requires handler(input, runtime).',
    );
  }
  if (
    options.onComponentFrame !== undefined &&
    typeof options.onComponentFrame !== 'function'
  ) {
    throw new TypeError('onComponentFrame must be a function when provided.');
  }
  if (
    options.handleEffect !== undefined &&
    typeof options.handleEffect !== 'function'
  ) {
    throw new TypeError('handleEffect must be a function when provided.');
  }
  if (
    options.forceTerminate !== undefined &&
    typeof options.forceTerminate !== 'function'
  ) {
    throw new TypeError('forceTerminate must be a function when provided.');
  }
  if (
    options.signal !== undefined &&
    (!options.signal ||
      typeof options.signal !== 'object' ||
      typeof options.signal.addEventListener !== 'function' ||
      typeof options.signal.removeEventListener !== 'function')
  ) {
    throw new TypeError(
      'signal must be an AbortSignal with addEventListener and removeEventListener when provided.',
    );
  }

  const cancellationGraceMs = assertDuration(
    options.cancellationGraceMs ?? DEFAULT_ACTIVITY_CANCELLATION_GRACE_MS,
    'cancellationGraceMs',
    true,
  );
  const hostOperationTimeoutMs = assertDuration(
    options.hostOperationTimeoutMs ??
      DEFAULT_ACTIVITY_HOST_OPERATION_TIMEOUT_MS,
    'hostOperationTimeoutMs',
    false,
  );
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new TypeError('now must be a function when provided.');
  }

  const transcript = new ActivityProtocolTranscriptValidator();
  const start = transcript.acceptHostFrame(options.startFrame);
  /** @type {Readonly<Record<string, any>>[]} */
  const frames = [start];
  const controller = new AbortController();
  const componentSink = options.onComponentFrame;
  const effectHandler = options.handleEffect;
  /** @type {Set<Promise<unknown>>} */
  const activeEffectOperations = new Set();
  let nextSequence = 1;
  let componentSealed = false;
  let terminal = /** @type {Readonly<Record<string, any>> | null} */ (null);
  let fatalProtocolError = /** @type {ActivityAttemptProtocolError | null} */ (
    null
  );
  let abortState =
    /** @type {{type: 'cancelled'|'deadline-exceeded', error: Record<string, any>} | null} */ (
      null
    );
  let deadlineTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (
    null
  );
  let acknowledgedComponentSequence = 0;
  let deliveryFailure =
    /** @type {{cause: unknown, sequence: number | null} | null} */ (null);
  let delivery = /** @type {Promise<void>} */ (Promise.resolve());
  let resolveInterruption = () => {};
  const interrupted = new Promise((resolve) => {
    resolveInterruption = () => resolve(undefined);
  });

  /**
   * Retain every trusted host effect through settlement. Effect adapters own
   * durable destination work and must not outlive the attempt scope that owns
   * their DB/catalog resources. After interruption they are required to honor
   * the supplied signal and eventually settle.
   * @returns {Promise<void>} - Completion after the retained set is empty.
   */
  const settleActiveEffectOperations = async () => {
    while (activeEffectOperations.size > 0) {
      await Promise.allSettled([...activeEffectOperations]);
    }
  };

  /**
   * Retain and observe the exact promise returned to component code. Attaching
   * the local rejection observer to an inner async promise is insufficient:
   * an ignored `effects.request()` would leave its distinct outer promise as a
   * process-level unhandled rejection.
   * @param {Promise<any>} operation - Complete effect request lifecycle.
   * @returns {Promise<any>} - Same retained outcome exposed to the component.
   */
  const retainEffectOperation = (operation) => {
    const retained = operation.then(
      (value) => {
        activeEffectOperations.delete(retained);
        return value;
      },
      (error) => {
        activeEffectOperations.delete(retained);
        throw error;
      },
    );
    activeEffectOperations.add(retained);
    retained.catch(() => {});
    return retained;
  };

  /**
   * @returns {Readonly<ActivityAttemptEvidenceSnapshot>} - Current locally accepted evidence.
   */
  const snapshotEvidence = () =>
    deepFreeze({
      status: terminal?.type || 'protocol-failed',
      start,
      terminal,
      frames: [...frames],
      transcript: transcript.snapshot(),
    });

  /**
   * @returns {ActivityAttemptDeliveryError} - Delivery uncertainty error.
   */
  const createDeliveryError = () => {
    if (!deliveryFailure) {
      throw new Error(
        'Activity delivery error was requested without a failure.',
      );
    }
    return new ActivityAttemptDeliveryError(
      deliveryFailure.cause,
      snapshotEvidence(),
      deliveryFailure.sequence,
      acknowledgedComponentSequence,
    );
  };

  /**
   * @param {ActivityAttemptProtocolError} error - Fatal adapter failure.
   * @returns {ActivityAttemptProtocolError} - First fatal adapter failure.
   */
  const latchProtocolFailure = (error) => {
    componentSealed = true;
    if (!terminal && !fatalProtocolError) {
      fatalProtocolError = error;
      try {
        controller.abort(error);
      } catch {}
      resolveInterruption();
    }
    return fatalProtocolError || error;
  };

  /**
   * @param {unknown} value - Candidate host frame.
   * @returns {Readonly<Record<string, any>>} - Accepted host frame.
   */
  const acceptHostFrame = (value) => {
    try {
      const accepted = transcript.acceptHostFrame(value);
      frames.push(accepted);
      return accepted;
    } catch (cause) {
      const error = asProtocolError(
        cause,
        'host-frame-invalid',
        'The activity host produced an invalid protocol frame.',
      );
      latchProtocolFailure(error);
      throw error;
    }
  };

  /**
   * @param {Readonly<Record<string, any>>} frame - Accepted component frame.
   */
  const queueDelivery = (frame) => {
    if (!componentSink || deliveryFailure) return;
    const sequence =
      typeof frame.sequence === 'number'
        ? frame.sequence
        : /** @type {null} */ (null);
    delivery = delivery.then(async () => {
      if (deliveryFailure) return;
      try {
        await runBoundedHostOperation(
          () => componentSink(frame),
          hostOperationTimeoutMs,
          'Activity component-frame delivery',
        );
        if (!deliveryFailure && sequence !== null) {
          acknowledgedComponentSequence = sequence;
        }
      } catch (cause) {
        if (deliveryFailure) return;
        deliveryFailure = { cause, sequence };
        latchProtocolFailure(
          asProtocolError(
            cause,
            'frame-delivery-failed',
            'Activity component-frame delivery failed.',
            sequence === null ? {} : { sequence },
          ),
        );
      }
    });
  };

  /**
   * @param {Record<string, any>} frame - Candidate component frame.
   * @param {boolean} [internal] - Whether Wharfie is emitting the terminal.
   * @returns {Readonly<Record<string, any>>} - Accepted component frame.
   */
  const acceptComponentFrame = (frame, internal = false) => {
    if (componentSealed && !internal) {
      const error = new ActivityAttemptProtocolError(
        'attempt-closed',
        'The activity attempt no longer accepts component frames.',
      );
      if (!terminal) latchProtocolFailure(error);
      throw error;
    }
    try {
      const accepted = transcript.acceptComponentFrame(frame);
      nextSequence += 1;
      frames.push(accepted);
      queueDelivery(accepted);
      return accepted;
    } catch (cause) {
      const error = asProtocolError(
        cause,
        'component-frame-invalid',
        'The activity emitted an invalid component frame.',
      );
      latchProtocolFailure(error);
      throw error;
    }
  };

  /**
   * @param {string} type - Terminal type.
   * @param {{result?: any, error?: Record<string, any>}} value - Terminal data.
   * @returns {Readonly<Record<string, any>>} - Accepted terminal.
   */
  const acceptTerminal = (type, value) => {
    if (terminal) return terminal;
    componentSealed = true;
    const frame = {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type,
      attemptId: start.attemptId,
      sequence: nextSequence,
      ...(type === 'completed'
        ? { result: value.result }
        : { error: value.error }),
    };
    const accepted = acceptComponentFrame(frame, true);
    terminal = accepted;
    return accepted;
  };

  /**
   * @returns {Readonly<Record<string, any>>} - Accepted protocol-failed terminal.
   */
  const acceptProtocolFailureTerminal = () => {
    const error =
      fatalProtocolError ||
      new ActivityAttemptProtocolError(
        'activity-protocol-failed',
        'The activity attempt violated Activity Protocol v1.',
      );
    return acceptTerminal('protocol-failed', {
      error: serializeActivityAttemptError(error, 'activity-protocol-failed'),
    });
  };

  /**
   * @param {'cancelled'|'deadline-exceeded'} type - Abort outcome.
   * @param {Record<string, any>} error - Guaranteed structured reason.
   */
  const requestAbort = (type, error) => {
    if (terminal || fatalProtocolError || abortState) return;
    if (type === 'cancelled') {
      try {
        acceptHostFrame({
          protocol: ACTIVITY_PROTOCOL_NAME,
          protocolVersion: ACTIVITY_PROTOCOL_VERSION,
          type: 'cancel',
          attemptId: start.attemptId,
          reason: error,
        });
      } catch {
        return;
      }
    }
    abortState = { type, error };
    try {
      const reason = new Error(error.message);
      reason.name = error.name;
      Object.assign(reason, { code: error.code, details: error.details });
      controller.abort(reason);
    } catch {}
    resolveInterruption();
  };

  /** Arm or re-arm a deadline longer than the platform timer maximum. */
  const armDeadline = () => {
    if (!Object.prototype.hasOwnProperty.call(start, 'deadlineUnixMs')) return;
    let observedNow;
    try {
      observedNow = Number(now());
    } catch (cause) {
      latchProtocolFailure(
        asProtocolError(
          cause,
          'clock-failed',
          'The activity host clock failed while enforcing the deadline.',
        ),
      );
      return;
    }
    if (!Number.isFinite(observedNow)) {
      latchProtocolFailure(
        new ActivityAttemptProtocolError(
          'clock-invalid',
          'The activity host clock returned an invalid deadline observation.',
        ),
      );
      return;
    }
    const remaining = start.deadlineUnixMs - observedNow;
    if (remaining <= 0) {
      requestAbort('deadline-exceeded', {
        code: 'deadline-exceeded',
        name: 'ActivityDeadlineError',
        message: 'The activity attempt deadline was exceeded.',
        details: { deadlineUnixMs: start.deadlineUnixMs },
      });
      return;
    }
    try {
      deadlineTimer = setTimeout(
        () => {
          try {
            armDeadline();
          } catch (cause) {
            latchProtocolFailure(
              asProtocolError(
                cause,
                'clock-failed',
                'The activity host clock failed while enforcing the deadline.',
              ),
            );
          }
        },
        Math.min(remaining, MAX_TIMER_DELAY_MS),
      );
    } catch (cause) {
      latchProtocolFailure(
        asProtocolError(
          cause,
          'clock-failed',
          'The activity host could not arm the deadline timer.',
        ),
      );
    }
  };

  /**
   * Await all queued delivery callbacks, each of which has a finite bound.
   * @returns {Promise<any>} - Delivery failure, if any.
   */
  const drainDelivery = async () => {
    await delivery;
    return deliveryFailure;
  };

  /**
   * @param {string} level - Protocol log level.
   * @param {string} message - Log message.
   * @param {Record<string, any>} [fields] - Structured fields.
   * @returns {Readonly<Record<string, any>>} - Accepted log frame.
   */
  const writeLog = (level, message, fields = {}) =>
    acceptComponentFrame({
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'log',
      attemptId: start.attemptId,
      sequence: nextSequence,
      level,
      message,
      fields,
    });

  /**
   * @param {string} level - Protocol log level.
   * @returns {(message: string, fields?: Record<string, any>) => Readonly<Record<string, any>>} - Bound logger method.
   */
  const loggerMethod =
    (level) =>
    (message, fields = {}) =>
      writeLog(level, message, fields);

  const logger = Object.freeze({
    log: writeLog,
    trace: loggerMethod('trace'),
    debug: loggerMethod('debug'),
    info: loggerMethod('info'),
    warn: loggerMethod('warn'),
    error: loggerMethod('error'),
  });

  /**
   * @param {{effectId: string, capability: string, operation: string, input: any, requestedReplayProperties: string[]}} request - Managed effect request.
   * @returns {Promise<any>} - Effect result.
   */
  const requestEffect = (request) => {
    const operation = (async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!effectHandler) {
        throw new ActivityEffectUnavailableError(
          'This activity host does not provide a managed effect handler.',
        );
      }
      if (!request || typeof request !== 'object') {
        const error = new ActivityAttemptProtocolError(
          'effect-request-invalid',
          'effects.request requires an effect request object.',
        );
        latchProtocolFailure(error);
        throw error;
      }

      const effectRequest = acceptComponentFrame({
        protocol: ACTIVITY_PROTOCOL_NAME,
        protocolVersion: ACTIVITY_PROTOCOL_VERSION,
        type: 'effect-request',
        attemptId: start.attemptId,
        sequence: nextSequence,
        effectId: request.effectId,
        capability: request.capability,
        operation: request.operation,
        input: request.input,
        requestedReplayProperties: request.requestedReplayProperties,
      });
      await drainDelivery();
      if (deliveryFailure)
        throw latchProtocolFailure(
          new ActivityAttemptProtocolError(
            'frame-delivery-failed',
            'Activity component-frame delivery failed.',
          ),
        );
      if (controller.signal.aborted) throw controller.signal.reason;

      let rawResponse;
      try {
        rawResponse = await effectHandler(effectRequest, {
          signal: controller.signal,
        });
      } catch (cause) {
        const error = asProtocolError(
          cause,
          'effect-handler-failed',
          'The host effect handler failed without returning an effect result.',
          { effectId: effectRequest.effectId },
        );
        latchProtocolFailure(error);
        throw error;
      }

      let response;
      try {
        response = validateActivityProtocolHostFrame(rawResponse);
        if (response.type !== 'effect-result') {
          throw new TypeError('Host response is not an effect-result frame.');
        }
      } catch (cause) {
        const error = asProtocolError(
          cause,
          'effect-result-invalid',
          'The host effect handler returned an invalid effect result.',
          { effectId: effectRequest.effectId },
        );
        latchProtocolFailure(error);
        throw error;
      }

      let effectResult;
      try {
        effectResult = acceptHostFrame(response);
      } catch (cause) {
        const error = asProtocolError(
          cause,
          'effect-result-invalid',
          'The host effect handler returned an invalid effect result.',
          { effectId: effectRequest.effectId },
        );
        latchProtocolFailure(error);
        throw error;
      }
      if (effectResult.ok !== true) throw new ActivityEffectError(effectResult);
      return effectResult.result;
    })();
    return retainEffectOperation(operation);
  };

  const invocation = deepFreeze({
    revisionId: start.revisionId,
    activityId: start.activityId,
    runId: start.runId,
    invocationId: start.invocationId,
    attemptId: start.attemptId,
    fencingToken: start.fencingToken,
    ...(Object.prototype.hasOwnProperty.call(start, 'deadlineUnixMs')
      ? { deadlineUnixMs: start.deadlineUnixMs }
      : {}),
  });
  const runtime = Object.freeze({
    invocation,
    caller: start.caller,
    signal: controller.signal,
    logger,
    effects: Object.freeze({ request: requestEffect }),
  });

  /**
   * @returns {Promise<{status: 'fulfilled', value: any} | {status: 'rejected', reason: unknown}>} - Settled handler result.
   */
  const execute = async () => {
    try {
      return {
        status: /** @type {'fulfilled'} */ ('fulfilled'),
        value: await options.handler(start.input, runtime),
      };
    } catch (reason) {
      return { status: /** @type {'rejected'} */ ('rejected'), reason };
    } finally {
      componentSealed = true;
    }
  };

  const externalAbort = () => {
    requestAbort(
      'cancelled',
      serializeActivityAttemptError(
        readProperty(options.signal, 'reason'),
        'cancel-requested',
      ),
    );
  };

  try {
    try {
      if (options.signal) {
        options.signal.addEventListener('abort', externalAbort, { once: true });
      }
      // The first host interruption owns this physical attempt. In
      // particular, a cancellation already accepted while the worker was
      // loading must not be overwritten merely because the start frame's
      // deadline has elapsed by the time the adapter initializes.
      if (options.signal?.aborted) externalAbort();
      armDeadline();
    } catch (cause) {
      latchProtocolFailure(
        asProtocolError(
          cause,
          'host-cancellation-setup-failed',
          'The activity host could not initialize cancellation handling.',
        ),
      );
    }

    /** @type {{status: 'fulfilled', value: any} | {status: 'rejected', reason: unknown} | null} */
    let executionResult = null;
    let handlerStarted = false;
    if (!abortState && !fatalProtocolError) {
      handlerStarted = true;
      const execution = execute();
      const raced = await Promise.race([
        execution.then((result) => ({
          kind: /** @type {const} */ ('execution'),
          result,
        })),
        interrupted.then(() => ({
          kind: /** @type {const} */ ('interrupted'),
        })),
      ]);
      if (raced.kind === 'execution') {
        executionResult = raced.result;
      } else {
        let grace = await waitForGrace(execution, cancellationGraceMs);
        if (!grace.settled && activeEffectOperations.size > 0) {
          await settleActiveEffectOperations();
          grace = await waitForGrace(execution, cancellationGraceMs);
        }
        if (grace.settled) {
          executionResult = grace.execution;
        } else {
          componentSealed = true;
          if (!options.forceTerminate) {
            latchProtocolFailure(
              new ActivityAttemptProtocolError(
                'termination-unavailable',
                'The activity ignored interruption and no forceTerminate boundary was provided.',
              ),
            );
          } else {
            try {
              await runBoundedHostOperation(
                options.forceTerminate,
                hostOperationTimeoutMs,
                'Activity force termination',
              );
            } catch (cause) {
              latchProtocolFailure(
                asProtocolError(
                  cause,
                  cause instanceof ActivityAttemptProtocolError &&
                    cause.code === 'host-operation-timed-out'
                    ? 'termination-timed-out'
                    : 'termination-failed',
                  'The activity adapter could not terminate the interrupted attempt.',
                ),
              );
            }
          }
        }
      }
    }

    await settleActiveEffectOperations();
    componentSealed = true;
    await drainDelivery();

    if (!terminal) {
      if (fatalProtocolError) {
        acceptProtocolFailureTerminal();
      } else if (abortState) {
        acceptTerminal(abortState.type, { error: abortState.error });
      } else if (executionResult?.status === 'rejected') {
        acceptTerminal('failed', {
          error: serializeActivityAttemptError(
            executionResult.reason,
            'activity-failed',
          ),
        });
      } else if (handlerStarted && executionResult?.status === 'fulfilled') {
        try {
          acceptTerminal('completed', { result: executionResult.value });
        } catch {
          acceptProtocolFailureTerminal();
        }
      } else {
        latchProtocolFailure(
          new ActivityAttemptProtocolError(
            'handler-not-started',
            'The activity handler did not start or settle.',
          ),
        );
        acceptProtocolFailureTerminal();
      }
    }

    await drainDelivery();
    if (deliveryFailure) throw createDeliveryError();
  } catch (cause) {
    if (!terminal) {
      latchProtocolFailure(
        asProtocolError(
          cause,
          'activity-adapter-failed',
          'The activity adapter failed before producing a terminal outcome.',
        ),
      );
      acceptProtocolFailureTerminal();
      await drainDelivery();
      if (deliveryFailure) throw createDeliveryError();
    } else {
      throw cause;
    }
  } finally {
    componentSealed = true;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (options.signal) {
      try {
        options.signal.removeEventListener('abort', externalAbort);
      } catch {}
    }
  }

  if (!terminal) {
    throw new Error('Activity attempt completed without a terminal frame.');
  }
  return /** @type {Readonly<ActivityAttemptEvidence>} */ (snapshotEvidence());
}

export default {
  ActivityAttemptDeliveryError,
  ActivityAttemptProtocolError,
  ActivityEffectError,
  ActivityEffectUnavailableError,
  ACTIVITY_ATTEMPT_PROTOCOL_SYMBOL_PREFIX,
  DEFAULT_ACTIVITY_CANCELLATION_GRACE_MS,
  DEFAULT_ACTIVITY_HOST_OPERATION_TIMEOUT_MS,
  getActivityAttemptProtocolSymbol,
  runNodeActivityAttempt,
  serializeActivityAttemptError,
};
