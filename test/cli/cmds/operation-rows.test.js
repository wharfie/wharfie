/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import {
  formatOperationRows,
  toIsoTimestamp,
} from '../../../cli/cmds/operation-rows.js';

describe('operation row formatting', () => {
  it('formats and sorts operations using started_at and last_updated_at', () => {
    const rows = formatOperationRows([
      {
        id: 'older',
        type: 'LOAD',
        status: 'RUNNING',
        started_at: 1700000000,
        last_updated_at: 1700000005,
      },
      {
        id: 'newer',
        type: 'PIPELINE',
        status: 'PENDING',
        started_at: 1700000100000,
        last_updated_at: 1700000105000,
      },
    ]);

    expect(rows).toEqual([
      {
        id: 'newer',
        type: 'PIPELINE',
        status: 'PENDING',
        started_at: '2023-11-14T22:15:00.000Z',
        last_updated_at: '2023-11-14T22:15:05.000Z',
      },
      {
        id: 'older',
        type: 'LOAD',
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
