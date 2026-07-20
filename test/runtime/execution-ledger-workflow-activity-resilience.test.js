/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtempSync, promises as fsp, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getAdapterMatrix } from '../helpers/db-adapters.js';
import {
  AttemptStatus,
  ExecutionLedgerConflictError,
  ExecutionLedgerProjectionError,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  ExecutionLedgerReadyWorkKind,
  createExecutionLedgerReadyWorkScope,
  getExecutionLedgerReadyWorkSortKey,
} from '../../src/core/lib/ledger/ready-work.js';
import {
  WORKFLOW_ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
  WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
  createWorkflowRunId,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { EXECUTION_LEDGER_SCHEMA_VERSION } from '../../src/core/lib/ledger/execution-ledger-contract.js';
import {
  getAttemptProjectionSortKey,
  getEventSortKey,
  getTransitionSortKey,
} from '../../src/core/lib/ledger/record-key.js';

const APP_ID = 'workflow-resilience-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('workflow-resilience-revision')
  .digest('base64url')}`;
const WORKFLOW_ID = 'resilient-workflow';
const FIRST_STEP_ID = 'first';
const SECOND_STEP_ID = 'second';
const FIRST_ACTIVITY_ID = 'first-activity';
const SECOND_ACTIVITY_ID = 'second-activity';
const BASE_OBSERVED_AT = 1_700_100_000_000;
const ACTOR = Object.freeze({ kind: 'worker', id: 'workflow-resilience-test' });

const TWO_ACTIVITY_DEFINITION = Object.freeze({
  steps: [
    {
      id: FIRST_STEP_ID,
      kind: 'activity',
      activity: FIRST_ACTIVITY_ID,
      input: { kind: 'workflow-input' },
    },
    {
      id: SECOND_STEP_ID,
      kind: 'activity',
      activity: SECOND_ACTIVITY_ID,
      input: { kind: 'step-output', step: FIRST_STEP_ID },
    },
  ],
});

const ONE_ACTIVITY_DEFINITION = Object.freeze({
  steps: [TWO_ACTIVITY_DEFINITION.steps[0]],
});

/**
 * @param {Record<string, any>} cursor - Persisted workflow cursor.
 * @returns {{version: number, continuationId: string, stepId: string, stepIndex: number}} Exact public CAS guard.
 */
function cursorGuard(cursor) {
  return {
    version: cursor.version,
    continuationId: cursor.continuationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
  };
}

/**
 * @param {Readonly<Record<string, any>>} start - Exact durable start frame.
 * @param {any} result - JSON workflow output.
 * @returns {Record<string, any>} Complete verified Activity Protocol evidence.
 */
function completedEvidence(start, result) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {Readonly<Record<string, any>>} start - Exact durable start frame.
 * @param {any} result - JSON workflow output.
 * @returns {Record<string, any>} Structurally valid evidence with an unauthorized host cancel frame.
 */
function completedEvidenceAfterCancel(start, result) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const cancel = transcript.acceptHostFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancel',
    attemptId: start.attemptId,
    reason: {
      code: 'workflow-cancel-without-durable-authority',
      name: 'WorkflowCancellationAuthorityError',
      message: 'No durable workflow cancellation decision exists.',
      details: {},
    },
  });
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, cancel, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {string} label - Scenario identity.
 * @returns {string} Stable app-scoped workflow run ID.
 */
function workflowRunId(label) {
  return createWorkflowRunId({ appId: APP_ID, idempotencyKey: label });
}

/**
 * @param {string} type - Durable transition type.
 * @param {Record<string, any>} value - Exact semantic request.
 * @returns {string} Production-compatible transition digest.
 */
function transitionDigest(type, value) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-transition:v10',
    prefix: 'wlt',
    value: {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      type,
      ...value,
    },
    valuePath: 'execution ledger transition',
  });
}

/**
 * @param {Record<string, any>} event - Raw immutable event record.
 * @returns {string} Production-compatible event ID.
 */
function eventIdFor(event) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-event:v10',
    prefix: 'wle',
    value: {
      schemaVersion: event.schema_version,
      runId: event.run_id,
      sequence: event.sequence,
      transitionId: event.transition_id,
      requestDigest: event.request_digest,
      type: event.type,
      observedAt: event.observed_at,
      actor: event.actor,
      fence: event.fence,
      payload: event.payload,
    },
    valuePath: 'ledger event identity',
  });
}

/**
 * @param {import('../../src/core/lib/db/base.js').DBClient} db - Adapter under test.
 * @param {string} tableName - Isolated ledger table.
 * @param {{putJson: (input: {value: unknown, payloadSchema: string}) => Promise<unknown>, readBytes: (reference: unknown) => Promise<unknown>}} payloadStore - Immutable payload store.
 * @returns {ReturnType<typeof createExecutionLedger>} Ledger instance.
 */
function createLedger(db, tableName, payloadStore) {
  return createExecutionLedger({ db, tableName, payloadStore });
}

/**
 * @param {ReturnType<typeof getAdapterMatrix>[number]} adapter - DB adapter factory.
 * @param {string} label - Scenario identity.
 * @returns {Promise<{db: import('../../src/core/lib/db/base.js').DBClient, payloadStore: ReturnType<typeof createLocalExecutionPayloadStore>, cleanup: () => Promise<void>}>} Isolated durable harness.
 */
async function createHarness(adapter, label) {
  const { db, cleanup: cleanupDb } = await adapter.create();
  const payloadRoot = mkdtempSync(
    join(tmpdir(), `wharfie-workflow-resilience-${adapter.name}-`),
  );
  const payloadStore = createLocalExecutionPayloadStore({
    path: payloadRoot,
    storeId: `workflow-${adapter.name}-${createHash('sha256')
      .update(label)
      .digest('hex')
      .slice(0, 16)}`,
  });
  return {
    db,
    payloadStore,
    async cleanup() {
      try {
        await cleanupDb();
      } finally {
        rmSync(payloadRoot, { recursive: true, force: true });
      }
    },
  };
}

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger - Workflow ledger.
 * @param {string} runId - Workflow run ID.
 * @param {string} label - Transition identity prefix.
 * @param {Record<string, any>} [definition] - Static workflow definition.
 * @returns {Promise<{created: Record<string, any>, claimed: Record<string, any>}>} CLAIMED workflow authority.
 */
async function createClaimedWorkflow(
  ledger,
  runId,
  label,
  definition = TWO_ACTIVITY_DEFINITION,
) {
  const created = await ledger.createWorkflowRun({
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition,
    input: { scenario: label },
    callerMetadata: { source: 'workflow-resilience-test' },
    transitionId: `${label}-create`,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT,
  });
  const claimed = await ledger.claimWorkflowActivity({
    runId,
    invocationId: created.invocation.invocationId,
    cursor: cursorGuard(created.workflowCursor),
    fencingToken: `${label}-fence`,
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: `${label}-claim`,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 1,
  });
  return { created, claimed };
}

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger - Workflow ledger.
 * @param {string} runId - Workflow run ID.
 * @param {string} label - Transition identity prefix.
 * @param {Record<string, any>} [definition] - Static workflow definition.
 * @returns {Promise<{created: Record<string, any>, claimed: Record<string, any>, started: Record<string, any>}>} STARTED workflow authority.
 */
async function createStartedWorkflow(
  ledger,
  runId,
  label,
  definition = TWO_ACTIVITY_DEFINITION,
) {
  const { created, claimed } = await createClaimedWorkflow(
    ledger,
    runId,
    label,
    definition,
  );
  const started = await ledger.markWorkflowActivityStarted({
    runId,
    invocationId: claimed.invocation.invocationId,
    cursor: cursorGuard(claimed.workflowCursor),
    attemptId: claimed.attempt.attemptId,
    fencingToken: claimed.attempt.fencingToken,
    generation: claimed.attempt.generation,
    expectedVersion: claimed.run.version,
    transitionId: `${label}-start`,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 2,
  });
  expect(started.dispatchAuthorized).toBe(true);
  return { created, claimed, started };
}

/**
 * @param {string} runId - Workflow run ID.
 * @param {Record<string, any>} claimed - CLAIMED transition result.
 * @param {string} transitionId - Stable claim-release identity.
 * @param {Record<string, any>} [reason] - Durable recovery reason.
 * @returns {Record<string, any>} Exact claim-release request.
 */
function workflowClaimReleaseRequest(
  runId,
  claimed,
  transitionId,
  reason = { code: 'coordinator-restarted' },
) {
  return {
    runId,
    invocationId: claimed.invocation.invocationId,
    cursor: cursorGuard(claimed.workflowCursor),
    attemptId: claimed.attempt.attemptId,
    fencingToken: claimed.attempt.fencingToken,
    generation: claimed.attempt.generation,
    expectedVersion: claimed.run.version,
    transitionId,
    reason,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 2,
  };
}

/**
 * @param {string} runId - Workflow run ID.
 * @param {Record<string, any>} started - STARTED transition result.
 * @param {string} transitionId - Stable uncertainty identity.
 * @param {Record<string, any>} [reason] - Durable uncertainty reason.
 * @returns {Record<string, any>} Exact uncertainty request.
 */
function workflowUncertaintyRequest(
  runId,
  started,
  transitionId,
  reason = { code: 'runner-outcome-lost' },
) {
  return {
    runId,
    invocationId: started.invocation.invocationId,
    cursor: cursorGuard(started.workflowCursor),
    attemptId: started.attempt.attemptId,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    expectedVersion: started.run.version,
    transitionId,
    reason,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 3,
  };
}

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger - Workflow ledger.
 * @param {string} runId - Workflow run ID.
 * @param {Record<string, any>} started - STARTED transition result.
 * @param {Record<string, any>} uncertain - Uncertainty transition result.
 * @param {string} transitionId - Stable reconciliation identity.
 * @param {any} result - Recovered logical workflow output.
 * @param {Record<string, any>} [reason] - Durable resolution reason.
 * @returns {Promise<Record<string, any>>} Exact evidence-backed resolution request.
 */
async function workflowReconciliationRequest(
  ledger,
  runId,
  started,
  uncertain,
  transitionId,
  result,
  reason = { code: 'stopped-runner-transcript-recovered' },
) {
  const uncertaintyEvent = (await ledger.getEvents(runId)).find(
    ({ type }) => type === 'workflow-activity-became-uncertain',
  );
  if (!uncertaintyEvent) {
    throw new Error('Expected the workflow uncertainty event.');
  }
  return {
    runId,
    invocationId: started.invocation.invocationId,
    cursor: cursorGuard(uncertain.workflowCursor),
    attemptId: started.attempt.attemptId,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    coordinatorEpoch: started.attempt.coordinatorEpoch,
    expectedVersion: uncertain.run.version,
    uncertaintyEventId: uncertaintyEvent.event_id,
    uncertaintySequence: uncertaintyEvent.sequence,
    transitionId,
    reconciliationId: `${transitionId}-decision`,
    reason,
    evidence: completedEvidence(started.startFrame, result),
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 4,
  };
}

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger - Workflow ledger.
 * @param {string} runId - Workflow run ID.
 * @param {string} label - Transition identity prefix.
 * @param {Record<string, any>} [definition] - Static workflow definition.
 * @returns {Promise<{created: Record<string, any>, claimed: Record<string, any>, started: Record<string, any>, uncertain: Record<string, any>}>} BLOCKED uncertain workflow authority.
 */
async function createUncertainWorkflow(
  ledger,
  runId,
  label,
  definition = TWO_ACTIVITY_DEFINITION,
) {
  const { created, claimed, started } = await createStartedWorkflow(
    ledger,
    runId,
    label,
    definition,
  );
  const uncertain = await ledger.markWorkflowActivityAttemptUncertain(
    workflowUncertaintyRequest(runId, started, `${label}-uncertain`),
  );
  return { created, claimed, started, uncertain };
}

/**
 * @param {string} runId - Workflow run ID.
 * @param {Record<string, any>} started - STARTED transition result.
 * @param {string} transitionId - Stable success transition identity.
 * @param {any} result - Logical workflow output.
 * @returns {Record<string, any>} Exact success request.
 */
function workflowSuccessRequest(runId, started, transitionId, result) {
  return {
    runId,
    invocationId: started.invocation.invocationId,
    cursor: cursorGuard(started.workflowCursor),
    attemptId: started.attempt.attemptId,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    expectedVersion: started.run.version,
    transitionId,
    evidence: completedEvidence(started.startFrame, result),
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 3,
  };
}

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger - Workflow ledger.
 * @returns {Promise<Record<string, any>>} Exact-revision ready-work page.
 */
async function listReadyWork(ledger) {
  return await ledger.listReadyWork({
    appId: APP_ID,
    revisionId: REVISION_ID,
    observedAt: Number.MAX_SAFE_INTEGER,
    limit: 100,
  });
}

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger - Workflow ledger.
 * @param {string} runId - Workflow run ID.
 * @param {Record<string, any>} started - Expected STARTED authority.
 * @returns {Promise<void>} Resolves after exact state assertions.
 */
async function expectStartedAuthority(ledger, runId, started) {
  await expect(ledger.getEvents(runId)).resolves.toHaveLength(3);
  await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
    head: { version: 3, sequence: 3 },
    run: {
      status: RunStatus.RUNNING,
      version: 3,
      lastSequence: 3,
    },
    workflowCursor: {
      invocationId: started.invocation.invocationId,
      disposition: 'ACTIVITY_RUNNING',
      version: 3,
      lastSequence: 3,
    },
    invocations: [
      expect.objectContaining({
        invocationId: started.invocation.invocationId,
        status: InvocationStatus.RUNNING,
      }),
    ],
    attempts: [
      expect.objectContaining({
        attemptId: started.attempt.attemptId,
        status: AttemptStatus.STARTED,
      }),
    ],
  });
  await expect(listReadyWork(ledger)).resolves.toMatchObject({
    items: [
      expect.objectContaining({
        runId,
        kind: ExecutionLedgerReadyWorkKind.RECOVERY,
        invocationId: started.invocation.invocationId,
        attemptId: started.attempt.attemptId,
        cursorVersion: 3,
      }),
    ],
  });
}

/**
 * @param {import('../../src/core/lib/db/base.js').DBClient} db - Adapter under test.
 * @param {string} tableName - Ledger table.
 * @param {Record<string, any>} ready - Public ready-work item.
 * @returns {Promise<void>} Resolves after corrupting its exact current row.
 */
async function corruptReadyWorkVersion(db, tableName, ready) {
  const scope = createExecutionLedgerReadyWorkScope({
    appId: APP_ID,
    revisionId: REVISION_ID,
  });
  await db.update({
    tableName,
    keyName: 'run_id',
    keyValue: scope.readyWorkId,
    sortKeyName: 'sort_key',
    sortKeyValue: getExecutionLedgerReadyWorkSortKey({
      availableAt: ready.availableAt,
      runId: ready.runId,
    }),
    updates: [
      {
        property: ['run_version'],
        propertyValue: ready.runVersion + 100,
      },
    ],
  });
}

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} workflow activity resilience`, () => {
    test.each(['ordinary-success', 'uncertain-reconciliation'])(
      'rejects unauthorized workflow cancel evidence before and after %s authority is retained',
      async (path) => {
        const harness = await createHarness(adapter, `cancel-evidence-${path}`);
        const tableName = `workflow-resilience-cancel-evidence-${path}`;
        const runId = workflowRunId(`${adapter.name}-cancel-evidence-${path}`);
        try {
          const ledger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          let validRequest;
          let mutation;
          if (path === 'ordinary-success') {
            const { started } = await createStartedWorkflow(
              ledger,
              runId,
              `cancel-evidence-${path}-${adapter.name}`,
            );
            validRequest = workflowSuccessRequest(
              runId,
              started,
              `cancel-evidence-${path}-${adapter.name}-transition`,
              { accepted: true },
            );
            mutation = (/** @type {Record<string, any>} */ request) =>
              ledger.commitVerifiedWorkflowActivityTerminal(request);
          } else {
            const { started, uncertain } = await createUncertainWorkflow(
              ledger,
              runId,
              `cancel-evidence-${path}-${adapter.name}`,
            );
            validRequest = await workflowReconciliationRequest(
              ledger,
              runId,
              started,
              uncertain,
              `cancel-evidence-${path}-${adapter.name}-transition`,
              { accepted: true },
            );
            mutation = (/** @type {Record<string, any>} */ request) =>
              ledger.reconcileUncertainWorkflowActivityAttempt(request);
          }
          const unauthorizedRequest = {
            ...validRequest,
            evidence: completedEvidenceAfterCancel(
              validRequest.evidence.start,
              {
                accepted: true,
              },
            ),
          };
          const before = await ledger.rebuildRun(runId);

          await expect(mutation(unauthorizedRequest)).rejects.toThrow(
            /workflow cancellation authority is not implemented/i,
          );
          await expect(ledger.rebuildRun(runId)).resolves.toEqual(before);

          const accepted = await mutation(validRequest);
          expect(accepted).toMatchObject({ applied: true });
          await expect(mutation(unauthorizedRequest)).rejects.toThrow(
            /workflow cancellation authority is not implemented/i,
          );
        } finally {
          await harness.cleanup();
        }
      },
    );

    test('releases an exact unstarted claim, replays it, and permits only the next generation to reclaim', async () => {
      const harness = await createHarness(adapter, 'claim-release');
      const tableName = 'workflow-resilience-claim-release';
      const runId = workflowRunId(`${adapter.name}-claim-release`);
      try {
        const ledger = createLedger(
          harness.db,
          tableName,
          harness.payloadStore,
        );
        const { claimed } = await createClaimedWorkflow(
          ledger,
          runId,
          `claim-release-${adapter.name}`,
        );
        const request = workflowClaimReleaseRequest(
          runId,
          claimed,
          `claim-release-${adapter.name}-release`,
        );
        const released =
          await ledger.abandonUnstartedWorkflowActivityAttempt(request);
        const replayed =
          await ledger.abandonUnstartedWorkflowActivityAttempt(request);

        expect(released).toMatchObject({
          applied: true,
          receipt: { type: 'workflow-activity-abandoned-before-start' },
          run: { status: RunStatus.RUNNING, version: 3, lastSequence: 3 },
          invocation: {
            invocationId: claimed.invocation.invocationId,
            status: InvocationStatus.RUNNABLE,
            generation: 1,
          },
          attempt: {
            attemptId: claimed.attempt.attemptId,
            status: AttemptStatus.ABANDONED,
            abandonment: { code: 'coordinator-restarted' },
          },
          workflowCursor: {
            invocationId: claimed.invocation.invocationId,
            continuationId: claimed.workflowCursor.continuationId,
            stepId: FIRST_STEP_ID,
            stepIndex: 0,
            disposition: 'ACTIVITY_RUNNABLE',
            outputs: [],
            version: 3,
            lastSequence: 3,
          },
        });
        expect(replayed).toMatchObject({
          applied: false,
          receipt: released.receipt,
          workflowCursor: released.workflowCursor,
          attempt: released.attempt,
        });
        await expect(
          ledger.abandonUnstartedWorkflowActivityAttempt({
            ...request,
            reason: { code: 'different-release-reason' },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        await expect(listReadyWork(ledger)).resolves.toEqual({
          items: [
            expect.objectContaining({
              runId,
              kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
              runVersion: 3,
              cursorVersion: 3,
              invocationId: claimed.invocation.invocationId,
              generation: 1,
              stepId: FIRST_STEP_ID,
              stepIndex: 0,
            }),
          ],
        });

        const reclaimed = await ledger.claimWorkflowActivity({
          runId,
          invocationId: released.invocation.invocationId,
          cursor: cursorGuard(released.workflowCursor),
          fencingToken: `claim-release-${adapter.name}-next-fence`,
          expectedGeneration: released.invocation.generation,
          expectedVersion: released.run.version,
          transitionId: `claim-release-${adapter.name}-reclaim`,
          actor: ACTOR,
          observedAt: BASE_OBSERVED_AT + 3,
        });
        expect(reclaimed).toMatchObject({
          run: { version: 4 },
          invocation: {
            status: InvocationStatus.RUNNING,
            generation: 2,
          },
          attempt: { status: AttemptStatus.CLAIMED, generation: 2 },
          workflowCursor: {
            disposition: 'ACTIVITY_RUNNING',
            version: 4,
          },
        });
        expect(reclaimed.attempt.attemptId).not.toBe(
          released.attempt.attemptId,
        );
        const lateReleaseReplay =
          await ledger.abandonUnstartedWorkflowActivityAttempt(request);
        expect(lateReleaseReplay).toMatchObject({
          applied: false,
          run: reclaimed.run,
          invocation: reclaimed.invocation,
          workflowCursor: released.workflowCursor,
          attempt: released.attempt,
        });
        await expect(ledger.getEvents(runId)).resolves.toHaveLength(4);
      } finally {
        await harness.cleanup();
      }
    });

    test('rejects a rehashed workflow recovery event that rewrites the retained attempt epoch', async () => {
      const harness = await createHarness(adapter, 'recovery-fence-forgery');
      const tableName = 'workflow-resilience-recovery-fence-forgery';
      const runId = workflowRunId(`${adapter.name}-recovery-fence-forgery`);
      try {
        const ledger = createLedger(
          harness.db,
          tableName,
          harness.payloadStore,
        );
        const { claimed } = await createClaimedWorkflow(
          ledger,
          runId,
          `recovery-fence-forgery-${adapter.name}`,
        );
        const request = workflowClaimReleaseRequest(
          runId,
          claimed,
          `recovery-fence-forgery-${adapter.name}-release`,
        );
        const released =
          await ledger.abandonUnstartedWorkflowActivityAttempt(request);
        const event = await harness.db.get({
          tableName,
          keyName: 'run_id',
          keyValue: runId,
          sortKeyName: 'sort_key',
          sortKeyValue: getEventSortKey(3),
          consistentRead: true,
        });
        expect(event).toBeDefined();
        if (!event) throw new Error('Expected the workflow release event.');
        const forgedEpoch = released.attempt.coordinatorEpoch + 1;
        const forgedPayload = JSON.parse(JSON.stringify(event.payload));
        forgedPayload.attempt.coordinatorEpoch = forgedEpoch;
        const forgedFence = {
          ...event.fence,
          coordinatorEpoch: forgedEpoch,
        };
        const forgedRequestDigest = transitionDigest(event.type, {
          runId,
          invocationId: released.invocation.invocationId,
          cursor: request.cursor,
          attemptId: released.attempt.attemptId,
          fencingToken: released.attempt.fencingToken,
          generation: released.attempt.generation,
          expectedVersion: claimed.run.version,
          transitionId: request.transitionId,
          reason: released.attempt.abandonment,
          actor: event.actor,
          coordinatorEpoch: forgedEpoch,
        });
        const forgedEvent = {
          ...event,
          request_digest: forgedRequestDigest,
          fence: forgedFence,
          payload: forgedPayload,
        };
        const forgedEventId = eventIdFor(forgedEvent);
        /** @param {string} sortKeyValue - Ledger sort key. @param {any[]} updates - Field updates. */
        const update = async (sortKeyValue, updates) =>
          await harness.db.update({
            tableName,
            keyName: 'run_id',
            keyValue: runId,
            sortKeyName: 'sort_key',
            sortKeyValue,
            updates,
          });
        await update(getEventSortKey(3), [
          { property: ['request_digest'], propertyValue: forgedRequestDigest },
          { property: ['fence'], propertyValue: forgedFence },
          { property: ['payload'], propertyValue: forgedPayload },
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getTransitionSortKey(request.transitionId), [
          { property: ['request_digest'], propertyValue: forgedRequestDigest },
          { property: ['event_id'], propertyValue: forgedEventId },
        ]);
        await update(getAttemptProjectionSortKey(released.attempt.attemptId), [
          {
            property: ['coordinator_epoch'],
            propertyValue: forgedEpoch,
          },
          {
            property: ['data', 'coordinatorEpoch'],
            propertyValue: forgedEpoch,
          },
        ]);

        await expect(ledger.rebuildRun(runId)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await harness.cleanup();
      }
    });

    test.each(['start', 'release'])(
      '%s wins the conditional start-versus-release race without mixed authority',
      async (winnerKind) => {
        const harness = await createHarness(
          adapter,
          `claim-release-race-${winnerKind}`,
        );
        const tableName = `workflow-resilience-claim-release-race-${winnerKind}`;
        const runId = workflowRunId(
          `${adapter.name}-claim-release-race-${winnerKind}`,
        );
        try {
          const directLedger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const { claimed } = await createClaimedWorkflow(
            directLedger,
            runId,
            `claim-release-race-${winnerKind}-${adapter.name}`,
          );
          const startRequest = {
            runId,
            invocationId: claimed.invocation.invocationId,
            cursor: cursorGuard(claimed.workflowCursor),
            attemptId: claimed.attempt.attemptId,
            fencingToken: claimed.attempt.fencingToken,
            generation: claimed.attempt.generation,
            expectedVersion: claimed.run.version,
            transitionId: `claim-release-race-${winnerKind}-${adapter.name}-start`,
            actor: ACTOR,
            observedAt: BASE_OBSERVED_AT + 2,
          };
          const releaseRequest = workflowClaimReleaseRequest(
            runId,
            claimed,
            `claim-release-race-${winnerKind}-${adapter.name}-release`,
          );
          let injectWinner = true;
          /** @type {Record<string, any> | undefined} */
          let winner;
          const guardedDb = {
            ...harness.db,
            /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Losing transition. */
            async transactionWrite(params) {
              if (injectWinner) {
                injectWinner = false;
                winner =
                  winnerKind === 'start'
                    ? await directLedger.markWorkflowActivityStarted(
                        startRequest,
                      )
                    : await directLedger.abandonUnstartedWorkflowActivityAttempt(
                        releaseRequest,
                      );
              }
              return await harness.db.transactionWrite(params);
            },
          };
          const racingLedger = createLedger(
            guardedDb,
            tableName,
            harness.payloadStore,
          );

          await expect(
            winnerKind === 'start'
              ? racingLedger.abandonUnstartedWorkflowActivityAttempt(
                  releaseRequest,
                )
              : racingLedger.markWorkflowActivityStarted(startRequest),
          ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
          expect(winner).toBeDefined();
          await expect(directLedger.getEvents(runId)).resolves.toHaveLength(3);
          if (winnerKind === 'start') {
            await expect(directLedger.rebuildRun(runId)).resolves.toMatchObject(
              {
                run: { status: RunStatus.RUNNING, version: 3 },
                workflowCursor: {
                  disposition: 'ACTIVITY_RUNNING',
                  version: 3,
                },
                invocations: [
                  expect.objectContaining({
                    status: InvocationStatus.RUNNING,
                  }),
                ],
                attempts: [
                  expect.objectContaining({ status: AttemptStatus.STARTED }),
                ],
              },
            );
            await expect(listReadyWork(directLedger)).resolves.toMatchObject({
              items: [
                expect.objectContaining({
                  kind: ExecutionLedgerReadyWorkKind.RECOVERY,
                  runVersion: 3,
                  cursorVersion: 3,
                  attemptId: claimed.attempt.attemptId,
                }),
              ],
            });
          } else {
            await expect(directLedger.rebuildRun(runId)).resolves.toMatchObject(
              {
                run: { status: RunStatus.RUNNING, version: 3 },
                workflowCursor: {
                  disposition: 'ACTIVITY_RUNNABLE',
                  version: 3,
                },
                invocations: [
                  expect.objectContaining({
                    status: InvocationStatus.RUNNABLE,
                  }),
                ],
                attempts: [
                  expect.objectContaining({
                    status: AttemptStatus.ABANDONED,
                  }),
                ],
              },
            );
            await expect(listReadyWork(directLedger)).resolves.toMatchObject({
              items: [
                expect.objectContaining({
                  kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
                  runVersion: 3,
                  cursorVersion: 3,
                }),
              ],
            });
          }
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each(['release', 'uncertain'])(
      '%s transaction failure preserves the exact prior workflow authority and permits retry',
      async (stage) => {
        const harness = await createHarness(
          adapter,
          `recovery-transaction-${stage}`,
        );
        const tableName = `workflow-resilience-recovery-transaction-${stage}`;
        const runId = workflowRunId(
          `${adapter.name}-recovery-transaction-${stage}`,
        );
        try {
          const directLedger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          let request;
          if (stage === 'release') {
            const { claimed } = await createClaimedWorkflow(
              directLedger,
              runId,
              `recovery-transaction-${stage}-${adapter.name}`,
            );
            request = workflowClaimReleaseRequest(
              runId,
              claimed,
              `recovery-transaction-${stage}-${adapter.name}-transition`,
            );
          } else {
            const { started } = await createStartedWorkflow(
              directLedger,
              runId,
              `recovery-transaction-${stage}-${adapter.name}`,
            );
            request = workflowUncertaintyRequest(
              runId,
              started,
              `recovery-transaction-${stage}-${adapter.name}-transition`,
            );
          }
          const before = await directLedger.rebuildRun(runId);
          const readyBefore = await listReadyWork(directLedger);
          let failureObserved = false;
          const failingDb = {
            ...harness.db,
            /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} _params - Rejected recovery transaction. */
            async transactionWrite(_params) {
              failureObserved = true;
              throw new Error('injected workflow recovery transaction failure');
            },
          };
          const failingLedger = createLedger(
            failingDb,
            tableName,
            harness.payloadStore,
          );

          await expect(
            stage === 'release'
              ? failingLedger.abandonUnstartedWorkflowActivityAttempt(request)
              : failingLedger.markWorkflowActivityAttemptUncertain(request),
          ).rejects.toThrow('injected workflow recovery transaction failure');
          expect(failureObserved).toBe(true);
          await expect(directLedger.rebuildRun(runId)).resolves.toEqual(before);
          await expect(listReadyWork(directLedger)).resolves.toEqual(
            readyBefore,
          );

          const retried =
            stage === 'release'
              ? await directLedger.abandonUnstartedWorkflowActivityAttempt(
                  request,
                )
              : await directLedger.markWorkflowActivityAttemptUncertain(
                  request,
                );
          expect(retried).toMatchObject({
            applied: true,
            workflowCursor: {
              disposition:
                stage === 'release'
                  ? 'ACTIVITY_RUNNABLE'
                  : 'ACTIVITY_UNCERTAIN',
            },
          });
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each(['release', 'uncertain'])(
      'corrupt RECOVERY work makes the %s transition fail atomically',
      async (stage) => {
        const harness = await createHarness(
          adapter,
          `recovery-ready-corruption-${stage}`,
        );
        const tableName = `workflow-resilience-recovery-ready-corruption-${stage}`;
        const runId = workflowRunId(
          `${adapter.name}-recovery-ready-corruption-${stage}`,
        );
        try {
          const ledger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          let request;
          if (stage === 'release') {
            const { claimed } = await createClaimedWorkflow(
              ledger,
              runId,
              `recovery-ready-corruption-${stage}-${adapter.name}`,
            );
            request = workflowClaimReleaseRequest(
              runId,
              claimed,
              `recovery-ready-corruption-${stage}-${adapter.name}-transition`,
            );
          } else {
            const { started } = await createStartedWorkflow(
              ledger,
              runId,
              `recovery-ready-corruption-${stage}-${adapter.name}`,
            );
            request = workflowUncertaintyRequest(
              runId,
              started,
              `recovery-ready-corruption-${stage}-${adapter.name}-transition`,
            );
          }
          const before = await ledger.rebuildRun(runId);
          const ready = await listReadyWork(ledger);
          expect(ready.items).toHaveLength(1);
          await corruptReadyWorkVersion(harness.db, tableName, ready.items[0]);

          await expect(
            stage === 'release'
              ? ledger.abandonUnstartedWorkflowActivityAttempt(request)
              : ledger.markWorkflowActivityAttemptUncertain(request),
          ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
          await expect(ledger.rebuildRun(runId)).resolves.toEqual(before);
          await expect(ledger.getEvents(runId)).resolves.toHaveLength(
            stage === 'release' ? 2 : 3,
          );
        } finally {
          await harness.cleanup();
        }
      },
    );

    test('blocks a lost started attempt, replays the decision, and refuses dispatch or ordinary success', async () => {
      const harness = await createHarness(adapter, 'started-uncertainty');
      const tableName = 'workflow-resilience-started-uncertainty';
      const runId = workflowRunId(`${adapter.name}-started-uncertainty`);
      try {
        const ledger = createLedger(
          harness.db,
          tableName,
          harness.payloadStore,
        );
        const { started } = await createStartedWorkflow(
          ledger,
          runId,
          `started-uncertainty-${adapter.name}`,
        );
        const request = workflowUncertaintyRequest(
          runId,
          started,
          `started-uncertainty-${adapter.name}-uncertain`,
        );
        const uncertain =
          await ledger.markWorkflowActivityAttemptUncertain(request);
        const replayed =
          await ledger.markWorkflowActivityAttemptUncertain(request);

        expect(uncertain).toMatchObject({
          applied: true,
          receipt: { type: 'workflow-activity-became-uncertain' },
          run: { status: RunStatus.BLOCKED, version: 4, lastSequence: 4 },
          invocation: {
            status: InvocationStatus.UNCERTAIN,
            uncertainty: { code: 'runner-outcome-lost' },
          },
          attempt: {
            attemptId: started.attempt.attemptId,
            status: AttemptStatus.ABANDONED,
            abandonment: { code: 'runner-outcome-lost' },
          },
          workflowCursor: {
            invocationId: started.invocation.invocationId,
            continuationId: started.workflowCursor.continuationId,
            stepId: FIRST_STEP_ID,
            stepIndex: 0,
            disposition: 'ACTIVITY_UNCERTAIN',
            outputs: [],
            version: 4,
            lastSequence: 4,
          },
        });
        expect(replayed).toMatchObject({
          applied: false,
          receipt: uncertain.receipt,
          workflowCursor: uncertain.workflowCursor,
          attempt: uncertain.attempt,
        });
        await expect(
          ledger.markWorkflowActivityAttemptUncertain({
            ...request,
            reason: { code: 'different-uncertainty-reason' },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });
        await expect(
          ledger.commitVerifiedWorkflowActivityTerminal(
            workflowSuccessRequest(
              runId,
              started,
              `started-uncertainty-${adapter.name}-ordinary-success`,
              { marker: 'must-not-advance' },
            ),
          ),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          ledger.claimWorkflowActivity({
            runId,
            invocationId: uncertain.invocation.invocationId,
            cursor: cursorGuard(uncertain.workflowCursor),
            fencingToken: `started-uncertainty-${adapter.name}-new-fence`,
            expectedGeneration: uncertain.invocation.generation,
            expectedVersion: uncertain.run.version,
            transitionId: `started-uncertainty-${adapter.name}-unsafe-claim`,
            actor: ACTOR,
            observedAt: BASE_OBSERVED_AT + 4,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        expect((await ledger.getEvents(runId)).map(({ type }) => type)).toEqual(
          [
            'workflow-run-created',
            'workflow-activity-claimed',
            'workflow-activity-started',
            'workflow-activity-became-uncertain',
          ],
        );
      } finally {
        await harness.cleanup();
      }
    });

    test.each(['success', 'uncertain'])(
      '%s wins the conditional success-versus-uncertainty race',
      async (winnerKind) => {
        const harness = await createHarness(
          adapter,
          `uncertainty-race-${winnerKind}`,
        );
        const tableName = `workflow-resilience-uncertainty-race-${winnerKind}`;
        const runId = workflowRunId(
          `${adapter.name}-uncertainty-race-${winnerKind}`,
        );
        try {
          const directLedger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const { started } = await createStartedWorkflow(
            directLedger,
            runId,
            `uncertainty-race-${winnerKind}-${adapter.name}`,
          );
          const successRequest = workflowSuccessRequest(
            runId,
            started,
            `uncertainty-race-${winnerKind}-${adapter.name}-success`,
            { marker: 'success-winner' },
          );
          const uncertaintyRequest = workflowUncertaintyRequest(
            runId,
            started,
            `uncertainty-race-${winnerKind}-${adapter.name}-uncertain`,
          );
          let injectWinner = true;
          /** @type {Record<string, any> | undefined} */
          let winner;
          const guardedDb = {
            ...harness.db,
            /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Losing transition. */
            async transactionWrite(params) {
              if (injectWinner) {
                injectWinner = false;
                winner =
                  winnerKind === 'success'
                    ? await directLedger.commitVerifiedWorkflowActivityTerminal(
                        successRequest,
                      )
                    : await directLedger.markWorkflowActivityAttemptUncertain(
                        uncertaintyRequest,
                      );
              }
              return await harness.db.transactionWrite(params);
            },
          };
          const racingLedger = createLedger(
            guardedDb,
            tableName,
            harness.payloadStore,
          );

          await expect(
            winnerKind === 'success'
              ? racingLedger.markWorkflowActivityAttemptUncertain(
                  uncertaintyRequest,
                )
              : racingLedger.commitVerifiedWorkflowActivityTerminal(
                  successRequest,
                ),
          ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
          expect(winner).toBeDefined();
          await expect(directLedger.getEvents(runId)).resolves.toHaveLength(4);
          if (winnerKind === 'success') {
            expect(winner).toMatchObject({
              run: { status: RunStatus.RUNNING },
              workflowCursor: { disposition: 'ACTIVITY_RUNNABLE' },
              nextInvocation: { status: InvocationStatus.RUNNABLE },
            });
            await expect(listReadyWork(directLedger)).resolves.toMatchObject({
              items: [
                expect.objectContaining({
                  kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
                  stepId: SECOND_STEP_ID,
                }),
              ],
            });
          } else {
            expect(winner).toMatchObject({
              run: { status: RunStatus.BLOCKED },
              invocation: { status: InvocationStatus.UNCERTAIN },
              workflowCursor: { disposition: 'ACTIVITY_UNCERTAIN' },
            });
            await expect(listReadyWork(directLedger)).resolves.toEqual({
              items: [],
            });
          }
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each([
      {
        label: 'successor',
        definition: TWO_ACTIVITY_DEFINITION,
        expectedRunStatus: RunStatus.RUNNING,
        expectedDisposition: 'ACTIVITY_RUNNABLE',
      },
      {
        label: 'terminal',
        definition: ONE_ACTIVITY_DEFINITION,
        expectedRunStatus: RunStatus.COMPLETED,
        expectedDisposition: 'COMPLETED',
      },
    ])(
      'resolves uncertain completed evidence into one atomic $label decision and stable replay',
      async ({ label, definition, expectedRunStatus, expectedDisposition }) => {
        const harness = await createHarness(
          adapter,
          `uncertainty-resolution-${label}`,
        );
        const tableName = `workflow-resilience-uncertainty-resolution-${label}`;
        const runId = workflowRunId(
          `${adapter.name}-uncertainty-resolution-${label}`,
        );
        try {
          const ledger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const { started, uncertain } = await createUncertainWorkflow(
            ledger,
            runId,
            `uncertainty-resolution-${label}-${adapter.name}`,
            definition,
          );
          const result = { marker: `recovered-${label}` };
          const request = await workflowReconciliationRequest(
            ledger,
            runId,
            started,
            uncertain,
            `uncertainty-resolution-${label}-${adapter.name}-resolve`,
            result,
          );
          const retainedAttempt = await ledger.getAttempt(
            runId,
            started.invocation.invocationId,
            started.attempt.attemptId,
          );
          expect(retainedAttempt).toEqual(uncertain.attempt);

          await expect(
            ledger.reconcileUncertainWorkflowActivityAttempt({
              ...request,
              uncertaintyEventId: 'different-uncertainty-event',
              transitionId: `${request.transitionId}-wrong-link`,
              reconciliationId: `${request.reconciliationId}-wrong-link`,
            }),
          ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
          await expect(
            ledger.reconcileUncertainWorkflowActivityAttempt({
              ...request,
              cursor: {
                ...request.cursor,
                version: request.cursor.version + 1,
              },
              transitionId: `${request.transitionId}-wrong-cursor`,
              reconciliationId: `${request.reconciliationId}-wrong-cursor`,
            }),
          ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

          const reconciled =
            await ledger.reconcileUncertainWorkflowActivityAttempt(request);
          const replayed =
            await ledger.reconcileUncertainWorkflowActivityAttempt(request);
          const lateUncertaintyReplay =
            await ledger.markWorkflowActivityAttemptUncertain(
              workflowUncertaintyRequest(
                runId,
                started,
                `uncertainty-resolution-${label}-${adapter.name}-uncertain`,
              ),
            );
          expect(reconciled).toMatchObject({
            applied: true,
            receipt: { type: 'workflow-activity-uncertainty-reconciled' },
            run: { status: expectedRunStatus, version: 5, lastSequence: 5 },
            invocation: {
              invocationId: started.invocation.invocationId,
              status: InvocationStatus.COMPLETED,
              terminal: {
                type: 'completed',
                attemptId: started.attempt.attemptId,
              },
            },
            attempt: retainedAttempt,
            workflowCursor: {
              disposition: expectedDisposition,
              version: 5,
              lastSequence: 5,
              outputs: [
                {
                  stepId: FIRST_STEP_ID,
                  stepIndex: 0,
                  outputRef: reconciled.outputRef,
                },
              ],
            },
            outputRef: expect.objectContaining({
              payloadSchema: WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
            }),
          });
          expect(reconciled.invocation).not.toHaveProperty('uncertainty');
          expect(reconciled.attempt).toEqual(retainedAttempt);
          expect(reconciled.attempt).not.toHaveProperty('terminal');
          expect(reconciled.attempt).not.toHaveProperty('evidenceRef');
          expect(replayed).toMatchObject({
            applied: false,
            receipt: reconciled.receipt,
            workflowCursor: reconciled.workflowCursor,
            outputRef: reconciled.outputRef,
          });
          expect(lateUncertaintyReplay).toMatchObject({
            applied: false,
            run: reconciled.run,
            invocation: reconciled.invocation,
            workflowCursor: uncertain.workflowCursor,
            attempt: retainedAttempt,
          });
          await expect(
            ledger.reconcileUncertainWorkflowActivityAttempt({
              ...request,
              reason: { code: 'different-resolution-reason' },
            }),
          ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
          await expect(
            harness.payloadStore.readJson(reconciled.outputRef),
          ).resolves.toEqual({
            schemaVersion: 1,
            kind: 'workflowOutput',
            value: result,
          });
          await expect(
            ledger.getAttempt(
              runId,
              started.invocation.invocationId,
              started.attempt.attemptId,
            ),
          ).resolves.toEqual(retainedAttempt);
          const events = await ledger.getEvents(runId);
          expect(events).toHaveLength(5);
          expect(events[4]).toMatchObject({
            type: 'workflow-activity-uncertainty-reconciled',
            payload: {
              reconciliation: {
                reconciliationId: request.reconciliationId,
                uncertaintyEventId: request.uncertaintyEventId,
                uncertaintySequence: request.uncertaintySequence,
                evidenceRef: expect.objectContaining({
                  payloadSchema: 'wharfie.execution.activity-evidence.v1',
                }),
              },
            },
          });

          if (label === 'successor') {
            expect(reconciled).toMatchObject({
              nextInvocation: {
                activityId: SECOND_ACTIVITY_ID,
                status: InvocationStatus.RUNNABLE,
                generation: 0,
              },
            });
            await expect(listReadyWork(ledger)).resolves.toMatchObject({
              items: [
                expect.objectContaining({
                  runId,
                  kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
                  runVersion: 5,
                  cursorVersion: 5,
                  invocationId: reconciled.nextInvocation.invocationId,
                  generation: 0,
                  stepId: SECOND_STEP_ID,
                  stepIndex: 1,
                }),
              ],
            });
            const successorClaim = await ledger.claimWorkflowActivity({
              runId,
              invocationId: reconciled.nextInvocation.invocationId,
              cursor: cursorGuard(reconciled.workflowCursor),
              fencingToken: `uncertainty-resolution-${adapter.name}-successor-fence`,
              expectedGeneration: 0,
              expectedVersion: reconciled.run.version,
              transitionId: `uncertainty-resolution-${adapter.name}-successor-claim`,
              actor: ACTOR,
              observedAt: BASE_OBSERVED_AT + 5,
            });
            const lateReplay =
              await ledger.reconcileUncertainWorkflowActivityAttempt(request);
            expect(lateReplay).toMatchObject({
              applied: false,
              run: { version: successorClaim.run.version },
              invocation: {
                invocationId: started.invocation.invocationId,
                status: InvocationStatus.COMPLETED,
              },
              workflowCursor: reconciled.workflowCursor,
              outputRef: reconciled.outputRef,
              nextInvocation: reconciled.nextInvocation,
            });
          } else {
            expect(reconciled).not.toHaveProperty('nextInvocation');
            await expect(listReadyWork(ledger)).resolves.toEqual({
              items: [],
            });
          }
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each(['exact', 'conflicting'])(
      '%s same-transition uncertainty-resolution race preserves one durable winner',
      async (raceKind) => {
        const harness = await createHarness(
          adapter,
          `uncertainty-resolution-race-${raceKind}`,
        );
        const tableName = `workflow-resilience-uncertainty-resolution-race-${raceKind}`;
        const runId = workflowRunId(
          `${adapter.name}-uncertainty-resolution-race-${raceKind}`,
        );
        try {
          const directLedger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const { started, uncertain } = await createUncertainWorkflow(
            directLedger,
            runId,
            `uncertainty-resolution-race-${raceKind}-${adapter.name}`,
          );
          const transitionId = `uncertainty-resolution-race-${raceKind}-${adapter.name}-resolve`;
          const winnerRequest = await workflowReconciliationRequest(
            directLedger,
            runId,
            started,
            uncertain,
            transitionId,
            { marker: 'winner' },
          );
          const loserRequest =
            raceKind === 'exact'
              ? winnerRequest
              : {
                  ...winnerRequest,
                  evidence: completedEvidence(started.startFrame, {
                    marker: 'losing',
                  }),
                };
          const retainedAttempt = uncertain.attempt;
          let injectWinner = true;
          /** @type {Record<string, any> | undefined} */
          let winner;
          const guardedDb = {
            ...harness.db,
            /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Losing resolution. */
            async transactionWrite(params) {
              if (injectWinner) {
                injectWinner = false;
                winner =
                  await directLedger.reconcileUncertainWorkflowActivityAttempt(
                    winnerRequest,
                  );
              }
              return await harness.db.transactionWrite(params);
            },
          };
          const racingLedger = createLedger(
            guardedDb,
            tableName,
            harness.payloadStore,
          );

          if (raceKind === 'exact') {
            const loser =
              await racingLedger.reconcileUncertainWorkflowActivityAttempt(
                loserRequest,
              );
            expect(loser).toMatchObject({
              applied: false,
              workflowCursor: {
                disposition: 'ACTIVITY_RUNNABLE',
                stepId: SECOND_STEP_ID,
              },
              nextInvocation: winner?.nextInvocation,
              outputRef: winner?.outputRef,
            });
          } else {
            await expect(
              racingLedger.reconcileUncertainWorkflowActivityAttempt(
                loserRequest,
              ),
            ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
          }
          expect(winner).toMatchObject({
            applied: true,
            run: { status: RunStatus.RUNNING, version: 5 },
            workflowCursor: {
              disposition: 'ACTIVITY_RUNNABLE',
              stepId: SECOND_STEP_ID,
            },
            nextInvocation: { status: InvocationStatus.RUNNABLE },
            attempt: retainedAttempt,
          });
          await expect(directLedger.getEvents(runId)).resolves.toHaveLength(5);
          await expect(directLedger.rebuildRun(runId)).resolves.toMatchObject({
            head: { version: 5, sequence: 5 },
            workflowCursor: winner?.workflowCursor,
            attempts: [retainedAttempt],
          });
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each([
      'evidence-publication',
      'output-publication',
      'next-request-publication',
      'transaction',
    ])(
      '%s failure preserves blocked uncertainty and permits exact reconciliation retry',
      async (failureKind) => {
        const harness = await createHarness(
          adapter,
          `uncertainty-resolution-failure-${failureKind}`,
        );
        const tableName = `workflow-resilience-uncertainty-resolution-failure-${failureKind}`;
        const runId = workflowRunId(
          `${adapter.name}-uncertainty-resolution-failure-${failureKind}`,
        );
        try {
          const directLedger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const { started, uncertain } = await createUncertainWorkflow(
            directLedger,
            runId,
            `uncertainty-resolution-failure-${failureKind}-${adapter.name}`,
          );
          const request = await workflowReconciliationRequest(
            directLedger,
            runId,
            started,
            uncertain,
            `uncertainty-resolution-failure-${failureKind}-${adapter.name}-resolve`,
            { marker: 'retry-winner' },
          );
          const before = await directLedger.rebuildRun(runId);
          const readyBefore = await listReadyWork(directLedger);
          let failureObserved = false;
          let failingLedger;
          if (failureKind === 'transaction') {
            const failingDb = {
              ...harness.db,
              /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} _params - Rejected resolution transaction. */
              async transactionWrite(_params) {
                failureObserved = true;
                throw new Error(
                  'injected workflow reconciliation transaction failure',
                );
              },
            };
            failingLedger = createLedger(
              failingDb,
              tableName,
              harness.payloadStore,
            );
          } else {
            const failedSchema =
              failureKind === 'evidence-publication'
                ? 'wharfie.execution.activity-evidence.v1'
                : failureKind === 'output-publication'
                  ? WORKFLOW_OUTPUT_PAYLOAD_SCHEMA
                  : WORKFLOW_ACTIVITY_REQUEST_PAYLOAD_SCHEMA;
            const failingPayloadStore = {
              /** @param {{value: unknown, payloadSchema: string}} input - Payload publication. */
              async putJson(input) {
                if (!failureObserved && input.payloadSchema === failedSchema) {
                  failureObserved = true;
                  throw new Error(
                    `injected workflow reconciliation ${failureKind} failure`,
                  );
                }
                return await harness.payloadStore.putJson(input);
              },
              /** @param {unknown} reference - Payload reference. */
              async readBytes(reference) {
                return await harness.payloadStore.readBytes(reference);
              },
            };
            failingLedger = createLedger(
              harness.db,
              tableName,
              failingPayloadStore,
            );
          }

          await expect(
            failingLedger.reconcileUncertainWorkflowActivityAttempt(request),
          ).rejects.toThrow('injected workflow reconciliation');
          expect(failureObserved).toBe(true);
          await expect(directLedger.rebuildRun(runId)).resolves.toEqual(before);
          await expect(listReadyWork(directLedger)).resolves.toEqual(
            readyBefore,
          );
          await expect(directLedger.getEvents(runId)).resolves.toHaveLength(4);

          const retried =
            await directLedger.reconcileUncertainWorkflowActivityAttempt(
              request,
            );
          expect(retried).toMatchObject({
            applied: true,
            run: { status: RunStatus.RUNNING, version: 5 },
            workflowCursor: {
              disposition: 'ACTIVITY_RUNNABLE',
              stepId: SECOND_STEP_ID,
            },
            nextInvocation: { status: InvocationStatus.RUNNABLE },
            attempt: uncertain.attempt,
          });
        } finally {
          await harness.cleanup();
        }
      },
    );

    test('tampered reconciliation evidence makes rebuild, replay, and successor claim fail closed', async () => {
      const harness = await createHarness(
        adapter,
        'uncertainty-resolution-evidence-tamper',
      );
      const tableName =
        'workflow-resilience-uncertainty-resolution-evidence-tamper';
      const runId = workflowRunId(
        `${adapter.name}-uncertainty-resolution-evidence-tamper`,
      );
      try {
        const ledger = createLedger(
          harness.db,
          tableName,
          harness.payloadStore,
        );
        const { started, uncertain } = await createUncertainWorkflow(
          ledger,
          runId,
          `uncertainty-resolution-evidence-tamper-${adapter.name}`,
        );
        const request = await workflowReconciliationRequest(
          ledger,
          runId,
          started,
          uncertain,
          `uncertainty-resolution-evidence-tamper-${adapter.name}-resolve`,
          { marker: 'winner' },
        );
        const reconciled =
          await ledger.reconcileUncertainWorkflowActivityAttempt(request);
        const event = (await ledger.getEvents(runId))[4];
        const evidenceRef = event?.payload?.reconciliation?.evidenceRef;
        expect(evidenceRef).toBeDefined();
        if (!evidenceRef) {
          throw new Error(
            'Expected retained workflow reconciliation evidence.',
          );
        }
        const evidencePath = harness.payloadStore.getPath(evidenceRef);
        const original = await fsp.readFile(evidencePath, 'utf8');
        const tampered = original.replace('"winner"', '"tamper"');
        expect(tampered).not.toBe(original);
        expect(Buffer.byteLength(tampered)).toBe(Buffer.byteLength(original));
        await fsp.writeFile(evidencePath, tampered, 'utf8');

        await expect(ledger.rebuildRun(runId)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
        await expect(
          ledger.reconcileUncertainWorkflowActivityAttempt(request),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
        await expect(
          ledger.claimWorkflowActivity({
            runId,
            invocationId: reconciled.nextInvocation.invocationId,
            cursor: cursorGuard(reconciled.workflowCursor),
            fencingToken: `uncertainty-resolution-evidence-tamper-${adapter.name}-fence`,
            expectedGeneration: 0,
            expectedVersion: reconciled.run.version,
            transitionId: `uncertainty-resolution-evidence-tamper-${adapter.name}-claim`,
            actor: ACTOR,
            observedAt: BASE_OBSERVED_AT + 5,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
      } finally {
        await harness.cleanup();
      }
    });

    test.each(['payload-publication', 'transaction'])(
      '%s failure preserves STARTED authority and permits exact retry',
      async (failureKind) => {
        const harness = await createHarness(adapter, failureKind);
        const tableName = `workflow-resilience-${failureKind}`;
        const runId = workflowRunId(`${adapter.name}-${failureKind}`);
        try {
          const directLedger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const { started } = await createStartedWorkflow(
            directLedger,
            runId,
            `${failureKind}-${adapter.name}`,
          );
          const request = workflowSuccessRequest(
            runId,
            started,
            `${failureKind}-${adapter.name}-success`,
            { marker: 'retry-winner' },
          );

          let failureObserved = false;
          let failingLedger;
          if (failureKind === 'payload-publication') {
            const failingPayloadStore = {
              /** @param {{value: unknown, payloadSchema: string}} input - Payload publication. */
              async putJson(input) {
                if (
                  !failureObserved &&
                  input.payloadSchema === WORKFLOW_OUTPUT_PAYLOAD_SCHEMA
                ) {
                  failureObserved = true;
                  throw new Error(
                    'injected workflow output publication failure',
                  );
                }
                return await harness.payloadStore.putJson(input);
              },
              /** @param {unknown} reference - Payload reference. */
              async readBytes(reference) {
                return await harness.payloadStore.readBytes(reference);
              },
            };
            failingLedger = createLedger(
              harness.db,
              tableName,
              failingPayloadStore,
            );
            await expect(
              failingLedger.commitVerifiedWorkflowActivityTerminal(request),
            ).rejects.toThrow('injected workflow output publication failure');
          } else {
            const failingDb = {
              ...harness.db,
              /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Rejected success transaction. */
              async transactionWrite(params) {
                if (!failureObserved) {
                  failureObserved = true;
                  throw new Error(
                    'injected workflow success transaction failure',
                  );
                }
                return await harness.db.transactionWrite(params);
              },
            };
            failingLedger = createLedger(
              failingDb,
              tableName,
              harness.payloadStore,
            );
            await expect(
              failingLedger.commitVerifiedWorkflowActivityTerminal(request),
            ).rejects.toThrow('injected workflow success transaction failure');
          }

          expect(failureObserved).toBe(true);
          await expectStartedAuthority(directLedger, runId, started);
          const retried =
            await directLedger.commitVerifiedWorkflowActivityTerminal(request);
          expect(retried).toMatchObject({
            applied: true,
            run: { status: RunStatus.RUNNING, version: 4 },
            workflowCursor: {
              disposition: 'ACTIVITY_RUNNABLE',
              stepId: SECOND_STEP_ID,
              version: 4,
            },
            nextInvocation: {
              invocationId: retried.workflowCursor.invocationId,
              status: InvocationStatus.RUNNABLE,
            },
            outputRef: expect.objectContaining({
              payloadSchema: WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
            }),
          });
          await expect(directLedger.getEvents(runId)).resolves.toHaveLength(4);
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each(['claim', 'success'])(
      'corrupt current ready work makes the %s replacement fail atomically',
      async (stage) => {
        const harness = await createHarness(adapter, `ready-${stage}`);
        const tableName = `workflow-resilience-ready-${stage}`;
        const runId = workflowRunId(`${adapter.name}-ready-${stage}`);
        try {
          const ledger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          let mutation;
          let expectedState;
          if (stage === 'claim') {
            const created = await ledger.createWorkflowRun({
              runId,
              appId: APP_ID,
              revisionId: REVISION_ID,
              workflowId: WORKFLOW_ID,
              definition: TWO_ACTIVITY_DEFINITION,
              input: { scenario: `ready-${stage}` },
              transitionId: `ready-${stage}-${adapter.name}-create`,
              actor: ACTOR,
              observedAt: BASE_OBSERVED_AT,
            });
            expectedState = await ledger.rebuildRun(runId);
            mutation = () =>
              ledger.claimWorkflowActivity({
                runId,
                invocationId: created.invocation.invocationId,
                cursor: cursorGuard(created.workflowCursor),
                fencingToken: `ready-${stage}-${adapter.name}-fence`,
                expectedGeneration: 0,
                expectedVersion: created.run.version,
                transitionId: `ready-${stage}-${adapter.name}-claim`,
                actor: ACTOR,
                observedAt: BASE_OBSERVED_AT + 1,
              });
          } else {
            const { started } = await createStartedWorkflow(
              ledger,
              runId,
              `ready-${stage}-${adapter.name}`,
            );
            expectedState = await ledger.rebuildRun(runId);
            const request = workflowSuccessRequest(
              runId,
              started,
              `ready-${stage}-${adapter.name}-success`,
              { marker: 'ready-corruption' },
            );
            mutation = () =>
              ledger.commitVerifiedWorkflowActivityTerminal(request);
          }

          const ready = await listReadyWork(ledger);
          expect(ready.items).toHaveLength(1);
          await corruptReadyWorkVersion(harness.db, tableName, ready.items[0]);

          await expect(mutation()).rejects.toBeInstanceOf(
            ExecutionLedgerConflictError,
          );
          await expect(ledger.rebuildRun(runId)).resolves.toEqual(
            expectedState,
          );
          await expect(ledger.getEvents(runId)).resolves.toHaveLength(
            stage === 'claim' ? 1 : 3,
          );
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each(['exact', 'conflicting'])(
      '%s same-transition success race preserves the durable winner',
      async (raceKind) => {
        const harness = await createHarness(adapter, `race-${raceKind}`);
        const tableName = `workflow-resilience-race-${raceKind}`;
        const runId = workflowRunId(`${adapter.name}-race-${raceKind}`);
        try {
          const directLedger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const { started } = await createStartedWorkflow(
            directLedger,
            runId,
            `race-${raceKind}-${adapter.name}`,
          );
          const transitionId = `race-${raceKind}-${adapter.name}-success`;
          const winnerRequest = workflowSuccessRequest(
            runId,
            started,
            transitionId,
            { marker: 'winner' },
          );
          const loserRequest =
            raceKind === 'exact'
              ? winnerRequest
              : workflowSuccessRequest(runId, started, transitionId, {
                  marker: 'losing',
                });
          let injectWinner = true;
          /** @type {Record<string, any> | undefined} */
          let winner;
          const guardedDb = {
            ...harness.db,
            /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Losing transaction. */
            async transactionWrite(params) {
              if (injectWinner) {
                injectWinner = false;
                winner =
                  await directLedger.commitVerifiedWorkflowActivityTerminal(
                    winnerRequest,
                  );
              }
              return await harness.db.transactionWrite(params);
            },
          };
          const racingLedger = createLedger(
            guardedDb,
            tableName,
            harness.payloadStore,
          );

          if (raceKind === 'exact') {
            const loser =
              await racingLedger.commitVerifiedWorkflowActivityTerminal(
                loserRequest,
              );
            expect(loser).toMatchObject({
              applied: false,
              workflowCursor: {
                disposition: 'ACTIVITY_RUNNABLE',
                stepId: SECOND_STEP_ID,
                version: 4,
              },
              outputRef: winner?.outputRef,
              nextInvocation: winner?.nextInvocation,
            });
          } else {
            await expect(
              racingLedger.commitVerifiedWorkflowActivityTerminal(loserRequest),
            ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
          }

          expect(winner).toMatchObject({
            applied: true,
            workflowCursor: {
              disposition: 'ACTIVITY_RUNNABLE',
              stepId: SECOND_STEP_ID,
            },
          });
          if (!winner) throw new Error('Expected the injected durable winner.');
          await expect(
            harness.payloadStore.readJson(winner.outputRef),
          ).resolves.toEqual({
            schemaVersion: 1,
            kind: 'workflowOutput',
            value: { marker: 'winner' },
          });
          await expect(directLedger.getEvents(runId)).resolves.toHaveLength(4);
          await expect(directLedger.rebuildRun(runId)).resolves.toMatchObject({
            head: { version: 4, sequence: 4 },
            workflowCursor: winner.workflowCursor,
          });
        } finally {
          await harness.cleanup();
        }
      },
    );

    test('tampered workflow output makes rebuild, replay, and successor claim fail closed', async () => {
      const harness = await createHarness(adapter, 'output-tamper');
      const tableName = 'workflow-resilience-output-tamper';
      const runId = workflowRunId(`${adapter.name}-output-tamper`);
      try {
        const ledger = createLedger(
          harness.db,
          tableName,
          harness.payloadStore,
        );
        const { started } = await createStartedWorkflow(
          ledger,
          runId,
          `output-tamper-${adapter.name}`,
        );
        const request = workflowSuccessRequest(
          runId,
          started,
          `output-tamper-${adapter.name}-success`,
          { marker: 'winner' },
        );
        const succeeded =
          await ledger.commitVerifiedWorkflowActivityTerminal(request);
        expect(succeeded.nextInvocation).toBeDefined();

        const outputPath = harness.payloadStore.getPath(succeeded.outputRef);
        const original = await fsp.readFile(outputPath, 'utf8');
        const tampered = original.replace('"winner"', '"tamper"');
        expect(tampered).not.toBe(original);
        expect(Buffer.byteLength(tampered)).toBe(Buffer.byteLength(original));
        await fsp.writeFile(outputPath, tampered, 'utf8');

        await expect(ledger.rebuildRun(runId)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
        await expect(
          ledger.commitVerifiedWorkflowActivityTerminal(request),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
        await expect(
          ledger.claimWorkflowActivity({
            runId,
            invocationId: succeeded.nextInvocation.invocationId,
            cursor: cursorGuard(succeeded.workflowCursor),
            fencingToken: `output-tamper-${adapter.name}-next-fence`,
            expectedGeneration: 0,
            expectedVersion: succeeded.run.version,
            transitionId: `output-tamper-${adapter.name}-next-claim`,
            actor: ACTOR,
            observedAt: BASE_OBSERVED_AT + 4,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
      } finally {
        await harness.cleanup();
      }
    });
  });
}
