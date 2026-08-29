/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ExecutionLedgerRunConflictError,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  LocalApplicationActivationAction,
  LocalApplicationActivationDestination,
  LocalApplicationAdmissionClosedError,
  createLocalApplicationActivation,
} from '../../src/core/lib/db/tables/local-application-activation.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  createMutableDBTestFacade,
  getAdapterMatrix,
} from '../helpers/db-adapters.js';

/** @typedef {import('../../src/core/lib/db/base.js').DBClient} DBClient */

const REVISION_A = `wrv1_${'A'.repeat(43)}`;
const REVISION_B = `wrv1_${'B'.repeat(42)}A`;
const RELEASE_A = Object.freeze({
  artifactId: `waf1_${'A'.repeat(43)}`,
  revisionId: REVISION_A,
});
const RELEASE_B = Object.freeze({
  artifactId: `waf1_${'B'.repeat(42)}A`,
  revisionId: REVISION_B,
});

/** @param {string} appId @param {string} runId */
function manualRun(appId, runId) {
  return {
    runId,
    appId,
    revisionId: REVISION_A,
    invocationId: 'main',
    activityId: 'greet',
    input: { name: 'Ada' },
    callerMetadata: { source: 'activation-admission-test' },
    transitionId: `create-${runId}`,
  };
}

/** @param {string} appId @param {string} idempotencyKey */
function workflowRun(appId, idempotencyKey) {
  const runId = createWorkflowRunId({ appId, idempotencyKey });
  return {
    runId,
    appId,
    revisionId: REVISION_A,
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
    callerMetadata: { source: 'activation-admission-test' },
    transitionId: `create-${runId}`,
  };
}

/** @param {ReturnType<typeof createLocalApplicationActivation>} activation @param {string} appId */
async function activate(activation, appId) {
  const begun = await activation.beginInstall({
    appId,
    target: RELEASE_A,
  });
  const transitionId = begun.activation.transition.transitionId;
  await activation.markQuiescent({ appId, transitionId });
  await activation.markSelected({
    appId,
    transitionId,
    destination: LocalApplicationActivationDestination.TARGET,
  });
  await activation.markActivating({ appId, transitionId });
  await activation.completeActivation({ appId, transitionId });
}

/** @param {ReturnType<typeof createLocalApplicationActivation>} activation @param {string} appId */
async function closeAdmission(activation, appId) {
  await activation.beginChange({
    appId,
    action: LocalApplicationActivationAction.UPDATE,
    source: RELEASE_A,
    target: RELEASE_B,
  });
}

/**
 * @param {DBClient} db
 * @param {() => Promise<void>} beforeConditionedWrite
 * @returns {DBClient}
 */
function interceptFirstConditionedWrite(db, beforeConditionedWrite) {
  let intercepted = false;
  const facade = createMutableDBTestFacade(db);
  return /** @type {DBClient} */ (
    new Proxy(facade, {
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

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} execution-ledger local application admission`, () => {
    test('admits only the active revision while preserving exact run replays', async () => {
      const { db, cleanup } = await adapter.create();
      const payloadRoot = mkdtempSync(
        join(tmpdir(), 'wharfie-ledger-admission-'),
      );
      const tableName = `execution-ledger-admission-${adapter.name}`;
      const appId = `admission-${adapter.name}`;
      try {
        const activation = createLocalApplicationActivation({ db, tableName });
        await activate(activation, appId);
        const ledger = createExecutionLedger({
          db,
          tableName,
          payloadStore: createLocalExecutionPayloadStore({
            path: payloadRoot,
            storeId: `admission-${adapter.name}`,
          }),
        });
        const manual = manualRun(appId, `manual-${adapter.name}`);
        const workflow = workflowRun(appId, `workflow-${adapter.name}`);
        await expect(ledger.createManualRun(manual)).resolves.toMatchObject({
          applied: true,
        });
        await expect(ledger.createWorkflowRun(workflow)).resolves.toMatchObject(
          { applied: true },
        );

        await closeAdmission(activation, appId);

        await expect(ledger.createManualRun(manual)).resolves.toMatchObject({
          applied: false,
        });
        await expect(ledger.createWorkflowRun(workflow)).resolves.toMatchObject(
          { applied: false },
        );
        await expect(
          ledger.createManualRun(
            manualRun(appId, `manual-closed-${adapter.name}`),
          ),
        ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
        await expect(
          ledger.createWorkflowRun(
            workflowRun(appId, `workflow-closed-${adapter.name}`),
          ),
        ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
      } finally {
        await cleanup();
        rmSync(payloadRoot, { recursive: true, force: true });
      }
    });

    test('rejects run creation when activation changes after preflight', async () => {
      const { db, cleanup } = await adapter.create();
      const payloadRoot = mkdtempSync(
        join(tmpdir(), 'wharfie-ledger-admission-race-'),
      );
      const tableName = `execution-ledger-admission-race-${adapter.name}`;
      const appId = `admission-race-${adapter.name}`;
      try {
        const activation = createLocalApplicationActivation({ db, tableName });
        await activate(activation, appId);
        const racingDb = interceptFirstConditionedWrite(db, async () => {
          await closeAdmission(activation, appId);
        });
        const ledger = createExecutionLedger({
          db: racingDb,
          tableName,
          payloadStore: createLocalExecutionPayloadStore({
            path: payloadRoot,
            storeId: `admission-race-${adapter.name}`,
          }),
        });
        const request = manualRun(appId, `manual-race-${adapter.name}`);

        await expect(ledger.createManualRun(request)).rejects.toBeInstanceOf(
          LocalApplicationAdmissionClosedError,
        );
        await expect(ledger.rebuildRun(request.runId)).resolves.toBeNull();
      } finally {
        await cleanup();
        rmSync(payloadRoot, { recursive: true, force: true });
      }
    });

    test('returns an exact raced winner before reclassifying admission', async () => {
      const { db, cleanup } = await adapter.create();
      const payloadRoot = mkdtempSync(
        join(tmpdir(), 'wharfie-ledger-admission-winner-'),
      );
      const tableName = `execution-ledger-admission-winner-${adapter.name}`;
      const appId = `admission-winner-${adapter.name}`;
      try {
        const activation = createLocalApplicationActivation({ db, tableName });
        await activate(activation, appId);
        const payloadStore = createLocalExecutionPayloadStore({
          path: payloadRoot,
          storeId: `admission-winner-${adapter.name}`,
        });
        const winnerLedger = createExecutionLedger({
          db,
          tableName,
          payloadStore,
        });
        const request = workflowRun(appId, `workflow-winner-${adapter.name}`);
        const racingDb = interceptFirstConditionedWrite(db, async () => {
          await winnerLedger.createWorkflowRun(request);
          await closeAdmission(activation, appId);
        });
        const racingLedger = createExecutionLedger({
          db: racingDb,
          tableName,
          payloadStore,
        });

        await expect(
          racingLedger.createWorkflowRun(request),
        ).resolves.toMatchObject({ applied: false });
      } finally {
        await cleanup();
        rmSync(payloadRoot, { recursive: true, force: true });
      }
    });

    test.each(['manual', 'workflow'])(
      'keeps a durable %s run-id conflict ahead of a simultaneous admission close',
      async (kind) => {
        const { db, cleanup } = await adapter.create();
        const payloadRoot = mkdtempSync(
          join(tmpdir(), 'wharfie-ledger-admission-conflict-'),
        );
        const tableName = `execution-ledger-admission-conflict-${adapter.name}-${kind}`;
        const appId = `admission-conflict-${adapter.name}-${kind}`;
        try {
          const activation = createLocalApplicationActivation({
            db,
            tableName,
          });
          await activate(activation, appId);
          const payloadStore = createLocalExecutionPayloadStore({
            path: payloadRoot,
            storeId: `admission-conflict-${adapter.name}-${kind}`,
          });
          const winnerLedger = createExecutionLedger({
            db,
            tableName,
            payloadStore,
          });
          const request =
            kind === 'manual'
              ? manualRun(appId, `manual-conflict-${adapter.name}`)
              : workflowRun(appId, `workflow-conflict-${adapter.name}`);
          const winnerRequest = {
            ...request,
            input: { name: 'Grace' },
          };
          const racingDb = interceptFirstConditionedWrite(db, async () => {
            if (kind === 'manual') {
              await winnerLedger.createManualRun(winnerRequest);
            } else {
              await winnerLedger.createWorkflowRun(winnerRequest);
            }
            await closeAdmission(activation, appId);
          });
          const racingLedger = createExecutionLedger({
            db: racingDb,
            tableName,
            payloadStore,
          });

          await expect(
            kind === 'manual'
              ? racingLedger.createManualRun(request)
              : racingLedger.createWorkflowRun(request),
          ).rejects.toBeInstanceOf(ExecutionLedgerRunConflictError);
        } finally {
          await cleanup();
          rmSync(payloadRoot, { recursive: true, force: true });
        }
      },
    );
  });
}
