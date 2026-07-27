/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  EXECUTION_LEDGER_HISTORY_DEFAULT_LIMIT,
  EXECUTION_LEDGER_HISTORY_MAX_LIMIT,
  EXECUTION_LEDGER_HISTORY_PAGE_KIND,
  EXECUTION_LEDGER_HISTORY_PAGE_SCHEMA_VERSION,
  createExecutionLedgerHistoryCommand,
  listExecutionLedgerRuns,
} from '../../src/core/runtime/operator/execution-ledger-history-command.js';

const APP_ID = 'history-command-demo';
const OTHER_APP_ID = 'other-history-command-demo';
const CURSOR = 'ledger/cursor+opaque==';
const NEXT_CURSOR = 'ledger/next+opaque==';

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

/** @param {Record<string, any>} [overrides] */
function runItem(overrides = {}) {
  return {
    runId: 'run-one',
    appId: APP_ID,
    revisionId: 'revision-one',
    kind: 'manual',
    status: 'COMPLETED',
    version: 4,
    lastSequence: 4,
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
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

describe('execution-ledger history command', () => {
  it('emits one app-scoped projected JSON page without interpreting cursors', async () => {
    const output = outputHarness();
    const resolveIdentity = jest.fn(async (selection) => {
      expect(selection).toEqual({ dir: './fixture-app' });
      return { appId: APP_ID, ignoredRevision: 'newest' };
    });
    const listRuns = jest.fn(
      /** @param {{appId: string, limit: number, cursor?: string}} _request */
      async (_request) => ({
        items: [
          runItem({
            requestRef: 'private-request-ref',
            payload: { secret: true },
          }),
        ],
        nextCursor: NEXT_CURSOR,
        privatePageField: 'ignored',
      }),
    );
    const command = createExecutionLedgerHistoryCommand({
      resolveIdentity,
      allowDirectory: true,
      listRuns,
      output,
    });

    await command.parseAsync(
      argv([
        '--dir',
        './fixture-app',
        '--limit',
        '1',
        '--cursor',
        CURSOR,
        '--json',
      ]),
    );

    expect(listRuns).toHaveBeenCalledWith({
      appId: APP_ID,
      limit: 1,
      cursor: CURSOR,
    });
    expect(output.json).toHaveBeenCalledWith({
      schemaVersion: EXECUTION_LEDGER_HISTORY_PAGE_SCHEMA_VERSION,
      kind: EXECUTION_LEDGER_HISTORY_PAGE_KIND,
      authority: 'none',
      authoritative: false,
      integrity: { verified: true },
      scope: { appId: APP_ID },
      items: [
        {
          runId: 'run-one',
          revisionId: 'revision-one',
          kind: 'manual',
          status: 'COMPLETED',
          version: 4,
          lastSequence: 4,
          createdAt: 100,
          updatedAt: 200,
        },
      ],
      nextCursor: NEXT_CURSOR,
    });
    expect(JSON.stringify(output.json.mock.calls)).not.toMatch(
      /private-request-ref|secret|privatePageField/,
    );
    expect(output.table).not.toHaveBeenCalled();
    expect(output.info).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
  });

  it('uses the default limit and safe human rows for packaged use', async () => {
    const output = outputHarness();
    const listRuns = jest.fn(
      /** @param {{appId: string, limit: number, cursor?: string}} _request */
      async (_request) => ({
        items: [runItem()],
        nextCursor: NEXT_CURSOR,
      }),
    );
    const command = createExecutionLedgerHistoryCommand({
      resolveIdentity: async (selection) => {
        expect(selection).toEqual({});
        return { appId: APP_ID };
      },
      listRuns,
      output,
    });

    expect(command.options.map((option) => option.flags)).toEqual([
      '--limit <limit>',
      '--cursor <cursor>',
      '--json',
    ]);
    await command.parseAsync(argv());

    expect(listRuns).toHaveBeenCalledWith({
      appId: APP_ID,
      limit: EXECUTION_LEDGER_HISTORY_DEFAULT_LIMIT,
    });
    expect(output.table).toHaveBeenCalledWith([
      {
        run_id: 'run-one',
        revision: 'revision-one',
        run_kind: 'manual',
        status: 'COMPLETED',
        version: 4,
        last_sequence: 4,
        created_at: 100,
        updated_at: 200,
      },
    ]);
    expect(output.info).toHaveBeenCalledWith(
      `Next page: --cursor ${JSON.stringify(NEXT_CURSOR)}`,
    );
    expect(output.json).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
  });

  it('mounts --dir only when the host allows source selection', async () => {
    const source = createExecutionLedgerHistoryCommand({
      resolveIdentity: async () => ({ appId: APP_ID }),
      allowDirectory: true,
      listRuns: async () => ({ items: [] }),
    });
    expect(source.options.map((option) => option.flags)).toEqual([
      '--dir <dir>',
      '--limit <limit>',
      '--cursor <cursor>',
      '--json',
    ]);

    const resolveIdentity = jest.fn(async () => ({ appId: APP_ID }));
    const packaged = silenceCommander(
      createExecutionLedgerHistoryCommand({
        resolveIdentity,
        listRuns: async () => ({ items: [] }),
      }),
    );
    await expect(
      packaged.parseAsync(argv(['--dir', './not-allowed'])),
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it.each(['0', '01', '+1', '1.0', '1e1', '101'])(
    'rejects noncanonical --limit %s before identity resolution',
    async (limit) => {
      const resolveIdentity = jest.fn(async () => ({ appId: APP_ID }));
      const command = silenceCommander(
        createExecutionLedgerHistoryCommand({
          resolveIdentity,
          listRuns: async () => ({ items: [] }),
        }),
      );
      await expect(
        command.parseAsync(argv(['--limit', limit])),
      ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
      expect(resolveIdentity).not.toHaveBeenCalled();
    },
  );

  it('rejects repeated scalar options and empty or oversized cursors', async () => {
    const resolveIdentity = jest.fn(async () => ({ appId: APP_ID }));
    const createCommand = () =>
      silenceCommander(
        createExecutionLedgerHistoryCommand({
          resolveIdentity,
          allowDirectory: true,
          listRuns: async () => ({ items: [] }),
        }),
      );
    const invalidArgv = [
      ['--limit', '1', '--limit', '2'],
      ['--cursor', CURSOR, '--cursor', NEXT_CURSOR],
      ['--dir', 'one', '--dir', 'two'],
      ['--cursor', ''],
      ['--cursor', 'x'.repeat(4097)],
    ];
    for (const options of invalidArgv) {
      await expect(
        createCommand().parseAsync(argv(options)),
      ).rejects.toMatchObject({ code: 'commander.invalidArgument' });
    }
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid identity', async () => ({}), async () => ({ items: [] })],
    [
      'cross-app item',
      async () => ({ appId: APP_ID }),
      async () => ({ items: [runItem({ appId: OTHER_APP_ID })] }),
    ],
    [
      'malformed item',
      async () => ({ appId: APP_ID }),
      async () => ({ items: [runItem({ updatedAt: undefined })] }),
    ],
    [
      'sparse items',
      async () => ({ appId: APP_ID }),
      async () => {
        /** @type {unknown[]} */
        const items = [];
        items.length = 1;
        return { items };
      },
    ],
    [
      'empty continuation page',
      async () => ({ appId: APP_ID }),
      async () => ({ items: [], nextCursor: NEXT_CURSOR }),
    ],
    [
      'repeated cursor',
      async () => ({ appId: APP_ID }),
      async () => ({ items: [runItem()], nextCursor: CURSOR }),
    ],
    [
      'explicit null cursor',
      async () => ({ appId: APP_ID }),
      async () => ({ items: [runItem()], nextCursor: null }),
    ],
  ])(
    'fails closed with redacted output for %s',
    async (_name, identity, list) => {
      const output = outputHarness();
      const command = createExecutionLedgerHistoryCommand({
        resolveIdentity: identity,
        listRuns: list,
        output,
      });

      await command.parseAsync(argv(['--cursor', CURSOR, '--json']));

      expect(output.json).not.toHaveBeenCalled();
      expect(output.table).not.toHaveBeenCalled();
      expect(output.info).not.toHaveBeenCalled();
      expect(output.failure).toHaveBeenCalledTimes(1);
      expect(output.failure.mock.calls[0][0]).toMatchObject({
        message:
          'Durable run history could not be read safely. No partial page was emitted.',
      });
      expect(process.exitCode).toBe(1);
    },
  );

  it('builds the whole page before output and redacts private failures', async () => {
    const output = outputHarness();
    const command = createExecutionLedgerHistoryCommand({
      resolveIdentity: async () => ({ appId: APP_ID }),
      listRuns: async () => ({
        items: [
          runItem(),
          runItem({
            runId: 'private-second-run',
            status: undefined,
          }),
        ],
      }),
      output,
    });

    await command.parseAsync(argv(['--limit', '2']));

    expect(output.json).not.toHaveBeenCalled();
    expect(output.table).not.toHaveBeenCalled();
    expect(output.info).not.toHaveBeenCalled();
    expect(JSON.stringify(output.failure.mock.calls)).not.toMatch(
      /private-second-run/,
    );
    expect(process.exitCode).toBe(1);
  });

  it('redacts resolver and adapter errors', async () => {
    for (const failurePoint of ['identity', 'list']) {
      process.exitCode = undefined;
      const output = outputHarness();
      const command = createExecutionLedgerHistoryCommand({
        resolveIdentity:
          failurePoint === 'identity'
            ? async () => {
                throw new Error('private identity path');
              }
            : async () => ({ appId: APP_ID }),
        listRuns:
          failurePoint === 'list'
            ? async () => {
                throw new Error('private adapter detail');
              }
            : async () => ({ items: [] }),
        output,
      });

      await command.parseAsync(argv(['--json']));

      expect(output.json).not.toHaveBeenCalled();
      expect(output.table).not.toHaveBeenCalled();
      expect(output.info).not.toHaveBeenCalled();
      expect(JSON.stringify(output.failure.mock.calls)).not.toMatch(
        /private identity path|private adapter detail/,
      );
      expect(process.exitCode).toBe(1);
    }
  });

  it('validates the exported default adapter request without decoding cursors', async () => {
    await expect(
      listExecutionLedgerRuns({
        appId: APP_ID,
        limit: EXECUTION_LEDGER_HISTORY_MAX_LIMIT + 1,
        cursor: CURSOR,
      }),
    ).rejects.toThrow(/integer from 1 through 100/);
    await expect(
      listExecutionLedgerRuns({
        appId: APP_ID,
        limit: 1,
        cursor: '',
      }),
    ).rejects.toThrow(/bounded nonempty string/);
  });
});
