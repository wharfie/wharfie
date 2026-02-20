import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

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

      test('findLocations walks up prefixes', async () => {
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

      test('deleteLocation removes routing', async () => {
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

      test('terminal locations short-circuit', async () => {
        const table = createLocationTable({ db, tableName });
        expect(await table.findLocations('')).toEqual([]);
        expect(await table.findLocations('s3://')).toEqual([]);
      });
    });
  }
});
