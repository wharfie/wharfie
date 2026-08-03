/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import {
  createMockedDynamoDB,
  createVanillaDB,
} from '../helpers/db-adapters.js';

const TABLE_NAME = 'execution-ledger-authority';
const APP_ID = 'demo';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'coordinator-recovery-run';
const INVOCATION_ID = 'main';
const ACTIVITY_ID = 'greet';

/**
 * @typedef {{
 *   name: string,
 *   create: (root: string) => Promise<import('../../src/core/lib/db/base.js').DBClient>,
 * }} AdapterCase
 */

/**
 * @typedef {{
 *   db: import('../../src/core/lib/db/base.js').DBClient,
 *   payloadStore: ReturnType<typeof createLocalExecutionPayloadStore>,
 *   authority: ReturnType<typeof createCoordinatorAuthority>,
 * }} TestEnvironment
 */

/** @type {AdapterCase[]} */
const adapterCases = [
  {
    name: 'vanilla',
    async create(root) {
      return await createVanillaDB(join(root, 'db'));
    },
  },
  {
    name: 'mocked DynamoDB',
    async create() {
      const { db } = await createMockedDynamoDB({
        tableSchemas: { [TABLE_NAME]: ['run_id', 'sort_key'] },
      });
      return db;
    },
  },
];

/** @type {Array<() => Promise<void>>} */
let cleanups = [];

afterEach(async () => {
  const pending = cleanups;
  cleanups = [];
  const results = await Promise.allSettled(
    pending.map(async (cleanup) => await cleanup()),
  );
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'ledger authority test cleanup failed');
  }
});

/**
 * @param {AdapterCase} adapterCase
 * @returns {Promise<TestEnvironment>}
 */
async function createEnvironment(adapterCase) {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-ledger-authority-'));
  const db = await adapterCase.create(root);
  const payloadStore = createLocalExecutionPayloadStore({
    path: join(root, 'payloads'),
    storeId:
      adapterCase.name === 'vanilla'
        ? 'ledger-authority-vanilla'
        : 'ledger-authority-dynamodb',
  });
  cleanups.push(async () => {
    await db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    db,
    payloadStore,
    authority: createCoordinatorAuthority({ db, tableName: TABLE_NAME }),
  };
}

function runRequest() {
  return {
    runId: RUN_ID,
    appId: APP_ID,
    revisionId: REVISION_ID,
    invocationId: INVOCATION_ID,
    activityId: ACTIVITY_ID,
    input: { name: 'Ada' },
    callerMetadata: { source: 'coordinator-authority-test' },
    transitionId: 'create-run',
    observedAt: 100,
  };
}

/**
 * @param {ReturnType<typeof createCoordinatorAuthority>} authority
 * @returns {Promise<Record<string, any>>}
 */
async function acquireFirst(authority) {
  return await authority.acquire({
    appId: APP_ID,
    coordinatorId: 'coordinator-a',
    requestId: 'acquire-a',
    observedAt: 10,
  });
}

/**
 * @param {ReturnType<typeof createCoordinatorAuthority>} authority
 * @param {Record<string, any>} predecessor
 * @param {string} [suffix]
 * @returns {Promise<Record<string, any>>}
 */
async function takeover(authority, predecessor, suffix = 'b') {
  return await authority.takeover({
    appId: APP_ID,
    coordinatorId: `coordinator-${suffix}`,
    requestId: `takeover-${suffix}`,
    observedAuthority: predecessor,
    confirmAuthorityReplacement: true,
    observedAt: 20,
  });
}

/**
 * @param {TestEnvironment} environment
 * @param {import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken | import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot} authority
 * @param {import('../../src/core/lib/db/base.js').DBClient} [db]
 * @returns {ReturnType<typeof createExecutionLedger>}
 */
function ledgerFor(environment, authority, db = environment.db) {
  return createExecutionLedger({
    db,
    tableName: TABLE_NAME,
    payloadStore: environment.payloadStore,
    coordinatorAuthority: authority,
    now: () => 999,
  });
}

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger
 * @param {number} [epoch]
 * @returns {Promise<Record<string, any>>}
 */
async function createAndClaim(ledger, epoch = 1) {
  const created = await ledger.createManualRun(runRequest());
  const claimed = await ledger.claimInvocation({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    fencingToken: `fence-${epoch}`,
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    coordinatorEpoch: epoch,
    transitionId: `claim-${epoch}`,
    observedAt: 110,
  });
  if (!claimed.attempt) throw new Error('Expected a claimed attempt.');
  return claimed;
}

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger
 * @param {Record<string, any>} claimed
 * @param {number} [epoch]
 * @returns {Promise<Record<string, any>>}
 */
async function startClaimed(ledger, claimed, epoch = 1) {
  return await ledger.markAttemptStarted({
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    attemptId: claimed.attempt.attemptId,
    fencingToken: `fence-${epoch}`,
    generation: claimed.attempt.generation,
    expectedVersion: claimed.run.version,
    coordinatorEpoch: epoch,
    transitionId: `start-${epoch}`,
    observedAt: 120,
  });
}

/**
 * @param {Readonly<Record<string, any>>} startFrame
 * @returns {Record<string, any>}
 */
function completedEvidence(startFrame) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const start = transcript.acceptHostFrame(startFrame);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result: { greeting: 'hello' },
  });
  return {
    status: terminal.type,
    start,
    terminal,
    frames: [start, terminal],
    transcript: transcript.snapshot(),
  };
}

describe.each(adapterCases)(
  'execution-ledger coordinator fencing over $name',
  (adapterCase) => {
    test('rejects admission when takeover wins immediately before its transaction', async () => {
      const environment = await createEnvironment(adapterCase);
      const acquired = await acquireFirst(environment.authority);
      let replacement;
      let intercept = true;
      const delayedDb = {
        ...environment.db,
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
        ) {
          if (intercept) {
            intercept = false;
            replacement = await takeover(
              environment.authority,
              acquired.authority,
            );
          }
          return await environment.db.transactionWrite(params);
        },
      };
      const predecessorLedger = ledgerFor(
        environment,
        acquired.authority,
        delayedDb,
      );

      await expect(
        predecessorLedger.startManagedEffectSuccessor({
          runId: 'not-yet-created',
          fencingToken: 'wrong-epoch',
          expectedVersion: 1,
          coordinatorEpoch: 0,
          transitionId: 'wrong-successor-epoch',
          observedAt: 90,
        }),
      ).rejects.toThrow(
        /startManagedEffectSuccessor\.coordinatorEpoch must match/i,
      );
      await expect(
        predecessorLedger.createManualRun(runRequest()),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
      await expect(predecessorLedger.getRun(RUN_ID)).resolves.toBeNull();
      expect(replacement).toMatchObject({
        authority: { coordinatorId: 'coordinator-b', epoch: 2 },
      });
    });

    test('prevents stale dispatch and lets the successor reclaim unstarted work', async () => {
      const environment = await createEnvironment(adapterCase);
      const acquired = await acquireFirst(environment.authority);
      const predecessorLedger = ledgerFor(environment, acquired.authority);
      const claimed = await createAndClaim(predecessorLedger);
      const replacement = await takeover(
        environment.authority,
        acquired.authority,
      );

      await expect(
        startClaimed(predecessorLedger, claimed),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
      await expect(
        predecessorLedger.getAttempt(
          RUN_ID,
          INVOCATION_ID,
          claimed.attempt.attemptId,
        ),
      ).resolves.toMatchObject({ status: AttemptStatus.CLAIMED });

      const successorLedger = ledgerFor(environment, replacement.authority);
      const abandoned = await successorLedger.abandonUnstartedAttempt({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId: claimed.attempt.attemptId,
        fencingToken: 'fence-1',
        generation: 1,
        expectedVersion: claimed.run.version,
        coordinatorEpoch: 1,
        transitionId: 'abandon-predecessor',
        reason: { code: 'coordinator-replaced' },
        observedAt: 130,
      });
      expect(abandoned).toMatchObject({
        run: { status: RunStatus.RUNNING, version: 3 },
        invocation: {
          status: InvocationStatus.RUNNABLE,
          generation: 1,
        },
        attempt: { status: AttemptStatus.ABANDONED },
      });

      const successorClaim = await successorLedger.claimInvocation({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        fencingToken: 'fence-2',
        expectedGeneration: 1,
        expectedVersion: abandoned.run.version,
        coordinatorEpoch: 2,
        transitionId: 'claim-successor',
        observedAt: 140,
      });
      const started = await successorLedger.markAttemptStarted({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId: successorClaim.attempt.attemptId,
        fencingToken: 'fence-2',
        generation: 2,
        expectedVersion: successorClaim.run.version,
        coordinatorEpoch: 2,
        transitionId: 'start-successor',
        observedAt: 150,
      });
      expect(started).toMatchObject({
        applied: true,
        dispatchAuthorized: true,
        attempt: { status: AttemptStatus.STARTED, coordinatorEpoch: 2 },
      });

      const committed = await successorLedger.commitVerifiedAttemptTerminal({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId: successorClaim.attempt.attemptId,
        fencingToken: 'fence-2',
        generation: 2,
        expectedVersion: started.run.version,
        coordinatorEpoch: 2,
        transitionId: 'terminal-successor',
        evidence: completedEvidence(started.startFrame),
        observedAt: 160,
      });
      expect(committed).toMatchObject({
        run: { status: RunStatus.COMPLETED },
        invocation: { status: InvocationStatus.COMPLETED },
        attempt: { status: AttemptStatus.COMPLETED },
      });
    });

    test('blocks stale settlement and lets the successor mark started work uncertain', async () => {
      const environment = await createEnvironment(adapterCase);
      const acquired = await acquireFirst(environment.authority);
      const predecessorLedger = ledgerFor(environment, acquired.authority);
      const claimed = await createAndClaim(predecessorLedger);
      const started = await startClaimed(predecessorLedger, claimed);
      const terminalRequest = {
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId: claimed.attempt.attemptId,
        fencingToken: 'fence-1',
        generation: 1,
        expectedVersion: started.run.version,
        coordinatorEpoch: 1,
        transitionId: 'terminal-predecessor',
        evidence: completedEvidence(started.startFrame),
        observedAt: 130,
      };
      const replacement = await takeover(
        environment.authority,
        acquired.authority,
      );

      await expect(
        predecessorLedger.commitVerifiedAttemptTerminal(terminalRequest),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
      await expect(
        predecessorLedger.markAttemptStarted({
          runId: RUN_ID,
          invocationId: INVOCATION_ID,
          attemptId: claimed.attempt.attemptId,
          fencingToken: 'fence-1',
          generation: 1,
          expectedVersion: claimed.run.version,
          coordinatorEpoch: 1,
          transitionId: 'start-1',
          observedAt: 120,
        }),
      ).resolves.toMatchObject({
        applied: false,
        dispatchAuthorized: false,
      });

      const successorLedger = ledgerFor(environment, replacement.authority);
      const uncertain = await successorLedger.markAttemptUncertain({
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId: claimed.attempt.attemptId,
        fencingToken: 'fence-1',
        generation: 1,
        expectedVersion: started.run.version,
        coordinatorEpoch: 1,
        transitionId: 'uncertain-predecessor',
        reason: { code: 'coordinator-replaced-after-start' },
        observedAt: 140,
      });
      expect(uncertain).toMatchObject({
        run: { status: RunStatus.BLOCKED },
        invocation: { status: InvocationStatus.UNCERTAIN },
        attempt: { status: AttemptStatus.ABANDONED },
      });
    });

    test('keeps an exact terminal receipt readable after response loss and takeover', async () => {
      const environment = await createEnvironment(adapterCase);
      const acquired = await acquireFirst(environment.authority);
      const predecessorLedger = ledgerFor(environment, acquired.authority);
      const claimed = await createAndClaim(predecessorLedger);
      const started = await startClaimed(predecessorLedger, claimed);
      let loseResponse = true;
      const faultedDb = {
        ...environment.db,
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
        ) {
          await environment.db.transactionWrite(params);
          if (loseResponse) {
            loseResponse = false;
            throw new Error('simulated ledger response loss after commit');
          }
        },
      };
      const faultedLedger = ledgerFor(
        environment,
        acquired.authority,
        faultedDb,
      );
      const terminalRequest = {
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        attemptId: claimed.attempt.attemptId,
        fencingToken: 'fence-1',
        generation: 1,
        expectedVersion: started.run.version,
        coordinatorEpoch: 1,
        transitionId: 'terminal-lost-response',
        evidence: completedEvidence(started.startFrame),
        observedAt: 130,
      };

      await expect(
        faultedLedger.commitVerifiedAttemptTerminal(terminalRequest),
      ).rejects.toThrow('simulated ledger response loss after commit');
      await takeover(environment.authority, acquired.authority);
      await expect(
        faultedLedger.commitVerifiedAttemptTerminal(terminalRequest),
      ).resolves.toMatchObject({
        applied: false,
        run: { status: RunStatus.COMPLETED },
        invocation: { status: InvocationStatus.COMPLETED },
        attempt: { status: AttemptStatus.COMPLETED },
      });
      await expect(faultedLedger.getEvents(RUN_ID)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'attempt-terminal',
            transition_id: 'terminal-lost-response',
          }),
        ]),
      );
      expect(
        (await faultedLedger.getEvents(RUN_ID)).filter(
          (event) => event.type === 'attempt-terminal',
        ),
      ).toHaveLength(1);
    });
  },
);
