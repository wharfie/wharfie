/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  formatOperationRows,
  toIsoTimestamp,
} from '../../../src/cli/cmds/operation-rows.js';

describe('operation row formatting', () => {
  it('formats and sorts operations using started_at, last_updated_at, and app metadata', () => {
    const rows = formatOperationRows([
      {
        id: 'older',
        type: 'LOAD',
        status: 'RUNNING',
        started_at: 1700000000,
        last_updated_at: 1700000005,
        operation_config: {
          app: 'demo-app',
          workflow: 'nightly-sync',
          trigger: { source: 'cron' },
        },
      },
      {
        id: 'newer',
        type: 'PIPELINE',
        status: 'PENDING',
        started_at: 1700000100000,
        last_updated_at: 1700000105000,
        operation_config: {
          app: 'demo-app',
          activity: 'collect',
          trigger: { source: 'manual' },
        },
      },
    ]);

    expect(rows).toEqual([
      {
        id: 'newer',
        app: 'demo-app',
        activity: 'collect',
        workflow: '',
        type: 'PIPELINE',
        status: 'PENDING',
        trigger: 'manual',
        started_at: '2023-11-14T22:15:00.000Z',
        last_updated_at: '2023-11-14T22:15:05.000Z',
      },
      {
        id: 'older',
        app: 'demo-app',
        activity: '',
        workflow: 'nightly-sync',
        type: 'LOAD',
        status: 'RUNNING',
        trigger: 'cron',
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
