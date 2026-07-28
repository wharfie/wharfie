/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';

import { createSourceOpsCommand } from '../../src/cli/cmds/ops.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';
import { createProgram as createPackagedOperatorProgram } from '../../src/core/resources/builds/actor-system-cli/index.js';
import {
  DURABLE_WORKFLOW_SIGNAL_RECEIPT_KIND,
  createDurableWorkflowSignalReceipt,
  createDurableWorkflowSignalCommand,
} from '../../src/core/runtime/operator/durable-workflow-signal-command.js';

const APP_ID = 'workflow-signal-command-demo';
const REVISION_ID = 'workflow-signal-revision';
const WORKFLOW_ID = 'main';
const PLAN_ID = 'workflow-signal-plan';
const RUN_ID = createWorkflowRunId({
  appId: APP_ID,
  idempotencyKey: 'signal-command-run',
});
const SIGNAL_ID = 'approval';
const DELIVERY_ID = 'delivery-1';
const sourceOpsCommand = createSourceOpsCommand();

function outputHarness() {
  return {
    json: jest.fn(),
    table: jest.fn(),
    success: jest.fn(),
    failure: jest.fn(),
  };
}

/** @param {string[]} options - Command options. */
function argv(options) {
  return ['node', 'artifact', ...options];
}

function signalArgs(payload = '{"approved":true}') {
  return [
    '--run-id',
    RUN_ID,
    '--signal',
    SIGNAL_ID,
    '--delivery-id',
    DELIVERY_ID,
    '--payload',
    payload,
  ];
}

function acceptedResult({ applied = true, terminal = false } = {}) {
  const cursor = terminal
    ? {
        runId: RUN_ID,
        signalWaitId: 'private-final-wait-id',
        disposition: 'COMPLETED',
        stepId: SIGNAL_ID,
        stepIndex: 0,
      }
    : {
        runId: RUN_ID,
        invocationId: 'private-next-invocation-id',
        disposition: 'ACTIVITY_RUNNABLE',
        stepId: 'finish',
        stepIndex: 1,
      };
  return {
    applied,
    outcome: 'accepted',
    run: {
      runId: RUN_ID,
      appId: APP_ID,
      revisionId: REVISION_ID,
      trigger: {
        kind: 'workflow',
        workflowId: WORKFLOW_ID,
        planId: PLAN_ID,
      },
      status: terminal ? 'COMPLETED' : 'RUNNING',
    },
    workflowCursor: {
      ...cursor,
      appId: APP_ID,
      revisionId: REVISION_ID,
      workflowId: WORKFLOW_ID,
      planId: PLAN_ID,
    },
    signalDelivery: {
      runId: RUN_ID,
      appId: APP_ID,
      deliveryId: DELIVERY_ID,
      signalId: SIGNAL_ID,
      status: 'ACCEPTED',
      payloadRef: { payloadId: 'private-payload-id' },
      actor: { kind: 'private', id: 'private' },
    },
    outputRef: { payloadId: 'private-output-id' },
  };
}

describe('durable workflow signal command', () => {
  it('mounts one shared option surface under source ops and packaged root', () => {
    const source = sourceOpsCommand.commands.find(
      (candidate) => candidate.name() === 'signal',
    );
    const packagedProgram = createPackagedOperatorProgram({
      resolveExpectedIdentity: async () => ({ appId: APP_ID }),
    });
    const packaged = packagedProgram.commands.find(
      (candidate) => candidate.name() === 'signal',
    );
    const flags = [
      '--run-id <runId>',
      '--signal <signalId>',
      '--delivery-id <deliveryId>',
      '--payload <json>',
      '--json',
    ];

    expect(source?.options.map((option) => option.flags)).toEqual(flags);
    expect(packaged?.options.map((option) => option.flags)).toEqual(flags);
    expect(sourceOpsCommand.helpInformation()).toMatch(/\bsignal\b/);
    expect(packagedProgram.helpInformation()).toMatch(/\bsignal\b/);
  });

  it('delivers parsed JSON under packaged app scope and redacts a final signal', async () => {
    const output = outputHarness();
    const processRef = { exitCode: undefined };
    const deliverSignal = jest.fn(
      async (/** @type {Record<string, any>} */ _options) =>
        acceptedResult({ terminal: true }),
    );
    const resolveExpectedIdentity = jest.fn(async () => ({ appId: APP_ID }));
    const command = createDurableWorkflowSignalCommand({
      resolveExpectedIdentity,
      deliverSignal,
      output,
      processRef,
    });

    await command.parseAsync(argv([...signalArgs(), '--json']));

    expect(deliverSignal).toHaveBeenCalledWith({
      runId: RUN_ID,
      signalId: SIGNAL_ID,
      deliveryId: DELIVERY_ID,
      payload: { approved: true },
      expectedAppId: APP_ID,
    });
    expect(output.json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: DURABLE_WORKFLOW_SIGNAL_RECEIPT_KIND,
      runId: RUN_ID,
      signalId: SIGNAL_ID,
      deliveryId: DELIVERY_ID,
      outcome: 'accepted',
      reused: false,
      runStatus: 'COMPLETED',
      cursor: {
        disposition: 'COMPLETED',
        stepId: SIGNAL_ID,
        stepIndex: 0,
      },
      nextActivation: { kind: 'terminal' },
    });
    expect(JSON.stringify(output.json.mock.calls)).not.toMatch(
      /approved|payloadRef|payloadId|outputRef|actor|private/,
    );
    expect(output.failure).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBeUndefined();
  });

  it('emits the exact same recursively frozen JSON receipt from source and packaged surfaces', async () => {
    const sourceOutput = outputHarness();
    const packagedOutput = outputHarness();
    const sourceProcess = { exitCode: undefined };
    const packagedProcess = {
      exitCode: undefined,
      once: jest.fn(),
      removeListener: jest.fn(),
    };
    const source = createDurableWorkflowSignalCommand({
      deliverSignal: async () => acceptedResult(),
      output: sourceOutput,
      processRef: sourceProcess,
    });
    const packaged = createPackagedOperatorProgram({
      resolveExpectedIdentity: async () => ({ appId: APP_ID }),
      deliverWorkflowSignal: async () => acceptedResult(),
      durableWorkflowSignalOutput: packagedOutput,
      processRef: packagedProcess,
    });

    await source.parseAsync(argv([...signalArgs(), '--json']));
    await packaged.parseAsync(argv(['signal', ...signalArgs(), '--json']));

    const expected = {
      schemaVersion: 1,
      kind: DURABLE_WORKFLOW_SIGNAL_RECEIPT_KIND,
      runId: RUN_ID,
      signalId: SIGNAL_ID,
      deliveryId: DELIVERY_ID,
      outcome: 'accepted',
      reused: false,
      runStatus: 'RUNNING',
      cursor: {
        disposition: 'ACTIVITY_RUNNABLE',
        stepId: 'finish',
        stepIndex: 1,
      },
      nextActivation: { kind: 'activity' },
    };
    expect(sourceOutput.json).toHaveBeenCalledWith(expected);
    expect(packagedOutput.json).toHaveBeenCalledWith(expected);
    const sourceReceipt = /** @type {Record<string, any>} */ (
      sourceOutput.json.mock.calls[0][0]
    );
    const packagedReceipt = /** @type {Record<string, any>} */ (
      packagedOutput.json.mock.calls[0][0]
    );
    expect(sourceReceipt).toEqual(packagedReceipt);
    expect(JSON.stringify(sourceReceipt)).toBe(JSON.stringify(packagedReceipt));
    for (const receipt of [sourceReceipt, packagedReceipt]) {
      expect(Object.isFrozen(receipt)).toBe(true);
      expect(Object.isFrozen(receipt.cursor)).toBe(true);
      expect(Object.isFrozen(receipt.nextActivation)).toBe(true);
      expect(JSON.stringify(receipt)).not.toMatch(
        /payloadRef|payloadId|outputRef|actor|private/,
      );
    }
    expect(sourceOutput.failure).not.toHaveBeenCalled();
    expect(packagedOutput.failure).not.toHaveBeenCalled();
    expect(sourceProcess.exitCode).toBeUndefined();
    expect(packagedProcess.exitCode).toBeUndefined();
  });

  it('reports exact accepted replay without exposing the next activation ID', async () => {
    const output = outputHarness();
    const deliverSignal = jest.fn(async () =>
      acceptedResult({ applied: false }),
    );
    const command = createDurableWorkflowSignalCommand({
      deliverSignal,
      output,
      processRef: { exitCode: undefined },
    });

    await command.parseAsync(argv(signalArgs()));

    expect(output.table).toHaveBeenCalledWith([
      {
        delivery_id: DELIVERY_ID,
        run_id: RUN_ID,
        signal: SIGNAL_ID,
        outcome: 'accepted',
        rejection_reason: '',
        reused: true,
        status: 'RUNNING',
        cursor_disposition: 'ACTIVITY_RUNNABLE',
        step: 'finish',
        step_index: 1,
        activation_kind: 'activity',
      },
    ]);
    expect(JSON.stringify(output.table.mock.calls)).not.toContain(
      'private-next-invocation-id',
    );
    expect(output.success).toHaveBeenCalledWith(
      `Workflow signal delivery ${DELIVERY_ID} was already accepted.`,
    );
  });

  it.each([['early-signal'], ['unexpected-signal'], ['late-signal']])(
    'emits one durable %s rejection and exits nonzero',
    async (reason) => {
      const output = outputHarness();
      const processRef = { exitCode: undefined };
      const command = createDurableWorkflowSignalCommand({
        deliverSignal: async () => ({
          applied: true,
          outcome: 'rejected',
          rejectionReason: reason,
          run: {
            runId: RUN_ID,
            appId: APP_ID,
            revisionId: REVISION_ID,
            trigger: {
              kind: 'workflow',
              workflowId: WORKFLOW_ID,
              planId: PLAN_ID,
            },
            status: 'RUNNING',
          },
          workflowCursor: {
            runId: RUN_ID,
            appId: APP_ID,
            revisionId: REVISION_ID,
            workflowId: WORKFLOW_ID,
            planId: PLAN_ID,
            invocationId: 'private-current-id',
            disposition: 'ACTIVITY_RUNNING',
            stepId: 'work',
            stepIndex: 0,
          },
          signalDelivery: {
            runId: RUN_ID,
            appId: APP_ID,
            deliveryId: DELIVERY_ID,
            signalId: SIGNAL_ID,
            status: 'REJECTED',
            rejectionReason: reason,
            payloadRef: { payloadId: 'private-rejected-payload' },
          },
        }),
        output,
        processRef,
      });

      await command.parseAsync(argv([...signalArgs('null'), '--json']));

      expect(output.json).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'rejected',
          rejectionReason: reason,
          reused: false,
        }),
      );
      expect(output.failure).toHaveBeenCalledWith(expect.any(Error));
      expect(processRef.exitCode).toBe(1);
    },
  );

  it.each([
    [
      'mismatched rejected decision',
      () => ({
        ...acceptedResult(),
        outcome: 'rejected',
        rejectionReason: 'early-signal',
        signalDelivery: {
          ...acceptedResult().signalDelivery,
          status: 'REJECTED',
          rejectionReason: 'late-signal',
        },
      }),
    ],
    [
      'accepted decision carrying a rejection reason',
      () => ({
        ...acceptedResult(),
        rejectionReason: 'unexpected-signal',
        signalDelivery: {
          ...acceptedResult().signalDelivery,
          rejectionReason: 'unexpected-signal',
        },
      }),
    ],
  ])('refuses a %s', (_label, createResult) => {
    expect(() =>
      createDurableWorkflowSignalReceipt(createResult(), {
        runId: RUN_ID,
        signalId: SIGNAL_ID,
        deliveryId: DELIVERY_ID,
      }),
    ).toThrow(/rejection reason/i);
  });

  it.each([
    [
      'unknown cursor disposition',
      (/** @type {Record<string, any>} */ result) =>
        (result.workflowCursor.disposition = 'SECRET_STATE'),
    ],
    [
      'inconsistent run status',
      (/** @type {Record<string, any>} */ result) =>
        (result.run.status = 'BLOCKED'),
    ],
    [
      'multiple activation identities',
      (/** @type {Record<string, any>} */ result) =>
        (result.workflowCursor.timerId = 'private-timer-id'),
    ],
    [
      'missing activation identity',
      (/** @type {Record<string, any>} */ result) =>
        delete result.workflowCursor.invocationId,
    ],
    [
      'empty activation identity',
      (/** @type {Record<string, any>} */ result) =>
        (result.workflowCursor.invocationId = ''),
    ],
    [
      'empty cursor step',
      (/** @type {Record<string, any>} */ result) =>
        (result.workflowCursor.stepId = ''),
    ],
    [
      'invalid cursor step index',
      (/** @type {Record<string, any>} */ result) =>
        (result.workflowCursor.stepIndex = -1),
    ],
  ])('refuses an accepted result with %s', (_label, mutate) => {
    const result = acceptedResult();
    mutate(result);

    expect(() =>
      createDurableWorkflowSignalReceipt(result, {
        runId: RUN_ID,
        signalId: SIGNAL_ID,
        deliveryId: DELIVERY_ID,
      }),
    ).toThrow('inconsistent durable status');
  });

  it('refuses internally mismatched workflow identity', () => {
    const result = acceptedResult();
    result.workflowCursor.planId = 'wrong-plan';

    expect(() =>
      createDurableWorkflowSignalReceipt(result, {
        runId: RUN_ID,
        signalId: SIGNAL_ID,
        deliveryId: DELIVERY_ID,
      }),
    ).toThrow('unexpected immutable workflow identity');
  });

  it('refuses an unknown run without inventing durable state', async () => {
    const output = outputHarness();
    const processRef = { exitCode: undefined };
    const command = createDurableWorkflowSignalCommand({
      deliverSignal: async () => ({ applied: false, outcome: 'unknown-run' }),
      output,
      processRef,
    });

    await command.parseAsync(argv([...signalArgs(), '--json']));

    expect(output.json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: DURABLE_WORKFLOW_SIGNAL_RECEIPT_KIND,
      runId: RUN_ID,
      signalId: SIGNAL_ID,
      deliveryId: DELIVERY_ID,
      outcome: 'unknown-run',
      reused: false,
    });
    expect(processRef.exitCode).toBe(1);
  });

  it.each(['source', 'packaged'])(
    'redacts malformed payload JSON on the %s surface before identity or delivery',
    async (surface) => {
      const secret = 'secret-never-echo-this';
      const malformedPayload = `{"token":${secret}}`;
      const output = outputHarness();
      const deliverSignal = jest.fn(
        async (/** @type {Record<string, any>} */ _options) =>
          Object.freeze({}),
      );
      const resolveExpectedIdentity = jest.fn(async () => ({ appId: APP_ID }));
      const processRef = {
        exitCode: undefined,
        once: jest.fn(),
        removeListener: jest.fn(),
      };
      const command =
        surface === 'source'
          ? createDurableWorkflowSignalCommand({
              deliverSignal,
              output,
              processRef,
            })
          : createPackagedOperatorProgram({
              resolveExpectedIdentity,
              deliverWorkflowSignal: deliverSignal,
              durableWorkflowSignalOutput: output,
              processRef,
            });

      await command.parseAsync(
        argv([
          ...(surface === 'packaged' ? ['signal'] : []),
          ...signalArgs(malformedPayload),
        ]),
      );

      expect(deliverSignal).not.toHaveBeenCalled();
      expect(resolveExpectedIdentity).not.toHaveBeenCalled();
      expect(output.failure).toHaveBeenCalledTimes(1);
      const failure = output.failure.mock.calls[0][0];
      expect(failure).toEqual(
        expect.objectContaining({ message: 'Invalid signal payload JSON.' }),
      );
      expect(String(failure)).not.toContain(secret);
      expect(String(failure)).not.toContain(malformedPayload);
      expect(processRef.exitCode).toBe(1);
    },
  );
});
