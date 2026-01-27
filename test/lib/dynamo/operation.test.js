import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { getAdapterMatrix } from '../../helpers/db-adapters.js';
import { createOperationsTable } from '../../../lambdas/lib/dynamo/operations.js';

import Action from '../../../lambdas/lib/graph/action.js';
import Operation from '../../../lambdas/lib/graph/operation.js';
import Query from '../../../lambdas/lib/graph/query.js';
import Resource from '../../../lambdas/lib/graph/resource.js';

describe('operations table contract', () => {
  for (const adapter of getAdapterMatrix()) {
    describe(adapter.name, () => {
      let db;
      let cleanup;
      const tableName = 'operations-contract';

      beforeEach(async () => {
        ({ db, cleanup } = await adapter.create());
      });

      afterEach(async () => {
        await cleanup();
      });

      test('resource + operation graph lifecycle', async () => {
        const table = createOperationsTable({ db, tableName });

        const resource = new Resource({
          id: 'r1',
          region: 'us-east-1',
          daemon_config: { Role: 'arn:aws:iam::123456789012:role/test' },
          athena_workgroup: 'wg',
          resource_properties: { any: true },
          source_properties: { any: true },
          destination_properties: { any: true },
        });

        await table.putResource(resource);
        const got = await table.getResource(resource.id);
        expect(got.id).toBe(resource.id);

        const operation = new Operation({
          resource_id: resource.id,
          resource_version: resource.version,
          type: Operation.Type.PIPELINE,
        });

        const action = new Action({
          resource_id: resource.id,
          operation_id: operation.id,
          type: Action.Type.START,
        });

        const query = new Query({
          resource_id: resource.id,
          operation_id: operation.id,
          action_id: action.id,
          query: 'SELECT 1',
          output_location: 's3://out',
        });

        action.queries = [query];
        operation.addAction({ action, dependsOn: [] });

        await table.putOperation(operation);

        const ops = await table.getOperations(resource.id);
        expect(ops).toHaveLength(1);
        expect(ops[0].id).toBe(operation.id);

        const records = await table.getRecords(resource.id);
        expect(records.operations).toHaveLength(1);
        expect(records.actions).toHaveLength(1);
        expect(records.queries).toHaveLength(1);

        expect(records.actions[0].id).toBe(action.id);
        expect(records.queries[0].id).toBe(query.id);

        expect(
          await table.updateActionStatus(action, Action.Status.RUNNING),
        ).toBe(true);

        const updated = await table.getAction(
          resource.id,
          operation.id,
          action.id,
        );
        expect(updated.status).toBe(Action.Status.RUNNING);

        // stale local action object should fail optimistic transition
        expect(
          await table.updateActionStatus(action, Action.Status.COMPLETED),
        ).toBe(false);

        await table.deleteOperation(operation);

        const afterDelete = await table.getRecords(resource.id);
        expect(afterDelete.operations).toEqual([]);
        expect(afterDelete.actions).toEqual([]);
        expect(afterDelete.queries).toEqual([]);

        expect(await table.getResource(resource.id)).not.toBeNull();

        await table.deleteResource(resource);
        expect(await table.getResource(resource.id)).toBeNull();
      });
    });
  }
});
