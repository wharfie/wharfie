import { describe, expect, it } from '@jest/globals';

import { getAdapterMatrix } from '../../../helpers/db-adapters';
import { createStateTable } from '../../../../lambdas/lib/db/tables/state.js';

const adapterMatrix = getAdapterMatrix();

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

describe.each(adapterMatrix)(
  'StateTable ($adapterType)',
  ({ name: adapterType, create: createAdapter }) => {
    it('can put/get a resource and its status', async () => {
      const deploymentName = `test-${adapterType}-deployment`;
      const tableName = `${deploymentName}-state`;

      const db = createAdapter();
      const state = createStateTable({ db });

      try {
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
      } finally {
        await db.close();
      }
    });

    it('updates status via putResourceStatus (including serialized.status)', async () => {
      const deploymentName = `test-${adapterType}-deployment`;
      const tableName = `${deploymentName}-state`;

      const db = createAdapter();
      const state = createStateTable({ db });

      try {
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
      } finally {
        await db.close();
      }
    });

    it('upserts status records when putResourceStatus is called before putResource', async () => {
      const deploymentName = `test-${adapterType}-deployment`;
      const tableName = `${deploymentName}-state`;

      const db = createAdapter();
      const state = createStateTable({ db });

      try {
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
      } finally {
        await db.close();
      }
    });

    it('returns a subtree via getResources and requires the root record', async () => {
      const deploymentName = `test-${adapterType}-deployment`;
      const tableName = `${deploymentName}-state`;

      const db = createAdapter();
      const state = createStateTable({ db });

      try {
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
      } finally {
        await db.close();
      }
    });

    it('deletes resources', async () => {
      const deploymentName = `test-${adapterType}-deployment`;
      const tableName = `${deploymentName}-state`;

      const db = createAdapter();
      const state = createStateTable({ db });

      try {
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
      } finally {
        await db.close();
      }
    });
  },
);
