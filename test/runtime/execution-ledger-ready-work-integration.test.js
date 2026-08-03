/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterAll, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLMDBDB, getAdapterMatrix } from '../helpers/db-adapters.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import { createExecutionLedger as createProductionExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  ExecutionLedgerReadyWorkKind,
  createExecutionLedgerReadyWorkRecord,
  createExecutionLedgerReadyWorkScope,
  getExecutionLedgerReadyWorkSortKey,
} from '../../src/core/lib/ledger/ready-work.js';

const APP_ID = 'ready-work-app';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const OTHER_REVISION_ID = `wrv1_${createHash('sha256')
  .update('other-ready-work-revision')
  .digest('base64url')}`;
const INVOCATION_ID = 'main';
const ACTIVITY_ID = 'greet';
const EFFECT_ID = 'ready-work-effect';
const READY_THROUGH = 1_800_000_000_000;
const PAYLOAD_ROOT = mkdtempSync(
  join(tmpdir(), 'wharfie-ledger-ready-work-payload-'),
);
const PAYLOAD_STORE = createLocalExecutionPayloadStore({
  path: PAYLOAD_ROOT,
  storeId: 'ready-work-integration',
});

afterAll(() => {
  rmSync(PAYLOAD_ROOT, { recursive: true, force: true });
});

function createClock() {
  let time = 1_700_000_000_000;
  return () => {
    time += 1;
    return time;
  };
}

/**
 * @param {Omit<Parameters<typeof createProductionExecutionLedger>[0], 'payloadStore'>} options - Ledger dependencies.
 * @returns {ReturnType<typeof createProductionExecutionLedger>} Ledger instance.
 */
function createExecutionLedger(options) {
  return createProductionExecutionLedger({
    ...options,
    payloadStore: PAYLOAD_STORE,
  });
}

/**
 * @param {string} runId - Durable run ID.
 * @param {string} [revisionId] - Exact application revision.
 * @returns {Record<string, any>} Manual run request.
 */
function manualRun(runId, revisionId = REVISION_ID) {
  return {
    runId,
    appId: APP_ID,
    revisionId,
    invocationId: INVOCATION_ID,
    activityId: ACTIVITY_ID,
    input: { name: 'Ada' },
    callerMetadata: { source: 'ready-work-test' },
    transitionId: `create-${runId}`,
  };
}

/**
 * @param {ReturnType<typeof createProductionExecutionLedger>} ledger - Ledger instance.
 * @param {string} [revisionId] - Exact application revision.
 * @returns {Promise<Record<string, any>>} Eligible ready-work page.
 */
async function listReadyWork(ledger, revisionId = REVISION_ID) {
  return await ledger.listReadyWork({
    appId: APP_ID,
    revisionId,
    observedAt: READY_THROUGH,
    limit: 100,
  });
}

/**
 * @param {Record<string, any>} page - Ready-work page.
 * @param {Record<string, any>} expected - Expected locator fields.
 * @returns {Record<string, any>} The one returned locator.
 */
function expectSingleReadyItem(page, expected) {
  expect(page).toMatchObject({ items: [expected] });
  expect(page.items).toHaveLength(1);
  expect(page.items[0].availableAt).toEqual(expect.any(Number));
  return page.items[0];
}

/**
 * @param {Record<string, any>} startFrame - Exact durable start frame.
 * @param {any} [result] - JSON activity result.
 * @returns {Record<string, any>} Verified terminal evidence.
 */
function completedEvidence(startFrame, result = { greeting: 'hello' }) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(startFrame);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: acceptedStart.attemptId,
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
 * @param {string} runId - Durable run ID.
 * @param {number} runVersion - Expected current run version.
 * @param {Record<string, any>} [overrides] - Attempt-fenced cancellation fields.
 * @returns {Record<string, any>} Runnable cancellation request.
 */
function cancellationRequest(runId, runVersion, overrides = {}) {
  return {
    runId,
    invocationId: INVOCATION_ID,
    expectedVersion: runVersion,
    expectedGeneration: 0,
    transitionId: `cancel-${runId}`,
    requestId: `cancel-${runId}`,
    reason: {
      code: 'operator-requested-cancellation',
      name: 'CancellationError',
      message: 'The operator requested that this durable run stop.',
      details: { runId },
    },
    ...overrides,
  };
}

const TEST_EFFECT_VERIFIER = Object.freeze({
  kind: 'application-state-put-if-absent-receipt',
  version: 2,
});
const TEST_EFFECT_RECONCILIATION_VERIFIER = Object.freeze({
  kind: 'application-state-put-if-absent-not-applied',
  version: 2,
});
const TEST_EFFECT_DESTINATION = Object.freeze({
  kind: 'application-state',
  version: 2,
  bindingId: 'primary',
  configuration: Object.freeze({
    provider: 'vanilla',
    storeId: 'ready-work-state',
    tableName: 'wharfie-application-state-v2',
    namespace: APP_ID,
  }),
});

function effectVerifierRegistrations() {
  return [
    {
      ...TEST_EFFECT_VERIFIER,
      verify: (/** @type {Record<string, any>} */ input) =>
        input.outcome.evidence.destinationEffectId ===
          input.effect.destinationEffectId &&
        input.outcome.evidence.operation === input.request.operation,
    },
    {
      ...TEST_EFFECT_RECONCILIATION_VERIFIER,
      verify: (/** @type {Record<string, any>} */ input) =>
        input.evidence.destinationEffectId ===
          input.effect.destinationEffectId &&
        input.evidence.operation === input.request.operation &&
        input.evidence.disposition === 'not-applied',
    },
  ];
}

/**
 * @param {string} attemptId - Durable attempt identity.
 * @returns {Record<string, any>} Managed-effect protocol request.
 */
function effectRequest(attemptId) {
  return {
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'effect-request',
    attemptId,
    sequence: 1,
    effectId: EFFECT_ID,
    capability: 'application-state',
    operation: 'put-if-absent',
    input: { key: 'ready-work', value: true },
    requestedReplayProperties: ['idempotent', 'transactional'],
  };
}

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} execution-ledger ready-work integration`, () => {
    test('projects runnable, recovery, started, and terminal lifecycle atomically', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-lifecycle';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-ready-lifecycle',
          now: createClock(),
        });

        const created = await ledger.createManualRun(manualRun(runId));
        expectSingleReadyItem(await listReadyWork(ledger), {
          appId: APP_ID,
          revisionId: REVISION_ID,
          runId,
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
          runVersion: created.run.version,
          lastSequence: created.run.lastSequence,
          invocationId: INVOCATION_ID,
          generation: 0,
        });

        const claimed = await ledger.claimInvocation({
          runId,
          invocationId: INVOCATION_ID,
          fencingToken: 'ready-work-fence',
          expectedGeneration: 0,
          expectedVersion: created.run.version,
          transitionId: 'claim-ready-lifecycle',
        });
        const attemptId = claimed.attempt?.attemptId;
        expect(typeof attemptId).toBe('string');
        expectSingleReadyItem(await listReadyWork(ledger), {
          appId: APP_ID,
          revisionId: REVISION_ID,
          runId,
          kind: ExecutionLedgerReadyWorkKind.RECOVERY,
          runVersion: claimed.run.version,
          lastSequence: claimed.run.lastSequence,
          invocationId: INVOCATION_ID,
          attemptId,
          generation: 1,
        });

        const started = await ledger.markAttemptStarted({
          runId,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'ready-work-fence',
          generation: 1,
          expectedVersion: claimed.run.version,
          transitionId: 'start-ready-lifecycle',
        });
        expectSingleReadyItem(await listReadyWork(ledger), {
          appId: APP_ID,
          revisionId: REVISION_ID,
          runId,
          kind: ExecutionLedgerReadyWorkKind.RECOVERY,
          runVersion: started.run.version,
          lastSequence: started.run.lastSequence,
          invocationId: INVOCATION_ID,
          attemptId,
          generation: 1,
        });

        await ledger.commitVerifiedAttemptTerminal({
          runId,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'ready-work-fence',
          generation: 1,
          expectedVersion: started.run.version,
          transitionId: 'terminal-ready-lifecycle',
          evidence: completedEvidence(started.startFrame),
        });
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [],
        });
      } finally {
        await cleanup();
      }
    });

    test('replaces an abandoned claim with the next runnable generation', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-abandon';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-ready-abandon',
          now: createClock(),
        });
        const created = await ledger.createManualRun(manualRun(runId));
        const claimed = await ledger.claimInvocation({
          runId,
          invocationId: INVOCATION_ID,
          fencingToken: 'abandon-fence',
          expectedGeneration: 0,
          expectedVersion: created.run.version,
          transitionId: 'claim-ready-abandon',
        });
        const attemptId = claimed.attempt?.attemptId;
        expect(typeof attemptId).toBe('string');

        const abandoned = await ledger.abandonUnstartedAttempt({
          runId,
          invocationId: INVOCATION_ID,
          attemptId,
          fencingToken: 'abandon-fence',
          generation: 1,
          expectedVersion: claimed.run.version,
          transitionId: 'abandon-ready-attempt',
          reason: { code: 'coordinator-restarted' },
        });
        const item = expectSingleReadyItem(await listReadyWork(ledger), {
          appId: APP_ID,
          revisionId: REVISION_ID,
          runId,
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
          runVersion: abandoned.run.version,
          lastSequence: abandoned.run.lastSequence,
          invocationId: INVOCATION_ID,
          generation: 1,
        });
        expect(item).not.toHaveProperty('attemptId');
      } finally {
        await cleanup();
      }
    });

    test('retains exact recovery work when cancellation races a started attempt', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-started-cancel';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-ready-started-cancel',
          now: createClock(),
        });
        const created = await ledger.createManualRun(manualRun(runId));
        const claimed = await ledger.claimInvocation({
          runId,
          invocationId: INVOCATION_ID,
          fencingToken: 'started-cancel-fence',
          expectedGeneration: 0,
          expectedVersion: created.run.version,
          transitionId: 'claim-started-cancel',
        });
        const started = await ledger.markAttemptStarted({
          runId,
          invocationId: INVOCATION_ID,
          attemptId: claimed.attempt.attemptId,
          fencingToken: 'started-cancel-fence',
          generation: 1,
          expectedVersion: claimed.run.version,
          transitionId: 'start-before-cancel',
        });

        const cancelled = await ledger.requestManualRunCancellation(
          cancellationRequest(runId, started.run.version, {
            expectedGeneration: 1,
            attemptId: started.attempt.attemptId,
            fencingToken: 'started-cancel-fence',
          }),
        );
        expect(cancelled).toMatchObject({
          run: { status: 'RUNNING' },
          invocation: { status: 'RUNNING' },
          attempt: { status: 'STARTED' },
        });
        expectSingleReadyItem(await listReadyWork(ledger), {
          appId: APP_ID,
          revisionId: REVISION_ID,
          runId,
          kind: ExecutionLedgerReadyWorkKind.RECOVERY,
          availableAt: cancelled.attempt.updatedAt,
          runVersion: cancelled.run.version,
          lastSequence: cancelled.run.lastSequence,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          generation: 1,
        });
      } finally {
        await cleanup();
      }
    });

    test('removes recovery work when a started attempt becomes uncertain', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-uncertain';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-ready-uncertain',
          now: createClock(),
        });
        const created = await ledger.createManualRun(manualRun(runId));
        const claimed = await ledger.claimInvocation({
          runId,
          invocationId: INVOCATION_ID,
          fencingToken: 'uncertain-fence',
          expectedGeneration: 0,
          expectedVersion: created.run.version,
          transitionId: 'claim-before-uncertain',
        });
        const started = await ledger.markAttemptStarted({
          runId,
          invocationId: INVOCATION_ID,
          attemptId: claimed.attempt.attemptId,
          fencingToken: 'uncertain-fence',
          generation: 1,
          expectedVersion: claimed.run.version,
          transitionId: 'start-before-uncertain',
        });
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [
            {
              kind: ExecutionLedgerReadyWorkKind.RECOVERY,
              attemptId: started.attempt.attemptId,
            },
          ],
        });

        const uncertain = await ledger.markAttemptUncertain({
          runId,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          fencingToken: 'uncertain-fence',
          generation: 1,
          expectedVersion: started.run.version,
          transitionId: 'mark-ready-attempt-uncertain',
          reason: { code: 'delivery-lost', lastAcknowledgedSequence: 0 },
        });
        expect(uncertain).toMatchObject({
          run: { status: 'BLOCKED' },
          invocation: { status: 'UNCERTAIN' },
          attempt: { status: 'ABANDONED' },
        });
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [],
        });
      } finally {
        await cleanup();
      }
    });

    test('removes immediately cancelled runnable work', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-cancel';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-ready-cancel',
          now: createClock(),
        });
        const created = await ledger.createManualRun(manualRun(runId));
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [{ runId }],
        });

        await ledger.requestManualRunCancellation(
          cancellationRequest(runId, created.run.version),
        );
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [],
        });
      } finally {
        await cleanup();
      }
    });

    test('isolates ready work by exact immutable application revision', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-ready-revision-scope',
          now: createClock(),
        });
        await ledger.createManualRun(
          manualRun('ready-revision-a', REVISION_ID),
        );
        await ledger.createManualRun(
          manualRun('ready-revision-b', OTHER_REVISION_ID),
        );

        const firstRevision = await listReadyWork(ledger, REVISION_ID);
        expectSingleReadyItem(firstRevision, {
          appId: APP_ID,
          revisionId: REVISION_ID,
          runId: 'ready-revision-a',
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
        });
        const secondRevision = await listReadyWork(ledger, OTHER_REVISION_ID);
        expectSingleReadyItem(secondRevision, {
          appId: APP_ID,
          revisionId: OTHER_REVISION_ID,
          runId: 'ready-revision-b',
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
        });
        expect(
          firstRevision.items.map(
            (/** @type {Record<string, any>} */ item) => item.runId,
          ),
        ).toEqual(['ready-revision-a']);
        expect(
          secondRevision.items.map(
            (/** @type {Record<string, any>} */ item) => item.runId,
          ),
        ).toEqual(['ready-revision-b']);
      } finally {
        await cleanup();
      }
    });

    test('pages beyond the requested page size and binds cursors to exact revision scope', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-ready-pagination',
          now: createClock(),
        });
        const runIds = Array.from(
          { length: 5 },
          (_, index) => `ready-page-${index}`,
        );
        for (const runId of runIds) {
          // eslint-disable-next-line no-await-in-loop
          await ledger.createManualRun(manualRun(runId));
        }

        /** @type {string | undefined} */
        let cursor;
        /** @type {string | undefined} */
        let firstCursor;
        /** @type {Record<string, any>[]} */
        const items = [];
        /** @type {number[]} */
        const pageSizes = [];
        do {
          // eslint-disable-next-line no-await-in-loop
          const page = await ledger.listReadyWork({
            appId: APP_ID,
            revisionId: REVISION_ID,
            observedAt: READY_THROUGH,
            limit: 2,
            ...(cursor === undefined ? {} : { cursor }),
          });
          items.push(...page.items);
          pageSizes.push(page.items.length);
          if (firstCursor === undefined) firstCursor = page.nextCursor;
          cursor = page.nextCursor;
        } while (cursor !== undefined);

        expect(pageSizes).toEqual([2, 2, 1]);
        expect(items.map(({ runId }) => runId)).toEqual(runIds);
        expect(new Set(items.map(({ runId }) => runId)).size).toBe(5);
        expect(firstCursor).toEqual(expect.any(String));
        await expect(
          ledger.listReadyWork({
            appId: APP_ID,
            revisionId: OTHER_REVISION_ID,
            observedAt: READY_THROUGH,
            limit: 2,
            cursor: /** @type {string} */ (firstCursor),
          }),
        ).rejects.toThrow(/cursor.*scope/i);
      } finally {
        await cleanup();
      }
    });

    test('skips a corrupt locator while preserving cursor progress to healthy work', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-ready-corrupt-row';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun('ready-corrupt-first'));
        await ledger.createManualRun(manualRun('ready-healthy-second'));
        const before = await listReadyWork(ledger);
        expect(
          before.items.map(
            (/** @type {Record<string, any>} */ item) => item.runId,
          ),
        ).toEqual(['ready-corrupt-first', 'ready-healthy-second']);
        const corrupt = before.items[0];
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
            availableAt: corrupt.availableAt,
            runId: corrupt.runId,
          }),
          updates: [
            {
              property: ['record_type'],
              propertyValue: 'corrupt_ready_work_projection',
            },
          ],
        });

        const firstPage = await ledger.listReadyWork({
          appId: APP_ID,
          revisionId: REVISION_ID,
          observedAt: READY_THROUGH,
          limit: 1,
        });
        expect(firstPage).toEqual({
          items: [],
          nextCursor: expect.any(String),
        });
        const secondPage = await ledger.listReadyWork({
          appId: APP_ID,
          revisionId: REVISION_ID,
          observedAt: READY_THROUGH,
          limit: 1,
          cursor: firstPage.nextCursor,
        });
        expect(secondPage.items).toEqual([
          expect.objectContaining({ runId: 'ready-healthy-second' }),
        ]);
        expect(secondPage).not.toHaveProperty('nextCursor');

        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [{ runId: 'ready-healthy-second' }],
        });
      } finally {
        await cleanup();
      }
    });

    test('concurrent repairs converge on one missing current locator', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-repair-missing';
      const tableName = 'execution-ledger-ready-repair-missing';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun(runId));
        const expected = expectSingleReadyItem(await listReadyWork(ledger), {
          runId,
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
        });
        const scope = createExecutionLedgerReadyWorkScope({
          appId: APP_ID,
          revisionId: REVISION_ID,
        });
        await db.batchWrite({
          tableName,
          deleteRequests: [
            {
              keyName: 'run_id',
              keyValue: scope.readyWorkId,
              sortKeyName: 'sort_key',
              sortKeyValue: getExecutionLedgerReadyWorkSortKey({
                availableAt: expected.availableAt,
                runId,
              }),
            },
          ],
        });
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [],
        });

        const repairs = await Promise.all([
          ledger.repairReadyWork({
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
          }),
          ledger.repairReadyWork({
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
          }),
        ]);
        expect(repairs).toEqual([
          expect.objectContaining({ runId, expected }),
          expect.objectContaining({ runId, expected }),
        ]);
        expect(repairs.some(({ applied }) => applied)).toBe(true);
        expectSingleReadyItem(await listReadyWork(ledger), expected);
        await expect(
          ledger.repairReadyWork({
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
          }),
        ).resolves.toEqual({ applied: false, runId, expected });
      } finally {
        await cleanup();
      }
    });

    test('repairs a current locator containing nonportable corrupt data', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-repair-corrupt-data';
      const tableName = 'execution-ledger-ready-repair-corrupt-data';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        await ledger.createManualRun(manualRun(runId));
        const expected = expectSingleReadyItem(await listReadyWork(ledger), {
          runId,
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
        });
        const corruptRecord = {
          ...createExecutionLedgerReadyWorkRecord(expected),
          corrupt_condition_value: { nested: true },
        };
        await db.batchWrite({
          tableName,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: corruptRecord,
            },
          ],
        });
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [],
        });

        await expect(
          ledger.repairReadyWork({
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
          }),
        ).resolves.toEqual({ applied: true, runId, expected });
        expectSingleReadyItem(await listReadyWork(ledger), expected);
      } finally {
        await cleanup();
      }
    });

    test('repeated stale-observation repairs preserve the current locator', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-repair-stale';
      const tableName = 'execution-ledger-ready-repair-stale';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        const created = await ledger.createManualRun(manualRun(runId));
        const stale = expectSingleReadyItem(await listReadyWork(ledger), {
          runId,
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
        });
        const claimed = await ledger.claimInvocation({
          runId,
          invocationId: INVOCATION_ID,
          fencingToken: 'repair-stale-fence',
          expectedGeneration: 0,
          expectedVersion: created.run.version,
          transitionId: 'claim-ready-repair-stale',
        });
        const current = expectSingleReadyItem(await listReadyWork(ledger), {
          runId,
          kind: ExecutionLedgerReadyWorkKind.RECOVERY,
          runVersion: claimed.run.version,
          attemptId: claimed.attempt.attemptId,
        });
        const staleRecord = createExecutionLedgerReadyWorkRecord(stale);
        await db.batchWrite({
          tableName,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: staleRecord,
            },
          ],
        });
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [stale, current],
        });

        await expect(
          ledger.repairReadyWork({
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
            observed: stale,
          }),
        ).resolves.toEqual({ applied: true, runId, expected: current });
        expectSingleReadyItem(await listReadyWork(ledger), current);
        await expect(
          ledger.repairReadyWork({
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
            observed: stale,
          }),
        ).resolves.toEqual({ applied: true, runId, expected: current });
        expectSingleReadyItem(await listReadyWork(ledger), current);
      } finally {
        await cleanup();
      }
    });

    test('does not project framework-owned managed-effect successor targets as resident work', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-effect-source';
      try {
        const ledger = createExecutionLedger({
          db,
          tableName: 'execution-ledger-ready-effect-successor',
          effectEvidenceVerifiers: effectVerifierRegistrations(),
          now: createClock(),
        });
        const created = await ledger.createManualRun(manualRun(runId));
        const claimed = await ledger.claimInvocation({
          runId,
          invocationId: INVOCATION_ID,
          fencingToken: 'effect-successor-fence',
          expectedGeneration: 0,
          expectedVersion: created.run.version,
          transitionId: 'claim-effect-source',
        });
        const started = await ledger.markAttemptStarted({
          runId,
          invocationId: INVOCATION_ID,
          attemptId: claimed.attempt.attemptId,
          fencingToken: 'effect-successor-fence',
          generation: 1,
          expectedVersion: claimed.run.version,
          transitionId: 'start-effect-source',
        });
        const requested = await ledger.recordManagedEffectRequest({
          runId,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          fencingToken: 'effect-successor-fence',
          generation: 1,
          expectedVersion: started.run.version,
          transitionId: 'request-ready-effect',
          request: effectRequest(started.attempt.attemptId),
          adapter: {
            id: 'application-state-put-if-absent',
            version: 2,
          },
          destination: TEST_EFFECT_DESTINATION,
          verifier: TEST_EFFECT_VERIFIER,
          substantiatedReplayProperties: ['idempotent', 'transactional'],
        });
        const effectStarted = await ledger.markManagedEffectStarted({
          runId,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          effectId: EFFECT_ID,
          fencingToken: 'effect-successor-fence',
          generation: 1,
          expectedVersion: requested.run.version,
          expectedEffectVersion: requested.effect.version,
          transitionId: 'start-ready-effect',
        });
        const uncertain = await ledger.markManagedEffectUncertain({
          runId,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          effectId: EFFECT_ID,
          fencingToken: 'effect-successor-fence',
          generation: 1,
          expectedVersion: effectStarted.run.version,
          expectedEffectVersion: effectStarted.effect.version,
          transitionId: 'uncertain-ready-effect',
          reason: { kind: 'destination-outcome-unknown' },
        });
        const reconciled = await ledger.reconcileUncertainManagedEffect({
          runId,
          invocationId: INVOCATION_ID,
          attemptId: started.attempt.attemptId,
          effectId: EFFECT_ID,
          fencingToken: 'effect-successor-fence',
          generation: 1,
          coordinatorEpoch: 0,
          expectedVersion: uncertain.run.version,
          expectedEffectVersion: uncertain.effect.version,
          uncertaintyEventId: uncertain.receipt.event_id,
          uncertaintySequence: uncertain.receipt.sequence,
          transitionId: 'reconcile-ready-effect',
          reconciliationId: 'reconcile-ready-effect',
          reason: { kind: 'destination-proved-not-applied' },
          resolution: {
            kind: 'not-applied',
            verifier: TEST_EFFECT_RECONCILIATION_VERIFIER,
            evidence: {
              destinationEffectId: uncertain.effect.destinationEffectId,
              operation: 'put-if-absent',
              disposition: 'not-applied',
            },
          },
        });
        expect(reconciled.effect.status).toBe('NOT_APPLIED');
        const handoff = await ledger.authorizeManagedEffectSuccessorRetry({
          sourceRunId: runId,
          sourceEffectId: EFFECT_ID,
          successorId: 'ready-work-successor',
          reason: { kind: 'operator-retry' },
        });
        expect(handoff.targetRun.trigger.kind).toBe('effect-successor');
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [],
        });
      } finally {
        await cleanup();
      }
    });

    test('does not advance either event history or ready work when a transition transaction fails', async () => {
      const { db, cleanup } = await adapter.create();
      const runId = 'ready-failed-transaction';
      try {
        const tableName = 'execution-ledger-ready-failed-transaction';
        const directLedger = createExecutionLedger({
          db,
          tableName,
          now: createClock(),
        });
        const created = await directLedger.createManualRun(manualRun(runId));
        const before = await listReadyWork(directLedger);
        let failNextTransaction = true;
        const failingDb = {
          ...db,
          /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Rejected transaction. */
          async transactionWrite(params) {
            if (failNextTransaction) {
              failNextTransaction = false;
              throw new Error('injected ready-work transaction failure');
            }
            return await db.transactionWrite(params);
          },
        };
        const failingLedger = createExecutionLedger({
          db: failingDb,
          tableName,
          now: createClock(),
        });

        await expect(
          failingLedger.claimInvocation({
            runId,
            invocationId: INVOCATION_ID,
            fencingToken: 'failed-transaction-fence',
            expectedGeneration: 0,
            expectedVersion: created.run.version,
            transitionId: 'claim-failed-transaction',
          }),
        ).rejects.toThrow('injected ready-work transaction failure');

        await expect(directLedger.getEvents(runId)).resolves.toHaveLength(1);
        expect(await listReadyWork(directLedger)).toEqual(before);
        await expect(directLedger.rebuildRun(runId)).resolves.toMatchObject({
          head: { version: 1, sequence: 1 },
        });
      } finally {
        await cleanup();
      }
    });
  });
}

describe('LMDB ready-work persistence', () => {
  test('retains runnable and recovery locators across database reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wharfie-ready-work-reopen-'));
    const tableName = 'execution-ledger-ready-reopen';
    const runId = 'ready-reopen';
    const now = createClock();
    let db = await createLMDBDB(dir);
    let closed = false;
    try {
      let ledger = createExecutionLedger({ db, tableName, now });
      const created = await ledger.createManualRun(manualRun(runId));
      const runnable = expectSingleReadyItem(await listReadyWork(ledger), {
        runId,
        kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
        runVersion: created.run.version,
        generation: 0,
      });

      await db.close();
      closed = true;
      db = await createLMDBDB(dir);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, now });
      expectSingleReadyItem(await listReadyWork(ledger), runnable);

      const claimed = await ledger.claimInvocation({
        runId,
        invocationId: INVOCATION_ID,
        fencingToken: 'ready-reopen-fence',
        expectedGeneration: 0,
        expectedVersion: created.run.version,
        transitionId: 'claim-ready-reopen',
      });
      const recovery = expectSingleReadyItem(await listReadyWork(ledger), {
        runId,
        kind: ExecutionLedgerReadyWorkKind.RECOVERY,
        runVersion: claimed.run.version,
        attemptId: claimed.attempt.attemptId,
        generation: 1,
      });

      await db.close();
      closed = true;
      db = await createLMDBDB(dir);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, now });
      expectSingleReadyItem(await listReadyWork(ledger), recovery);
      await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
        run: { runId, version: claimed.run.version },
        attempts: [
          {
            attemptId: claimed.attempt.attemptId,
            status: 'CLAIMED',
          },
        ],
      });
    } finally {
      if (!closed) await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
