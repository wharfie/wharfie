import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  test,
} from '@jest/globals';

import { getAdapterMatrix } from '../../../helpers/db-adapters.js';
import { createLocationTable } from '../../../../lambdas/lib/db/tables/location.js';

describe('location table contract', () => {
  for (const adapter of getAdapterMatrix()) {
    describe(adapter.name, () => {
      let db;
      let cleanup;
      const tableName = 'location-contract';

      beforeEach(async () => {
        ({ db, cleanup } = await adapter.create());
      });

      afterEach(async () => {
        await cleanup();
      });

      it('findLocations walks up prefixes', async () => {
        const table = createLocationTable({ db, tableName });

        await table.putLocation({
          location: 's3://bucket/prefix/',
          resource_id: 'r1',
        });

        const found = await table.findLocations('s3://bucket/prefix/file.json');

        expect(found).toEqual([
          {
            location: 's3://bucket/prefix/',
            resource_id: 'r1',
            interval: '300',
          },
        ]);
      });

      it('deleteLocation removes routing', async () => {
        const table = createLocationTable({ db, tableName });

        await table.putLocation({
          location: 's3://bucket/prefix/',
          resource_id: 'r1',
        });

        await table.deleteLocation({
          location: 's3://bucket/prefix/',
          resource_id: 'r1',
        });

        const found = await table.findLocations('s3://bucket/prefix/file.json');

        expect(found).toEqual([]);
      });

      it('terminal locations short-circuit', async () => {
        const table = createLocationTable({ db, tableName });

        await expect(table.findLocations('')).resolves.toEqual([]);
        await expect(table.findLocations('s3://')).resolves.toEqual([]);
      });
    });
  }
});
