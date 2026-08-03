/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  AttemptStatus,
  ExecutionLedgerProjectionError,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  EXECUTION_LEDGER_ATTEMPT_LOG_PAYLOAD_SCHEMA,
  createExecutionLedgerAttemptLogEntryRecord,
  createExecutionLedgerAttemptLogScope,
  createInitialExecutionLedgerAttemptLogHeadRecord,
  getExecutionLedgerAttemptLogEntrySortKey,
} from '../../src/core/lib/ledger/attempt-log.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import { encodeCanonicalJsonPayload } from '../../src/core/runtime/execution-payload.js';

const APP_ID = 'demo';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'attempt-log-page-run';
const INVOCATION_ID = 'main';
const ACTIVITY_ID = 'greet';
const FENCING_TOKEN = 'attempt-log-page-fence';
const TABLE_NAME = 'execution-ledger-attempt-log-page-test';

/** @typedef {{appId: string, revisionId: string, activityId: string, runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number, coordinatorEpoch: number}} PrivateAttemptLogScope */
/** @typedef {PrivateAttemptLogScope & {frame: Record<string, any>}} AttemptLogAppendInput */
/** @typedef {{appId: string, runId: string, attemptId: string, limit?: number, cursor?: string}} AttemptLogReadInput */

/** @returns {() => number} */
function createClock() {
  let time = 1_700_000_000_000;
  return () => {
    time += 1;
    return time;
  };
}

/** @returns {Record<string, any>} */
function manualRun() {
  return {
    appId: APP_ID,
    revisionId: REVISION_ID,
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    activityId: ACTIVITY_ID,
    input: { name: 'Ada' },
    callerMetadata: { source: 'attempt-log-page-test' },
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
    message: `raw log ${sequence}`,
    fields: { sequence, nested: { retained: true } },
    ...overrides,
  };
}

/**
 * @param {Readonly<Record<string, any>>} start
 * @param {Readonly<Record<string, any>>[]} logs
 * @returns {Record<string, any>}
 */
function completedEvidence(start, logs) {
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
    result: { greeting: 'hello' },
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, ...acceptedLogs, terminal],
    transcript: transcript.snapshot(),
  };
}

/** @returns {{baseDb: import('../../src/core/lib/db/base.js').DBClient, ledger: import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore, payloadStore: ReturnType<typeof createLocalExecutionPayloadStore>, root: string, getTransactionWriteCount: () => number, cleanup: () => Promise<void>}} */
function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-attempt-log-page-'));
  const baseDb = createVanillaDB({ path: root });
  let transactionWriteCount = 0;
  const db = {
    ...baseDb,
    /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
    async transactionWrite(params) {
      transactionWriteCount += 1;
      return await baseDb.transactionWrite(params);
    },
  };
  const payloadStore = createLocalExecutionPayloadStore({
    path: join(root, 'execution-payloads'),
    storeId: 'attempt-log-page-test',
  });
  const ledger = createExecutionLedger({
    db,
    tableName: TABLE_NAME,
    payloadStore,
    now: createClock(),
  });
  return {
    baseDb,
    ledger,
    payloadStore,
    root,
    getTransactionWriteCount: () => transactionWriteCount,
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
 * @returns {PrivateAttemptLogScope}
 */
function privateScope(attemptResult) {
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
 * @param {Record<string, any>} attemptResult
 * @param {Record<string, any>} frame
 * @returns {AttemptLogAppendInput}
 */
function appendInput(attemptResult, frame) {
  return {
    ...privateScope(attemptResult),
    frame,
  };
}

/**
 * @param {Record<string, any>} attemptResult
 * @param {Partial<AttemptLogReadInput>} [overrides]
 * @returns {AttemptLogReadInput}
 */
function readInput(attemptResult, overrides = {}) {
  return {
    appId: APP_ID,
    runId: RUN_ID,
    attemptId: attemptResult.attempt.attemptId,
    ...overrides,
  };
}

/**
 * @param {import('../../src/core/lib/db/base.js').DBClient} baseDb
 * @returns {Promise<Record<string, any>[]>}
 */
async function readRunPartition(baseDb) {
  const rows = await baseDb.query({
    tableName: TABLE_NAME,
    consistentRead: true,
    keyConditions: [
      {
        keyType: 'PRIMARY',
        conditionType: 'EQUALS',
        propertyName: 'run_id',
        propertyValue: RUN_ID,
      },
    ],
  });
  return rows.sort((left, right) =>
    String(left.sort_key).localeCompare(String(right.sort_key)),
  );
}

/**
 * @param {import('../../src/core/lib/db/base.js').DBClient} baseDb
 * @param {Record<string, any>} attemptResult
 * @returns {Promise<Record<string, any>[]>}
 */
async function readLogRows(baseDb, attemptResult) {
  const partition = createExecutionLedgerAttemptLogScope(
    privateScope(attemptResult),
  );
  return await baseDb.query({
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
  });
}

describe('execution ledger activity-attempt log page reader', () => {
  test('freezes an ascending prefix across later appends and never mutates normal history', async () => {
    await withHarness(async ({ baseDb, ledger, getTransactionWriteCount }) => {
      const started = await createStartedAttempt(ledger);
      const attemptId = started.attempt.attemptId;
      const originalFrames = [1, 2, 3].map((sequence) =>
        logFrame(attemptId, sequence),
      );
      for (const frame of originalFrames) {
        await ledger.appendActivityAttemptLog(appendInput(started, frame));
      }

      const mainBeforeRead = await readRunPartition(baseDb);
      const writesBeforeRead = getTransactionWriteCount();
      const first = await ledger.readActivityAttemptLogPage({
        ...readInput(started),
        limit: 2,
      });
      expect(first).toMatchObject({
        disclosure: 'application-sensitive-unredacted',
        scope: {
          appId: APP_ID,
          revisionId: REVISION_ID,
          activityId: ACTIVITY_ID,
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId,
          generation: started.attempt.generation,
          coordinatorEpoch: started.attempt.coordinatorEpoch,
        },
        snapshot: {
          entryCount: 3,
          cumulativePayloadBytes: expect.any(Number),
          lastSequence: 3,
        },
        items: [
          {
            sequence: 1,
            acceptedAt: expect.any(Number),
            level: 'info',
            message: 'raw log 1',
            fields: { sequence: 1, nested: { retained: true } },
          },
          {
            sequence: 2,
            acceptedAt: expect.any(Number),
            level: 'info',
            message: 'raw log 2',
            fields: { sequence: 2, nested: { retained: true } },
          },
        ],
        nextCursor: expect.any(String),
      });
      expect(getTransactionWriteCount()).toBe(writesBeforeRead);
      await expect(readRunPartition(baseDb)).resolves.toEqual(mainBeforeRead);
      expect(JSON.stringify(first)).not.toMatch(
        /fencingToken|attemptLogId|entryId|entry_id|payloadRef|payload_ref|previousEntryId|previous_entry_id/i,
      );

      const laterFrame = logFrame(attemptId, 4, {
        level: 'warn',
        message: 'appended after snapshot',
      });
      await ledger.appendActivityAttemptLog(appendInput(started, laterFrame));
      const writesBeforeContinuation = getTransactionWriteCount();
      const second = await ledger.readActivityAttemptLogPage({
        ...readInput(started),
        limit: 100,
        cursor: first?.nextCursor,
      });
      expect(second).toMatchObject({
        snapshot: first?.snapshot,
        items: [
          {
            sequence: 3,
            message: 'raw log 3',
          },
        ],
      });
      expect(second).not.toHaveProperty('nextCursor');

      const fresh = await ledger.readActivityAttemptLogPage({
        ...readInput(started),
        limit: 100,
      });
      expect(fresh?.snapshot).toMatchObject({
        entryCount: 4,
        lastSequence: 4,
      });
      expect(fresh?.items.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
      expect(getTransactionWriteCount()).toBe(writesBeforeContinuation);
      await expect(readRunPartition(baseDb)).resolves.toEqual(mainBeforeRead);

      const committed = await ledger.commitVerifiedAttemptTerminal({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId,
        fencingToken: started.attempt.fencingToken,
        generation: started.attempt.generation,
        coordinatorEpoch: started.attempt.coordinatorEpoch,
        expectedVersion: started.run.version,
        transitionId: 'complete-attempt',
        evidence: completedEvidence(started.startFrame, [
          ...originalFrames,
          laterFrame,
        ]),
      });
      expect(committed.attempt.status).toBe(AttemptStatus.COMPLETED);
      const terminalMain = await readRunPartition(baseDb);
      const writesBeforeTerminalRead = getTransactionWriteCount();
      const terminalPage = await ledger.readActivityAttemptLogPage({
        ...readInput(started),
        limit: 100,
      });
      expect(terminalPage?.items.map((item) => item.sequence)).toEqual([
        1, 2, 3, 4,
      ]);
      expect(getTransactionWriteCount()).toBe(writesBeforeTerminalRead);
      await expect(readRunPartition(baseDb)).resolves.toEqual(terminalMain);
    });
  });

  test('returns an explicit empty page for a started and terminal attempt', async () => {
    await withHarness(async ({ ledger }) => {
      const started = await createStartedAttempt(ledger);
      const expected = {
        disclosure: 'application-sensitive-unredacted',
        scope: {
          appId: APP_ID,
          revisionId: REVISION_ID,
          activityId: ACTIVITY_ID,
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          generation: started.attempt.generation,
          coordinatorEpoch: started.attempt.coordinatorEpoch,
        },
        snapshot: {
          entryCount: 0,
          cumulativePayloadBytes: 0,
          lastSequence: null,
        },
        items: [],
      };
      await expect(
        ledger.readActivityAttemptLogPage(readInput(started)),
      ).resolves.toEqual(expected);

      await ledger.commitVerifiedAttemptTerminal({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId: started.attempt.attemptId,
        fencingToken: started.attempt.fencingToken,
        generation: started.attempt.generation,
        coordinatorEpoch: started.attempt.coordinatorEpoch,
        expectedVersion: started.run.version,
        transitionId: 'complete-empty-attempt',
        evidence: completedEvidence(started.startFrame, []),
      });
      await expect(
        ledger.readActivityAttemptLogPage(readInput(started)),
      ).resolves.toEqual(expected);
    });
  });

  test('returns null consistently for missing or cross-app scope before inspecting a cursor', async () => {
    await withHarness(async ({ ledger }) => {
      const started = await createStartedAttempt(ledger);
      const frame = logFrame(started.attempt.attemptId, 1);
      await ledger.appendActivityAttemptLog(appendInput(started, frame));
      const first = await ledger.readActivityAttemptLogPage({
        ...readInput(started),
        limit: 1,
      });

      await expect(
        ledger.readActivityAttemptLogPage({
          ...readInput(started),
          appId: 'other-app',
          cursor: first?.nextCursor || 'malformed',
        }),
      ).resolves.toBeNull();
      await expect(
        ledger.readActivityAttemptLogPage({
          ...readInput(started),
          runId: 'missing-run',
          cursor: 'malformed',
        }),
      ).resolves.toBeNull();
      await expect(
        ledger.readActivityAttemptLogPage({
          ...readInput(started),
          attemptId: 'missing-attempt',
          cursor: 'malformed',
        }),
      ).resolves.toBeNull();
    });
  });

  test('rejects a forged snapshot or boundary and exact-input extensions', async () => {
    await withHarness(async ({ ledger }) => {
      const started = await createStartedAttempt(ledger);
      for (const sequence of [1, 3, 8]) {
        await ledger.appendActivityAttemptLog(
          appendInput(started, logFrame(started.attempt.attemptId, sequence)),
        );
      }
      const first = await ledger.readActivityAttemptLogPage({
        ...readInput(started),
        limit: 1,
      });
      const decoded = JSON.parse(
        Buffer.from(first?.nextCursor || '', 'base64url').toString('utf8'),
      );
      decoded.previousSequence = 3;
      const forged = Buffer.from(JSON.stringify(decoded), 'utf8').toString(
        'base64url',
      );
      await expect(
        ledger.readActivityAttemptLogPage({
          ...readInput(started),
          cursor: forged,
        }),
      ).rejects.toThrow(/boundary/i);

      await expect(
        ledger.readActivityAttemptLogPage(
          /** @type {any} */ ({
            ...readInput(started),
            extra: true,
          }),
        ),
      ).rejects.toThrow();
      await expect(
        ledger.readActivityAttemptLogPage({
          ...readInput(started),
          limit: 101,
        }),
      ).rejects.toThrow(/limit/i);
    });
  });

  test('fails closed on a missing middle chain entry', async () => {
    await withHarness(async ({ baseDb, ledger }) => {
      const started = await createStartedAttempt(ledger);
      for (const sequence of [1, 4, 9]) {
        await ledger.appendActivityAttemptLog(
          appendInput(started, logFrame(started.attempt.attemptId, sequence)),
        );
      }
      const partition = createExecutionLedgerAttemptLogScope(
        privateScope(started),
      );
      await baseDb.remove({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: partition.attemptLogId,
        sortKeyName: 'sort_key',
        sortKeyValue: getExecutionLedgerAttemptLogEntrySortKey(4),
      });
      await expect(
        ledger.readActivityAttemptLogPage(readInput(started)),
      ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
    });
  });

  test('rehashes every retained payload before returning raw data', async () => {
    await withHarness(async ({ baseDb, ledger, payloadStore }) => {
      const started = await createStartedAttempt(ledger);
      await ledger.appendActivityAttemptLog(
        appendInput(started, logFrame(started.attempt.attemptId, 1)),
      );
      const rows = await readLogRows(baseDb, started);
      const entry = rows.find(
        (row) => row.record_type === 'execution_ledger_attempt_log_entry',
      );
      if (!entry) throw new Error('Expected one retained log entry.');
      const payloadPath = payloadStore.getPath(entry.payload_ref);
      const corrupt = Buffer.from(readFileSync(payloadPath));
      corrupt[0] ^= 1;
      writeFileSync(payloadPath, corrupt);

      await expect(
        ledger.readActivityAttemptLogPage(readInput(started)),
      ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
    });
  });

  test('fails closed when a never-started attempt has otherwise valid retained logs', async () => {
    await withHarness(async ({ baseDb, ledger, payloadStore }) => {
      const claimed = await createClaimedAttempt(ledger);
      const scope = privateScope(claimed);
      const frame = logFrame(claimed.attempt.attemptId, 1);
      const payloadRef = await payloadStore.putJson({
        value: frame,
        payloadSchema: EXECUTION_LEDGER_ATTEMPT_LOG_PAYLOAD_SCHEMA,
      });
      const entry = createExecutionLedgerAttemptLogEntryRecord({
        scope,
        sequence: frame.sequence,
        level: frame.level,
        payloadRef,
        canonicalPayloadBytes: encodeCanonicalJsonPayload(frame).byteLength,
        acceptedAt: 1_700_000_000_100,
        previousEntryId: null,
      });
      const head = createInitialExecutionLedgerAttemptLogHeadRecord({
        scope,
        entry,
      });
      await baseDb.put({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        sortKeyName: 'sort_key',
        record: entry,
      });
      await baseDb.put({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        sortKeyName: 'sort_key',
        record: head,
      });

      await expect(
        ledger.readActivityAttemptLogPage(readInput(claimed)),
      ).rejects.toBeInstanceOf(ExecutionLedgerProjectionError);
    });
  });
});
