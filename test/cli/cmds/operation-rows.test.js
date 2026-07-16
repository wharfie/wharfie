/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  formatOperationRows,
  toIsoTimestamp,
} from '../../../src/cli/cmds/operation-rows.js';

describe('operation row formatting', () => {
  it('formats and sorts operations using started_at and last_updated_at', () => {
    const rows = formatOperationRows([
      {
        id: 'older',
        type: 'PIPELINE',
        status: 'RUNNING',
        started_at: 1700000000,
        last_updated_at: 1700000005,
        operation_config: {
          app_id: 'cleanup-service',
          activity_name: 'remove-stale-resources',
          trigger: { source: 'schedule' },
        },
      },
      {
        id: 'newer',
        type: 'PIPELINE',
        status: 'PENDING',
        started_at: 1700000100000,
        last_updated_at: 1700000105000,
        operation_config: {
          app_id: 'hello-world',
          activity_name: 'say-hello',
          trigger: { source: 'cli' },
        },
      },
    ]);

    expect(rows).toEqual([
      {
        id: 'newer',
        app: 'hello-world',
        activity: 'say-hello',
        trigger: 'cli',
        type: 'PIPELINE',
        status: 'PENDING',
        started_at: '2023-11-14T22:15:00.000Z',
        last_updated_at: '2023-11-14T22:15:05.000Z',
      },
      {
        id: 'older',
        app: 'cleanup-service',
        activity: 'remove-stale-resources',
        trigger: 'schedule',
        type: 'PIPELINE',
        status: 'RUNNING',
        started_at: '2023-11-14T22:13:20.000Z',
        last_updated_at: '2023-11-14T22:13:25.000Z',
      },
    ]);
  });

  it('returns an empty string for missing timestamps', () => {
    expect(toIsoTimestamp(undefined)).toBe('');
    expect(toIsoTimestamp(0)).toBe('');
  });
});
