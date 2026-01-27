import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import { getAdapterMatrix } from '../../helpers/db-adapters.js';
import { createSchedulerTable } from '../../../lambdas/lib/dynamo/scheduler.js';
import SchedulerEntry from '../../../lambdas/scheduler/scheduler-entry.js';

const toSortKeyNumber = (entry) => Number(entry.sort_key.split(':')[1]);
const sortBySortKeyNumber = (entries) =>
  [...entries].sort((a, b) => toSortKeyNumber(a) - toSortKeyNumber(b));

describe('scheduler table contract', () => {
  for (const adapter of getAdapterMatrix()) {
    describe(adapter.name, () => {
      let db;
      let cleanup;
      const tableName = 'scheduler-contract';

      beforeEach(async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2020-01-01T00:00:00Z'));
        ({ db, cleanup } = await adapter.create());
      });

      afterEach(async () => {
        await cleanup();
        jest.useRealTimers();
      });

      test('schedule sets ttl and prevents duplicates', async () => {
        const table = createSchedulerTable({ db, tableName });
        const entry = new SchedulerEntry({
          resource_id: 'r1',
          sort_key: 'unpartitioned:10',
          partition: 'unpartitioned',
        });

        await table.schedule(entry);
        expect(entry.ttl).toBe(1578096000);

        await expect(table.schedule(entry)).rejects.toMatchObject({
          name: 'ConditionalCheckFailedException',
        });
      });

      test('query returns events inside the window for a partition', async () => {
        const table = createSchedulerTable({ db, tableName });
        const resource_id = 'r1';

        await table.schedule(
          new SchedulerEntry({
            resource_id,
            sort_key: 'unpartitioned:5',
            partition: 'unpartitioned',
          }),
        );
        await table.schedule(
          new SchedulerEntry({
            resource_id,
            sort_key: 'unpartitioned:15',
            partition: 'unpartitioned',
          }),
        );
        await table.schedule(
          new SchedulerEntry({
            resource_id,
            sort_key: 'unpartitioned:25',
            partition: 'unpartitioned',
          }),
        );

        const events = await table.query(resource_id, 'unpartitioned', [0, 20]);
        const sorted = sortBySortKeyNumber(events);

        expect(sorted.map((e) => e.sort_key)).toEqual([
          'unpartitioned:5',
          'unpartitioned:15',
        ]);
      });

      test('update overwrites the record status and refreshes ttl', async () => {
        const table = createSchedulerTable({ db, tableName });
        const entry = new SchedulerEntry({
          resource_id: 'r1',
          sort_key: 'unpartitioned:10',
          partition: 'unpartitioned',
        });

        await table.schedule(entry);
        await table.update(entry, SchedulerEntry.Status.STARTED);

        const events = await table.query('r1', 'unpartitioned', [0, 20]);
        expect(events).toHaveLength(1);
        expect(events[0].status).toBe(SchedulerEntry.Status.STARTED);
        expect(events[0].ttl).toBe(1578096000);
      });

      test('delete_records removes all records for a resource_id', async () => {
        const table = createSchedulerTable({ db, tableName });
        await table.schedule(
          new SchedulerEntry({
            resource_id: 'r1',
            sort_key: 'unpartitioned:1',
            partition: 'unpartitioned',
          }),
        );
        await table.schedule(
          new SchedulerEntry({
            resource_id: 'r1',
            sort_key: 'unpartitioned:2',
            partition: 'unpartitioned',
          }),
        );

        await table.delete_records('r1');
        const remaining = await table.query('r1', 'unpartitioned', [0, 10]);
        expect(remaining).toEqual([]);
      });
    });
  }
});
