import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { getAdapterMatrix } from '../../../helpers/db-adapters.js';
import { createStateTable } from '../../../../lambdas/lib/db/tables/state.js';

function createTestResource({
  deploymentName,
  stateTable,
  version = 'v0',
  name,
  parent = '',
  status = 'WAITING',
}) {
  const properties = {
    deployment: {
      name: deploymentName,
      stateTable,
      version,
    },
  };

  const resource = {
    name,
    parent,
    status,
    has: (key) => Object.prototype.hasOwnProperty.call(properties, key),
    get: (key) => properties[key],
    serialize: () => ({
      name,
      parent,
      status: resource.status,
      dependsOn: [],
      properties: {},
      resourceType: 'TestResource',
    }),
  };

  return resource;
}

describe('state table contract', () => {
  for (const adapter of getAdapterMatrix()) {
    describe(adapter.name, () => {
      /** @type {import('../../../../lambdas/lib/db/base.js').DBClient} */
      let db;
      /** @type {() => Promise<void>} */
      let cleanup;

      beforeEach(async () => {
        ({ db, cleanup } = await adapter.create());
      });

      afterEach(async () => {
        await cleanup();
      });

      test('can put/get a resource and its status', async () => {
        const deploymentName = `test-${adapter.name}-deployment`;
        const tableName = `${deploymentName}-state`;

        const state = createStateTable({ db });

        const resource = createTestResource({
          deploymentName,
          stateTable: tableName,
          version: 'v1',
          name: 'root',
          status: 'WAITING',
        });

        await state.putResource(resource);

        const serialized = await state.getResource(resource);
        expect(serialized).toEqual(resource.serialize());

        const status = await state.getResourceStatus(resource);
        expect(status).toEqual('WAITING');
      });

      test('updates status via putResourceStatus (including serialized.status)', async () => {
        const deploymentName = `test-${adapter.name}-deployment`;
        const tableName = `${deploymentName}-state`;

        const state = createStateTable({ db });

        const resource = createTestResource({
          deploymentName,
          stateTable: tableName,
          version: 'v1',
          name: 'root',
          status: 'WAITING',
        });

        await state.putResource(resource);

        resource.status = 'PROCESSING';
        await state.putResourceStatus(resource);

        const status = await state.getResourceStatus(resource);
        expect(status).toEqual('PROCESSING');

        const serialized = await state.getResource(resource);
        expect(serialized.status).toEqual('PROCESSING');
      });

      test('upserts status records when putResourceStatus is called before putResource', async () => {
        const deploymentName = `test-${adapter.name}-deployment`;
        const tableName = `${deploymentName}-state`;

        const state = createStateTable({ db });

        const resource = createTestResource({
          deploymentName,
          stateTable: tableName,
          version: 'v1',
          name: 'root',
          status: 'PROCESSING',
        });

        await state.putResourceStatus(resource);

        const status = await state.getResourceStatus(resource);
        expect(status).toEqual('PROCESSING');

        const serialized = await state.getResource(resource);
        expect(serialized).toEqual({ status: 'PROCESSING' });
      });

      test('returns a subtree via getResources and requires the root record', async () => {
        const deploymentName = `test-${adapter.name}-deployment`;
        const tableName = `${deploymentName}-state`;

        const state = createStateTable({ db });

        const root = createTestResource({
          deploymentName,
          stateTable: tableName,
          name: 'root',
          status: 'WAITING',
        });

        const child = createTestResource({
          deploymentName,
          stateTable: tableName,
          name: 'child',
          parent: 'root',
          status: 'WAITING',
        });

        // Only child => root missing => []
        await state.putResource(child);
        const missingRoot = await state.getResources(deploymentName, 'root');
        expect(missingRoot).toEqual([]);

        // Add root => subtree should appear
        await state.putResource(root);
        const subtree = await state.getResources(deploymentName, 'root');
        expect(subtree.map((r) => r.name)).toEqual(['root', 'child']);
      });

      test('deletes resources', async () => {
        const deploymentName = `test-${adapter.name}-deployment`;
        const tableName = `${deploymentName}-state`;

        const state = createStateTable({ db });

        const resource = createTestResource({
          deploymentName,
          stateTable: tableName,
          name: 'root',
          status: 'WAITING',
        });

        await state.putResource(resource);
        expect(await state.getResource(resource)).toBeTruthy();

        await state.deleteResource(resource);
        expect(await state.getResource(resource)).toBeUndefined();
      });
    });
  }
});
