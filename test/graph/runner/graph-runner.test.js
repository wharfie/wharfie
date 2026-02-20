/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../../lambdas/lib/db/adapters/vanilla.js';
import { createOperationsTable } from '../../../lambdas/lib/db/tables/operations.js';

import Action from '../../../lambdas/lib/graph/action.js';
import Operation from '../../../lambdas/lib/graph/operation.js';
import { runOperation } from '../../../lambdas/lib/graph/runner.js';

describe('graph runner', () => {
  test('executes a persisted action DAG in prerequisite order', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wharfie-runner-'));
    try {
      const db = createVanillaDB({ path: tmp });
      const tableName = 'operations-runner-test';
      const store = createOperationsTable({ db, tableName });

      const resourceId = 'r1';
      const operation = new Operation({
        id: 'op1',
        resource_id: resourceId,
        resource_version: 1,
        type: Operation.Type.PIPELINE,
      });

      const actionA = operation.createAction({
        id: 'a1',
        type: Action.Type.START,
      });
      const actionB = operation.createAction({
        id: 'b1',
        type: Action.Type.FINISH,
        dependsOn: [actionA],
      });

      await store.putOperation(operation);

      /** @type {string[]} */
      const order = [];

      /**
       * @param {Action} action - action.
       */
      const executeAction = async (action) => {
        order.push(action.type);

        const current = await store.getAction(
          resourceId,
          operation.id,
          action.id,
        );
        expect(current).not.toBeNull();
        if (!current) throw new Error('Expected action to exist');
        expect(current.status).toBe(Action.Status.RUNNING);

        if (action.id === actionB.id) {
          const upstream = await store.getAction(
            resourceId,
            operation.id,
            actionA.id,
          );
          expect(upstream).not.toBeNull();
          if (!upstream)
            throw new Error('Expected prerequisite action to exist');
          expect(upstream.status).toBe(Action.Status.COMPLETED);
        }

        return true;
      };

      const result = await runOperation({
        store,
        resourceId,
        operationId: operation.id,
        executeAction,
      });

      expect(order).toEqual([Action.Type.START, Action.Type.FINISH]);
      expect(result.executedActionIds).toEqual([actionA.id, actionB.id]);

      const afterA = await store.getAction(
        resourceId,
        operation.id,
        actionA.id,
      );
      const afterB = await store.getAction(
        resourceId,
        operation.id,
        actionB.id,
      );
      expect(afterA).not.toBeNull();
      expect(afterB).not.toBeNull();
      if (!afterA || !afterB) throw new Error('Expected actions to exist');
      expect(afterA.status).toBe(Action.Status.COMPLETED);
      expect(afterB.status).toBe(Action.Status.COMPLETED);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
