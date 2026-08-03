/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';

import {
  createWorkflowPlanId,
  createWorkflowRunId,
  createWorkflowTimerId,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';
import {
  WORKFLOW_SIGNAL_OPERATOR_ACTOR_KIND,
  deliverWorkflowLedgerSignal,
  fireWorkflowLedgerTimer,
} from '../../src/core/runtime/workflow-ledger-continuation.js';

const APP_ID = 'workflow-continuation-demo';
const RUN_ID = createWorkflowRunId({
  appId: APP_ID,
  idempotencyKey: 'continuation-run',
});
const PLAN_ID = createWorkflowPlanId({
  schemaVersion: 1,
  kind: 'workflowPlan',
  appId: APP_ID,
  revisionId: `wrv1_${'A'.repeat(43)}`,
  workflowId: 'main',
  definition: { steps: [{ id: 'pause', kind: 'timer', delayMs: 1 }] },
});
const TIMER_ID = createWorkflowTimerId({
  runId: RUN_ID,
  planId: PLAN_ID,
  stepId: 'pause',
  stepIndex: 0,
});

describe('workflow ledger framework continuations', () => {
  it('forwards one exact timer identity without authored dispatch state', async () => {
    const decision = Object.freeze({ applied: true, outcome: 'fired' });
    const fireWorkflowTimer = jest.fn(
      async (/** @type {Record<string, any>} */ _options) => decision,
    );
    const ledger = /** @type {any} */ ({ fireWorkflowTimer });

    await expect(
      fireWorkflowLedgerTimer({
        ledger,
        runId: RUN_ID,
        timerId: TIMER_ID,
        actor: { kind: 'resident-workflow-timer', id: APP_ID },
        observedAt: 10,
      }),
    ).resolves.toBe(decision);
    expect(fireWorkflowTimer).toHaveBeenCalledWith({
      runId: RUN_ID,
      timerId: TIMER_ID,
      actor: { kind: 'resident-workflow-timer', id: APP_ID },
      observedAt: 10,
    });
  });

  it('fixes app-scoped signal actor and snapshots the caller payload', async () => {
    /** @type {() => void} */
    let release = () => undefined;
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const deliverWorkflowSignal = jest.fn(
      async (/** @type {Record<string, any>} */ _options) => {
        await gate;
        return { applied: true, outcome: 'accepted' };
      },
    );
    const ledger = /** @type {any} */ ({ deliverWorkflowSignal });
    const payload = { approved: true, nested: { count: 1 } };

    const pending = deliverWorkflowLedgerSignal({
      ledger,
      appId: APP_ID,
      runId: RUN_ID,
      signalId: 'approval',
      deliveryId: 'delivery-1',
      payload,
      observedAt: 20,
    });
    payload.nested.count = 99;
    release();
    await pending;

    expect(deliverWorkflowSignal).toHaveBeenCalledWith({
      appId: APP_ID,
      runId: RUN_ID,
      signalId: 'approval',
      deliveryId: 'delivery-1',
      payload: { approved: true, nested: { count: 1 } },
      actor: { kind: WORKFLOW_SIGNAL_OPERATOR_ACTOR_KIND, id: APP_ID },
      observedAt: 20,
    });
  });

  it('requires a payload and rejects caller-selected signal authority', async () => {
    const ledger = /** @type {any} */ ({
      deliverWorkflowSignal: jest.fn(),
    });
    await expect(
      deliverWorkflowLedgerSignal(
        /** @type {any} */ ({
          ledger,
          appId: APP_ID,
          runId: RUN_ID,
          signalId: 'approval',
          deliveryId: 'delivery-1',
        }),
      ),
    ).rejects.toThrow(/requires payload/i);
    await expect(
      deliverWorkflowLedgerSignal(
        /** @type {any} */ ({
          ledger,
          appId: APP_ID,
          runId: RUN_ID,
          signalId: 'approval',
          deliveryId: 'delivery-1',
          payload: null,
          actor: { kind: 'caller', id: 'caller' },
        }),
      ),
    ).rejects.toThrow(/actor is not supported/i);
  });
});
