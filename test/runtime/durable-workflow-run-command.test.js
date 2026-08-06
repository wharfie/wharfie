/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { createProgram as createPackagedOperatorProgram } from '../../src/core/resources/builds/actor-system-cli/index.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../src/core/runtime/application-revision.js';
import { createDurableWorkflowRunCommand } from '../../src/core/runtime/operator/durable-workflow-run-command.js';
import {
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  createWorkflowPlanId,
  createWorkflowRunId,
  normalizeWorkflowPlanPayload,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';

const APP_ID = 'foreground-run-demo';
const WORKFLOW_ID = 'main';
const STEP_ID = 'greet-step';
const WAIT_STEP_ID = 'wait-step';
const FINAL_STEP_ID = 'say-hello';
/** @typedef {import('../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution} ManifestActivityExecution */
/** @typedef {Extract<ManifestActivityExecution, {kind: 'embedded'}>} EmbeddedExecution */

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @param {string} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @returns {EmbeddedExecution} */
function makeExecution() {
  const contract = {
    schemaVersion: 4,
    app: { id: APP_ID },
    cli: {
      entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
      durable: { workflow: WORKFLOW_ID, export: 'toDurableInput' },
    },
    activities: {
      greet: {
        entrypoint: {
          kind: 'node',
          path: 'activities/greet.js',
          export: 'greet',
        },
      },
    },
    workflows: {
      [WORKFLOW_ID]: {
        steps: [
          {
            id: STEP_ID,
            kind: 'activity',
            activity: 'greet',
            input: { kind: 'workflow-input' },
          },
          {
            id: WAIT_STEP_ID,
            kind: 'timer',
            delayMs: 5_000,
          },
          {
            id: FINAL_STEP_ID,
            kind: 'activity',
            activity: 'greet',
            input: { kind: 'workflow-input' },
          },
        ],
      },
    },
  };
  const revision = createApplicationRevision({
    contract,
    inputs: {
      source: { format: SOURCE_TREE_INPUT_FORMAT, digest: digest('source') },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest('dependencies'),
      },
      runtime: { format: RUNTIME_INPUT_FORMAT, digest: digest('runtime') },
    },
  });
  return /** @type {EmbeddedExecution} */ ({
    kind: 'embedded',
    manifest: { ...contract, targets: [{ ...TARGET }] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId: APP_ID,
        revisionId: revision.revisionId,
        target: { ...TARGET },
      },
    },
  });
}

/** @returns {{execPath: string, exitCode: number | undefined, once: EventEmitter['once'], removeListener: EventEmitter['removeListener'], emit: EventEmitter['emit']}} */
function makeProcessRef() {
  const emitter = new EventEmitter();
  return {
    execPath: '/tmp/hello',
    exitCode: undefined,
    once: emitter.once.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
}

function makeOutput() {
  return {
    info: jest.fn(),
    progress: jest.fn(),
    success: jest.fn(),
    result: jest.fn(),
    paused: jest.fn(),
    failure: jest.fn(),
  };
}

/**
 * @param {EmbeddedExecution} execution
 * @param {string} name
 * @param {string} [status]
 * @param {any} [result]
 */
function rawOutput(
  execution,
  name,
  status = 'RUNNING',
  result = { greeting: 'Hello, Ada!' },
) {
  const runId = createWorkflowRunId({ appId: APP_ID, idempotencyKey: name });
  const completed = status === 'COMPLETED';
  return {
    scope: {
      appId: APP_ID,
      revisionId: execution.embeddedRevision.runtime.revisionId,
      runId,
    },
    snapshot: {
      runKind: 'workflow',
      status,
      version: completed ? 2 : 1,
      lastSequence: completed ? 2 : 1,
    },
    outputs: completed
      ? [{ stepId: STEP_ID, stepIndex: 0, value: result }]
      : [],
    terminal: completed ? { type: 'completed', result } : null,
  };
}
/**
 * @param {EmbeddedExecution} execution
 * @param {string} name
 * @param {Array<{stepId: string, value: any}>} steps
 * @param {string} [status]
 */
function rawStepOutputs(execution, name, steps, status = 'RUNNING') {
  const snapshot = rawOutput(execution, name, status, steps.at(-1)?.value);
  snapshot.outputs = steps.map((step, stepIndex) => ({
    stepId: step.stepId,
    stepIndex,
    value: step.value,
  }));
  snapshot.snapshot.version = Math.max(1, steps.length + 1);
  snapshot.snapshot.lastSequence = Math.max(1, steps.length + 1);
  return snapshot;
}

/**
 * @param {EmbeddedExecution} execution
 * @param {string} name
 * @param {boolean} [applied]
 */
function startResult(execution, name, applied = true) {
  const revisionId = execution.embeddedRevision.runtime.revisionId;
  const planPayload = normalizeWorkflowPlanPayload({
    schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
    kind: WORKFLOW_PLAN_PAYLOAD_KIND,
    appId: APP_ID,
    revisionId,
    workflowId: WORKFLOW_ID,
    definition: execution.manifest.workflows[WORKFLOW_ID],
  });
  const planId = createWorkflowPlanId(planPayload);
  const runId = createWorkflowRunId({ appId: APP_ID, idempotencyKey: name });
  const invocationId = 'foreground-start-invocation-1';
  const continuationId = 'foreground-start-continuation-1';
  return {
    appId: APP_ID,
    revisionId,
    workflowId: WORKFLOW_ID,
    idempotencyKey: name,
    runId,
    planId,
    outcome: {
      applied,
      run: {
        runId,
        appId: APP_ID,
        revisionId,
        trigger: {
          kind: 'workflow',
          workflowId: WORKFLOW_ID,
          planId,
          planRef: { payloadId: 'secret-plan-reference' },
        },
        requestRef: { payloadId: 'secret-start-reference' },
        status: 'RUNNING',
      },
      workflowCursor: {
        runId,
        appId: APP_ID,
        revisionId,
        workflowId: WORKFLOW_ID,
        planId,
        planRef: { payloadId: 'secret-plan-reference' },
        startRef: { payloadId: 'secret-start-reference' },
        invocationId,
        continuationId,
        disposition: 'ACTIVITY_RUNNABLE',
        stepId: STEP_ID,
        stepIndex: 0,
      },
      invocation: {
        runId,
        invocationId,
        appId: APP_ID,
        revisionId,
        activityId: 'greet',
        requestRef: { payloadId: 'secret-activity-reference' },
        status: 'RUNNABLE',
        workflow: {
          workflowId: WORKFLOW_ID,
          planId,
          continuationId,
          stepId: STEP_ID,
          stepIndex: 0,
        },
      },
    },
  };
}
/**
 * @param {EmbeddedExecution} execution
 * @param {string} name
 */
function retainedTimerStartResult(execution, name) {
  const result = /** @type {Record<string, any>} */ (
    startResult(execution, name, false)
  );
  const timerId = 'retained-timer';
  const continuationId = 'retained-timer-continuation-1';
  const { runId, revisionId, planId } = result;
  result.outcome.workflowCursor = {
    runId,
    appId: APP_ID,
    revisionId,
    workflowId: WORKFLOW_ID,
    planId,
    continuationId,
    stepId: WAIT_STEP_ID,
    stepIndex: 1,
    disposition: 'TIMER_WAITING',
    timerId,
  };
  delete result.outcome.invocation;
  result.outcome.timer = {
    runId,
    appId: APP_ID,
    revisionId,
    workflowId: WORKFLOW_ID,
    planId,
    continuationId,
    stepId: WAIT_STEP_ID,
    stepIndex: 1,
    timerId,
    status: 'WAITING',
  };
  return result;
}

function drainingWorker() {
  return jest.fn(
    async (
      /** @type {{execution: ManifestActivityExecution, signal: AbortSignal}} */ {
        signal,
      },
    ) => {
      if (signal.aborted) return;
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
      });
    },
  );
}

/** @param {Record<string, any>} [options] */
function makeCommand(options = {}) {
  const execution = makeExecution();
  const processRef = options.processRef || makeProcessRef();
  const output = options.output || makeOutput();
  return {
    execution,
    processRef,
    output,
    command: createDurableWorkflowRunCommand({
      loadExecution: async () => ({ execution }),
      loadCliModule: async () => ({
        toDurableInput: (/** @type {string[]} */ args) => ({ who: args[0] }),
      }),
      startWorkflow:
        options.startWorkflow ||
        (async (/** @type {{idempotencyKey: string}} */ { idempotencyKey }) =>
          startResult(execution, idempotencyKey)),
      runWorker: options.runWorker || drainingWorker(),
      readRunOutput:
        options.readRunOutput ||
        (async () => rawOutput(execution, 'first-run', 'COMPLETED')),
      inspectRun: options.inspectRun || (async () => null),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.environment === undefined
        ? {}
        : { environment: options.environment }),
      output,
      processRef,
      pollIntervalMs: options.pollIntervalMs ?? 0,
      ownerRetryIntervalMs: 0,
    }),
  };
}

describe('packaged foreground durable workflow run command', () => {
  it('owns top-level run while retaining the activity leaf under activity run', () => {
    const program = createPackagedOperatorProgram();
    const run = program.commands.find(
      (candidate) => candidate.name() === 'run',
    );
    const activity = program.commands.find(
      (candidate) => candidate.name() === 'activity',
    );

    expect(run?.helpInformation()).toContain('--name <stableName>');
    expect(run?.helpInformation()).toContain('[appArgs...]');
    expect(run?.helpInformation()).not.toContain('--activity');
    expect(activity?.commands.map((candidate) => candidate.name())).toEqual([
      'run',
    ]);
    expect(activity?.commands[0].helpInformation()).toContain(
      '--activity <activityName>',
    );
  });

  it('dispatches the magnetic path through the packaged operator program', async () => {
    const execution = makeExecution();
    const output = makeOutput();
    const processRef = makeProcessRef();
    const program = createPackagedOperatorProgram({
      loadDurableWorkflowRunExecution: async () => ({ execution }),
      loadDeveloperCliModule: async () => ({
        toDurableInput: (/** @type {string[]} */ args) => ({ who: args[0] }),
      }),
      startWorkflow: async (
        /** @type {{idempotencyKey: string}} */ { idempotencyKey },
      ) => startResult(execution, idempotencyKey),
      runForegroundWorker: drainingWorker(),
      readForegroundRunOutput: async () =>
        rawOutput(execution, 'first-run', 'COMPLETED'),
      inspectForegroundRun: async () => null,
      durableWorkflowRunOutput: output,
      processRef,
    });

    await program.parseAsync(['run', '--name', 'first-run', '--', 'Ada'], {
      from: 'user',
    });

    expect(output.success).toHaveBeenCalledWith(
      '✓ Completed first-run; result retained.',
    );
    expect(output.failure).not.toHaveBeenCalled();
  });

  it('rejects a malformed workflow admission before starting a resident', async () => {
    const execution = makeExecution();
    const output = makeOutput();
    const runWorker = drainingWorker();
    const readRunOutput = jest.fn(async () =>
      rawOutput(execution, 'first-run', 'COMPLETED'),
    );
    const { command, processRef } = makeCommand({
      output,
      runWorker,
      readRunOutput,
      startWorkflow: async (
        /** @type {{idempotencyKey: string}} */ { idempotencyKey },
      ) => {
        const result = startResult(execution, idempotencyKey);
        result.revisionId = 'rev_sha256_unexpected';
        return result;
      },
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'first-run',
      '--',
      'Ada',
    ]);

    expect(output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Durable workflow start returned an unexpected immutable identity.',
      }),
    );
    expect(output.info).not.toHaveBeenCalled();
    expect(runWorker).not.toHaveBeenCalled();
    expect(readRunOutput).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBe(1);
  });

  it('starts, drives, follows verified progress, and prints the retained result', async () => {
    const execution = makeExecution();
    const output = makeOutput();
    const processRef = makeProcessRef();
    const startWorkflow = jest.fn(
      async (
        /** @type {{execution: ManifestActivityExecution, workflowId: string, idempotencyKey: string, input: any, callerMetadata: Record<string, any>, actor?: {kind: string, id: string}}} */ {
          idempotencyKey,
        },
      ) => startResult(execution, idempotencyKey),
    );
    let readCount = 0;
    const readRunOutput = jest.fn(async () => {
      readCount += 1;
      return readCount === 1
        ? rawOutput(execution, 'first-run')
        : rawOutput(execution, 'first-run', 'COMPLETED');
    });
    const runWorker = drainingWorker();
    const command = createDurableWorkflowRunCommand({
      loadExecution: async () => ({ execution }),
      loadCliModule: async () => ({
        toDurableInput: (/** @type {string[]} */ args) => ({ who: args[0] }),
      }),
      startWorkflow,
      runWorker,
      readRunOutput,
      inspectRun: async () => ({
        workflowCursor: {
          disposition: 'TIMER_WAITING',
          timerId: 'timer-1',
        },
        timers: [
          {
            timerId: 'timer-1',
            stepId: 'wait-step',
            status: 'WAITING',
            dueAt: 5_200,
          },
        ],
      }),
      now: () => 1_000,
      output,
      processRef,
      pollIntervalMs: 0,
      ownerRetryIntervalMs: 0,
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'first-run',
      '--',
      'Ada',
    ]);

    expect(startWorkflow).toHaveBeenCalledWith({
      execution,
      workflowId: WORKFLOW_ID,
      idempotencyKey: 'first-run',
      input: { who: 'Ada' },
      callerMetadata: {},
      actor: {
        kind: 'packaged-foreground',
        id: execution.embeddedRevision.runtime.revisionId,
      },
    });
    expect(runWorker).toHaveBeenCalledWith({
      execution,
      signal: expect.any(AbortSignal),
    });
    expect(output.progress).toHaveBeenCalledWith(
      '◷ wait-step — durable timer, 4.2s remaining',
    );
    expect(output.progress).toHaveBeenCalledWith(`✓ ${STEP_ID} — committed`);
    expect(output.success).toHaveBeenCalledWith(
      '✓ Completed first-run; result retained.',
    );
    expect(output.result).toHaveBeenCalledWith(
      { greeting: 'Hello, Ada!' },
      '{"greeting":"Hello, Ada!"}',
    );
    expect(output.failure).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBeUndefined();
  });

  it('prints a completed string result without JSON quotes', async () => {
    const execution = makeExecution();
    const output = makeOutput();
    const { command } = makeCommand({
      output,
      readRunOutput: async () =>
        rawOutput(execution, 'first-run', 'COMPLETED', 'Hello, Ada!'),
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'first-run',
      '--',
      'Ada',
    ]);

    expect(output.result).toHaveBeenCalledWith('Hello, Ada!', 'Hello, Ada!');
  });

  it('reports retained steps when the exact named run is reopened', async () => {
    const execution = makeExecution();
    const output = makeOutput();
    const { command } = makeCommand({
      output,
      startWorkflow: async (
        /** @type {{idempotencyKey: string}} */ { idempotencyKey },
      ) => startResult(execution, idempotencyKey, false),
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'first-run',
      '--',
      'Ada',
    ]);

    expect(output.info).toHaveBeenCalledWith(
      expect.stringContaining('↻ Resuming first-run'),
    );
    expect(output.progress).toHaveBeenCalledWith(
      `✓ ${STEP_ID} — retained; not run again`,
    );
  });
  it('labels only pre-driver outputs as retained on a reused run', async () => {
    const execution = makeExecution();
    const output = makeOutput();
    const retained = [{ stepId: STEP_ID, value: { prepared: true } }];
    let reads = 0;
    const { command } = makeCommand({
      output,
      startWorkflow: async (
        /** @type {{idempotencyKey: string}} */ { idempotencyKey },
      ) => retainedTimerStartResult(execution, idempotencyKey),
      readRunOutput: async () => {
        reads += 1;
        const withTimer = [
          ...retained,
          { stepId: WAIT_STEP_ID, value: { waited: true } },
        ];
        if (reads === 1) {
          return rawStepOutputs(execution, 'first-run', retained);
        }
        if (reads === 2) {
          return rawStepOutputs(execution, 'first-run', withTimer);
        }
        return rawStepOutputs(
          execution,
          'first-run',
          [...withTimer, { stepId: FINAL_STEP_ID, value: 'Hello, Ada!' }],
          'COMPLETED',
        );
      },
      inspectRun: async () => ({
        workflowCursor: {
          disposition: 'TIMER_WAITING',
          timerId: 'retained-timer',
        },
        timers: [
          {
            timerId: 'retained-timer',
            stepId: WAIT_STEP_ID,
            status: 'WAITING',
            dueAt: 7_500,
          },
        ],
      }),
      now: () => 2_500,
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'first-run',
      '--',
      'Ada',
    ]);

    expect(
      output.progress.mock.calls
        .map(([message]) => message)
        .filter(
          (message) => typeof message === 'string' && message.startsWith('✓ '),
        ),
    ).toEqual([
      `✓ ${STEP_ID} — retained; not run again`,
      `✓ ${WAIT_STEP_ID} — committed`,
      `✓ ${FINAL_STEP_ID} — committed`,
    ]);
  });

  it('identifies a retained deadline as the same durable timer on reopen', async () => {
    const execution = makeExecution();
    const output = makeOutput();
    let reads = 0;
    const { command } = makeCommand({
      output,
      startWorkflow: async (
        /** @type {{idempotencyKey: string}} */ { idempotencyKey },
      ) => retainedTimerStartResult(execution, idempotencyKey),
      readRunOutput: async () => {
        reads += 1;
        return rawOutput(
          execution,
          'first-run',
          reads === 1 ? 'RUNNING' : 'COMPLETED',
        );
      },
      inspectRun: async () => ({
        workflowCursor: {
          disposition: 'TIMER_WAITING',
          timerId: 'retained-timer',
        },
        timers: [
          {
            timerId: 'retained-timer',
            stepId: 'wait-step',
            status: 'WAITING',
            dueAt: 7_500,
          },
        ],
      }),
      now: () => 2_500,
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'first-run',
      '--',
      'Ada',
    ]);

    expect(output.progress).toHaveBeenCalledWith(
      '◷ wait-step — same durable timer, 5.0s remaining',
    );
  });

  it('labels a timer reached after admission as new on a reused run', async () => {
    const execution = makeExecution();
    const output = makeOutput();
    let reads = 0;
    const { command } = makeCommand({
      output,
      startWorkflow: async (
        /** @type {{idempotencyKey: string}} */ { idempotencyKey },
      ) => startResult(execution, idempotencyKey, false),
      readRunOutput: async () => {
        reads += 1;
        return rawOutput(
          execution,
          'first-run',
          reads === 1 ? 'RUNNING' : 'COMPLETED',
        );
      },
      inspectRun: async () => ({
        workflowCursor: {
          disposition: 'TIMER_WAITING',
          timerId: 'new-timer',
        },
        timers: [
          {
            timerId: 'new-timer',
            stepId: WAIT_STEP_ID,
            status: 'WAITING',
            dueAt: 7_500,
          },
        ],
      }),
      now: () => 2_500,
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'first-run',
      '--',
      'Ada',
    ]);

    expect(output.progress).toHaveBeenCalledWith(
      `◷ ${WAIT_STEP_ID} — durable timer, 5.0s remaining`,
    );
    expect(output.progress).not.toHaveBeenCalledWith(
      `◷ ${WAIT_STEP_ID} — same durable timer, 5.0s remaining`,
    );
  });
  it('follows an active resident and takes over if that owner exits', async () => {
    const execution = makeExecution();
    const output = makeOutput();
    let workerCalls = 0;
    /** @type {() => void} */
    let markSecondWorkerStarted = () => {};
    const secondWorkerStarted = new Promise((resolve) => {
      markSecondWorkerStarted = () => resolve(true);
    });
    const runWorker = jest.fn(
      async (
        /** @type {{execution: ManifestActivityExecution, signal: AbortSignal}} */ {
          signal,
        },
      ) => {
        workerCalls += 1;
        if (workerCalls === 1) {
          const active = new Error('another resident owns this app');
          active.name = 'LocalServiceSessionActiveError';
          throw active;
        }
        markSecondWorkerStarted();
        if (!signal.aborted) {
          await new Promise((resolve) => {
            signal.addEventListener('abort', resolve, { once: true });
          });
        }
      },
    );
    let reads = 0;
    const readRunOutput = jest.fn(async () => {
      reads += 1;
      if (reads === 1) return rawOutput(execution, 'first-run');
      await secondWorkerStarted;
      return rawOutput(execution, 'first-run', 'COMPLETED');
    });
    const { command } = makeCommand({
      output,
      runWorker,
      readRunOutput,
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'first-run',
      '--',
      'Ada',
    ]);

    expect(runWorker).toHaveBeenCalledTimes(2);
    expect(output.success).toHaveBeenCalledWith(
      '✓ Completed first-run; result retained.',
    );
    expect(output.failure).not.toHaveBeenCalled();
  });

  it('drains on SIGINT without cancelling and prints the exact resume command', async () => {
    const execution = makeExecution();
    const processRef = makeProcessRef();
    const output = makeOutput();
    const readRunOutput = jest.fn(async () => {
      queueMicrotask(() => processRef.emit('SIGINT'));
      return rawOutput(execution, 'interruptible');
    });
    const { command } = makeCommand({
      processRef,
      output,
      readRunOutput,
      pollIntervalMs: 10,
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'interruptible',
      '--',
      'Ada Lovelace',
    ]);

    expect(output.paused).toHaveBeenCalledWith(
      "Paused interruptible without cancelling durable work. Resume with: /tmp/hello wharfie run --name interruptible -- $'Ada Lovelace'",
    );
    expect(output.success).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBe(130);
  });

  it('keeps a one-shot data root in the quoted resume command', async () => {
    const execution = makeExecution();
    const processRef = makeProcessRef();
    const output = makeOutput();
    const readRunOutput = jest.fn(async () => {
      queueMicrotask(() => processRef.emit('SIGINT'));
      return rawOutput(execution, 'rooted');
    });
    const { command } = makeCommand({
      processRef,
      output,
      readRunOutput,
      environment: {
        WHARFIE_DATA_ROOT: "/tmp/Wharfie Data's",
      },
      pollIntervalMs: 10,
    });

    await command.parseAsync([
      'node',
      'hello',
      '--name',
      'rooted',
      '--',
      'Ada Lovelace',
    ]);

    expect(output.paused).toHaveBeenCalledWith(
      "Paused rooted without cancelling durable work. Resume with: WHARFIE_DATA_ROOT=$'/tmp/Wharfie Data\\x27s' /tmp/hello wharfie run --name rooted -- $'Ada Lovelace'",
    );
    expect(output.failure).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBe(130);
  });
});
