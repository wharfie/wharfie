import {
  AttemptStatus,
  deepFreezeJson,
  InvocationStatus,
  RunStatus,
} from '../../lib/ledger/execution-ledger-contract.js';

export const DURABLE_OPERATION_RECEIPT_SCHEMA_VERSION = 1;
export const DURABLE_ACTIVITY_RUN_RECEIPT_KIND =
  'wharfie.execution-ledger.activity-run';
export const DURABLE_ACTIVITY_SUBMIT_RECEIPT_KIND =
  'wharfie.execution-ledger.activity-submit';
export const DURABLE_WORKFLOW_START_RECEIPT_KIND =
  'wharfie.execution-ledger.workflow-start';

const MANUAL_INVOCATION_ID = 'manual';
const MISSING = Symbol('missing durable receipt field');
const RUN_DISPOSITIONS = new Set([
  'completed',
  'failed',
  'blocked',
  'in-progress',
]);
const RUN_STATUSES = /** @type {Set<string>} */ (
  new Set(Object.values(RunStatus))
);
const INVOCATION_STATUSES = /** @type {Set<string>} */ (
  new Set(Object.values(InvocationStatus))
);
const ATTEMPT_STATUSES = /** @type {Set<string>} */ (
  new Set(Object.values(AttemptStatus))
);
const ACTIVE_WORKFLOW_ACTIVATIONS = Object.freeze({
  ACTIVITY_RUNNABLE: Object.freeze({
    kind: 'activity',
    resultKey: 'invocation',
    cursorIdKey: 'invocationId',
    status: InvocationStatus.RUNNABLE,
    runStatus: RunStatus.RUNNING,
  }),
  ACTIVITY_RUNNING: Object.freeze({
    kind: 'activity',
    resultKey: 'invocation',
    cursorIdKey: 'invocationId',
    status: InvocationStatus.RUNNING,
    runStatus: RunStatus.RUNNING,
  }),
  ACTIVITY_UNCERTAIN: Object.freeze({
    kind: 'activity',
    resultKey: 'invocation',
    cursorIdKey: 'invocationId',
    status: InvocationStatus.UNCERTAIN,
    runStatus: RunStatus.BLOCKED,
  }),
  TIMER_WAITING: Object.freeze({
    kind: 'timer',
    resultKey: 'timer',
    cursorIdKey: 'timerId',
    status: 'WAITING',
    runStatus: RunStatus.RUNNING,
  }),
  SIGNAL_WAITING: Object.freeze({
    kind: 'signal',
    resultKey: 'signalWait',
    cursorIdKey: 'signalWaitId',
    status: 'WAITING',
    runStatus: RunStatus.RUNNING,
  }),
});
const WORKFLOW_ACTIVATION_TYPES = Object.freeze({
  invocation: Object.freeze({
    kind: 'activity',
    cursorIdKey: 'invocationId',
  }),
  timer: Object.freeze({
    kind: 'timer',
    cursorIdKey: 'timerId',
  }),
  signalWait: Object.freeze({
    kind: 'signal',
    cursorIdKey: 'signalWaitId',
  }),
});
const TERMINAL_WORKFLOW_DISPOSITIONS = Object.freeze({
  CANCELLED: Object.freeze({
    runStatus: RunStatus.CANCELLED,
    statuses: Object.freeze({
      activity: Object.freeze([
        InvocationStatus.CANCELLED,
        InvocationStatus.COMPLETED,
      ]),
      timer: Object.freeze(['CANCELLED']),
      signal: Object.freeze(['CANCELLED']),
    }),
  }),
  COMPLETED: Object.freeze({
    runStatus: RunStatus.COMPLETED,
    statuses: Object.freeze({
      activity: Object.freeze([InvocationStatus.COMPLETED]),
      timer: Object.freeze(['FIRED']),
      signal: Object.freeze(['CONSUMED']),
    }),
  }),
  FAILED: Object.freeze({
    runStatus: RunStatus.FAILED,
    statuses: Object.freeze({
      activity: Object.freeze([InvocationStatus.FAILED]),
    }),
  }),
  PROTOCOL_FAILED: Object.freeze({
    runStatus: RunStatus.FAILED,
    statuses: Object.freeze({
      activity: Object.freeze([InvocationStatus.FAILED]),
    }),
  }),
});

const RUN_ERROR = 'Durable activity run returned an invalid result.';
const RUN_IDENTITY_ERROR =
  'Durable activity run returned an unexpected immutable identity.';
const RUN_STATUS_ERROR =
  'Durable activity run returned inconsistent durable status.';
const SUBMIT_ERROR = 'Durable activity submit returned an invalid result.';
const SUBMIT_IDENTITY_ERROR =
  'Durable activity submit returned an unexpected immutable identity.';
const SUBMIT_STATUS_ERROR =
  'Durable activity submit returned inconsistent durable status.';
const START_ERROR = 'Durable workflow start returned an invalid result.';
const START_IDENTITY_ERROR =
  'Durable workflow start returned an unexpected immutable identity.';
const START_STATUS_ERROR =
  'Durable workflow start returned inconsistent durable status.';
const HUMAN_ROW_ERROR = 'Durable operation receipt is invalid.';

/**
 * Throw one fixed, non-secret contract error.
 * @param {string} message - Safe static message.
 * @returns {never} - Always throws.
 */
function fail(message) {
  throw new TypeError(message);
}

/**
 * Require an ordinary record boundary without traversing unknown properties.
 * @param {unknown} value - Candidate record.
 * @param {string} message - Safe static error.
 * @returns {Record<string, any>} - Candidate record.
 */
function requireRecord(value, message) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(message);
    }
  } catch {
    fail(message);
  }
  return /** @type {Record<string, any>} */ (value);
}

/**
 * Read one required own data property without invoking an accessor.
 * @param {Record<string, any>} value - Source record.
 * @param {string} key - Required key.
 * @param {string} message - Safe static error.
 * @returns {any} - Stored value.
 */
function readField(value, key, message) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    fail(message);
  }
  if (
    !descriptor ||
    !Object.prototype.hasOwnProperty.call(descriptor, 'value')
  ) {
    fail(message);
  }
  return descriptor.value;
}

/**
 * Read one optional own data property without invoking an accessor.
 * @param {Record<string, any>} value - Source record.
 * @param {string} key - Optional key.
 * @param {string} message - Safe static error.
 * @returns {any | typeof MISSING} - Stored value or the missing sentinel.
 */
function readOptionalField(value, key, message) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    fail(message);
  }
  if (!descriptor) return MISSING;
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    fail(message);
  }
  return descriptor.value;
}

/**
 * Require one nonempty string field.
 * @param {Record<string, any>} value - Source record.
 * @param {string} key - Required key.
 * @param {string} message - Safe static error.
 * @returns {string} - Valid string.
 */
function readString(value, key, message) {
  const result = readField(value, key, message);
  if (typeof result !== 'string' || result.length === 0) fail(message);
  return result;
}

/**
 * Require one boolean field.
 * @param {Record<string, any>} value - Source record.
 * @param {string} key - Required key.
 * @param {string} message - Safe static error.
 * @returns {boolean} - Valid boolean.
 */
function readBoolean(value, key, message) {
  const result = readField(value, key, message);
  if (typeof result !== 'boolean') fail(message);
  return result;
}

/**
 * Require one nonnegative safe integer field.
 * @param {Record<string, any>} value - Source record.
 * @param {string} key - Required key.
 * @param {string} message - Safe static error.
 * @returns {number} - Valid integer.
 */
function readIndex(value, key, message) {
  const result = readField(value, key, message);
  if (!Number.isSafeInteger(result) || result < 0) fail(message);
  return result;
}

/**
 * Require one record field.
 * @param {Record<string, any>} value - Source record.
 * @param {string} key - Required key.
 * @param {string} message - Safe static error.
 * @returns {Record<string, any>} - Valid record.
 */
function readRecord(value, key, message) {
  return requireRecord(readField(value, key, message), message);
}

/**
 * Validate one caller-known identity field.
 * @param {Record<string, any>} value - Source record.
 * @param {string} key - Identity key.
 * @param {string} expected - Expected identity.
 * @param {string} message - Safe static error.
 */
function requireIdentity(value, key, expected, message) {
  if (readString(value, key, message) !== expected) fail(message);
}

/**
 * Snapshot and validate caller-known activity identity.
 * @param {unknown} expected - Candidate expected identity.
 * @param {string} message - Safe static error.
 * @returns {{appId: string, runId: string, revisionId: string, activityId: string, idempotencyKey: string}} - Exact expected identity.
 */
function readExpectedActivity(expected, message) {
  const value = requireRecord(expected, message);
  return {
    appId: readString(value, 'appId', message),
    runId: readString(value, 'runId', message),
    revisionId: readString(value, 'revisionId', message),
    activityId: readString(value, 'activityId', message),
    idempotencyKey: readString(value, 'idempotencyKey', message),
  };
}

/**
 * Snapshot and validate caller-known workflow identity.
 * @param {unknown} expected - Candidate expected identity.
 * @param {string} message - Safe static error.
 * @returns {{appId: string, runId: string, revisionId: string, workflowId: string, idempotencyKey: string, planId: string, steps: Record<string, any>[]}} - Exact expected identity and plan.
 */
function readExpectedWorkflow(expected, message) {
  const value = requireRecord(expected, message);
  const definition = readRecord(value, 'definition', message);
  const steps = readField(definition, 'steps', message);
  if (!Array.isArray(steps) || steps.length === 0) fail(message);
  const normalizedSteps = /** @type {Record<string, any>[]} */ (steps);
  return {
    appId: readString(value, 'appId', message),
    runId: readString(value, 'runId', message),
    revisionId: readString(value, 'revisionId', message),
    workflowId: readString(value, 'workflowId', message),
    idempotencyKey: readString(value, 'idempotencyKey', message),
    planId: readString(value, 'planId', message),
    steps: normalizedSteps,
  };
}

/**
 * Validate one run/invocation lifecycle pair.
 * @param {string} runStatus - Run lifecycle state.
 * @param {string} invocationStatus - Invocation lifecycle state.
 * @param {string} message - Safe static error.
 */
function requireManualStatusPair(runStatus, invocationStatus, message) {
  const valid =
    (runStatus === RunStatus.RUNNING &&
      [InvocationStatus.RUNNABLE, InvocationStatus.RUNNING].includes(
        /** @type {any} */ (invocationStatus),
      )) ||
    (runStatus === RunStatus.BLOCKED &&
      invocationStatus === InvocationStatus.UNCERTAIN) ||
    (runStatus === RunStatus.COMPLETED &&
      invocationStatus === InvocationStatus.COMPLETED) ||
    (runStatus === RunStatus.FAILED &&
      invocationStatus === InvocationStatus.FAILED) ||
    (runStatus === RunStatus.CANCELLED &&
      invocationStatus === InvocationStatus.CANCELLED);
  if (!valid) fail(message);
}

/**
 * Validate the public run disposition against its durable state.
 * @param {string} disposition - Public disposition.
 * @param {string} runStatus - Durable run status.
 * @param {string} message - Safe static error.
 */
function requireDisposition(disposition, runStatus, message) {
  const expected =
    runStatus === RunStatus.COMPLETED
      ? 'completed'
      : [RunStatus.FAILED, RunStatus.CANCELLED].includes(
            /** @type {any} */ (runStatus),
          )
        ? 'failed'
        : runStatus === RunStatus.BLOCKED
          ? 'blocked'
          : 'in-progress';
  if (disposition !== expected) fail(message);
}

/**
 * Validate a physical attempt's status against the aggregate outcome.
 * @param {string} disposition - Public disposition.
 * @param {string} runStatus - Durable run status.
 * @param {string} invocationStatus - Durable invocation status.
 * @param {string} attemptStatus - Durable attempt status.
 * @param {string} message - Safe static error.
 */
function requireAttemptStatus(
  disposition,
  runStatus,
  invocationStatus,
  attemptStatus,
  message,
) {
  let valid = false;
  if (disposition === 'completed') {
    valid = [AttemptStatus.COMPLETED, AttemptStatus.ABANDONED].includes(
      /** @type {any} */ (attemptStatus),
    );
  } else if (disposition === 'failed') {
    valid =
      (runStatus === RunStatus.FAILED &&
        [AttemptStatus.FAILED, AttemptStatus.ABANDONED].includes(
          /** @type {any} */ (attemptStatus),
        )) ||
      (runStatus === RunStatus.CANCELLED &&
        [AttemptStatus.CANCELLED, AttemptStatus.ABANDONED].includes(
          /** @type {any} */ (attemptStatus),
        ));
  } else if (disposition === 'blocked') {
    valid = attemptStatus === AttemptStatus.ABANDONED;
  } else if (invocationStatus === InvocationStatus.RUNNING) {
    valid = [AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(
      /** @type {any} */ (attemptStatus),
    );
  } else {
    valid = attemptStatus === AttemptStatus.ABANDONED;
  }
  if (!valid) fail(message);
}

/**
 * Create the versioned, redacted receipt for one foreground durable activity.
 * @param {unknown} raw - Trusted runtime result to validate and project.
 * @param {unknown} expected - Caller-known immutable identity.
 * @returns {Readonly<Record<string, any>>} - Exact recursively frozen receipt.
 */
export function createDurableActivityRunReceipt(raw, expected) {
  const identity = readExpectedActivity(expected, RUN_IDENTITY_ERROR);
  const result = requireRecord(raw, RUN_ERROR);
  requireIdentity(result, 'appId', identity.appId, RUN_IDENTITY_ERROR);
  requireIdentity(result, 'runId', identity.runId, RUN_IDENTITY_ERROR);
  requireIdentity(
    result,
    'revisionId',
    identity.revisionId,
    RUN_IDENTITY_ERROR,
  );
  requireIdentity(
    result,
    'activityName',
    identity.activityId,
    RUN_IDENTITY_ERROR,
  );
  requireIdentity(
    result,
    'idempotencyKey',
    identity.idempotencyKey,
    RUN_IDENTITY_ERROR,
  );

  const outcome = readRecord(result, 'outcome', RUN_ERROR);
  const disposition = readString(outcome, 'disposition', RUN_STATUS_ERROR);
  if (!RUN_DISPOSITIONS.has(disposition)) fail(RUN_STATUS_ERROR);
  const reused = readBoolean(outcome, 'reused', RUN_ERROR);
  const run = readRecord(outcome, 'run', RUN_ERROR);
  requireIdentity(run, 'appId', identity.appId, RUN_IDENTITY_ERROR);
  requireIdentity(run, 'runId', identity.runId, RUN_IDENTITY_ERROR);
  requireIdentity(run, 'revisionId', identity.revisionId, RUN_IDENTITY_ERROR);
  const runStatus = readString(run, 'status', RUN_STATUS_ERROR);
  if (!RUN_STATUSES.has(runStatus)) fail(RUN_STATUS_ERROR);
  const trigger = readRecord(run, 'trigger', RUN_ERROR);
  if (readString(trigger, 'kind', RUN_IDENTITY_ERROR) !== 'manual') {
    fail(RUN_IDENTITY_ERROR);
  }

  const invocation = readRecord(outcome, 'invocation', RUN_ERROR);
  requireIdentity(invocation, 'appId', identity.appId, RUN_IDENTITY_ERROR);
  requireIdentity(invocation, 'runId', identity.runId, RUN_IDENTITY_ERROR);
  requireIdentity(
    invocation,
    'revisionId',
    identity.revisionId,
    RUN_IDENTITY_ERROR,
  );
  requireIdentity(
    invocation,
    'activityId',
    identity.activityId,
    RUN_IDENTITY_ERROR,
  );
  requireIdentity(
    invocation,
    'invocationId',
    MANUAL_INVOCATION_ID,
    RUN_IDENTITY_ERROR,
  );
  const invocationStatus = readString(invocation, 'status', RUN_STATUS_ERROR);
  if (!INVOCATION_STATUSES.has(invocationStatus)) fail(RUN_STATUS_ERROR);
  requireManualStatusPair(runStatus, invocationStatus, RUN_STATUS_ERROR);
  requireDisposition(disposition, runStatus, RUN_STATUS_ERROR);

  const invocationGeneration = readIndex(
    invocation,
    'generation',
    RUN_STATUS_ERROR,
  );

  const rawAttempt = readOptionalField(outcome, 'attempt', RUN_ERROR);
  /** @type {{generation: number, status: string} | null} */
  let projectedAttempt = null;
  if (rawAttempt === MISSING || rawAttempt === null) {
    if (invocationGeneration !== 0) fail(RUN_STATUS_ERROR);
  } else {
    const attempt = requireRecord(rawAttempt, RUN_ERROR);
    const generation = readIndex(attempt, 'generation', RUN_STATUS_ERROR);
    if (generation < 1) fail(RUN_STATUS_ERROR);
    const status = readString(attempt, 'status', RUN_STATUS_ERROR);
    if (!ATTEMPT_STATUSES.has(status)) fail(RUN_STATUS_ERROR);
    requireIdentity(attempt, 'appId', identity.appId, RUN_IDENTITY_ERROR);
    requireIdentity(attempt, 'runId', identity.runId, RUN_IDENTITY_ERROR);
    requireIdentity(
      attempt,
      'revisionId',
      identity.revisionId,
      RUN_IDENTITY_ERROR,
    );
    requireIdentity(
      attempt,
      'activityId',
      identity.activityId,
      RUN_IDENTITY_ERROR,
    );
    requireIdentity(
      attempt,
      'invocationId',
      MANUAL_INVOCATION_ID,
      RUN_IDENTITY_ERROR,
    );
    if (generation !== invocationGeneration) fail(RUN_IDENTITY_ERROR);
    requireAttemptStatus(
      disposition,
      runStatus,
      invocationStatus,
      status,
      RUN_STATUS_ERROR,
    );
    projectedAttempt = { generation, status };
  }

  return deepFreezeJson({
    schemaVersion: DURABLE_OPERATION_RECEIPT_SCHEMA_VERSION,
    kind: DURABLE_ACTIVITY_RUN_RECEIPT_KIND,
    appId: identity.appId,
    runId: identity.runId,
    revisionId: identity.revisionId,
    activityId: identity.activityId,
    idempotencyKey: identity.idempotencyKey,
    disposition,
    reused,
    runStatus,
    invocationStatus,
    attempt: projectedAttempt,
  });
}

/**
 * Create the versioned, redacted receipt for one resident activity submission.
 * Only the compact acceptance boundary is supported.
 * @param {unknown} raw - Compact runtime acceptance result.
 * @param {unknown} expected - Caller-known immutable identity.
 * @returns {Readonly<Record<string, any>>} - Exact recursively frozen receipt.
 */
export function createDurableActivitySubmitReceipt(raw, expected) {
  const identity = readExpectedActivity(expected, SUBMIT_IDENTITY_ERROR);
  const result = requireRecord(raw, SUBMIT_ERROR);
  if (readField(result, 'accepted', SUBMIT_ERROR) !== true) fail(SUBMIT_ERROR);
  requireIdentity(result, 'appId', identity.appId, SUBMIT_IDENTITY_ERROR);
  requireIdentity(result, 'runId', identity.runId, SUBMIT_IDENTITY_ERROR);
  requireIdentity(
    result,
    'revisionId',
    identity.revisionId,
    SUBMIT_IDENTITY_ERROR,
  );
  requireIdentity(
    result,
    'activityId',
    identity.activityId,
    SUBMIT_IDENTITY_ERROR,
  );
  requireIdentity(
    result,
    'idempotencyKey',
    identity.idempotencyKey,
    SUBMIT_IDENTITY_ERROR,
  );
  requireIdentity(
    result,
    'invocationId',
    MANUAL_INVOCATION_ID,
    SUBMIT_IDENTITY_ERROR,
  );
  const reused = readBoolean(result, 'reused', SUBMIT_ERROR);
  const runStatus = readString(result, 'runStatus', SUBMIT_STATUS_ERROR);
  const invocationStatus = readString(
    result,
    'invocationStatus',
    SUBMIT_STATUS_ERROR,
  );
  if (
    !RUN_STATUSES.has(runStatus) ||
    !INVOCATION_STATUSES.has(invocationStatus)
  ) {
    fail(SUBMIT_STATUS_ERROR);
  }
  requireManualStatusPair(runStatus, invocationStatus, SUBMIT_STATUS_ERROR);

  return deepFreezeJson({
    schemaVersion: DURABLE_OPERATION_RECEIPT_SCHEMA_VERSION,
    kind: DURABLE_ACTIVITY_SUBMIT_RECEIPT_KIND,
    appId: identity.appId,
    runId: identity.runId,
    revisionId: identity.revisionId,
    activityId: identity.activityId,
    idempotencyKey: identity.idempotencyKey,
    reused,
    runStatus,
    invocationStatus,
  });
}

/**
 * Validate common workflow activation linkage.
 * @param {Record<string, any>} activation - Current activation projection.
 * @param {{appId: string, runId: string, revisionId: string, workflowId: string}} identity - Caller-known identity.
 * @param {{planId: string, continuationId: string, stepId: string, stepIndex: number}} cursor - Cursor linkage.
 * @param {string} message - Safe static error.
 */
function requireWorkflowActivationLinkage(
  activation,
  identity,
  cursor,
  message,
) {
  requireIdentity(activation, 'appId', identity.appId, message);
  requireIdentity(activation, 'runId', identity.runId, message);
  requireIdentity(activation, 'revisionId', identity.revisionId, message);
  requireIdentity(activation, 'workflowId', identity.workflowId, message);
  requireIdentity(activation, 'planId', cursor.planId, message);
  requireIdentity(activation, 'continuationId', cursor.continuationId, message);
  requireIdentity(activation, 'stepId', cursor.stepId, message);
  if (readIndex(activation, 'stepIndex', message) !== cursor.stepIndex) {
    fail(message);
  }
}

/**
 * Create the versioned, redacted receipt for one workflow start.
 * @param {unknown} raw - Trusted runtime workflow result.
 * @param {unknown} expected - Caller-known immutable identity.
 * @returns {Readonly<Record<string, any>>} - Exact recursively frozen receipt.
 */
export function createDurableWorkflowStartReceipt(raw, expected) {
  const identity = readExpectedWorkflow(expected, START_IDENTITY_ERROR);
  const result = requireRecord(raw, START_ERROR);
  requireIdentity(result, 'appId', identity.appId, START_IDENTITY_ERROR);
  requireIdentity(result, 'runId', identity.runId, START_IDENTITY_ERROR);
  requireIdentity(
    result,
    'revisionId',
    identity.revisionId,
    START_IDENTITY_ERROR,
  );
  requireIdentity(
    result,
    'workflowId',
    identity.workflowId,
    START_IDENTITY_ERROR,
  );
  requireIdentity(
    result,
    'idempotencyKey',
    identity.idempotencyKey,
    START_IDENTITY_ERROR,
  );
  const planId = readString(result, 'planId', START_IDENTITY_ERROR);
  if (planId !== identity.planId) fail(START_IDENTITY_ERROR);
  const outcome = readRecord(result, 'outcome', START_ERROR);
  const reused = !readBoolean(outcome, 'applied', START_ERROR);

  const run = readRecord(outcome, 'run', START_ERROR);
  requireIdentity(run, 'appId', identity.appId, START_IDENTITY_ERROR);
  requireIdentity(run, 'runId', identity.runId, START_IDENTITY_ERROR);
  requireIdentity(run, 'revisionId', identity.revisionId, START_IDENTITY_ERROR);
  const trigger = readRecord(run, 'trigger', START_ERROR);
  if (readString(trigger, 'kind', START_IDENTITY_ERROR) !== 'workflow') {
    fail(START_IDENTITY_ERROR);
  }
  requireIdentity(
    trigger,
    'workflowId',
    identity.workflowId,
    START_IDENTITY_ERROR,
  );
  requireIdentity(trigger, 'planId', planId, START_IDENTITY_ERROR);
  const runStatus = readString(run, 'status', START_STATUS_ERROR);
  if (!RUN_STATUSES.has(runStatus)) fail(START_STATUS_ERROR);

  const rawCursor = readRecord(outcome, 'workflowCursor', START_ERROR);
  requireIdentity(rawCursor, 'appId', identity.appId, START_IDENTITY_ERROR);
  requireIdentity(rawCursor, 'runId', identity.runId, START_IDENTITY_ERROR);
  requireIdentity(
    rawCursor,
    'revisionId',
    identity.revisionId,
    START_IDENTITY_ERROR,
  );
  requireIdentity(
    rawCursor,
    'workflowId',
    identity.workflowId,
    START_IDENTITY_ERROR,
  );
  requireIdentity(rawCursor, 'planId', planId, START_IDENTITY_ERROR);
  const continuationId = readString(
    rawCursor,
    'continuationId',
    START_IDENTITY_ERROR,
  );
  const disposition = readString(rawCursor, 'disposition', START_STATUS_ERROR);
  const activeContract =
    ACTIVE_WORKFLOW_ACTIVATIONS[
      /** @type {keyof typeof ACTIVE_WORKFLOW_ACTIVATIONS} */ (disposition)
    ];
  const terminalContract =
    TERMINAL_WORKFLOW_DISPOSITIONS[
      /** @type {keyof typeof TERMINAL_WORKFLOW_DISPOSITIONS} */ (disposition)
    ];
  const expectedRunStatus =
    activeContract?.runStatus || terminalContract?.runStatus;
  if (
    !expectedRunStatus ||
    runStatus !== expectedRunStatus ||
    (terminalContract && !reused)
  ) {
    fail(START_STATUS_ERROR);
  }
  const stepId = readString(rawCursor, 'stepId', START_IDENTITY_ERROR);
  const stepIndex = readIndex(rawCursor, 'stepIndex', START_IDENTITY_ERROR);
  const cursorLinkage = {
    planId,
    continuationId,
    stepId,
    stepIndex,
  };

  /** @type {string | undefined} */
  let cursorIdKey;
  /** @type {string | undefined} */
  let activationId;
  for (const key of ['invocationId', 'timerId', 'signalWaitId']) {
    const candidate = readOptionalField(rawCursor, key, START_IDENTITY_ERROR);
    if (candidate === MISSING) continue;
    if (
      cursorIdKey ||
      typeof candidate !== 'string' ||
      candidate.length === 0
    ) {
      fail(START_IDENTITY_ERROR);
    }
    cursorIdKey = key;
    activationId = candidate;
  }
  if (!cursorIdKey || !activationId) fail(START_IDENTITY_ERROR);

  /** @type {Record<string, any> | undefined} */
  let activation;
  /** @type {string | undefined} */
  let activationKey;
  for (const key of ['invocation', 'timer', 'signalWait']) {
    const candidate = readOptionalField(outcome, key, START_ERROR);
    if (candidate === MISSING) continue;
    if (activation) fail(START_ERROR);
    activation = requireRecord(candidate, START_ERROR);
    activationKey = key;
  }
  if (!activation || !activationKey) fail(START_ERROR);
  const activationType =
    WORKFLOW_ACTIVATION_TYPES[
      /** @type {keyof typeof WORKFLOW_ACTIVATION_TYPES} */ (activationKey)
    ];
  if (
    !activationType ||
    cursorIdKey !== activationType.cursorIdKey ||
    (activeContract && activationKey !== activeContract.resultKey)
  ) {
    fail(START_IDENTITY_ERROR);
  }
  const expectedStep = requireRecord(
    identity.steps[stepIndex],
    START_IDENTITY_ERROR,
  );
  if (
    readString(expectedStep, 'id', START_IDENTITY_ERROR) !== stepId ||
    readString(expectedStep, 'kind', START_IDENTITY_ERROR) !==
      activationType.kind
  ) {
    fail(START_IDENTITY_ERROR);
  }

  if (activationType.kind === 'activity') {
    requireIdentity(
      activation,
      'invocationId',
      activationId,
      START_IDENTITY_ERROR,
    );
    requireIdentity(activation, 'runId', identity.runId, START_IDENTITY_ERROR);
    requireIdentity(activation, 'appId', identity.appId, START_IDENTITY_ERROR);
    requireIdentity(
      activation,
      'revisionId',
      identity.revisionId,
      START_IDENTITY_ERROR,
    );
    if (
      readString(activation, 'activityId', START_IDENTITY_ERROR) !==
      readString(expectedStep, 'activity', START_IDENTITY_ERROR)
    ) {
      fail(START_IDENTITY_ERROR);
    }
    const workflow = readRecord(activation, 'workflow', START_ERROR);
    requireIdentity(
      workflow,
      'workflowId',
      identity.workflowId,
      START_IDENTITY_ERROR,
    );
    requireIdentity(workflow, 'planId', planId, START_IDENTITY_ERROR);
    requireIdentity(
      workflow,
      'continuationId',
      continuationId,
      START_IDENTITY_ERROR,
    );
    requireIdentity(workflow, 'stepId', stepId, START_IDENTITY_ERROR);
    if (readIndex(workflow, 'stepIndex', START_IDENTITY_ERROR) !== stepIndex) {
      fail(START_IDENTITY_ERROR);
    }
  } else {
    requireIdentity(
      activation,
      activationType.cursorIdKey,
      activationId,
      START_IDENTITY_ERROR,
    );
    requireWorkflowActivationLinkage(
      activation,
      identity,
      cursorLinkage,
      START_IDENTITY_ERROR,
    );
  }
  const activationStatus = readString(activation, 'status', START_STATUS_ERROR);
  const expectedTerminalStatuses = terminalContract
    ? /** @type {Record<string, any>} */ (terminalContract.statuses)[
        activationType.kind
      ]
    : undefined;
  const validActivationStatus = activeContract
    ? activationStatus === activeContract.status
    : Array.isArray(expectedTerminalStatuses) &&
      expectedTerminalStatuses.includes(
        /** @type {never} */ (activationStatus),
      );
  if (!validActivationStatus) fail(START_STATUS_ERROR);

  return deepFreezeJson({
    schemaVersion: DURABLE_OPERATION_RECEIPT_SCHEMA_VERSION,
    kind: DURABLE_WORKFLOW_START_RECEIPT_KIND,
    appId: identity.appId,
    runId: identity.runId,
    revisionId: identity.revisionId,
    workflowId: identity.workflowId,
    idempotencyKey: identity.idempotencyKey,
    reused,
    runStatus,
    cursor: {
      disposition,
      stepId,
      stepIndex,
    },
    nextActivation: activeContract
      ? {
          kind: activationType.kind,
          status: activationStatus,
        }
      : null,
  });
}

/**
 * Format the stable human table row for a foreground durable activity run.
 * @param {unknown} raw - Versioned activity-run receipt.
 * @returns {Record<string, any>} - Existing snake_case table row.
 */
export function formatDurableActivityRunHumanRow(raw) {
  const receipt = requireRecord(raw, HUMAN_ROW_ERROR);
  if (
    readField(receipt, 'schemaVersion', HUMAN_ROW_ERROR) !==
      DURABLE_OPERATION_RECEIPT_SCHEMA_VERSION ||
    readField(receipt, 'kind', HUMAN_ROW_ERROR) !==
      DURABLE_ACTIVITY_RUN_RECEIPT_KIND
  ) {
    fail(HUMAN_ROW_ERROR);
  }
  const rawAttempt = readField(receipt, 'attempt', HUMAN_ROW_ERROR);
  const attempt =
    rawAttempt === null ? null : requireRecord(rawAttempt, HUMAN_ROW_ERROR);
  return {
    idempotency_key: readString(receipt, 'idempotencyKey', HUMAN_ROW_ERROR),
    run_id: readString(receipt, 'runId', HUMAN_ROW_ERROR),
    revision: readString(receipt, 'revisionId', HUMAN_ROW_ERROR),
    activity: readString(receipt, 'activityId', HUMAN_ROW_ERROR),
    status: readString(receipt, 'runStatus', HUMAN_ROW_ERROR),
    invocation_status: readString(receipt, 'invocationStatus', HUMAN_ROW_ERROR),
    attempt_generation: attempt
      ? readIndex(attempt, 'generation', HUMAN_ROW_ERROR)
      : 0,
    attempt_status: attempt
      ? readString(attempt, 'status', HUMAN_ROW_ERROR)
      : '',
  };
}

/**
 * Format the stable human table row for a durable activity submission.
 * @param {unknown} raw - Versioned activity-submit receipt.
 * @returns {Record<string, any>} - Existing snake_case table row.
 */
export function formatDurableActivitySubmitHumanRow(raw) {
  const receipt = requireRecord(raw, HUMAN_ROW_ERROR);
  if (
    readField(receipt, 'schemaVersion', HUMAN_ROW_ERROR) !==
      DURABLE_OPERATION_RECEIPT_SCHEMA_VERSION ||
    readField(receipt, 'kind', HUMAN_ROW_ERROR) !==
      DURABLE_ACTIVITY_SUBMIT_RECEIPT_KIND
  ) {
    fail(HUMAN_ROW_ERROR);
  }
  return {
    idempotency_key: readString(receipt, 'idempotencyKey', HUMAN_ROW_ERROR),
    run_id: readString(receipt, 'runId', HUMAN_ROW_ERROR),
    revision: readString(receipt, 'revisionId', HUMAN_ROW_ERROR),
    activity: readString(receipt, 'activityId', HUMAN_ROW_ERROR),
    status: readString(receipt, 'runStatus', HUMAN_ROW_ERROR),
    invocation_status: readString(receipt, 'invocationStatus', HUMAN_ROW_ERROR),
    attempt_generation: 0,
    attempt_status: '',
    reused: readBoolean(receipt, 'reused', HUMAN_ROW_ERROR),
  };
}

/**
 * Format the stable human table row for a durable workflow start.
 * @param {unknown} raw - Versioned workflow-start receipt.
 * @returns {Record<string, any>} - Existing snake_case table row.
 */
export function formatDurableWorkflowStartHumanRow(raw) {
  const receipt = requireRecord(raw, HUMAN_ROW_ERROR);
  if (
    readField(receipt, 'schemaVersion', HUMAN_ROW_ERROR) !==
      DURABLE_OPERATION_RECEIPT_SCHEMA_VERSION ||
    readField(receipt, 'kind', HUMAN_ROW_ERROR) !==
      DURABLE_WORKFLOW_START_RECEIPT_KIND
  ) {
    fail(HUMAN_ROW_ERROR);
  }
  const cursor = readRecord(receipt, 'cursor', HUMAN_ROW_ERROR);
  const rawActivation = readField(receipt, 'nextActivation', HUMAN_ROW_ERROR);
  const activation =
    rawActivation === null
      ? null
      : requireRecord(rawActivation, HUMAN_ROW_ERROR);
  const runStatus = readString(receipt, 'runStatus', HUMAN_ROW_ERROR);
  return {
    idempotency_key: readString(receipt, 'idempotencyKey', HUMAN_ROW_ERROR),
    run_id: readString(receipt, 'runId', HUMAN_ROW_ERROR),
    revision: readString(receipt, 'revisionId', HUMAN_ROW_ERROR),
    workflow: readString(receipt, 'workflowId', HUMAN_ROW_ERROR),
    status: runStatus,
    cursor_disposition: readString(cursor, 'disposition', HUMAN_ROW_ERROR),
    step: readString(cursor, 'stepId', HUMAN_ROW_ERROR),
    step_index: readIndex(cursor, 'stepIndex', HUMAN_ROW_ERROR),
    activation_kind: activation
      ? readString(activation, 'kind', HUMAN_ROW_ERROR)
      : 'terminal',
    activation_status: activation
      ? readString(activation, 'status', HUMAN_ROW_ERROR)
      : runStatus,
    reused: readBoolean(receipt, 'reused', HUMAN_ROW_ERROR),
  };
}
