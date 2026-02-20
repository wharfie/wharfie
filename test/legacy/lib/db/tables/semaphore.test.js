import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { getAdapterMatrix } from '../../../helpers/db-adapters.js';
import { createSemaphoreTable } from '../../../../lambdas/lib/db/tables/semaphore.js';

describe('semaphore table contract', () => {
  for (const adapter of getAdapterMatrix()) {
    describe(adapter.name, () => {
      let db;
      let cleanup;
      const tableName = 'semaphore-contract';

      beforeEach(async () => {
        ({ db, cleanup } = await adapter.create());
      });

      afterEach(async () => {
        await cleanup();
      });

      test('increase respects threshold', async () => {
        const table = createSemaphoreTable({ db, tableName });

        expect(await table.increase('s1', 2)).toBe(true);
        expect(await table.increase('s1', 2)).toBe(true);
        expect(await table.increase('s1', 2)).toBe(false);

        const record = await db.get({
          tableName,
          keyName: 'semaphore',
          keyValue: 's1',
          consistentRead: true,
        });

        expect(record.value).toBe(2);
      });

      test('release decrements and never goes below 0', async () => {
        const table = createSemaphoreTable({ db, tableName });

        await table.increase('s1', 3);
        await table.release('s1');
        await table.release('s1');

        const record = await db.get({
          tableName,
          keyName: 'semaphore',
          keyValue: 's1',
          consistentRead: true,
        });

        expect(record.value).toBe(0);
      });

      test('limit overrides threshold', async () => {
        await db.put({
          tableName,
          keyName: 'semaphore',
          record: { semaphore: 'limited', value: 0, limit: 1 },
        });

        const table = createSemaphoreTable({ db, tableName });
        expect(await table.increase('limited', 10)).toBe(true);
        expect(await table.increase('limited', 10)).toBe(false);
      });

      test('deleteSemaphore releases global wharfie permits', async () => {
        await db.put({
          tableName,
          keyName: 'semaphore',
          record: { semaphore: 'wharfie', value: 2 },
        });

        await db.put({
          tableName,
          keyName: 'semaphore',
          record: { semaphore: 'temp', value: 2 },
        });

        const table = createSemaphoreTable({ db, tableName });
        await table.deleteSemaphore('temp');

        const wharfie = await db.get({
          tableName,
          keyName: 'semaphore',
          keyValue: 'wharfie',
          consistentRead: true,
        });

        const temp = await db.get({
          tableName,
          keyName: 'semaphore',
          keyValue: 'temp',
          consistentRead: true,
        });

        expect(wharfie.value).toBe(0);
        expect(temp).toBeUndefined();
      });
    });
  }
});
