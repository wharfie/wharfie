/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import listCommand from '../../../src/cli/cmds/list.js';
import opsListCommand from '../../../src/cli/cmds/ops_cmds/list.js';
import cancelCommand from '../../../src/cli/cmds/ops_cmds/cancel.js';
import runCommand from '../../../src/cli/cmds/ops_cmds/run.js';

const ORIGINAL_ENV = process.env;
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const helloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'actor-systems',
  'hello-world',
);
const binPath = path.join(repoRoot, 'bin', 'wharfie');

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
      opsListCommand.parseAsync(['node', 'list', '--dir', helloWorldDir], {
        from: 'node',
      }),
  ],
  [
    'wharfie ops cancel',
    () =>
      cancelCommand.parseAsync(
        ['node', 'cancel', '--dir', helloWorldDir, '--operationId', 'op-1'],
        {
          from: 'node',
        },
      ),
  ],
  [
    'wharfie ops run',
    () =>
      runCommand.parseAsync(
        ['node', 'run', '--dir', helloWorldDir, '--activity', 'echo-event'],
        {
          from: 'node',
        },
      ),
  ],
])('%s', (_label, invoke) => {
  test('reports invalid WHARFIE_DB_ADAPTER as a CLI failure', async () => {
    process.env.OPERATIONS_TABLE = 'operations-test';
    process.env.WHARFIE_DB_ADAPTER = 'not-a-real-adapter';

    await expectCliFailure(invoke, /WHARFIE_DB_ADAPTER/i);
  });

  test('reports a missing OPERATIONS_TABLE as a CLI failure', async () => {
    await expectCliFailure(invoke, /OPERATIONS_TABLE/i);
  });
});

test('wharfie ops run rejects missing app run selectors', () => {
  const result = spawnSync(
    process.execPath,
    [binPath, 'ops', 'run', '--dir', helloWorldDir],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(
    /requires either --activity <activityName> or --workflow <workflowName>/i,
  );
});
