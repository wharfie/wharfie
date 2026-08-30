/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  CoordinatorQuiescenceBarrierClosedError,
  createCoordinatorQuiescenceBarrier,
} from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import {
  ExecutionLedgerConflictError,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';

const APP_ID = 'coordinator-quiescence-ledger';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const ACTOR = Object.freeze({ kind: 'test', id: 'coordinator-quiescence' });

/** @type {Array<() => Promise<void>>} */
const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(async (cleanup) => await cleanup()));
});

/** @param {string} suffix */
async function createHarness(suffix) {
  const root = mkdtempSync(join(tmpdir(), `wharfie-ledger-barrier-${suffix}-`));
  const db = createVanillaDB({ path: root });
  const tableName = `ledger-barrier-${suffix}`;
  const authorities = createCoordinatorAuthority({ db, tableName });
  const acquired = await authorities.acquire({
    appId: APP_ID,
    coordinatorId: `coordinator-${suffix}`,
    requestId: `acquire-${suffix}`,
    observedAt: 1,
  });
  const payloadStore = createLocalExecutionPayloadStore({
    path: join(root, 'payloads'),
    storeId: `ledger-barrier-${suffix}`,
  });
  cleanups.push(async () => {
    await db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    authority: acquired.authority,
    barrier: createCoordinatorQuiescenceBarrier({ db, tableName }),
    db,
    ledger: createExecutionLedger({
      db,
      tableName,
      payloadStore,
      coordinatorAuthority: acquired.authority,
    }),
    payloadStore,
    tableName,
  };
}

/** @param {string} runId */
function manualRun(runId) {
  return {
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    invocationId: 'main',
    activityId: 'greet',
    input: { name: 'Ada' },
    callerMetadata: {},
    transitionId: `create-${runId}`,
    actor: ACTOR,
  };
}

/** @param {string} key */
function workflowRun(key) {
  const runId = createWorkflowRunId({ appId: APP_ID, idempotencyKey: key });
  return {
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: 'greeting-workflow',
    definition: {
      steps: [
        {
          id: 'greet',
          kind: 'activity',
          activity: 'greet',
          input: { kind: 'workflow-input' },
        },
      ],
    },
    input: { name: 'Ada' },
    callerMetadata: {},
    transitionId: `create-${runId}`,
    actor: ACTOR,
  };
}

/**
 * @param {import('../../src/core/lib/db/base.js').DBClient} db
 * @param {() => Promise<void>} beforeConditionedWrite
 */
function interceptFirstConditionedWrite(db, beforeConditionedWrite) {
  let intercepted = false;
  return /** @type {import('../../src/core/lib/db/base.js').DBClient} */ (
    new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transactionWrite') {
          /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
          return async (params) => {
            if (!intercepted && params.conditionChecks?.length) {
              intercepted = true;
              await beforeConditionedWrite();
            }
            return await target.transactionWrite(params);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })
  );
}

describe('execution-ledger coordinator quiescence admission', () => {
  test('blocks fresh manual and workflow work while preserving exact retained replays', async () => {
    const harness = await createHarness('closed');
    const manual = manualRun('manual-before-close');
    const workflow = workflowRun('workflow-before-close');
    await expect(harness.ledger.createManualRun(manual)).resolves.toMatchObject(
      {
        applied: true,
      },
    );
    await expect(
      harness.ledger.createWorkflowRun(workflow),
    ).resolves.toMatchObject({ applied: true });

    await harness.barrier.close({
      authority: harness.authority,
      requestId: 'close-ledger-admission',
      predecessor: null,
      observedAt: 10,
    });
    const unboundLedger = createExecutionLedger({
      db: harness.db,
      tableName: harness.tableName,
      payloadStore: harness.payloadStore,
    });

    await expect(harness.ledger.createManualRun(manual)).resolves.toMatchObject(
      {
        applied: false,
      },
    );
    await expect(
      harness.ledger.createWorkflowRun(workflow),
    ).resolves.toMatchObject({ applied: false });
    await expect(unboundLedger.createManualRun(manual)).resolves.toMatchObject({
      applied: false,
    });
    await expect(
      harness.ledger.createManualRun(manualRun('manual-after-close')),
    ).rejects.toBeInstanceOf(CoordinatorQuiescenceBarrierClosedError);
    const blockedWorkflow = workflowRun('workflow-after-close');
    await expect(
      harness.ledger.createWorkflowRun(blockedWorkflow),
    ).rejects.toBeInstanceOf(CoordinatorQuiescenceBarrierClosedError);
    await expect(
      unboundLedger.createManualRun(manualRun('unbound-after-close')),
    ).rejects.toBeInstanceOf(CoordinatorQuiescenceBarrierClosedError);
    await expect(
      harness.ledger.rebuildRun('manual-after-close'),
    ).resolves.toBeNull();
    await expect(
      harness.ledger.rebuildRun(blockedWorkflow.runId),
    ).resolves.toBeNull();
  });

  test('rejects a delayed pre-close admission after close and reopen', async () => {
    const harness = await createHarness('generation');
    const racingDb = interceptFirstConditionedWrite(harness.db, async () => {
      const closed = await harness.barrier.close({
        authority: harness.authority,
        requestId: 'close-during-admission',
        predecessor: null,
        observedAt: 20,
      });
      await harness.barrier.reopen({
        authority: harness.authority,
        requestId: 'reopen-during-admission',
        predecessor: closed.barrier,
        observedAt: 21,
      });
    });
    const ledger = createExecutionLedger({
      db: racingDb,
      tableName: harness.tableName,
      payloadStore: harness.payloadStore,
      coordinatorAuthority: harness.authority,
    });
    const request = manualRun('manual-delayed-before-close');

    await expect(ledger.createManualRun(request)).rejects.toBeInstanceOf(
      ExecutionLedgerConflictError,
    );
    await expect(ledger.rebuildRun(request.runId)).resolves.toBeNull();
    await expect(ledger.createManualRun(request)).resolves.toMatchObject({
      applied: true,
    });
  });

  test('reports stale authority before a successor-owned closed barrier', async () => {
    const harness = await createHarness('stale-authority');
    await harness.barrier.close({
      authority: harness.authority,
      requestId: 'close-before-takeover',
      predecessor: null,
      observedAt: 30,
    });
    const authorities = createCoordinatorAuthority({
      db: harness.db,
      tableName: harness.tableName,
    });
    await authorities.takeover({
      appId: APP_ID,
      coordinatorId: 'successor-after-closed-barrier',
      requestId: 'takeover-after-closed-barrier',
      observedAuthority: harness.authority,
      confirmAuthorityReplacement: true,
      observedAt: 31,
    });

    await expect(
      harness.ledger.createManualRun(manualRun('manual-under-stale-owner')),
    ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
  });

  test('uses close as the takeover cutover for successor-authority admissions', async () => {
    const harness = await createHarness('takeover-cutover');
    const initialClosed = await harness.barrier.close({
      authority: harness.authority,
      requestId: 'initial-close-before-takeover',
      predecessor: null,
      observedAt: 40,
    });
    const predecessorOpen = await harness.barrier.reopen({
      authority: harness.authority,
      requestId: 'initial-open-before-takeover',
      predecessor: initialClosed.barrier,
      observedAt: 41,
    });
    const authorities = createCoordinatorAuthority({
      db: harness.db,
      tableName: harness.tableName,
    });
    const takeover = await authorities.takeover({
      appId: APP_ID,
      coordinatorId: 'successor-cutover-coordinator',
      requestId: 'takeover-before-barrier-cutover',
      observedAuthority: harness.authority,
      confirmAuthorityReplacement: true,
      observedAt: 42,
    });
    const successorLedger = createExecutionLedger({
      db: harness.db,
      tableName: harness.tableName,
      payloadStore: harness.payloadStore,
      coordinatorAuthority: takeover.authority,
    });
    const beforeClose = manualRun('successor-admission-before-close');

    await expect(
      successorLedger.createManualRun(beforeClose),
    ).resolves.toMatchObject({ applied: true });

    /** @type {any} */
    let successorClosed;
    const racingDb = interceptFirstConditionedWrite(harness.db, async () => {
      successorClosed = await harness.barrier.close({
        authority: takeover.authority,
        requestId: 'successor-close-cutover',
        predecessor: predecessorOpen.barrier,
        observedAt: 43,
      });
    });
    const racingLedger = createExecutionLedger({
      db: racingDb,
      tableName: harness.tableName,
      payloadStore: harness.payloadStore,
      coordinatorAuthority: takeover.authority,
    });
    const delayed = manualRun('successor-admission-delayed-at-close');
    await expect(racingLedger.createManualRun(delayed)).rejects.toBeInstanceOf(
      CoordinatorQuiescenceBarrierClosedError,
    );
    await expect(racingLedger.rebuildRun(delayed.runId)).resolves.toBeNull();
    await expect(
      successorLedger.createManualRun(beforeClose),
    ).resolves.toMatchObject({ applied: false });

    if (!successorClosed) {
      throw new Error('Expected successor close to win the delayed admission.');
    }
    await harness.barrier.reopen({
      authority: takeover.authority,
      requestId: 'successor-reopen-after-cutover',
      predecessor: successorClosed.barrier,
      observedAt: 44,
    });
    await expect(racingLedger.createManualRun(delayed)).resolves.toMatchObject({
      applied: true,
    });
  });
});
