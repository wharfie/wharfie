import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { getAdapterMatrix } from '../../helpers/db-adapters.js';
import { createDependencyTable } from '../../../lambdas/lib/dynamo/dependency.js';

const sortByResourceId = (arr) =>
  [...arr].sort((a, b) => a.resource_id.localeCompare(b.resource_id));

describe('dependency table contract', () => {
  for (const adapter of getAdapterMatrix()) {
    describe(adapter.name, () => {
      let db;
      let cleanup;
      const tableName = 'dependency-contract';

      beforeEach(async () => {
        ({ db, cleanup } = await adapter.create());
      });

      afterEach(async () => {
        await cleanup();
      });

      test('put/find/delete', async () => {
        const table = createDependencyTable({ db, tableName });

        await table.putDependency({ dependency: 'dep', resource_id: 'r1' });
        await table.putDependency({
          dependency: 'dep',
          resource_id: 'r2',
          interval: '60',
        });

        const found = sortByResourceId(
          await table.findDependencies({ dependency: 'dep' }),
        );

        expect(found).toEqual([
          { dependency: 'dep', resource_id: 'r1', interval: '300' },
          { dependency: 'dep', resource_id: 'r2', interval: '60' },
        ]);

        await table.deleteDependency({ dependency: 'dep', resource_id: 'r1' });
        const remaining = await table.findDependencies({ dependency: 'dep' });

        expect(remaining).toEqual([
          { dependency: 'dep', resource_id: 'r2', interval: '60' },
        ]);
      });
    });
  }
});
