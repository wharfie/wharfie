/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
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
  WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
  createWorkflowRunId,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';

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
 * @param {string} label - Scenario identity.
 * @returns {string} Stable app-scoped workflow run ID.
 */
function workflowRunId(label) {
  return createWorkflowRunId({ appId: APP_ID, idempotencyKey: label });
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
    storeId: `workflow-resilience-${adapter.name}-${label}`,
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
 * @returns {Promise<{created: Record<string, any>, claimed: Record<string, any>, started: Record<string, any>}>} STARTED workflow authority.
 */
async function createStartedWorkflow(ledger, runId, label) {
  const created = await ledger.createWorkflowRun({
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition: TWO_ACTIVITY_DEFINITION,
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
              failingLedger.commitVerifiedWorkflowActivitySuccess(request),
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
              failingLedger.commitVerifiedWorkflowActivitySuccess(request),
            ).rejects.toThrow('injected workflow success transaction failure');
          }

          expect(failureObserved).toBe(true);
          await expectStartedAuthority(directLedger, runId, started);
          const retried =
            await directLedger.commitVerifiedWorkflowActivitySuccess(request);
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
              ledger.commitVerifiedWorkflowActivitySuccess(request);
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
                  await directLedger.commitVerifiedWorkflowActivitySuccess(
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
              await racingLedger.commitVerifiedWorkflowActivitySuccess(
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
              racingLedger.commitVerifiedWorkflowActivitySuccess(loserRequest),
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
          await ledger.commitVerifiedWorkflowActivitySuccess(request);
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
          ledger.commitVerifiedWorkflowActivitySuccess(request),
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
