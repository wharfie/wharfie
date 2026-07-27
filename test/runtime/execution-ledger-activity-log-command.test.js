/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createExecutionLedgerAttemptLogPageCursor } from '../../src/core/lib/ledger/attempt-log-page.js';
import {
  EXECUTION_LEDGER_ACTIVITY_LOG_DEFAULT_LIMIT,
  EXECUTION_LEDGER_ACTIVITY_LOG_PAGE_KIND,
  EXECUTION_LEDGER_ACTIVITY_LOG_PAGE_SCHEMA_VERSION,
  createExecutionLedgerActivityLogCommand,
} from '../../src/core/runtime/operator/execution-ledger-activity-log-command.js';

const APP_ID = 'activity-log-command-demo';
const OTHER_APP_ID = 'other-activity-log-command-demo';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'run-one';
const INVOCATION_ID = 'invocation-one';
const ACTIVITY_ID = 'rebuild-index';
const ATTEMPT_ID = 'attempt-one';
const DISCLOSURE = 'application-sensitive-unredacted';
const SAFE_FAILURE =
  'Sensitive durable activity logs could not be read safely. No partial page was emitted.';

/** @typedef {{entryCount: number, cumulativePayloadBytes: number, lastSequence: number | null}} PageSnapshot */

afterEach(() => {
  process.exitCode = undefined;
  jest.restoreAllMocks();
});

function outputHarness() {
  return {
    json: jest.fn(),
    table: jest.fn(),
    info: jest.fn(),
    failure: jest.fn(),
  };
}

/** @param {Array<string>} [options] */
function argv(options = []) {
  return ['node', 'wharfie', ...options];
}

/** @param {import('commander').Command} command */
function silenceCommander(command) {
  command.exitOverride();
  command.configureOutput({
    writeOut: jest.fn(),
    writeErr: jest.fn(),
  });
  return command;
}

/** @param {Record<string, any>} [overrides] */
function logItem(overrides = {}) {
  return {
    sequence: 2,
    acceptedAt: 1_700_000_000_002,
    level: 'info',
    message: 'rebuilding index',
    fields: { partition: 7 },
    ...overrides,
  };
}

/** @param {Record<string, any>} [overrides] */
function logScope(overrides = {}) {
  return {
    appId: APP_ID,
    revisionId: REVISION_ID,
    runId: RUN_ID,
    invocationId: INVOCATION_ID,
    activityId: ACTIVITY_ID,
    attemptId: ATTEMPT_ID,
    generation: 3,
    coordinatorEpoch: 4,
    ...overrides,
  };
}

/**
 * @param {PageSnapshot} snapshot
 * @param {number} nextIndex
 * @param {number} previousSequence
 */
function pageCursor(snapshot, nextIndex, previousSequence) {
  return createExecutionLedgerAttemptLogPageCursor({
    scope: logScope(),
    snapshot,
    nextIndex,
    previousSequence,
  });
}

/**
 * @param {{
 *   scope?: Record<string, any>,
 *   snapshot?: Record<string, any>,
 *   items?: Record<string, any>[],
 *   nextCursor?: string,
 * }} [overrides]
 */
function logPage(overrides = {}) {
  const items = overrides.items ?? [logItem()];
  const defaultSnapshot =
    items.length === 0
      ? {
          entryCount: 0,
          cumulativePayloadBytes: 0,
          lastSequence: null,
        }
      : overrides.nextCursor !== undefined
        ? {
            entryCount: 2,
            cumulativePayloadBytes: 500,
            lastSequence: 3,
          }
        : {
            entryCount: 1,
            cumulativePayloadBytes: 231,
            lastSequence: 2,
          };
  return {
    scope: logScope(overrides.scope),
    disclosure: DISCLOSURE,
    snapshot: {
      ...defaultSnapshot,
      ...overrides.snapshot,
    },
    items,
    ...(overrides.nextCursor === undefined
      ? {}
      : { nextCursor: overrides.nextCursor }),
  };
}

/** @param {ReturnType<typeof outputHarness>} output */
function expectNoPageOutput(output) {
  expect(output.json).not.toHaveBeenCalled();
  expect(output.table).not.toHaveBeenCalled();
  expect(output.info).not.toHaveBeenCalled();
}

describe('execution-ledger activity-log command', () => {
  it('requires sensitive-output confirmation before identity resolution or storage reads', async () => {
    const output = outputHarness();
    const resolveAppId = jest.fn(async () => APP_ID);
    const readPage = jest.fn(async () => logPage());
    const command = createExecutionLedgerActivityLogCommand({
      resolveAppId,
      readPage,
      output,
    });

    await command.parseAsync(
      argv(['--run-id', RUN_ID, '--attempt-id', ATTEMPT_ID, '--json']),
    );

    expect(resolveAppId).not.toHaveBeenCalled();
    expect(readPage).not.toHaveBeenCalled();
    expectNoPageOutput(output);
    expect(output.failure).toHaveBeenCalledTimes(1);
    expect(output.failure.mock.calls[0][0]).toMatchObject({
      message:
        'logs requires --confirm-sensitive-output because application logs are unredacted and may contain secrets.',
    });
    expect(process.exitCode).toBe(1);
  });

  it('emits the exact raw non-authoritative JSON projection', async () => {
    const output = outputHarness();
    const snapshot = {
      entryCount: 3,
      cumulativePayloadBytes: 700,
      lastSequence: 5,
    };
    const cursor = pageCursor(snapshot, 1, 1);
    const nextCursor = pageCursor(snapshot, 2, 2);
    const readPage = jest.fn(
      async (/** @type {Record<string, any>} */ _request) =>
        logPage({
          snapshot,
          items: [
            logItem({
              message: 'token follows',
              fields: {
                token: 'unredacted-secret',
                nested: { enabled: true },
              },
            }),
          ],
          nextCursor,
        }),
    );
    const command = createExecutionLedgerActivityLogCommand({
      allowAppId: true,
      readPage,
      output,
    });

    await command.parseAsync(
      argv([
        '--app-id',
        APP_ID,
        '--run-id',
        RUN_ID,
        '--attempt-id',
        ATTEMPT_ID,
        '--limit',
        '1',
        '--cursor',
        cursor,
        '--confirm-sensitive-output',
        '--json',
      ]),
    );

    expect(readPage).toHaveBeenCalledWith({
      appId: APP_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      limit: 1,
      cursor,
    });
    expect(output.json).toHaveBeenCalledWith({
      schemaVersion: EXECUTION_LEDGER_ACTIVITY_LOG_PAGE_SCHEMA_VERSION,
      kind: EXECUTION_LEDGER_ACTIVITY_LOG_PAGE_KIND,
      authority: 'none',
      authoritative: false,
      disclosure: DISCLOSURE,
      integrity: { verified: true },
      scope: {
        appId: APP_ID,
        revisionId: REVISION_ID,
        runId: RUN_ID,
        invocationId: INVOCATION_ID,
        activityId: ACTIVITY_ID,
        attemptId: ATTEMPT_ID,
        generation: 3,
        coordinatorEpoch: 4,
      },
      snapshot: {
        entryCount: 3,
        cumulativePayloadBytes: 700,
        lastSequence: 5,
      },
      items: [
        {
          sequence: 2,
          acceptedAt: 1_700_000_000_002,
          level: 'info',
          message: 'token follows',
          fields: {
            token: 'unredacted-secret',
            nested: { enabled: true },
          },
        },
      ],
      nextCursor,
    });
    expect(output.json).toHaveBeenCalledTimes(1);
    expect(output.table).not.toHaveBeenCalled();
    expect(output.info).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('renders hostile terminal, C0, C1, and bidi values as inert JSON text and prints pagination guidance', async () => {
    const output = outputHarness();
    const snapshot = {
      entryCount: 2,
      cumulativePayloadBytes: 500,
      lastSequence: 3,
    };
    const nextCursor = pageCursor(snapshot, 1, 2);
    const hostileMessage =
      '\u001b]8;;https://attacker.invalid\u0007label\u001b]8;;\u0007\n\u009b31m\u202e';
    const hostileFields = {
      'direction\u202e': 'line\u0085\u0000',
    };
    const readPage = jest.fn(
      async (/** @type {Record<string, any>} */ _request) =>
        logPage({
          snapshot,
          items: [
            logItem({
              level: 'warn',
              message: hostileMessage,
              fields: hostileFields,
            }),
          ],
          nextCursor,
        }),
    );
    const command = createExecutionLedgerActivityLogCommand({
      resolveAppId: async () => APP_ID,
      readPage,
      output,
    });

    await command.parseAsync(
      argv([
        '--run-id',
        RUN_ID,
        '--attempt-id',
        ATTEMPT_ID,
        '--limit',
        '1',
        '--confirm-sensitive-output',
      ]),
    );

    expect(readPage).toHaveBeenCalledWith({
      appId: APP_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      limit: 1,
    });
    expect(output.table).toHaveBeenCalledWith([
      {
        sequence: 2,
        accepted_at: 1_700_000_000_002,
        level: 'warn',
        message_json:
          '"\\u001b]8;;https://attacker.invalid\\u0007label\\u001b]8;;\\u0007\\n\\u009b31m\\u202e"',
        fields_json: '{"direction\\u202e":"line\\u0085\\u0000"}',
      },
    ]);
    const renderedRows = JSON.stringify(output.table.mock.calls);
    expect(renderedRows).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
    expect(output.info).toHaveBeenCalledWith(
      `Next page: --cursor ${JSON.stringify(nextCursor)}`,
    );
    expect(output.json).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
  });

  it('writes terminal-inert JSON text while preserving raw parsed values', async () => {
    const write = jest.spyOn(console, 'log').mockImplementation(() => {});
    const hostileMessage = 'escape\u001b c1\u009b bidi\u202e';
    const hostileFields = { 'key\u2066': 'value\u0085' };
    const command = createExecutionLedgerActivityLogCommand({
      allowAppId: true,
      readPage: async () =>
        logPage({
          items: [
            logItem({
              message: hostileMessage,
              fields: hostileFields,
            }),
          ],
        }),
    });

    await command.parseAsync(
      argv([
        '--app-id',
        APP_ID,
        '--run-id',
        RUN_ID,
        '--attempt-id',
        ATTEMPT_ID,
        '--confirm-sensitive-output',
        '--json',
      ]),
    );

    expect(write).toHaveBeenCalledTimes(1);
    const text = write.mock.calls[0][0];
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
    expect(text).toContain('\\u009b');
    expect(text).toContain('\\u202e');
    const parsed = JSON.parse(text);
    expect(parsed.items[0]).toMatchObject({
      message: hostileMessage,
      fields: hostileFields,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    [
      'a private adapter error',
      async () => {
        throw new Error('private storage path /secret/control');
      },
    ],
    [
      'an invalid second item after a valid item',
      async () =>
        logPage({
          snapshot: {
            entryCount: 2,
            cumulativePayloadBytes: 500,
            lastSequence: 3,
          },
          items: [
            logItem(),
            logItem({
              sequence: 3,
              message: /** @type {any} */ ({
                privateSecondMessage: 'must-never-be-emitted',
              }),
            }),
          ],
        }),
    ],
    [
      'a cross-application page',
      async () =>
        logPage({
          scope: {
            appId: OTHER_APP_ID,
          },
        }),
    ],
    [
      'a private terminal-active cursor',
      async () =>
        logPage({
          nextCursor: '\u009bprivate-cursor-secret',
        }),
    ],
    [
      'a truncated frozen page',
      async () =>
        logPage({
          snapshot: {
            entryCount: 2,
            cumulativePayloadBytes: 500,
            lastSequence: 3,
          },
        }),
    ],
    [
      'a terminal page that does not reach its snapshot tip',
      async () =>
        logPage({
          snapshot: {
            entryCount: 1,
            cumulativePayloadBytes: 231,
            lastSequence: 3,
          },
        }),
    ],
  ])(
    'fails closed with one fixed redacted error and no partial output for %s',
    async (_name, readPage) => {
      const output = outputHarness();
      const command = createExecutionLedgerActivityLogCommand({
        resolveAppId: async () => APP_ID,
        readPage,
        output,
      });

      await command.parseAsync(
        argv([
          '--run-id',
          RUN_ID,
          '--attempt-id',
          ATTEMPT_ID,
          '--confirm-sensitive-output',
        ]),
      );

      expectNoPageOutput(output);
      expect(output.failure).toHaveBeenCalledTimes(1);
      expect(output.failure.mock.calls[0][0]).toMatchObject({
        message: SAFE_FAILURE,
      });
      expect(JSON.stringify(output.failure.mock.calls)).not.toMatch(
        /private storage path|secret\/control|privateSecondMessage|must-never-be-emitted|other-activity|private-cursor-secret/,
      );
      expect(process.exitCode).toBe(1);
    },
  );

  it('uses an explicit source app ID but resolves packaged identity lazily', async () => {
    const sourceOutput = outputHarness();
    const sourceReadPage = jest.fn(
      async (/** @type {Record<string, any>} */ _request) =>
        logPage({ items: [] }),
    );
    const source = createExecutionLedgerActivityLogCommand({
      allowAppId: true,
      readPage: sourceReadPage,
      output: sourceOutput,
    });

    await source.parseAsync(
      argv([
        '--app-id',
        APP_ID,
        '--run-id',
        RUN_ID,
        '--attempt-id',
        ATTEMPT_ID,
        '--confirm-sensitive-output',
        '--json',
      ]),
    );

    expect(sourceReadPage).toHaveBeenCalledWith({
      appId: APP_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      limit: EXECUTION_LEDGER_ACTIVITY_LOG_DEFAULT_LIMIT,
    });

    const packagedOutput = outputHarness();
    const resolveAppId = jest.fn(async () => APP_ID);
    const packagedReadPage = jest.fn(
      async (/** @type {Record<string, any>} */ _request) =>
        logPage({ items: [] }),
    );
    const packaged = createExecutionLedgerActivityLogCommand({
      resolveAppId,
      readPage: packagedReadPage,
      output: packagedOutput,
    });

    await packaged.parseAsync(
      argv([
        '--run-id',
        RUN_ID,
        '--attempt-id',
        ATTEMPT_ID,
        '--confirm-sensitive-output',
        '--json',
      ]),
    );

    expect(resolveAppId).toHaveBeenCalledTimes(1);
    expect(packagedReadPage).toHaveBeenCalledWith({
      appId: APP_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      limit: EXECUTION_LEDGER_ACTIVITY_LOG_DEFAULT_LIMIT,
    });
  });

  it('does not accept an application override in packaged identity mode', async () => {
    const output = outputHarness();
    const resolveAppId = jest.fn(async () => APP_ID);
    const readPage = jest.fn(async () => logPage());
    const command = silenceCommander(
      createExecutionLedgerActivityLogCommand({
        resolveAppId,
        readPage,
        output,
      }),
    );

    await expect(
      command.parseAsync(
        argv([
          '--app-id',
          OTHER_APP_ID,
          '--run-id',
          RUN_ID,
          '--attempt-id',
          ATTEMPT_ID,
          '--confirm-sensitive-output',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });

    expect(resolveAppId).not.toHaveBeenCalled();
    expect(readPage).not.toHaveBeenCalled();
    expectNoPageOutput(output);
    expect(output.failure).not.toHaveBeenCalled();
  });
});
