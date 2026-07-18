/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createExecutionLedgerOperatorCommands } from '../../../src/core/runtime/operator/execution-ledger-operator.js';
import runCommand from '../../../src/cli/cmds/ops_cmds/run.js';

const { inspectCommand, recoverCommand, reconcileCommand, cancelCommand } =
  createExecutionLedgerOperatorCommands();

const ORIGINAL_ENV = process.env;

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const helloWorldDir = path.join(
  repoRoot,
  'scratch',
  'examples',
  'apps',
  'hello-world',
);

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

/**
 * @param {() => Promise<unknown>} invoke - invoke.
 * @returns {Promise<void>} - Result.
 */
async function expectCliSuccess(invoke) {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const tableSpy = jest.spyOn(console, 'table').mockImplementation(() => {});

  try {
    await invoke();

    expect(process.exitCode).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
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
  delete process.env.WHARFIE_CONTROL_ADAPTER;
  delete process.env.WHARFIE_CONTROL_PATH;
  delete process.env.WHARFIE_DB_PATH;
  delete process.env.AWS_REGION;
  process.exitCode = undefined;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe.each([
  [
    'wharfie ops inspect',
    () =>
      inspectCommand.parseAsync(
        ['node', 'inspect', '--run-id', 'wlm_missing-inspection-run'],
        { from: 'node' },
      ),
  ],
  [
    'wharfie ops recover',
    () =>
      recoverCommand.parseAsync(
        [
          'node',
          'recover',
          '--run-id',
          'wlm_missing-recovery-run',
          '--confirm-runner-stopped',
        ],
        { from: 'node' },
      ),
  ],
  [
    'wharfie ops cancel',
    () =>
      cancelCommand.parseAsync(
        [
          'node',
          'cancel',
          '--run-id',
          'wlm_missing-cancellation-run',
          '--request-id',
          'missing-cancellation-request',
        ],
        { from: 'node' },
      ),
  ],
  [
    'wharfie ops reconcile',
    () =>
      reconcileCommand.parseAsync(
        [
          'node',
          'reconcile',
          '--run-id',
          'wlm_missing-reconciliation-run',
          '--reconciliation-id',
          'missing-reconciliation-request',
          '--evidence-file',
          'unused-evidence.json',
          '--confirm-runner-stopped',
        ],
        { from: 'node' },
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
  test('reports invalid WHARFIE_CONTROL_ADAPTER as a CLI failure', async () => {
    process.env.WHARFIE_CONTROL_ADAPTER = 'not-a-real-adapter';

    await expectCliFailure(invoke, /WHARFIE_CONTROL_ADAPTER/i);
  });
});

test('wharfie ops run uses an isolated zero-config control store in tests', async () => {
  await expectCliSuccess(() =>
    runCommand.parseAsync(
      ['node', 'run', '--dir', helloWorldDir, '--activity', 'echo-event'],
      { from: 'node' },
    ),
  );
});
