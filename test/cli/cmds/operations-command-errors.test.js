/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import listCommand from '../../../cli/cmds/list.js';
import opsListCommand from '../../../cli/cmds/ops_cmds/list.js';
import cancelCommand from '../../../cli/cmds/ops_cmds/cancel.js';
import runCommand from '../../../cli/cmds/ops_cmds/run.js';

const ORIGINAL_ENV = process.env;

/**
 * @param {{ mock: { calls: unknown[][] } }} spy - spy.
 * @returns {string} - Result.
 */
function collectSpyOutput(spy) {
  return spy.mock.calls
    .flat()
    .map((value) => String(value))
    .join('\n');
}

/**
 * @param {() => Promise<unknown>} invoke - invoke.
 * @param {RegExp} expectedMessage - expectedMessage.
 * @returns {Promise<void>} - Result.
 */
async function expectCliFailure(invoke, expectedMessage) {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const tableSpy = jest.spyOn(console, 'table').mockImplementation(() => {});

  try {
    await invoke();

    expect(process.exitCode).toBe(1);
    expect(collectSpyOutput(errorSpy)).toMatch(expectedMessage);
    expect(tableSpy).not.toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
    logSpy.mockRestore();
    tableSpy.mockRestore();
    process.exitCode = undefined;
  }
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
  delete process.env.WHARFIE_DB_ADAPTER;
  delete process.env.OPERATIONS_TABLE;
  delete process.env.WHARFIE_DB_PATH;
  delete process.env.AWS_REGION;
  process.exitCode = undefined;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe.each([
  [
    'wharfie list',
    () =>
      listCommand.parseAsync(['node', 'list', 'resource-1'], { from: 'node' }),
  ],
  [
    'wharfie ops list',
    () =>
      opsListCommand.parseAsync(['node', 'list', 'resource-1'], {
        from: 'node',
      }),
  ],
  [
    'wharfie ops cancel',
    () =>
      cancelCommand.parseAsync(['node', 'cancel', 'resource-1'], {
        from: 'node',
      }),
  ],
  [
    'wharfie ops run',
    () =>
      runCommand.parseAsync(['node', 'run', 'resource-1', 'op-1'], {
        from: 'node',
      }),
  ],
])('%s', (_label, invoke) => {
  it('reports invalid WHARFIE_DB_ADAPTER as a CLI failure', async () => {
    process.env.OPERATIONS_TABLE = 'operations-test';
    process.env.WHARFIE_DB_ADAPTER = 'not-a-real-adapter';

    await expectCliFailure(invoke, /WHARFIE_DB_ADAPTER/i);
  });

  it('reports a missing OPERATIONS_TABLE as a CLI failure', async () => {
    await expectCliFailure(invoke, /OPERATIONS_TABLE/i);
  });
});
