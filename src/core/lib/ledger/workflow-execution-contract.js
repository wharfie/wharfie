/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES } from '../../runtime/activity-protocol.js';
import { assertApplicationRevisionId } from '../../runtime/application-revision.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../runtime/content-id.js';
import {
  encodeCanonicalJsonPayload,
  verifyExecutionPayloadReference,
} from '../../runtime/execution-payload.js';
import {
  cloneBoundedJsonObject,
  cloneBoundedJsonValue,
} from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import {
  WORKFLOW_DEFINITIONS_MAX_BYTES,
  WORKFLOW_MAX_STEPS,
  validateWorkflowDefinition,
} from '../../runtime/workflow-definition.js';
import {
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
  EXECUTION_LEDGER_SCHEMA_VERSION,
  assertExactKeys,
  assertNonnegativeSafeInteger,
  assertPositiveSafeInteger,
  normalizePayloadReference,
} from './execution-ledger-contract.js';
import { assertLedgerOpaqueId } from './record-key.js';

export const WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION = 1;

export const WORKFLOW_PLAN_PAYLOAD_KIND = 'workflowPlan';
export const WORKFLOW_PLAN_PAYLOAD_SCHEMA =
  'wharfie.execution.workflow-plan.v1';
export const WORKFLOW_PLAN_PAYLOAD_MAX_BYTES =
  WORKFLOW_DEFINITIONS_MAX_BYTES + 1024;

export const WORKFLOW_START_PAYLOAD_KIND = 'workflowStart';
export const WORKFLOW_START_PAYLOAD_SCHEMA =
  'wharfie.execution.workflow-start-request.v1';

export const WORKFLOW_OUTPUT_PAYLOAD_KIND = 'workflowOutput';
export const WORKFLOW_OUTPUT_PAYLOAD_SCHEMA =
  'wharfie.execution.workflow-output.v1';

export const WORKFLOW_ACTIVITY_REQUEST_PAYLOAD_SCHEMA =
  'wharfie.execution.activity-request.v1';
export const WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES =
  ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES -
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES;
export const WORKFLOW_START_PAYLOAD_MAX_BYTES =
  WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES;
export const WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES =
  WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES;

export const WORKFLOW_RUN_ID_DOMAIN = 'wharfie:workflow-run:v1';
export const WORKFLOW_RUN_ID_PREFIX = 'wfr';
export const WORKFLOW_PLAN_ID_DOMAIN = 'wharfie:workflow-plan:v1';
export const WORKFLOW_PLAN_ID_PREFIX = 'wfp';
export const WORKFLOW_CONTINUATION_ID_DOMAIN =
  'wharfie:workflow-continuation:v1';
export const WORKFLOW_CONTINUATION_ID_PREFIX = 'wfc';
export const WORKFLOW_INVOCATION_ID_DOMAIN = 'wharfie:workflow-invocation:v1';
export const WORKFLOW_INVOCATION_ID_PREFIX = 'wfi';
export const WORKFLOW_TIMER_ID_DOMAIN = 'wharfie:workflow-timer:v1';
export const WORKFLOW_TIMER_ID_PREFIX = 'wft';
export const WORKFLOW_SIGNAL_WAIT_ID_DOMAIN = 'wharfie:workflow-signal-wait:v1';
export const WORKFLOW_SIGNAL_WAIT_ID_PREFIX = 'wfs';

export const WorkflowCursorDisposition = Object.freeze({
  ACTIVITY_RUNNABLE: 'ACTIVITY_RUNNABLE',
});

const WORKFLOW_CURSOR_DISPOSITIONS = new Set(
  Object.values(WorkflowCursorDisposition),
);
const PLAN_PAYLOAD_KEYS = [
  'schemaVersion',
  'kind',
  'appId',
  'revisionId',
  'workflowId',
  'definition',
];
const START_PAYLOAD_KEYS = ['schemaVersion', 'kind', 'input', 'callerMetadata'];
const OUTPUT_PAYLOAD_KEYS = ['schemaVersion', 'kind', 'value'];
const ACTIVITY_REQUEST_KEYS = ['input', 'callerMetadata'];
const WORKFLOW_CURSOR_KEYS = [
  'schemaVersion',
  'runId',
  'appId',
  'revisionId',
  'workflowId',
  'planId',
  'planRef',
  'startRef',
  'stepId',
  'stepIndex',
  'continuationId',
  'invocationId',
  'disposition',
  'outputs',
  'version',
  'lastSequence',
  'createdAt',
  'updatedAt',
];

/**
 * Reapply one whole-document byte ceiling after nested semantic validation.
 * @param {Record<string, any>} value - Normalized JSON document.
 * @param {number} maxBytes - Exact canonical JSON byte ceiling.
 * @param {string} label - Human-readable boundary label.
 * @returns {Record<string, any>} - Independently cloned bounded document.
 */
function cloneWholeDocument(value, maxBytes, label) {
  return cloneBoundedJsonObject(value, maxBytes, label);
}

/**
 * Normalize one immutable plan snapshot copied from an exact application
 * revision. The envelope repeats its application, revision, and workflow
 * identities so verified payload bytes can never be attached to another run
 * scope by changing only a ledger reference.
 * @param {unknown} value - Candidate workflow-plan payload.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {{schemaVersion: 1, kind: 'workflowPlan', appId: string, revisionId: string, workflowId: string, definition: import('../../runtime/workflow-definition.js').WorkflowDefinition}} - Strict plan payload.
 */
export function normalizeWorkflowPlanPayload(
  value,
  label = 'workflow plan payload',
) {
  const payload = cloneWholeDocument(
    /** @type {Record<string, any>} */ (value),
    WORKFLOW_PLAN_PAYLOAD_MAX_BYTES,
    label,
  );
  assertExactKeys(payload, PLAN_PAYLOAD_KEYS, label);
  if (payload.schemaVersion !== WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION) {
    throw new TypeError(
      `${label}.schemaVersion must be the integer ${WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION}.`,
    );
  }
  if (payload.kind !== WORKFLOW_PLAN_PAYLOAD_KIND) {
    throw new TypeError(
      `${label}.kind must be '${WORKFLOW_PLAN_PAYLOAD_KIND}'.`,
    );
  }
  assertLogicalId(payload.appId, `${label}.appId`);
  assertApplicationRevisionId(payload.revisionId, `${label}.revisionId`);
  assertLogicalId(payload.workflowId, `${label}.workflowId`);
  const definition = validateWorkflowDefinition(
    payload.definition,
    `${label}.definition`,
  );
  return /** @type {{schemaVersion: 1, kind: 'workflowPlan', appId: string, revisionId: string, workflowId: string, definition: import('../../runtime/workflow-definition.js').WorkflowDefinition}} */ (
    cloneWholeDocument(
      {
        schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
        kind: WORKFLOW_PLAN_PAYLOAD_KIND,
        appId: payload.appId,
        revisionId: payload.revisionId,
        workflowId: payload.workflowId,
        definition,
      },
      WORKFLOW_PLAN_PAYLOAD_MAX_BYTES,
      label,
    )
  );
}

/**
 * Normalize the one immutable request that began a workflow. Caller metadata
 * remains an inert JSON object and is carried into each selected activity
 * request; it is never interpreted as mutable orchestration context.
 * @param {unknown} value - Candidate workflow-start payload.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {{schemaVersion: 1, kind: 'workflowStart', input: any, callerMetadata: Record<string, any>}} - Strict start payload.
 */
export function normalizeWorkflowStartPayload(
  value,
  label = 'workflow start payload',
) {
  const payload = cloneWholeDocument(
    /** @type {Record<string, any>} */ (value),
    WORKFLOW_START_PAYLOAD_MAX_BYTES,
    label,
  );
  assertExactKeys(payload, START_PAYLOAD_KEYS, label);
  if (payload.schemaVersion !== WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION) {
    throw new TypeError(
      `${label}.schemaVersion must be the integer ${WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION}.`,
    );
  }
  if (payload.kind !== WORKFLOW_START_PAYLOAD_KIND) {
    throw new TypeError(
      `${label}.kind must be '${WORKFLOW_START_PAYLOAD_KIND}'.`,
    );
  }
  const input = cloneBoundedJsonValue(
    payload.input,
    WORKFLOW_START_PAYLOAD_MAX_BYTES,
    `${label}.input`,
  );
  const callerMetadata = cloneBoundedJsonObject(
    payload.callerMetadata,
    WORKFLOW_START_PAYLOAD_MAX_BYTES,
    `${label}.callerMetadata`,
  );
  return /** @type {{schemaVersion: 1, kind: 'workflowStart', input: any, callerMetadata: Record<string, any>}} */ (
    cloneWholeDocument(
      {
        schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
        kind: WORKFLOW_START_PAYLOAD_KIND,
        input,
        callerMetadata,
      },
      WORKFLOW_START_PAYLOAD_MAX_BYTES,
      label,
    )
  );
}

/**
 * Normalize one logical step output independently of its event/cursor binding.
 * The cursor records which step produced this reference; origin metadata is
 * therefore deliberately excluded from the content-addressed value.
 * @param {unknown} value - Candidate workflow-output payload.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {{schemaVersion: 1, kind: 'workflowOutput', value: any}} - Strict output payload.
 */
export function normalizeWorkflowOutputPayload(
  value,
  label = 'workflow output payload',
) {
  const payload = cloneWholeDocument(
    /** @type {Record<string, any>} */ (value),
    WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES,
    label,
  );
  assertExactKeys(payload, OUTPUT_PAYLOAD_KEYS, label);
  if (payload.schemaVersion !== WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION) {
    throw new TypeError(
      `${label}.schemaVersion must be the integer ${WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION}.`,
    );
  }
  if (payload.kind !== WORKFLOW_OUTPUT_PAYLOAD_KIND) {
    throw new TypeError(
      `${label}.kind must be '${WORKFLOW_OUTPUT_PAYLOAD_KIND}'.`,
    );
  }
  const output = cloneBoundedJsonValue(
    payload.value,
    WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES,
    `${label}.value`,
  );
  return /** @type {{schemaVersion: 1, kind: 'workflowOutput', value: any}} */ (
    cloneWholeDocument(
      {
        schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
        kind: WORKFLOW_OUTPUT_PAYLOAD_KIND,
        value: output,
      },
      WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES,
      label,
    )
  );
}

/**
 * Normalize the exact logical activity request selected by the persisted
 * workflow plan. Reserving one inline-ledger document beneath the Activity
 * Protocol limit ensures the later durable start frame has bounded headroom
 * for run, invocation, attempt, and fence identities.
 * @param {unknown} value - Candidate selected activity request.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {{input: any, callerMetadata: Record<string, any>}} - Strict activity request.
 */
export function normalizeWorkflowActivityRequest(
  value,
  label = 'workflow activity request',
) {
  const request = cloneWholeDocument(
    /** @type {Record<string, any>} */ (value),
    WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES,
    label,
  );
  assertExactKeys(request, ACTIVITY_REQUEST_KEYS, label);
  const input = cloneBoundedJsonValue(
    request.input,
    WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES,
    `${label}.input`,
  );
  const callerMetadata = cloneBoundedJsonObject(
    request.callerMetadata,
    WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES,
    `${label}.callerMetadata`,
  );
  return /** @type {{input: any, callerMetadata: Record<string, any>}} */ (
    cloneWholeDocument(
      { input, callerMetadata },
      WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES,
      label,
    )
  );
}

/**
 * @param {unknown} value - Candidate workflow run ID.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {asserts value is string}
 */
export function assertWorkflowRunId(value, label = 'workflow runId') {
  assertDomainSeparatedSha256Id(value, WORKFLOW_RUN_ID_PREFIX, label);
}

/**
 * @param {unknown} value - Candidate workflow plan ID.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {asserts value is string}
 */
export function assertWorkflowPlanId(value, label = 'workflow planId') {
  assertDomainSeparatedSha256Id(value, WORKFLOW_PLAN_ID_PREFIX, label);
}

/**
 * @param {unknown} value - Candidate workflow continuation ID.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {asserts value is string}
 */
export function assertWorkflowContinuationId(
  value,
  label = 'workflow continuationId',
) {
  assertDomainSeparatedSha256Id(value, WORKFLOW_CONTINUATION_ID_PREFIX, label);
}

/**
 * @param {unknown} value - Candidate workflow invocation ID.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {asserts value is string}
 */
export function assertWorkflowInvocationId(
  value,
  label = 'workflow invocationId',
) {
  assertDomainSeparatedSha256Id(value, WORKFLOW_INVOCATION_ID_PREFIX, label);
}

/**
 * @param {unknown} value - Candidate workflow timer ID.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {asserts value is string}
 */
export function assertWorkflowTimerId(value, label = 'workflow timerId') {
  assertDomainSeparatedSha256Id(value, WORKFLOW_TIMER_ID_PREFIX, label);
}

/**
 * @param {unknown} value - Candidate workflow signal-wait ID.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {asserts value is string}
 */
export function assertWorkflowSignalWaitId(
  value,
  label = 'workflow signalWaitId',
) {
  assertDomainSeparatedSha256Id(value, WORKFLOW_SIGNAL_WAIT_ID_PREFIX, label);
}

/**
 * Derive one app-scoped user idempotency identity. Revision, workflow, plan,
 * and input deliberately remain conflict fields rather than widening the
 * idempotency namespace and silently accepting changed work.
 * @param {{appId: string, idempotencyKey: string}} value - Run identity inputs.
 * @returns {string} - Stable workflow run ID.
 */
export function createWorkflowRunId(value) {
  const input = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'workflow run identity',
  );
  assertExactKeys(input, ['appId', 'idempotencyKey'], 'workflow run identity');
  assertLogicalId(input.appId, 'workflow run identity.appId');
  const idempotencyKey = assertLedgerOpaqueId(
    input.idempotencyKey,
    'workflow run identity.idempotencyKey',
  );
  return createCanonicalJsonSha256Id({
    domain: WORKFLOW_RUN_ID_DOMAIN,
    prefix: WORKFLOW_RUN_ID_PREFIX,
    value: { appId: input.appId, idempotencyKey },
    valuePath: 'workflow run identity',
  });
}

/**
 * @param {unknown} value - Exact normalized plan payload.
 * @returns {string} - Stable semantic plan ID.
 */
export function createWorkflowPlanId(value) {
  const plan = normalizeWorkflowPlanPayload(value);
  return createCanonicalJsonSha256Id({
    domain: WORKFLOW_PLAN_ID_DOMAIN,
    prefix: WORKFLOW_PLAN_ID_PREFIX,
    value: plan,
    valuePath: 'workflow plan identity',
  });
}

/**
 * Normalize the identity shared by one exact step activation. Linear V1 plans
 * cannot visit a step twice, so no loop iteration or dynamic activation ID is
 * needed.
 * @param {unknown} value - Candidate activation identity inputs.
 * @param {string} label - Human-readable boundary label.
 * @returns {{runId: string, planId: string, stepId: string, stepIndex: number}} - Exact activation tuple.
 */
function normalizeStepActivationIdentity(value, label) {
  const input = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(input, ['runId', 'planId', 'stepId', 'stepIndex'], label);
  assertWorkflowRunId(input.runId, `${label}.runId`);
  assertWorkflowPlanId(input.planId, `${label}.planId`);
  assertLogicalId(input.stepId, `${label}.stepId`);
  const stepIndex = assertNonnegativeSafeInteger(
    input.stepIndex,
    `${label}.stepIndex`,
  );
  if (stepIndex >= WORKFLOW_MAX_STEPS) {
    throw new RangeError(
      `${label}.stepIndex must be less than ${WORKFLOW_MAX_STEPS}.`,
    );
  }
  return {
    runId: input.runId,
    planId: input.planId,
    stepId: input.stepId,
    stepIndex,
  };
}

/**
 * @param {{runId: string, planId: string, stepId: string, stepIndex: number}} value - Step activation.
 * @returns {string} - Stable continuation identity.
 */
export function createWorkflowContinuationId(value) {
  const input = normalizeStepActivationIdentity(
    value,
    'workflow continuation identity',
  );
  return createCanonicalJsonSha256Id({
    domain: WORKFLOW_CONTINUATION_ID_DOMAIN,
    prefix: WORKFLOW_CONTINUATION_ID_PREFIX,
    value: input,
    valuePath: 'workflow continuation identity',
  });
}

/**
 * @param {{runId: string, continuationId: string, stepId: string, stepIndex: number, activityId: string}} value - Activity activation.
 * @returns {string} - Stable logical invocation identity.
 */
export function createWorkflowInvocationId(value) {
  const input = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'workflow invocation identity',
  );
  assertExactKeys(
    input,
    ['runId', 'continuationId', 'stepId', 'stepIndex', 'activityId'],
    'workflow invocation identity',
  );
  assertWorkflowRunId(input.runId, 'workflow invocation identity.runId');
  assertWorkflowContinuationId(
    input.continuationId,
    'workflow invocation identity.continuationId',
  );
  assertLogicalId(input.stepId, 'workflow invocation identity.stepId');
  const stepIndex = assertNonnegativeSafeInteger(
    input.stepIndex,
    'workflow invocation identity.stepIndex',
  );
  if (stepIndex >= WORKFLOW_MAX_STEPS) {
    throw new RangeError(
      `workflow invocation identity.stepIndex must be less than ${WORKFLOW_MAX_STEPS}.`,
    );
  }
  assertLogicalId(input.activityId, 'workflow invocation identity.activityId');
  return createCanonicalJsonSha256Id({
    domain: WORKFLOW_INVOCATION_ID_DOMAIN,
    prefix: WORKFLOW_INVOCATION_ID_PREFIX,
    value: {
      runId: input.runId,
      continuationId: input.continuationId,
      stepId: input.stepId,
      stepIndex,
      activityId: input.activityId,
    },
    valuePath: 'workflow invocation identity',
  });
}

/**
 * @param {{runId: string, planId: string, stepId: string, stepIndex: number}} value - Timer activation.
 * @returns {string} - Stable future timer identity.
 */
export function createWorkflowTimerId(value) {
  const input = normalizeStepActivationIdentity(
    value,
    'workflow timer identity',
  );
  return createCanonicalJsonSha256Id({
    domain: WORKFLOW_TIMER_ID_DOMAIN,
    prefix: WORKFLOW_TIMER_ID_PREFIX,
    value: input,
    valuePath: 'workflow timer identity',
  });
}

/**
 * @param {{runId: string, planId: string, stepId: string, stepIndex: number}} value - Signal-wait activation.
 * @returns {string} - Stable future signal-wait identity.
 */
export function createWorkflowSignalWaitId(value) {
  const input = normalizeStepActivationIdentity(
    value,
    'workflow signal-wait identity',
  );
  return createCanonicalJsonSha256Id({
    domain: WORKFLOW_SIGNAL_WAIT_ID_DOMAIN,
    prefix: WORKFLOW_SIGNAL_WAIT_ID_PREFIX,
    value: input,
    valuePath: 'workflow signal-wait identity',
  });
}

/**
 * Normalize the initial persisted orchestration cursor. This first contract
 * admits only an activity-runnable cursor with no prior outputs; later cursor
 * dispositions must be added with their complete transition invariants.
 * @param {unknown} value - Candidate workflow cursor.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {Record<string, any>} - Strict cursor projection.
 */
export function normalizeWorkflowCursor(value, label = 'workflow cursor') {
  const cursor = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(cursor, WORKFLOW_CURSOR_KEYS, label);
  if (cursor.schemaVersion !== EXECUTION_LEDGER_SCHEMA_VERSION) {
    throw new TypeError(
      `${label}.schemaVersion must be the integer ${EXECUTION_LEDGER_SCHEMA_VERSION}.`,
    );
  }
  assertWorkflowRunId(cursor.runId, `${label}.runId`);
  assertLogicalId(cursor.appId, `${label}.appId`);
  assertApplicationRevisionId(cursor.revisionId, `${label}.revisionId`);
  assertLogicalId(cursor.workflowId, `${label}.workflowId`);
  assertWorkflowPlanId(cursor.planId, `${label}.planId`);
  const planRef = normalizePayloadReference(
    cursor.planRef,
    WORKFLOW_PLAN_PAYLOAD_SCHEMA,
    `${label}.planRef`,
  );
  const startRef = normalizePayloadReference(
    cursor.startRef,
    WORKFLOW_START_PAYLOAD_SCHEMA,
    `${label}.startRef`,
  );
  assertLogicalId(cursor.stepId, `${label}.stepId`);
  const stepIndex = assertNonnegativeSafeInteger(
    cursor.stepIndex,
    `${label}.stepIndex`,
  );
  if (stepIndex >= WORKFLOW_MAX_STEPS) {
    throw new RangeError(
      `${label}.stepIndex must be less than ${WORKFLOW_MAX_STEPS}.`,
    );
  }
  assertWorkflowContinuationId(
    cursor.continuationId,
    `${label}.continuationId`,
  );
  const expectedContinuationId = createWorkflowContinuationId({
    runId: cursor.runId,
    planId: cursor.planId,
    stepId: cursor.stepId,
    stepIndex,
  });
  if (cursor.continuationId !== expectedContinuationId) {
    throw new TypeError(
      `${label}.continuationId does not match its exact step activation.`,
    );
  }
  assertWorkflowInvocationId(cursor.invocationId, `${label}.invocationId`);
  if (!WORKFLOW_CURSOR_DISPOSITIONS.has(cursor.disposition)) {
    throw new TypeError(
      `${label}.disposition must be '${WorkflowCursorDisposition.ACTIVITY_RUNNABLE}'.`,
    );
  }
  if (!Array.isArray(cursor.outputs) || cursor.outputs.length !== 0) {
    throw new TypeError(`${label}.outputs must be an empty array at start.`);
  }
  const version = assertPositiveSafeInteger(cursor.version, `${label}.version`);
  const lastSequence = assertPositiveSafeInteger(
    cursor.lastSequence,
    `${label}.lastSequence`,
  );
  const createdAt = assertPositiveSafeInteger(
    cursor.createdAt,
    `${label}.createdAt`,
  );
  const updatedAt = assertPositiveSafeInteger(
    cursor.updatedAt,
    `${label}.updatedAt`,
  );
  if (updatedAt < createdAt) {
    throw new TypeError(`${label}.updatedAt must not precede createdAt.`);
  }
  return {
    schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
    runId: cursor.runId,
    appId: cursor.appId,
    revisionId: cursor.revisionId,
    workflowId: cursor.workflowId,
    planId: cursor.planId,
    planRef,
    startRef,
    stepId: cursor.stepId,
    stepIndex,
    continuationId: cursor.continuationId,
    invocationId: cursor.invocationId,
    disposition: cursor.disposition,
    outputs: [],
    version,
    lastSequence,
    createdAt,
    updatedAt,
  };
}

/**
 * Select the first activity from verified immutable plan/start payloads and
 * construct every pure identity and cursor field needed by the atomic start
 * transition. Timer- and signal-headed workflows fail before a caller needs
 * to publish an activity request or mutate the ledger.
 * @param {{runId: string, planPayload: unknown, planRef: unknown, startPayload: unknown, startRef: unknown, observedAt: number}} value - First-activity materialization inputs.
 * @returns {{runId: string, planPayload: ReturnType<typeof normalizeWorkflowPlanPayload>, planRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, startPayload: ReturnType<typeof normalizeWorkflowStartPayload>, startRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, planId: string, continuationId: string, invocationId: string, activityId: string, activityRequest: {input: any, callerMetadata: Record<string, any>}, cursor: Record<string, any>}} - Exact first activity materialization.
 */
export function materializeFirstWorkflowActivity(value) {
  const materialization = cloneBoundedJsonObject(
    value,
    WORKFLOW_PLAN_PAYLOAD_MAX_BYTES +
      WORKFLOW_START_PAYLOAD_MAX_BYTES +
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'first workflow activity materialization',
  );
  assertExactKeys(
    materialization,
    [
      'runId',
      'planPayload',
      'planRef',
      'startPayload',
      'startRef',
      'observedAt',
    ],
    'first workflow activity materialization',
  );
  assertWorkflowRunId(
    materialization.runId,
    'first workflow activity materialization.runId',
  );
  const planPayload = normalizeWorkflowPlanPayload(
    materialization.planPayload,
    'first workflow activity materialization.planPayload',
  );
  const startPayload = normalizeWorkflowStartPayload(
    materialization.startPayload,
    'first workflow activity materialization.startPayload',
  );
  const planRef = verifyExecutionPayloadReference(
    normalizePayloadReference(
      materialization.planRef,
      WORKFLOW_PLAN_PAYLOAD_SCHEMA,
      'first workflow activity materialization.planRef',
    ),
    encodeCanonicalJsonPayload(planPayload),
    'first workflow activity materialization plan',
  ).reference;
  const startRef = verifyExecutionPayloadReference(
    normalizePayloadReference(
      materialization.startRef,
      WORKFLOW_START_PAYLOAD_SCHEMA,
      'first workflow activity materialization.startRef',
    ),
    encodeCanonicalJsonPayload(startPayload),
    'first workflow activity materialization start',
  ).reference;
  const observedAt = assertPositiveSafeInteger(
    materialization.observedAt,
    'first workflow activity materialization.observedAt',
  );
  const firstStep = planPayload.definition.steps[0];
  if (firstStep.kind !== 'activity') {
    throw new TypeError(
      'first workflow activity materialization requires an activity-headed workflow; timer and signal first steps are not implemented.',
    );
  }

  let selectedInput;
  if (firstStep.input.kind === 'workflow-input') {
    selectedInput = startPayload.input;
  } else if (firstStep.input.kind === 'literal') {
    selectedInput = firstStep.input.value;
  } else {
    throw new TypeError(
      'first workflow activity cannot select a prior step output.',
    );
  }
  const activityRequest = normalizeWorkflowActivityRequest({
    input: selectedInput,
    callerMetadata: startPayload.callerMetadata,
  });
  const planId = createWorkflowPlanId(planPayload);
  const continuationId = createWorkflowContinuationId({
    runId: materialization.runId,
    planId,
    stepId: firstStep.id,
    stepIndex: 0,
  });
  const invocationId = createWorkflowInvocationId({
    runId: materialization.runId,
    continuationId,
    stepId: firstStep.id,
    stepIndex: 0,
    activityId: firstStep.activity,
  });
  const cursor = normalizeWorkflowCursor({
    schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
    runId: materialization.runId,
    appId: planPayload.appId,
    revisionId: planPayload.revisionId,
    workflowId: planPayload.workflowId,
    planId,
    planRef,
    startRef,
    stepId: firstStep.id,
    stepIndex: 0,
    continuationId,
    invocationId,
    disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
    outputs: [],
    version: 1,
    lastSequence: 1,
    createdAt: observedAt,
    updatedAt: observedAt,
  });

  return {
    runId: materialization.runId,
    planPayload,
    planRef,
    startPayload,
    startRef,
    planId,
    continuationId,
    invocationId,
    activityId: firstStep.activity,
    activityRequest,
    cursor,
  };
}

export default {
  WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES,
  WORKFLOW_ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
  WORKFLOW_CONTINUATION_ID_DOMAIN,
  WORKFLOW_CONTINUATION_ID_PREFIX,
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_INVOCATION_ID_DOMAIN,
  WORKFLOW_INVOCATION_ID_PREFIX,
  WORKFLOW_OUTPUT_PAYLOAD_KIND,
  WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES,
  WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
  WORKFLOW_PLAN_ID_DOMAIN,
  WORKFLOW_PLAN_ID_PREFIX,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  WORKFLOW_PLAN_PAYLOAD_MAX_BYTES,
  WORKFLOW_PLAN_PAYLOAD_SCHEMA,
  WORKFLOW_RUN_ID_DOMAIN,
  WORKFLOW_RUN_ID_PREFIX,
  WORKFLOW_SIGNAL_WAIT_ID_DOMAIN,
  WORKFLOW_SIGNAL_WAIT_ID_PREFIX,
  WORKFLOW_START_PAYLOAD_KIND,
  WORKFLOW_START_PAYLOAD_MAX_BYTES,
  WORKFLOW_START_PAYLOAD_SCHEMA,
  WORKFLOW_TIMER_ID_DOMAIN,
  WORKFLOW_TIMER_ID_PREFIX,
  WorkflowCursorDisposition,
  assertWorkflowContinuationId,
  assertWorkflowInvocationId,
  assertWorkflowPlanId,
  assertWorkflowRunId,
  assertWorkflowSignalWaitId,
  assertWorkflowTimerId,
  createWorkflowContinuationId,
  createWorkflowInvocationId,
  createWorkflowPlanId,
  createWorkflowRunId,
  createWorkflowSignalWaitId,
  createWorkflowTimerId,
  materializeFirstWorkflowActivity,
  normalizeWorkflowActivityRequest,
  normalizeWorkflowCursor,
  normalizeWorkflowOutputPayload,
  normalizeWorkflowPlanPayload,
  normalizeWorkflowStartPayload,
};
