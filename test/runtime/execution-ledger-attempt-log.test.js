/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  AttemptStatus,
  ExecutionLedgerConflictError,
  ExecutionLedgerProjectionError,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  createExecutionLedgerAttemptLogScope,
  getExecutionLedgerAttemptLogEntrySortKey,
} from '../../src/core/lib/ledger/attempt-log.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';

const APP_ID = 'demo';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const OTHER_REVISION_ID = `wrv1_${'Q'.repeat(43)}`;
const RUN_ID = 'attempt-log-run';
const INVOCATION_ID = 'main';
const ACTIVITY_ID = 'greet';
const FENCING_TOKEN = 'attempt-log-fence';
const TABLE_NAME = 'execution-ledger-attempt-log-test';

/**
 * @typedef {object} AttemptLogAppendInput
 * @property {string} appId - Application identity.
 * @property {string} revisionId - Immutable application revision.
 * @property {string} activityId - Activity identity.
 * @property {string} runId - Logical run identity.
 * @property {string} invocationId - Logical invocation identity.
 * @property {string} attemptId - Physical attempt identity.
 * @property {string} fencingToken - Persisted attempt fence.
 * @property {number} generation - Attempt generation.
 * @property {number} coordinatorEpoch - Coordinator lease epoch.
 * @property {Record<string, any>} frame - Valid Activity Protocol log frame.
 */

function createClock() {
  let time = 1_700_000_000_000;
  return () => {
    time += 1;
    return time;
  };
}

function manualRun() {
  return {
    appId: APP_ID,
    revisionId: REVISION_ID,
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    activityId: ACTIVITY_ID,
    input: { name: 'Ada' },
    callerMetadata: { source: 'attempt-log-test' },
    transitionId: 'create-run',
  };
}

/**
 * @param {string} attemptId
 * @param {number} sequence
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function logFrame(attemptId, sequence, overrides = {}) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'log',
    attemptId,
    sequence,
    level: 'info',
    message: `activity log ${sequence}`,
    fields: { sequence },
    ...overrides,
  };
}

/**
 * @param {Readonly<Record<string, any>>} start
 * @param {Readonly<Record<string, any>>[]} logs
 * @param {any} [result]
 * @returns {Record<string, any>}
 */
function completedEvidence(start, logs, result = { greeting: 'hello' }) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const acceptedLogs = logs.map((frame) =>
    transcript.acceptComponentFrame(frame),
  );
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: acceptedStart.attemptId,
    sequence: acceptedLogs.at(-1)?.sequence + 1 || 1,
    result,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, ...acceptedLogs, terminal],
    transcript: transcript.snapshot(),
  };
}

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-attempt-log-'));
  const baseDb = createVanillaDB({ path: root });
  /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams[]} */
  const transactions = [];
  /** @type {((params: import('../../src/core/lib/db/base.js').TransactionWriteParams) => Promise<void>) | null} */
  let nextTransactionInjection = null;
  let loseNextTransactionResponse = false;
  const db = {
    ...baseDb,
    /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
    async transactionWrite(params) {
      transactions.push(params);
      if (nextTransactionInjection) {
        const inject = nextTransactionInjection;
        nextTransactionInjection = null;
        await inject(params);
      }
      const result = await baseDb.transactionWrite(params);
      if (loseNextTransactionResponse) {
        loseNextTransactionResponse = false;
        throw new Error('injected transaction response loss');
      }
      return result;
    },
  };
  const payloadStore = createLocalExecutionPayloadStore({
    path: join(root, 'execution-payloads'),
    storeId: 'attempt-log-test',
  });
  const now = createClock();
  const ledger = createExecutionLedger({
    db,
    tableName: TABLE_NAME,
    payloadStore,
    now,
  });
  const directLedger = createExecutionLedger({
    db: baseDb,
    tableName: TABLE_NAME,
    payloadStore,
    now,
  });
  return {
    baseDb,
    directLedger,
    ledger,
    transactions,
    clearTransactions() {
      transactions.length = 0;
    },
    loseNextTransactionResponse() {
      loseNextTransactionResponse = true;
    },
    /**
     * @param {(params: import('../../src/core/lib/db/base.js').TransactionWriteParams) => Promise<void>} inject
     */
    beforeNextTransaction(inject) {
      nextTransactionInjection = inject;
    },
    async cleanup() {
      try {
        await baseDb.close();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

/**
 * @param {(harness: ReturnType<typeof createHarness>) => Promise<void>} run
 * @returns {Promise<void>}
 */
async function withHarness(run) {
  const harness = createHarness();
  try {
    await run(harness);
  } finally {
    await harness.cleanup();
  }
}

/**
 * @param {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger
 * @returns {Promise<Record<string, any>>}
 */
async function createClaimedAttempt(ledger) {
  const created = await ledger.createManualRun(manualRun());
  return await ledger.claimInvocation({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    fencingToken: FENCING_TOKEN,
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: 'claim-attempt',
  });
}

/**
 * @param {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger
 * @returns {Promise<Record<string, any>>}
 */
async function createStartedAttempt(ledger) {
  const claimed = await createClaimedAttempt(ledger);
  return await ledger.markAttemptStarted({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: claimed.attempt.attemptId,
    fencingToken: FENCING_TOKEN,
    generation: claimed.attempt.generation,
    coordinatorEpoch: claimed.attempt.coordinatorEpoch,
    expectedVersion: claimed.run.version,
    transitionId: 'start-attempt',
  });
}

/**
 * @param {Record<string, any>} attemptResult
 * @param {Record<string, any>} frame
 * @param {Partial<AttemptLogAppendInput>} [overrides]
 * @returns {AttemptLogAppendInput}
 */
function appendInput(attemptResult, frame, overrides = {}) {
  return {
    appId: APP_ID,
    revisionId: REVISION_ID,
    activityId: ACTIVITY_ID,
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: attemptResult.attempt.attemptId,
    fencingToken: attemptResult.attempt.fencingToken,
    generation: attemptResult.attempt.generation,
    coordinatorEpoch: attemptResult.attempt.coordinatorEpoch,
    frame,
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} attemptResult
 * @returns {Omit<AttemptLogAppendInput, 'frame'>}
 */
function attemptLogScope(attemptResult) {
  return {
    appId: APP_ID,
    revisionId: REVISION_ID,
    activityId: ACTIVITY_ID,
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: attemptResult.attempt.attemptId,
    fencingToken: attemptResult.attempt.fencingToken,
    generation: attemptResult.attempt.generation,
    coordinatorEpoch: attemptResult.attempt.coordinatorEpoch,
  };
}

/**
 * @param {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger
 * @param {AttemptLogAppendInput} input
 * @returns {Promise<{applied: boolean, attemptId: string, acknowledgedComponentSequence: number, entryId: string}>}
 */
async function appendActivityAttemptLog(ledger, input) {
  return await ledger.appendActivityAttemptLog(input);
}

/**
 * @param {import('../../src/core/lib/db/base.js').TransactionWriteParams[]} transactions
 * @returns {any[]}
 */
function mutationPartitionKeys(transactions) {
  return transactions.flatMap((transaction) => [
    ...(transaction.putRequests || []).map(
      (request) => request.record[request.keyName],
    ),
    ...(transaction.updateRequests || []).map((request) => request.keyValue),
    ...(transaction.deleteRequests || []).map((request) => request.keyValue),
  ]);
}

describe('execution ledger durable activity-attempt logs', () => {
  test('retains sparse logs outside the authoritative run partition', async () => {
    await withHarness(async ({ ledger, transactions, clearTransactions }) => {
      const started = await createStartedAttempt(ledger);
      const attemptId = started.attempt.attemptId;
      const before = {
        run: await ledger.getRun(RUN_ID),
        events: await ledger.getEvents(RUN_ID),
        rebuilt: await ledger.rebuildRun(RUN_ID),
      };
      clearTransactions();

      const first = await appendActivityAttemptLog(
        ledger,
        appendInput(started, logFrame(attemptId, 1)),
      );
      const third = await appendActivityAttemptLog(
        ledger,
        appendInput(started, logFrame(attemptId, 3)),
      );

      expect(first).toEqual({
        applied: true,
        attemptId,
        acknowledgedComponentSequence: 1,
        entryId: expect.any(String),
      });
      expect(third).toEqual({
        applied: true,
        attemptId,
        acknowledgedComponentSequence: 3,
        entryId: expect.any(String),
      });
      expect(third.entryId).not.toBe(first.entryId);
      await expect(ledger.getRun(RUN_ID)).resolves.toEqual(before.run);
      await expect(ledger.getEvents(RUN_ID)).resolves.toEqual(before.events);
      await expect(ledger.rebuildRun(RUN_ID)).resolves.toEqual(before.rebuilt);

      const rawMutationPartitions = mutationPartitionKeys(transactions);
      expect(rawMutationPartitions.length).toBeGreaterThan(0);
      expect(rawMutationPartitions).not.toContain(RUN_ID);
      expect(new Set(rawMutationPartitions).size).toBe(1);
    });
  });

  test('replays an exact log before and after terminal commit but refuses a new terminal log', async () => {
    await withHarness(async ({ ledger }) => {
      const started = await createStartedAttempt(ledger);
      const attemptId = started.attempt.attemptId;
      const frame = logFrame(attemptId, 1);
      const applied = await appendActivityAttemptLog(
        ledger,
        appendInput(started, frame),
      );

      await expect(
        appendActivityAttemptLog(ledger, appendInput(started, frame)),
      ).resolves.toEqual({
        applied: false,
        attemptId,
        acknowledgedComponentSequence: 1,
        entryId: applied.entryId,
      });

      const committed = await ledger.commitVerifiedAttemptTerminal({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId,
        fencingToken: started.attempt.fencingToken,
        generation: started.attempt.generation,
        coordinatorEpoch: started.attempt.coordinatorEpoch,
        expectedVersion: started.run.version,
        transitionId: 'complete-attempt',
        evidence: completedEvidence(started.startFrame, [frame]),
      });
      expect(committed.attempt.status).toBe(AttemptStatus.COMPLETED);

      await expect(
        appendActivityAttemptLog(ledger, appendInput(started, frame)),
      ).resolves.toEqual({
        applied: false,
        attemptId,
        acknowledgedComponentSequence: 1,
        entryId: applied.entryId,
      });
      await expect(
        appendActivityAttemptLog(
          ledger,
          appendInput(started, logFrame(attemptId, 3)),
        ),
      ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
    });
  });

  test('rejects changed sequence reuse and an out-of-order fresh sequence', async () => {
    await withHarness(async ({ ledger }) => {
      const started = await createStartedAttempt(ledger);
      const attemptId = started.attempt.attemptId;
      const third = logFrame(attemptId, 3);
      await appendActivityAttemptLog(ledger, appendInput(started, third));

      await expect(
        appendActivityAttemptLog(
          ledger,
          appendInput(started, {
            ...third,
            message: 'different content under the same sequence',
          }),
        ),
      ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
      await expect(
        appendActivityAttemptLog(
          ledger,
          appendInput(started, logFrame(attemptId, 2)),
        ),
      ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

      await expect(
        appendActivityAttemptLog(
          ledger,
          appendInput(started, logFrame(attemptId, 4)),
        ),
      ).resolves.toMatchObject({
        applied: true,
        attemptId,
        acknowledgedComponentSequence: 4,
      });
    });
  });

  test('rejects stale attempt coordinates and mismatched scope', async () => {
    await withHarness(async ({ ledger }) => {
      const started = await createStartedAttempt(ledger);
      const attemptId = started.attempt.attemptId;
      const frame = logFrame(attemptId, 1);
      const conflicts = [
        ['app ID', appendInput(started, frame, { appId: 'other-app' })],
        [
          'revision ID',
          appendInput(started, frame, { revisionId: OTHER_REVISION_ID }),
        ],
        [
          'activity ID',
          appendInput(started, frame, { activityId: 'other-activity' }),
        ],
        ['run ID', appendInput(started, frame, { runId: 'other-run' })],
        [
          'invocation ID',
          appendInput(started, frame, {
            invocationId: 'other-invocation',
          }),
        ],
        [
          'attempt ID',
          appendInput(started, logFrame('other-attempt', 1), {
            attemptId: 'other-attempt',
          }),
        ],
        [
          'fencing token',
          appendInput(started, frame, { fencingToken: 'stale-fence' }),
        ],
        [
          'generation',
          appendInput(started, frame, {
            generation: started.attempt.generation + 1,
          }),
        ],
        [
          'coordinator epoch',
          appendInput(started, frame, {
            coordinatorEpoch: started.attempt.coordinatorEpoch + 1,
          }),
        ],
      ];

      for (const [label, input] of conflicts) {
        try {
          await appendActivityAttemptLog(
            ledger,
            /** @type {AttemptLogAppendInput} */ (input),
          );
          throw new Error(`Expected ${label} mismatch to be refused.`);
        } catch (error) {
          if (!(error instanceof ExecutionLedgerConflictError)) {
            throw new Error(`${label} mismatch returned the wrong error.`, {
              cause: error,
            });
          }
        }
      }
      await expect(
        appendActivityAttemptLog(ledger, appendInput(started, frame)),
      ).resolves.toMatchObject({
        applied: true,
        attemptId,
        acknowledgedComponentSequence: 1,
      });
    });
  });

  test('refuses an otherwise valid log while the attempt is only claimed', async () => {
    await withHarness(async ({ ledger }) => {
      const claimed = await createClaimedAttempt(ledger);
      const attemptId = claimed.attempt.attemptId;

      await expect(
        appendActivityAttemptLog(
          ledger,
          appendInput(claimed, logFrame(attemptId, 1)),
        ),
      ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
    });
  });

  test('rejects replay and fresh append when a sparse middle chain entry is missing', async () => {
    await withHarness(async ({ baseDb, ledger }) => {
      const started = await createStartedAttempt(ledger);
      const attemptId = started.attempt.attemptId;
      const frames = [
        logFrame(attemptId, 1),
        logFrame(attemptId, 4),
        logFrame(attemptId, 9),
      ];
      for (const frame of frames) {
        await appendActivityAttemptLog(ledger, appendInput(started, frame));
      }

      const partition = createExecutionLedgerAttemptLogScope(
        attemptLogScope(started),
      );
      await baseDb.remove({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: partition.attemptLogId,
        sortKeyName: 'sort_key',
        sortKeyValue: getExecutionLedgerAttemptLogEntrySortKey(4),
      });

      await expect(
        appendActivityAttemptLog(ledger, appendInput(started, frames[2])),
      ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
      await expect(
        appendActivityAttemptLog(
          ledger,
          appendInput(started, logFrame(attemptId, 12)),
        ),
      ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
    });
  });

  test('commits no auxiliary rows when terminalization wins the append condition race', async () => {
    await withHarness(
      async ({
        baseDb,
        directLedger,
        ledger,
        transactions,
        clearTransactions,
        beforeNextTransaction,
      }) => {
        const started = await createStartedAttempt(ledger);
        const attemptId = started.attempt.attemptId;
        const input = appendInput(started, logFrame(attemptId, 1));
        const partition = createExecutionLedgerAttemptLogScope(
          attemptLogScope(started),
        );
        /** @type {string | undefined} */
        let racedAttemptStatus;
        clearTransactions();
        beforeNextTransaction(async () => {
          const committed = await directLedger.commitVerifiedAttemptTerminal({
            runId: RUN_ID,
            invocationId: INVOCATION_ID,
            attemptId,
            fencingToken: started.attempt.fencingToken,
            generation: started.attempt.generation,
            coordinatorEpoch: started.attempt.coordinatorEpoch,
            expectedVersion: started.run.version,
            transitionId: 'terminal-wins-log-append-race',
            evidence: completedEvidence(started.startFrame, []),
          });
          racedAttemptStatus = committed.attempt.status;
        });

        await expect(
          appendActivityAttemptLog(ledger, input),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        expect(racedAttemptStatus).toBe(AttemptStatus.COMPLETED);
        expect(transactions).toHaveLength(1);
        await expect(
          baseDb.query({
            tableName: TABLE_NAME,
            consistentRead: true,
            keyConditions: [
              {
                keyType: 'PRIMARY',
                conditionType: 'EQUALS',
                propertyName: 'run_id',
                propertyValue: partition.attemptLogId,
              },
            ],
          }),
        ).resolves.toEqual([]);
      },
    );
  });

  test('discovers an exact committed append after its transaction response is lost', async () => {
    await withHarness(
      async ({
        baseDb,
        ledger,
        transactions,
        clearTransactions,
        loseNextTransactionResponse,
      }) => {
        const started = await createStartedAttempt(ledger);
        const attemptId = started.attempt.attemptId;
        const input = appendInput(started, logFrame(attemptId, 1));
        clearTransactions();
        loseNextTransactionResponse();

        await expect(appendActivityAttemptLog(ledger, input)).rejects.toThrow(
          'injected transaction response loss',
        );
        expect(transactions).toHaveLength(1);

        const transaction = transactions[0];
        const auxiliaryPut = transaction.putRequests?.find(
          (request) => request.record[request.keyName] !== RUN_ID,
        );
        expect(auxiliaryPut).toBeDefined();
        if (!auxiliaryPut) {
          throw new Error('Expected an auxiliary attempt-log put request.');
        }
        const auxiliaryPartition = auxiliaryPut.record[auxiliaryPut.keyName];
        await expect(appendActivityAttemptLog(ledger, input)).resolves.toEqual({
          applied: false,
          attemptId,
          acknowledgedComponentSequence: 1,
          entryId: expect.any(String),
        });

        await expect(
          baseDb.query({
            tableName: TABLE_NAME,
            consistentRead: true,
            keyConditions: [
              {
                keyType: 'PRIMARY',
                conditionType: 'EQUALS',
                propertyName: auxiliaryPut.keyName,
                propertyValue: auxiliaryPartition,
              },
            ],
          }),
        ).resolves.toHaveLength(2);
      },
    );
  });
});
