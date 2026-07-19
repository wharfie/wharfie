/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createExecutionLedgerOperatorCommands } from '../../../src/core/runtime/operator/execution-ledger-operator.js';
import runCommand from '../../../src/cli/cmds/ops_cmds/run.js';

const { inspectCommand, recoverCommand, reconcileCommand, cancelCommand } =
  createExecutionLedgerOperatorCommands();

const ORIGINAL_ENV = process.env;
/** @type {string[]} */
const temporaryDirectories = [];

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
  delete process.env.WHARFIE_APPLICATION_STATE_ADAPTER;
  delete process.env.WHARFIE_APPLICATION_STATE_PATH;
  delete process.env.AWS_REGION;
  process.exitCode = undefined;
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
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
    expect.hasAssertions();
    process.env.WHARFIE_CONTROL_ADAPTER = 'not-a-real-adapter';

    await expectCliFailure(invoke, /WHARFIE_CONTROL_ADAPTER/i);
  });
});

test('wharfie ops reconcile-effect requires runner confirmation before resolving packaged identity', async () => {
  const resolveExpectedIdentity = jest.fn(async () => {
    throw new Error('identity resolution must remain unreachable');
  });
  const failure = jest.fn();
  const json = jest.fn();
  const table = jest.fn();
  const success = jest.fn();
  const { reconcileEffectCommand } = createExecutionLedgerOperatorCommands({
    resolveExpectedIdentity,
    output: { failure, json, table, success },
  });

  await reconcileEffectCommand.parseAsync(
    [
      'node',
      'reconcile-effect',
      '--run-id',
      'private-confirmation-run',
      '--effect-id',
      'private-confirmation-effect',
      '--reconciliation-id',
      'private-confirmation-reconciliation',
    ],
    { from: 'node' },
  );

  expect(process.exitCode).toBe(1);
  expect(resolveExpectedIdentity).not.toHaveBeenCalled();
  expect(failure).toHaveBeenCalledTimes(1);
  const reported = failure.mock.calls[0][0];
  expect(reported).toBeInstanceOf(Error);
  if (!(reported instanceof Error)) {
    throw new TypeError('Expected the command to report an Error.');
  }
  expect(reported.message).toBe(
    'reconcile-effect requires --confirm-runner-stopped before it can change durable state.',
  );
  expect(json).not.toHaveBeenCalled();
  expect(table).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
  process.exitCode = undefined;
});

test('wharfie ops retry-effect requires runner confirmation before resolving packaged identity', async () => {
  const resolveExpectedIdentity = jest.fn(async () => {
    throw new Error('identity resolution must remain unreachable');
  });
  const failure = jest.fn();
  const json = jest.fn();
  const table = jest.fn();
  const success = jest.fn();
  const { retryEffectCommand } = createExecutionLedgerOperatorCommands({
    resolveExpectedIdentity,
    output: { failure, json, table, success },
  });

  await retryEffectCommand.parseAsync(
    [
      'node',
      'retry-effect',
      '--run-id',
      'private-confirmation-run',
      '--effect-id',
      'private-confirmation-effect',
      '--successor-id',
      'private-confirmation-successor',
    ],
    { from: 'node' },
  );

  expect(process.exitCode).toBe(1);
  expect(resolveExpectedIdentity).not.toHaveBeenCalled();
  expect(failure).toHaveBeenCalledTimes(1);
  const reported = failure.mock.calls[0][0];
  expect(reported).toBeInstanceOf(Error);
  if (!(reported instanceof Error)) {
    throw new TypeError('Expected the command to report an Error.');
  }
  expect(reported.message).toBe(
    'retry-effect requires --confirm-runner-stopped before it can authorize or execute new work.',
  );
  expect(json).not.toHaveBeenCalled();
  expect(table).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
  process.exitCode = undefined;
});

test('wharfie ops retry-effect reports a blocked target without claiming recovery or success', async () => {
  const timestamp = 1_700_000_000_000;
  /**
   * @param {string} runId - Synthetic run identity.
   * @param {string} status - Synthetic durable status.
   * @param {string} activityId - Synthetic activity identity.
   * @returns {Record<string, any>} - Minimal verified-view fixture.
   */
  const createView = (runId, status, activityId) => ({
    run: {
      runId,
      appId: 'retry-effect-test-app',
      revisionId: `wrv1_${'A'.repeat(43)}`,
      status,
      version: 2,
      lastSequence: 2,
      createdAt: timestamp,
      updatedAt: timestamp + 1,
      trigger: { private: 'trigger-secret' },
    },
    invocations: [
      {
        invocationId: `${runId}-invocation`,
        activityId,
        status: status === 'BLOCKED' ? 'UNCERTAIN' : 'RUNNING',
        generation: 1,
        version: 2,
        lastSequence: 2,
        createdAt: timestamp,
        updatedAt: timestamp + 1,
      },
    ],
    attempts: [],
    effects: [],
    events: [
      {
        sequence: 2,
        type: 'test-transition',
        observed_at: timestamp + 1,
        actor: { kind: 'local', id: 'test' },
        payload: { private: 'event-secret' },
      },
    ],
  });
  const retryEffect = jest.fn(async () => ({
    successor: {
      successorId: 'blocked-successor',
      intent: 'retry',
      authorizationApplied: false,
      sourceEffectId: 'source-effect',
      targetEffectId: 'target-effect',
      targetDisposition: /** @type {const} */ ('blocked'),
    },
    sourceView: createView('source-run', 'BLOCKED', 'authored-work'),
    targetView: createView('target-run', 'BLOCKED', 'wharfie-effect-successor'),
  }));
  const failure = jest.fn();
  const json = jest.fn();
  const table = jest.fn();
  const success = jest.fn();
  const { retryEffectCommand } = createExecutionLedgerOperatorCommands({
    retryEffect,
    output: { failure, json, table, success },
  });

  await retryEffectCommand.parseAsync(
    [
      'node',
      'retry-effect',
      '--run-id',
      'source-run',
      '--effect-id',
      'source-effect',
      '--successor-id',
      'blocked-successor',
      '--confirm-runner-stopped',
      '--json',
    ],
    { from: 'node' },
  );

  expect(retryEffect).toHaveBeenCalledTimes(1);
  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'wharfie.execution-ledger.effect-successor',
      effectSuccessor: expect.objectContaining({
        target: expect.objectContaining({
          status: 'BLOCKED',
          disposition: 'blocked',
        }),
      }),
    }),
  );
  expect(JSON.stringify(json.mock.calls[0][0])).not.toMatch(
    /trigger-secret|event-secret/,
  );
  expect(failure).toHaveBeenCalledTimes(1);
  const blockedFailure = failure.mock.calls[0][0];
  expect(blockedFailure).toBeInstanceOf(Error);
  if (!(blockedFailure instanceof Error)) {
    throw new TypeError('Expected blocked successor failure to be an Error.');
  }
  expect(blockedFailure.message).toMatch(
    /is BLOCKED.*did not recover or redispatch/i,
  );
  expect(success).not.toHaveBeenCalled();
  expect(table).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  process.exitCode = undefined;
});

test('wharfie ops run uses an isolated zero-config control store in tests', async () => {
  expect.hasAssertions();
  const applicationStatePath = mkdtempSync(
    path.join(tmpdir(), 'wharfie-ops-run-app-state-'),
  );
  temporaryDirectories.push(applicationStatePath);
  process.env.WHARFIE_APPLICATION_STATE_ADAPTER = 'lmdb';
  process.env.WHARFIE_APPLICATION_STATE_PATH = applicationStatePath;

  await expectCliSuccess(() =>
    runCommand.parseAsync(
      ['node', 'run', '--dir', helloWorldDir, '--activity', 'echo-event'],
      { from: 'node' },
    ),
  );
});
