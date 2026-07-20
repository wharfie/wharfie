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
  hasSameCanonicalJson,
  normalizePayloadReference,
} from './execution-ledger-contract.js';
import { MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID } from './managed-effect-successor-contract.js';
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
  ACTIVITY_RUNNING: 'ACTIVITY_RUNNING',
  ACTIVITY_UNCERTAIN: 'ACTIVITY_UNCERTAIN',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  PROTOCOL_FAILED: 'PROTOCOL_FAILED',
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
const WORKFLOW_OUTPUT_BINDING_KEYS = ['stepId', 'stepIndex', 'outputRef'];
const SELECTED_OUTPUT_KEYS = ['binding', 'payload'];
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
 * Return whether the active activity has a fully implemented atomic success
 * continuation. This is shared by the ledger and physical host so neither can
 * begin user code which would strand the cursor at an unsupported timer,
 * signal, or framework-owned successor boundary.
 * @param {Record<string, any>} cursor - Exact active workflow cursor.
 * @param {Record<string, any>} planPayload - Normalized immutable workflow plan.
 * @returns {boolean} - Whether this activity can be dispatched safely.
 */
export function isWorkflowActivityDispatchSupported(cursor, planPayload) {
  const current = planPayload.definition.steps[cursor.stepIndex];
  const next = planPayload.definition.steps[cursor.stepIndex + 1];
  return Boolean(
    current?.kind === 'activity' &&
    current.activity !== MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID &&
    (!next ||
      (next.kind === 'activity' &&
        next.activity !== MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID)),
  );
}

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
 * Normalize the cursor binding that makes one immutable output reachable from
 * a workflow run. Array position remains authoritative for canonical order;
 * the repeated ordinal and step ID make corruption fail closed.
 * @param {unknown} value - Candidate output binding.
 * @param {string} label - Human-readable boundary label.
 * @returns {{stepId: string, stepIndex: number, outputRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>}} - Strict output binding.
 */
export function normalizeWorkflowOutputBinding(
  value,
  label = 'workflow output binding',
) {
  const binding = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(binding, WORKFLOW_OUTPUT_BINDING_KEYS, label);
  assertLogicalId(binding.stepId, `${label}.stepId`);
  const stepIndex = assertNonnegativeSafeInteger(
    binding.stepIndex,
    `${label}.stepIndex`,
  );
  if (stepIndex >= WORKFLOW_MAX_STEPS) {
    throw new RangeError(
      `${label}.stepIndex must be less than ${WORKFLOW_MAX_STEPS}.`,
    );
  }
  return {
    stepId: binding.stepId,
    stepIndex,
    outputRef: normalizePayloadReference(
      binding.outputRef,
      WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
      `${label}.outputRef`,
    ),
  };
}

/**
 * Rehash one selected output before its value can become an activity input.
 * The cursor binding is checked by the selector boundary that consumes it.
 * @param {unknown} value - Candidate binding and payload pair.
 * @param {string} label - Human-readable boundary label.
 * @returns {{binding: ReturnType<typeof normalizeWorkflowOutputBinding>, payload: ReturnType<typeof normalizeWorkflowOutputPayload>}} - Verified selected output.
 */
function normalizeSelectedWorkflowOutput(value, label) {
  const selected = cloneBoundedJsonObject(
    value,
    WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES +
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(selected, SELECTED_OUTPUT_KEYS, label);
  const binding = normalizeWorkflowOutputBinding(
    selected.binding,
    `${label}.binding`,
  );
  const payload = normalizeWorkflowOutputPayload(
    selected.payload,
    `${label}.payload`,
  );
  const outputRef = verifyExecutionPayloadReference(
    binding.outputRef,
    encodeCanonicalJsonPayload(payload),
    `${label}.payload`,
  ).reference;
  return {
    binding: { ...binding, outputRef },
    payload,
  };
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
 * Normalize one persisted activity-or-terminal orchestration cursor. Outputs
 * are a canonical contiguous prefix of the immutable plan: every current or
 * failed activity cursor retains only prior outputs, while a successfully
 * completed cursor also retains the final activity output.
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
      `${label}.disposition must be one of ${[...WORKFLOW_CURSOR_DISPOSITIONS].join(', ')}.`,
    );
  }
  if (!Array.isArray(cursor.outputs)) {
    throw new TypeError(`${label}.outputs must be an array.`);
  }
  const outputStepIds = new Set();
  const outputs = cursor.outputs.map((candidate, index) => {
    const binding = normalizeWorkflowOutputBinding(
      candidate,
      `${label}.outputs[${index}]`,
    );
    if (binding.stepIndex !== index) {
      throw new TypeError(
        `${label}.outputs must be contiguous and canonically ordered by stepIndex.`,
      );
    }
    if (outputStepIds.has(binding.stepId)) {
      throw new TypeError(`${label}.outputs step IDs must be unique.`);
    }
    outputStepIds.add(binding.stepId);
    return binding;
  });
  let expectedOutputCount;
  let includesCurrentStepOutput;
  switch (cursor.disposition) {
    case WorkflowCursorDisposition.ACTIVITY_RUNNABLE:
    case WorkflowCursorDisposition.ACTIVITY_RUNNING:
    case WorkflowCursorDisposition.ACTIVITY_UNCERTAIN:
    case WorkflowCursorDisposition.FAILED:
    case WorkflowCursorDisposition.PROTOCOL_FAILED:
      expectedOutputCount = stepIndex;
      includesCurrentStepOutput = false;
      break;
    case WorkflowCursorDisposition.COMPLETED:
      expectedOutputCount = stepIndex + 1;
      includesCurrentStepOutput = true;
      break;
    default:
      throw new TypeError(`${label}.disposition is not supported.`);
  }
  if (outputs.length !== expectedOutputCount) {
    throw new TypeError(
      `${label}.outputs must contain exactly ${expectedOutputCount} contiguous step outputs for disposition ${cursor.disposition}.`,
    );
  }
  if (
    includesCurrentStepOutput
      ? outputs[stepIndex]?.stepId !== cursor.stepId
      : outputStepIds.has(cursor.stepId)
  ) {
    throw new TypeError(
      includesCurrentStepOutput
        ? `${label}.outputs final binding must match the completed cursor step.`
        : `${label}.outputs cannot contain the active cursor step.`,
    );
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
    outputs,
    version,
    lastSequence,
    createdAt,
    updatedAt,
  };
}

/**
 * Normalize and rehash the immutable payload context shared by every cursor
 * materialization. Payload references are data until their exact bytes have
 * been verified here.
 * @param {Record<string, any>} value - Candidate context fields.
 * @param {string} label - Human-readable boundary label.
 * @returns {{planPayload: ReturnType<typeof normalizeWorkflowPlanPayload>, planRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, startPayload: ReturnType<typeof normalizeWorkflowStartPayload>, startRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, planId: string}} - Verified immutable context.
 */
function normalizeWorkflowPayloadContext(value, label) {
  const planPayload = normalizeWorkflowPlanPayload(
    value.planPayload,
    `${label}.planPayload`,
  );
  const startPayload = normalizeWorkflowStartPayload(
    value.startPayload,
    `${label}.startPayload`,
  );
  const planRef = verifyExecutionPayloadReference(
    normalizePayloadReference(
      value.planRef,
      WORKFLOW_PLAN_PAYLOAD_SCHEMA,
      `${label}.planRef`,
    ),
    encodeCanonicalJsonPayload(planPayload),
    `${label} plan`,
  ).reference;
  const startRef = verifyExecutionPayloadReference(
    normalizePayloadReference(
      value.startRef,
      WORKFLOW_START_PAYLOAD_SCHEMA,
      `${label}.startRef`,
    ),
    encodeCanonicalJsonPayload(startPayload),
    `${label} start`,
  ).reference;
  return {
    planPayload,
    planRef,
    startPayload,
    startRef,
    planId: createWorkflowPlanId(planPayload),
  };
}

/**
 * Prove a cursor belongs to one exact plan/start pair and that its retained
 * output prefix names the corresponding immutable plan steps.
 * @param {Record<string, any>} cursor - Strict normalized cursor.
 * @param {ReturnType<typeof normalizeWorkflowPayloadContext>} context - Verified payload context.
 * @param {string} label - Human-readable boundary label.
 * @returns {import('../../runtime/workflow-definition.js').WorkflowStep} - Exact current plan step.
 */
function assertWorkflowCursorContext(cursor, context, label) {
  if (
    cursor.appId !== context.planPayload.appId ||
    cursor.revisionId !== context.planPayload.revisionId ||
    cursor.workflowId !== context.planPayload.workflowId ||
    cursor.planId !== context.planId ||
    !hasSameCanonicalJson(cursor.planRef, context.planRef) ||
    !hasSameCanonicalJson(cursor.startRef, context.startRef)
  ) {
    throw new TypeError(`${label} does not match its exact plan/start scope.`);
  }
  const currentStep = context.planPayload.definition.steps[cursor.stepIndex];
  if (!currentStep || currentStep.id !== cursor.stepId) {
    throw new TypeError(`${label} does not match its exact plan step.`);
  }
  for (const binding of cursor.outputs) {
    if (
      context.planPayload.definition.steps[binding.stepIndex]?.id !==
      binding.stepId
    ) {
      throw new TypeError(
        `${label}.outputs do not match the immutable plan prefix.`,
      );
    }
  }
  return currentStep;
}

/**
 * Select one activity's exact JSON input. A step-output selector requires the
 * caller to supply and rehash the named payload unless it is the output being
 * appended by the same pure success materialization.
 * @param {{step: import('../../runtime/workflow-definition.js').WorkflowStep, stepIndex: number, planPayload: ReturnType<typeof normalizeWorkflowPlanPayload>, startPayload: ReturnType<typeof normalizeWorkflowStartPayload>, outputs: Array<ReturnType<typeof normalizeWorkflowOutputBinding>>, selectedOutput?: ReturnType<typeof normalizeSelectedWorkflowOutput>, currentOutput?: ReturnType<typeof normalizeSelectedWorkflowOutput>, label: string}} value - Selection context.
 * @returns {{input: any, callerMetadata: Record<string, any>}} - Exact normalized activity request.
 */
function selectWorkflowActivityRequest(value) {
  if (value.step.kind !== 'activity') {
    throw new TypeError(`${value.label} requires an activity plan step.`);
  }
  const inputSelector = value.step.input;
  let selectedInput;
  if (inputSelector.kind === 'workflow-input') {
    if (value.selectedOutput) {
      throw new TypeError(
        `${value.label}.selectedOutput is supported only for a step-output selector.`,
      );
    }
    selectedInput = value.startPayload.input;
  } else if (inputSelector.kind === 'literal') {
    if (value.selectedOutput) {
      throw new TypeError(
        `${value.label}.selectedOutput is supported only for a step-output selector.`,
      );
    }
    selectedInput = inputSelector.value;
  } else {
    const selectedStepIndex = value.planPayload.definition.steps.findIndex(
      (candidate) => candidate.id === inputSelector.step,
    );
    if (selectedStepIndex < 0 || selectedStepIndex >= value.stepIndex) {
      throw new TypeError(
        `${value.label} step-output selector does not name an earlier plan step.`,
      );
    }
    const expectedBinding = value.outputs[selectedStepIndex];
    if (
      !expectedBinding ||
      expectedBinding.stepId !== inputSelector.step ||
      expectedBinding.stepIndex !== selectedStepIndex
    ) {
      throw new TypeError(
        `${value.label} selected step output is unavailable from the cursor.`,
      );
    }
    const selected =
      value.currentOutput?.binding.stepId === inputSelector.step
        ? value.currentOutput
        : value.selectedOutput;
    if (!selected || !hasSameCanonicalJson(selected.binding, expectedBinding)) {
      throw new TypeError(
        `${value.label}.selectedOutput must match the exact cursor output selected by the plan.`,
      );
    }
    if (
      value.selectedOutput &&
      value.currentOutput?.binding.stepId === inputSelector.step &&
      (!hasSameCanonicalJson(
        value.selectedOutput.binding,
        value.currentOutput.binding,
      ) ||
        !hasSameCanonicalJson(
          value.selectedOutput.payload,
          value.currentOutput.payload,
        ))
    ) {
      throw new TypeError(
        `${value.label}.selectedOutput conflicts with the current output.`,
      );
    }
    selectedInput = selected.payload.value;
  }
  return normalizeWorkflowActivityRequest(
    {
      input: selectedInput,
      callerMetadata: value.startPayload.callerMetadata,
    },
    `${value.label}.activityRequest`,
  );
}

/**
 * Materialize one activity from an already-normalized cursor and payload
 * context. This is shared by public cursor validation and initial creation.
 * @param {{context: ReturnType<typeof normalizeWorkflowPayloadContext>, cursor: Record<string, any>, selectedOutput?: ReturnType<typeof normalizeSelectedWorkflowOutput>, label: string}} value - Verified current activity context.
 * @returns {{runId: string, planPayload: ReturnType<typeof normalizeWorkflowPlanPayload>, planRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, startPayload: ReturnType<typeof normalizeWorkflowStartPayload>, startRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, planId: string, stepId: string, stepIndex: number, continuationId: string, invocationId: string, activityId: string, activityRequest: {input: any, callerMetadata: Record<string, any>}, cursor: Record<string, any>}} - Exact cursor activity.
 */
function materializeNormalizedWorkflowActivityAtCursor(value) {
  if (
    ![
      WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
      WorkflowCursorDisposition.ACTIVITY_RUNNING,
      WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
    ].includes(value.cursor.disposition)
  ) {
    throw new TypeError(`${value.label}.cursor is not a current activity.`);
  }
  const step = assertWorkflowCursorContext(
    value.cursor,
    value.context,
    `${value.label}.cursor`,
  );
  if (step.kind !== 'activity') {
    throw new TypeError(
      `${value.label}.cursor does not name an activity step.`,
    );
  }
  const expectedInvocationId = createWorkflowInvocationId({
    runId: value.cursor.runId,
    continuationId: value.cursor.continuationId,
    stepId: value.cursor.stepId,
    stepIndex: value.cursor.stepIndex,
    activityId: step.activity,
  });
  if (value.cursor.invocationId !== expectedInvocationId) {
    throw new TypeError(
      `${value.label}.cursor invocationId does not match its exact activity activation.`,
    );
  }
  const activityRequest = selectWorkflowActivityRequest({
    step,
    stepIndex: value.cursor.stepIndex,
    planPayload: value.context.planPayload,
    startPayload: value.context.startPayload,
    outputs: value.cursor.outputs,
    selectedOutput: value.selectedOutput,
    label: value.label,
  });
  return {
    runId: value.cursor.runId,
    ...value.context,
    stepId: value.cursor.stepId,
    stepIndex: value.cursor.stepIndex,
    continuationId: value.cursor.continuationId,
    invocationId: value.cursor.invocationId,
    activityId: step.activity,
    activityRequest,
    cursor: value.cursor,
  };
}

/**
 * Validate and materialize the activity selected by one exact current cursor,
 * including a blocked uncertain cursor that cannot authorize dispatch. A
 * step-output selector must carry the exact cursor binding and rehashed
 * workflow-output payload; other selectors reject that extra input.
 * @param {{planPayload: unknown, planRef: unknown, startPayload: unknown, startRef: unknown, cursor: unknown, selectedOutput?: {binding: unknown, payload: unknown}}} value - Cursor activity materialization.
 * @returns {ReturnType<typeof materializeNormalizedWorkflowActivityAtCursor>} - Exact cursor activity.
 */
export function materializeWorkflowCursorActivity(value) {
  const label = 'workflow activity cursor materialization';
  const materialization = cloneBoundedJsonObject(
    value,
    WORKFLOW_PLAN_PAYLOAD_MAX_BYTES +
      WORKFLOW_START_PAYLOAD_MAX_BYTES +
      WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES +
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES * 2,
    label,
  );
  const hasSelectedOutput = Object.prototype.hasOwnProperty.call(
    materialization,
    'selectedOutput',
  );
  assertExactKeys(
    materialization,
    [
      'planPayload',
      'planRef',
      'startPayload',
      'startRef',
      'cursor',
      ...(hasSelectedOutput ? ['selectedOutput'] : []),
    ],
    label,
  );
  const context = normalizeWorkflowPayloadContext(materialization, label);
  const cursor = normalizeWorkflowCursor(
    materialization.cursor,
    `${label}.cursor`,
  );
  const selectedOutput = hasSelectedOutput
    ? normalizeSelectedWorkflowOutput(
        materialization.selectedOutput,
        `${label}.selectedOutput`,
      )
    : undefined;
  return materializeNormalizedWorkflowActivityAtCursor({
    context,
    cursor,
    selectedOutput,
    label,
  });
}

/**
 * Materialize one cursor-only workflow activity lifecycle decision. The
 * caller still proves the physical attempt state and fence; this pure boundary
 * proves that recovery cannot change the logical activation, output prefix,
 * or immutable plan/start scope while advancing the cursor exactly once.
 * @param {unknown} value - Candidate cursor transition inputs.
 * @param {{label: string, currentDisposition: string, nextDisposition: string}} options - Exact supported lifecycle edge.
 * @returns {Record<string, any>} - Strict next cursor.
 */
function materializeWorkflowActivityCursorTransition(value, options) {
  const transition = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES * 2,
    options.label,
  );
  assertExactKeys(
    transition,
    ['currentCursor', 'sequence', 'observedAt'],
    options.label,
  );
  const currentCursor = normalizeWorkflowCursor(
    transition.currentCursor,
    `${options.label}.currentCursor`,
  );
  if (currentCursor.disposition !== options.currentDisposition) {
    throw new TypeError(
      `${options.label}.currentCursor must have disposition ${options.currentDisposition}.`,
    );
  }
  const sequence = assertPositiveSafeInteger(
    transition.sequence,
    `${options.label}.sequence`,
  );
  if (sequence !== currentCursor.lastSequence + 1) {
    throw new TypeError(
      `${options.label}.sequence must immediately follow currentCursor.lastSequence.`,
    );
  }
  const observedAt = assertPositiveSafeInteger(
    transition.observedAt,
    `${options.label}.observedAt`,
  );
  if (observedAt < currentCursor.updatedAt) {
    throw new TypeError(
      `${options.label}.observedAt must not precede currentCursor.updatedAt.`,
    );
  }
  return normalizeWorkflowCursor(
    {
      ...currentCursor,
      disposition: options.nextDisposition,
      version: currentCursor.version + 1,
      lastSequence: sequence,
      updatedAt: observedAt,
    },
    `${options.label}.cursor`,
  );
}

/**
 * Release one workflow activity claim that provably never crossed the durable
 * handler-start boundary. Physical attempt validation remains a ledger
 * concern; the logical cursor returns to the same runnable activation.
 * @param {{currentCursor: unknown, sequence: number, observedAt: number}} value - Exact claim-release materialization.
 * @returns {Record<string, any>} - Same activity restored to runnable.
 */
export function materializeWorkflowActivityClaimRelease(value) {
  return materializeWorkflowActivityCursorTransition(value, {
    label: 'workflow activity claim release',
    currentDisposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
    nextDisposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
  });
}

/**
 * Block one workflow activity whose begun physical attempt can no longer be
 * trusted to report an outcome. No output or successor is created here.
 * @param {{currentCursor: unknown, sequence: number, observedAt: number}} value - Exact uncertainty materialization.
 * @returns {Record<string, any>} - Same activity retained as uncertain.
 */
export function materializeWorkflowActivityUncertainty(value) {
  return materializeWorkflowActivityCursorTransition(value, {
    label: 'workflow activity uncertainty',
    currentDisposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
    nextDisposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
  });
}

/**
 * Materialize the logical completion of one activity from an exact supported
 * source disposition. Exported wrappers keep ordinary success and uncertain
 * reconciliation as distinct authority boundaries.
 * @param {{currentCursor: unknown, planPayload: unknown, planRef: unknown, startPayload: unknown, startRef: unknown, outputPayload: unknown, outputRef: unknown, selectedOutput?: {binding: unknown, payload: unknown}, sequence: number, observedAt: number}} value - Completed activity materialization.
 * @param {{label: string, currentDisposition: string}} options - Exact supported completion source.
 * @returns {{runId: string, planPayload: ReturnType<typeof normalizeWorkflowPlanPayload>, planRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, startPayload: ReturnType<typeof normalizeWorkflowStartPayload>, startRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, planId: string, outputPayload: ReturnType<typeof normalizeWorkflowOutputPayload>, outputRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, outputBinding: ReturnType<typeof normalizeWorkflowOutputBinding>, completed: boolean, cursor: Record<string, any>, nextActivity?: {stepId: string, stepIndex: number, continuationId: string, invocationId: string, activityId: string, activityRequest: {input: any, callerMetadata: Record<string, any>}}}} - Exact successor or terminal materialization.
 */
function materializeWorkflowActivityCompletion(value, options) {
  const { label } = options;
  const materialization = cloneBoundedJsonObject(
    value,
    WORKFLOW_PLAN_PAYLOAD_MAX_BYTES +
      WORKFLOW_START_PAYLOAD_MAX_BYTES +
      WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES * 2 +
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES * 3,
    label,
  );
  const hasSelectedOutput = Object.prototype.hasOwnProperty.call(
    materialization,
    'selectedOutput',
  );
  assertExactKeys(
    materialization,
    [
      'currentCursor',
      'planPayload',
      'planRef',
      'startPayload',
      'startRef',
      'outputPayload',
      'outputRef',
      ...(hasSelectedOutput ? ['selectedOutput'] : []),
      'sequence',
      'observedAt',
    ],
    label,
  );
  const context = normalizeWorkflowPayloadContext(materialization, label);
  const currentCursor = normalizeWorkflowCursor(
    materialization.currentCursor,
    `${label}.currentCursor`,
  );
  if (currentCursor.disposition !== options.currentDisposition) {
    throw new TypeError(
      `${label}.currentCursor must have disposition ${options.currentDisposition}.`,
    );
  }
  const currentStep = assertWorkflowCursorContext(
    currentCursor,
    context,
    `${label}.currentCursor`,
  );
  if (currentStep.kind !== 'activity') {
    throw new TypeError(`${label}.currentCursor must name an activity step.`);
  }
  const expectedInvocationId = createWorkflowInvocationId({
    runId: currentCursor.runId,
    continuationId: currentCursor.continuationId,
    stepId: currentCursor.stepId,
    stepIndex: currentCursor.stepIndex,
    activityId: currentStep.activity,
  });
  if (currentCursor.invocationId !== expectedInvocationId) {
    throw new TypeError(
      `${label}.currentCursor invocationId does not match its exact activity activation.`,
    );
  }
  const sequence = assertPositiveSafeInteger(
    materialization.sequence,
    `${label}.sequence`,
  );
  if (sequence !== currentCursor.lastSequence + 1) {
    throw new TypeError(
      `${label}.sequence must immediately follow currentCursor.lastSequence.`,
    );
  }
  const observedAt = assertPositiveSafeInteger(
    materialization.observedAt,
    `${label}.observedAt`,
  );
  if (observedAt < currentCursor.updatedAt) {
    throw new TypeError(
      `${label}.observedAt must not precede currentCursor.updatedAt.`,
    );
  }
  const outputPayload = normalizeWorkflowOutputPayload(
    materialization.outputPayload,
    `${label}.outputPayload`,
  );
  const outputRef = verifyExecutionPayloadReference(
    normalizePayloadReference(
      materialization.outputRef,
      WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
      `${label}.outputRef`,
    ),
    encodeCanonicalJsonPayload(outputPayload),
    `${label} output`,
  ).reference;
  const outputBinding = normalizeWorkflowOutputBinding(
    {
      stepId: currentCursor.stepId,
      stepIndex: currentCursor.stepIndex,
      outputRef,
    },
    `${label}.outputBinding`,
  );
  const outputs = [...currentCursor.outputs, outputBinding];
  const selectedOutput = hasSelectedOutput
    ? normalizeSelectedWorkflowOutput(
        materialization.selectedOutput,
        `${label}.selectedOutput`,
      )
    : undefined;
  const nextStepIndex = currentCursor.stepIndex + 1;
  const nextStep = context.planPayload.definition.steps[nextStepIndex];
  const common = {
    runId: currentCursor.runId,
    ...context,
    outputPayload,
    outputRef,
    outputBinding,
  };
  if (!nextStep) {
    if (selectedOutput) {
      throw new TypeError(
        `${label}.selectedOutput is not supported when the workflow is complete.`,
      );
    }
    const cursor = normalizeWorkflowCursor({
      ...currentCursor,
      disposition: WorkflowCursorDisposition.COMPLETED,
      outputs,
      version: currentCursor.version + 1,
      lastSequence: sequence,
      updatedAt: observedAt,
    });
    return { ...common, completed: true, cursor };
  }
  if (nextStep.kind !== 'activity') {
    throw new TypeError(
      `${label} supports only an activity successor or terminal workflow; timer and signal successors are not implemented.`,
    );
  }
  const currentOutput = { binding: outputBinding, payload: outputPayload };
  const activityRequest = selectWorkflowActivityRequest({
    step: nextStep,
    stepIndex: nextStepIndex,
    planPayload: context.planPayload,
    startPayload: context.startPayload,
    outputs,
    selectedOutput,
    currentOutput,
    label: `${label}.nextActivity`,
  });
  const continuationId = createWorkflowContinuationId({
    runId: currentCursor.runId,
    planId: context.planId,
    stepId: nextStep.id,
    stepIndex: nextStepIndex,
  });
  const invocationId = createWorkflowInvocationId({
    runId: currentCursor.runId,
    continuationId,
    stepId: nextStep.id,
    stepIndex: nextStepIndex,
    activityId: nextStep.activity,
  });
  const cursor = normalizeWorkflowCursor({
    ...currentCursor,
    stepId: nextStep.id,
    stepIndex: nextStepIndex,
    continuationId,
    invocationId,
    disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
    outputs,
    version: currentCursor.version + 1,
    lastSequence: sequence,
    updatedAt: observedAt,
  });
  return {
    ...common,
    completed: false,
    cursor,
    nextActivity: {
      stepId: nextStep.id,
      stepIndex: nextStepIndex,
      continuationId,
      invocationId,
      activityId: nextStep.activity,
      activityRequest,
    },
  };
}

/**
 * Materialize the logical success of the current running activity. The helper
 * appends exactly one immutable output binding and either selects the next
 * activity or returns a terminal cursor. Payload publication and ledger
 * mutation remain the caller's separate atomicity boundary.
 * @param {{currentCursor: unknown, planPayload: unknown, planRef: unknown, startPayload: unknown, startRef: unknown, outputPayload: unknown, outputRef: unknown, selectedOutput?: {binding: unknown, payload: unknown}, sequence: number, observedAt: number}} value - Completed running activity materialization.
 * @returns {ReturnType<typeof materializeWorkflowActivityCompletion>} - Exact successor or terminal materialization.
 */
export function materializeWorkflowActivitySuccess(value) {
  return materializeWorkflowActivityCompletion(value, {
    label: 'completed workflow activity materialization',
    currentDisposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
  });
}

/**
 * Resolve one blocked uncertain workflow activity from an independently
 * verified successful transcript. The abandoned physical attempt remains a
 * ledger concern; this helper derives the same logical output and atomic
 * continuation shape as an ordinary success without weakening that API.
 * @param {{currentCursor: unknown, planPayload: unknown, planRef: unknown, startPayload: unknown, startRef: unknown, outputPayload: unknown, outputRef: unknown, selectedOutput?: {binding: unknown, payload: unknown}, sequence: number, observedAt: number}} value - Completed uncertain activity materialization.
 * @returns {ReturnType<typeof materializeWorkflowActivityCompletion>} - Exact successor or terminal materialization.
 */
export function materializeUncertainWorkflowActivitySuccess(value) {
  return materializeWorkflowActivityCompletion(value, {
    label: 'resolved uncertain workflow activity materialization',
    currentDisposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
  });
}

/**
 * Materialize one verified failed activity as a terminal workflow cursor. The
 * explicit Activity Protocol outcome is retained as a distinct canonical
 * disposition. A failure never appends an output or creates a successor.
 * Exported wrappers keep ordinary completion and uncertainty reconciliation
 * as separate authority boundaries.
 * @param {unknown} value - Candidate failed activity materialization.
 * @param {{label: string, currentDisposition: string}} options - Exact supported failure source.
 * @returns {{runId: string, planPayload: ReturnType<typeof normalizeWorkflowPlanPayload>, planRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, startPayload: ReturnType<typeof normalizeWorkflowStartPayload>, startRef: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, planId: string, outcome: 'failed'|'protocol-failed', cursor: Record<string, any>}} - Exact terminal failure materialization.
 */
function materializeWorkflowActivityTerminalFailure(value, options) {
  const { label } = options;
  const materialization = cloneBoundedJsonObject(
    value,
    WORKFLOW_PLAN_PAYLOAD_MAX_BYTES +
      WORKFLOW_START_PAYLOAD_MAX_BYTES +
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES * 2,
    label,
  );
  assertExactKeys(
    materialization,
    [
      'currentCursor',
      'planPayload',
      'planRef',
      'startPayload',
      'startRef',
      'outcome',
      'sequence',
      'observedAt',
    ],
    label,
  );
  const context = normalizeWorkflowPayloadContext(materialization, label);
  const currentCursor = normalizeWorkflowCursor(
    materialization.currentCursor,
    `${label}.currentCursor`,
  );
  if (currentCursor.disposition !== options.currentDisposition) {
    throw new TypeError(
      `${label}.currentCursor must have disposition ${options.currentDisposition}.`,
    );
  }
  const currentStep = assertWorkflowCursorContext(
    currentCursor,
    context,
    `${label}.currentCursor`,
  );
  if (currentStep.kind !== 'activity') {
    throw new TypeError(`${label}.currentCursor must name an activity step.`);
  }
  const expectedInvocationId = createWorkflowInvocationId({
    runId: currentCursor.runId,
    continuationId: currentCursor.continuationId,
    stepId: currentCursor.stepId,
    stepIndex: currentCursor.stepIndex,
    activityId: currentStep.activity,
  });
  if (currentCursor.invocationId !== expectedInvocationId) {
    throw new TypeError(
      `${label}.currentCursor invocationId does not match its exact activity activation.`,
    );
  }
  let disposition;
  if (materialization.outcome === 'failed') {
    disposition = WorkflowCursorDisposition.FAILED;
  } else if (materialization.outcome === 'protocol-failed') {
    disposition = WorkflowCursorDisposition.PROTOCOL_FAILED;
  } else {
    throw new TypeError(
      `${label}.outcome must be either failed or protocol-failed.`,
    );
  }
  const sequence = assertPositiveSafeInteger(
    materialization.sequence,
    `${label}.sequence`,
  );
  if (sequence !== currentCursor.lastSequence + 1) {
    throw new TypeError(
      `${label}.sequence must immediately follow currentCursor.lastSequence.`,
    );
  }
  const observedAt = assertPositiveSafeInteger(
    materialization.observedAt,
    `${label}.observedAt`,
  );
  if (observedAt < currentCursor.updatedAt) {
    throw new TypeError(
      `${label}.observedAt must not precede currentCursor.updatedAt.`,
    );
  }
  const cursor = normalizeWorkflowCursor(
    {
      ...currentCursor,
      disposition,
      version: currentCursor.version + 1,
      lastSequence: sequence,
      updatedAt: observedAt,
    },
    `${label}.cursor`,
  );
  return {
    runId: currentCursor.runId,
    ...context,
    outcome: materialization.outcome,
    cursor,
  };
}

/**
 * Materialize a verified failed terminal for the current running activity.
 * @param {{currentCursor: unknown, planPayload: unknown, planRef: unknown, startPayload: unknown, startRef: unknown, outcome: 'failed'|'protocol-failed', sequence: number, observedAt: number}} value - Failed running activity materialization.
 * @returns {ReturnType<typeof materializeWorkflowActivityTerminalFailure>} - Exact terminal failure materialization.
 */
export function materializeWorkflowActivityFailure(value) {
  return materializeWorkflowActivityTerminalFailure(value, {
    label: 'failed workflow activity materialization',
    currentDisposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
  });
}

/**
 * Resolve one blocked uncertain workflow activity from independently verified
 * failed or protocol-failed evidence without rewriting its physical attempt.
 * @param {{currentCursor: unknown, planPayload: unknown, planRef: unknown, startPayload: unknown, startRef: unknown, outcome: 'failed'|'protocol-failed', sequence: number, observedAt: number}} value - Failed uncertain activity materialization.
 * @returns {ReturnType<typeof materializeWorkflowActivityTerminalFailure>} - Exact terminal failure materialization.
 */
export function materializeUncertainWorkflowActivityFailure(value) {
  return materializeWorkflowActivityTerminalFailure(value, {
    label: 'resolved uncertain workflow activity failure materialization',
    currentDisposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
  });
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
  const label = 'first workflow activity materialization';
  const materialization = cloneBoundedJsonObject(
    value,
    WORKFLOW_PLAN_PAYLOAD_MAX_BYTES +
      WORKFLOW_START_PAYLOAD_MAX_BYTES +
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
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
    label,
  );
  assertWorkflowRunId(materialization.runId, `${label}.runId`);
  const context = normalizeWorkflowPayloadContext(materialization, label);
  const observedAt = assertPositiveSafeInteger(
    materialization.observedAt,
    `${label}.observedAt`,
  );
  const firstStep = context.planPayload.definition.steps[0];
  if (firstStep.kind !== 'activity') {
    throw new TypeError(
      `${label} requires an activity-headed workflow; timer and signal first steps are not implemented.`,
    );
  }
  const continuationId = createWorkflowContinuationId({
    runId: materialization.runId,
    planId: context.planId,
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
    appId: context.planPayload.appId,
    revisionId: context.planPayload.revisionId,
    workflowId: context.planPayload.workflowId,
    planId: context.planId,
    planRef: context.planRef,
    startRef: context.startRef,
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
  const selected = materializeNormalizedWorkflowActivityAtCursor({
    context,
    cursor,
    label,
  });
  return {
    runId: selected.runId,
    planPayload: selected.planPayload,
    planRef: selected.planRef,
    startPayload: selected.startPayload,
    startRef: selected.startRef,
    planId: selected.planId,
    continuationId: selected.continuationId,
    invocationId: selected.invocationId,
    activityId: selected.activityId,
    activityRequest: selected.activityRequest,
    cursor: selected.cursor,
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
  materializeUncertainWorkflowActivityFailure,
  materializeUncertainWorkflowActivitySuccess,
  materializeWorkflowActivityClaimRelease,
  materializeWorkflowActivityFailure,
  materializeWorkflowActivitySuccess,
  materializeWorkflowActivityUncertainty,
  materializeWorkflowCursorActivity,
  isWorkflowActivityDispatchSupported,
  normalizeWorkflowActivityRequest,
  normalizeWorkflowCursor,
  normalizeWorkflowOutputBinding,
  normalizeWorkflowOutputPayload,
  normalizeWorkflowPlanPayload,
  normalizeWorkflowStartPayload,
};
