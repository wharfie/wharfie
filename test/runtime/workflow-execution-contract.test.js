/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';

import { EXECUTION_LEDGER_SCHEMA_VERSION } from '../../src/core/lib/ledger/execution-ledger-contract.js';
import {
  WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES,
  WORKFLOW_ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
  WORKFLOW_CONTINUATION_ID_DOMAIN,
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_INVOCATION_ID_DOMAIN,
  WORKFLOW_OUTPUT_PAYLOAD_KIND,
  WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES,
  WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
  WORKFLOW_PLAN_ID_DOMAIN,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  WORKFLOW_PLAN_PAYLOAD_MAX_BYTES,
  WORKFLOW_PLAN_PAYLOAD_SCHEMA,
  WORKFLOW_RUN_ID_DOMAIN,
  WORKFLOW_SIGNAL_WAIT_ID_DOMAIN,
  WORKFLOW_START_PAYLOAD_KIND,
  WORKFLOW_START_PAYLOAD_MAX_BYTES,
  WORKFLOW_START_PAYLOAD_SCHEMA,
  WORKFLOW_TIMER_ID_DOMAIN,
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
} from '../../src/core/lib/ledger/workflow-execution-contract.js';
import {
  createExecutionPayloadReference,
  encodeCanonicalJsonPayload,
} from '../../src/core/runtime/execution-payload.js';
import { WORKFLOW_DEFINITIONS_MAX_BYTES } from '../../src/core/runtime/workflow-definition.js';

const APP_ID = 'workflow-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('workflow-revision')
  .digest('base64url')}`;
const WORKFLOW_ID = 'greet-later';
const STORE_ID = 'workflow-payloads';

/** @param {any} value @returns {any} */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {Record<string, any>} [firstStep]
 * @returns {Record<string, any>}
 */
function planPayload(firstStep = activityStep()) {
  return {
    schemaVersion: 1,
    kind: WORKFLOW_PLAN_PAYLOAD_KIND,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition: {
      steps: [
        firstStep,
        { id: 'pause', kind: 'timer', delayMs: 1_000 },
        { id: 'approved', kind: 'signal' },
      ],
    },
  };
}

/**
 * @param {any} [input]
 * @returns {Record<string, any>}
 */
function activityStep(input = { kind: 'workflow-input' }) {
  return {
    id: 'greet',
    kind: 'activity',
    activity: 'greet',
    input,
  };
}

/**
 * @param {any} [input]
 * @returns {Record<string, any>}
 */
function startPayload(input = { name: 'Ada' }) {
  return {
    schemaVersion: 1,
    kind: WORKFLOW_START_PAYLOAD_KIND,
    input,
    callerMetadata: { request: 'request-1' },
  };
}

/**
 * @param {unknown} value
 * @param {string} payloadSchema
 * @returns {Readonly<import('../../src/core/runtime/execution-payload.js').ExecutionPayloadReference>}
 */
function payloadReference(value, payloadSchema) {
  return createExecutionPayloadReference({
    bytes: encodeCanonicalJsonPayload(value),
    payloadSchema,
    storeId: STORE_ID,
  });
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {{runId: string, planPayload: any, planRef: Readonly<import('../../src/core/runtime/execution-payload.js').ExecutionPayloadReference>, startPayload: any, startRef: Readonly<import('../../src/core/runtime/execution-payload.js').ExecutionPayloadReference>, observedAt: number}}
 */
function materializationInput(overrides = {}) {
  const plan = normalizeWorkflowPlanPayload(
    Object.prototype.hasOwnProperty.call(overrides, 'planPayload')
      ? overrides.planPayload
      : planPayload(),
  );
  const start = normalizeWorkflowStartPayload(
    Object.prototype.hasOwnProperty.call(overrides, 'startPayload')
      ? overrides.startPayload
      : startPayload(),
  );
  return /** @type {{runId: string, planPayload: any, planRef: Readonly<import('../../src/core/runtime/execution-payload.js').ExecutionPayloadReference>, startPayload: any, startRef: Readonly<import('../../src/core/runtime/execution-payload.js').ExecutionPayloadReference>, observedAt: number}} */ ({
    runId: createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'workflow-request-1',
    }),
    planPayload: plan,
    planRef: payloadReference(plan, WORKFLOW_PLAN_PAYLOAD_SCHEMA),
    startPayload: start,
    startRef: payloadReference(start, WORKFLOW_START_PAYLOAD_SCHEMA),
    observedAt: 1_750_000_000_000,
    ...overrides,
  });
}

describe('workflow execution contract', () => {
  it('publishes explicit payload schemas and byte ceilings', () => {
    expect(WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION).toBe(1);
    expect(WORKFLOW_PLAN_PAYLOAD_SCHEMA).toBe(
      'wharfie.execution.workflow-plan.v1',
    );
    expect(WORKFLOW_START_PAYLOAD_SCHEMA).toBe(
      'wharfie.execution.workflow-start-request.v1',
    );
    expect(WORKFLOW_OUTPUT_PAYLOAD_SCHEMA).toBe(
      'wharfie.execution.workflow-output.v1',
    );
    expect(WORKFLOW_ACTIVITY_REQUEST_PAYLOAD_SCHEMA).toBe(
      'wharfie.execution.activity-request.v1',
    );
    expect(WORKFLOW_PLAN_PAYLOAD_MAX_BYTES).toBe(
      WORKFLOW_DEFINITIONS_MAX_BYTES + 1024,
    );
    expect(WORKFLOW_START_PAYLOAD_MAX_BYTES).toBe(983_040);
    expect(WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES).toBe(983_040);
    expect(WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES).toBe(983_040);
    expect(WorkflowCursorDisposition).toEqual({
      ACTIVITY_RUNNABLE: 'ACTIVITY_RUNNABLE',
    });
    expect(Object.isFrozen(WorkflowCursorDisposition)).toBe(true);
  });

  it('normalizes one strict independently cloned plan payload', () => {
    const source = planPayload();
    const normalized = normalizeWorkflowPlanPayload(source);

    expect(normalized).toEqual(source);
    expect(normalized).not.toBe(source);
    expect(normalized.definition).not.toBe(source.definition);
    source.definition.steps[0].activity = 'changed';
    expect(/** @type {any} */ (normalized.definition.steps[0]).activity).toBe(
      'greet',
    );
  });

  it.each([
    [
      'unknown fields',
      () => ({ ...planPayload(), retry: {} }),
      /must contain exactly/i,
    ],
    [
      'missing fields',
      () => {
        const value = planPayload();
        delete value.workflowId;
        return value;
      },
      /must contain exactly/i,
    ],
    [
      'schema version',
      () => ({ ...planPayload(), schemaVersion: 2 }),
      /schemaVersion must be the integer 1/i,
    ],
    [
      'kind',
      () => ({ ...planPayload(), kind: 'other' }),
      /kind must be 'workflowPlan'/i,
    ],
    [
      'workflow definition',
      () => ({ ...planPayload(), definition: { steps: [] } }),
      /steps must be a nonempty array/i,
    ],
  ])('rejects a plan payload with invalid %s', (_name, makeValue, expected) => {
    expect(() => normalizeWorkflowPlanPayload(makeValue())).toThrow(expected);
  });

  it('rejects a plan payload beyond its whole-document byte bound', () => {
    const oversized = planPayload(
      activityStep({
        kind: 'literal',
        value: 'x'.repeat(WORKFLOW_PLAN_PAYLOAD_MAX_BYTES),
      }),
    );
    expect(() => normalizeWorkflowPlanPayload(oversized)).toThrow(
      /must not exceed/i,
    );
  });

  it('normalizes strict start, output, and selected activity payloads', () => {
    const startSource = startPayload({ nested: ['value'] });
    const start = normalizeWorkflowStartPayload(startSource);
    const outputSource = {
      schemaVersion: 1,
      kind: WORKFLOW_OUTPUT_PAYLOAD_KIND,
      value: ['done'],
    };
    const output = normalizeWorkflowOutputPayload(outputSource);
    const requestSource = {
      input: { selected: true },
      callerMetadata: { trace: 'trace-1' },
    };
    const request = normalizeWorkflowActivityRequest(requestSource);

    expect(start).toEqual(startSource);
    expect(output).toEqual(outputSource);
    expect(request).toEqual(requestSource);
    startSource.input.nested[0] = 'changed';
    outputSource.value[0] = 'changed';
    requestSource.input.selected = false;
    expect(start.input).toEqual({ nested: ['value'] });
    expect(output.value).toEqual(['done']);
    expect(request.input).toEqual({ selected: true });
  });

  it('rejects malformed or oversized start, output, and activity payloads', () => {
    expect(() =>
      normalizeWorkflowStartPayload({
        ...startPayload(),
        callerMetadata: [],
      }),
    ).toThrow(/callerMetadata must be a JSON object/i);
    expect(() =>
      normalizeWorkflowOutputPayload({
        schemaVersion: 1,
        kind: WORKFLOW_OUTPUT_PAYLOAD_KIND,
        value: true,
        stepId: 'greet',
      }),
    ).toThrow(/must contain exactly/i);
    expect(() =>
      normalizeWorkflowActivityRequest({
        input: {},
        callerMetadata: {},
        retry: false,
      }),
    ).toThrow(/must contain exactly/i);
    expect(() =>
      normalizeWorkflowStartPayload(
        startPayload('x'.repeat(WORKFLOW_START_PAYLOAD_MAX_BYTES)),
      ),
    ).toThrow(/must not exceed/i);
    expect(() =>
      normalizeWorkflowOutputPayload({
        schemaVersion: 1,
        kind: WORKFLOW_OUTPUT_PAYLOAD_KIND,
        value: 'x'.repeat(WORKFLOW_OUTPUT_PAYLOAD_MAX_BYTES),
      }),
    ).toThrow(/must not exceed/i);
    expect(() =>
      normalizeWorkflowActivityRequest({
        input: 'x'.repeat(WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES),
        callerMetadata: {},
      }),
    ).toThrow(/must not exceed/i);
  });

  it('derives deterministic domain-separated workflow identities', () => {
    const runId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'request-1',
    });
    const sameRunId = createWorkflowRunId({
      idempotencyKey: 'request-1',
      appId: APP_ID,
    });
    const planId = createWorkflowPlanId(planPayload());
    const samePlanId = createWorkflowPlanId({
      definition: clone(planPayload().definition),
      workflowId: WORKFLOW_ID,
      revisionId: REVISION_ID,
      appId: APP_ID,
      kind: WORKFLOW_PLAN_PAYLOAD_KIND,
      schemaVersion: 1,
    });
    const activation = {
      runId,
      planId,
      stepId: 'greet',
      stepIndex: 0,
    };
    const continuationId = createWorkflowContinuationId(activation);
    const invocationId = createWorkflowInvocationId({
      runId,
      continuationId,
      stepId: 'greet',
      stepIndex: 0,
      activityId: 'greet',
    });
    const timerId = createWorkflowTimerId(activation);
    const signalWaitId = createWorkflowSignalWaitId(activation);

    expect(runId).toBe(sameRunId);
    expect(planId).toBe(samePlanId);
    expect(runId).toMatch(/^wfr_[A-Za-z0-9_-]{43}$/);
    expect(planId).toMatch(/^wfp_[A-Za-z0-9_-]{43}$/);
    expect(continuationId).toMatch(/^wfc_[A-Za-z0-9_-]{43}$/);
    expect(invocationId).toMatch(/^wfi_[A-Za-z0-9_-]{43}$/);
    expect(timerId).toMatch(/^wft_[A-Za-z0-9_-]{43}$/);
    expect(signalWaitId).toMatch(/^wfs_[A-Za-z0-9_-]{43}$/);
    expect(timerId).not.toBe(signalWaitId);
    expect(
      createWorkflowRunId({
        appId: APP_ID,
        idempotencyKey: 'request-2',
      }),
    ).not.toBe(runId);
    expect(
      createWorkflowPlanId({ ...planPayload(), workflowId: 'other-workflow' }),
    ).not.toBe(planId);
    expect(
      createWorkflowContinuationId({ ...activation, stepIndex: 1 }),
    ).not.toBe(continuationId);
    expect(
      createWorkflowInvocationId({
        runId,
        continuationId,
        stepId: 'greet',
        stepIndex: 0,
        activityId: 'other-activity',
      }),
    ).not.toBe(invocationId);

    expect(() => assertWorkflowRunId(runId)).not.toThrow();
    expect(() => assertWorkflowPlanId(planId)).not.toThrow();
    expect(() => assertWorkflowContinuationId(continuationId)).not.toThrow();
    expect(() => assertWorkflowInvocationId(invocationId)).not.toThrow();
    expect(() => assertWorkflowTimerId(timerId)).not.toThrow();
    expect(() => assertWorkflowSignalWaitId(signalWaitId)).not.toThrow();
    expect(WORKFLOW_RUN_ID_DOMAIN).toBe('wharfie:workflow-run:v1');
    expect(WORKFLOW_PLAN_ID_DOMAIN).toBe('wharfie:workflow-plan:v1');
    expect(WORKFLOW_CONTINUATION_ID_DOMAIN).toContain('continuation');
    expect(WORKFLOW_INVOCATION_ID_DOMAIN).toContain('invocation');
    expect(WORKFLOW_TIMER_ID_DOMAIN).toContain('timer');
    expect(WORKFLOW_SIGNAL_WAIT_ID_DOMAIN).toContain('signal-wait');
  });

  it('rejects malformed or out-of-range identity inputs', () => {
    expect(() =>
      createWorkflowRunId(
        /** @type {any} */ ({
          appId: APP_ID,
          idempotencyKey: 'request-1',
          revisionId: REVISION_ID,
        }),
      ),
    ).toThrow(/must contain exactly/i);
    expect(() =>
      createWorkflowContinuationId({
        runId: 'run-1',
        planId: createWorkflowPlanId(planPayload()),
        stepId: 'greet',
        stepIndex: 0,
      }),
    ).toThrow(/wfr_/i);
    const runId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'request-1',
    });
    const planId = createWorkflowPlanId(planPayload());
    expect(() =>
      createWorkflowTimerId({
        runId,
        planId,
        stepId: 'timer',
        stepIndex: 64,
      }),
    ).toThrow(/less than 64/i);
  });

  it('materializes a deterministic workflow-input activity and initial cursor', () => {
    const input = materializationInput();
    const first = materializeFirstWorkflowActivity(input);
    const replay = materializeFirstWorkflowActivity(input);

    expect(first).toEqual(replay);
    expect(first.activityId).toBe('greet');
    expect(first.activityRequest).toEqual({
      input: { name: 'Ada' },
      callerMetadata: { request: 'request-1' },
    });
    expect(first.planId).toBe(createWorkflowPlanId(input.planPayload));
    expect(first.cursor).toEqual({
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId: input.runId,
      appId: APP_ID,
      revisionId: REVISION_ID,
      workflowId: WORKFLOW_ID,
      planId: first.planId,
      planRef: input.planRef,
      startRef: input.startRef,
      stepId: 'greet',
      stepIndex: 0,
      continuationId: first.continuationId,
      invocationId: first.invocationId,
      disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
      outputs: [],
      version: 1,
      lastSequence: 1,
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
    });
    expect(normalizeWorkflowCursor(first.cursor)).toEqual(first.cursor);
  });

  it('selects an authored literal without changing caller metadata', () => {
    const plan = normalizeWorkflowPlanPayload(
      planPayload(
        activityStep({ kind: 'literal', value: { authored: 'value' } }),
      ),
    );
    const result = materializeFirstWorkflowActivity(
      materializationInput({
        planPayload: plan,
        planRef: payloadReference(plan, WORKFLOW_PLAN_PAYLOAD_SCHEMA),
      }),
    );

    expect(result.activityRequest).toEqual({
      input: { authored: 'value' },
      callerMetadata: { request: 'request-1' },
    });
  });

  it.each([
    ['timer', { id: 'first-pause', kind: 'timer', delayMs: 1_000 }],
    ['signal', { id: 'first-approval', kind: 'signal' }],
  ])(
    'rejects a %s-headed workflow in the first materializer',
    (_kind, step) => {
      const plan = normalizeWorkflowPlanPayload(planPayload(step));
      expect(() =>
        materializeFirstWorkflowActivity(
          materializationInput({
            planPayload: plan,
            planRef: payloadReference(plan, WORKFLOW_PLAN_PAYLOAD_SCHEMA),
          }),
        ),
      ).toThrow(/activity-headed workflow/i);
    },
  );

  it('rejects references that do not name the exact normalized payload bytes', () => {
    const input = materializationInput();
    const changedPlan = normalizeWorkflowPlanPayload({
      ...input.planPayload,
      workflowId: 'changed-workflow',
    });
    const changedStart = normalizeWorkflowStartPayload(
      startPayload({ name: 'Grace' }),
    );

    expect(() =>
      materializeFirstWorkflowActivity({
        ...input,
        planRef: payloadReference(changedPlan, WORKFLOW_PLAN_PAYLOAD_SCHEMA),
      }),
    ).toThrow(/reference does not match its exact bytes/i);
    expect(() =>
      materializeFirstWorkflowActivity({
        ...input,
        startRef: payloadReference(changedStart, WORKFLOW_START_PAYLOAD_SCHEMA),
      }),
    ).toThrow(/reference does not match its exact bytes/i);
    expect(() =>
      materializeFirstWorkflowActivity({
        ...input,
        planRef: payloadReference(
          input.planPayload,
          WORKFLOW_START_PAYLOAD_SCHEMA,
        ),
      }),
    ).toThrow(/payloadSchema/i);
  });

  it('rejects a selected literal whose whole activity request exceeds its bound', () => {
    const plan = normalizeWorkflowPlanPayload(
      planPayload(
        activityStep({
          kind: 'literal',
          value: 'x'.repeat(WORKFLOW_ACTIVITY_REQUEST_MAX_BYTES),
        }),
      ),
    );
    expect(() =>
      materializeFirstWorkflowActivity(
        materializationInput({
          planPayload: plan,
          planRef: payloadReference(plan, WORKFLOW_PLAN_PAYLOAD_SCHEMA),
        }),
      ),
    ).toThrow(/must not exceed/i);
  });

  it('strictly validates cursor references, identities, lifecycle, and time', () => {
    const cursor = materializeFirstWorkflowActivity(
      materializationInput(),
    ).cursor;
    const invalidCases = [
      { ...clone(cursor), disposition: 'TIMER_WAITING' },
      { ...clone(cursor), outputs: [{ stepId: 'prior' }] },
      { ...clone(cursor), continuationId: cursor.invocationId },
      { ...clone(cursor), updatedAt: cursor.createdAt - 1 },
      { ...clone(cursor), schemaVersion: 9 },
      {
        ...clone(cursor),
        planRef: payloadReference(
          startPayload(),
          WORKFLOW_START_PAYLOAD_SCHEMA,
        ),
      },
    ];

    for (const invalid of invalidCases) {
      expect(() => normalizeWorkflowCursor(invalid)).toThrow();
    }
    const unknown = { ...clone(cursor), retry: {} };
    expect(() => normalizeWorkflowCursor(unknown)).toThrow(
      /must contain exactly/i,
    );
  });
});
