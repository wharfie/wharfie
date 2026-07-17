/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import { getAdapterMatrix } from '../../helpers/db-adapters.js';
import createOperationsStore from '../../../src/core/lib/graph/operations-store.js';
import Action from '../../../src/core/lib/graph/action.js';
import Operation from '../../../src/core/lib/graph/operation.js';
import { getOperationSortKey } from '../../../src/core/lib/graph/operation-record-key.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const OTHER_REVISION_ID = `wrv1_${'B'.repeat(42)}Q`;

function makeOperation({
  resourceId = 'app:lifecycle-test',
  operationId = 'operation-1',
  actionIds = ['invoke'],
  status = Operation.Status.PENDING,
  revisionId = REVISION_ID,
} = {}) {
  const operation = new Operation({
    resource_id: resourceId,
    revision_id: revisionId,
    id: operationId,
    type: Operation.Type.PIPELINE,
    status,
    operation_config: {
      source: 'test',
      app_id: resourceId.replace(/^app:/, ''),
      activity_name: 'work',
    },
  });

  let dependency;
  for (const id of actionIds) {
    dependency = operation.createAction({
      id,
      type: Action.Type.INVOKE_FUNCTION,
      function_name: 'work',
      dependsOn: dependency ? [dependency] : [],
    });
  }
  return operation;
}

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} operation lifecycle contract`, () => {
    test('creates collision-free operation and action identities', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const store = createOperationsStore({
          db,
          tableName: 'operation-lifecycle',
        });
        const first = makeOperation({
          operationId: 'a',
          actionIds: ['b', 'b#c'],
        });
        const second = makeOperation({
          operationId: 'a#b',
          actionIds: ['c'],
        });

        await store.createOperation(first);
        await store.createOperation(second);

        expect(await store.getOperation(first.resource_id, 'a')).not.toBeNull();
        expect(
          await store.getOperation(first.resource_id, 'a#b'),
        ).not.toBeNull();
        expect(
          await store.getAction(first.resource_id, 'a', 'b'),
        ).toMatchObject({ id: 'b', operation_id: 'a' });
        expect(
          await store.getAction(first.resource_id, 'a', 'b#c'),
        ).toMatchObject({ id: 'b#c', operation_id: 'a' });
        expect(
          await store.getAction(second.resource_id, 'a#b', 'c'),
        ).toMatchObject({ id: 'c', operation_id: 'a#b' });
      } finally {
        await cleanup();
      }
    });

    test('rejects a cyclic or internally inconsistent action graph', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const store = createOperationsStore({
          db,
          tableName: 'operation-lifecycle',
        });
        const cyclic = makeOperation({ actionIds: ['first', 'second'] });
        cyclic._addDependency('second', 'first');

        await expect(store.createOperation(cyclic)).rejects.toMatchObject({
          name: 'OperationSnapshotError',
        });
        await expect(
          store.getOperation(cyclic.resource_id, cyclic.id),
        ).resolves.toBeNull();
      } finally {
        await cleanup();
      }
    });

    test.each([undefined, 'revision-latest'])(
      'rejects an operation with invalid revision identity %p',
      async (revisionId) => {
        const { db, cleanup } = await adapter.create();
        try {
          const store = createOperationsStore({
            db,
            tableName: 'operation-lifecycle',
          });
          const operation = makeOperation();
          operation.revision_id = /** @type {any} */ (revisionId);

          await expect(store.createOperation(operation)).rejects.toThrow(
            /operation\.revision_id/i,
          );
          await expect(
            store.getOperation(operation.resource_id, operation.id),
          ).resolves.toBeNull();
        } finally {
          await cleanup();
        }
      },
    );

    test('rejects duplicate and concurrent creates without changing the winner', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const store = createOperationsStore({
          db,
          tableName: 'operation-lifecycle',
        });
        const first = makeOperation({ actionIds: ['winner'] });
        const second = makeOperation({ actionIds: ['loser'] });

        const results = await Promise.allSettled([
          store.createOperation(first),
          store.createOperation(second),
        ]);
        expect(
          results.filter(({ status }) => status === 'fulfilled'),
        ).toHaveLength(1);
        const rejected = results.find(({ status }) => status === 'rejected');
        expect(rejected).toMatchObject({
          status: 'rejected',
          reason: { name: 'OperationAlreadyExistsError' },
        });

        const records = await store.getRecords(first.resource_id, first.id);
        expect(records.operations).toHaveLength(1);
        expect(records.actions).toHaveLength(1);
        expect(['winner', 'loser']).toContain(records.actions[0].id);
      } finally {
        await cleanup();
      }
    });

    test('replaces one complete generation and removes stale actions atomically', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const store = createOperationsStore({
          db,
          tableName: 'operation-lifecycle',
        });
        const original = makeOperation({ actionIds: ['keep', 'stale'] });
        await store.createOperation(original);
        const staleWorkerAction = original.getAction('keep');

        const replacement = makeOperation({ actionIds: ['keep', 'new'] });
        await store.replaceOperation(replacement, original.version);

        const records = await store.getRecords(
          replacement.resource_id,
          replacement.id,
        );
        expect(records.operations).toHaveLength(1);
        expect(records.operations[0]).toMatchObject({
          generation: 2,
          version: 2,
        });
        expect(records.actions.map(({ id }) => id)).toEqual(['keep', 'new']);
        expect(
          await store.getAction(
            replacement.resource_id,
            replacement.id,
            'stale',
          ),
        ).toBeNull();

        expect(
          await store.updateActionStatus(
            staleWorkerAction,
            Action.Status.RUNNING,
          ),
        ).toBe(false);

        const conflicting = makeOperation({ actionIds: ['corrupt'] });
        await expect(
          store.replaceOperation(conflicting, 1),
        ).rejects.toMatchObject({ name: 'OperationConflictError' });
        expect(
          (
            await store.getRecords(replacement.resource_id, replacement.id)
          ).actions.map(({ id }) => id),
        ).toEqual(['keep', 'new']);
      } finally {
        await cleanup();
      }
    });

    test('rejects a replacement revision change before constructing its snapshot', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const store = createOperationsStore({
          db,
          tableName: 'operation-revision-immutable',
        });
        const original = makeOperation({ actionIds: ['original'] });
        await store.createOperation(original);
        const replacement = makeOperation({
          actionIds: ['replacement'],
          revisionId: OTHER_REVISION_ID,
        });
        const constructSnapshot = jest.spyOn(replacement, 'toRecords');

        await expect(
          store.replaceOperation(replacement, original.version),
        ).rejects.toMatchObject({
          name: 'OperationConflictError',
          message: expect.stringMatching(/replacement revision.*persisted/i),
        });
        expect(constructSnapshot).not.toHaveBeenCalled();
        expect(replacement).toMatchObject({ generation: 0, version: 0 });

        const persisted = await store.getOperation(
          original.resource_id,
          original.id,
        );
        expect(persisted).toMatchObject({
          revision_id: REVISION_ID,
          generation: 1,
          version: 1,
        });
        expect(persisted?.getActions().map(({ id }) => id)).toEqual([
          'original',
        ]);
      } finally {
        await cleanup();
      }
    });

    test('conditions replacement on both observed version and persisted revision', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'operation-revision-race';
        let injectRevisionRace = false;
        /** @type {any[] | undefined} */
        let replacementConditions;
        const guardedDb = {
          ...db,
          transactionWrite: async (/** @type {any} */ params) => {
            const replacementMetadata = params.putRequests?.find(
              (/** @type {any} */ request) =>
                request.record?.data?.record_type === Operation.RecordType &&
                request.record.data.version === 2,
            );
            if (injectRevisionRace && replacementMetadata) {
              injectRevisionRace = false;
              replacementConditions = replacementMetadata.conditions;
              await db.update({
                tableName,
                keyName: 'resource_id',
                keyValue: replacementMetadata.record.resource_id,
                sortKeyName: 'sort_key',
                sortKeyValue: replacementMetadata.record.sort_key,
                updates: [
                  {
                    property: ['revision_id'],
                    propertyValue: OTHER_REVISION_ID,
                  },
                  {
                    property: ['data', 'revision_id'],
                    propertyValue: OTHER_REVISION_ID,
                  },
                ],
              });
            }
            return await db.transactionWrite(params);
          },
        };
        const store = createOperationsStore({
          db: /** @type {any} */ (guardedDb),
          tableName,
        });
        const directStore = createOperationsStore({ db, tableName });
        const original = makeOperation({ actionIds: ['original'] });
        await store.createOperation(original);

        const rawMetadata = await db.get({
          tableName,
          keyName: 'resource_id',
          keyValue: original.resource_id,
          sortKeyName: 'sort_key',
          sortKeyValue: getOperationSortKey(original.id),
          consistentRead: true,
        });
        expect(rawMetadata).toMatchObject({
          version: 1,
          revision_id: REVISION_ID,
          data: { revision_id: REVISION_ID },
        });

        injectRevisionRace = true;
        await expect(
          store.replaceOperation(
            makeOperation({ actionIds: ['replacement'] }),
            original.version,
          ),
        ).rejects.toMatchObject({ name: 'OperationConflictError' });
        expect(replacementConditions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              conditionType: 'EQUALS',
              propertyName: 'version',
              propertyValue: 1,
            }),
            expect.objectContaining({
              conditionType: 'EQUALS',
              propertyName: 'revision_id',
              propertyValue: REVISION_ID,
            }),
          ]),
        );

        const persisted = await directStore.getOperation(
          original.resource_id,
          original.id,
        );
        expect(persisted).toMatchObject({
          revision_id: OTHER_REVISION_ID,
          generation: 1,
          version: 1,
        });
        expect(persisted?.getActions().map(({ id }) => id)).toEqual([
          'original',
        ]);
      } finally {
        await cleanup();
      }
    });

    test('binds retry authorization to the observed operation version', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const store = createOperationsStore({
          db,
          tableName: 'operation-lifecycle',
        });
        const observed = makeOperation({
          actionIds: ['observed'],
          status: Operation.Status.FAILED,
        });
        await store.createOperation(observed);

        const replacement = makeOperation({
          actionIds: ['replacement'],
          status: Operation.Status.FAILED,
        });
        await store.replaceOperation(replacement, observed.version);

        await expect(
          store.retryOperation(
            observed.resource_id,
            observed.id,
            observed.version,
          ),
        ).rejects.toMatchObject({ name: 'OperationConflictError' });
        const records = await store.getRecords(
          observed.resource_id,
          observed.id,
        );
        expect(records.operations[0]).toMatchObject({
          status: Operation.Status.FAILED,
          generation: 2,
          version: 2,
        });
        expect(records.actions.map(({ id }) => id)).toEqual(['replacement']);
      } finally {
        await cleanup();
      }
    });

    test('cancels durably and fences a result from the old generation', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const store = createOperationsStore({
          db,
          tableName: 'operation-lifecycle',
        });
        const operation = makeOperation();
        await store.createOperation(operation);
        expect(
          await store.updateOperationStatus(
            operation,
            Operation.Status.RUNNING,
          ),
        ).toBe(true);
        const action = operation.getAction('invoke');
        expect(
          await store.updateActionStatus(action, Action.Status.RUNNING),
        ).toBe(true);

        await expect(
          store.replaceOperation(
            makeOperation({ operationId: operation.id }),
            operation.version,
          ),
        ).rejects.toThrow(/cannot be replaced from RUNNING/i);

        const cancelled = await store.cancelOperation(
          operation.resource_id,
          operation.id,
          { reason: 'operator request', requestedBy: 'contract-test' },
        );
        expect(cancelled).toMatchObject({
          changed: true,
          operation: {
            status: Operation.Status.CANCELLED,
            generation: 2,
            cancellation: {
              reason: 'operator request',
              requested_by: 'contract-test',
            },
          },
        });

        action.status = Action.Status.COMPLETED;
        action.outputs = { shouldNotCommit: true };
        expect(await store.commitAction(action)).toBe(false);

        const records = await store.getRecords(
          operation.resource_id,
          operation.id,
        );
        expect(records.operations[0].status).toBe(Operation.Status.CANCELLED);
        expect(records.actions[0]).toMatchObject({
          status: Action.Status.CANCELLED,
          outputs: undefined,
        });
        expect(
          await store.updateOperationStatus(
            records.operations[0],
            Operation.Status.COMPLETED,
          ),
        ).toBe(false);
      } finally {
        await cleanup();
      }
    });

    test('retries cancellation rather than overwriting a concurrent action result', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'operation-cancel-race';
        const directStore = createOperationsStore({ db, tableName });
        let injectCompletion = true;
        /** @type {Action | undefined} */
        let completingAction;
        const guardedDb = {
          ...db,
          transactionWrite: async (/** @type {any} */ params) => {
            const isCancellation = params.putRequests?.some(
              (/** @type {any} */ request) =>
                request.record?.data?.record_type === Operation.RecordType &&
                request.record.data.status === Operation.Status.CANCELLED,
            );
            if (isCancellation && injectCompletion && completingAction) {
              injectCompletion = false;
              expect(await directStore.commitAction(completingAction)).toBe(
                true,
              );
            }
            return await db.transactionWrite(params);
          },
        };
        const store = createOperationsStore({
          db: /** @type {any} */ (guardedDb),
          tableName,
        });
        const operation = makeOperation();
        await store.createOperation(operation);
        expect(
          await store.updateOperationStatus(
            operation,
            Operation.Status.RUNNING,
          ),
        ).toBe(true);
        completingAction = operation.getAction('invoke');
        expect(
          await store.updateActionStatus(
            completingAction,
            Action.Status.RUNNING,
          ),
        ).toBe(true);
        completingAction.status = Action.Status.COMPLETED;
        completingAction.outputs = { committed: true };

        await expect(
          store.cancelOperation(operation.resource_id, operation.id),
        ).resolves.toMatchObject({ changed: true });

        const records = await store.getRecords(
          operation.resource_id,
          operation.id,
        );
        expect(records.operations[0]).toMatchObject({
          status: Operation.Status.CANCELLED,
          generation: 2,
        });
        expect(records.actions[0]).toMatchObject({
          status: Action.Status.COMPLETED,
          outputs: { committed: true },
          operation_generation: 2,
        });
      } finally {
        await cleanup();
      }
    });

    test('carries the first cancellation read through replacement validation', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'operation-cancel-preimage-race';
        const directStore = createOperationsStore({ db, tableName });
        let queryCount = 0;
        /** @type {Action | undefined} */
        let completingAction;
        const guardedDb = {
          ...db,
          query: async (/** @type {any} */ params) => {
            queryCount += 1;
            if (queryCount === 2 && completingAction) {
              expect(await directStore.commitAction(completingAction)).toBe(
                true,
              );
            }
            return await db.query(params);
          },
        };
        const store = createOperationsStore({
          db: /** @type {any} */ (guardedDb),
          tableName,
        });
        const operation = makeOperation();
        await store.createOperation(operation);
        expect(
          await store.updateOperationStatus(
            operation,
            Operation.Status.RUNNING,
          ),
        ).toBe(true);
        completingAction = operation.getAction('invoke');
        expect(
          await store.updateActionStatus(
            completingAction,
            Action.Status.RUNNING,
          ),
        ).toBe(true);
        completingAction.status = Action.Status.COMPLETED;
        completingAction.outputs = { committed: 'between-reads' };
        queryCount = 0;

        await expect(
          store.cancelOperation(operation.resource_id, operation.id),
        ).resolves.toMatchObject({ changed: true });

        const records = await directStore.getRecords(
          operation.resource_id,
          operation.id,
        );
        expect(records.operations[0]).toMatchObject({
          status: Operation.Status.CANCELLED,
          generation: 2,
        });
        expect(records.actions[0]).toMatchObject({
          status: Action.Status.COMPLETED,
          outputs: { committed: 'between-reads' },
          operation_generation: 2,
        });
      } finally {
        await cleanup();
      }
    });

    test('retries cancellation across a same-status action ABA', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'operation-cancel-action-aba';
        const directStore = createOperationsStore({ db, tableName });
        let queryCount = 0;
        /** @type {Action | undefined} */
        let retryingAction;
        const guardedDb = {
          ...db,
          query: async (/** @type {any} */ params) => {
            queryCount += 1;
            if (queryCount === 2 && retryingAction) {
              retryingAction.status = Action.Status.PENDING;
              retryingAction.attempt_count = 1;
              retryingAction.error = { message: 'retryable failure' };
              expect(await directStore.commitAction(retryingAction)).toBe(true);
              expect(retryingAction.version).toBe(3);
              expect(
                await directStore.updateActionStatus(
                  retryingAction,
                  Action.Status.RUNNING,
                ),
              ).toBe(true);
              expect(retryingAction.version).toBe(4);
            }
            return await db.query(params);
          },
        };
        const store = createOperationsStore({
          db: /** @type {any} */ (guardedDb),
          tableName,
        });
        const operation = makeOperation();
        await store.createOperation(operation);
        expect(operation.getAction('invoke').version).toBe(1);
        expect(
          await store.updateOperationStatus(
            operation,
            Operation.Status.RUNNING,
          ),
        ).toBe(true);
        retryingAction = operation.getAction('invoke');
        expect(
          await store.updateActionStatus(retryingAction, Action.Status.RUNNING),
        ).toBe(true);
        expect(retryingAction.version).toBe(2);
        queryCount = 0;

        await expect(
          store.cancelOperation(operation.resource_id, operation.id),
        ).resolves.toMatchObject({ changed: true });

        const records = await directStore.getRecords(
          operation.resource_id,
          operation.id,
        );
        expect(records.operations[0]).toMatchObject({
          status: Operation.Status.CANCELLED,
          generation: 2,
        });
        expect(records.actions[0]).toMatchObject({
          status: Action.Status.CANCELLED,
          operation_generation: 2,
          version: 5,
          attempt_count: 1,
          error: { message: 'retryable failure' },
        });
      } finally {
        await cleanup();
      }
    });

    test('rejects an incomplete read instead of deleting an omitted action', async () => {
      const { db, cleanup } = await adapter.create();
      try {
        const tableName = 'operation-incomplete-read';
        const directStore = createOperationsStore({ db, tableName });
        let omitActionOnce = false;
        const guardedDb = {
          ...db,
          query: async (/** @type {any} */ params) => {
            const records = await db.query(params);
            if (!omitActionOnce) return records;
            omitActionOnce = false;
            return records.filter(
              (record) => record?.data?.record_type !== Action.RecordType,
            );
          },
        };
        const store = createOperationsStore({
          db: /** @type {any} */ (guardedDb),
          tableName,
        });
        const operation = makeOperation();
        await store.createOperation(operation);
        omitActionOnce = true;

        await expect(
          store.cancelOperation(operation.resource_id, operation.id),
        ).resolves.toMatchObject({ changed: true });

        const records = await directStore.getRecords(
          operation.resource_id,
          operation.id,
        );
        expect(records.operations[0]).toMatchObject({
          status: Operation.Status.CANCELLED,
        });
        expect(records.actions).toHaveLength(1);
        expect(records.actions[0]).toMatchObject({
          id: 'invoke',
          status: Action.Status.CANCELLED,
        });
        await expect(
          directStore.getAction(operation.resource_id, operation.id, 'invoke'),
        ).resolves.not.toBeNull();
      } finally {
        await cleanup();
      }
    });
  });
}
