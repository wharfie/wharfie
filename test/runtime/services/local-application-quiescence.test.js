/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';

import { RunStatus } from '../../../src/core/lib/ledger/execution-ledger-contract.js';
import {
  LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT,
  LOCAL_APPLICATION_QUIESCENCE_PAGE_SIZE,
  LocalApplicationQuiescenceRefusalError,
  assertLocalApplicationQuiescent,
  inspectLocalApplicationQuiescence,
} from '../../../src/core/runtime/services/local-application-quiescence.js';

const APP_ID = 'quiescence-app';
const OTHER_APP_ID = 'other-quiescence-app';
const REVISION_A = `wrv1_${'A'.repeat(43)}`;
const REVISION_B = `wrv1_${'B'.repeat(42)}A`;

/**
 * @param {number} index
 * @param {string} status
 * @param {{appId?: string, revisionId?: string, kind?: string}} [options]
 */
function runItem(
  index,
  status,
  { appId = APP_ID, revisionId = REVISION_A, kind = 'manual' } = {},
) {
  return {
    runId: `run-${index}`,
    appId,
    revisionId,
    kind,
    status,
    version: index + 1,
    lastSequence: index + 1,
    createdAt: index,
    updatedAt: index + 1,
  };
}

describe('local application quiescence', () => {
  it('fully pages verified history, counts every blocker, and deeply freezes a bounded redacted sample', async () => {
    const statuses = [
      RunStatus.COMPLETED,
      RunStatus.FAILED,
      RunStatus.CANCELLED,
      ...Array.from(
        {
          length: LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT + 3,
        },
        (_, index) => (index % 2 === 0 ? RunStatus.RUNNING : RunStatus.BLOCKED),
      ),
    ];
    const firstItems = statuses
      .slice(0, 13)
      .map((status, index) => runItem(index, status));
    const secondItems = statuses.slice(13).map((status, offset) =>
      runItem(13 + offset, status, {
        revisionId: REVISION_B,
        kind: offset % 2 === 0 ? 'workflow' : 'effect-successor',
      }),
    );
    const pages = [
      { items: firstItems, nextCursor: 'page-two' },
      { items: secondItems },
    ];
    const listRuns = jest.fn(
      async (/** @type {Record<string, any>} */ _request) => pages.shift(),
    );

    const report = await inspectLocalApplicationQuiescence({
      ledger: { listRuns },
      appId: APP_ID,
    });

    expect(listRuns).toHaveBeenNthCalledWith(1, {
      appId: APP_ID,
      limit: LOCAL_APPLICATION_QUIESCENCE_PAGE_SIZE,
    });
    expect(listRuns).toHaveBeenNthCalledWith(2, {
      appId: APP_ID,
      limit: LOCAL_APPLICATION_QUIESCENCE_PAGE_SIZE,
      cursor: 'page-two',
    });
    expect(report).toMatchObject({
      schemaVersion: 2,
      kind: 'wharfie.local-application-quiescence',
      appId: APP_ID,
      allowedNonterminalRevisionId: null,
      quiescent: false,
      scannedRunCount: statuses.length,
      nonterminalRunCount:
        LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT + 3,
      blockerCount: LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT + 3,
      blockersTruncated: true,
    });
    expect(report.blockers).toHaveLength(
      LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT,
    );
    expect(report.blockers[0]).toEqual({
      runId: 'run-3',
      revisionId: REVISION_A,
      kind: 'manual',
      status: RunStatus.RUNNING,
      updatedAt: 4,
    });
    expect(report.blockers.at(-1)).toEqual(
      expect.objectContaining({
        runId: `run-${LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT + 2}`,
      }),
    );
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.blockers)).toBe(true);
    expect(report.blockers.every(Object.isFrozen)).toBe(true);
    expect(report.blockers[0]).not.toHaveProperty('appId');
    expect(report.blockers[0]).not.toHaveProperty('version');
    expect(report.blockers[0]).not.toHaveProperty('lastSequence');
    expect(report.blockers[0]).not.toHaveProperty('createdAt');
  });

  it('accepts empty and all-terminal histories and returns the same report from its assertion helper', async () => {
    const empty = await inspectLocalApplicationQuiescence({
      ledger: { listRuns: jest.fn(async () => ({ items: [] })) },
      appId: APP_ID,
    });
    expect(empty).toMatchObject({
      allowedNonterminalRevisionId: null,
      quiescent: true,
      scannedRunCount: 0,
      nonterminalRunCount: 0,
      blockerCount: 0,
      blockers: [],
      blockersTruncated: false,
    });
    expect(assertLocalApplicationQuiescent(empty)).toBe(empty);

    const terminal = await inspectLocalApplicationQuiescence({
      ledger: {
        listRuns: jest.fn(async () => ({
          items: [
            runItem(0, RunStatus.COMPLETED),
            runItem(1, RunStatus.FAILED),
            runItem(2, RunStatus.CANCELLED),
          ],
        })),
      },
      appId: APP_ID,
    });
    expect(terminal).toMatchObject({
      quiescent: true,
      scannedRunCount: 3,
      nonterminalRunCount: 0,
      blockerCount: 0,
    });
    expect(assertLocalApplicationQuiescent(terminal)).toBe(terminal);
  });

  it('allows queued work only for one exact first-install revision', async () => {
    const compatibleRuns = Array.from(
      { length: LOCAL_APPLICATION_QUIESCENCE_BLOCKER_SAMPLE_LIMIT + 3 },
      (_, index) => runItem(index, RunStatus.RUNNING),
    );
    const compatible = await inspectLocalApplicationQuiescence({
      ledger: {
        listRuns: jest.fn(async () => ({ items: compatibleRuns })),
      },
      appId: APP_ID,
      allowedNonterminalRevisionId: REVISION_A,
    });

    expect(compatible).toMatchObject({
      allowedNonterminalRevisionId: REVISION_A,
      quiescent: true,
      scannedRunCount: compatibleRuns.length,
      nonterminalRunCount: compatibleRuns.length,
      blockerCount: 0,
      blockers: [],
      blockersTruncated: false,
    });
    expect(assertLocalApplicationQuiescent(compatible)).toBe(compatible);

    const incompatible = await inspectLocalApplicationQuiescence({
      ledger: {
        listRuns: jest.fn(async () => ({
          items: [
            runItem(0, RunStatus.RUNNING),
            runItem(1, RunStatus.BLOCKED, { revisionId: REVISION_B }),
          ],
        })),
      },
      appId: APP_ID,
      allowedNonterminalRevisionId: REVISION_A,
    });
    expect(incompatible).toMatchObject({
      allowedNonterminalRevisionId: REVISION_A,
      quiescent: false,
      scannedRunCount: 2,
      nonterminalRunCount: 2,
      blockerCount: 1,
      blockers: [expect.objectContaining({ revisionId: REVISION_B })],
    });
  });

  it('throws a typed refusal carrying only the frozen redacted report', async () => {
    const report = await inspectLocalApplicationQuiescence({
      ledger: {
        listRuns: jest.fn(async () => ({
          items: [
            runItem(0, RunStatus.RUNNING, {
              revisionId: REVISION_B,
              kind: 'workflow',
            }),
            runItem(1, RunStatus.BLOCKED),
          ],
        })),
      },
      appId: APP_ID,
    });

    let error;
    try {
      assertLocalApplicationQuiescent(report);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(LocalApplicationQuiescenceRefusalError);
    expect(error).toMatchObject({
      name: 'LocalApplicationQuiescenceRefusalError',
      code: 'WHARFIE_LOCAL_APPLICATION_NOT_QUIESCENT',
      appId: APP_ID,
      blockerCount: 2,
      blockers: report.blockers,
      report,
    });
    expect(String(error)).not.toContain('input');
    expect(String(error)).not.toContain(REVISION_A);
    expect(String(error)).not.toContain(REVISION_B);
  });

  it('fails closed when pagination repeats a cursor', async () => {
    const pages = [
      {
        items: [runItem(0, RunStatus.COMPLETED)],
        nextCursor: 'repeated-cursor',
      },
      {
        items: [runItem(1, RunStatus.COMPLETED)],
        nextCursor: 'repeated-cursor',
      },
    ];
    const listRuns = jest.fn(
      async (/** @type {Record<string, any>} */ _request) => pages.shift(),
    );

    await expect(
      inspectLocalApplicationQuiescence({
        ledger: { listRuns },
        appId: APP_ID,
      }),
    ).rejects.toThrow(/repeated page cursor/i);
    expect(listRuns).toHaveBeenCalledTimes(2);
  });

  it('fails closed when separate pages repeat a run identity', async () => {
    const pages = [
      {
        items: [runItem(0, RunStatus.COMPLETED)],
        nextCursor: 'page-two',
      },
      {
        items: [
          {
            ...runItem(1, RunStatus.RUNNING),
            runId: 'run-0',
          },
        ],
      },
    ];
    const listRuns = jest.fn(
      async (/** @type {Record<string, any>} */ _request) => pages.shift(),
    );

    await expect(
      inspectLocalApplicationQuiescence({
        ledger: { listRuns },
        appId: APP_ID,
      }),
    ).rejects.toThrow(/duplicate run run-0/i);
  });

  it.each([
    ['non-object page', null, /plain object/i],
    ['missing items', {}, /items is required/i],
    ['non-array items', { items: {} }, /items must be an array/i],
    [
      'oversized page',
      {
        items: Array.from(
          { length: LOCAL_APPLICATION_QUIESCENCE_PAGE_SIZE + 1 },
          (_, index) => runItem(index, RunStatus.COMPLETED),
        ),
      },
      /within the requested page limit/i,
    ],
    [
      'unknown page field',
      { items: [], authority: true },
      /authority is not supported/i,
    ],
    [
      'cursor after empty page',
      { items: [], nextCursor: 'impossible' },
      /cannot follow an empty page/i,
    ],
    [
      'mismatched app scope',
      {
        items: [runItem(0, RunStatus.COMPLETED, { appId: OTHER_APP_ID })],
      },
      /does not match the requested scope/i,
    ],
    [
      'unknown run status',
      { items: [runItem(0, 'PAUSED')] },
      /status is unsupported/i,
    ],
    [
      'unknown run kind',
      {
        items: [runItem(0, RunStatus.RUNNING, { kind: 'background-job' })],
      },
      /kind is unsupported/i,
    ],
    [
      'expanded run item',
      {
        items: [
          {
            ...runItem(0, RunStatus.RUNNING),
            input: { secret: true },
          },
        ],
      },
      /input is not supported/i,
    ],
  ])('rejects a malformed %s', async (_label, page, expected) => {
    await expect(
      inspectLocalApplicationQuiescence({
        ledger: { listRuns: jest.fn(async () => page) },
        appId: APP_ID,
      }),
    ).rejects.toThrow(expected);
  });

  it('rejects malformed dependencies and forged assertion reports', async () => {
    await expect(
      inspectLocalApplicationQuiescence({
        ledger: /** @type {any} */ ({}),
        appId: APP_ID,
      }),
    ).rejects.toThrow(/ledger with listRuns/i);
    await expect(
      inspectLocalApplicationQuiescence({
        ledger: { listRuns: jest.fn() },
        appId: 'Not Canonical',
      }),
    ).rejects.toThrow(/canonical logical ID/i);
    expect(() =>
      assertLocalApplicationQuiescent({
        schemaVersion: 2,
        kind: 'wharfie.local-application-quiescence',
        appId: APP_ID,
        allowedNonterminalRevisionId: null,
        quiescent: true,
        scannedRunCount: 0,
        nonterminalRunCount: 0,
        blockerCount: 0,
        blockers: [],
        blockersTruncated: false,
      }),
    ).toThrow(/deeply frozen inspection report/i);
  });
});
