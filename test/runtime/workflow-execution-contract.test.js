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
  materializeWorkflowActivitySuccess,
  materializeWorkflowCursorActivity,
  normalizeWorkflowActivityRequest,
  normalizeWorkflowCursor,
  normalizeWorkflowOutputBinding,
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

/**
 * @param {Record<string, any>[]} steps
 * @returns {Record<string, any>}
 */
function planWithSteps(steps) {
  return {
    schemaVersion: 1,
    kind: WORKFLOW_PLAN_PAYLOAD_KIND,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition: { steps },
  };
}

/**
 * @param {Record<string, any>[]} steps
 * @param {Record<string, any>} [start]
 * @returns {{input: ReturnType<typeof materializationInput>, first: ReturnType<typeof materializeFirstWorkflowActivity>}}
 */
function firstForSteps(steps, start = startPayload()) {
  const plan = normalizeWorkflowPlanPayload(planWithSteps(steps));
  const normalizedStart = normalizeWorkflowStartPayload(start);
  const input = materializationInput({
    planPayload: plan,
    planRef: payloadReference(plan, WORKFLOW_PLAN_PAYLOAD_SCHEMA),
    startPayload: normalizedStart,
    startRef: payloadReference(normalizedStart, WORKFLOW_START_PAYLOAD_SCHEMA),
  });
  return { input, first: materializeFirstWorkflowActivity(input) };
}

/**
 * @param {Record<string, any>} cursor
 * @param {number} [sequence]
 * @param {number} [observedAt]
 * @returns {Record<string, any>}
 */
function runningCursor(
  cursor,
  sequence = cursor.lastSequence + 1,
  observedAt = cursor.updatedAt + 1,
) {
  return normalizeWorkflowCursor({
    ...clone(cursor),
    disposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
    version: cursor.version + 1,
    lastSequence: sequence,
    updatedAt: observedAt,
  });
}

/**
 * @param {any} value
 * @returns {{payload: ReturnType<typeof normalizeWorkflowOutputPayload>, ref: Readonly<import('../../src/core/runtime/execution-payload.js').ExecutionPayloadReference>}}
 */
function output(value) {
  const payload = normalizeWorkflowOutputPayload({
    schemaVersion: 1,
    kind: WORKFLOW_OUTPUT_PAYLOAD_KIND,
    value,
  });
  return {
    payload,
    ref: payloadReference(payload, WORKFLOW_OUTPUT_PAYLOAD_SCHEMA),
  };
}

/**
 * @param {{stepId: string, stepIndex: number, value: any}} value
 * @returns {{binding: ReturnType<typeof normalizeWorkflowOutputBinding>, payload: ReturnType<typeof normalizeWorkflowOutputPayload>}}
 */
function selectedOutput({ stepId, stepIndex, value }) {
  const persisted = output(value);
  return {
    binding: normalizeWorkflowOutputBinding({
      stepId,
      stepIndex,
      outputRef: persisted.ref,
    }),
    payload: persisted.payload,
  };
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
      ACTIVITY_RUNNING: 'ACTIVITY_RUNNING',
      COMPLETED: 'COMPLETED',
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

  it('normalizes strict output bindings and canonical active or completed cursor prefixes', () => {
    const steps = [
      activityStep(),
      {
        id: 'format',
        kind: 'activity',
        activity: 'format',
        input: { kind: 'step-output', step: 'greet' },
      },
    ];
    const { input, first } = firstForSteps(steps);
    const firstOutput = selectedOutput({
      stepId: 'greet',
      stepIndex: 0,
      value: { greeting: 'hello' },
    });
    const continuationId = createWorkflowContinuationId({
      runId: first.runId,
      planId: first.planId,
      stepId: 'format',
      stepIndex: 1,
    });
    const invocationId = createWorkflowInvocationId({
      runId: first.runId,
      continuationId,
      stepId: 'format',
      stepIndex: 1,
      activityId: 'format',
    });
    const active = normalizeWorkflowCursor({
      ...clone(first.cursor),
      stepId: 'format',
      stepIndex: 1,
      continuationId,
      invocationId,
      disposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
      outputs: [firstOutput.binding],
      version: 2,
      lastSequence: 2,
      updatedAt: input.observedAt + 1,
    });
    const secondOutput = selectedOutput({
      stepId: 'format',
      stepIndex: 1,
      value: { formatted: true },
    });
    const completed = normalizeWorkflowCursor({
      ...active,
      disposition: WorkflowCursorDisposition.COMPLETED,
      outputs: [firstOutput.binding, secondOutput.binding],
      version: 3,
      lastSequence: 3,
      updatedAt: input.observedAt + 2,
    });

    expect(active.outputs).toEqual([firstOutput.binding]);
    expect(completed.outputs).toEqual([
      firstOutput.binding,
      secondOutput.binding,
    ]);
    expect(normalizeWorkflowOutputBinding(firstOutput.binding)).toEqual(
      firstOutput.binding,
    );

    const malformed = [
      {
        ...active,
        outputs: [{ ...firstOutput.binding, retry: false }],
      },
      {
        ...active,
        outputs: [{ ...firstOutput.binding, stepIndex: 1 }],
      },
      {
        ...active,
        outputs: [
          firstOutput.binding,
          { ...secondOutput.binding, stepId: 'greet' },
        ],
      },
      { ...active, outputs: [] },
      { ...active, outputs: [secondOutput.binding] },
      {
        ...completed,
        outputs: [firstOutput.binding],
      },
      {
        ...completed,
        outputs: [
          firstOutput.binding,
          { ...secondOutput.binding, stepId: 'x' },
        ],
      },
      {
        ...active,
        outputs: [
          {
            ...firstOutput.binding,
            outputRef: payloadReference(
              firstOutput.payload,
              WORKFLOW_START_PAYLOAD_SCHEMA,
            ),
          },
        ],
      },
    ];
    for (const cursor of malformed) {
      expect(() => normalizeWorkflowCursor(cursor)).toThrow();
    }
  });

  it.each([
    ['workflow input', { kind: 'workflow-input' }, { name: 'Ada' }],
    [
      'literal',
      { kind: 'literal', value: { authored: true } },
      { authored: true },
    ],
  ])(
    'materializes a cursor activity using %s',
    (_name, selector, expectedInput) => {
      const { input, first } = firstForSteps([activityStep(selector)]);
      const materialized = materializeWorkflowCursorActivity({
        planPayload: input.planPayload,
        planRef: input.planRef,
        startPayload: input.startPayload,
        startRef: input.startRef,
        cursor: first.cursor,
      });

      expect(materialized).toMatchObject({
        runId: first.runId,
        planId: first.planId,
        stepId: 'greet',
        stepIndex: 0,
        continuationId: first.continuationId,
        invocationId: first.invocationId,
        activityId: 'greet',
        activityRequest: {
          input: expectedInput,
          callerMetadata: { request: 'request-1' },
        },
      });
      expect(materialized.cursor).toEqual(first.cursor);
    },
  );

  it('requires and rehashes the exact prior output selected by a cursor activity', () => {
    const steps = [
      activityStep(),
      {
        id: 'format',
        kind: 'activity',
        activity: 'format',
        input: { kind: 'step-output', step: 'greet' },
      },
    ];
    const { input, first } = firstForSteps(steps);
    const firstOutput = output({ greeting: 'hello' });
    const success = materializeWorkflowActivitySuccess({
      currentCursor: runningCursor(first.cursor),
      planPayload: input.planPayload,
      planRef: input.planRef,
      startPayload: input.startPayload,
      startRef: input.startRef,
      outputPayload: firstOutput.payload,
      outputRef: firstOutput.ref,
      sequence: 3,
      observedAt: input.observedAt + 2,
    });
    const selected = {
      binding: success.outputBinding,
      payload: firstOutput.payload,
    };

    expect(
      materializeWorkflowCursorActivity({
        planPayload: input.planPayload,
        planRef: input.planRef,
        startPayload: input.startPayload,
        startRef: input.startRef,
        cursor: success.cursor,
        selectedOutput: selected,
      }).activityRequest,
    ).toEqual({
      input: { greeting: 'hello' },
      callerMetadata: { request: 'request-1' },
    });
    expect(() =>
      materializeWorkflowCursorActivity({
        planPayload: input.planPayload,
        planRef: input.planRef,
        startPayload: input.startPayload,
        startRef: input.startRef,
        cursor: success.cursor,
      }),
    ).toThrow(/selectedOutput must match/i);
    expect(() =>
      materializeWorkflowCursorActivity({
        planPayload: input.planPayload,
        planRef: input.planRef,
        startPayload: input.startPayload,
        startRef: input.startRef,
        cursor: success.cursor,
        selectedOutput: {
          binding: success.outputBinding,
          payload: output({ greeting: 'changed' }).payload,
        },
      }),
    ).toThrow(/reference does not match its exact bytes/i);
  });

  it.each([
    ['workflow input', { kind: 'workflow-input' }, { name: 'Ada' }],
    [
      'literal',
      { kind: 'literal', value: { authored: true } },
      { authored: true },
    ],
  ])(
    'materializes one stable successor activity using %s',
    (_name, selector, expectedInput) => {
      const steps = [
        activityStep(),
        {
          id: 'next',
          kind: 'activity',
          activity: 'next',
          input: selector,
        },
      ];
      const { input, first } = firstForSteps(steps);
      const persistedOutput = output({ greeting: 'hello' });
      const request = {
        currentCursor: runningCursor(first.cursor),
        planPayload: input.planPayload,
        planRef: input.planRef,
        startPayload: input.startPayload,
        startRef: input.startRef,
        outputPayload: persistedOutput.payload,
        outputRef: persistedOutput.ref,
        sequence: 3,
        observedAt: input.observedAt + 2,
      };
      const success = materializeWorkflowActivitySuccess(request);
      const replay = materializeWorkflowActivitySuccess(request);

      expect(success).toEqual(replay);
      expect(success.completed).toBe(false);
      expect(success.outputBinding).toEqual({
        stepId: 'greet',
        stepIndex: 0,
        outputRef: persistedOutput.ref,
      });
      expect(success.nextActivity).toEqual({
        stepId: 'next',
        stepIndex: 1,
        continuationId: createWorkflowContinuationId({
          runId: first.runId,
          planId: first.planId,
          stepId: 'next',
          stepIndex: 1,
        }),
        invocationId: success.cursor.invocationId,
        activityId: 'next',
        activityRequest: {
          input: expectedInput,
          callerMetadata: { request: 'request-1' },
        },
      });
      expect(success.nextActivity?.invocationId).toBe(
        createWorkflowInvocationId({
          runId: first.runId,
          continuationId: success.cursor.continuationId,
          stepId: 'next',
          stepIndex: 1,
          activityId: 'next',
        }),
      );
      expect(success.cursor).toMatchObject({
        stepId: 'next',
        stepIndex: 1,
        disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
        outputs: [success.outputBinding],
        version: 3,
        lastSequence: 3,
        createdAt: input.observedAt,
        updatedAt: input.observedAt + 2,
      });
    },
  );

  it('selects the just-completed current output for the next activity', () => {
    const { input, first } = firstForSteps([
      activityStep(),
      {
        id: 'consume-current',
        kind: 'activity',
        activity: 'consume',
        input: { kind: 'step-output', step: 'greet' },
      },
    ]);
    const persistedOutput = output({ greeting: 'hello' });
    const success = materializeWorkflowActivitySuccess({
      currentCursor: runningCursor(first.cursor),
      planPayload: input.planPayload,
      planRef: input.planRef,
      startPayload: input.startPayload,
      startRef: input.startRef,
      outputPayload: persistedOutput.payload,
      outputRef: persistedOutput.ref,
      sequence: 3,
      observedAt: input.observedAt + 2,
    });

    expect(success.nextActivity?.activityRequest.input).toEqual({
      greeting: 'hello',
    });
  });

  it('selects an exact older output when a later successor names it', () => {
    const { input, first } = firstForSteps([
      activityStep(),
      {
        id: 'middle',
        kind: 'activity',
        activity: 'middle',
        input: { kind: 'literal', value: { middle: true } },
      },
      {
        id: 'consume-first',
        kind: 'activity',
        activity: 'consume',
        input: { kind: 'step-output', step: 'greet' },
      },
    ]);
    const firstOutput = output({ first: true });
    const firstSuccess = materializeWorkflowActivitySuccess({
      currentCursor: runningCursor(first.cursor),
      planPayload: input.planPayload,
      planRef: input.planRef,
      startPayload: input.startPayload,
      startRef: input.startRef,
      outputPayload: firstOutput.payload,
      outputRef: firstOutput.ref,
      sequence: 3,
      observedAt: input.observedAt + 2,
    });
    const middleOutput = output({ middle: 'done' });
    const secondRequest = {
      currentCursor: runningCursor(
        firstSuccess.cursor,
        4,
        input.observedAt + 3,
      ),
      planPayload: input.planPayload,
      planRef: input.planRef,
      startPayload: input.startPayload,
      startRef: input.startRef,
      outputPayload: middleOutput.payload,
      outputRef: middleOutput.ref,
      sequence: 5,
      observedAt: input.observedAt + 4,
    };
    expect(() => materializeWorkflowActivitySuccess(secondRequest)).toThrow(
      /selectedOutput must match/i,
    );
    expect(() =>
      materializeWorkflowActivitySuccess({
        ...secondRequest,
        selectedOutput: selectedOutput({
          stepId: 'middle',
          stepIndex: 1,
          value: { middle: 'done' },
        }),
      }),
    ).toThrow(/selectedOutput must match/i);
    const secondSuccess = materializeWorkflowActivitySuccess({
      ...secondRequest,
      selectedOutput: {
        binding: firstSuccess.outputBinding,
        payload: firstOutput.payload,
      },
    });

    expect(secondSuccess.nextActivity?.activityRequest.input).toEqual({
      first: true,
    });
    expect(secondSuccess.cursor.outputs).toEqual([
      firstSuccess.outputBinding,
      secondSuccess.outputBinding,
    ]);
  });

  it('materializes a final successful activity as one retained terminal cursor', () => {
    const { input, first } = firstForSteps([activityStep()]);
    const persistedOutput = output({ greeting: 'done' });
    const success = materializeWorkflowActivitySuccess({
      currentCursor: runningCursor(first.cursor),
      planPayload: input.planPayload,
      planRef: input.planRef,
      startPayload: input.startPayload,
      startRef: input.startRef,
      outputPayload: persistedOutput.payload,
      outputRef: persistedOutput.ref,
      sequence: 3,
      observedAt: input.observedAt + 2,
    });

    expect(success.completed).toBe(true);
    expect(success).not.toHaveProperty('nextActivity');
    expect(success.cursor).toEqual({
      ...runningCursor(first.cursor),
      disposition: WorkflowCursorDisposition.COMPLETED,
      outputs: [success.outputBinding],
      version: 3,
      lastSequence: 3,
      updatedAt: input.observedAt + 2,
    });
    expect(normalizeWorkflowCursor(success.cursor)).toEqual(success.cursor);
  });

  it.each([
    ['timer', { id: 'pause', kind: 'timer', delayMs: 1_000 }],
    ['signal', { id: 'approval', kind: 'signal' }],
  ])('rejects a %s successor without advancing the cursor', (_name, next) => {
    const { input, first } = firstForSteps([activityStep(), next]);
    const persistedOutput = output({ greeting: 'done' });
    expect(() =>
      materializeWorkflowActivitySuccess({
        currentCursor: runningCursor(first.cursor),
        planPayload: input.planPayload,
        planRef: input.planRef,
        startPayload: input.startPayload,
        startRef: input.startRef,
        outputPayload: persistedOutput.payload,
        outputRef: persistedOutput.ref,
        sequence: 3,
        observedAt: input.observedAt + 2,
      }),
    ).toThrow(/timer and signal successors are not implemented/i);
  });

  it('rejects stale or mismatched success materializations', () => {
    const { input, first } = firstForSteps([
      activityStep(),
      {
        id: 'next',
        kind: 'activity',
        activity: 'next',
        input: { kind: 'workflow-input' },
      },
    ]);
    const currentCursor = runningCursor(first.cursor);
    const persistedOutput = output({ greeting: 'done' });
    const base = {
      currentCursor,
      planPayload: input.planPayload,
      planRef: input.planRef,
      startPayload: input.startPayload,
      startRef: input.startRef,
      outputPayload: persistedOutput.payload,
      outputRef: persistedOutput.ref,
      sequence: 3,
      observedAt: input.observedAt + 2,
    };
    const changedOutput = output({ greeting: 'changed' });
    const otherPlan = normalizeWorkflowPlanPayload(
      planWithSteps([
        { ...activityStep(), id: 'other' },
        input.planPayload.definition.steps[1],
      ]),
    );
    const invalid = [
      { ...base, sequence: 4 },
      { ...base, observedAt: currentCursor.updatedAt - 1 },
      { ...base, currentCursor: first.cursor },
      { ...base, outputRef: changedOutput.ref },
      {
        ...base,
        planPayload: otherPlan,
        planRef: payloadReference(otherPlan, WORKFLOW_PLAN_PAYLOAD_SCHEMA),
      },
      {
        ...base,
        selectedOutput: selectedOutput({
          stepId: 'greet',
          stepIndex: 0,
          value: { greeting: 'done' },
        }),
      },
    ];
    for (const candidate of invalid) {
      expect(() => materializeWorkflowActivitySuccess(candidate)).toThrow();
    }
  });
});
