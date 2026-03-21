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
  test('executes a persisted action DAG in prerequisite order and persists COMPLETED', async () => {
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
        started_at: 1,
        last_updated_at: 1,
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
          if (!upstream) {
            throw new Error('Expected prerequisite action to exist');
          }
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
      const storedOperation = await store.getOperation(
        resourceId,
        operation.id,
      );
      expect(afterA).not.toBeNull();
      expect(afterB).not.toBeNull();
      expect(storedOperation).not.toBeNull();
      if (!afterA || !afterB || !storedOperation) {
        throw new Error('Expected actions and operation to exist');
      }
      expect(afterA.status).toBe(Action.Status.COMPLETED);
      expect(afterB.status).toBe(Action.Status.COMPLETED);
      expect(storedOperation.status).toBe(Operation.Status.COMPLETED);
      expect(storedOperation.last_updated_at).toBeGreaterThan(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('returns FAILED when an upstream action fails and persists FAILED', async () => {
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
        started_at: 1,
        last_updated_at: 1,
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

      const result = await runOperation({
        store,
        resourceId,
        operationId: operation.id,
        executeAction: async (action) => action.id !== actionA.id,
      });

      expect(result.status).toBe('FAILED');
      expect(result.executedActionIds).toEqual([actionA.id]);
      expect(result.failedActionIds).toEqual([actionA.id]);
      expect(result.blockedActionIds).toEqual([actionB.id]);
      expect(result.finalStatusByActionId).toEqual({
        [actionA.id]: Action.Status.FAILED,
        [actionB.id]: Action.Status.PENDING,
      });

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
      const storedOperation = await store.getOperation(
        resourceId,
        operation.id,
      );
      expect(afterA).not.toBeNull();
      expect(afterB).not.toBeNull();
      expect(storedOperation).not.toBeNull();
      if (!afterA || !afterB || !storedOperation) {
        throw new Error('Expected actions and operation to exist');
      }
      expect(afterA.status).toBe(Action.Status.FAILED);
      expect(afterB.status).toBe(Action.Status.PENDING);
      expect(storedOperation.status).toBe(Operation.Status.FAILED);
      expect(storedOperation.last_updated_at).toBeGreaterThan(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('returns BLOCKED when pending work cannot make progress and persists BLOCKED', async () => {
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
        started_at: 1,
        last_updated_at: 1,
      });

      const actionA = new Action({
        id: 'a1',
        resource_id: resourceId,
        operation_id: operation.id,
        type: Action.Type.START,
        status: Action.Status.RUNNING,
      });
      const actionB = new Action({
        id: 'b1',
        resource_id: resourceId,
        operation_id: operation.id,
        type: Action.Type.FINISH,
        status: Action.Status.PENDING,
      });
      operation.addAction({ action: actionA, dependsOn: [] });
      operation.addAction({ action: actionB, dependsOn: [actionA] });

      await store.putOperation(operation);

      const result = await runOperation({
        store,
        resourceId,
        operationId: operation.id,
        executeAction: async () => true,
      });

      expect(result.status).toBe('BLOCKED');
      expect(result.executedActionIds).toEqual([]);
      expect(result.failedActionIds).toEqual([]);
      expect([...result.blockedActionIds].sort()).toEqual(
        [actionA.id, actionB.id].sort(),
      );

      const storedOperation = await store.getOperation(
        resourceId,
        operation.id,
      );
      expect(storedOperation).not.toBeNull();
      if (!storedOperation) throw new Error('Expected operation to exist');
      expect(storedOperation.status).toBe(Operation.Status.BLOCKED);
      expect(storedOperation.last_updated_at).toBeGreaterThan(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('supports multiple INVOKE_FUNCTION actions with the same type and persists outputs', async () => {
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
        started_at: 1,
        last_updated_at: 1,
      });

      const actionA = operation.createAction({
        id: 'task-a',
        type: Action.Type.INVOKE_FUNCTION,
        function_name: 'step-a',
        inputs: { value: 1 },
        placement: { mode: 'local' },
        retry: { max_attempts: 1 },
      });
      const actionB = operation.createAction({
        id: 'task-b',
        type: Action.Type.INVOKE_FUNCTION,
        function_name: 'step-b',
        inputs: { value: 2 },
        placement: { mode: 'local' },
        retry: { max_attempts: 1 },
        dependsOn: [actionA],
      });

      await store.putOperation(operation);

      /** @type {string[]} */
      const order = [];

      const result = await runOperation({
        store,
        resourceId,
        operationId: operation.id,
        executeAction: async (action) => {
          order.push(action.id);

          if (action.id === actionB.id) {
            const upstream = await store.getAction(
              resourceId,
              operation.id,
              actionA.id,
            );
            expect(upstream).not.toBeNull();
            if (!upstream) {
              throw new Error('Expected prerequisite action to exist');
            }
            expect(upstream.status).toBe(Action.Status.COMPLETED);
            expect(upstream.outputs).toEqual({ step: 'step-a', value: 1 });
          }

          return {
            ok: true,
            outputs: {
              step: action.function_name,
              value: action.inputs?.value,
            },
          };
        },
      });

      expect(result.status).toBe('COMPLETED');
      expect(order).toEqual([actionA.id, actionB.id]);
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
      if (!afterA || !afterB) {
        throw new Error('Expected actions to exist');
      }

      expect(afterA.status).toBe(Action.Status.COMPLETED);
      expect(afterA.function_name).toBe('step-a');
      expect(afterA.inputs).toEqual({ value: 1 });
      expect(afterA.outputs).toEqual({ step: 'step-a', value: 1 });
      expect(afterA.attempt_count).toBe(1);

      expect(afterB.status).toBe(Action.Status.COMPLETED);
      expect(afterB.function_name).toBe('step-b');
      expect(afterB.inputs).toEqual({ value: 2 });
      expect(afterB.outputs).toEqual({ step: 'step-b', value: 2 });
      expect(afterB.attempt_count).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('retries INVOKE_FUNCTION actions and persists attempt counts and errors', async () => {
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
        started_at: 1,
        last_updated_at: 1,
      });

      const action = operation.createAction({
        id: 'retry-action',
        type: Action.Type.INVOKE_FUNCTION,
        function_name: 'unstable-step',
        inputs: { value: 1 },
        retry: { max_attempts: 2 },
      });

      await store.putOperation(operation);

      let attempts = 0;
      const result = await runOperation({
        store,
        resourceId,
        operationId: operation.id,
        executeAction: async () => {
          attempts += 1;
          throw new Error(`boom ${attempts}`);
        },
      });

      expect(result.status).toBe('FAILED');
      expect(result.executedActionIds).toEqual([action.id]);
      expect(result.failedActionIds).toEqual([action.id]);
      expect(result.blockedActionIds).toEqual([]);
      expect(attempts).toBe(2);

      const storedAction = await store.getAction(
        resourceId,
        operation.id,
        action.id,
      );
      const storedOperation = await store.getOperation(
        resourceId,
        operation.id,
      );

      expect(storedAction).not.toBeNull();
      expect(storedOperation).not.toBeNull();
      if (!storedAction || !storedOperation) {
        throw new Error('Expected action and operation to exist');
      }

      expect(storedAction.status).toBe(Action.Status.FAILED);
      expect(storedAction.retry).toEqual({ max_attempts: 2 });
      expect(storedAction.attempt_count).toBe(2);
      expect(storedAction.outputs).toBeUndefined();
      expect(storedAction.error).toMatchObject({
        name: 'Error',
        message: 'boom 2',
      });
      expect(storedOperation.status).toBe(Operation.Status.FAILED);
      expect(storedOperation.last_updated_at).toBeGreaterThan(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
